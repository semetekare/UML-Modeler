#!/usr/bin/env node
/**
 * Сборка справочника-учебника (план Э10, партия Б15).
 *
 * Вход — уже готовые данные, они не переделываются:
 *   material/reference-content/spec-tree.json      3 690 узлов дерева
 *   material/reference-content/spec-sections/*.md  полный текст, 25 разделов
 *   material/reference-content/crossrefs.json      603 связи
 *   material/reference-content/search-index.json   3 538 документов
 *   material/notation-cards/*.json                 78 карточек нотации
 *   app/notation/rules/uml-2.5.1.json              58 констрейнтов стандарта
 *   app/notation/rules/practice.json               7 советов практики
 *   app/notation/uml.json                          51 фигура, 27 связей
 *   docs/plantuml-grammar.json                     169 конструкций PlantUML
 *
 * Выход — app/reference/ (или --out):
 *   spec/<NN>.json    статьи по клаузам с блоками p/ul/note/ocl/text/table/kv
 *   spec/index.json   дерево для навигации: номер, заголовок, id файла
 *   links.json        граф связей из crossrefs.json, у каждой связи confidence
 *   search.json       индекс поиска (документы + постинги + глоссарий)
 *   terms.json        русско-английские псевдонимы
 *   cards.json        78 карточек нотации
 *   stereotypes.json  428 стереотипов (для полки «Стереотипы»)
 *   plantuml.json     169 конструкций (для полки «PlantUML»)
 *
 * Markdown в браузере не разбирается: он ломается на 61 блоке ASCII-арта
 * метамодели. Здесь он разбирается один раз и превращается в блоки, которые
 * рендерер только раскладывает по классам прототипа.
 *
 * ФЛАГИ
 *   --out=<dir>       куда писать (по умолчанию app/reference)
 *   --lang=en|ru      какой язык собирать: `en` — оригинал (как раньше),
 *                     `ru` — только перевод, без флага — оба прохода.
 *   --no-full-text    вариант без прозы: номера, заголовки, имена констрейнтов
 *                     и OCL остаются, абзацы и списки нет. Без --out пишет в
 *                     app/reference-no-text, чтобы не затереть полный текст.
 *   --quiet           не печатать сводку
 *
 * Перевод (второй проход, `--lang=ru`): вход — material/spec-ru/ru/*.md и
 * material/spec-ru/glossary.json, выход — spec-ru/<NN>.json той же формы, что
 * spec/<NN>.json, плюс spec-ru/index.json, spec/i18n.json, search-ru.json и
 * glossary.json. Id статей берутся у английского дерева по номеру пункта:
 * структура файлов совпадает 1:1.
 *
 * Детерминированность: порядок обхода — порядок spec-sections.json и ключей
 * в файлах, время сборки никуда не пишется, JSON сериализуется с фиксированным
 * отступом. Повторный прогон даёт побайтово те же файлы.
 *
 * Только stdlib Node: никаких зависимостей, никакой установки.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Тот же разбор на слова, что у поиска в браузере: постинги перевода обязаны
// быть построены тем же токенизатором, иначе запрос не найдёт свои же термины.
import { tokenize } from '../src/reference/search.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');          // .../visual-paradigm
const SOURCE = path.join(ROOT, 'material', 'reference-content');
const CARDS = path.join(ROOT, 'material', 'notation-cards');

const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq < 0 ? true : hit.slice(eq + 1);
};
const NO_FULL_TEXT = arg('no-full-text') === true;
const QUIET = arg('quiet') === true;
// Язык сборки. Без флага собирается и оригинал, и перевод; `--lang=ru` —
// только перевод (нужно проверке детерминированности: один прогон — один
// результат), `--lang=en` — только оригинал, как было.
const LANG_ARG = arg('lang');
const DO_RU = LANG_ARG !== 'en';
const DO_EN = LANG_ARG !== 'ru';
const outArg = arg('out');
const OUT = path.resolve(ROOT, typeof outArg === 'string'
  ? outArg
  : (NO_FULL_TEXT ? 'app/reference-no-text' : 'app/reference'));

if (NO_FULL_TEXT && typeof outArg !== 'string' && OUT === path.join(ROOT, 'app', 'reference')) {
  console.error('build-reference: --no-full-text без --out перезаписал бы полный текст');
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (rel, data, indent = 0) => {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, indent) + '\n');
  return file;
};

/* =========================================================== разбор текста */

