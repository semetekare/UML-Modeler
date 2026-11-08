#!/usr/bin/env node
/**
 * Проверка карточек нотации (партия Б16).
 *
 * Проверяет семь требований задания и печатает сводку:
 *   1. все 51 фигура и 27 связей из app/notation/uml.json имеют карточку, лишних нет;
 *   2. заполнены обязательные поля, title совпадает с label;
 *   3. clause.number есть в material/reference-content/spec-tree.json;
 *   4. rules — только существующие id из docs/rules-uml-2.5.1.json;
 *   5. seeAlso — только существующие ключи нотации;
 *   6. differs не короче 120 знаков;
 *   7. ни в одном тексте нет фрагмента длиннее 120 знаков, совпадающего с
 *      текстом reference/spec/md/ (проверка на перепечатку стандарта).
 *
 * Запуск: node material/notation-cards/check.mjs
 * Код возврата 1, если есть хотя бы одна ошибка.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const uml = readJson('app/notation/uml.json');
const rulesDoc = readJson('docs/rules-uml-2.5.1.json');
const specTree = readJson('material/reference-content/spec-tree.json');
const crossrefs = readJson('material/reference-content/crossrefs.json');

const RULE_IDS = new Set(rulesDoc.map((r) => r.id));
const NOTATION_KEYS = new Set([...Object.keys(uml.shapes), ...Object.keys(uml.connectors)]);

// Ключи, которые есть и среди фигур, и среди связей, требуют суффикса в имени файла.
const DUPLICATED = Object.keys(uml.shapes).filter((k) => k in uml.connectors);

const expected = [
  ...Object.entries(uml.shapes).map(([key, v]) => ({ key, kind: 'shape', label: v.label })),
  ...Object.entries(uml.connectors).map(([key, v]) => ({ key, kind: 'connector', label: v.label })),
];

/** Имя файла карточки: `<key>.json`, а для совпадающих ключей — `<key>.<kind>.json`. */
function fileName(key, kind) {
  return DUPLICATED.includes(key) ? `${key}.${kind}.json` : `${key}.json`;
}

// --- пункты стандарта -----------------------------------------------------
const clauseIndex = new Map();
(function walk(node) {
  if (node.number) clauseIndex.set(node.number, node);
  for (const child of node.children || []) walk(child);
})({ children: specTree.sections });

// --- стереотипы, допустимые для фигуры ------------------------------------
const stereoByShape = new Map();
for (const s of crossrefs.stereotypeToShape.stereotypes) {
  if (!s.shape) continue;
  if (!stereoByShape.has(s.shape)) stereoByShape.set(s.shape, new Set());
  stereoByShape.get(s.shape).add(s.name.toLowerCase());
}

// --- текст стандарта для проверки на перепечатку ---------------------------
const SPEC_DIR = path.join(ROOT, 'reference/spec/md');
const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

let specBlob = '';
if (fs.existsSync(SPEC_DIR)) {
  specBlob = normalize(
    fs
      .readdirSync(SPEC_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => fs.readFileSync(path.join(SPEC_DIR, f), 'utf8'))
      .join('\n'),
  );
}

const WINDOW = 120;
const BASE = 31;

/** Полиномиальный хеш окна с прокруткой: нужен, чтобы не строить 1,8 млн подстрок. */
function windowsOf(text) {
  const out = [];
  for (let i = 0; i + WINDOW <= text.length; i += 1) out.push(text.slice(i, i + WINDOW));
  return out;
}

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (Math.imul(h, BASE) + str.charCodeAt(i)) | 0;
  return h;
}

// Хеши окон стандарта: один проход с прокруткой.
const specHashes = new Map(); // hash -> первая позиция
if (specBlob.length >= WINDOW) {
  let power = 1;
  for (let i = 0; i < WINDOW - 1; i += 1) power = Math.imul(power, BASE);
  let h = hashOf(specBlob.slice(0, WINDOW));
  specHashes.set(h, 0);
  for (let i = 1; i + WINDOW <= specBlob.length; i += 1) {
    h = (Math.imul(h - Math.imul(specBlob.charCodeAt(i - 1), power), BASE) + specBlob.charCodeAt(i + WINDOW - 1)) | 0;
    if (!specHashes.has(h)) specHashes.set(h, i);
  }
}

/**
 * Ищет в тексте окна длиной 120 знаков, совпадающие с текстом стандарта.
 * Возвращает список найденных совпадений (для честного отчёта — с позицией).
 */
function copiedFragments(text) {
  if (!specBlob) return [];
  const hits = [];
  for (const win of windowsOf(normalize(text))) {
    const pos = specHashes.get(hashOf(win));
    if (pos === undefined) continue;
    if (specBlob.slice(pos, pos + WINDOW) === win) hits.push(win);
  }
  return hits;
}

