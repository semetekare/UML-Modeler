// Данные справочника: один слой загрузки, ленивый и офлайновый.
//
// Всё лежит рядом со страницей в reference/ (его собирает
// app/tools/build-reference.mjs) и в notation/rules/ — сеть не нужна.
// Каждый файл грузится один раз и запоминается: раздел стандарта 301 КБ
// целиком в память не тянется, только открытый.

const REF = new URL('../../reference/', import.meta.url);
const APP = new URL('../../', import.meta.url);

const cache = new Map();
const pending = new Map();

async function json(url, label) {
  const key = String(url);
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    const data = await res.json();
    cache.set(key, data);
    pending.delete(key);
    return data;
  })();
  pending.set(key, p);
  return p;
}

const refJson = (rel, label = rel) => json(new URL(rel, REF), label);

export const specIndex = () => refJson('spec/index.json', 'spec/index.json');
export const section = (file) => refJson(file, file);
export const links = () => refJson('links.json');
export const cards = () => refJson('cards.json');
export const stereotypes = () => refJson('stereotypes.json');
export const plantuml = () => refJson('plantuml.json');
export const searchIndex = () => refJson('search.json');
export const terms = () => refJson('terms.json');
// Русский перевод (собирает второй проход build-reference.mjs --lang=ru):
// тот же spec/index.json по форме, та же форма статей, отдельный поиск.
export const specRuIndex = () => refJson('spec-ru/index.json', 'spec-ru/index.json');
export const searchRu = () => refJson('search-ru.json', 'search-ru.json');
export const glossary = () => refJson('glossary.json', 'glossary.json');
export const i18n = () => refJson('spec/i18n.json', 'spec/i18n.json');

/** Необязательный файл: его отсутствие — не ошибка, а «перевода нет». */
export async function optional(fn) {
  try { return await fn(); } catch { return null; }
}

/** Правила движка — тот же файл, что читает панель «Проверки». */
export const rules = () => json(new URL('notation/rules/uml-2.5.1.json', APP), 'rules');

/**
 * Слой практики: 7 советов моделирования. Отдельный файл, потому что это не
 * констрейнты стандарта: у них нет пункта, и на полке «Правила» они стоят
 * своей группой с чипом «практика» (docs/research/VALIDATOR-PLAN.md §3.4).
 */
export const practiceRules = () => json(new URL('notation/rules/practice.json', APP), 'practice');

/** Пособие: главы и упражнения уже собраны для панели «Курс». */
export const courseIndex = () => json(new URL('course/index.json', APP), 'course/index.json');

/**
 * Реестр констрейнтов UML 2.5.1 для полки «Стандарт»: все 449 строк со
 * статусом проверяемости. Это НЕ набор правил движка (`rules` выше): там 58
 * записанных правил, здесь — весь стандарт, включая 283 «вне области».
 * Один fetch на всё приложение: таблица рисуется из этого же объекта.
 */
export const coverage = () => json(new URL('notation/rules/coverage.json', APP), 'coverage.json');

/** Текст упражнения — markdown, рендерит существующий markdown() из course.js. */
export async function courseText(rel) {
  const url = new URL(rel, APP);
  const key = String(url);
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  const text = await res.text();
  cache.set(key, text);
  return text;
}

/** Адрес уведомления OMG: ссылка с первой страницы «Спецификации». */
export const noticeHref = new URL('NOTICE.md', REF).pathname;
