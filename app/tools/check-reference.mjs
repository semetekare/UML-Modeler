#!/usr/bin/env node
/**
 * Проверка собранного справочника (партии Б17 + Б18): связи, поиск, полнота.
 *
 * Запуск:
 *   node app/tools/check-reference.mjs                 проверка + два прогона сборки
 *   node app/tools/check-reference.mjs --dir=DIR       другой каталог справочника
 *   node app/tools/check-reference.mjs --no-build      не пересобирать (быстро)
 *   node app/tools/check-reference.mjs --verbose        показать первую выдачу
 *
 * Что доказывается:
 *   1. каждый id из links.json существует в дереве, нотации, правилах,
 *      стереотипах; каждая модель рисунка лежит на диске;
 *   2. полный текст на месте: 25 разделов, 3 690 клауз, 9 109 блоков, все
 *      61 блок ASCII-арта и 9 таблиц;
 *   3. search.json находит «квалификатор» и «qualifier» в 9.5.3;
 *   4. 14 запросов дают ожидаемую первую выдачу, как в
 *      material/reference-content/check_search.mjs;
 *   5. один запрос находит и правило, и пункт стандарта, и стереотип;
 *   6. каждая выдача поиска ведёт в существующую статью (ref разрешается);
 *   7. повторная сборка даёт побайтово те же файлы, оба варианта
 *      (с полным текстом и с --no-full-text) собираются.
 *
 * Только stdlib Node. Ранжирование — тот же модуль, что у читалки:
 * app/src/reference/search.js.
 */

