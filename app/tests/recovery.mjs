// Чтение оборванного файла модели и экспорт всего проекта — проверки без
// браузера.
//
//   node tests/recovery.mjs
//
// Пять случаев чтения (полный, обрыв в объекте, в массиве, в строке, вовсе
// не JSON), предел 32 МБ, эталон old-v3.json побайтово и круг «экспорт всего
// проекта → открыть → экспорт» побайтово. Всё это — чистые функции
// io/umljson.js и io/json-repair.js; лист и меню проверяют браузерные
// наборы, здесь их нет.
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                        // .../app
const REPO = path.resolve(ROOT, '..');                        // .../visual-paradigm
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'old-v3.json');
const PROFILE = path.join(ROOT, 'profile', 'stereotypes.json');
const CORPUS = path.join(REPO, 'tests', 'corpus');

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

// Пакет нотации нужен читателю: без него виды не разрешаются.
const { applyPackage } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation', 'uml.json'), 'utf8')));

const { deserialize, serialize, serializeProject, usedStereotypes } = await load('src/io/umljson.js');
const { parseJsonText, commitPoints, MAX_REPAIR_BYTES } = await load('src/io/json-repair.js');
const { parseProfileJson } = await load('src/io/stereotypes.js');

const profile = parseProfileJson(await readFile(PROFILE, 'utf8'));

/* --------------------------------------------------------- образцы */

/**
 * Модель с двумя диаграммами, связью и стереотипом — на ней видно и
 * восстановление, и экспорт проекта. Собрана вручную, а не из образца
 * приложения: тесту нужны известные id.
 */
const MODEL = {
  schema: 'uml-model/3',
  id: 'm-test',
  name: 'Проект проверки',
  created: '2026-11-06',
  revised: '2026-11-06',
  elements: [
    { id: 'e1', kind: 'class', name: 'Заказ', stereotype: 'entity', stereotypeId: 'st-entity' },
    { id: 'e2', kind: 'class', name: 'Клиент' },
    { id: 'e3', kind: 'usecase', name: 'Оформить' },
  ],
  relationships: [
    { id: 'r1', kind: 'association', from: 'e2', to: 'e1' },
    { id: 'r2', kind: 'include', from: 'e3', to: 'e3' },
  ],
  diagrams: [
    {
      id: 'd1', name: 'Классы', kind: 'class',
      shapes: [
        { id: 's1', elementId: 'e1', x: 40, y: 40, w: 190, h: 120 },
        { id: 's2', elementId: 'e2', x: 320, y: 40, w: 190, h: 120 },
      ],
      links: [{ id: 'l1', relId: 'r1', from: { shapeId: 's1' }, to: { shapeId: 's2' } }],
    },
    { id: 'd2', name: 'Варианты', kind: 'usecase', shapes: [], links: [] },
  ],
  currentDiagramId: 'd1',
};
const MODEL_TEXT = JSON.stringify(MODEL, null, 2) + '\n';

/** Позиция подстроки в тексте файла — по ней режем образцы. */
const at = (text, needle) => {
  const i = text.indexOf(needle);
  assert(i >= 0, `в образце нет «${needle}»`);
  return i;
};

/* ------------------------------------------------- 1. полный файл */

await check('полный файл: читается как раньше, repairs пуст', async () => {
  const repairs = [];
  const meta = {};
  const model = deserialize(MODEL_TEXT, { repairs, meta });
  assert(repairs.length === 0, `repairs не пуст: ${repairs.join(' | ')}`);
  assert(meta.kind === 'model', `kind=${meta.kind}`);
  assert(meta.truncated === null, 'отмечен обрыв у целого файла');
  assert(model.elements.length === 3, `элементов ${model.elements.length}`);
  assert(model.diagrams.length === 2, `диаграмм ${model.diagrams.length}`);
  // образец написан руками, поэтому сверяем круг на каноническом тексте
  const canon = serialize(model);
  assert(serialize(deserialize(canon, { profile })) === canon, 'пересохранение не совпало побайтово');
  return `${model.elements.length} элемента, ${model.diagrams.length} диаграммы, 0 ремонтов`;
});

