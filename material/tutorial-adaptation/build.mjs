// Сборка адаптированного пособия: docs/uml-tutorial.md (источник, только чтение) →
// uml-tutorial-our.md.
//
// Скрипт механический: он не сочиняет текст. Он
//   1) подставляет заготовленные абзацы из rewrites/*.mjs на место абзацев, которые
//      описывают интерфейс Visual Paradigm;
//   2) всё остальное переносит дословно;
//   3) размечает рисунки как [[fig:NNNN|Рис. N.M.K]].
//
// Две проверки на входе, обе падают громко:
//   * каждый адресуемый абзац действительно начинается так, как ожидает правка
//     (`expect`) — иначе номера строк разъехались с источником;
//   * каждая правка адресует абзац, в котором есть маркер интерфейса из STRONG —
//     иначе правка затирает авторский текст предметной области.
//
// Повторный прогон даёт тот же файл байт в байт.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE = path.join(ROOT, 'docs', 'uml-tutorial.md');
const TARGET = path.join(HERE, 'uml-tutorial-our.md');

const MODULES = [
  './rewrites/ch1.mjs',
  './rewrites/exercises3.mjs',
  './rewrites/exercises4a.mjs',
  './rewrites/exercises4b.mjs',
  './rewrites/exercises5a.mjs',
  './rewrites/exercises5b.mjs',
];

// Маркеры интерфейса Visual Paradigm, при которых абзац можно переписывать.
// Это подмножество списка из check.mjs и намеренно узкое: пункты меню, названия
// окон и элементов управления VP, латинские имена его диалогов.
const STRONG = [
  'палитр', 'Проводник', 'Model Explorer', 'Diagram Navigator', 'контекстн',
  'Presentation Options', 'Open Specification', 'стереотип', 'Stereotype',
  'Sub Diagram', 'вкладк', 'вкладок', '`->', 'Ctrl+', 'F2', 'Shift+Del',
  'Navigable', 'Qualifier', 'Abstract', 'Derived', 'Scope', 'Duplicate',
  'Merge to', 'Parent model', 'Interface Ball', 'Show Owner', 'Show Arrows',
  'Visualize Related', 'Create Getter', 'Add Classifier', 'Instance Specification',
  'Lifeline', 'Combined Fragment', 'Operand', 'Interaction Use', 'Multi-object',
  'Stopped', 'Duration Message', 'Asynchronous', 'Lost Message', 'Vertical Swimlane',
  'Initial Node', 'Activity Final Node', 'Flow Final Node', 'Control Flow',
  'Decision Node', 'Merge Node', 'Call Behavior Action', 'Conditional Node',
  'Loop Node', 'Internal Transitions', 'Triggers', 'Add Horizontal Region',
  'FinalState', 'Refers to', 'Select Operation', 'Create Operation', 'Return Type',
  'Delete View Only', 'Show Relationships', 'Aggregation kind', 'Edit Role',
  'Generalization Set', 'Dashed Line', 'Show Constraints', 'Template Parameters',
  'Workspace', 'Project Options', 'Diagramming', 'Manage Stereotypes', '.vpp',
  'stereotypes.xml', 'Community Edition', 'Visual Paradigm', 'Add Operand',
  'Binding', 'Relations', 'Diagram name', 'Represents', 'Action', 'Actor',
  'Use Case', 'System', 'Association', 'Generalization', 'Realization',
  'Dependency', 'Enumeration', 'Class', 'Package', 'Guard', 'Effect', 'Kind',
  'Entry', 'Choice', 'Duration', 'Message', 'Lifeline', 'Frame', 'Subject',
  'workspace', 'app/reference/vp163', 'Execution Environment', 'Device',
  'Deployment Diagram', 'Component', 'Component Diagram', 'Class Diagram',
];

const FIGURE = /^\[Рис\. ([0-9][0-9.]*[a-z]?)\]\(\.\.\/app\/reference\/vp163\/([0-9]+[a-z]?)\.png\)$/;

const rewrites = new Map();
for (const rel of MODULES) {
  const url = new URL(rel, import.meta.url);
  const { default: list } = await import(url.href);
  for (const entry of list) {
    if (rewrites.has(entry.n)) throw new Error(`${rel}: строка ${entry.n} описана дважды`);
    rewrites.set(entry.n, { ...entry, from: rel });
  }
}

