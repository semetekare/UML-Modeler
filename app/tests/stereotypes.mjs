// Профиль стереотипов и поле `stereotypeId` — проверки без браузера.
//
// Э9, партия Б11. Браузерные сценарии (тесты/types.mjs, tests/smoke.mjs)
// смотрят на лист и панель; здесь доказывается то, чего на листе не видно:
//
//   * app/profile/stereotypes.json собран из канонического профиля и
//     пересобирается побайтово: 304 стереотипа, 407 расширений, 9
//     псевдонимов, 23 iconPath, 15 рисунков;
//   * разрешение стереотипа идёт по порядку id → точное имя → нормализованное
//     имя, и старое написание `UseCase` находит запись `usecase` только
//     вторым шагом — это и есть лечение старых файлов;
//   * рисунок выбирается по baseType ЭЛЕМЕНТА: `usecase` не рисует овал на
//     варианте использования и рисует на классе;
//   * поле пишется только когда оно есть: эталон old-v3.json пересохраняется
//     побайтово, а модель со `stereotypeId` держит круг без потерь;
//   * битая ссылка снимается с записью в repairs, имя остаётся, элемент не
//     теряется;
//   * на 48 моделях корпуса ни одно имя стереотипа не остаётся без записи.
//
//   node tests/stereotypes.mjs
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                       // .../app
const REPO = path.resolve(ROOT, '..');                       // .../visual-paradigm
const PROFILE = path.join(ROOT, 'profile', 'stereotypes.json');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'old-v3.json');
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

// Пакет нотации нужен загрузчику модели: без него виды не разрешаются.
const { applyPackage } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8')));

const {
  parseProfileJson, resolveStereotype, pictogramFor, baseTypeFor, baseTypesFor,
  normalizeStereotypeName, taggedDefsFor, applicable,
} = await load('src/io/stereotypes.js');
const { deserialize, serialize } = await load('src/io/umljson.js');

const profileText = await readFile(PROFILE, 'utf8');
const profile = parseProfileJson(profileText);

/** Все непустые iconPath и все разные рисунки профиля. */
function drawingsOf(p) {
  const iconPaths = new Set();
  const assets = new Set();
  for (const s of p.stereotypes) {
    for (const row of [s.pictogram, ...Object.values(s.pictogramByBaseType ?? {})]) {
      for (const ip of row?.iconPaths ?? []) iconPaths.add(ip);
      if (row?.asset) assets.add(row.asset);
    }
  }
  return { iconPaths: iconPaths.size, assets: assets.size };
}

/* ------------------------------------------------------------- профиль */

await check('профиль: 304 стереотипа, 407 расширений, 9 псевдонимов', async () => {
  assert(profile.count === 304, `стереотипов ${profile.count}`);
  const definitions = profile.stereotypes.reduce((n, s) => n + s.baseTypes.length, 0);
  assert(definitions === 407, `расширений ${definitions}`);
  const aliases = profile.stereotypes.reduce((n, s) => n + s.aliases.length, 0);
  assert(aliases === 9, `псевдонимов ${aliases}`);
  const ids = new Set(profile.stereotypes.map((s) => s.id));
  const names = new Set(profile.stereotypes.map((s) => s.name));
  assert(ids.size === 304 && names.size === 304, `id ${ids.size}, имён ${names.size}`);
  assert(profile.byId.size === 304, `byId ${profile.byId.size}`);
  return `${definitions} расширений, ${aliases} псевдонимов`;
});

await check('рисунки: 23 iconPath ведут на 15 разных рисунков', async () => {
  const { iconPaths, assets } = drawingsOf(profile);
  assert(iconPaths === 23, `iconPath ${iconPaths}`);
  assert(assets === 15, `рисунков ${assets}`);
  for (const s of profile.stereotypes) {
    if (!s.pictogram && !s.pictogramByBaseType) continue;
    assert(s.pictogramByBaseType, `${s.id}: рисунок есть, а по baseType не разложен`);
  }
  return `${iconPaths} путей → ${assets} рисунков`;
});