// Вторая, независимая проверка — по словам, как сказано в задании: «фраз
// длиннее 25 слов». Фраза из 25 коротких английских слов может уложиться в 120
// знаков и проскочить проверку по знакам, поэтому ищем ещё и совпадение
// последовательностей из 25 словоформ.
const WORDS = 25;
const toWords = (s) => normalize(s).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * 64-битный ключ из пары 32-битных хешей: одиночный 32-битный хеш на 250 тысячах
 * фраз стандарта даёт ложные совпадения, а проверка не должна ругаться зря.
 */
function hashKey(str) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    a = (Math.imul(a, 31) + c) | 0;
    b = (Math.imul(b, 131) + c) | 0;
  }
  return `${a}:${b}`;
}

const specWordHashes = new Set();
if (specBlob) {
  const ws = toWords(specBlob);
  if (ws.length >= WORDS) {
    for (let i = 0; i + WORDS <= ws.length; i += 1) {
      specWordHashes.add(hashKey(ws.slice(i, i + WORDS).join(' ')));
    }
  }
}

/** Фразы из 25 и более слов, совпадающие со стандартом (возвращает пример). */
function copiedPhrases(text) {
  if (!specWordHashes.size) return [];
  const ws = toWords(text);
  const hits = [];
  for (let i = 0; i + WORDS <= ws.length; i += 1) {
    const phrase = ws.slice(i, i + WORDS).join(' ');
    if (specWordHashes.has(hashKey(phrase))) hits.push(phrase);
  }
  return hits;
}

// --- обход карточек -------------------------------------------------------
const errors = [];
const warnings = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);

const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.json')).sort();
const byCard = new Map();

const TEXT_FIELDS = ['oneLine', 'draws', 'differs', 'example', 'plantuml'];
const REQUIRED = ['key', 'kind', 'title', 'oneLine', 'draws', 'differs', 'clause', 'rules', 'example', 'plantuml', 'stereotypes', 'seeAlso', 'sources'];

for (const file of files) {
  const raw = fs.readFileSync(path.join(HERE, file), 'utf8');
  let card;
  try {
    card = JSON.parse(raw);
  } catch (err) {
    fail(file, `не разбирается как JSON: ${err.message}`);
    continue;
  }
  const id = `${card.key} (${card.kind})`;
  byCard.set(id, { card, file });

  // 2. обязательные поля
  for (const field of REQUIRED) {
    if (!(field in card)) fail(file, `нет обязательного поля ${field}`);
  }
  for (const field of TEXT_FIELDS) {
    if (typeof card[field] !== 'string' || card[field].trim() === '') {
      fail(file, `поле ${field} пустое или не строка`);
    }
  }
  if (Array.isArray(card.problems)) {
    for (const p of card.problems) {
      if (typeof p !== 'string' || p.trim() === '') fail(file, 'пустая запись в problems');
    }
  }
  if (fileName(card.key, card.kind) !== file) {
    fail(file, `имя файла не по правилу: ожидалось ${fileName(card.key, card.kind)}`);
  }

  // 1. ключ и вид существуют, title совпадает с label
  const source = card.kind === 'shape' ? uml.shapes[card.key] : uml.connectors[card.key];
  if (!source) {
    fail(file, `ключ ${card.key} отсутствует в uml.json среди ${card.kind}`);
    continue;
  }
  if (card.title !== source.label) {
    fail(file, `title «${card.title}» не совпадает с label «${source.label}»`);
  }

  // 3. пункт стандарта
  if (card.clause === null) {
    if (!Array.isArray(card.problems) || card.problems.length === 0) {
      fail(file, 'clause: null без записи в problems');
    }
  } else if (typeof card.clause !== 'object') {
    fail(file, 'clause должен быть объектом или null');
  } else {
    for (const f of ['number', 'title', 'id']) {
      if (typeof card.clause[f] !== 'string' || !card.clause[f]) fail(file, `в clause нет поля ${f}`);
    }
    const node = clauseIndex.get(card.clause.number);
    if (!node) {
      fail(file, `clause.number ${card.clause.number} отсутствует в spec-tree.json`);
    } else if (node.title !== card.clause.title) {
      fail(file, `clause.title «${card.clause.title}» не совпадает с заголовком пункта «${node.title}»`);
    }
  }

  // 4. правила
  if (!Array.isArray(card.rules)) {
    fail(file, 'rules должен быть массивом');
  } else {
    for (const r of card.rules) {
      if (!RULE_IDS.has(r)) fail(file, `правило ${r} отсутствует в docs/rules-uml-2.5.1.json`);
    }
  }

  // 5. seeAlso
  if (!Array.isArray(card.seeAlso)) {
    fail(file, 'seeAlso должен быть массивом');
  } else {
    for (const k of card.seeAlso) {
      if (!NOTATION_KEYS.has(k)) fail(file, `seeAlso: ключа ${k} нет в нотации`);
      if (k === card.key) fail(file, `seeAlso ссылается на саму карточку (${k})`);
    }
  }

  // 6. длина differs
  if (typeof card.differs === 'string' && card.differs.length < 120) {
    fail(file, `differs короче 120 знаков (${card.differs.length})`);
  }

  // стереотипы: имя должно быть привязано к этой фигуре в crossrefs
  if (!Array.isArray(card.stereotypes)) {
    fail(file, 'stereotypes должен быть массивом');
  } else if (card.stereotypes.length) {
    const allowed = stereoByShape.get(card.key);
    if (!allowed) {
      fail(file, `у фигуры ${card.key} в crossrefs нет стереотипов, а в карточке их ${card.stereotypes.length}`);
    } else {
      for (const s of card.stereotypes) {
        if (!allowed.has(s.toLowerCase())) fail(file, `стереотип «${s}» не привязан к ${card.key} в crossrefs`);
      }
    }
  }

  // конструкция PlantUML: либо синтаксис с ссылкой на грамматику, либо явное «нет: …» без неё
  if (typeof card.plantuml === 'string') {
    const citesGrammar = (card.sources || []).some((s) => s.includes('plantuml-grammar.json'));
    if (card.plantuml.startsWith('нет:')) {
      if (citesGrammar) fail(file, 'plantuml «нет: …», но sources ссылается на docs/plantuml-grammar.json');
    } else if (!citesGrammar) {
      fail(file, 'plantuml задан, но sources не ссылается на конструкцию docs/plantuml-grammar.json');
    }
  }

  // sources
  if (!Array.isArray(card.sources) || card.sources.length === 0) {
    fail(file, 'sources пуст');
  }

  // 7. перепечатка стандарта
  const prose = [card.oneLine, card.draws, card.differs, card.example, ...(card.problems || [])].join(' ');
  const copied = copiedFragments(prose);
  if (copied.length) {
    fail(file, `совпадение со стандартом длиной ≥${WINDOW} знаков: «${copied[0].slice(0, 80)}…»`);
  }
  const phrases = copiedPhrases(prose);
  if (phrases.length) {
    fail(file, `фраза из ≥${WORDS} слов, совпадающая со стандартом: «${phrases[0].slice(0, 80)}…»`);
  }
}