import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSearch, SHELF_OF_KIND } from '../src/reference/search.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const ROOT = path.resolve(APP, '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const opt = (f) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`));
  return hit ? hit.slice(hit.indexOf('=') + 1) : null;
};
const DIR = path.resolve(APP, opt('dir') ?? 'reference');
const VERBOSE = has('verbose');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, ok: !!pass, detail: String(detail) });

const spec = readJson(path.join(DIR, 'spec', 'index.json'));
const links = readJson(path.join(DIR, 'links.json'));
const search = readJson(path.join(DIR, 'search.json'));
const terms = readJson(path.join(DIR, 'terms.json'));
const cards = readJson(path.join(DIR, 'cards.json'));
const stereotypes = readJson(path.join(DIR, 'stereotypes.json'));
const plantuml = readJson(path.join(DIR, 'plantuml.json'));
const notation = readJson(path.join(ROOT, 'app', 'notation', 'uml.json'));
const rules = readJson(path.join(ROOT, 'app', 'notation', 'rules', 'uml-2.5.1.json'));
// Слой практики ищется тем же видом `rule` (у него нет пункта, но статья и
// карточка у него есть), поэтому его id — тоже законная выдача поиска.
const practiceRules = readJson(path.join(ROOT, 'app', 'notation', 'rules', 'practice.json'));
const course = readJson(path.join(ROOT, 'app', 'course', 'index.json'));

const clauses = spec.clauses ?? [];
const clauseByNumber = new Map(clauses.map((c) => [c.n, c]));
const clauseById = new Map(clauses.map((c) => [c.i, c]));
const shapeKeys = new Set(Object.keys(notation.shapes));
const connKeys = new Set(Object.keys(notation.connectors));

/* ------------------------------------------------------- 1. связи: адреса */

{
  const bad = [];
  for (const e of links.notation ?? []) {
    const pool = e.kind === 'shape' ? shapeKeys : connKeys;
    if (!e.clause) bad.push(`нотация ${e.id}: нет клаузы`);
    if (!pool.has(e.id)) bad.push(`нотация: ${e.id} нет в uml.json`);
    if (!e.clause) bad.push(`нотация ${e.id}: нет клаузы`);
    else if (!clauseById.has(e.clause.id)) bad.push(`нотация ${e.id}: клаузы ${e.clause.id} нет в дереве`);
    else if (clauseById.get(e.clause.id).n !== e.clause.number) {
      bad.push(`нотация ${e.id}: номер ${e.clause.number} не совпал с id ${e.clause.id}`);
    }
    if (!['exact', 'derived', 'guess'].includes(e.confidence)) bad.push(`нотация ${e.id}: confidence=${e.confidence}`);
  }
  ok('links.json: каждая связь «нотация → клауза» ведёт в существующую фигуру и пункт',
    bad.length === 0, bad.slice(0, 4).join('; ') || `${links.notation.length} связей`);
}

{
  const ruleIds = new Set(rules.map((r) => r.id));
  const bad = [];
  for (const e of links.rules ?? []) {
    if (!ruleIds.has(e.id)) bad.push(`правила: ${e.id} нет в uml-2.5.1.json`);
    if (!e.clause || !clauseById.has(e.clause.id)) bad.push(`правило ${e.id}: клаузы нет в дереве`);
  }
  ok('links.json: каждое правило ссылается на существующий пункт',
    bad.length === 0, bad.slice(0, 4).join('; ') || `${links.rules.length} правил`);
}

{
  const names = new Set(stereotypes.stereotypes.map((s) => s.name));
  const bad = [];
  for (const e of links.stereotypes ?? []) {
    if (!names.has(e.name)) bad.push(`стереотип ${e.name} потерялся`);
    // Фигура стереотипа — это и фигура, и связь: «include», «extend»,
    // «dependency» живут в uml.json → connectors.
    if (e.shape && !shapeKeys.has(e.shape) && !connKeys.has(e.shape)) {
      bad.push(`стереотип ${e.name}: фигуры ${e.shape} нет`);
    }
    if (!['exact', 'derived', 'guess'].includes(e.confidence)) bad.push(`стереотип ${e.name}: confidence=${e.confidence}`);
  }
  ok('links.json: каждый стереотип ведёт в существующую фигуру',
    bad.length === 0, bad.slice(0, 4).join('; ') || `${links.stereotypes.length} стереотипов`);
}

{
  // Рёбра «пункт → пособие» и «пункт → PlantUML» (Б20г): адрес каждого —
  // существующий пункт, упражнение из курса, рисунок из links.figures или
  // конструкция из грамматики; у каждого ребра есть confidence и basis.
  const course = readJson(path.join(ROOT, 'app', 'course', 'index.json'));
  const exerciseNumbers = new Set(course.chapters.flatMap((c) => c.exercises.map((e) => e.number)));
  const constructIds = new Set(plantuml.constructs.map((c) => c.id));
  const figNumbers = new Set((links.figures ?? []).map((f) => f.figureNo));
  const bad = [];
  for (const e of links.tutorial ?? []) {
    if (!e.clause || !clauseById.has(e.clause.id)) bad.push(`пособие ${e.id}: пункта нет`);
    if (!['exact', 'derived', 'guess'].includes(e.confidence)) bad.push(`пособие ${e.id}: confidence=${e.confidence}`);
    if (!e.basis?.length) bad.push(`пособие ${e.id}: нет basis`);
    if (e.kind === 'exercise' && !exerciseNumbers.has(e.id)) bad.push(`пособие: упражнения ${e.id} нет в курсе`);
    if (e.kind === 'figure' && !figNumbers.has(e.id)) bad.push(`пособие: рисунка ${e.id} нет`);
  }
  for (const e of links.plantuml ?? []) {
    if (!e.clause || !clauseById.has(e.clause.id)) bad.push(`PlantUML ${e.construct}: пункта нет`);
    if (!constructIds.has(e.construct)) bad.push(`PlantUML ${e.construct}: нет в грамматике`);
    if (!['exact', 'derived', 'guess'].includes(e.confidence)) bad.push(`PlantUML ${e.construct}: confidence=${e.confidence}`);
    if (!e.basis?.length) bad.push(`PlantUML ${e.construct}: нет basis`);
  }
  ok('links.json: рёбра «пункт → пособие» и «пункт → PlantUML» ведут в существующие пункты',
    bad.length === 0, bad.slice(0, 4).join('; ')
      || `${links.tutorial.length} рёбер пособия (${links.tutorial.filter((e) => e.kind === 'figure').length} рисунков), `
        + `${links.plantuml.length} PlantUML`);
}

{
  const bad = [];
  for (const f of links.figures ?? []) {
    if (f.model && !existsSync(path.join(ROOT, f.model))) bad.push(`рисунок ${f.figureNo}: нет ${f.model}`);
    if (!['exact', 'derived', 'guess'].includes(f.confidence)) bad.push(`рисунок ${f.figureNo}: confidence=${f.confidence}`);
  }
  for (const e of links.exercises ?? []) {
    for (const m of e.models ?? []) if (!existsSync(path.join(ROOT, m))) bad.push(`упражнение ${e.number}: нет ${m}`);
  }
  ok('links.json: модели рисунков и упражнений лежат на диске',
    bad.length === 0, bad.slice(0, 4).join('; ')
      || `${links.figures.length} рисунков (${links.figures.filter((f) => f.model).length} с моделью), ${links.exercises.length} упражнений`);
}

/* -------------------------------------------------- 2. полнота и структура */

{
  const missing = [];
  for (const s of spec.sections) if (!existsSync(path.join(DIR, s.file))) missing.push(s.file);
  const byType = {};
  const ids = new Set();
  const nums = new Set();
  let blocks = 0;
  let textBlocks = 0;
  let tables = 0;
  let kv = 0;
  let badBlock = 0;
  const TYPES = new Set(['p', 'ul', 'note', 'ocl', 'text', 'table', 'kv']);
  for (const s of spec.sections) {
    if (!existsSync(path.join(DIR, s.file))) continue;
    const file = readJson(path.join(DIR, s.file));
    for (const a of file.articles) {
      ids.add(a.id);
      nums.add(a.number);
      if (!a.title || !a.number) badBlock += 1;
      for (const b of a.blocks) {
        blocks += 1;
        byType[b.t] = (byType[b.t] ?? 0) + 1;
        if (!TYPES.has(b.t)) badBlock += 1;
        if (b.t === 'text') textBlocks += 1;
        if (b.t === 'table') tables += 1;
        if (b.t === 'kv') kv += 1;
        if (b.t === 'kv' && !b.name) badBlock += 1;
      }
    }
  }
  ok('25 разделов стандарта на месте и читаются',
    spec.sections.length === 25 && missing.length === 0,
    `${spec.sections.length} разделов${missing.length ? `, нет: ${missing.join(', ')}` : ''}`);
  ok('все 3 690 клауз дерева имеют статью',
    ids.size === 3690 && nums.size === 3690,
    `${ids.size} статей, ${nums.size} номеров`);
  ok('блоки только семи разрешённых типов, у констрейнта есть имя',
    badBlock === 0, `блоков ${blocks}, ошибок ${badBlock}; ${JSON.stringify(byType)}`);
  ok('ASCII-арт метамодели и таблицы разобраны в блоки, а не потеряны',
    textBlocks === 61 && tables === 9,
    `text ${textBlocks} (ожидалось 61), table ${tables} (ожидалось 9), kv ${kv}`);
  ok('полный текст стандарта входит: проза всех разделов на месте',
    byType.p >= 6000 && blocks > 9000,
    `абзацев ${byType.p ?? 0}, списков ${byType.ul ?? 0}, блоков ${blocks}`);
}

/* -------------------------------------------------------------- 3. поиск */

const engine = createSearch(search);

{
  const a = engine.search('квалификатор');
  const b = engine.search('qualifier');
  const good = (r) => r[0] && r[0].kind === 'spec-para' && r[0].ref.startsWith('9.5.3');
  ok('«квалификатор» ведёт в 9.5.3', good(a), a[0] ? `${a[0].kind} ${a[0].ref}` : 'ничего');
  ok('«qualifier» ведёт в 9.5.3', good(b), b[0] ? `${b[0].kind} ${b[0].ref}` : 'ничего');
  ok('«квалификатор» и «qualifier» дают один и тот же первый пункт',
    a[0] && b[0] && a[0].ref === b[0].ref, a[0] && b[0] ? `${a[0].ref} = ${b[0].ref}` : 'нет выдачи');
}

{
  const all = engine.search('association');
  const kinds = new Set(all.map((r) => r.kind));
  const shelves = new Set([...kinds].map((k) => SHELF_OF_KIND[k]));
  ok('один запрос находит правило, пункт стандарта и стереотип',
    shelves.has('spec') && shelves.has('rules') && shelves.has('stereotypes'),
    [...shelves].join(', '));
  const r = all.find((x) => x.kind === 'rule');
  const s = all.find((x) => x.kind === 'stereotype');
  const c = all.find((x) => x.kind === 'spec-node' || x.kind === 'spec-para');
  if (VERBOSE && r && s && c) console.log(`   association → ${c.ref}, ${r.ref}, ${s.ref}`);
}

{
  // Недопечатанное слово — обычное состояние строки поиска: «qualifi» (en)
  // и «квалифи» (ru) должны вести туда же, куда целое слово.
  const en = engine.search('qualifi');
  const ru = engine.search('квалифи');
  const empty = engine.search('   ');
  ok('префиксный поиск: «qualifi» и «квалифи» ведут в 9.5.3',
    en[0] && en[0].ref === '9.5.3' && ru[0] && ru[0].ref === '9.5.3',
    `${en[0] ? en[0].ref : '—'} / ${ru[0] ? ru[0].ref : '—'}`);
  ok('пустой запрос не падает и ничего не выдумывает', Array.isArray(empty) && empty.length === 0,
    `${empty.length} результатов`);
}

const CASES = [
  ['квалификатор', 'spec-para', '9.5'],
  ['qualifier', 'spec-para', '9.5'],
  ['композиция', 'spec-node', '11.5'],
  ['composite aggregation', 'spec-para', '9.5'],
  ['entity', 'stereotype', 'entity'],
  ['association', 'spec-node', '11.5'],
  ['дорожка', 'spec-node', '15.6'],
  ['lifeline', 'spec-node', '17.3'],
  ['сторожевое условие', 'spec-node', '17.6'],
  ['element-not-own-self', 'rule', 'element-not-own-self'],
  ['Упражнение 4.3.B', 'exercise', '4.3.B'],
  ['class Foo', 'plantuml', 'class-decl'],
  ['стереотип', 'spec-node', '12.3'],
  ['кратность', 'spec-node', '7.5'],
];
{
  const failed = [];
  for (const [q, kind, ref] of CASES) {
    const r = engine.search(q);
    const first = r[0];
    const pass = first && first.kind === kind && first.ref.startsWith(ref);
    if (!pass) failed.push(`«${q}» → ${first ? `${first.kind} ${first.ref}` : 'ничего'} (ждали ${kind} ${ref})`);
    if (VERBOSE) console.log(`   ${pass ? 'ok  ' : 'FAIL'} «${q}» → ${first ? `${first.kind} ${first.ref}` : 'ничего'}`);
  }
  ok('14 запросов дают ожидаемую первую выдачу', failed.length === 0,
    failed.length ? failed.slice(0, 3).join('; ') : `${CASES.length} запросов`);
}

{
  // Ранжирование: счёт не растёт по списку, ничья решается порядком индекса.
  const r = engine.search('кратность');
  let monotone = true;
  for (let i = 1; i < r.length; i += 1) {
    if (r[i].score > r[i - 1].score + 1e-9) monotone = false;
    if (Math.abs(r[i].score - r[i - 1].score) < 1e-9 && r[i].id < r[i - 1].id) monotone = false;
  }
  ok('ранжирование устойчиво: счёт не растёт, ничья — по порядку индекса',
    monotone && r.length > 3, `${r.length} результатов`);
}

/* ------------------------------------- 4. каждая выдача ведёт в статью */

{
  const ruleIds = new Set([...rules, ...practiceRules].map((r) => r.id));
  const stereoNames = new Set(stereotypes.stereotypes.map((s) => s.name));
  const cardIds = new Set(Object.keys(cards.cards));
  const exNumbers = new Set(course.chapters.flatMap((c) => c.exercises.map((e) => e.number)));
  const plIds = new Set(plantuml.constructs.map((c) => c.id));
  const bad = [];
  const samples = ['квалификатор', 'association', 'entity', 'класс', 'Упражнение 4.3.B', 'class Foo', 'стереотип', 'композиция'];
  const seen = new Set();
  for (const q of samples) {
    for (const r of engine.search(q).slice(0, 200)) {
      const key = `${r.kind}:${r.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.kind === 'spec-node' || r.kind === 'spec-para') {
        if (!clauseByNumber.has(r.ref)) bad.push(`пункт ${r.ref} не найден в дереве`);
      } else if (r.kind === 'rule') {
        if (!ruleIds.has(r.ref)) bad.push(`правило ${r.ref} нет`);
      } else if (r.kind === 'stereotype') {
        if (!stereoNames.has(r.ref)) bad.push(`стереотип ${r.ref} нет`);
      } else if (r.kind === 'shape' || r.kind === 'connector') {
        if (!cardIds.has(`${r.kind}:${r.ref}`)) bad.push(`карточка ${r.kind}:${r.ref} нет`);
      } else if (r.kind === 'exercise') {
        if (!exNumbers.has(r.ref)) bad.push(`упражнение ${r.ref} нет`);
      } else if (r.kind === 'plantuml') {
        if (!plIds.has(r.ref)) bad.push(`PlantUML ${r.ref} нет`);
      } else {
        bad.push(`неизвестный вид ${r.kind}`);
      }
    }
  }
  ok('каждая выдача поиска открывает существующую статью',
    bad.length === 0, bad.slice(0, 4).join('; ') || `${seen.size} выдач проверено`);
}

