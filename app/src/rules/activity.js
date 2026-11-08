// 15.7.12.5, 15.7.15.5, 15.7.17.4, 15.7.20.6, 15.7.21.4, 15.7.6.5 — узлы
// деятельности.
//
// Девять констрейнтов о шести видах: разделение (`fork`), объединение (`join`),
// слияние (`merge`), решение (`decision`), конечный узел (`final`, `terminate`)
// и узел параметра (`activityParameter`). Все они говорят о входящих и
// исходящих рёбрах ДЕЯТЕЛЬНОСТИ (`controlFlow`, `objectFlow`), а не о переходах:
// у псевдосостояния с тем же видом рёбер деятельности нет, и эти правила его не
// трогают (см. `graph.js`).
//
// ГРАНИЦА «ТОЛЬКО ЧТО НАРИСОВАНО» — общая для семи правил набора. Фигура без
// единой связи молчит: только что нарисованное разделение, слияние или решение
// ещё не соединено, и по букве OCL (`incoming->size()=1`, `outgoing->size()=1`,
// `outgoing->size() > 0`) каждое из них было бы нарушением с первого штриха.
// Прецедент — `CombinedFragment` (`fragments.js`): там граница «ноль операндов»
// сняла 26 ложных срабатываний на корпусе из 27 фрагментов. Договорённость
// записана в `hint` каждого правила, а не только в коде: иначе её не увидит ни
// тот, кто читает замечание, ни тот, кто правит набор.
//
// Исключение — `FinalNode::no_outgoing_edges`: у конечного узла исходящих рёбер
// и не должно быть, поэтому отсутствие связей здесь норма, а не повод молчать.
//
// Ещё две границы названы там, где сравнивать не с чем:
//   * `JoinNode::incoming_object_flow` молчит, пока у объединения нет ни одного
//     входящего ребра: правило сверяет род входящих с родом исходящего, а без
//     входящих сверять нечего (иначе недорисованное объединение получало бы
//     замечание за исходящее ребро, которое ещё не к чему присоединить);
//   * `*::edges` (разделение и слияние) при одном ребре выполняется само: род
//     у одного ребра всегда один, смешивать нечего.

import { ACTIVITY_EDGES, edgeIndex, edgesOf, noEdges, titleOf, edgeTitle } from './graph.js';
import { report } from './finding.js';

/** Конечный узел деятельности: `final` — мишень, `terminate` — крест. */
const FINAL_NODES = new Set(['final', 'terminate']);

/**
 * 15.7.17.4 — `one_incoming_edge`: `incoming->size()=1`.
 *
 * Разделение разводит один поток на несколько, поэтому входящее ребро у него
 * ровно одно. Фигура без единой связи пропускается — см. шапку модуля.
 */
export function forkOneIncomingEdge(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'fork') continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    if (edges.incoming.length === 1) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: входящих рёбер ${edges.incoming.length}, а стандарт требует ровно одно`));
  }
  return out;
}

/**
 * 15.7.17.4 — `edges`: рёбра разделения либо все `ControlFlow`, либо все
 * `ObjectFlow`.
 *
 * Смешивать роды в одном узле нельзя: поток управления несёт маркер, поток
 * объектов — значение, и узел не может разводить то и другое одним движением.
 * Одно ребро смешать не с чем, поэтому правило само молчит на нём.
 */
export const forkEdges = (model, rule) => uniformEdges(model, rule, 'fork');

/**
 * 15.7.21.4 — `one_outgoing_edge`: `outgoing->size()=1`.
 *
 * Слияние сводит несколько альтернативных потоков в один, поэтому исходящее
 * ребро у него ровно одно. Фигура без единой связи пропускается.
 */
export function mergeOneOutgoingEdge(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'merge') continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    if (edges.outgoing.length === 1) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: исходящих рёбер ${edges.outgoing.length}, а стандарт требует ровно одно`));
  }
  return out;
}

/** 15.7.21.4 — `edges`: то же, что у разделения, для слияния. */
export const mergeEdges = (model, rule) => uniformEdges(model, rule, 'merge');

/**
 * 15.7.20.6 — `one_outgoing_edge`: `outgoing->size() = 1`.
 *
 * Объединение синхронизирует параллельные ветви и выпускает один поток.
 * Фигура без единой связи пропускается.
 */