await check('эталон old-v3.json пересохраняется побайтово, repairs пуст', async () => {
  const text = await readFile(FIXTURE, 'utf8');
  const before = createHash('md5').update(text, 'utf8').digest('hex');
  const repairs = [];
  const model = deserialize(text, { repairs, profile });
  const after = createHash('md5').update(serialize(model), 'utf8').digest('hex');
  assert(repairs.length === 0, `repairs не пуст: ${repairs.join(' | ')}`);
  assert(after === before, `md5 ${after} ≠ ${before}`);
  assert(Buffer.byteLength(text, 'utf8') === 4611, `размер ${Buffer.byteLength(text, 'utf8')} Б`);
  return `${Buffer.byteLength(text, 'utf8')} Б, md5 ${before.slice(0, 8)}…`;
});

/* --------------------------------------------- 2. обрыв в объекте */

await check('обрыв в объекте: восстановлен, позиция и число названы', async () => {
  // режем внутри второго элемента — «{"id":"e2","kind":"class","na»
  const cut = at(MODEL_TEXT, '"name": "Клиент"') + 8;
  const text = MODEL_TEXT.slice(0, cut);
  const repairs = [];
  const meta = {};
  const model = deserialize(text, { repairs, meta });
  assert(meta.truncated, 'meta.truncated пуст');
  assert(meta.truncated.position === cut, `позиция ${meta.truncated.position} ≠ ${cut}`);
  const line = repairs.find((r) => r.includes('обрезан на позиции'));
  assert(line, `нет строки об обрыве: ${repairs.join(' | ')}`);
  assert(line.includes(`позиции ${cut}`), `в строке нет позиции ${cut}: ${line}`);
  assert(model.elements.length === 2, `элементов ${model.elements.length}, ждали 2`);
  assert(line.includes('2 элемента'), `в строке нет «2 элемента»: ${line}`);
  assert(model.elements[1].name === '', 'оборванное имя не отрезано');
  return line;
});

/* ---------------------------------------------- 3. обрыв в массиве */

await check('обрыв в массиве: восстановлен, своя строка ремонта', async () => {
  // режем внутри массива shapes первой диаграммы — посреди id второй фигуры
  const cut = at(MODEL_TEXT, '"id": "s2"') + 8;
  const text = MODEL_TEXT.slice(0, cut);
  const repairs = [];
  const meta = {};
  const model = deserialize(text, { repairs, meta });
  const line = repairs.find((r) => r.includes('обрезан на позиции'));
  assert(line, `нет строки об обрыве: ${repairs.join(' | ')}`);
  assert(meta.truncated.position === cut, `позиция ${meta.truncated.position} ≠ ${cut}`);
  assert(model.elements.length === 3, `элементов ${model.elements.length}, ждали 3`);
  assert(model.diagrams[0].shapes.length === 1, `фигур ${model.diagrams[0].shapes.length}, ждали 1`);
  assert(model.diagrams.length === 1, `диаграмм ${model.diagrams.length}, ждали 1 (вторая отрезана)`);
  return line;
});

/* ----------------------------------------------- 4. обрыв в строке */

await check('обрыв в строке: строка не дочитывается, остальное цело', async () => {
  // режем посреди имени элемента: «"name": "Кли»
  const cut = at(MODEL_TEXT, '"name": "Клиент"') + 12;
  const text = MODEL_TEXT.slice(0, cut);
  const repairs = [];
  const model = deserialize(text, { repairs });
  const line = repairs.find((r) => r.includes('обрезан на позиции'));
  assert(line, `нет строки об обрыве: ${repairs.join(' | ')}`);
  assert(model.elements.length === 2, `элементов ${model.elements.length}, ждали 2`);
  assert(model.elements[0].name === 'Заказ', 'первый элемент потерян');
  assert(model.elements[1].name === '', `оборванное имя «${model.elements[1].name}»`);
  assert(serialize(model).length > 0, 'модель не пересохраняется');
  return line;
});

