#!/usr/bin/env node
/**
 * Проверка поискового индекса: десять запросов, на каждый — ожидаемая первая
 * выдача. Без зависимостей, только node:fs и node:path.
 *
 * Запуск:
 *   node material/reference-content/check_search.mjs            # проверка
 *   node material/reference-content/check_search.mjs --top 5    # с выдачей
 *   node material/reference-content/check_search.mjs --query "квалификатор"
 *
 * Ранжирование здесь реализовано ровно так, как описано в
 * `search-index.json → ranking`; если индекс пересобран с другой схемой,
 * проверка это покажет.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, 'search-index.json');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'be', 'as', 'by', 'for',
  'on', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'with', 'from', 'which',
  'may', 'can', 'shall', 'should', 'not', 'no', 'if', 'then', 'than', 'such', 'when',
  'where', 'all', 'any', 'each', 'one', 'two', 'has', 'have', 'was', 'were', 'will',
  'there', 'their', 'they', 'them', 'also', 'but', 'so', 'into', 'only', 'more', 'most',
  'и', 'в', 'во', 'не', 'на', 'что', 'с', 'со', 'как', 'это', 'по', 'к', 'из', 'от',
  'для', 'или', 'же', 'ли', 'бы', 'но', 'то', 'так', 'при', 'над', 'под', 'без', 'у',
  'о', 'об', 'за', 'до', 'если', 'чем', 'все', 'его', 'её', 'ее', 'их', 'мы', 'вы',
]);

/** Те же правила, что у сборщика индекса. */
function tokenize(text) {
  const out = [];
  for (const w of text.toLowerCase().replace(/ё/g, 'е').match(/[0-9a-zа-я]+/g) ?? []) {
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const { docs, postings, glossary, kinds, anchors } = index;
const N = docs.length;

/** Якорь понятия: английский термин и русское название → пункт. */
const anchorByTerm = new Map();
for (const a of anchors ?? []) {
  for (const t of [a.term, ...(a.aliases ?? []), a.ru]) {
    if (t) anchorByTerm.set(String(t).toLowerCase(), a);
  }
}

const docTokens = docs.map((d) => new Set(tokenize(d[2])));

/**
 * Расширение запроса по глоссарию: русский термин → английские синонимы.
 * Глоссарий знает и словосочетания, поэтому проверяются оба вида записи.
 */
function expand(term) {
  const out = new Set([term]);
  const en = glossary[term];
  if (en) {
    for (const t of tokenize(en)) out.add(t);
  }
  return out;
}

/** Термины запроса: слова плюс перевод целой фразы, если она есть в глоссарии. */
function queryTerms(query) {
  const terms = new Set(tokenize(query));
  const whole = glossary[query.trim().toLowerCase().replace(/ё/g, 'е')];
  if (whole) for (const t of tokenize(whole)) terms.add(t);
  return [...terms];
}

/** Пункт, к которому относится документ: «11.5.4.1» → «11.5.4.1». */
function clauseOf(doc) {
  return String(doc[1]);
}

/** Документ относится к пункту `clause` (сам пункт или его подпункт). */
function underClause(doc, clause) {
  const ref = clauseOf(doc);
  return ref === clause || ref.startsWith(clause + '.');
}

/** Термины индекса, подходящие под термин запроса (префикс ловит окончания). */
const allTerms = Object.keys(postings);
function matchTerms(q) {
  const hits = [];
  for (const t of allTerms) {
    if (t === q) hits.push([t, 1]);
    else if (q.length >= 4 && t.startsWith(q) && t.length <= q.length + 3) hits.push([t, 0.9]);
    else if (t.length >= 4 && q.startsWith(t) && q.length <= t.length + 3) hits.push([t, 0.8]);
  }
  return hits;
}

function idf(term) {
  const ids = postings[term];
  const df = ids ? ids.split(',').length : 0;
  return Math.log(1 + N / Math.max(1, df));
}

const decodeCache = new Map();
function decodeIds(str) {
  if (decodeCache.has(str)) return decodeCache.get(str);
  const ids = str.split(',').map((s) => parseInt(s, 36));
  decodeCache.set(str, ids);
  return ids;
}

const KIND_PRIORITY = [1.25, 1.0, 1.1, 1.0, 0.95, 0.95, 1.0, 0.9];

/** Документ-запись: у него текст — это имя, а не абзац. */
const isEntry = (doc) => doc[0] !== 1;

/**
 * Поиск: [{doc, score}] по убыванию.
 *
 * Правила — ровно те, что записаны в search-index.json → ranking.
 */
function search(query) {
  const raw = queryTerms(query);
  if (raw.length === 0) return [];
  const scores = new Map();
  const bump = (i, v) => scores.set(i, (scores.get(i) ?? 0) + v);

  const seen = new Set();
  for (const q of raw) {
    for (const term of expand(q)) {
      if (seen.has(term)) continue;
      seen.add(term);
      for (const [t, factor] of matchTerms(term)) {
        const w = idf(t) * factor;
        for (const id of decodeIds(postings[t])) {
          bump(id, w * docs[id][4] * KIND_PRIORITY[docs[id][0]]);
        }
      }
      // Бонус за то, что термин — это ИМЯ записи, а не слово в абзаце.
      const own = postings[term];
      if (!own) continue;
      for (const id of decodeIds(own)) {
        const doc = docs[id];
        if (!isEntry(doc)) continue;
        const title = doc[2].toLowerCase().replace(/ё/g, 'е');
        let bonus = 0;
        if (title === term || title === `${term}s` || title === `${term}es`) bonus = 14;
        else if (title.startsWith(`${term} `) || title.startsWith(`${term}:`)) bonus = 6;
        else if (new RegExp(`\\b${term}\\b`).test(title)) bonus = 2;
        if (bonus) bump(id, bonus * doc[4]);
      }
    }
  }

  // Якорь понятия: справочная статья о понятии, а не первое упоминание слова.
  //
  // Якорь срабатывает, только когда запрос — это название понятия: целиком
  // или одним словом. Запрос из нескольких слов («class Foo») описывает не
  // понятие, а конкретную конструкцию, и подтягивать его к статье о классе
  // нельзя. Бонус получают сам пункт и абзацы внутри него, но не служебные
  // подзаголовки («Semantics», «Abstract Syntax»): это не статьи.
  const anchor =
    anchorByTerm.get(query.trim().toLowerCase().replace(/ё/g, 'е')) ??
    (raw.length === 1 ? anchorByTerm.get(raw[0]) : undefined);
  if (anchor) {
    for (const [id, s] of scores) {
      const doc = docs[id];
      if (underClause(doc, anchor.clause)) scores.set(id, s + 20 * doc[4]);
    }
  }

  // Бонус за целую фразу: запрос целиком входит в текст документа.
  const phrase = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (phrase.length >= 4) {
    for (const [id, s] of scores) {
      if (docs[id][2].toLowerCase().replace(/ё/g, 'е').includes(phrase)) {
        scores.set(id, s + 8 * docs[id][4]);
      }
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, doc: docs[id] }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

function show(r, n = 5) {
  for (const { doc, score } of r.slice(0, n)) {
    const [kind, ref, text, line] = doc;
    console.log(`   ${score.toFixed(2)}  ${kinds[kind].padEnd(11)} ${ref.padEnd(9)} ${text.slice(0, 78)}`);
  }
}

// Ожидания: запрос → чем должна быть первая выдача.
// `kind` и `refPrefix` — проверяемые условия; `why` — почему именно так.
const CASES = [
  {
    query: 'квалификатор',
    kind: 'spec-para',
    refPrefix: '9.5',
    why: 'русский термин из глоссария расширяется до «Qualifier»; квалификатор — свойство полюса ассоциации, описан в 9.5 Properties',
  },
  {
    query: 'qualifier',
    kind: 'spec-para',
    refPrefix: '9.5',
    why: 'тот же адрес по-английски: человек ищет и так, и так',
  },
  {
    query: 'композиция',
    kind: 'spec-node',
    refPrefix: '11.5',
    why: 'композиция — это composite aggregation; статья о ней — пункт 11.5 Associations',
  },
  {
    query: 'composite aggregation',
    kind: 'spec-para',
    refPrefix: '9.5',
    why: 'английская фраза дословно совпадает с определяющим предложением в 9.5.3 Semantics: «Composite aggregation is a strong form of aggregation…»; нотация — 11.5.4, примеры — 11.5.5',
  },
  {
    query: 'entity',
    kind: 'stereotype',
    refPrefix: 'entity',
    why: 'entity — имя стереотипа анализа; запрос должен попадать в стереотип, а не в текст',
  },
  {
    query: 'association',
    kind: 'spec-node',
    refPrefix: '11.5',
    why: 'ассоциация — пункт 11.5 Associations',
  },
  {
    query: 'дорожка',
    kind: 'spec-node',
    refPrefix: '15.6',
    why: 'дорожка — ActivityPartition; статья о ней — пункт 15.6 Activity Groups',
  },
  {
    query: 'lifeline',
    kind: 'spec-node',
    refPrefix: '17.3',
    why: 'линия жизни — пункт 17.3 Lifelines',
  },
  {
    query: 'сторожевое условие',
    kind: 'spec-node',
    refPrefix: '17.6',
    why: 'сторож — свойство InteractionOperand; операнд описан в 17.6.4.1 внутри пункта 17.6 Fragments',
  },
  {
    query: 'element-not-own-self',
    kind: 'rule',
    refPrefix: 'element-not-own-self',
    why: 'имя правила ищется целиком и попадает в правило',
  },
  {
    query: 'Упражнение 4.3.B',
    kind: 'exercise',
    refPrefix: '4.3.B',
    why: 'заголовок упражнения пособия',
  },
  {
    query: 'class Foo',
    kind: 'plantuml',
    refPrefix: 'class-decl',
    why: 'синтаксис PlantUML ищется по конструкции',
  },
  {
    query: 'стереотип',
    kind: 'spec-node',
    refPrefix: '12.3',
    why: 'русская подпись фигуры «Стереотип» привязана к пункту 12.3 Profiles — он и открывается',
  },
  {
    query: 'кратность',
    kind: 'spec-node',
    refPrefix: '7.5',
    why: 'кратность — Multiplicity; пункт 7.5 Types and Multiplicity',
  },
];

const argv = process.argv.slice(2);
const topIdx = argv.indexOf('--top');
const top = topIdx >= 0 ? Number(argv[topIdx + 1]) : 0;
const qIdx = argv.indexOf('--query');

if (qIdx >= 0) {
  const q = argv[qIdx + 1];
  console.log(`запрос: ${q}`);
  show(search(q), top || 10);
  process.exit(0);
}

let failed = 0;
console.log(`индекс: ${N} документов, ${allTerms.length} терминов\n`);
for (const c of CASES) {
  const r = search(c.query);
  const first = r[0];
  const ok =
    first !== undefined &&
    kinds[first.doc[0]] === c.kind &&
    String(first.doc[1]).startsWith(c.refPrefix);
  if (!ok) failed += 1;
  const got = first
    ? `${kinds[first.doc[0]]} ${first.doc[1]} — ${first.doc[2].slice(0, 60)}`
    : 'ничего';
  console.log(`${ok ? 'ok  ' : 'FAIL'}  «${c.query}» → ${got}`);
  if (!ok) {
    console.log(`      ожидалось: ${c.kind} ${c.refPrefix || '*'}; ${c.why}`);
    show(r, 4);
  }
  if (top > 0 && ok) show(r, top);
}

console.log(failed === 0 ? '\nвсе запросы дали ожидаемую первую выдачу' : `\nпровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
