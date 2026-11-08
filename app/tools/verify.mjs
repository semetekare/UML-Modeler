// Один прогон всего: все наборы, сверка двух копий, эталон.
//
// ЗАЧЕМ. В этом проекте уже был случай, когда проверка лежала в `tests/`, но
// ни в один набор не входила: `check.mjs` не запускался ничем, и семь замечаний
// прожили незамеченными до ручного прогона. Отсюда два правила, которые этот
// файл и воплощает:
//
//   1. набор, который никто не запускает, — не набор. Поэтому список наборов
//      здесь явный, а всё, что лежит в `tests/` и в список не попало, печатается
//      как ЗАМЕЧАНИЕ (кроме вспомогательных файлов из HELPERS);
//   2. приложение живёт в двух копиях: `src/` видят тесты, `dist/` открывает
//      человек. Разошедшиеся копии — это «тесты зелёные, а человек видит
//      старое». Поэтому сверка md5 здесь же, а не в чьей-то голове.
//
// Запуск: из папки `app` — `node tools/verify.mjs`. Код возврата 1, если упал
// любой набор, разошлись копии или эталон изменился.
//
// Наборы запускаются ПО ОЧЕРЕДИ, а не параллельно: они поднимают headless
// браузер, и несколько профилей сразу дерутся за один порт.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..');

/** Наборы в порядке возрастания цены: быстрые падают первыми. */
const SUITES = [
  'shape-types', 'stereotypes', 'stereotype-hygiene', 'gaps', 'corpus', 'recovery',
  // Геометрия листа: правила раскладки (чистый узел) и их вид в панели «Проверки».
  'geometry', 'geometry-panel',
  // Авто-раскладка: план, идемпотентность, инварианты после применения.
  'auto-route',
  'rules', 'demo', 'smoke', 'types', 'connectors', 'plantuml-import', 'layout', 'theme',
  // Третий слой правил (правила проекта): DSL, движок, хранение в файле модели.
  'project-rules',
];

/** Файлы в `tests/`, которые набором не являются: диагностика и библиотека снимков. */
const HELPERS = new Set(['inspect.mjs', 'png.mjs']);

/** Эталон, который обязан остаться побайтово тем же. Лежит в корневом `tests/`, не в `app/tests/`. */
const REFERENCE = {
  file: '../tests/fixtures/old-v3.json',
  bytes: 4611,
  md5: '3d600cf08dc26b3329489331de80f3f6',
};

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** Все файлы под каталогом, относительными путями через `/`. */
function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Сверка двух копий.
 *
 * `dist/` — это КОПИЯ САЙТА, а не копия `src/`: в ней лежит `dist/src/`,
 * `dist/notation/`, `dist/index.html` и прочее, что перечисляет `build.mjs`.
 * Поэтому сравнивать `app/src` с `app/dist` напрямую нельзя — так сверка
 * «проходила» бы только затем, чтобы найти 700 ложных расхождений.
 *
 * Правильная сверка: у каждого файла сборки должен быть такой же файл рядом с
 * исходниками. Сверяем в две стороны для `src` (там живёт весь код) и в одну —
 * для остальных позиций сборки: файл в `dist` без пары в исходниках означает,
 * что человеку открывается то, чего в проекте уже нет.
 */
function compareCopies() {
  const dist = path.join(APP, 'dist');
  let distFiles;
  try {
    distFiles = walk(dist);
  } catch {
    return ['нет папки app/dist — человеку нечего открывать'];
  }
  const problems = [];
  let compared = 0;
  let specSkipped = 0;

  for (const rel of distFiles) {
    // `reference/spec/*.json` в dist намеренно НЕ совпадает с app/reference:
    // локально лежит полный текст стандарта, а поставка идёт без прозы —
    // условие (2) лицензии OMG (см. build.mjs и reference/NOTICE.md).
    // Побайтовая сверка здесь невозможна; что прозы в dist нет, проверяет
    // отдельный шаг ниже.
    if (rel.startsWith('reference/spec/')) { specSkipped += 1; continue; }
    const inApp = path.join(APP, rel);
    let a;
    try {
      a = readFileSync(inApp);
    } catch {
      problems.push(`лишнее в dist: ${rel} (в исходниках нет)`);
      continue;
    }
    const b = readFileSync(path.join(dist, rel));
    if (md5(a) !== md5(b)) problems.push(`разошлось: ${rel} (${a.length} Б / ${b.length} Б)`);
    compared += 1;
  }

  // Обратная сторона только для кода: удалённый из `src` модуль не должен
  // оставаться в `dist/src`, иначе он продолжит грузиться у человека.
  try {
    for (const rel of walk(path.join(APP, 'src'))) {
      try { readFileSync(path.join(dist, 'src', rel)); } catch {
        problems.push(`нет в dist/src: ${rel}`);
      }
    }
  } catch {
    return ['нет папки app/src'];
  }

  return { problems, count: compared, specSkipped };
}

