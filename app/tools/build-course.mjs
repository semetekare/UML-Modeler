// Данные курса: пособие ВМК МГУ → app/course/.
//
// Скрипт, а не ручная разметка: пособие — 999 строк и 296 КБ, а рисунки уже
// описаны машинно (tests/corpus/MANIFEST.json). Здесь эти два источника
// сводятся в один маленький индекс, по которому работает панель «Курс»:
//
//   app/course/index.json          главы → упражнения → рисунки
//   app/course/text/<id>.md        текст упражнения (главы — intro)
//   app/course/figures/<номер>.uml.json  копия модели корпуса (ровно те байты)
//
// Что делает разбор:
//   * режет пособие по `## N.` (главы) и `### …` (упражнения и врезки);
//   * врезку без слова «Упражнение» (5.2, 5.2.E) приписывает СЛЕДУЮЩЕМУ
//     упражнению главы — по смыслу это его вступление, а не отдельный пункт;
//   * строку `[Рис. 3.1.2](../app/reference/vp163/3102.png)` и подпись под ней
//     превращает в метку `[[fig:3102|Рис. 3.1.2]]` и подпись рисунка;
//   * упоминания в прозе («на рисунке 3.1.2», «см. рис. 4.1.3») — в такие же
//     метки, чтобы интерфейс открывал по ним модель;
//   * связывает упражнение с моделями корпуса по номеру рисунка и со снимком
//     из app/reference/vp163/; чего нет — пишет в `missing`, а не выдумывает.
//
// Только stdlib. Повторный прогон даёт побайтово те же файлы: порядок взят из
// пособия и манифеста, JSON пишется с фиксированным отступом, переводы строк
// нормализованы, лишние файлы прошлого прогона удаляются.
//
//   node tools/build-course.mjs           собрать
//   node tools/build-course.mjs --check   только проверить, что на диске то же

import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(APP, '..');
// Источник текста — адаптированное пособие: тот же авторский текст, но
// действия описаны нашими средствами, а не меню исходного редактора. Собирается
// из docs/uml-tutorial.md скриптом material/tutorial-adaptation/build.mjs;
// исходник остаётся нетронутым и служит опорой для проверки.
const TUTORIAL = path.join(REPO, 'material', 'tutorial-adaptation', 'uml-tutorial-our.md');
// Откуда взят авторский текст: нужен, чтобы заметить расхождение структуры.
const ORIGINAL = path.join(REPO, 'docs', 'uml-tutorial.md');
const MANIFEST = path.join(REPO, 'tests', 'corpus', 'MANIFEST.json');
const CORPUS = path.join(REPO, 'material', 'corpus-layout');
const OUT = path.join(APP, 'course');
const CHECK = process.argv.includes('--check');

const SOURCE = 'docs/uml-tutorial.md (ВМК МГУ, Малышко В. В.)';
const EXPECTED_EXERCISES = 20;

/* ------------------------------------------------------------------ разбор */

const RE_CHAPTER = /^## (\d+)\. (.+)$/;
// Упражнение опознаётся по слову «Упражнение»: в главе 5 есть `### 5.2.` и
// `### 5.2.E.` — это врезки, а не пункты курса.
const RE_EXERCISE = /^### Упражнение ([\d.]+[A-Z]?)\. (.+)$/;
const RE_HEADING3 = /^### (.+)$/;
const RE_FIG = /^\[Рис\. ([\d.]+[a-z]?)\]\(\.\.\/app\/reference\/vp163\/([\w-]+)\.png\)$/;
// Готовая метка адаптированного текста: [[fig:3101|Рис. 3.1.1]]
const RE_FIG_DONE = /^\[\[fig:([\w-]+)\|([^\]]+)\]\]$/;
/**
 * Убрать название редактора-источника, не ломая фразы: сначала целыми
 * оборотами (иначе «привыкают в редактор»), только потом отдельным словом.
 */
