// Четвёртый слой проверок — геометрия листа (перенос из archify 3.0.1), без
// браузера.
//
// Панель «Проверки» (`src/ui/checks.js`) гоняет три набора правил модели и
// четвёртый — проверки раскладки из `src/vendor/archify/geometry-adapter.mjs`. В
// браузере этот слой проверяется сценариями панели (вторая волна E2E), а здесь
// доказывается то, что видно только из Node:
//
//   * счётчики раскладывают четвёртый слой отдельно: замечания к листу не
//     попадают ни в ошибки, ни в предупреждения, ни в `total` — иначе цифра
//     «предупреждений UML» перестала бы быть свойством модели;
//   * мост на настоящей модели отдаёт замечания только своего слоя, с
//     существующими `targets` и `diagramId`, и на модели с наложениями находит
//     хотя бы одно пересечение рамок;
//   * `measure` действительно используется: с завышенной шириной текста имён,
//     которые не влезают в рамку, становится больше, чем с настоящим `textWidth`
//     модели, — то есть панель не меряет приближением archify;
//   * подключение не откатилось: в исходнике панели есть вызов моста и id/классы
//     раздела и чипа геометрии. Это дешёвый страж; настоящую проверку панели
//     делает E2E.
//
//   node tests/geometry.mjs
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

const load = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// Нотация та же, что на странице: мост по ней отличает актёра (имя под фигурой)
// от класса и не судит виды с переносом текста. Без неё на этой модели
// появляется ложное замечание — см. README archify.
const { applyPackage, NOTATION } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8')));
const { textWidth } = await load('src/model/geometry.js');
const { geometryFindings, GEOMETRY_RULE_IDS } = await load('src/vendor/archify/geometry-adapter.mjs');
const { countByLevel, report, failure } = await load('src/rules/finding.js');

/**
 * Настоящая модель с диска: uml-model/3 с `elements` и `diagrams`.
 *
 * `demo-errors.json` идёт первым — это та модель, на которой работает сама
 * панель, и файл с намеренно расставленными ошибками МОДЕЛИ. Наложений в нём
 * нет: фигуры, которые на первый взгляд «налезают», нарисованы друг в друге
 * по владению (component внутри класса) — это вложенность, а не дефект
 * раскладки. Настоящее наложение проверяется отдельной фикстурой ниже.
 * Каталог ищется в двух местах: приложение носит свою копию (`app/material`),
 * а учебный корпус живёт рядом с проектом (`material/`).
 */
async function findModel() {
  const dirs = [path.join(ROOT, 'material'), path.resolve(ROOT, '..', 'material')];
  for (const dir of dirs) {
    let files = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    files.sort((a, b) => {
      if (a === b) return 0;
      if (a === 'demo-errors.json') return -1;
      if (b === 'demo-errors.json') return 1;
      return a.localeCompare(b);
    });
    for (const file of files) {
      let model = null;
      try {
        model = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
      } catch {
        continue;
      }
      if (String(model?.schema ?? '').startsWith('uml-model/3')
        && Array.isArray(model.elements) && Array.isArray(model.diagrams)) {
        return { model, where: path.relative(ROOT, path.join(dir, file)) };
      }
    }
  }
  throw new Error('в material/ нет модели uml-model/3 с elements и diagrams');
}

const { model, where } = await findModel();
const findings = geometryFindings(model, { notation: NOTATION, measure: (t) => textWidth(t) });
const countBy = (list, ruleId) => list.filter((f) => f.ruleId === ruleId).length;

/* ------------------------------------------------------------ счётчики */