// Вставки: абзацы, которых в источнике нет. Сюда попадает только то, чего в исходном
// пособии быть не могло, — например, что правила диаграммы вариантов использования у
// нас проверяет вкладка «Проверки». Ключ — номер строки источника, после которой
// вставка идёт.
const inserts = new Map([
  [737, [
    '> ⚠ У нас нет: `Diagram name` — переименования диаграммы. Кооперации переименовать можно (`F2`), диаграммы внутри них — нет: имя задаётся один раз при создании. Вместо переименования создайте диаграмму с нужным именем и перенесите на неё фигуры (`Ctrl+A`, `Ctrl+C`, затем `Ctrl+V` на новой диаграмме), а старую удалите кнопкой `✕` в списке вложенных диаграмм.',
  ]],
  [447, [
    '> ⚠ У нас нет: `Flow Final Node` — узла завершения потока. У нас есть только «Конечное состояние», которое завершает всю деятельность целиком: отдельного узла с крестиком, гасящего один поток и оставляющего остальные, нет. Вместо него проведите поток управления в «Конечное состояние» и подпишите примечанием, что завершается только эта ветвь.',
  ]],
  [163, [
    'Проверить эти правила можно вкладкой «Проверки» в правой панели: она прогоняет 23 ограничения UML 2.5.1 и 7 советов по практике и находит, например, ассоциацию между вариантами использования внутри одних рамок системы (`usecase-no-association-to-usecase`) и связь актёра с недопустимым элементом (`actor-association-targets`). Правило «у одного варианта использования одно основное действующее лицо» — методологическое, в стандарте UML его нет, поэтому проверка о нём молчит: этот дефект придётся увидеть глазами.',
  ]],
]);

const sourceText = fs.readFileSync(SOURCE, 'utf8');
const lines = sourceText.split('\n');

const problems = [];
for (const [n, w] of rewrites) {
  const line = lines[n - 1];
  if (line === undefined) { problems.push(`строка ${n}: за пределами файла`); continue; }
  if (!line.includes(w.expect)) {
    problems.push(`строка ${n}: не найдено «${w.expect}» — источник сдвинулся`);
  }
  if (!STRONG.some((m) => line.includes(m))) {
    problems.push(`строка ${n}: нет маркера интерфейса — правка затронет авторский текст`);
  }
}
if (problems.length) {
  console.error('Сборка остановлена:');
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

/* ------------------------------------------------------------- сборка */

const blocks = [];
let figures = 0;
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  const line = lines[i];
  if (line.trim() === '') continue;

  const w = rewrites.get(n);
  if (w) {
    blocks.push(...w.md);
    if (inserts.has(n)) blocks.push(...inserts.get(n));
    continue;
  }

  const fig = line.match(FIGURE);
  if (fig) {
    blocks.push(`[[fig:${fig[2]}|Рис. ${fig[1]}]]`);
    figures++;
    if (inserts.has(n)) blocks.push(...inserts.get(n));
    continue;
  }
  blocks.push(line.replace(/\s+$/, ''));
  if (inserts.has(n)) blocks.push(...inserts.get(n));
}

/* ------------------------------------------------------------- нумерация */

// В пособии каждый нумерованный список — тег <ol>, и при конвертации в
// Markdown все его пункты записались одинаково: `1.` (24 такие строки из 40
// пунктов). На экране это давало список, который каждый раз начинается с 1.
//
// Рендерер курса теперь склеивает такие пункты в один список и нумерует по
// порядку, но и данные должны быть честными — иначе счёт в тексте и в файле
// расходятся. Здесь каждый блок подряд идущих пунктов нумеруется 1, 2, 3 …
//
// Границей списка служит первый же блок, который не является пунктом:
// абзац, заголовок, цитата, метка рисунка. Пустые строки между пунктами
// списка не рвут — blocks их не содержит (join вставляет их обратно один).
// docs/uml-tutorial.md (первоисточник) не трогается: правка живёт здесь, иначе
// следующий прогон вернул бы всё как было.
const NUMBERED = /^(\d+)\.(\s+)([\s\S]*)$/;
// Пункт списка — блок `N. …`; продолжением пункта считаются вложенные
// подпункты (`- …`) и метки рисунков (`[[fig:…]]`): в пособии так записан,
// например, пункт 1 «Дополнительной спецификации» — с четырьмя вложенными
// правилами. Они не начинают новый список ни здесь, ни в рендерере курса
// (src/ui/course.js::markdown — то же правило).
const LIST_PART = /^(\s*[-*]\s+|\[\[fig:)/;
let listNo = 0;
let inList = false;
const numbered = blocks.map((b) => {
  const m = NUMBERED.exec(b);
  if (m) {
    listNo += 1;
    inList = true;
    return `${listNo}.${m[2]}${m[3]}`;
  }
  if (inList && LIST_PART.test(b)) return b;
  inList = false;
  listNo = 0;
  return b;
});

const renumbered = numbered.filter((b, i) => b !== blocks[i]).length;

const out = numbered.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
fs.writeFileSync(TARGET, out, 'utf8');

const srcFigures = lines.filter((l) => FIGURE.test(l)).length;
const outFigures = blocks.filter((b) => b.startsWith('[[fig:')).length;
console.log(`Готово: ${path.relative(ROOT, TARGET)}`);
console.log(`  абзацев в источнике: ${lines.filter((l) => l.trim()).length}`);
console.log(`  переписано абзацев:  ${rewrites.size}`);
console.log(`  добавлено абзацев:   ${[...inserts.values()].flat().length}`);
console.log(`  рисунков: ${outFigures} из ${srcFigures}`);
console.log(`  пунктов перенумеровано: ${renumbered}`);
if (srcFigures !== figures) console.log(`  внимание: не все рисунки распознаны (${figures})`);