const FENCE = /^(\s*)```(.*)$/;
const HEADING = /^(#{1,6})\s+/;
const BULLET = /^(\s*)[-*]\s+/;
const QUOTE = /^\s*>\s?/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** Тип ограды: ```ocl — OCL, ```text — ASCII-арт метамодели, прочее — текст. */
function fenceKind(lang, first) {
  const l = String(lang || '').trim().toLowerCase();
  if (l === 'ocl' || l === 'ocl2' || l === 'uml') return 'ocl';
  if (l === 'text' || l === 'txt' || l === '') {
    return /^(inv|body|pre|post|derive|def|init)\b/.test(String(first || '').trim()) ? 'ocl' : 'text';
  }
  return l === 'java' || l === 'sql' ? 'text' : 'text';
}

/**
 * Параграф-примечание: «NOTE. …» в стандарте — врезка, а не строка текста.
 * В переводе та же врезка начинается с «ПРИМЕЧАНИЕ.» — метка остаётся своя,
 * чтобы примечание не превратилось в обычный абзац.
 */
function noteOf(text) {
  // Граница слова — не \b: в кириллице «Е» для него не буква, и «ПРИМЕЧАНИЕ.»
  // переставало быть врезкой. Проверяем именно следующую букву.
  const m = /^(NOTE|ПРИМЕЧАНИЕ|Примечание)(?![A-Za-zА-Яа-яЁё])[.:]?\s*([\s\S]*)$/.exec(text);
  return m ? { t: 'note', label: m[1], text: m[2].trim() } : null;
}

function table(lines, start) {
  const rows = [];
  let i = start;
  while (i < lines.length && TABLE_ROW.test(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  if (rows.length < 2) return null;
  const sep = rows[1].every((c) => /^:?-{2,}:?$/.test(c.trim()));
  if (!sep) return null;
  return { block: { t: 'table', head: rows[0], rows: rows.slice(2) }, next: i };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * Тело клаузы → блоки. `constraints` включает разбор списка констрейнтов:
 * в стандарте констрейнт — это пункт списка «- **имя**», под ним текст и
 * блок OCL; такой список рендерится карточками .kv, а не <ul>.
 */
function parseBlocks(lines, { constraints = false } = {}) {
  const out = [];
  const stats = { paragraphs: 0, lists: 0, constraints: 0, ocl: 0, notes: 0, tables: 0 };
  let i = 0;

  const paragraph = () => {
    const buf = [];
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) break;
      if (FENCE.test(line) || HEADING.test(line) || BULLET.test(line)
        || QUOTE.test(line) || TABLE_ROW.test(line)) break;
      buf.push(line.trim());
      i += 1;
    }
    return buf.join(' ').replace(/\s+/g, ' ').trim();
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (HEADING.test(line)) { i += 1; continue; }   // границы клауз уже разрезаны деревом

    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[2];
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;                                        // закрывающая ограда
      const text = body.join('\n').replace(/\s+$/, '');
      if (!text) continue;
      const kind = fenceKind(lang, body[0]);
      out.push({ t: kind, text });
      if (kind === 'ocl') stats.ocl += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE.test(lines[i])) { buf.push(lines[i].replace(QUOTE, '')); i += 1; }
      const text = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const bold = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(text);
      out.push({ t: 'note', label: bold ? bold[1] : 'NOTE', text: (bold ? bold[2] : text).trim() });
      stats.notes += 1;
      continue;
    }

    if (TABLE_ROW.test(line)) {
      const parsed = table(lines, i);
      if (parsed) { out.push(parsed.block); stats.tables += 1; i = parsed.next; continue; }
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (constraints) {
        // Констрейнты: каждый пункт — отдельная карточка .kv.
        while (i < lines.length && BULLET.test(lines[i])) {
          const m = /^\s*[-*]\s+\*\*(.+?)\*\*\s*$/.exec(lines[i]);
          if (!m) break;
          const name = m[1].trim();
          i += 1;
          const body = [];
          while (i < lines.length && !(BULLET.test(lines[i]) && /^\s*[-*]\s+\*\*/.test(lines[i]))) {
            body.push(lines[i]);
            i += 1;
          }
          const inner = parseBlocks(body.map((l) => l.replace(/^ {1,4}/, '')), {});
          const parts = inner.out.filter((b) => b.t === 'p' || b.t === 'ul' || b.t === 'note');
          const ocls = inner.out.filter((b) => b.t === 'ocl');
          const text = parts.length
            ? parts.map((b) => (b.t === 'p' ? b.text : b.t === 'ul' ? b.items.join('; ') : b.text)).join(' ')
            : null;
          out.push({ t: 'kv', name, text, ocl: ocls.length ? ocls.map((b) => b.text).join('\n\n') : null });
          stats.constraints += 1;
        }
        if (i < lines.length && BULLET.test(lines[i])) {
          // Список без имён — обычный список, не теряем его.
          const ul = { t: 'ul', items: [] };
          while (i < lines.length && BULLET.test(lines[i])) {
            ul.items.push(lines[i].replace(BULLET, '').trim());
            i += 1;
          }
          out.push(ul);
          stats.lists += 1;
        }
        continue;
      }
      const ul = { t: 'ul', items: [] };
      // Пункты в стандарте разделены пустой строкой; пустая строка не должна
      // рвать список на девять списков по одному пункту.
      while (i < lines.length) {
        if (BULLET.test(lines[i])) {
          const m = /^\s*[-*]\s+([\s\S]*)$/.exec(lines[i]);
          ul.items.push(m[1].trim());
          i += 1;
          continue;
        }
        if (!lines[i].trim()) {
          let j = i;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (j < lines.length && BULLET.test(lines[j]) && !HEADING.test(lines[j])) { i = j; continue; }
        }
        break;
      }
      out.push(ul);
      stats.lists += 1;
      continue;
    }

    const text = paragraph();
    if (!text) { i += 1; continue; }
    const note = noteOf(text);
    if (note) { out.push(note); stats.notes += 1; } else { out.push({ t: 'p', text }); stats.paragraphs += 1; }
  }

  return { out, stats };
}

/* ============================================================ дерево и файлы */

const tree = readJson(path.join(SOURCE, 'spec-tree.json'));
const sectionsMeta = readJson(path.join(SOURCE, 'spec-sections.json'));
const crossrefs = readJson(path.join(SOURCE, 'crossrefs.json'));
const searchIndex = readJson(path.join(SOURCE, 'search-index.json'));
const rules = readJson(path.join(ROOT, 'app', 'notation', 'rules', 'uml-2.5.1.json'));
const notation = readJson(path.join(ROOT, 'app', 'notation', 'uml.json'));
const grammar = readJson(path.join(ROOT, 'docs', 'plantuml-grammar.json'));

/* ---------------------------------------------------- причины «не проверяется» */
/*
 * У 426 констрейнтов стандарта нет правила движка, и у каждого в
 * docs/RULES-SOURCE.md названа причина отказа: «наша модель не хранит
 * переменные активностей» и т. п. Читалка не имеет права писать одно и то же
 * «нет среди 23 правил» — это ответ на вопрос «есть ли правило», а не «почему
 * его нет». Таблица документа разбирается здесь один раз и уезжает в статьи
 * полем `why` блока kv.
 */
const reasons = new Map();
{
  const doc = readFileSync(path.join(ROOT, 'docs', 'RULES-SOURCE.md'), 'utf8');
  const ROW = /^\|\s*([0-9][0-9.]*)\s*\(с\.\s*\d+\)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/gm;
  let m;
  while ((m = ROW.exec(doc))) reasons.set(`${m[1]}|${m[2]}`, m[3].trim().replace(/\.$/, ''));
}

/**
 * Номер типа диаграммы из карточки («3.3») → название. Номера — разделы
 * docs/DIAGRAM-TYPES.md §3: карточка нотации ссылается на них полем `diagrams`,
 * и человеку нужно название, а не параграф документации.
 */
const DIAGRAM_LABELS = {
  '3.1': 'вариантов использования',
  '3.2': 'деятельности',
  '3.3': 'классов',
  '3.4': 'последовательности',
  '3.5': 'пакетов',
  '3.6': 'составной структуры',
  '3.7': 'размещения',
  '3.8': 'состояний',
};

/** Тип диаграммы приложения → номер раздела DIAGRAM-TYPES.md (для догадок). */
const DIAGRAM_SECTION = {
  usecase: '3.1', activity: '3.2', class: '3.3', sequence: '3.4',
  package: '3.5', composite: '3.6', deployment: '3.7', state: '3.8',
};

// spec-tree называет файлы с нулём впереди («01-scope.md»), на диске они без
// него («1-scope.md»): сверяемся по spec-sections.json, а не по догадке.
const sectionFile = new Map(sectionsMeta.sections.map((s) => [s.number, s.file.split('/').pop()]));

/** «printed pp. 183–240 · PDF pp. 225–282» из шапки раздела (и её русский вид). */
function sectionPages(head) {
  const printed = /(?:printed pp?\.|печатные стр\.)\s*([0-9ivxlcdm–-]+)/i.exec(head);
  const pdf = /PDF (?:pp?\.|стр\.)\s*([0-9–-]+)/i.exec(head);
  return {
    printed: printed ? printed[1] : null,
    pdf: pdf ? pdf[1] : null,
  };
}

const ruleByKey = new Map();
for (const r of rules) ruleByKey.set(`${r.source.clause}|${r.source.name}`, r);

/** Узел → статья: номер, заголовок, блоки тела без детей. */
function articleOf(node, lines, section, opts = {}) {
  const children = node.children ?? [];
  const endOfBody = children.length ? children[0].lines[0] - 1 : node.lines[1];
  let body = lines.slice(node.lines[0], Math.max(node.lines[0], endOfBody));
  // Шапка файла раздела («> **UML 2.5.1** … printed pp. 183–240») — это
  // выходные данные источника, а не текст пункта. Она попадает только в тело
  // корневого узла и в статью не идёт: страницы раздела уже стоят в meta.
  let k = 0;
  while (k < body.length && !body[k].trim()) k += 1;
  if (body[k] && /^\s*>\s*\*\*UML 2\.5\.1\*\*/.test(body[k])) {
    while (k < body.length && (!body[k].trim() || /^\s*>/.test(body[k]))) k += 1;
    body = body.slice(k);
  }
  // В переводе заголовок «Constraints» звучит иначе; признак берётся у
  // английского узла — структура файлов совпадает 1:1 по номерам.
  const isConstraints = opts.constraints ?? (node.title === 'Constraints');
  const { out, stats } = parseBlocks(body, { constraints: isConstraints });

  if (isConstraints) {
    for (const b of out) {
      if (b.t !== 'kv') continue;
      const rule = ruleByKey.get(`${node.number}|${b.name}`);
      if (rule) { b.rule = rule.id; b.level = rule.level; } else {
        b.rule = null;
        // Почему не проверяется — из таблицы отказов, а не общей фразой.
        b.why = reasons.get(`${node.number}|${b.name}`) ?? null;
      }
    }
  }

  const blocks = NO_FULL_TEXT
    ? out.filter((b) => b.t === 'kv').map((b) => ({
      t: 'kv', name: b.name, text: null, ocl: b.ocl, rule: b.rule ?? null, level: b.level ?? null,
      why: b.why ?? null,
    }))
    : out;

  return {
    article: {
      id: node.id,
      number: node.number,
      title: node.title,
      level: node.level,
      section: section.number,
      blocks,
      stats: {
        paragraphs: NO_FULL_TEXT ? 0 : stats.paragraphs,
        lists: NO_FULL_TEXT ? 0 : stats.lists,
        constraints: stats.constraints,
        ocl: stats.ocl,
        chars: NO_FULL_TEXT ? 0 : body.join('\n').trim().length,
      },
    },
    tree: children.map((c) => ({ id: c.id, number: c.number, title: c.title, level: c.level })),
  };
}

/* ------------------------------- статья → её подраздел Constraints (Б20б) */

/*
 * В стандарте констрейнты метакласса лежат не в статье о нём, а в подразделе
 * «NN.x.y Constraints» описаний: нотация 11.5.4 «Notation» и 11.8.1.8
 * «Constraints» — один и тот же Association. Правило поиска:
 *
 *   1. свой подраздел Constraints: A.B.C.N с заголовком «Constraints»
 *      (в дереве 157 таких подразделов);
 *   2. иначе — статья-описание «<Метакласс> [Class]» того же раздела, взятая
 *      по предмету статьи: ближайший предок с неслужебным заголовком
 *      («Associations» → «Association»), у этого описания — его Constraints.
 *
 * Пункты самого описания (11.8.1.5 Attributes и т. п.) констрейнты не
 * получают: они стоят в той же группе, что и раздел Constraints, и повторять
 * его на каждой странице было бы шумом.
 */
const GENERIC_TITLES = new Set([
  'summary', 'abstract syntax', 'semantics', 'notation', 'examples', 'constraints',
  'description', 'diagrams', 'generalizations', 'specializations', 'attributes',
  'association ends', 'member ends', 'owned ends', 'operations', 'literals',
  'redefinitions', 'constraints and semantics',
]);

const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const singular = (s) => {
  const w = String(s).trim();
  if (/ies$/i.test(w)) return w.replace(/ies$/i, 'y');
  if (/(sses|shes|ches|xes)$/i.test(w)) return w.slice(0, -2);
  if (/[^s]s$/i.test(w)) return w.slice(0, -1);
  return w;
};
const depthOf = (num) => String(num).split('.').length;
const groupOf = (num) => String(num).split('.').slice(0, -1).join('.');

function constraintsIndex(nodes) {
  const at = new Map(nodes.map((n, i) => [n.id, i]));
  const kids = (n) => nodes.filter((a) => depthOf(a.number) === depthOf(n.number) + 1
    && a.number.startsWith(`${n.number}.`));
  const parentOf = (n) => {
    let i = at.get(n.id);
    while (i > 0) {
      i -= 1;
      if (nodes[i].level < n.level) return nodes[i];
    }
    return null;
  };

  // «Association [Class]» → его Constraints. Ключ — имя метакласса без числа.
  const described = new Map();
  for (const n of nodes) {
    const m = /^(.+?)\s*\[[^\]]+\]$/.exec(n.title);
    if (!m) continue;
    const con = kids(n).find((k) => k.title === 'Constraints');
    if (!con) continue;
    const key = normName(singular(m[1]));
    if (key && !described.has(key)) described.set(key, con);
  }

  const out = new Map();
  for (const n of nodes) {
    if (n.title === 'Constraints') continue;
    let con = kids(n).find((k) => k.title === 'Constraints') ?? null;
    if (!con) {
      let subject = n;
      while (subject && GENERIC_TITLES.has(subject.title.toLowerCase())) subject = parentOf(subject);
      if (!subject) continue;
      const name = subject.title.replace(/\s*\[[^\]]+\]$/, '');
      con = described.get(normName(singular(name))) ?? null;
    }
    if (!con || con.id === n.id) continue;
    // Своя группа описания констрейнты не повторяет.
    const group = groupOf(con.number);
    if (!con.number.startsWith(`${n.number}.`)
      && (n.number === group || n.number.startsWith(`${group}.`))) continue;
    out.set(n.number, { n: con.number, i: con.id });
  }
  return out;
}


/* ============================== второй проход: русский перевод (Э12) */

/*
 * Перевод лежит в material/spec-ru/ru/<NN>-slug.md и повторяет структуру
 * оригинала один в один: те же заголовки, те же номера, те же ограды, те же
 * блоки OCL и ASCII-арта побайтово. Поэтому статьи сопоставляются не текстом,
 * а номером пункта: id берётся у АНГЛИЙСКОГО узла из spec-tree.json
 * (`9.2.2` → `9.2.2-abstract-syntax`). Считать id от русского заголовка
 * нельзя — вышел бы `9.2.2-абстрактный-синтаксис`, то есть другая статья,
 * и переключатель языка открывал бы не тот пункт.
 *
 * Разбор markdown — тот же parseBlocks/articleOf, что у оригинала: копии
 * разбора нет, есть второй прогон по другому каталогу.
 */

const RU_DIR = path.join(ROOT, 'material', 'spec-ru', 'ru');
const RU_GLOSSARY = path.join(ROOT, 'material', 'spec-ru', 'glossary.json');

// Отбор пунктов в поисковый индекс — те же правила, что у
// build_search_index.py, но применённые к АНГЛИЙСКОМУ заголовку: набор
// пунктов не должен зависеть от языка.
const INDEX_PROSE = new Set(['summary', 'semantics', 'notation', 'examples', 'overview',
  'scope', 'description', 'structure', 'abstract syntax']);
const INDEX_SKIP = new Set(['constraints', 'diagrams', 'generalizations', 'specializations',
  'attributes', 'association ends', 'operations']);
const INDEX_DROP = new Set([...INDEX_SKIP, 'description', 'constraints and semantics']);
const ASSOC_ONLY = /^A_\w+ \[Association\]$/;

const base36 = (n) => {
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  if (n === 0) return '0';
  let out = '';
  let v = n;
  while (v > 0) { out = digits[v % 36] + out; v = Math.floor(v / 36); }
  return out;
};

/**
 * Русские словоформы: обрубок основы дописывается в постинги рядом со словом.
 * Без него «дорожка» не находит «дорожки» — сравнение по началу слова требует
 * разницы не больше трёх букв, а окончания расходятся сильнее. Механизм
 * постингов общий: новые термины, а не новый поиск.
 */
function stemsOf(token) {
  if (token.length < 6 || !/[а-я]/.test(token)) return [];
  const out = [token.slice(0, -1)];
  if (token.length >= 8) out.push(token.slice(0, -2));
  return out;
}

/** Заголовки файла → узлы с интервалами строк: алгоритм parse_spec.py. */
function headingTree(lines) {
  const nodes = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```\s*[A-Za-z0-9_-]*\s*$/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(\S.*?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    let title = m[2].trim();
    let number = null;
    // Приложения названы по-разному: «Annex A: …» в оригинале и
    // «Приложение A: …» в переводе — номер у обоих один.
    const annex = /^(?:Annex|Приложение)\s+([A-Z])\s*:\s*(.*)$/.exec(title);
    if (annex) {
      number = `Annex ${annex[1]}`;
      title = annex[2].trim();
    } else {
      const nm = /^(\d+(?:\.\d+)*)\s+(.*)$/.exec(title);
      if (nm) { number = nm[1]; title = nm[2].trim(); }
    }
    nodes.push({ level, title, number, start: i, children: [] });
  }
  // Конец узла — начало следующего заголовка того же или старшего уровня.
  nodes.forEach((n, idx) => {
    let end = n.start + 1;
    let closed = false;
    for (let j = idx + 1; j < nodes.length; j += 1) {
      if (nodes[j].level <= n.level) { end = nodes[j].start; closed = true; break; }
      end = Math.max(end, nodes[j].start + 1);
    }
    n.end = Math.min(closed ? end : Math.max(end, lines.length), lines.length);
  });
  // Родитель — ближайший предыдущий заголовок старшего уровня.
  const stack = [];
  for (const n of nodes) {
    while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(n);
    stack.push(n);
  }
  return nodes;
}