await check('countByLevel: геометрия отдельным счётчиком, сбой — вне всех', async () => {
  const c = countByLevel([
    { basis: 'uml', level: 'error' },
    { basis: 'uml', level: 'error' },
    { basis: 'practice', level: 'warning' },
    { basis: 'project', level: 'error' },
    { basis: 'geometry', level: 'warning' },
    { basis: 'geometry', level: 'warning' },
    { basis: 'geometry', level: 'warning', status: 'failed' },
  ]);
  assert(c.errors === 2 && c.warnings === 0, `стандарт ${c.errors}/${c.warnings}`);
  assert(c.advice === 1, `советов ${c.advice}, а не 1`);
  assert(c.project === 1, `проекта ${c.project}, а не 1`);
  assert(c.layout === 2, `раскладки ${c.layout}, а не 2`);
  assert(c.failed === 1, `сбоев ${c.failed}, а не 1`);
  assert(c.total === 2, `total ${c.total}, а не 2 (только стандарт)`);
  // Возвращаемое — надмножество прежнего: старые поля на месте, новое одно.
  const keys = Object.keys(c).sort().join(',');
  assert(keys === 'advice,errors,failed,layout,project,total,warnings', `поля: ${keys}`);
  return 'ошибки 2, совет 1, проект 1, раскладка 2, сбой 1, total 2';
});

await check('report/failure: у геометрии нет пункта, констрейнта, страницы и rationale', async () => {
  // Правило как у настоящего: с source, чтобы было видно, что поля не просто
  // пустые, а именно не смешиваются со стандартом.
  const rule = {
    id: 'geometry-shapes-overlap', level: 'warning', message: 'Перекрытие',
    hint: 'Разведите фигуры', basis: 'geometry',
    source: { clause: '7.8.8.8', constraint: 'MultiplicityElement', page: 12 },
  };
  const f = report(rule, ['c1'], 'детали');
  assert(f.basis === 'geometry', `basis «${f.basis}»`);
  assert(f.clause === null && f.constraint === null && f.page === null,
    `поля стандарта: ${JSON.stringify({ clause: f.clause, constraint: f.constraint, page: f.page })}`);
  assert(f.rationale === null, `rationale «${f.rationale}»`);
  const fl = failure(rule, new Error('бум'));
  assert(fl.status === 'failed' && fl.basis === 'geometry', `сбой: ${JSON.stringify(fl)}`);
  assert(fl.clause === null && fl.constraint === null && fl.page === null && fl.rationale === null,
    'сбой геометрии притворился стандартом');
  return 'clause/constraint/page/rationale = null у замечания и у сбоя';
});

/* --------------------------------------------------- мост на модели */

await check('geometryFindings на реальной модели: слой, правила, цели, листы', async () => {
  const badBasis = findings.filter((f) => f.basis !== 'geometry');
  assert(!badBasis.length, `чужой слой: ${badBasis.map((f) => `${f.ruleId} basis=${f.basis}`).join(', ')}`);
  const badRule = findings.filter((f) => !GEOMETRY_RULE_IDS.includes(f.ruleId));
  assert(!badRule.length, `правила вне списка: ${badRule.map((f) => f.ruleId).join(', ')}`);
  // Поля стандарта мост заполнять не должен: пустой «п.» в панели читался бы
  // как ссылка, которой нет.
  const badFields = findings.filter((f) => f.clause !== null || f.constraint !== null
    || f.page !== null || f.rationale !== null);
  assert(!badFields.length, `заполнены поля чужого слоя: ${badFields.map((f) => f.ruleId).join(', ')}`);
  const elementIds = new Set((model.elements ?? []).map((e) => e.id));
  const badTargets = findings.flatMap((f) => (f.targets ?? []).filter((id) => !elementIds.has(id)));
  assert(!badTargets.length, `цели не из модели: ${badTargets.join(', ')}`);
  const diagramIds = new Set((model.diagrams ?? []).map((d) => d.id));
  const badDiagram = findings.filter((f) => f.diagramId !== null && !diagramIds.has(f.diagramId));
  assert(!badDiagram.length, `листы не из модели: ${badDiagram.map((f) => `${f.ruleId} ${f.diagramId}`).join(', ')}`);
  // Перекрытий здесь быть не должно: всё, что похоже на наложение, —
  // нарисованная вложенность. Это сторож против того самого ложного
  // срабатывания, из-за которого слой объявлял здоровую диаграмму сломанной.
  const overlaps = countBy(findings, 'geometry-shapes-overlap');
  assert(overlaps === 0,
    `на ${where} ${overlaps} «перекрытий», а все они — вложенность (компонент внутри класса)`);
  return `${where}: ${findings.length} замечаний, ложных перекрытий 0`;
});