/* ------------------------------------------------- 5. состав справочника */

ok('78 карточек нотации: 51 фигура и 27 связей',
  cards.count === 78 && Object.keys(cards.cards).length === 78
  && notationCount(cards, 'shape') === 51 && notationCount(cards, 'connector') === 27,
  `${cards.count} (shape ${notationCount(cards, 'shape')}, connector ${notationCount(cards, 'connector')})`);
ok('428 стереотипов и 169 конструкций PlantUML на полках',
  stereotypes.count === 428 && plantuml.count === 169,
  `${stereotypes.count} стереотипов, ${plantuml.count} конструкций`);
ok('таблица псевдонимов не пуста и знает «квалификатор»',
  Object.keys(terms.pairs ?? {}).length >= 50 && terms.pairs['квалификатор'],
  `${Object.keys(terms.pairs ?? {}).length} пар, «квалификатор» → «${terms.pairs['квалификатор'] ?? '—'}»`);
ok('уведомление OMG лежит рядом со справочником',
  existsSync(path.join(DIR, 'NOTICE.md')),
  'reference/NOTICE.md');

function notationCount(cards, kind) {
  return Object.values(cards.cards).filter((c) => c.kind === kind).length;
}

/* ------------------------------------------- 6. русский перевод (Э12) */

/*
 * Перевод проверяется теми же мерами, что оригинал:
 *   * множества id статей совпадают 1:1 — иначе переключатель языка открывал
 *     бы другую статью;
 *   * блоки OCL и ASCII-арта побайтово те же — перевод их не трогает;
 *   * по переводу ищется: «квалификатор», «композиция», «дорожка», «вывод».
 */

