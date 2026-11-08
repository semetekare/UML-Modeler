// Поиск по всем шести полкам: чистая функция над готовым индексом.
//
// Ровно те правила, что записаны в search.json → ranking, и ровно тот же
// алгоритм, которым проверен индекс в material/reference-content/
// check_search.mjs: запрос расширяется по глоссарию (русский → английский),
// термины индекса подбираются по префиксу, вес документа умножается на
// приоритет вида, сверху — бонус за имя записи, якорь понятия и целую фразу.
//
// Модуль не трогает DOM и не ходит в сеть: его импортирует и читалка, и
// app/tools/check-reference.mjs. Один алгоритм — одна проверка.

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

/** Те же правила, что у сборщика индекса (build_search_index.py). */
export function tokenize(text) {
  const out = [];
  for (const w of String(text).toLowerCase().replace(/ё/g, 'е').match(/[0-9a-zа-я]+/g) ?? []) {
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

const KIND_PRIORITY = [1.25, 1.0, 1.1, 1.0, 0.95, 0.95, 1.0, 0.9];

/**
 * Разбор составного имени служебного документа: «Description — Class: проза»
 * → `{name:'Description — Class', detail:'Description — Class', body:'проза'}`.
 *
 * Имя собрано сборщиком индекса из подзаголовка и родителя (см.
 * `SUBTITLE_TITLES` в build_search_index.py). Читалке нужно уметь показать
 * имя отдельно от прозы: «Description — Class · п. 11.8.3.1» читается, а
 * голое «Description» — нет. Возвращает null, если имя не составное: у
 * обычного абзаца его нет, и подписью служит сам текст.
 */
export function splitDocName(text) {
  const m = /^([^:—]{3,80}?) — ([^:]{1,60}?): /.exec(String(text ?? ''));
  if (!m) return null;
  const name = `${m[1]} — ${m[2]}`;
  return {
    name,
    // Ключи для сравнения с запросом: с тире и без — «association ends»
    // человек печатает без тире.
    keys: [name.toLowerCase().replace(/ё/g, 'е'),
      `${m[1]} ${m[2]}`.toLowerCase().replace(/ё/g, 'е')],
    body: String(text).slice(m[0].length),
  };
}

/**
 * @param {{docs: any[], postings: Record<string,string>, glossary: Record<string,string>,
 *          anchors: any[], kinds: string[]}} index
 */
export function createSearch(index) {
  const { docs, postings, glossary = {}, anchors = [], kinds = [] } = index;
  const N = docs.length;
  const allTerms = Object.keys(postings);
  const docTokens = docs.map((d) => new Set(tokenize(d[2])));

  // Составное имя служебного документа: «Description — Class: проза».
  //
  // Проза под служебным подзаголовком метакласса названа именем родителя
  // (build_search_index.py, SUBTITLE_TITLES). Такое имя — два слова через
  // тире, и искать надо по обеим половинам: «association ends» — заголовок,
  // «Association» — метакласс. Разбор один на документ, как и токены.
  const docNames = docs.map((d) => (d[0] === 1 ? splitDocName(d[2]) : null));

  const anchorByTerm = new Map();
  for (const a of anchors) {
    for (const t of [a.term, ...(a.aliases ?? []), a.ru]) {
      if (t) anchorByTerm.set(String(t).toLowerCase(), a);
    }
  }

  const decodeCache = new Map();
  const decodeIds = (str) => {
    let ids = decodeCache.get(str);
    if (ids) return ids;
    ids = str.split(',').map((s) => parseInt(s, 36));
    decodeCache.set(str, ids);
    return ids;
  };

  const glossaryKeys = Object.keys(glossary);
  const expand = (term) => {
    const out = new Set([term]);
    const push = (en) => { if (en) for (const t of tokenize(en)) out.add(t); };
    push(glossary[term]);
    // Русский префикс: человек печатает «квалифи» и ещё не допечатал
    // «квалификатор». Точного ключа нет — берём до трёх ключей по началу.
    if (!glossary[term] && term.length >= 4) {
      let n = 0;
      for (const key of glossaryKeys) {
        if (n >= 3) break;
        if (key.startsWith(term)) { push(glossary[key]); n += 1; }
      }
    }
    return out;
  };

  const queryTerms = (query) => {
    const terms = new Set(tokenize(query));
    const whole = glossary[String(query).trim().toLowerCase().replace(/ё/g, 'е')];
    if (whole) for (const t of tokenize(whole)) terms.add(t);
    return [...terms];
  };

  const matchTerms = (q) => {
    const hits = [];
    for (const t of allTerms) {
      if (t === q) hits.push([t, 1]);
      else if (q.length >= 4 && t.startsWith(q) && t.length <= q.length + 3) hits.push([t, 0.9]);
      else if (t.length >= 4 && q.startsWith(t) && q.length <= t.length + 3) hits.push([t, 0.8]);
    }
    return hits;
  };

  const idf = (term) => {
    const ids = postings[term];
    const df = ids ? ids.split(',').length : 0;
    return Math.log(1 + N / Math.max(1, df));
  };

  const underClause = (doc, clause) => {
    const ref = String(doc[1]);
    return ref === clause || ref.startsWith(`${clause}.`);
  };

  const isEntry = (doc) => doc[0] !== 1;

  /**
   * @param {string} query
   * @returns {{id:number, score:number, doc:any[], kind:string, ref:string, text:string}[]}
   *   по убыванию счёта; ничья — по порядку индекса (устойчиво).
   */
  function search(query) {
    const raw = queryTerms(query);
    if (raw.length === 0) return [];
    const scores = new Map();
    const bump = (i, v) => scores.set(i, (scores.get(i) ?? 0) + v);

    const seen = new Set();
    const anchored = new Set();
    for (const q of raw) {
      for (const term of expand(q)) {
        if (seen.has(term)) continue;
        seen.add(term);
        for (const [t, factor] of matchTerms(term)) {
          const w = idf(t) * factor;
          for (const id of decodeIds(postings[t])) {
            bump(id, w * docs[id][4] * KIND_PRIORITY[docs[id][0]]);
          }
          // Якорь понятия срабатывает и по префиксу: «qualif» — это тот же
          // «qualifier», просто человек не допечатал слово.
          const hit = anchorByTerm.get(t);
          if (hit) anchored.add(hit);
        }
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

    const qPhrase = String(query).trim().toLowerCase().replace(/ё/g, 'е');

    // Бонус за имя служебного документа. У записи (пункт, правило, фигура)
    // имя — это весь текст, и за него платит nameBonus выше. У абзаца имени
    // нет, кроме составного «Description — Class»; он и значит ровно то, чем
    // назван. Считается один раз на запрос, а не на термин: иначе
    // «association ends» получил бы бонус дважды — за «association» и «ends».
    // Вес у таких документов ниже (SUBTITLE_WEIGHT), поэтому бонус не даёт
    // им перебить сам пункт стандарта.
    if (qPhrase.length >= 4) {
      for (const [id, s] of scores) {
        const nm = docNames[id];
        if (!nm) continue;
        let bonus = 0;
        for (const key of nm.keys) {
          if (qPhrase === key) { bonus = 14; break; }
          if (key.startsWith(`${qPhrase} `) || qPhrase.startsWith(`${key} `)) { bonus = Math.max(bonus, 6); continue; }
          if (key.includes(qPhrase)) bonus = Math.max(bonus, 2);
        }
        if (bonus) scores.set(id, s + bonus * docs[id][4]);
      }
    }

    // Якорь понятия: справочная статья о понятии, а не первое упоминание слова.
    // Срабатывает на название понятия целиком или одним словом, в том числе
    // недопечатанным (префикс уже попал в `anchored`).
    const exact = anchorByTerm.get(String(query).trim().toLowerCase().replace(/ё/g, 'е'));
    const anchorsToApply = new Set();
    if (exact) anchorsToApply.add(exact);
    if (raw.length === 1) for (const a of anchored) anchorsToApply.add(a);
    for (const anchor of anchorsToApply) {
      for (const [id, s] of scores) {
        if (underClause(docs[id], anchor.clause)) scores.set(id, s + 20 * docs[id][4]);
      }
    }

    const phrase = qPhrase;
    if (phrase.length >= 4) {
      for (const [id, s] of scores) {
        if (docs[id][2].toLowerCase().replace(/ё/g, 'е').includes(phrase)) {
          scores.set(id, s + 8 * docs[id][4]);
        }
      }
    }

    return [...scores.entries()]
      .map(([id, score]) => {
        const name = docNames[id];
        return {
          id, score, doc: docs[id], kind: kinds[docs[id][0]], ref: String(docs[id][1]), text: docs[id][2],
          // `name` — только у служебных документов: читалка показывает его
          // вместо обрезанного текста, и «Description — Class · п. 11.8.3.1»
          // читается, а «Description» — нет. У остальных null.
          name: name ? name.name : null,
        };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id);
  }

  return { search, docTokens, kindOf: (doc) => kinds[doc[0]] };
}

/** Вид документа индекса → полка читалки. */
export const SHELF_OF_KIND = {
  'spec-node': 'spec',
  'spec-para': 'spec',
  rule: 'rules',
  stereotype: 'stereotypes',
  shape: 'notation',
  connector: 'notation',
  exercise: 'tutorial',
  plantuml: 'plantuml',
};