const scrub = (text) => String(text ?? '')
  .replace(/Окно Visual Paradigm/gi, 'Окно редактора')
  .replace(/привыкают в Visual Paradigm/gi, 'привыкли работать')
  .replace(/в VP это/gi, 'в исходном редакторе это')
  .replace(/Visual Paradigm/g, 'редактор')
  .replace(/\bVP\b/g, 'редактор');

const RE_CAPTION = /^\*Рис\. ([\d.]+[a-z]?)\. (.+)\*$/;
// «на рисунке 3.1.2», «см. рис. 4.1.3», «Рисунок 1.1» — но не «рисунков».
const RE_INLINE_FIG = /([Рр]ис(?:унке|унках|унки|унка|унок|\.))\s*(\d+(?:\.\d+)+[a-z]?)/g;

const lines = (await readFile(TUTORIAL, 'utf8')).replace(/\r\n?/g, '\n').split('\n');

/** Собрать сырые разделы: главы с их строками, упражнения внутри глав. */
function splitTutorial() {
  const chapters = [];
  let chapter = null;
  let block = null;              // { number, title, lines, isExercise }
  const push = () => { if (block) { chapter.sections.push(block); block = null; } };
  for (const line of lines) {
    const ch = RE_CHAPTER.exec(line);
    if (ch) {
      push();
      chapter = { number: ch[1], title: ch[2].trim(), intro: [], sections: [] };
      chapters.push(chapter);
      continue;
    }
    if (/^## /.test(line)) { push(); chapter = null; continue; }
    if (!chapter) continue;
    const ex = RE_EXERCISE.exec(line);
    const h3 = RE_HEADING3.exec(line);
    if (ex) { push(); block = { number: ex[1], title: ex[2].trim(), lines: [], isExercise: true }; continue; }
    if (h3) { push(); block = { number: null, title: h3[1].trim(), lines: [], isExercise: false }; continue; }
    (block ? block.lines : chapter.intro).push(line);
  }
  push();
  return chapters;
}

/** Плотный текст: не больше одной пустой строки подряд, без хвостовых. */
const tidy = (rows) => {
  const out = [];
  for (const raw of rows) {
    const line = raw.replace(/[ \t]+$/, '');
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
};

/**
 * Тело раздела → markdown с метками рисунков.
 * `figs` пополняется подписями; возвращает строки текста.
 */
function bodyToMarkdown(rawLines, figNoToId, figs) {
  const rows = tidy(rawLines);
  const out = [];
  let pending = null;            // номер рисунка, чья подпись ещё не встречена
  for (const line of rows) {
    // Адаптированный текст приходит с уже расставленными метками: они и есть
    // результат этого разбора, поэтому принимаем их как есть и только
    // достраиваем подпись, если она придёт следующей строкой.
    const done = RE_FIG_DONE.exec(line);
    if (done) {
      const [, id, label] = done;
      out.push(`[[fig:${id}|${label}]]`);
      pending = id;
      continue;
    }
    const fig = RE_FIG.exec(line);
    if (fig) {
      const [, figureNo, file] = fig;
      const id = figNoToId.get(figureNo) ?? file;
      out.push(`[[fig:${id}|Рис. ${figureNo}]]`);
      pending = id;
      continue;
    }
    const cap = RE_CAPTION.exec(line);
    if (cap && pending) {
      const [, figureNo, text] = cap;
      const id = figNoToId.get(figureNo) ?? pending;
      const entry = figs.find((f) => f.figure === id);
      // Подпись не называет редактор-источник: в интерфейсе это «окно редактора».
      if (entry) entry.caption = scrub(text.trim());
      pending = null;
      continue;
    }
    if (line.trim() !== '') pending = null;
    // Прозу чистим от упоминаний рисунков: они становятся метками.
    out.push(line.replace(RE_INLINE_FIG, (all, word, figureNo) => {
      const id = figNoToId.get(figureNo);
      return id ? `[[fig:${id}|${word} ${figureNo}]]` : all;
    }));
  }
  return tidy(out);
}

/* ------------------------------------------------------------------ сборка */

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const figuresByNo = new Map(manifest.figures.map((f) => [f.figureNo, f]));
const figNoToId = new Map(manifest.figures.map((f) => [f.figureNo, f.figure]));
const figuresByExercise = new Map();
for (const f of manifest.figures) {
  if (!figuresByExercise.has(f.exercise)) figuresByExercise.set(f.exercise, []);
  figuresByExercise.get(f.exercise).push(f);
}

const chapters = [];
const files = new Map();         // относительный путь → содержимое (для --check)
const copies = [];               // [откуда, куда]
let exerciseCount = 0;
let figureCount = 0;
let withModel = 0;
const missingIds = [];

for (const ch of splitTutorial()) {
  const sections = ch.sections.filter((s) => s.isExercise || s.lines.some((l) => l.trim() !== ''));
  if (!sections.some((s) => s.isExercise)) continue;   // главы 1–2: только чтение, упражнений нет

  const chapterId = `ch${ch.number}`;
  const chapter = { id: chapterId, number: ch.number, title: ch.title, intro: null, exercises: [] };

  const introRows = tidy(ch.intro);
  if (introRows.length) {
    chapter.intro = `course/text/${chapterId}-intro.md`;
    files.set(chapter.intro, introRows.join('\n') + '\n');
  }

  let carry = [];                // врезки, ждущие следующего упражнения
  for (const section of sections) {
    if (!section.isExercise) { carry.push(section); continue; }
    const number = section.number;
    const id = `ex-${number}`;
    exerciseCount += 1;

    // Рисунки упражнения — по манифесту, в его порядке.
    const figures = (figuresByExercise.get(number) ?? []).map((f) => {
      const modelFile = path.join(CORPUS, `${f.figure}.uml.json`);
      const shotFile = path.join(APP, 'reference', 'vp163', `${f.figure}.png`);
      const hasModel = !!f.model && existsSync(modelFile);
      const entry = {
        figure: f.figure,
        figureNo: f.figureNo,
        type: f.type,
        group: f.group,
        reproducible: f.reproducible,
        elements: f.elements ?? 0,
        relationships: f.relationships ?? 0,
        caption: '',
        note: f.what ?? '',
        model: hasModel ? `course/figures/${f.figure}.uml.json` : null,
        original: existsSync(shotFile) ? `reference/vp163/${f.figure}.png` : null,
      };
      if (hasModel) copies.push([modelFile, path.join(OUT, 'figures', `${f.figure}.uml.json`)]);
      return entry;
    });

    // Врезка перед упражнением — его вступление, а не отдельный пункт курса.
    const rows = [];
    for (const pre of carry) {
      rows.push(`#### ${pre.title}`, '');
      rows.push(...pre.lines);
      rows.push('');
    }
    carry = [];
    rows.push(...section.lines);

    const body = bodyToMarkdown(rows, figNoToId, figures);
    const textPath = `course/text/${id}.md`;
    files.set(textPath, scrub(body.join('\n')) + '\n');

    // Кнопка «Открыть как модель» ведёт к САМОМУ ПОЛНОМУ рисунку с моделью:
    // у 3.1 это итоговая диаграмма, а не пустая рамка, с которой упражнение
    // начинается, а у 4.3.A — модель 4.3.4, а не огрызок 4.3.5 (1 фигура).
    // Числа берутся из манифеста корпуса, а не из догадки.
    const bySize = (a, b) => (b.elements + b.relationships) - (a.elements + a.relationships);
    const primary = figures.filter((f) => f.model).sort(bySize)[0] ?? figures[0] ?? null;
    // Тип — у того же рисунка, который откроет кнопка: иначе урок обещает
    // «диаграмму составной структуры», а показывает диаграмму классов.
    const diagram = figures.find((f) => f.group === 'diagram') ?? null;
    const type = (primary?.group === 'diagram' ? primary.type : diagram?.type) ?? null;

    // Чего нет — говорим прямо, с причиной из данных, а не выдумываем модель.
    let missing = null;
    if (!figures.length) {
      missing = 'в пособии у этого упражнения нет рисунков — только текст';
    } else if (!figures.some((f) => f.group === 'diagram')) {
      missing = 'рисунки упражнения — снимки окон редактора, диаграмм среди них нет';
    } else if (!figures.some((f) => f.model)) {
      const noModel = figures.filter((f) => f.group === 'diagram' && !f.model).map((f) => f.figureNo);
      missing = `модель корпуса не построена: рисунок ${noModel.join(', ')} не воспроизводится`;
    }

    figureCount += figures.length;
    withModel += figures.filter((f) => f.model).length;
    if (missing) missingIds.push(id);

    chapter.exercises.push({
      id,
      number,
      title: section.title,
      type,
      text: textPath,
      figure: primary?.model ?? null,
      figureNo: primary?.figureNo ?? null,
      original: primary?.original ?? null,
      figures,
      missing,
    });
  }

  // Хвостовая врезка без следующего упражнения не теряется — она в конец главы.
  if (carry.length) {
    const last = chapter.exercises[chapter.exercises.length - 1];
    const extra = carry.flatMap((pre) => [`#### ${pre.title}`, '', ...pre.lines, '']);
    const prev = files.get(last.text) ?? '';
    files.set(last.text, tidy([...prev.split('\n'), ...extra]).join('\n') + '\n');
  }

  chapters.push(chapter);
}

if (exerciseCount !== EXPECTED_EXERCISES) {
  console.error(`build-course: найдено ${exerciseCount} упражнений, ожидалось ${EXPECTED_EXERCISES}`);
  process.exit(1);
}

const index = {
  version: 1,
  source: SOURCE,
  counts: {
    chapters: chapters.length,
    exercises: exerciseCount,
    figures: figureCount,
    withModel,
    missing: missingIds.length,
  },
  chapters,
};
files.set('course/index.json', JSON.stringify(index, null, 2) + '\n');

/* ------------------------------------------------------------------- запись */

await mkdir(path.join(OUT, 'text'), { recursive: true });
await mkdir(path.join(OUT, 'figures'), { recursive: true });

let changed = 0;
for (const [rel, content] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const target = path.join(APP, rel);
  const current = await readFile(target, 'utf8').catch(() => null);
  if (current === content) continue;
  changed += 1;
  if (!CHECK) await writeFile(target, content);
}

for (const [from, to] of copies) {
  // Копия модели корпуса проходит тот же scrub: имя модели («Окно …»)
  // видно в шапке, когда рисунок открывают кнопкой «Открыть как модель».
  const want = scrub(await readFile(from, 'utf8'));
  const have = await readFile(to, 'utf8').catch(() => null);
  if (have === want) continue;
  changed += 1;
  if (!CHECK) await writeFile(to, want);
}

// Файлы прошлого прогона, которых больше нет в индексе, не остаются мусором.
const keepText = new Set([...files.keys()].filter((k) => k.startsWith('course/text/')).map((k) => path.basename(k)));
const keepFig = new Set(copies.map(([, to]) => path.basename(to)));
for (const [dir, keep] of [['text', keepText], ['figures', keepFig]]) {
  for (const name of await readdir(path.join(OUT, dir))) {
    if (keep.has(name)) continue;
    changed += 1;
    if (!CHECK) await rm(path.join(OUT, dir, name));
  }
}

const note = CHECK
  ? (changed ? `build-course: расходятся ${changed} файлов` : 'build-course: на диске то же, что в пособии')
  : `build-course: ${exerciseCount} упражнений, ${figureCount} рисунков (${withModel} с моделью), ${missingIds.length} без модели${changed ? `, обновлено ${changed}` : ', изменений нет'}`;
console.log(note);
process.exit(CHECK && changed ? 1 : 0);