const RU_DIR = path.join(DIR, 'spec-ru');
const ruIndex = existsSync(path.join(RU_DIR, 'index.json'))
  ? readJson(path.join(RU_DIR, 'index.json'))
  : null;
const i18n = existsSync(path.join(DIR, 'spec', 'i18n.json'))
  ? readJson(path.join(DIR, 'spec', 'i18n.json'))
  : null;

{
  const enSections = new Map(spec.sections.map((s) => [s.number, s]));
  const bad = [];
  let files = 0;
  let matched = 0;
  let expected = 0;
  let identical = 0;
  let oclBlocks = 0;
  let artBlocks = 0;
  const perSection = [];
  for (const rs of ruIndex?.sections ?? []) {
    const es = enSections.get(rs.number);
    if (!es) { bad.push(`раздел ${rs.number}: нет в оригинале`); continue; }
    if (!rs.file || !existsSync(path.join(DIR, rs.file))) { bad.push(`раздел ${rs.number}: нет файла перевода`); continue; }
    files += 1;
    const en = readJson(path.join(DIR, es.file));
    const ru = readJson(path.join(DIR, rs.file));
    const enIds = new Set(en.articles.map((a) => a.id));
    const ruIds = new Set(ru.articles.map((a) => a.id));
    const missEn = [...enIds].filter((i) => !ruIds.has(i));
    const missRu = [...ruIds].filter((i) => !enIds.has(i));
    matched += [...enIds].filter((i) => ruIds.has(i)).length;
    expected += enIds.size;
    if (missEn.length || missRu.length) {
      bad.push(`раздел ${rs.number}: ${missEn.length} id только в оригинале (${missEn.slice(0, 3).join(', ')}), `
        + `${missRu.length} только в переводе (${missRu.slice(0, 3).join(', ')})`);
    }
    perSection.push(`${rs.number}: ${enIds.size - missEn.length}/${enIds.size}`);
    // OCL и арт — побайтово те же блоки, в том же порядке.
    const ruById = new Map(ru.articles.map((a) => [a.id, a]));
    for (const a of en.articles) {
      const r = ruById.get(a.id);
      if (!r) continue;
      const eo = a.blocks.filter((b) => b.t === 'ocl').map((b) => b.text);
      const ro = r.blocks.filter((b) => b.t === 'ocl').map((b) => b.text);
      const et = a.blocks.filter((b) => b.t === 'text').map((b) => b.text);
      const rt = r.blocks.filter((b) => b.t === 'text').map((b) => b.text);
      const ekv = a.blocks.filter((b) => b.t === 'kv' && b.ocl).map((b) => `${b.name}\u0000${b.ocl}`);
      const rkv = r.blocks.filter((b) => b.t === 'kv' && b.ocl).map((b) => `${b.name}\u0000${b.ocl}`);
      oclBlocks += eo.length + ekv.length;
      artBlocks += et.length;
      if (JSON.stringify(eo) !== JSON.stringify(ro)) bad.push(`${a.number}: OCL-блоки разошлись`);
      if (JSON.stringify(et) !== JSON.stringify(rt)) bad.push(`${a.number}: ASCII-арт разошёлся`);
      if (JSON.stringify(ekv) !== JSON.stringify(rkv)) bad.push(`${a.number}: OCL констрейнтов разошёлся`);
      identical += 1;
    }
  }
  if (VERBOSE) console.log(`   spec-ru по разделам: ${perSection.join(' · ')}`);
  ok('spec-ru: 25 файлов, множества id статей совпадают с оригиналом 1:1',
    files === 25 && bad.length === 0 && matched === expected && expected === 3690,
    bad.length ? `${matched}/${expected} совпало; ${bad.slice(0, 3).join('; ')}`
      : `${matched} из ${expected} id в ${files} разделах (${identical} статей сверено)`);
  ok('OCL и ASCII-арт в переводе побайтово те же, что в оригинале',
    oclBlocks === 680 && artBlocks === 61 && bad.length === 0,
    `OCL ${oclBlocks} (ожидалось 680), арт ${artBlocks} (ожидалось 61)`);
  ok('spec/i18n.json: 25 разделов с переводом, непереведённых нет',
    !!i18n && i18n.langs?.join(',') === 'en,ru'
    && Object.values(i18n.sections ?? {}).every((s) => s.ru === true)
    && (i18n.untranslated ?? []).length === 0,
    i18n ? `разделов ${Object.keys(i18n.sections ?? {}).length}, непереведённых ${(i18n.untranslated ?? []).length}` : 'файла нет');
}