function suite(file) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join('tests', file)], {
    cwd: APP,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // Последняя строка с итогом — так их печатают все наборы.
  const summary = out.trim().split('\n')
    .filter((l) => /проверк|Проверок|осталось|замечан/i.test(l)).pop() ?? '';
  return { ok: r.status === 0, ms, summary: summary.trim(), status: r.status, out };
}

let bad = 0;
const rows = [];
const copiesOnly = process.argv.includes('--copies-only');

for (const name of (copiesOnly ? [] : SUITES)) {
  const file = `${name}.mjs`;
  let exists = true;
  try { statSync(path.join(APP, 'tests', file)); } catch { exists = false; }
  if (!exists) {
    rows.push({ name, ok: null, ms: 0, summary: 'набора нет (ещё не написан)' });
    continue;
  }
  process.stdout.write(`· ${name}… `);
  const r = suite(file);
  console.log(`${r.ok ? 'ok' : 'FAIL'} ${r.ms} мс${r.summary ? ' — ' + r.summary : ''}`);
  if (!r.ok) {
    bad += 1;
    const tail = r.out.trim().split('\n').slice(-25).join('\n');
    console.log(tail.split('\n').map((l) => '    ' + l).join('\n'));
  }
  rows.push({ name, ok: r.ok, ms: r.ms, summary: r.summary });
}

// Набор вне списка — ровно та дыра, из-за которой семь замечаний жили молча.
const known = new Set(SUITES.map((s) => `${s}.mjs`));
const orphans = readdirSync(path.join(APP, 'tests'))
  .filter((f) => f.endsWith('.mjs') && !known.has(f) && !HELPERS.has(f));
if (orphans.length) {
  bad += 1;
  console.log(`\nЗАМЕЧАНИЕ: наборы, которых нет в списке tools/verify.mjs — ${orphans.join(', ')}`);
  console.log('  такой набор никто не запускает. Допишите его в SUITES.');
}

console.log('\n— две копии —');
const copies = compareCopies();
if (Array.isArray(copies)) {
  bad += 1;
  for (const p of copies) console.log(`  ${p}`);
} else if (copies.problems.length) {
  bad += 1;
  for (const p of copies.problems.slice(0, 20)) console.log(`  ${p}`);
  if (copies.problems.length > 20) console.log(`  … всего ${copies.problems.length}`);
} else {
  const skipped = copies.specSkipped
    ? ` (+${copies.specSkipped} файлов spec/ вне сверки: поставка идёт без прозы OMG)`
    : '';
  console.log(`  src↔dist: ${copies.count} файлов, 0 расхождений${skipped}`);
}

// Поставка обязана идти без прозы стандарта: если в dist попал полный текст,
// приложение снова раздаёт его по сети, а это прямо запрещено лицензией OMG.
{
  const file = path.join(APP, 'dist', 'reference', 'spec', '11.json');
  try {
    const spec = JSON.parse(readFileSync(file, 'utf8'));
    const art = (spec.articles ?? []).find((a) => a.number === '11.5.4');
    const blocks = art?.blocks?.length ?? -1;
    if (blocks === 0) {
      console.log('  режим поставки: прозы стандарта в dist нет — публиковать можно');
    } else {
      // Не красное: --with-spec — законный локальный режим для личного чтения.
      // Но публиковать такую сборку нельзя, и молчать об этом нельзя тоже.
      console.log(`  ЗАМЕЧАНИЕ: в dist ${blocks} блоков прозы статьи 11.5.4 — это сборка `
        + '--with-spec (локальная); для публикации соберите node build.mjs без флага');
    }
  } catch {
    console.log('  dist/reference/spec нет — английских статей в поставке нет вовсе');
  }
}