/* --------------------------------------------------- 5. вовсе не JSON */

await check('не JSON (<html>): внятная ошибка с позицией, без стека', async () => {
  const text = '<html><head><title>404</title></head><body>Not found</body></html>';
  let error = null;
  try { deserialize(text); } catch (e) { error = e; }
  assert(error, 'исключения не было');
  assert(/не JSON/i.test(error.message), `не сказано, что это не JSON: ${error.message}`);
  assert(/позиция 0/.test(error.message), `нет позиции: ${error.message}`);
  assert(!/\n\s+at /.test(error.message), 'в сообщении стек');
  assert(error.message.length < 400, `слишком длинное сообщение: ${error.message.length}`);
  return error.message;
});

await check('обрыв в самом начале: сказано, что восстанавливать не из чего', async () => {
  // уцелел кусок без schema: «{"a":1,"schema":» → восстановлено «{"a":1}»
  const text = '{"a":1,"schema":';
  let error = null;
  try { deserialize(text); } catch (e) { error = e; }
  assert(error, 'исключения не было');
  assert(/обрезан на позиции/.test(error.message), `нет позиции обрыва: ${error.message}`);
  assert(/восстанавливать не из чего/.test(error.message), `нет объяснения: ${error.message}`);
  assert(/schema/.test(error.message), `не сказано, чего не хватило: ${error.message}`);
  return error.message;
});

/* ------------------------------------------------------- 6. 32 МБ */

await check('файл больше 32 МБ: отказ «слишком большой», без попытки чинить', async () => {
  assert(MAX_REPAIR_BYTES === 32 * 1024 * 1024, `предел ${MAX_REPAIR_BYTES}`);
  // 33 МБ латиницы = 33 МБ в UTF-8; разбор падает на первом символе.
  const text = `{"schema":"uml-model/3","name":"${'x'.repeat(33 * 1024 * 1024)}`;
  let error = null;
  const started = Date.now();
  try { parseJsonText(text); } catch (e) { error = e; }
  const ms = Date.now() - started;
  assert(error, 'исключения не было');
  assert(/слишком большой/.test(error.message), `нет слова «слишком большой»: ${error.message}`);
  assert(ms < 4000, `отказ занял ${ms} мс — похоже, файл всё-таки чинили`);
  return `${ms} мс, ${error.message.slice(0, 60)}…`;
});

/* --------------------------------------------- 7. экспорт проекта */

await check('экспорт проекта: kind, все диаграммы, связи, использованные стереотипы', async () => {
  const model = deserialize(MODEL_TEXT, { profile });
  const text = serializeProject(model, profile);
  const raw = JSON.parse(text);
  assert(raw.kind === 'project', `kind=${raw.kind}`);
  assert(raw.schema === 'uml-model/3', `schema=${raw.schema}`);
  assert(raw.diagrams.length === 2, `диаграмм ${raw.diagrams.length}`);
  assert(raw.elements.length === 3, `элементов ${raw.elements.length}`);
  assert(raw.relationships.length === 2, `связей ${raw.relationships.length}`);
  assert(Array.isArray(raw.stereotypes), 'нет списка стереотипов');
  assert(raw.stereotypes.length === 1 && raw.stereotypes[0].id === 'st-entity',
    `стереотипы: ${JSON.stringify(raw.stereotypes)}`);
  assert(raw.stereotypes[0].name === 'entity', `имя стереотипа ${raw.stereotypes[0].name}`);
  // обычное сохранение метки проекта не носит
  const plain = JSON.parse(serialize(model));
  assert(plain.kind === undefined && plain.stereotypes === undefined,
    'метка проекта утекла в обычное сохранение');
  return `1 файл: ${raw.diagrams.length} диаграммы, ${raw.elements.length} элемента, `
    + `${raw.relationships.length} связи, ${raw.stereotypes.length} стереотип`;
});

