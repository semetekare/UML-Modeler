// Общая часть правил о поведенческих графах: рёбра, их концы и подписи узлов.
//
// Рёбер два рода, и они не смешиваются:
//   * `controlFlow` и `objectFlow` — рёбра деятельности (ActivityEdge, §15.2);
//   * `transition` — переход машины состояний (§14.5.11).
//
// Разделение несёт смысл, а не удобство. Виды `fork` и `join` в нотации одни и
// те же для узла деятельности (ForkNode, JoinNode) и для псевдосостояния машины
// состояний (Pseudostate с kind fork и join): отдельного вида для второго нет.
// Какой метакласс перед нами, решает ТИП РЁБЕР у фигуры — у узла деятельности
// рёбра деятельности, у псевдосостояния переходы. Поэтому правило об узлах
// деятельности молчит там, где у фигуры только переходы, и наоборот: иначе
// `fork` на диаграмме деятельности получал бы замечания из двух наборов сразу,
// а `fork` в машине состояний — из чужого.
//
// Индекс строится один раз на правило: связи модели перебираются в нём, а не в
// каждом элементе, иначе проверка стала бы квадратичной на большой модели.

import { NOTATION } from '../model/notation.js';

/** Рёбра деятельности: поток управления и поток объектов (§15.2). */
export const ACTIVITY_EDGES = new Set(['controlFlow', 'objectFlow']);

/** Переходы машины состояний (§14.5.11). */
export const STATE_EDGES = new Set(['transition']);

const EMPTY = { incoming: [], outgoing: [] };

/**
 * Рёбра модели по концам: `id → { incoming: [], outgoing: [] }`.
 *
 * Считаются только рёбра названных родов: у правила о деятельности переход —
 * не ребро, и наоборот. Связь без конца (`from`/`to` пуст или равен `null`) в
 * индекс не попадает: у такой связи виноват загрузчик, а не узел, и правило
 * узла о ней молчит. Один и тот же id у `from` и `to` (петля) даёт ребро и во
 * входящих, и в исходящих — как и в модели.
 */
export function edgeIndex(model, kinds) {
  const index = new Map();
  const slot = (id) => {
    const key = String(id);
    let found = index.get(key);
    if (!found) {
      found = { incoming: [], outgoing: [] };
      index.set(key, found);
    }
    return found;
  };
  for (const rel of model.relationships ?? []) {
    if (!kinds.has(rel.kind)) continue;
    if (rel.from != null && rel.from !== '') slot(rel.from).outgoing.push(rel);
    if (rel.to != null && rel.to !== '') slot(rel.to).incoming.push(rel);
  }
  return index;
}

/** Концы элемента по индексу; у элемента без рёбер — пустые списки. */
export const edgesOf = (index, id) => index.get(String(id)) ?? EMPTY;

/** «ни одного ребра» — общая граница «только что нарисовано» (см. модули). */
export const noEdges = ({ incoming, outgoing }) => !incoming.length && !outgoing.length;

/**
 * Подпись узла для `detail`: «разделение», «конечное состояние «Заказ закрыт»».
 *
 * Имя берётся из нотации, а не выдумывается здесь: подпись фигуры — часть
 * нотации, и расходиться с палитрой ей нельзя. `fallback` нужен там, где один
 * вид значит разное: `final` — «конечное состояние» в машине состояний и
 * «конечный узел» в деятельности, и правило называет свой метакласс.
 */
export function titleOf(el, fallback = null) {
  const label = String(fallback ?? NOTATION.shapes[el?.kind]?.label ?? el?.kind ?? 'узел').toLowerCase();
  const name = String(el?.name ?? '').trim();
  return name ? `${label} «${name}»` : label;
}

/** Подпись ребра для `detail`: «поток управления», «поток объектов». */
export const edgeTitle = (rel) =>
  String(NOTATION.connectors[rel?.kind]?.label ?? rel?.kind ?? 'ребро').toLowerCase();