{
  // Поиск по переводу — тем же движком, что в читалке.
  const ruFile = path.join(DIR, 'search-ru.json');
  const ruSearch = existsSync(ruFile) ? readJson(ruFile) : null;
  const ruEngine = ruSearch ? createSearch(ruSearch) : null;
  const hitsRu = (q) => (ruEngine ? ruEngine.search(q).filter((r) => r.kind === 'spec-para' || r.kind === 'spec-node') : []);
  const cases = ['квалификатор', 'композиция', 'дорожка', 'вывод'];
  const missing = cases.filter((q) => hitsRu(q).length === 0);
  ok('поиск по переводу: «квалификатор», «композиция», «дорожка», «вывод» находят русские статьи',
    !!ruEngine && missing.length === 0,
    missing.length ? `ничего: ${missing.join(', ')}` : cases.map((q) => `${q} → ${hitsRu(q)[0].ref}`).join(', '));
  const q = ruEngine ? ruEngine.search('квалификатор') : [];
  ok('«квалификатор» в переводе ведёт в 9.5.3',
    q[0] && String(q[0].ref).startsWith('9.5.3'), q[0] ? `${q[0].kind} ${q[0].ref}` : 'ничего');
  const latin = ruEngine ? ruEngine.search('association') : [];
  ok('запрос латиницей находит русский текст через словарь (псевдонимы в обе стороны)',
    latin.length > 0 && latin.some((r) => /[а-яё]/i.test(String(r.text))),
    latin[0] ? `${latin[0].ref}: ${String(latin[0].text).slice(0, 40)}` : 'ничего');
}