console.log('\n— реестр покрытия —');
// Вкладка «Стандарт» показывает копию реестра из `notation/` (корневая папка
// `material/` в dist не попадает). Копия генерируется отдельным инструментом,
// и без этой сверки она тихо отставала бы: правила и статусы в приложении
// разъехались бы с отчётом, а человек читал бы прошлые числа.
{
  const srcPath = path.join(ROOT, 'material', 'rules-coverage', 'coverage.json');
  const outPath = path.join(APP, 'notation', 'rules', 'coverage.json');
  let src;
  try {
    src = readFileSync(srcPath);
  } catch {
    bad += 1;
    console.log('  нет material/rules-coverage/coverage.json — реестр не собран');
    src = null;
  }
  let out = null;
  try {
    out = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    bad += 1;
    console.log('  нет notation/rules/coverage.json — вкладка «Стандарт» пуста. '
      + 'Соберите: node tools/build-coverage-ui.mjs');
  }
  if (src && out) {
    const srcMd5 = md5(src);
    const was = out.source?.md5;
    if (was !== srcMd5) {
      bad += 1;
      console.log(`  coverage.json отстал от реестра: в файле md5 ${String(was).slice(0, 8)}…, `
        + `у исходника ${srcMd5.slice(0, 8)}…`);
      console.log('  пересоберите: node tools/build-coverage-ui.mjs');
    } else {
      console.log(`  ok notation/rules/coverage.json: ${out.items?.length ?? 0} строк, `
        + `md5 исходника ${srcMd5.slice(0, 8)}…`);
    }
  }
}

console.log('\n— поисковый индекс справочника —');
// Индекс строится из набора правил (material/reference-content/build_search_index.py
// → app/tools/build-reference.mjs). Пока он читал устаревшую копию в docs/,
// 31 правило не искалось вовсе, и заметить это можно было только руками
// (docs/research/VALIDATOR-PLAN.md §3.4). Счётчик здесь — сторож того же расхождения.
{
  const count = (file) => {
    try {
      const v = JSON.parse(readFileSync(path.join(APP, file), 'utf8'));
      return Array.isArray(v) ? v.length : 0;
    } catch { return -1; }
  };
  const rules = count('notation/rules/uml-2.5.1.json');
  const practice = count('notation/rules/practice.json');
  let indexed = -1;
  try {
    const idx = JSON.parse(readFileSync(path.join(APP, 'reference', 'search.json'), 'utf8'));
    const k = (idx.docFields ?? []).indexOf('kind');
    const ruleKind = (idx.kinds ?? []).indexOf('rule');
    indexed = idx.docs.filter((d) => d[k] === ruleKind).length;
  } catch { /* нет индекса — скажем об этом ниже */ }
  const want = rules + practice;
  if (indexed < 0) {
    bad += 1;
    console.log('  нет reference/search.json — поиск по справочнику не работает');
  } else if (indexed !== want) {
    bad += 1;
    console.log(`  в поиске ${indexed} правил, в наборе ${want} (${rules} стандарта + ${practice} практики).`);
    console.log('  пересоберите: python3 material/reference-content/build_search_index.py '
      + '&& node tools/build-reference.mjs');
  } else {
    console.log(`  ok reference/search.json: ${indexed} правил — столько же, сколько в наборе`);
  }
}

console.log('\n— эталон —');
const refPath = path.join(APP, REFERENCE.file);
const ref = readFileSync(refPath);
const refMd5 = md5(ref);
const refOk = ref.length === REFERENCE.bytes && refMd5 === REFERENCE.md5;
if (!refOk) bad += 1;
console.log(`  ${refOk ? 'ok' : 'FAIL'} ${REFERENCE.file}: ${ref.length} Б, md5 ${refMd5}`
  + (refOk ? '' : `\n       ожидалось ${REFERENCE.bytes} Б, md5 ${REFERENCE.md5}`));

console.log(`\n${rows.filter((r) => r.ok === true).length} наборов зелёных, `
  + `${rows.filter((r) => r.ok === false).length} красных, `
  + `${rows.filter((r) => r.ok === null).length} нет.`);
if (bad) {
  console.log('ЕСТЬ ЗАМЕЧАНИЯ — см. выше.');
  process.exit(1);
}
console.log('Всё сходится.');