// Движок правил: наборы правил → проверки → замечания.
//
// Наборы (`notation/rules/uml-2.5.1.json` и `notation/rules/practice.json`)
// читаются как данные: движок ничего не знает про конкретные правила, он знает
// только реестр `check → функция`. Поэтому правило без источника, без уровня
// или без функции в реестре — ошибка загрузки: набор, в котором правило молча
// не проверяется, хуже, чем набор, который отказался загрузиться.
//
// Слоёв два, и они не смешиваются:
//   * стандарт (`basis: 'uml'`) — констрейнты UML 2.5.1; у каждого обязателен
//     пункт, имя констрейнта и дословный текст, иначе это не правило стандарта;
//   * практика (`basis: 'practice'`) — советы, у которых пункта нет вовсе.
//     Поэтому у практики `source` запрещён (притворяться стандартом нельзя), а
//     вместо него обязателен `rationale` — объяснение, почему такую модель
//     читать трудно.
//
// Третий слой — правила проекта (`project.js`): соглашения команды, которые
// лежат в файле модели, а не в поставке приложения. Они приходят третьим
// параметром (`{ project: [...] }`) или, если параметр не задан, читаются из
// `model.projectRules` — файл модели и есть их место жительства. Явный список
// нужен тестам и импорту файла правил; модель без правил ведёт себя ровно как
// раньше, поэтому старые вызовы `createRuleset(pkg)` и
// `createRuleset(pkg, { practice })` не меняются.
//
// Замечание — `{ ruleId, level, basis, message, detail, hint, clause,
// constraint, page, rationale, targets, diagramId }` (см. `finding.js`). Порядок
// замечаний детерминирован: сначала весь слой стандарта в порядке файла, затем
// слой практики, затем правила проекта; внутри правила — в порядке модели.

import { CHECKS, PRACTICE_CHECKS } from './registry.js';
import { NOT_EXPRESSIBLE } from './coverage.js';
import { countByLevel, failure } from './finding.js';
import { compileProjectRule } from './project.js';

const LEVELS = new Set(['error', 'warning']);

/**
 * Собрать движок из разобранных наборов правил.
 *
 * `standardPkg` — массив правил стандарта (то, что лежит в `uml-2.5.1.json`);
 * `practice` — массив правил практики (`practice.json`), по умолчанию пустой:
 * вызов `createRuleset(pkg)` остаётся прежним — один слой стандарта;
 * `project` — массив правил проекта или `null` (по умолчанию): `null` значит
 * «взять из модели», массив — «только эти» (пустой массив выключает правила
 * модели, это нужно тестам).
 *
 * Возвращает `{ rules, uncovered, run(model), counts(findings) }`:
 *   `rules`     — правила слоёв с приклеенной функцией (`fn`) или записью
 *                 `gap`, в порядке: стандарт, практика, проект (правила
 *                 проекта из модели сюда не попадают: они меняются вместе с
 *                 моделью, а `rules` — снимок загрузки);
 *   `uncovered` — правила стандарта, которые модель не выражает;
 *   `run`       — все замечания по модели (упавшее правило — записью со
 *                 `status: 'failed'`, а не пропуском и не падением прогона);
 *   `counts`    — счётчики: стандарт отдельно, советы отдельно.
 */
