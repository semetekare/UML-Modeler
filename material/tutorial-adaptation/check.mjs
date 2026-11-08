// Проверка адаптированного пособия. Только стандартная библиотека Node, ничего не пишет
// на диск: повторный запуск даёт тот же отчёт байт в байт.
//
//   node check.mjs            проверить и напечатать отчёт
//
// Что проверяется
//   1. Все 20 упражнений на месте, заголовки совпадают с исходником.
//   2. Все метки [[fig:…]] на месте, номера и подписи рисунков совпадают с исходником.
//   3. Абзацы предметной области (те, где нет слов про интерфейс) сохранены дословно.
//      Печатается доля сохранённого — общая и по упражнениям.
//   4. Каждая пометка "⚠ У нас нет" соответствует строке operations.json со status "нет",
//      и наоборот: у каждой такой строки есть пометка. Расхождений нет.
//
// Файлы берутся рядом со скриптом: uml-tutorial-our.md, operations.json, а исходник —
// ../../docs/uml-tutorial.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE = path.join(ROOT, 'docs', 'uml-tutorial.md');
const ADAPTED = path.join(HERE, 'uml-tutorial-our.md');
const OPS = path.join(HERE, 'operations.json');

/* --------------------------------------------------------------- словарь */

// Слова, которые встречаются только в описании интерфейса. Абзац с любым из них
// считается «про интерфейс» и дословного совпадения не требует — его можно переписать.
// Список намеренно не включает слова, живущие и в предметной области: «меню» (главное
// меню системы), «окно» (окно текстового редактора), «спецификация» (дополнительная
// спецификация), «связь», «класс», «атрибут».
const UI_WORDS = [
  // окна, панели, проводники
  'палитр', 'Проводник', 'Model Explorer', 'Diagram Navigator', 'Navigator',
  'Workspace', 'workspace', 'Project Browser', 'Panes', 'Application options',
  'Project Options', 'Diagramming', 'Presentation Options', 'Open Specification',
  'контекстн', 'Sub Diagram', 'вкладк', 'вкладок', 'двойн', 'перетаск',
  'флажок', 'галочк', 'кнопк', 'сочетани', 'Ctrl+', 'Shift+Del', 'Alt+', 'F2',
  // стереотипы и их профиль
  'стереотип', 'Stereotype', 'Tagged Value', 'Manage Stereotypes', 'Import',
  // элементы управления VP, названные латиницей
  '`->', 'Navigable', 'Qualifier', 'Abstract', 'Derived', 'Scope', 'Duplicate',
  'Merge to', 'Parent model', 'Interface Ball', 'Show Owner', 'Show Arrows',
  'Show From Role', 'Show To Role', 'Show Constraints', 'Show Relationships',
  'Show multiplicity', 'Show Name', 'Visualize Related', 'Create Getter',
  'Add Classifier', 'Add Operand', 'Instance Specification', 'Lifeline',
  'Combined Fragment', 'Operand', 'Interaction Use', 'Multi-object', 'Stopped',
  'Duration Message', 'Asynchronous', 'Lost Message', 'Vertical Swimlane',
  'Initial Node', 'Activity Final Node', 'Flow Final Node', 'Control Flow',
  'Decision Node', 'Merge Node', 'Call Behavior Action', 'Conditional Node',
  'Loop Node', 'Internal Transitions', 'Triggers', 'Add Horizontal Region',
  'FinalState', 'Refers to', 'Select Operation', 'Create Operation', 'Return Type',
  'Delete View Only', 'Delete -> ', 'Aggregation kind', 'Edit Role',
  'Generalization Set', 'Dashed Line', 'Template Parameters', 'Relations',
  'Binding', 'Represents', 'Diagram name', 'Operator Kind', 'Operator type',
  'Guard', 'Effect', 'Kind', 'Entry', 'Choice', 'Bold', 'Suppress',
  'Display as', 'Mark target', 'Caption Placement', 'Overwrite', 'Sleek', 'Xetro',
  '`Action`', '`Activity`', '`Class`', '`Association`', '`Generalization`',
  '`Dependency`', '`Realization`', '`Enumeration`', '`Use Case`', '`Actor`',
  '`System`', '`Package`', '`Collaboration`', '`Node`', '`Device`',
  '`Execution Environment`', '`Component`', '`Instance Specification`',
  '`Link`', '`Frame`', '`Subject`', '`Message`', '`Lifeline`',
  // файлы и среда VP
  '.vpp', '.xml', '.exe', 'stereotypes.xml', 'Community Edition',
  'Visual Paradigm', '16.3', '17.3', 'app/reference/vp163',
];

