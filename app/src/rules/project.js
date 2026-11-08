// Третий слой правил — правила ПРОЕКТА.
//
// Стандарт говорит, что такое корректная модель UML; практика — что такую
// модель трудно читать; правило проекта говорит, как договорилась команда:
// «домен не зависит от интерфейса», «у публичного интерфейса обязательна
// документация». Это не требование стандарта, поэтому у замечания нет ни
// пункта, ни констрейнта, ни rationale: сослаться не на что, кроме самого
// правила, а оно живёт в файле модели, а не в поставке приложения.
//
// Правило компилируется в функцию `(model, rule) => Finding[]` — так движку
// всё равно, откуда правило: из файла правил, из модели или из теста.
// Контекст для условия собирается здесь, потому что только здесь известно,
// как из модели достать владельца, кратности и степени вершины. Никакого
// `eval`: условие уже проверено и свёрнуто в предикат в `dsl.js`.
//
// Сбой правила (исключение при чтении модели) не роняет прогон — это работа
// `engine.js`; здесь важно только не глотать ошибки: пусть летят наверх.

import { NOTATION } from '../model/notation.js';
import { compileWhen, validateRule } from './dsl.js';
import { report } from './finding.js';

/** Название вида для `detail`: «Класс», «Зависимость», иначе сам ключ. */
const shapeLabel = (kind) => NOTATION.shapes[kind]?.label ?? kind;
const connLabel = (kind) => NOTATION.connectors[kind]?.label ?? kind;

/**
 * Индексы по модели: владелец и степени вершины. Считаются на каждый прогон
 * правила — `commit` правит модель НА МЕСТЕ, поэтому кэш по ссылке на модель
 * устарел бы после первой же правки и правило судило бы старую модель.
 * Линейный проход по сотне элементов дешевле, чем такой кэш.
 */
function indexes(model) {
  const byId = new Map();
  const degree = new Map();
  for (const e of model.elements ?? []) {
    byId.set(e.id, e);
    degree.set(e.id, { incoming: 0, outgoing: 0 });
  }
  for (const r of model.relationships ?? []) {
    const from = degree.get(r.from);
    const to = degree.get(r.to);
    if (from) from.outgoing += 1;
    if (to) to.incoming += 1;
  }
  return { byId, degree };
}

/** Контекст условия для элемента: ровно поля белого списка из `dsl.js`. */
function elementContext(el, idx) {
  const owner = el.ownerId ? idx.byId.get(el.ownerId) ?? null : null;
  const d = idx.degree.get(el.id) ?? { incoming: 0, outgoing: 0 };
  return {
    kind: el.kind,
    name: el.name ?? '',
    stereotype: el.stereotype ?? '',
    'owner.name': owner ? (owner.name ?? '') : null,
    'owner.kind': owner ? owner.kind : null,
    visibility: el.visibility ?? '',
    'documentation.empty': String(el.documentation ?? '').trim() === '',
    incoming: d.incoming,
    outgoing: d.outgoing,
  };
}

/** Контекст условия для связи: концы, их виды и кратности. */
function relationshipContext(rel, idx) {
  const from = rel.from ? idx.byId.get(rel.from) ?? null : null;
  const to = rel.to ? idx.byId.get(rel.to) ?? null : null;
  return {
    kind: rel.kind,
    'from.name': from ? (from.name ?? '') : null,
    'from.kind': from ? from.kind : null,
    'to.name': to ? (to.name ?? '') : null,
    'to.kind': to ? to.kind : null,
    fromMultiplicity: rel.fromMultiplicity ?? null,
    toMultiplicity: rel.toMultiplicity ?? null,
    'documentation.empty': String(rel.documentation ?? '').trim() === '',
  };
}

/** Что именно нашлось — строкой для панели: имя, вид, концы. */
function elementDetail(el) {
  return `${shapeLabel(el.kind)} «${el.name || 'без имени'}»`;
}

function relationshipDetail(rel, idx) {
  const from = rel.from ? idx.byId.get(rel.from) : null;
  const to = rel.to ? idx.byId.get(rel.to) : null;
  const name = rel.name ? ` «${rel.name}»` : '';
  const ends = `${from ? `«${from.name || 'без имени'}»` : '—'} → ${to ? `«${to.name || 'без имени'}»` : '—'}`;
  return `${connLabel(rel.kind)}${name}: ${ends}`;
}

/**
 * Собрать правило проекта в проверку.
 *
 * Бросает при битом правиле (текст ошибки начинается с его имени) — это
 * ошибка ЗАГРУЗКИ, а не прогона: правило, которое нельзя понять, нельзя и
 * проверить, и тихое «ничего не нашло» здесь было бы ложью.
 *
 * Возвращает `(model, rule) => Finding[]`; второй аргумент — правило в том
 * виде, в каком его держит движок (с `basis`, уровнем и текстом). Замечание
 * получает `basis: 'project'`, `clause: null`, `constraint: null`,
 * `rationale: null` и `targets` — id виноватого.
 */
export function compileProjectRule(rule) {
  const r = validateRule(rule);
  const matches = compileWhen(r.when);
  const kinds = new Set(r.appliesTo?.element ?? r.appliesTo?.relationship ?? []);

  return (model, active = r) => {
    if (!model || typeof model !== 'object') throw new Error('правилу проекта нужна модель');
    const current = active ?? r;
    const idx = indexes(model);
    const findings = [];

    // Область берём из ПРОВЕРЕННОГО правила (`r`), а не из того, что пришло в
    // движок: `validateRule` нормализовал и её, и виды в `appliesTo`.
    if (r.scope === 'model') {
      // Правило уровня модели: одно замечание, виноватого нет. Условия у него
      // не бывает — полей модели в DSL нет (см. `dsl.js`).
      findings.push(report({ ...current, basis: 'project' }, [], `Модель «${model.name || 'без имени'}»`));
      return findings;
    }

    if (r.scope === 'element') {
      for (const el of model.elements ?? []) {
        if (kinds.size && !kinds.has(el.kind)) continue;
        if (!matches(elementContext(el, idx))) continue;
        findings.push(report({ ...current, basis: 'project' }, [el.id], elementDetail(el)));
      }
      return findings;
    }

    for (const rel of model.relationships ?? []) {
      if (kinds.size && !kinds.has(rel.kind)) continue;
      if (!matches(relationshipContext(rel, idx))) continue;
      findings.push(report({ ...current, basis: 'project' }, [rel.id], relationshipDetail(rel, idx)));
    }
    return findings;
  };
}
