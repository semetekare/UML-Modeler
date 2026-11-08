// Ссылки модели: один индекс на правило вместо линейных поисков по id.
//
// Модель одноисточниковая. У элемента одно имя и один вид на всех листах, а
// фигура ссылается на `elementId`; поэтому «разные имена на разных диаграммах»
// невозможны по построению и проверять их нечем. Проверять можно только ССЫЛКИ:
// `classifierId`, `behaviorRef`, `represents`, `refersTo`, `laneId`, `ownerId` —
// они и есть единственное место, где листы расходятся с моделью.
//
// Зачем отдельный модуль. До него каждый модуль правил заводил свой
// `elementById` (`meta.js`) и звал его внутри цикла по элементам — это O(n²) на
// большой модели. Здесь индекс строится один раз и дальше поиск идёт за O(1):
// правило строит индекс в начале своей функции и передаёт его в `resolve`,
// `ownerChain` и `diagramOf`.
//
// Кешировать индекс по объекту модели НЕЛЬЗЯ: `commit` в `state/store.js` правит
// модель на месте, массивы остаются теми же, и кеш пережил бы правку — правило
// судило бы вчерашнюю модель. Поэтому `refIndex` — чистая функция, а её вызов
// стоит один проход по модели на правило, а не поиск на каждый элемент.
//
// Границы, общие для всех, кто сюда приходит (и записанные в `hint` правил, а не
// только в коде):
//   * пустая ссылка — не ссылка: поле либо отсутствует, либо пустая строка;
//   * битая ссылка (id не найден) — забота загрузчика: `validateRefs` в
//     `io/umljson.js` снимает её с починкой, и судить её здесь значило бы
//     сообщать об одном и том же дважды;
//   * ссылка на лист по имени (`refersTo` из подпотока) — тоже не наша:
//     такого листа в файле нет, и это законно.

/**
 * Листы взаимодействия (UML 2.5.1 §17). Набор назван явно, а не выведен из
 * `notation/uml.json`: у видов листов там лежит `kind: 'behavioural'`, и по нему
 * в набор попали бы деятельность и состояния. Четыре вида — это ровно те, что
 * стандарт зовёт InteractionDiagram: последовательность, коммуникация, время и
 * обзор взаимодействий.
 */
export const INTERACTION_DIAGRAMS = new Set(['sequence', 'communication', 'timing', 'interaction-overview']);

/**
 * Индекс модели: `Map` id → элемент, id → связь, id → лист, плюс обратная
 * таблица «элемент → листы, где стоит его фигура».
 *
 * id приводятся к строке: в файле `id` — строка, но модель, собранная в памяти
 * (импорт, восстановление), может принести число, и `Map.get(1)` не нашёл бы
 * `'1'`. Это дешевле, чем ловить такие расхождения в каждом правиле.
 *
 * `sheets` хранит СПИСОК листов, а не один: один элемент может стоять на
 * нескольких листах, и правилу о ссылке на лист нужно знать все, а не первый.
 * `diagramOf` при этом отдаёт первый по порядку модели — так договорились там,
 * где нужен «тот лист, куда поведёт клик».
 */
export function refIndex(model) {
  const elements = new Map();
  const relationships = new Map();
  const diagrams = new Map();
  const sheets = new Map();

  for (const el of model?.elements ?? []) {
    if (el?.id == null) continue;
    elements.set(String(el.id), el);
  }
  for (const rel of model?.relationships ?? []) {
    if (rel?.id == null) continue;
    relationships.set(String(rel.id), rel);
  }
  for (const d of model?.diagrams ?? []) {
    if (d?.id == null) continue;
    diagrams.set(String(d.id), d);
    for (const s of d.shapes ?? []) {
      if (s?.elementId == null) continue;
      const key = String(s.elementId);
      const list = sheets.get(key);
      // Две фигуры одного элемента на одном листе — не два листа. Дедупликация
      // по id листа, а не по объекту: загрузчик может отдать равные копии.
      if (!list) sheets.set(key, [d]);
      else if (!list.some((x) => String(x.id) === String(d.id))) list.push(d);
    }
  }
  return { elements, relationships, diagrams, sheets };
}

/**
 * Элемент или связь модели по id; `null`, если такого id нет.
 *
 * Без `index` строит его заново — так можно звать из разовой проверки, но НЕ из
 * цикла: там индекс передают параметром, иначе поиск снова станет линейным.
 */
export function resolve(model, id, index = null) {
  if (id == null || id === '') return null;
  const ix = index ?? refIndex(model);
  const key = String(id);
  return ix.elements.get(key) ?? ix.relationships.get(key) ?? null;
}

/** Лист по id; `null`, если листа с таким id нет (или ссылка задана именем). */
export function diagramById(model, id, index = null) {
  if (id == null || id === '') return null;
  const ix = index ?? refIndex(model);
  return ix.diagrams.get(String(id)) ?? null;
}

/**
 * Цепочка владельцев по `ownerId`, начиная с ближайшего: `[владелец, его
 * владелец, …]`. Сам элемент в цепочку не входит — иначе «цепочка владельцев»
 * начиналась бы с того, чьи владельцы ищутся.
 *
 * Защита от цикла здесь не украшение: цикл по `ownerId` ловит
 * `element-own-self`, но ловит его ОТДЕЛЬНОЕ правило, и если оно почему-то не
 * отработает (сбой, отключение), обход владельцев повесил бы весь прогон.
 * Поэтому `seen` — и цикл просто обрывает цепочку.
 */
export function ownerChain(model, id, index = null) {
  const ix = index ?? refIndex(model);
  const chain = [];
  const seen = new Set([String(id)]);
  let cur = ix.elements.get(String(id));
  while (cur?.ownerId) {
    const key = String(cur.ownerId);
    if (seen.has(key)) break;
    seen.add(key);
    const owner = ix.elements.get(key);
    if (!owner) break;
    chain.push(owner);
    cur = owner;
  }
  return chain;
}

/** Все листы, на которых стоит фигура элемента, в порядке модели. */
export function sheetsOf(model, id, index = null) {
  const ix = index ?? refIndex(model);
  return ix.sheets.get(String(id)) ?? [];
}

/** Первый по порядку модели лист, на котором есть фигура элемента, или `null`. */
export function diagramOf(model, id, index = null) {
  return sheetsOf(model, id, index)[0] ?? null;
}
