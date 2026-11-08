// Проверка словаря фигур: наш лист нотации против реестра оригинала.
//
// app/notation/shape-types.json — это таблица из 834 типов фигур, снятая с
// v.mm#initDiagramElementClassTable()V (vpplatform.jar) в Deep mode. Здесь
// проверяется, что файл цел, что он снят с того самого jar и что каждый тип,
// который рисует наша сборка, в этой таблице есть и ведёт к тому классу
// модели, который записан в MECHANICS.md §15.
//
//   node tests/shape-types.mjs
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Локальная проверка необязательна: если JAR нет, шаг пропускается.
const JAR = path.join(process.env.HOME ?? '', 'Visual_Paradigm_CE_17.3', 'lib', 'vpplatform.jar');
// Строки MECHANICS.md §15: тип фигуры → класс модели. Если реестр в
// shape-types.json разойдётся с этой таблицей, значит либо файл подменили,
// либо в MECHANICS.md записано не то, что в коде.
const CORE = {
  Class: 'v.cnk.vd',
  InterfaceClass: 'v.cnk.abf',
  Enumeration: 'v.cnk.zf',
  Package: 'v.cnk.acw',
  NOTE: 'v.cnk.ach',
  Association: 'v.cmq.cu',
  Dependency: 'v.cmq.eh',
  Generalization: 'v.cmq.eu',
  Realization: 'v.cmq.gf',
};
// Шесть наших фигур, которых в реестре нет вовсе: оригинал держит их не
// отдельным типом (SystemBoundary — примитив, Profile/Metaclass — стереотип
// пакета/класса, Object/CollaborationUse/InteractionUse — вариант другого типа).
const NOT_REGISTERED = ['profile', 'object', 'collaborationUse', 'metaclass', 'systemBoundary', 'interactionUse'];

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const sheet = JSON.parse(await readFile(path.join(ROOT, 'notation/shape-types.json'), 'utf8'));
const notation = JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8'));

check('schema is vp-shape-types/1', sheet.schema === 'vp-shape-types/1', sheet.schema);
check('834 types registered', Object.keys(sheet.types).length === 834,
  String(Object.keys(sheet.types).length));
check('source names the method', sheet.source.class === 'v.mm'
  && sheet.source.method === 'initDiagramElementClassTable()V');

if (existsSync(JAR)) {
  const digest = createHash('sha256').update(await readFile(JAR)).digest('hex');
  check('read from this jar', digest === sheet.source.sha256, digest.slice(0, 16));
} else {
  check('jar present to compare', true, 'skipped: the install is not on this machine');
}

for (const [type, model] of Object.entries(CORE)) {
  const row = sheet.types[type];
  check(`${type} → ${model}`, Boolean(row) && row.model === model, row ? row.model : 'missing');
}

const unknown = Object.entries(sheet.buildKinds).filter(([, vp]) => !sheet.types[vp]);
check('every drawn kind resolves in the registry', unknown.length === 0,
  unknown.map(([k, vp]) => `${k}→${vp}`).join(', '));

const kinds = Object.keys(notation.shapes);
check('every shape is mapped or listed as not registered',
  kinds.every((k) => k in sheet.buildKinds || NOT_REGISTERED.includes(k)),
  kinds.filter((k) => !(k in sheet.buildKinds) && !NOT_REGISTERED.includes(k)).join(', '));
for (const k of NOT_REGISTERED) {
  check(`${k} is still absent from the registry`, !(sheet.buildKinds[k] in sheet.types),
    sheet.buildKinds[k] ?? 'unmapped');
}
check('the mapped kinds are a subset of the notation', Object.keys(sheet.buildKinds)
  .every((k) => kinds.includes(k)));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} проверок прошло`);
process.exit(failed ? 1 : 0);