function buildRuPass() {
  if (existsSync(path.join(OUT, 'spec-ru'))) rmSync(path.join(OUT, 'spec-ru'), { recursive: true, force: true });

  const glossarySrc = readJson(RU_GLOSSARY);
  const pairs = (glossarySrc.terms ?? []).filter((t) => t && t.en && t.ru);

  const specIndexRu = [];
  const clausesRu = [];
  const untranslated = [];
  const docs = [];
  const postings = new Map();
  let blockCount = 0;
  let chars = 0;

  const addDoc = (kind, ref, text, line, weight) => {
    const idx = docs.length;
    docs.push([kind, ref, text, line, weight]);
    for (const tok of new Set(tokenize(text))) {
      for (const t of [tok, ...stemsOf(tok)]) {
        if (!postings.has(t)) postings.set(t, new Set());
        postings.get(t).add(idx);
      }
    }
  };

  for (const [si, section] of tree.sections.entries()) {
    // Все узлы английского раздела в порядке документа: по ним берутся id.
    const engNodes = [];
    const walkEng = (n) => { engNodes.push(n); for (const c of n.children ?? []) walkEng(c); };
    walkEng(section);
    const engByNumber = new Map(engNodes.filter((n) => n.number).map((n) => [n.number, n]));
    const consOf = constraintsIndex(engNodes);

    const ruFile = `${String(si + 1).padStart(2, '0')}-${section.file.split('-').slice(1).join('-')}`;
    const ruPath = path.join(RU_DIR, ruFile);
    if (!existsSync(ruPath)) {
      for (const n of engNodes) if (n.number) untranslated.push(n.number);
      specIndexRu.push({
        number: section.number, title: section.title, id: section.id, ru: false,
        file: null, level: 1, pages: { printed: null, pdf: null }, chars: 0,
        nodes: engNodes.length, constraints: !!section.constraints, children: [],
      });
      continue;
    }

    const textRu = readFileSync(ruPath, 'utf8');
    const linesRu = textRu.split('\n');
    const ruNodes = headingTree(linesRu);
    const ruTitle = ruNodes[0]?.title ?? section.title;
    const pages = sectionPages(linesRu.slice(0, 4).join(' '));

    // Сопоставление по номеру пункта — не по тексту заголовка.
    const mapped = new Map();
    for (const rn of ruNodes) {
      const eng = rn.number ? engByNumber.get(rn.number) : null;
      if (!eng) { untranslated.push(rn.number ?? rn.title); continue; }
      rn.id = eng.id;
      rn.lines = [rn.start + 1, rn.end];
      mapped.set(rn, eng);
    }
    const articles = [];
    const treeNodes = [];
    let sectionChars = 0;
    for (const rn of ruNodes) {
      const eng = mapped.get(rn);
      if (!eng) continue;
      const built = articleOf(rn, linesRu, section, { constraints: eng.title === 'Constraints' });
      const art = built.article;
      art.stats.lang = 'ru';
      articles.push(art);
      blockCount += art.blocks.length;
      sectionChars += art.stats.chars;
      chars += art.stats.chars;
      treeNodes.push({ id: art.id, number: art.number, title: art.title, level: art.level });

      // --- поисковый индекс перевода (тот же механизм постингов) ---
      const base = String(eng.title).toLowerCase().split('(')[0].trim();
      if (eng.number && !ASSOC_ONLY.test(eng.title) && !INDEX_DROP.has(String(eng.title).toLowerCase())) {
        addDoc(0, rn.number, rn.title, rn.start + 1, eng.level <= 3 ? 1.15 : 1.0);
      }
      if (eng.level <= 4 && !String(eng.section ?? '').includes('Descriptions')
        && !INDEX_SKIP.has(base) && INDEX_PROSE.has(base)) {
        for (const b of art.blocks) {
          // Примечание — тоже проза: в оригинале оно попадает в индекс
          // абзацев, и перевод обязан искаться так же.
          if ((b.t !== 'p' && b.t !== 'note') || !b.text || b.text.length < 60) continue;
          const snippet = b.text.length > 96 ? `${b.text.slice(0, 93).replace(/\s+$/, '')}…` : b.text;
          addDoc(1, rn.number, snippet, rn.start + 1, 0.85);
        }
      }
    }

    const outName = String(section.number).replace(/[^0-9A-Za-z]/g, '');
    const fileId = `${outName.toLowerCase()}.json`;
    write(`spec-ru/${fileId}`, {
      schema: 'uml-reference-section/1',
      lang: 'ru',
      section: {
        number: section.number,
        title: ruTitle,
        id: section.id,
        file: ruFile,
        pages,
        source: 'UML 2.5.1 (formal/2017-12-05)',
        translated: ruNodes.length === engNodes.length,
        constraints: !!section.constraints,
        constraintNodes: section.constraintNodes ?? [],
        chars: sectionChars,
      },
      tree: treeNodes,
      articles,
    });

    const ruTitleOf = new Map(treeNodes.map((n) => [n.number, n.title]));
    specIndexRu.push({
      number: section.number,
      title: ruTitle,
      id: section.id,
      ru: true,
      file: `spec-ru/${fileId}`,
      level: 1,
      pages,
      chars: sectionChars,
      nodes: treeNodes.length,
      constraints: !!section.constraints,
      children: (section.children ?? []).map((c) => ({
        number: c.number, title: ruTitleOf.get(c.number) ?? c.title, id: c.id,
        level: c.level, nodes: 1 + countNodes(c), constraints: !!c.constraints,
      })),
    });

    // Раздел «Constraints» у статьи — та же ссылка, что в оригинале: id общие.
    for (const n of treeNodes) {
      clausesRu.push({
        n: n.number, t: n.title, i: n.id, l: n.level, s: section.number,
        c: consOf.get(n.number) ?? null,
      });
    }
  }

  write('spec-ru/index.json', {
    schema: 'uml-reference-spec/1',
    lang: 'ru',
    source: {
      document: 'UML 2.5.1 (formal/2017-12-05)',
      translation: 'material/spec-ru/ru — неофициальный перевод, OMG его не заверял',
      notice: 'reference/NOTICE.md',
      fullText: !NO_FULL_TEXT,
      chars,
    },
    stats: { sections: specIndexRu.length, nodes: clausesRu.length, blocks: blockCount, chars },
    sections: specIndexRu,
    clauses: clausesRu,
  });

  // Манифест доступности: по нему читалка решает, есть ли у пункта перевод.
  write('spec/i18n.json', {
    schema: 'uml-reference-i18n/1',
    langs: ['en', 'ru'],
    sections: Object.fromEntries(specIndexRu.map((s) => [s.number, { ru: !!s.ru }])),
    stats: {
      sections: specIndexRu.filter((s) => s.ru).length,
      clauses: clausesRu.length,
      blocks: blockCount,
      chars,
    },
    untranslated: [...new Set(untranslated)],
  }, 1);

  // Словарь терминов — для страницы «Словарь терминов» и подсказок в тексте.
  write('glossary.json', {
    schema: 'uml-reference-glossary/1',
    source: 'material/spec-ru/glossary.json',
    count: pairs.length,
    terms: pairs.map((t) => ({
      en: t.en, ru: t.ru, kind: t.kind ?? null, note: t.note ?? null,
    })),
  }, 1);

  // Псевдонимы в обе стороны: латиница находит русское, кириллица — английское.
  const glossaryRu = {};
  for (const t of pairs) {
    const ru = String(t.ru).trim();
    const ruKey = ru.toLowerCase().replace(/ё/g, 'е');
    const enKey = String(t.en).trim().toLowerCase();
    if (ruKey && !glossaryRu[ruKey]) glossaryRu[ruKey] = String(t.en).trim();
    if (enKey && !glossaryRu[enKey]) glossaryRu[enKey] = ru;
  }

  const postOut = {};
  for (const key of [...postings.keys()].sort()) {
    postOut[key] = [...postings.get(key)].sort((a, b) => a - b).map(base36).join(',');
  }

  write('search-ru.json', {
    schema: 'uml-search/1',
    lang: 'ru',
    generators: ['app/tools/build-reference.mjs --lang=ru'],
    kinds: ['spec-node', 'spec-para', 'rule', 'stereotype', 'shape', 'connector', 'exercise', 'plantuml'],
    docFields: ['kind', 'ref', 'text', 'line', 'weight'],
    ranking: searchIndex.ranking,
    stats: {
      docs: docs.length,
      docsByKind: {
        'spec-node': docs.filter((d) => d[0] === 0).length,
        'spec-para': docs.filter((d) => d[0] === 1).length,
      },
      terms: Object.keys(postOut).length,
      postings: [...postings.values()].reduce((n, s) => n + s.size, 0),
    },
    glossary: glossaryRu,
    anchors: searchIndex.anchors ?? [],
    docs,
    postings: postOut,
  });

  if (!QUIET) {
    const kb = (n) => `${(n / 1024).toFixed(0)} КБ`;
    console.log(`build-reference: перевод → ${path.join(OUT, 'spec-ru').replace(`${ROOT}/`, '')}`);
    console.log(`  разделов ${specIndexRu.filter((s) => s.ru).length} · клауз ${clausesRu.length} · блоков ${blockCount} · текста ${kb(chars)}`);
    console.log(`  терминов словаря ${pairs.length} · поиск ${docs.length} документов, ${Object.keys(postOut).length} терминов`);
    console.log(untranslated.length
      ? `  БЕЗ ПЕРЕВОДА: ${[...new Set(untranslated)].slice(0, 12).join(', ')}`
      : '  все пункты переведены: 3 690 из 3 690');
  }

  return { specIndexRu, clausesRu, untranslated, docs, postOut };
}