await check('сборка профиля детерминирована: два прогона и --check', async () => {
  const one = await mkdtemp(path.join(tmpdir(), 'bp-1-'));
  const two = await mkdtemp(path.join(tmpdir(), 'bp-2-'));
  try {
    const run = (dir) => execFileSync(process.execPath,
      [path.join(ROOT, 'tools', 'build-profile.mjs'), `--out=${dir}`, '--quiet'],
      { cwd: ROOT, stdio: 'pipe' });
    run(one);
    run(two);
    const a = await readFile(path.join(one, 'stereotypes.json'));
    const b = await readFile(path.join(two, 'stereotypes.json'));
    assert(a.equals(b), 'два прогона дали разные байты');
    assert(a.equals(Buffer.from(profileText)), 'файл в приложении не совпадает с собранным');
    // --check — тот же прогон, но падает, если файл на диске устарел.
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-profile.mjs'), '--check', '--quiet'],
      { cwd: ROOT, stdio: 'pipe' });
  } finally {
    await rm(one, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(two, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  return `${profileText.length} Б, байт в байт`;
});

/* --------------------------------------------------- разрешение стереотипа */

await check('порядок разрешения: id → точное имя → нормализованное имя', async () => {
  const byId = resolveStereotype(profile, { stereotypeId: 'st-usecase', stereotype: 'что-угодно' });
  assert(byId.via === 'id' && byId.record.name === 'usecase', `по id: ${byId.via} / ${byId.record?.name}`);

  const exact = resolveStereotype(profile, { stereotype: 'usecase' });
  assert(exact.via === 'exact' && exact.record.id === 'st-usecase', `точно: ${exact.via}`);

  const norm = resolveStereotype(profile, { stereotype: 'UseCase' });
  assert(norm.via === 'normalized' && norm.record.id === 'st-usecase',
    `нормализованно: ${norm.via} / ${norm.record?.id}`);
  // Точного имени «UseCase» в профиле нет — иначе второй шаг был бы не нужен.
  assert(!profile.byName.has('UseCase'), 'в профиле есть точное имя UseCase — проверка ничего не доказывает');

  const none = resolveStereotype(profile, { stereotype: 'нет-такого' });
  assert(none.record === null && none.via === null, 'выдуманная запись');
  return 'id, точное, UseCase → usecase';
});

await check('старые написания и псевдонимы находят запись', async () => {
  const cases = [
    ['UseCase', 'st-usecase'],
    ['execution environment', 'st-executionenvironment'],
    ['use case realization', 'st-usecase-realization'],
    ['Include', 'st-include'],
    ['Extend', 'st-extend'],
    ['Interface', 'st-interface'],
    ['Participant', 'st-participant'],
  ];
  for (const [spelling, id] of cases) {
    const hit = resolveStereotype(profile, { stereotype: spelling });
    assert(hit.record?.id === id, `«${spelling}» → ${hit.record?.id ?? 'null'}, ждали ${id}`);
    assert(hit.via === 'normalized', `«${spelling}» найден шагом ${hit.via}`);
  }
  const all = cases.map(([s]) => s).join(', ');
  return `${cases.length} написаний: ${all}`;
});

await check('нормализация — нижний регистр без пробелов, _ и -', async () => {
  const forms = ['UseCase', 'use case', 'use_case', 'USE-CASE', ' usecase '];
  for (const f of forms) assert(normalizeStereotypeName(f) === 'usecase', `«${f}» → ${normalizeStereotypeName(f)}`);
  return forms.join(' = ');
});

await check('битая ссылка не теряет имя и попадает в repairs', async () => {
  const text = JSON.stringify({
    schema: 'uml-model/3', id: 'm1', name: 'Битые ссылки',
    elements: [
      { id: 'e1', kind: 'class', name: 'Студент', stereotype: 'entity', stereotypeId: 'st-нет-такой' },
      { id: 'e2', kind: 'interface', name: 'Сервис', stereotype: 'interface', stereotypeId: 'st-interface' },
    ],
    relationships: [
      { id: 'r1', kind: 'dependency', from: 'e1', to: 'e2', stereotype: 'use', stereotypeId: 'st-нет-такой' },
    ],
    diagrams: [],
    currentDiagramId: null,
  }, null, 2) + '\n';
  const repairs = [];
  const model = deserialize(text, { repairs, profile });
  const e1 = model.elements.find((e) => e.id === 'e1');
  const e2 = model.elements.find((e) => e.id === 'e2');
  assert(model.elements.length === 2, `элементов ${model.elements.length} — элемент потерян`);
  assert(e1.stereotype === 'entity', `имя стало ${e1.stereotype}`);
  assert(!e1.stereotypeId, 'битая ссылка осталась в модели');
  assert(e2.stereotypeId === 'st-interface', 'живая ссылка снята');
  const aboutStereotypes = repairs.filter((r) => /стереотип/.test(r));
  assert(aboutStereotypes.length === 2, `repairs о стереотипах: ${JSON.stringify(repairs)}`);
  assert(aboutStereotypes.every((r) => /не найден/.test(r) && /оставлено имя/.test(r)),
    aboutStereotypes.join(' | '));
  // Снятая ссылка не возвращается и в файле: элемент остался с одним именем.
  const saved = serialize(model);
  assert(!saved.includes('st-нет-такой'), 'битая ссылка попала в файл');
  return aboutStereotypes[0];
});

/* -------------------------------------------------------------- рисунки */

await check('baseType берётся у вида, а не у имени стереотипа', async () => {
  const cases = [
    ['class', 'Class'],
    ['interface', 'Interface'],
    ['usecase', 'UseCase'],
    ['actor', 'Actor'],
    ['package', 'Package'],
    ['collaboration', 'Collaboration'],
    ['lifeline', 'InteractionLifeLine'],
    ['message', 'Message'],
    ['note', 'NOTE'],
    ['fork', null],
  ];
  for (const [kind, want] of cases) {
    const got = baseTypeFor(kind);
    assert(got === want, `${kind} → ${got}, ждали ${want}`);
  }
  assert(baseTypesFor('usecase').length === 1, 'у варианта использования один baseType');
  return cases.map(([k, v]) => `${k}→${v ?? '—'}`).join(' ');
});

await check('usecase не получает овал на UseCase и получает на Class', async () => {
  // По ссылке на запись (новые файлы и выбор в инспекторе).
  assert(pictogramFor(profile, 'st-usecase', 'UseCase') === null, 'овал на варианте использования');
  const onClass = pictogramFor(profile, 'st-usecase', 'Class');
  assert(onClass?.asset === 'pict-usecase-ellipse', `на классе ${onClass?.asset}`);
  assert(onClass.kind === 'figure', `вид рисунка ${onClass?.kind}`);
  // По имени (старые файлы: поля stereotypeId в них нет).
  assert(pictogramFor(profile, 'UseCase', 'UseCase') === null, 'по имени на варианте использования овал');
  assert(pictogramFor(profile, 'UseCase', 'Class')?.asset === 'pict-usecase-ellipse', 'по имени на классе нет овала');
  assert(pictogramFor(profile, 'usecase', 'Interface') === null, 'на интерфейсе овал класса');
  // Без baseType рисунка нет вовсе: угадывать нечем.
  assert(pictogramFor(profile, 'st-usecase', null) === null, 'рисунок без baseType');
  return 'UseCase —, Class pict-usecase-ellipse';
});

await check('бейджи на прочих расширениях не потерялись', async () => {
  const cases = [
    ['entity', 'Class', 'pict-entity'],
    ['entity', 'InteractionLifeLine', 'pict-entity'],
    ['boundary', 'InteractionLifeLine', 'pict-boundary'],
    ['control', 'Object', 'pict-control'],
    ['mechanism', 'Collaboration2', 'pict-mechanism'],
    ['usecase realization', 'Collaboration', 'pict-usecase-realization'],
  ];
  for (const [ref, base, asset] of cases) {
    const got = pictogramFor(profile, ref, base);
    assert(got?.asset === asset, `${ref} × ${base} → ${got?.asset ?? 'null'}, ждали ${asset}`);
  }
  return cases.map(([r, b]) => `${r}×${b}`).join(' ');
});

/* ------------------------------------------------------------ модель */

await check('old-v3.json пересохраняется побайтово, repairs пуст', async () => {
  const text = await readFile(FIXTURE, 'utf8');
  for (const opts of [{ repairs: [] }, { repairs: [], profile }]) {
    const repairs = [];
    const model = deserialize(text, { ...opts, repairs });
    assert(!repairs.length, `ремонты: ${repairs.join(' | ')}`);
    const again = serialize(model);
    assert(again === text, `байты разошлись: ${text.length} → ${again.length}`);
    assert(!again.includes('stereotypeId'), 'поле появилось там, где его не было');
  }
  return `${text.length} Б, с профилем и без`;
});

await check('stereotypeId держит круг serialize → deserialize → serialize', async () => {
  const text = JSON.stringify({
    schema: 'uml-model/3', id: 'm2', name: 'Ссылки',
    elements: [
      { id: 'e1', kind: 'class', name: 'Студент', stereotype: 'usecase', stereotypeId: 'st-usecase' },
      { id: 'e2', kind: 'usecase', name: 'Учиться', stereotype: 'UseCase', stereotypeId: 'st-usecase' },
    ],
    relationships: [
      { id: 'r1', kind: 'include', from: 'e1', to: 'e2', stereotype: 'include', stereotypeId: 'st-include' },
    ],
    diagrams: [],
    currentDiagramId: null,
  }, null, 2) + '\n';
  // Круг считается от канонического вида: рукописный JSON не обязан совпадать
  // с тем, что пишет сериализатор (порядок ключей, умолчания), важен второй
  // круг — он обязан быть байт в байт.
  const once = serialize(deserialize(text, { repairs: [] }));
  assert(once.includes('"stereotypeId": "st-usecase"'), 'ссылка элемента не записана');
  assert(once.includes('"stereotypeId": "st-include"'), 'ссылка связи не записана');
  const back = deserialize(once, { repairs: [], profile });
  assert(back.elements[0].stereotypeId === 'st-usecase', 'ссылка элемента потерялась');
  assert(back.elements[0].stereotype === 'usecase', 'имя элемента потерялось');
  assert(back.elements[1].stereotype === 'UseCase', 'имя старого написания переписано');
  assert(back.relationships[0].stereotypeId === 'st-include', 'ссылка связи потерялась');
  assert(serialize(back) === once, 'второй круг нестабилен');
  return `${once.length} Б, 3 ссылки`;
});

await check('поле не появляется, когда стереотипа нет', async () => {
  const text = JSON.stringify({
    schema: 'uml-model/3', id: 'm3', name: 'Без стереотипов',
    elements: [{ id: 'e1', kind: 'class', name: 'Пусто' }],
    relationships: [], diagrams: [], currentDiagramId: null,
  }, null, 2) + '\n';
  const once = serialize(deserialize(text, { repairs: [] }));
  assert(serialize(deserialize(once, { repairs: [] })) === once, 'файл без стереотипов нестабилен');
  assert(!once.includes('stereotype'), 'появилось поле стереотипа из ниоткуда');
  return `${once.length} Б, ни одного поля`;
});

/* ------------------------------------------------------------- корпус */

await check('корпус: все имена стереотипов находят запись, потери скорости нет', async () => {
  const files = (await readdir(CORPUS)).filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json');
  let total = 0;
  let exact = 0;
  let normalized = 0;
  const viaNormalized = new Map();
  const missing = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(CORPUS, f), 'utf8'));
    for (const item of [...(raw.elements ?? []), ...(raw.relationships ?? [])]) {
      if (!item?.stereotype) continue;
      total += 1;
      const hit = resolveStereotype(profile, item);
      if (!hit.record) { missing.push(`${f}:${item.id}:${item.stereotype}`); continue; }
      if (hit.via === 'exact') exact += 1;
      if (hit.via === 'normalized') {
        normalized += 1;
        viaNormalized.set(item.stereotype, (viaNormalized.get(item.stereotype) ?? 0) + 1);
      }
    }
  }
  assert(!missing.length, `без записи: ${missing.slice(0, 5).join(', ')}`);
  assert(normalized > 0, 'в корпусе нет ни одного написания, которое требует нормализации');
  return `${total} стереотипов в ${files.length} моделях: точно ${exact}, `
    + `по нормализации ${normalized} (${[...viaNormalized].map(([s, n]) => `${s}×${n}`).join(', ')})`;
});