export function createRuleset(standardPkg, { practice = [], project = null, notExpressible = NOT_EXPRESSIBLE } = {}) {
  if (!Array.isArray(standardPkg) || !standardPkg.length) throw new Error('набор правил пуст или это не массив');
  if (!Array.isArray(practice)) throw new Error('слой практики — не массив правил');
  if (project !== null && project !== undefined && !Array.isArray(project)) {
    throw new Error('слой правил проекта — не массив правил');
  }

  const seen = new Set();
  const rules = [];

  /** Общая часть обеих ветвей: id, уровень и пара `check`/`gap`. */
  const build = (raw, i, where) => {
    if (!raw || typeof raw !== 'object') throw new Error(`правило №${i + 1} в слое «${where}» — не объект`);
    const id = String(raw.id ?? '').trim();
    if (!id) throw new Error(`правило №${i + 1} в слое «${where}» без id`);
    if (seen.has(id)) throw new Error(`правило «${id}» повторяется в наборе`);
    seen.add(id);
    if (!LEVELS.has(raw.level)) throw new Error(`правило «${id}»: уровень «${raw.level}» — не error и не warning`);
    const check = String(raw.check ?? '').trim();
    if (!check) throw new Error(`правило «${id}» без check`);
    if (!CHECKS[check] && !notExpressible[id]) {
      throw new Error(`правило «${id}»: проверки «${check}» нет в реестре`);
    }
    if (CHECKS[check] && notExpressible[id]) {
      throw new Error(`правило «${id}»: проверка «${check}» есть, но правило записано невыразимым`);
    }
    return { id, fn: CHECKS[check] ?? null, gap: notExpressible[id] ?? null };
  };

  standardPkg.forEach((raw, i) => {
    const { id, fn, gap } = build(raw, i, 'стандарт');
    const src = raw.source ?? {};
    if (!String(src.clause ?? '').trim()) throw new Error(`правило «${id}»: нет пункта стандарта (source.clause)`);
    if (!String(src.constraint ?? '').trim()) throw new Error(`правило «${id}»: нет имени констрейнта (source.constraint)`);
    if (!String(src.text ?? '').trim()) throw new Error(`правило «${id}»: нет дословного текста констрейнта (source.text)`);
    rules.push({ ...raw, basis: 'uml', fn, gap });
  });

  practice.forEach((raw, i) => {
    const { id, fn, gap } = build(raw, i, 'практика');
    // Практика не имеет права притворяться стандартом: поле `source` здесь —
    // не мелочь оформления, а ложь о происхождении правила.
    if ('source' in raw) {
      throw new Error(`правило практики «${id}»: поле source запрещено — практика не имеет права притворяться стандартом`);
    }
    if (!String(raw.rationale ?? '').trim()) {
      throw new Error(`правило практики «${id}»: нет rationale — практика обязана объяснить, почему это запах модели`);
    }
    rules.push({ ...raw, basis: 'practice', fn, gap });
  });

  // Правила проекта компилируются сразу: битое правило — ошибка загрузки с
  // его именем, а не «правило ничего не нашло». Явный список (не `null`)
  // собирается здесь; правила из модели — в `run`, потому что модель
  // открывается и правится после загрузки набора.
  const projectGiven = project !== null && project !== undefined;
  const compiled = [];
  (project ?? []).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`правило №${i + 1} в слое «проект» — не объект`);
    const id = String(raw.id ?? '').trim();
    if (!id) throw new Error(`правило №${i + 1} в слое «проект» без id`);
    if (seen.has(id)) throw new Error(`правило «${id}» повторяется в наборе`);
    seen.add(id);
    compiled.push({ ...raw, id, basis: 'project', fn: compileProjectRule(raw), gap: null });
  });
  rules.push(...compiled);

  // Осиротевшая проверка — опечатка в `check`: функция есть, правила нет.
  // Проверяем по объединению слоёв. Исключение одно: проверки практики при
  // пустом слое практики — это старый вызов `createRuleset(pkg)` с одним
  // набором стандарта, а не забытое правило.
  const used = new Set(rules.map((r) => r.check));
  const orphans = Object.keys(CHECKS)
    .filter((c) => !used.has(c) && !(practice.length === 0 && PRACTICE_CHECKS.has(c)));
  if (orphans.length) throw new Error(`в реестре проверки без правила: ${orphans.join(', ')}`);

  // Невыразимое правило, у которого всё-таки появилась функция, — тоже ошибка:
  // списки «что проверяем» и «что не выразить» не имеют права пересекаться.
  const stale = Object.keys(notExpressible).filter((id) => !seen.has(id));
  if (stale.length) throw new Error(`в наборе нет правил, записанных невыразимыми: ${stale.join(', ')}`);

  // Невыразимыми бывают только констрейнты стандарта: совету практики нечего
  // «не выражать» — он и так не про модель UML.
  const uncovered = rules.filter((r) => r.basis === 'uml' && !r.fn).map((r) => ({
    id: r.id,
    clause: r.source.clause,
    constraint: r.source.constraint,
    level: r.level,
    reason: r.gap.reason,
    missing: r.gap.missing,
  }));

  // Правила проекта из модели: кэш держится за ссылку на массив, а не за
  // модель. `commit` правит модель на месте, но массив правил при правке
  // заменяется целиком, поэтому ссылка — верный признак «правила те же».
  let fromModel = { ref: null, rules: [] };
  const projectRulesOf = (model) => {
    const list = Array.isArray(model?.projectRules) ? model.projectRules : [];
    if (!list.length) return [];
    if (fromModel.ref === list) return fromModel.rules;
    const built = [];
    const ids = new Set(rules.map((r) => r.id));
    list.forEach((raw, i) => {
      const id = String(raw?.id ?? '').trim();
      try {
        if (!raw || typeof raw !== 'object') throw new Error(`правило проекта №${i + 1} — не объект`);
        if (!id) throw new Error(`правило проекта №${i + 1} без id`);
        if (ids.has(id)) throw new Error(`правило «${id}» повторяется в наборе`);
        ids.add(id);
        built.push({ ...raw, id, basis: 'project', fn: compileProjectRule(raw), gap: null });
      } catch (e) {
        // Битое правило в файле модели не имеет права унести весь прогон:
        // человек должен увидеть и остальные замечания, и сбой этого правила.
        built.push({ id: id || `project-${i + 1}`, basis: 'project', fn: null, gap: null, loadError: e.message });
      }
    });
    fromModel = { ref: list, rules: built };
    return built;
  };

  return {
    rules,
    uncovered,
    run(model) {
      if (!model || typeof model !== 'object') throw new Error('движку нужна модель');
      const findings = [];
      const active = projectGiven ? rules : rules.concat(projectRulesOf(model));
      for (const rule of active) {
        // Правило, которое не удалось даже собрать, — та же запись-сбой, что и
        // упавшее на прогоне: иначе о нём не узнал бы никто.
        if (rule.loadError) {
          findings.push(failure(rule, new Error(rule.loadError)));
          continue;
        }
        if (!rule.fn) continue;
        // Упавшее правило не имеет права унести весь прогон: тогда одна
        // кривая связь оставила бы человека без всех остальных замечаний и
        // выдала бы «проверок нет» за «модель чиста». Правило, бросившее
        // исключение, отключается до конца этого прогона — цикл идёт по
        // `rules` один раз, — а в список попадает отдельная запись-сбой.
        // Не-массив от правила — тот же сбой: `for...of` внутри `try`.
        try {
          const list = rule.fn(model, rule) ?? [];
          for (const f of list) findings.push(f);
        } catch (e) {
          findings.push(failure(rule, e));
        }
      }
      return findings;
    },
    counts: countByLevel,
  };
}