const isUI = (text) => {
  const low = text.toLowerCase();
  return UI_WORDS.some((w) => low.includes(w.toLowerCase()));
};

/* ---------------------------------------------------------------- разбор */

const FIG_SRC = /^\[Рис\. ([0-9][0-9.]*[a-z]?)\]\(\.\.\/app\/reference\/vp163\/([0-9]+[a-z]?)\.png\)$/;
const FIG_OUT = /^\[\[fig:([0-9]+[a-z]?)\|[^\]|]+\]\]$/;
const HEADING = /^#{1,6} /;
const CAPTION = /^\*Рис\. /;
const MARKER_PREFIX = '> ⚠ У нас нет: ';

const sourceText = fs.readFileSync(SOURCE, 'utf8');
const adaptedText = fs.readFileSync(ADAPTED, 'utf8');
const sourceLines = sourceText.split('\n');
const adaptedLines = adaptedText.split('\n');

const problems = [];
const facts = [];

/* 1. упражнения и заголовки */

const headingsOf = (lines) => lines.filter((l) => HEADING.test(l));
const srcHeadings = headingsOf(sourceLines);
const outHeadings = headingsOf(adaptedLines);
const exercisesOf = (hs) => hs.filter((h) => /^### Упражнение /.test(h));

const srcEx = exercisesOf(srcHeadings);
const outEx = exercisesOf(outHeadings);

if (outEx.length !== 20) problems.push(`упражнений в адаптации: ${outEx.length}, нужно 20`);
if (srcEx.length !== 20) problems.push(`упражнений в источнике: ${srcEx.length}, ожидалось 20`);
for (let i = 0; i < Math.min(srcEx.length, outEx.length); i++) {
  if (srcEx[i] !== outEx[i]) problems.push(`заголовок упражнения ${i + 1} не совпадает:\n    было: ${srcEx[i]}\n    стало: ${outEx[i]}`);
}
const missingEx = srcEx.filter((h) => !outEx.includes(h));
if (missingEx.length) problems.push(`потеряны упражнения: ${missingEx.join(' | ')}`);
facts.push(`Упражнений: ${outEx.length} из ${srcEx.length}`);
facts.push(`Заголовков всего: ${outHeadings.length} из ${srcHeadings.length}`);
if (outHeadings.length !== srcHeadings.length) {
  problems.push('набор заголовков разошёлся с исходником');
} else if (outHeadings.some((h, i) => h !== srcHeadings[i])) {
  problems.push('заголовки совпадают по количеству, но различаются по порядку или тексту');
}

/* 2. рисунки */

const srcFigs = [];
for (let i = 0; i < sourceLines.length; i++) {
  const m = sourceLines[i].match(FIG_SRC);
  if (!m) continue;
  const caption = (sourceLines[i + 1] ?? '').trim();
  srcFigs.push({ no: m[2], label: m[1], caption });
}

const outFigs = [];
for (let i = 0; i < adaptedLines.length; i++) {
  const m = adaptedLines[i].match(FIG_OUT);
  if (!m) continue;
  // Подпись идёт следующей непустой строкой.
  let j = i + 1;
  while (j < adaptedLines.length && adaptedLines[j].trim() === '') j++;
  outFigs.push({ no: m[1], line: i, caption: (adaptedLines[j] ?? '').trim() });
}

if (outFigs.length !== srcFigs.length) {
  problems.push(`меток [[fig:…]] ${outFigs.length}, в исходнике рисунков ${srcFigs.length}`);
}
for (let i = 0; i < Math.min(srcFigs.length, outFigs.length); i++) {
  const a = srcFigs[i];
  const b = outFigs[i];
  if (a.no !== b.no) {
    problems.push(`рисунок ${i + 1}: номер ${b.no}, в исходнике ${a.no}`);
    continue;
  }
  if (!CAPTION.test(b.caption)) problems.push(`рисунок ${b.no}: после метки нет подписи *Рис. …*`);
  else if (a.caption && b.caption !== a.caption) {
    problems.push(`рисунок ${b.no}: подпись не совпадает с исходником`);
  }
}
facts.push(`Рисунков: ${outFigs.length} из ${srcFigs.length} (в упражнениях 3–5: ${srcFigs.filter((f) => f.no.length === 4 && !f.no.startsWith('1')).length})`);

/* 3. абзацы предметной области */

// Номер упражнения, к которому относится строка источника.
const exerciseNoByLine = new Array(sourceLines.length + 1).fill(null);
let current = 'предисловие';
for (let i = 0; i < sourceLines.length; i++) {
  const h = sourceLines[i];
  if (/^### Упражнение /.test(h)) current = h.replace(/^### Упражнение ([0-9A-H.]+)\. .*$/, '$1');
  exerciseNoByLine[i + 1] = current;
}

const adaptedLineSet = new Set(adaptedLines.map((l) => l.replace(/\s+$/, '')));
const domain = [];
for (let i = 0; i < sourceLines.length; i++) {
  const raw = sourceLines[i];
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) continue;
  if (HEADING.test(line)) continue;
  if (FIG_SRC.test(line)) continue;
  if (CAPTION.test(line)) continue;
  if (isUI(line)) continue;
  domain.push({ n: i + 1, line, exercise: exerciseNoByLine[i + 1] });
}

const lost = domain.filter((d) => !adaptedLineSet.has(d.line));
const kept = domain.length - lost.length;
const share = domain.length ? (kept / domain.length) * 100 : 100;

for (const d of lost.slice(0, 10)) {
  problems.push(`потерян абзац предметной области (строка ${d.n}): ${d.line.slice(0, 90)}…`);
}
if (lost.length > 10) problems.push(`…и ещё ${lost.length - 10} потерянных абзацев`);

facts.push(`Абзацев предметной области: ${domain.length}`);
facts.push(`Сохранено дословно: ${kept} из ${domain.length} — ${share.toFixed(1)} %`);

// По упражнениям: сколько абзацев и сколько сохранено.
const byExercise = new Map();
for (const d of domain) {
  const rec = byExercise.get(d.exercise) ?? { total: 0, kept: 0 };
  rec.total++;
  if (adaptedLineSet.has(d.line)) rec.kept++;
  byExercise.set(d.exercise, rec);
}

/* 4. пометки и operations.json */

const opsRaw = fs.readFileSync(OPS, 'utf8');
let opsDoc;
try {
  opsDoc = JSON.parse(opsRaw);
} catch (e) {
  problems.push(`operations.json не разбирается: ${e.message}`);
  opsDoc = { operations: [] };
}
const ops = Array.isArray(opsDoc.operations) ? opsDoc.operations : [];
const STATUSES = new Set(['есть', 'есть иначе', 'нет']);

const ids = new Set();
for (const [i, op] of ops.entries()) {
  const where = `operations.json[${i}] (${op.id ?? '?'})`;
  if (!op.vp) problems.push(`${where}: нет поля vp`);
  if (!op.ours) problems.push(`${where}: нет поля ours`);
  if (!STATUSES.has(op.status)) problems.push(`${where}: недопустимый status «${op.status}»`);
  if (!op.note) problems.push(`${where}: нет поля note`);
  if (op.id && ids.has(op.id)) problems.push(`${where}: повторяется id`);
  if (op.id) ids.add(op.id);
  if (op.status === 'нет' && !op.marker) problems.push(`${where}: status «нет» без поля marker`);
  if (op.status !== 'нет' && op.marker) problems.push(`${where}: marker у строки со status «${op.status}»`);
}

const noRows = ops.filter((o) => o.status === 'нет');
const markerLines = adaptedLines
  .filter((l) => l.startsWith(MARKER_PREFIX))
  .map((l) => l.slice(MARKER_PREFIX.length));

const usedRows = new Set();
for (const rest of markerLines) {
  // Самое длинное совпадение по началу строки: «`Duplicate`» не должен съедать
  // «`Duplicate Recursively`».
  const hits = noRows.filter((r) => rest.startsWith(r.marker));
  if (!hits.length) {
    problems.push(`пометка без строки в operations.json: ${rest.slice(0, 80)}…`);
    continue;
  }
  hits.sort((a, b) => b.marker.length - a.marker.length);
  if (hits.length > 1 && hits[0].marker.length === hits[1].marker.length) {
    problems.push(`пометка подходит к двум строкам: ${rest.slice(0, 60)}…`);
  }
  usedRows.add(hits[0].id);
}

const unused = noRows.filter((r) => !usedRows.has(r.id));
for (const r of unused) problems.push(`строка со status «нет» без пометки в тексте: ${r.id} — ${r.vp}`);

facts.push(`Пометок «⚠ У нас нет»: ${markerLines.length}`);
facts.push(`Строк operations.json со status «нет»: ${noRows.length}`);
facts.push(`Операций в operations.json: ${ops.length} `
  + `(есть ${ops.filter((o) => o.status === 'есть').length}, `
  + `есть иначе ${ops.filter((o) => o.status === 'есть иначе').length}, `
  + `нет ${noRows.length})`);

/* 5. форматирование */

const htmlLeft = adaptedLines
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /<\/?(b|i|p|br|span|div|img|table|tr|td|a)\b/i.test(l) || /&(nbsp|laquo|raquo|mdash|quot);/.test(l));
if (htmlLeft.length) problems.push(`следы HTML в ${htmlLeft.length} строках, первая — ${htmlLeft[0].i + 1}`);