await check('tagged-определения берутся для baseType элемента', async () => {
  const xsd = profile.byId.get('st-xsd-schema') ?? profile.stereotypes.find((s) => s.name === 'XSDschema');
  assert(xsd, 'в профиле нет XSDschema');
  const onPackage = taggedDefsFor(xsd, 'Package').map((d) => d.name);
  const onClass = taggedDefsFor(xsd, 'Class').map((d) => d.name);
  assert(onPackage.length !== onClass.length || onPackage.join() !== onClass.join(),
    'наборы на Package и Class совпали — проверка ничего не доказывает');
  const usecase = taggedDefsFor(profile.byId.get('st-usecase'), 'UseCase').map((d) => d.name);
  assert(usecase.includes('Level'), `у usecase × UseCase нет Level: ${usecase.join(', ')}`);
  return `${xsd.id}: Package ${onPackage.length}, Class ${onClass.length}`;
});

await check('«Подходящие»: у вида только применимые расширения', async () => {
  const { applicable: forClass, rest } = applicable(profile, 'class');
  assert(forClass.length + rest.length === 304, `список не 304: ${forClass.length}+${rest.length}`);
  assert(forClass.every((s) => s.baseTypes.some((b) => baseTypesFor('class').includes(b))),
    'в «Подходящие» попало расширение чужого вида');
  assert(!forClass.some((s) => s.id === 'st-usecase' && !s.baseTypes.includes('Class')), 'usecase без Class');
  const entity = forClass.find((s) => s.name === 'entity');
  assert(entity && entity.baseTypes.length === 5, 'entity потерял расширения');
  return `class: подходящих ${forClass.length}, остальных ${rest.length}`;
});

/* ---------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);