/* ================================================================== сборка */

if (LANG_ARG === 'ru') {
  buildRuPass();
  process.exit(0);
}

if (existsSync(path.join(OUT, 'spec'))) rmSync(path.join(OUT, 'spec'), { recursive: true, force: true });

const specIndex = [];
const flat = [];                 // все клаузы по порядку: номер ↔ id ↔ файл
let blockCount = 0;
let chars = 0;

const sectionById = new Map(sectionsMeta.sections.map((s) => [s.number, s]));

for (const section of tree.sections) {
  const file = sectionFile.get(section.number) ?? section.file;
  const text = readFileSync(path.join(SOURCE, 'spec-sections', file), 'utf8');
  const lines = text.split('\n');
  const head = lines.slice(0, 4).join(' ');
  const pages = sectionPages(head);

  const articles = [];
  const nodes = [];
  const walk = (node) => {
    nodes.push({ id: node.id, number: node.number, title: node.title, level: node.level });
    const built = articleOf(node, lines, section);
    articles.push(built.article);
    blockCount += built.article.blocks.length;
    chars += built.article.stats.chars;
    for (const child of node.children ?? []) walk(child);
  };
  walk(section);

  const meta = sectionById.get(section.number) ?? {};
  const outName = String(section.number).replace(/[^0-9A-Za-z]/g, '');
  const fileId = `${outName.toLowerCase()}.json`;
  write(`spec/${fileId}`, {
    schema: 'uml-reference-section/1',
    section: {
      number: section.number,
      title: section.title,
      id: section.id,
      file,
      pages,
      source: 'UML 2.5.1 (formal/2017-12-05)',
      constraints: !!section.constraints,
      constraintNodes: section.constraintNodes ?? [],
      chars: section.charsSubtree ?? meta.chars ?? 0,
    },
    tree: nodes,
    articles,
  });

  specIndex.push({
    number: section.number,
    title: section.title,
    id: section.id,
    file: `spec/${fileId}`,
    level: 1,
    pages,
    chars: section.charsSubtree ?? 0,
    nodes: nodes.length,
    constraints: !!section.constraints,
    children: (section.children ?? []).map((c) => ({
      number: c.number, title: c.title, id: c.id, level: c.level,
      nodes: 1 + countNodes(c), constraints: !!c.constraints,
    })),
  });

  const consOf = constraintsIndex(nodes);
  for (const node of nodes) {
    flat.push({
      id: node.id, number: node.number, title: node.title, level: node.level,
      section: section.number, file: `spec/${fileId}`, cons: consOf.get(node.number) ?? null,
    });
  }
}