if (/\n\n\n/.test(adaptedText)) problems.push('в тексте есть пустая строка двойной ширины');
if (!adaptedText.endsWith('\n') || adaptedText.endsWith('\n\n')) problems.push('файл должен кончаться одним переводом строки');
const trailing = adaptedLines.filter((l) => l !== l.replace(/\s+$/, '')).length;
if (trailing) problems.push(`строк с пробелами на конце: ${trailing}`);

for (let i = 0; i < adaptedLines.length; i++) {
  const l = adaptedLines[i];
  if (l.startsWith('[[fig:') && !FIG_OUT.test(l)) {
    problems.push(`строка ${i + 1}: метка рисунка не в формате [[fig:NNNN|Рис. N.M.K]] или не одна на строке`);
  }
}

/* --------------------------------------------------------------- отчёт */

console.log('Проверка адаптированного пособия\n');
for (const f of facts) console.log('  ' + f);

console.log('\n  Доля сохранённого дословно по упражнениям:');
for (const [ex, rec] of [...byExercise.entries()].sort(cmpExercise)) {
  const pct = rec.total ? (rec.kept / rec.total) * 100 : 100;
  console.log(`    ${String(ex).padEnd(16)} ${String(rec.kept).padStart(3)} / ${String(rec.total).padEnd(3)} — ${pct.toFixed(0)} %`);
}

if (problems.length) {
  console.log(`\nПроблемы (${problems.length}):`);
  for (const p of problems) console.log('  • ' + p);
  process.exitCode = 1;
} else {
  console.log('\nВсё в порядке: упражнения, рисунки, авторский текст и пометки сходятся.');
}

function cmpExercise(a, b) {
  const pa = a[0].split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b[0].split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return String(a[0]).localeCompare(String(b[0]));
}