export function joinOneOutgoingEdge(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'join') continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    if (edges.outgoing.length === 1) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: исходящих рёбер ${edges.outgoing.length}, а стандарт требует ровно одно`));
  }
  return out;
}

/**
 * 15.7.20.6 — `incoming_object_flow`: если среди входящих есть поток объектов,
 * исходящее тоже поток объектов; иначе исходящее — поток управления.
 *
 * Род потока сквозь объединение не меняется: объекты приходят — объекты и
 * уходят. Без входящих рёбер сверять нечего, поэтому недорисованное
 * объединение молчит (см. шапку модуля).
 */
export function joinIncomingObjectFlow(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'join') continue;
    const { incoming, outgoing } = edgesOf(index, el.id);
    if (!incoming.length) continue;
    const hasObject = incoming.some((rel) => rel.kind === 'objectFlow');
    const want = hasObject ? 'objectFlow' : 'controlFlow';
    const wrong = outgoing.filter((rel) => rel.kind !== want);
    if (!wrong.length) continue;
    const premise = hasObject
      ? 'среди входящих есть поток объектов, значит исходящее тоже должно быть потоком объектов'
      : 'входящие — только потоки управления, значит исходящее должно быть потоком управления';
    out.push(report(rule, [el.id],
      `${titleOf(el)}: ${premise}, а оно — ${edgeTitle(wrong[0])}`));
  }
  return out;
}

/**
 * 15.7.12.5 — `incoming_outgoing_edges`: `(incoming->size() = 1 or
 * incoming->size() = 2) and outgoing->size() > 0`.
 *
 * У решения одно или два входящих ребра (второе — `decisionInputFlow`, которого
 * в схеме нет, поэтому «одно или два» проверяется как есть) и хотя бы одно
 * исходящее: решение без выхода — тупик. Одно замечание на узел, даже если
 * нарушены обе половины: виноват узел, а не каждая половина отдельно.
 * Фигура без единой связи пропускается.
 */
export function decisionIncomingOutgoingEdges(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'decision') continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    const bad = [];
    const incoming = edges.incoming.length;
    if (incoming !== 1 && incoming !== 2) {
      bad.push(`входящих рёбер ${incoming} (стандарт: одно или два)`);
    }
    if (!edges.outgoing.length) bad.push('исходящих нет (стандарт: хотя бы одно)');
    if (!bad.length) continue;
    out.push(report(rule, [el.id], `${titleOf(el)}: ${bad.join(', ')}`));
  }
  return out;
}

/**
 * 15.7.15.5 — `no_outgoing_edges`: `outgoing->isEmpty()`.
 *
 * Конечный узел завершает поток, поэтому исходящих рёбер у него нет. Здесь
 * граница «только что нарисовано» не нужна: ноль связей — это и есть норма,
 * и молчать было бы нечем (см. `hint`).
 *
 * Видов два: `final` (мишень) и `terminate` (крест). Оба — FinalNode, и оба
 * проверяются одинаково. Переходы машины состояний это правило не считает: у
 * `final` в машине состояний они есть, и за них отвечает
 * `FinalState::no_outgoing_transitions` (`pseudostates.js`).
 */
export function finalNodeNoOutgoingEdges(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (!FINAL_NODES.has(el.kind)) continue;
    const { outgoing } = edgesOf(index, el.id);
    if (!outgoing.length) continue;
    const titles = [...new Set(outgoing.map(edgeTitle))].join(', ');
    out.push(report(rule, [el.id],
      `${titleOf(el, 'конечный узел')}: исходящих рёбер ${outgoing.length} (${titles}), `
      + 'а у конечного узла их не бывает'));
  }
  return out;
}

/**
 * 15.7.6.5 — `no_edges`: `incoming->isEmpty() or outgoing->isEmpty()`.
 *
 * Узел параметра — это вход или выход деятельности: значение входит в неё или
 * выходит из неё, но не проходит насквозь. Поэтому рёбра у него бывают только
 * одного направления; и входящее, и исходящее сразу — это уже не параметр, а
 * действие.
 *
 * Отдельная граница «только что нарисовано» здесь не нужна: у узла без рёбер
 * оба множества пусты, и по букве OCL условие выполняется само. Ноль рёбер —
 * норма, а не молчание по договорённости; это и записано в `hint`.
 */
export function activityParameterNodeNoEdges(model, rule) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'activityParameter') continue;
    const { incoming, outgoing } = edgesOf(index, el.id);
    if (!incoming.length || !outgoing.length) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: входящих рёбер ${incoming.length}, исходящих ${outgoing.length} — `
      + 'у узла параметра бывает только одно направление'));
  }
  return out;
}

/**
 * Общая половина `ForkNode::edges` и `MergeNode::edges`.
 *
 * `allEdges->forAll(oclIsKindOf(ControlFlow)) or allEdges->forAll(...ObjectFlow)`:
 * все рёбра узла одного рода. Род считается по рёбрам деятельности — переходы
 * сюда не попадают (см. `graph.js`).
 */
function uniformEdges(model, rule, kind) {
  const index = edgeIndex(model, ACTIVITY_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== kind) continue;
    const edges = edgesOf(index, el.id);
    const all = [...edges.incoming, ...edges.outgoing];
    const control = all.filter((rel) => rel.kind === 'controlFlow').length;
    if (!control || control === all.length) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: рёбра разных родов — поток управления ${control}, `
      + `поток объектов ${all.length - control}; стандарт требует все рёбра одного рода`));
  }
  return out;
}