// 1. все ожидаемые ключи покрыты, лишних нет
for (const { key, kind } of expected) {
  const id = `${key} (${kind})`;
  if (!byCard.has(id)) errors.push(`${fileName(key, kind)}: карточки нет (ключ ${key}, ${kind})`);
}
const expectedIds = new Set(expected.map((e) => `${e.key} (${e.kind})`));
for (const [id, { file }] of byCard) {
  if (!expectedIds.has(id)) errors.push(`${file}: карточка для несуществующего ключа ${id}`);
}

// --- сводка ---------------------------------------------------------------
const cards = [...byCard.values()].map((v) => v.card);
const withNullClause = cards.filter((c) => c.clause === null);
const rulesUsed = new Set(cards.flatMap((c) => c.rules || []));
const rulesUnused = [...RULE_IDS].filter((r) => !rulesUsed.has(r));
const words = cards.reduce((n, c) => {
  const text = [c.oneLine, c.draws, c.differs, c.example].filter((t) => typeof t === 'string').join(' ');
  return n + text.split(/\s+/).filter(Boolean).length;
}, 0);
const differLengths = cards.map((c) => (c.differs || '').length);
const clauseNumbers = new Set(cards.filter((c) => c.clause && c.clause.number).map((c) => c.clause.number));

const line = '─'.repeat(64);
console.log(line);
console.log(`Карточки:            ${cards.length} (ожидалось ${expected.length})`);
console.log(`  фигур / связей:    ${cards.filter((c) => c.kind === 'shape').length} / ${cards.filter((c) => c.kind === 'connector').length}`);
console.log(`Слов в карточках:    ${words} (в среднем ${(words / Math.max(cards.length, 1)).toFixed(1)} на карточку)`);
console.log(`differs:             мин. ${Math.min(...differLengths)} знаков, среднее ${Math.round(differLengths.reduce((a, b) => a + b, 0) / Math.max(differLengths.length, 1))}`);
console.log(`clause: null:        ${withNullClause.length}${withNullClause.length ? ` (${withNullClause.map((c) => c.key).join(', ')})` : ''}`);
console.log(`Разных пунктов:      ${clauseNumbers.size}`);
console.log(`Правил покрыто:      ${rulesUsed.size} из ${RULE_IDS.size}`);
if (rulesUnused.length) console.log(`  не на карточке:    ${rulesUnused.join(', ')}`);
const withPlantuml = cards.filter((c) => typeof c.plantuml === 'string' && !c.plantuml.startsWith('нет:')).length;
console.log(`С текстом PlantUML:  ${withPlantuml}, без: ${cards.length - withPlantuml}`);
console.log(`С записями problems: ${cards.filter((c) => (c.problems || []).length).length}`);
console.log(line);

if (warnings.length) {
  console.log(`Предупреждений: ${warnings.length}`);
  for (const w of warnings) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`ОШИБОК: ${errors.length}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exitCode = 1;
} else {
  console.log('Ошибок нет.');
}