await check('круг «экспорт всего → открыть → экспорт» совпадает побайтово', async () => {
  const before = deserialize(MODEL_TEXT, { profile });
  const first = serializeProject(before, profile);
  const repairs = [];
  const meta = {};
  const opened = deserialize(first, { repairs, profile, meta });
  assert(repairs.length === 0, `при открытии проекта ремонты: ${repairs.join(' | ')}`);
  assert(meta.kind === 'project', `kind после открытия ${meta.kind}`);
  assert(opened.diagrams.length === 2, `диаграмм ${opened.diagrams.length}`);
  assert(opened.diagrams[1].name === 'Варианты', 'вторая диаграмма потерялась');
  assert(opened.currentDiagramId === 'd1', `текущая ${opened.currentDiagramId}`);
  const second = serializeProject(opened, profile);
  assert(second === first, 'байты круга разошлись');
  return `${first.length} Б туда и обратно`;
});

await check('открытие проекта без профиля: стереотипы по имени, круг тот же', async () => {
  const before = deserialize(MODEL_TEXT, { profile });
  const first = serializeProject(before, profile);
  const opened = deserialize(first, {});
  const second = serializeProject(opened, profile);
  assert(second === first, 'без профиля круг разошёлся');
  return `${usedStereotypes(opened, profile).length} стереотип по имени`;
});

await check('обычное сохранение одной диаграммы не изменилось', async () => {
  const model = deserialize(MODEL_TEXT, { profile });
  const text = serialize(model);
  assert(JSON.parse(text).kind === undefined, 'в обычном файле появился kind');
  const back = deserialize(text, { profile });
  assert(serialize(back) === text, 'обычное сохранение перестало быть круговым');
  return `${text.length} Б`;
});

await check('сканер точек обрыва: скобки внутри строк не считаются', async () => {
  const text = '{"a":"}][{","b":[1,2';
  const points = commitPoints(text);
  assert(points.length > 0, 'точек нет');
  const last = points[points.length - 1];
  assert(last.at === text.length && last.close === ']}', `${last.at} ${last.close}`);
  // «}» внутри строки не закрыл объект: иначе close был бы пустым
  const quoted = points.find((p) => p.at === text.indexOf('","b"') + 1);
  assert(!quoted || quoted.close === '}', 'скобка из строки принята за структуру');
  return `${points.length} точек`;
});

await check('корпус: девять обрезок на каждой модели — восстановлено или отказано внятно', async () => {
  const files = (await readdir(CORPUS)).filter((f) => f.endsWith('.json'));
  assert(files.length >= 48, `в корпусе ${files.length} моделей`);
  const cuts = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97, 0.995];
  let recovered = 0;
  let refused = 0;
  const bad = [];
  for (const file of files) {
    const text = await readFile(path.join(CORPUS, file), 'utf8');
    for (const fraction of cuts) {
      const cut = text.slice(0, Math.max(1, Math.floor(text.length * fraction)));
      try {
        const model = deserialize(cut, { repairs: [] });
        // восстановленное обязано быть круговым: иначе это не спасение, а порча
        const once = serialize(model);
        if (serialize(deserialize(once, {})) !== once) bad.push(`${file}@${fraction}: круг`);
        recovered += 1;
      } catch (e) {
        if (!/позици|обрезан|нечего|schema|моделью UML|пуст|слишком большой/i.test(e.message)) {
          bad.push(`${file}@${fraction}: ${e.message.slice(0, 60)}`);
        }
        refused += 1;
      }
    }
  }
  assert(!bad.length, `плохих случаев ${bad.length}: ${bad.slice(0, 3).join('; ')}`);
  return `${files.length} моделей × ${cuts.length} обрезок: восстановлено ${recovered}, отказано внятно ${refused}`;
});

/* ---------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);