function countNodes(node) {
  return (node.children ?? []).reduce((n, c) => n + 1 + countNodes(c), 0);
}

write('spec/index.json', {
  schema: 'uml-reference-spec/1',
  source: {
    document: 'UML 2.5.1 (formal/2017-12-05)',
    notice: 'reference/NOTICE.md',
    fullText: !NO_FULL_TEXT,
    chars: 1721620,
  },
  stats: { sections: specIndex.length, nodes: flat.length, blocks: blockCount, chars },
  // Дерево для навигации: разделы и плоский список всех клауз в порядке
  // стандарта. Плоский список — чтобы переход по номеру, «предыдущий /
  // следующий» и ссылки в тексте не требовали загрузки всех 25 файлов:
  // тело статьи грузится одно, по номеру раздела.
  sections: specIndex,
  clauses: flat.map((c) => ({
    n: c.number, t: c.title, i: c.id, l: c.level, s: c.section, c: c.cons,
  })),
});

/* --------------------------------------------------------------- карточки */

const cardFiles = readdirSync(CARDS).filter((f) => f.endsWith('.json')).sort();
const cards = {};
for (const f of cardFiles) {
  const card = JSON.parse(readFileSync(path.join(CARDS, f), 'utf8'));
  if (!card?.key) continue;
  // Один ключ встречается дважды: «merge» есть и фигурой, и связью
  // (merge.shape.json / merge.connector.json). 51 + 27 = 78 карточек, поэтому
  // ключ карты — вид и имя, а не одно имя: иначе одна карточка исчезла бы.
  const id = `${card.kind}:${card.key}`;
  // Название типа диаграммы рядом с номером раздела docs/DIAGRAM-TYPES.md:
  // «3.3» — ссылка на параграф документа, человеку нужно «диаграмма классов».
  cards[id] = { id, ...card, diagramsLabel: DIAGRAM_LABELS[card.diagrams] ?? null };
}
write('cards.json', { schema: 'uml-reference-cards/1', count: Object.keys(cards).length, cards });