{
  const gl = existsSync(path.join(DIR, 'glossary.json')) ? readJson(path.join(DIR, 'glossary.json')) : null;
  ok('glossary.json: 315 терминов en → ru для страницы словаря',
    gl && gl.count === 315 && gl.terms.length === 315
    && gl.terms.every((t) => t.en && t.ru),
    gl ? `${gl.count} терминов` : 'файла нет');
}

/* ------------------------------------------------ 7. детерминированность */

if (!has('no-build')) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'ref-det-'));
  const hash = (dir) => {
    const out = [];
    const walk = (d) => {
      for (const f of readdirSync(d).sort()) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.json')) out.push(`${path.relative(dir, p)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
      }
    };
    walk(dir);
    return out.join('\n');
  };
  try {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    const c = path.join(tmp, 'notext');
    execFileSync(process.execPath, [path.join(HERE, 'build-reference.mjs'), `--out=${a}`, '--quiet']);
    execFileSync(process.execPath, [path.join(HERE, 'build-reference.mjs'), `--out=${b}`, '--quiet']);
    execFileSync(process.execPath, [path.join(HERE, 'build-reference.mjs'), `--out=${c}`, '--no-full-text', '--quiet']);
    const ha = hash(a);
    const hb = hash(b);
    const files = ha.split('\n').length;
    ok('два прогона build-reference.mjs дают побайтово те же файлы',
      ha === hb && files > 25, `${files} файлов`);
    // Тот же замер для перевода: `--lang=ru` пишет только spec-ru, i18n,
    // search-ru и словарь.
    const ra = path.join(tmp, 'ra');
    const rb = path.join(tmp, 'rb');
    execFileSync(process.execPath, [path.join(HERE, 'build-reference.mjs'), '--lang=ru', `--out=${ra}`, '--quiet']);
    execFileSync(process.execPath, [path.join(HERE, 'build-reference.mjs'), '--lang=ru', `--out=${rb}`, '--quiet']);
    const hra = hash(ra);
    const hrb = hash(rb);
    const ruFiles = hra.split('\n').length;
    ok('два прогона build-reference.mjs --lang=ru дают побайтово те же файлы',
      hra === hrb && ruFiles >= 29, `${ruFiles} файлов`);
    const nt = readJson(path.join(c, 'spec', '11.json'));
    const art = nt.articles.find((x) => x.number === '11.5.4');
    const con = nt.articles.find((x) => x.number === '11.8.1.8');
    ok('вариант --no-full-text собирается: без прозы, с номерами, именами и OCL',
      art.blocks.length === 0 && con.blocks.length > 0 && con.blocks.every((x) => x.t === 'kv' && x.ocl),
      `11.5.4 блоков ${art.blocks.length}, 11.8.1.8 констрейнтов ${con.blocks.length}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------- итог */

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} проверок прошло`);
process.exit(failed === 0 ? 0 : 1);