await check('вложенность по владению не считается наложением', async () => {
  // Контрольная фикстура движка правил: компонент внутри класса, класс внутри
  // компонента — обе пары принадлежат друг другу (`ownerId`). До правки моста
  // здесь было 2 замечания, то есть здоровый лист объявлялся сломанным.
  const control = JSON.parse(await readFile(
    path.join(ROOT, 'tests/data/rules/component-nested-in-class.ok.json'), 'utf8'));
  const got = geometryFindings(control, { notation: NOTATION, measure: (t) => textWidth(t) });
  const overlaps = countBy(got, 'geometry-shapes-overlap');
  assert(overlaps === 0, `на контрольной ${overlaps} перекрытий, а там законная вложенность`);
  assert(got.length === 0, `на контрольной ${got.length} замечаний, а лист здоровый`);
  return 'component-nested-in-class.ok.json: 0 замечаний';
});

await check('настоящее наложение найдено, вложенность рядом — нет', async () => {
  const fixture = JSON.parse(await readFile(
    path.join(ROOT, 'tests/data/geometry/overlap-unrelated.json'), 'utf8'));
  const got = geometryFindings(fixture, { notation: NOTATION, measure: (t) => textWidth(t) });
  const overlaps = got.filter((f) => f.ruleId === 'geometry-shapes-overlap');
  assert(overlaps.length === 1, `перекрытий ${overlaps.length}, а наложена ровно одна пара`);
  const targets = [...overlaps[0].targets].sort().join(',');
  assert(targets === 'e1,e2', `цели ${targets}, а наложены «Заказ» и «Клиент»`);
  assert(overlaps[0].diagramId === 'd1', `лист «${overlaps[0].diagramId}»`);
  assert(!overlaps.some((f) => f.targets.includes('e3')),
    'компонент «Оплата» внутри своего класса назван наложением');
  return `1 наложение (${targets}), вложенный component молчит`;
});

await check('measure учитывается: завышенная ширина даёт больше «имя не влезает»', async () => {
  const real = countBy(findings, 'geometry-text-does-not-fit');
  // 10 000 px — заведомо больше любой рамки модели: если бы мост мерил
  // приближением archify или игнорировал `measure`, число не изменилось бы.
  const huge = countBy(
    geometryFindings(model, { notation: NOTATION, measure: () => 10000 }),
    'geometry-text-does-not-fit',
  );
  assert(huge > real, `с huge ${huge}, с настоящим textWidth ${real}`);
  assert(huge > 0, 'с огромной шириной не нашлось ни одного имени шире рамки');
  return `textWidth → ${real}, 10000 px → ${huge}`;
});

/* ------------------------------------------------ страж подключения */

await check('панель подключена: вызов моста, раздел, чип', async () => {
  const src = await readFile(path.join(ROOT, 'src/ui/checks.js'), 'utf8');
  const missing = ['geometryFindings(', 'checks-geometry', 'chip-geometry', 'showGeometry(']
    .filter((needle) => !src.includes(needle));
  assert(!missing.length, `в src/ui/checks.js нет: ${missing.join(', ')}`);
  // Вызов должен быть с настоящей нотацией и настоящим измерением: без них
  // проверка шумит на здоровых листах (см. README archify, «Калибровка»).
  const wired = /geometryFindings\(store\.model[\s\S]{0,120}notation:\s*NOTATION[\s\S]{0,120}measure:/.test(src);
  assert(wired, 'вызов geometryFindings без { notation: NOTATION, measure }');
  return 'geometryFindings(store.model, { notation: NOTATION, measure }), checks-geometry, chip-geometry';
});

/* ---------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);