/* ------------------------------------------------------------ стереотипы */

const stereotypes = (crossrefs.stereotypeToShape?.stereotypes ?? [])
  .map((s) => ({
    name: s.name,
    baseType: s.baseType,
    group: s.group,
    abstract: !!s.abstract,
    shape: s.shape ?? null,
    shapeKind: s.shapeKind ?? null,
    confidence: s.confidence ?? 'guess',
    basis: s.basis ?? null,
  }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
write('stereotypes.json', {
  schema: 'uml-reference-stereotypes/1',
  count: stereotypes.length,
  groups: [...new Set(stereotypes.map((s) => s.group))].sort(),
  stereotypes,
});

/* --------------------------------------------------------------- PlantUML */

const plantuml = [];
for (const [diagram, def] of Object.entries(grammar.diagrams)) {
  for (const c of def.constructs ?? []) {
    plantuml.push({
      id: c.id,
      diagram,
      diagramTitle: def.title ?? diagram,
      syntax: c.syntax ?? '',
      sourceClass: c.sourceClass ?? '',
      modelElement: c.modelElement ?? null,
      note: c.note ?? null,
      verified: c.verified ?? null,
    });
  }
}
write('plantuml.json', {
  schema: 'uml-reference-plantuml/1',
  version: grammar.version,
  // Регулярка разбора (`pattern`) в читалку не идёт: это исходник грамматики,
  // а не справка. Полная грамматика — docs/research/PLANTUML-GRAMMAR.md.
  count: plantuml.length,
  diagrams: Object.entries(grammar.diagrams).map(([id, d]) => ({
    id, title: d.title ?? id, count: (d.constructs ?? []).length,
  })),
  constructs: plantuml,
});

/* ------------------------------------------------------------------ связи */

const confidenceOf = (v) => (v === 'exact' || v === 'derived' || v === 'guess' ? v : 'guess');
const clauseOf = (c) => (c ? { number: c.number, title: c.title, id: c.id } : null);

const links = { notation: [], rules: [], stereotypes: [], figures: [], exercises: [] };
for (const group of ['shapes', 'connectors']) {
  for (const [key, e] of Object.entries(crossrefs.notationToClause?.[group] ?? {})) {
    // У фигуры «text» пункта нет: crossrefs сам это говорит (clause: null).
    // Связь без адреса — не связь, поэтому в граф она не попадает.
    if (!e.clause) continue;
    links.notation.push({
      id: key,
      kind: group === 'shapes' ? 'shape' : 'connector',
      label: e.label ?? notation.shapes[key]?.label ?? notation.connectors[key]?.label ?? key,
      clause: clauseOf(e.clause),
      confidence: confidenceOf(e.confidence),
      howTarget: e.howTarget ?? null,
      basis: e.basis ?? [],
    });
  }
}
for (const r of crossrefs.rulesToClause ?? []) {
  links.rules.push({
    id: r.id,
    clause: clauseOf(r.clause),
    constraint: r.constraint ?? null,
    metaclass: r.metaclass ?? null,
    confidence: confidenceOf(r.confidence),
    basis: r.basis ?? [],
  });
}
for (const s of stereotypes) {
  links.stereotypes.push({
    name: s.name,
    baseType: s.baseType,
    shape: s.shape,
    shapeKind: s.shapeKind,
    confidence: s.confidence,
    basis: s.basis,
  });
}
for (const f of crossrefs.figureToModel ?? []) {
  links.figures.push({
    figureNo: f.figureNo,
    model: f.model ?? null,
    type: f.type ?? null,
    exercise: f.exercise ?? null,
    reproducible: f.reproducible ?? null,
    confidence: confidenceOf(f.confidence),
  });
}
for (const e of crossrefs.exerciseToModel ?? []) {
  links.exercises.push({
    number: e.number,
    title: e.title ?? '',
    models: e.models ?? [],
    figures: e.figures ?? [],
    confidence: confidenceOf(e.confidence),
  });
}

/* --------------------- рёбра «пункт → пособие» и «пункт → PlantUML» (Б20г) */

/*
 * В графе не хватало двух родов рёбер, без которых «Связано» на пункте
 * стандарта показывает только нотацию и правила:
 *
 *   пункт → упражнение/рисунок  упражнение (или рисунок) рисует фигуру,
 *                                которая связана с этим пунктом;
 *   пункт → PlantUML             конструкция языка даёт ту же фигуру, что
 *                                карточка нотации этого пункта.
 *
 * Каждое ребро — с confidence и basis: «derived» значит, что фигура реально
 * нашлась в файле модели упражнения (это проверяемо), «guess» — что совпал
 * только тип диаграммы, а состава модели нет. В читалке догадка показывается
 * чипом plain, как и прочие.
 */
links.tutorial = [];
links.plantuml = [];

/** Виды элементов и связей файла модели: что упражнение действительно рисует. */
const modelKinds = new Map();
function kindsOfModel(rel) {
  if (modelKinds.has(rel)) return modelKinds.get(rel);
  let set = null;
  for (const base of [ROOT, path.join(ROOT, 'app')]) {
    try {
      const model = JSON.parse(readFileSync(path.join(base, rel), 'utf8'));
      set = new Set([
        ...(model.elements ?? []).map((e) => e.kind),
        ...(model.relationships ?? []).map((r) => r.kind),
      ].filter(Boolean));
      break;
    } catch { /* файла нет по этому корню — пробуем второй */ }
  }
  modelKinds.set(rel, set);
  return set;
}

// Фигуры пункта — вход обеих групп: у фигуры есть карточка, у карточки —
// конструкция PlantUML и тип диаграммы.
const clauseFigures = new Map();
for (const n of links.notation) {
  if (!n.clause) continue;
  const card = cards[`${n.kind}:${n.id}`] ?? null;
  const list = clauseFigures.get(n.clause.number) ?? [];
  list.push({
    id: n.id,
    kind: n.kind,
    label: n.label,
    confidence: n.confidence,
    diagrams: card?.diagrams ?? null,
    card,
  });
  clauseFigures.set(n.clause.number, list);
}

const figuresByExercise = new Map();
for (const f of links.figures) {
  if (!f.exercise) continue;
  const list = figuresByExercise.get(f.exercise) ?? [];
  list.push(f);
  figuresByExercise.set(f.exercise, list);
}

{
  const clauseOfNumber = new Map();
  for (const n of links.notation) {
    if (n.clause && !clauseOfNumber.has(n.clause.number)) clauseOfNumber.set(n.clause.number, n.clause);
  }
  const seen = new Set();
  const add = (clause, kind, id, label, confidence, basis) => {
    const key = `${clause.number}|${kind}|${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.tutorial.push({ clause, kind, id, label, confidence, basis });
  };

  for (const [number, figs] of clauseFigures) {
    const clause = clauseOfNumber.get(number);
    if (!clause) continue;

    for (const ex of links.exercises) {
      const kinds = new Set();
      let read = 0;
      for (const model of ex.models ?? []) {
        const got = kindsOfModel(model);
        if (got) { read += 1; for (const k of got) kinds.add(k); }
      }
      const matched = figs.filter((f) => kinds.has(f.id));
      if (matched.length) {
        add(clause, 'exercise', ex.number, `Упражнение ${ex.number}`, 'derived', [
          `в модели упражнения (${ex.models[0]}) есть ${matched.slice(0, 3).map((m) => `«${m.label}»`).join(', ')}`,
          `эти фигуры связаны с пунктом ${number}`,
        ]);
        continue;
      }
      if (read) continue;
      // Модели нет — остаётся тип диаграммы из карточки. Это догадка.
      const types = new Set((figuresByExercise.get(ex.number) ?? [])
        .map((f) => DIAGRAM_SECTION[f.type]).filter(Boolean));
      const hit = figs.find((f) => f.diagrams && types.has(f.diagrams));
      if (hit) {
        add(clause, 'exercise', ex.number, `Упражнение ${ex.number}`, 'guess', [
          `тип диаграммы упражнения (${[...types].join(', ')}) тот же, что у карточки «${hit.label}» (${hit.diagrams})`,
          'модели упражнения нет — состав фигур не проверен',
        ]);
      }
    }

    for (const f of links.figures) {
      if (!f.model) continue;
      const kinds = kindsOfModel(f.model);
      if (!kinds) continue;
      const matched = figs.filter((x) => kinds.has(x.id));
      if (!matched.length) continue;
      add(clause, 'figure', f.figureNo, `Рис. ${f.figureNo}`, 'derived', [
        `в модели рисунка (${f.model}) есть ${matched.slice(0, 3).map((m) => `«${m.label}»`).join(', ')}`,
        `эти фигуры связаны с пунктом ${number}`,
      ]);
    }
  }

  // PlantUML: карточка нотации сама называет свою конструкцию в источниках
  // (plantuml-grammar.json#<id>) — это точная связь, догадок здесь нет.
  const seenP = new Set();
  for (const [number, figs] of clauseFigures) {
    const clause = clauseOfNumber.get(number);
    if (!clause) continue;
    for (const f of figs) {
      for (const src of f.card?.sources ?? []) {
        if (!src.startsWith('plantuml-grammar.json#')) continue;
        const id = src.slice('plantuml-grammar.json#'.length);
        const construct = plantuml.find((c) => c.id === id);
        if (!construct) continue;
        const key = `${number}|${id}`;
        if (seenP.has(key)) continue;
        seenP.add(key);
        links.plantuml.push({
          clause,
          construct: id,
          label: id,
          syntax: construct.syntax ?? '',
          confidence: 'exact',
          basis: [`карточка «${f.card?.title ?? f.label}» называет конструкцию PlantUML «${id}»`],
        });
      }
    }
  }
}

write('links.json', {
  schema: 'uml-reference-links/1',
  source: 'material/reference-content/crossrefs.json',
  confidence: crossrefs.confidenceMeaning ?? null,
  counts: {
    notation: links.notation.length,
    rules: links.rules.length,
    stereotypes: links.stereotypes.length,
    figures: links.figures.length,
    exercises: links.exercises.length,
    tutorial: links.tutorial.length,
    plantuml: links.plantuml.length,
  },
  ...links,
}, 1);

/* ------------------------------------------------------------------ поиск */

write('search.json', {
  schema: searchIndex.schema,
  kinds: searchIndex.kinds,
  docFields: searchIndex.docFields,
  ranking: searchIndex.ranking,
  stats: searchIndex.stats,
  glossary: searchIndex.glossary,
  anchors: searchIndex.anchors,
  docs: searchIndex.docs,
  postings: searchIndex.postings,
});

write('terms.json', {
  schema: 'uml-reference-terms/1',
  note: 'В спецификации 0 кириллических словоупотреблений из 199 275: без таблицы псевдонимов русский запрос не находит ничего',
  pairs: searchIndex.glossary,
  anchors: (searchIndex.anchors ?? []).map((a) => ({
    term: a.term, ru: a.ru, aliases: a.aliases ?? [], clause: a.clause, confidence: a.confidence,
  })),
}, 2);

// Второй проход: перевод. Без флага собираются оба языка, `--lang=ru` —
// только перевод (ветка выхода выше), `--lang=en` — только оригинал.
if (DO_RU) buildRuPass();

if (!QUIET) {
  const kb = (n) => `${(n / 1024).toFixed(0)} КБ`;
  const sectionsBytes = specIndex.reduce((n, s) => {
    const p = path.join(OUT, s.file);
    return n + (existsSync(p) ? readFileSync(p).length : 0);
  }, 0);
  console.log(`build-reference: ${OUT.replace(ROOT + '/', '')}`);
  console.log(`  разделов ${specIndex.length} · клауз ${flat.length} · блоков ${blockCount} · текста ${kb(chars)} → ${kb(sectionsBytes)} JSON`);
  console.log(`  карточки ${Object.keys(cards).length} · стереотипы ${stereotypes.length} · PlantUML ${plantuml.length}`);
  console.log(`  связи: нотация ${links.notation.length}, правила ${links.rules.length}, стереотипы ${links.stereotypes.length}, рисунки ${links.figures.length}, упражнения ${links.exercises.length}`);
  console.log(`  рёбра пунктов: пособие ${links.tutorial.length}, PlantUML ${links.plantuml.length}`);
  console.log(`  констрейнты: сопоставлено с ${flat.filter((c) => c.cons).length} статьями, причин «не проверяется» ${reasons.size}`);
  console.log(`  поиск: ${searchIndex.docs.length} документов, ${Object.keys(searchIndex.postings).length} терминов`);
  if (NO_FULL_TEXT) console.log('  вариант БЕЗ ПРОЗЫ: только номера, заголовки, имена констрейнтов и OCL');
}
