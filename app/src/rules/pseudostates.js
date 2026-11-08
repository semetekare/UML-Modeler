// 14.5.2.5, 14.5.6.7 — псевдосостояния машины состояний.
//
// Семь констрейнтов о видах `initial`, `choice`, `junction`, `fork`, `join`,
// `historyShallow`, `historyDeep` и о конечном состоянии `final`. Все они
// говорят о ПЕРЕХОДАХ (`transition`), а не о рёбрах деятельности: вид `fork` и
// `join` один для псевдосостояния и для узла деятельности, и различает их тип
// рёбер (см. `graph.js`). Поэтому `fork` на диаграмме деятельности эти правила
// не трогают, а `fork` в машине состояний не трогают правила о деятельности.
//
// ГРАНИЦА «ТОЛЬКО ЧТО НАРИСОВАНО» — у четырёх правил: `choice_vertex`,
// `junction_vertex`, `fork_vertex`, `join_vertex`. Фигура без единого перехода
// молчит: только что нарисованный выбор, соединение, разделение или
// объединение ещё не соединён, и по букве OCL (`incoming->size() >= 1`,
// `outgoing->size() = 1`) каждое из них было бы нарушением с первого штриха.
// Прецедент — `CombinedFragment` (`fragments.js`): граница «ноль операндов»
// сняла 26 ложных срабатываний на корпусе из 27 фрагментов. Договорённость
// записана в `hint` каждого правила, а не только в коде.
//
// Три правила границы не требуют, и это не упущение:
//   * `initial_vertex` и `history_vertices` ограничивают сверху (`<= 1`), а
//     ноль переходов такое ограничение выполняет — молчать не о чем;
//   * `no_outgoing_transitions` требует ровно нуля: отсутствие переходов и есть
//     норма.
//
// Ещё одна граница, не про «только что нарисовано»: `final` в машине состояний
// и `final` в деятельности — один вид, и правило о переходах считает только
// переходы. Конечный узел деятельности с исходящим потоком управления ловит
// `FinalNode::no_outgoing_edges` (`activity.js`), а не это правило.
//
// ЧЕТЫРЕ КОНСТРЕЙНТА О ПОЛЯХ `final` (`no_regions`, `no_entry_behavior`,
// `no_exit_behavior`, `no_state_behavior`) судят не связи, а данные элемента:
// регионы, тексты входа, выхода и `do`. У них нет границы «только что
// нарисовано»: свежее конечное состояние — это элемент с пустыми полями, и все
// четыре условия (`region->size() = 0`, `entry->isEmpty()`, `exit->isEmpty()`,
// `doActivity->isEmpty()`) на нём выполняются сами.
//
// Вид `final` один для машины состояний и для деятельности, поэтому поля
// `entry`/`exit`/`do` у конечного УЗЛА деятельности (FinalNode) смысла не
// имеют. Схема их вида не различает, и проверка идёт по виду: конечный узел
// деятельности с заполненным `entry` получил бы замечание FinalState. Такого
// случая в корпусе нет (у конечных узлов эти поля пусты), а придумывать
// различение нечем — `kind` у обоих `final`.

import { STATE_EDGES, edgeIndex, edgesOf, noEdges, titleOf } from './graph.js';
import { report } from './finding.js';

const HISTORY = new Set(['historyShallow', 'historyDeep']);

/**
 * 14.5.6.7 — `initial_vertex`: `outgoing->size() <= 1`.
 *
 * У начального состояния не больше одного исходящего перехода. Ноль переходов
 * ограничение выполняет, поэтому отдельной границы нет: свежее начальное
 * состояние молчит само.
 */
export function pseudostateInitialVertex(model, rule) {
  const index = edgeIndex(model, STATE_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'initial') continue;
    const { outgoing } = edgesOf(index, el.id);
    if (outgoing.length <= 1) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: исходящих переходов ${outgoing.length}, а стандарт допускает не больше одного`));
  }
  return out;
}

/**
 * 14.5.6.7 — `choice_vertex`: `incoming->size() >= 1 and outgoing->size() >= 1`.
 *
 * Выбор — динамическая развилка: в полной машине состояний у него есть и вход,
 * и выход. Фигура без единого перехода пропускается (см. шапку модуля).
 */
export const pseudostateChoiceVertex = (model, rule) => bothSides(model, rule, 'choice');

/**
 * 14.5.6.7 — `junction_vertex`: `incoming->size() >= 1 and outgoing->size() >= 1`.
 *
 * Соединение — статическая развилка, и правило у него то же, что у выбора.
 * Фигура без единого перехода пропускается.
 */
export const pseudostateJunctionVertex = (model, rule) => bothSides(model, rule, 'junction');

/**
 * 14.5.6.7 — `fork_vertex`: `incoming->size() = 1 and outgoing->size() >= 2`.
 *
 * Разделение в машине состояний: один вход, не меньше двух выходов в разные
 * области ортогонального состояния. Фигура без единого перехода пропускается.
 */
export function pseudostateForkVertex(model, rule) {
  const index = edgeIndex(model, STATE_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'fork') continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    const bad = [];
    if (edges.incoming.length !== 1) {
      bad.push(`входящих переходов ${edges.incoming.length} (стандарт: ровно один)`);
    }
    if (edges.outgoing.length < 2) {
      bad.push(`исходящих переходов ${edges.outgoing.length} (стандарт: не меньше двух)`);
    }
    if (!bad.length) continue;
    out.push(report(rule, [el.id], `${titleOf(el)}: ${bad.join(', ')}`));
  }
  return out;
}

/**
 * 14.5.6.7 — `join_vertex`: `outgoing->size() = 1 and incoming->size() >= 2`.
 *
 * Объединение в машине состояний: не меньше двух входов из разных областей и
 * ровно один выход. Фигура без единого перехода пропускается.
 */
export function pseudostateJoinVertex(model, rule) {
  const index = edgeIndex(model, STATE_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'join') continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    const bad = [];
    if (edges.outgoing.length !== 1) {
      bad.push(`исходящих переходов ${edges.outgoing.length} (стандарт: ровно один)`);
    }
    if (edges.incoming.length < 2) {
      bad.push(`входящих переходов ${edges.incoming.length} (стандарт: не меньше двух)`);
    }
    if (!bad.length) continue;
    out.push(report(rule, [el.id], `${titleOf(el)}: ${bad.join(', ')}`));
  }
  return out;
}

/**
 * 14.5.6.7 — `history_vertices`: у истории не больше одного исходящего перехода.
 *
 * Правило одно на два вида: мелкая (`historyShallow`) и глубокая
 * (`historyDeep`) история отличаются тем, что восстанавливают, а не числом
 * переходов. Ноль переходов ограничение выполняет — границы нет.
 */
export function pseudostateHistoryVertices(model, rule) {
  const index = edgeIndex(model, STATE_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (!HISTORY.has(el.kind)) continue;
    const { outgoing } = edgesOf(index, el.id);
    if (outgoing.length <= 1) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: исходящих переходов ${outgoing.length}, а стандарт допускает не больше одного`));
  }
  return out;
}

/**
 * 14.5.2.5 — `no_outgoing_transitions`: `outgoing->size() = 0`.
 *
 * Из конечного состояния выйти нельзя. Здесь граница «только что нарисовано»
 * не нужна: ноль переходов — это и есть норма (см. `hint`).
 */
export function finalStateNoOutgoingTransitions(model, rule) {
  const index = edgeIndex(model, STATE_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'final') continue;
    const { outgoing } = edgesOf(index, el.id);
    if (!outgoing.length) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el, 'конечное состояние')}: исходящих переходов ${outgoing.length}, `
      + 'а из конечного состояния выйти нельзя'));
  }
  return out;
}

/**
 * Общая половина `choice_vertex` и `junction_vertex`: хотя бы по одному
 * переходу с каждой стороны.
 *
 * Фигура без единого перехода пропускается: это только что нарисованный узел,
 * а не нарушение (см. шапку модуля).
 */
function bothSides(model, rule, kind) {
  const index = edgeIndex(model, STATE_EDGES);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== kind) continue;
    const edges = edgesOf(index, el.id);
    if (noEdges(edges)) continue;
    const bad = [];
    if (!edges.incoming.length) bad.push('входящих переходов нет');
    if (!edges.outgoing.length) bad.push('исходящих переходов нет');
    if (!bad.length) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: ${bad.join(', ')} (стандарт: хотя бы по одному)`));
  }
  return out;
}

/* ------------------------- чего у конечного состояния не бывает (поля) */

/**
 * Текст поля элемента; пустая строка и одни пробелы — «не задано».
 *
 * Поля `entry`/`exit`/`do` в модели — СПИСОК строк (у состояния их может быть
 * несколько), поэтому строки склеиваются через `; `, а пустые выбрасываются:
 * поле из одних пробелов считается незаданным, иначе конечное состояние с
 * полем « » получало бы замечание о тексте, которого никто не видит.
 */
function textOf(el, field) {
  const raw = el?.[field];
  const rows = (Array.isArray(raw) ? raw : [raw])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  return rows.join('; ');
}

/** Общий обход конечных состояний: `visit(el)` отдаёт текст замечания или `null`. */
function forEachFinal(model, rule, visit) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'final') continue;
    const detail = visit(el);
    if (detail) out.push(report(rule, [el.id], detail));
  }
  return out;
}

/**
 * 14.5.2.5 — `no_regions`: `region->size() = 0`.
 *
 * Конечное состояние — лист машины состояний: у него нет внутренних областей,
 * поэтому и регионов быть не может. Пустой список регионов — норма, а не
 * нарушение: свежее конечное состояние молчит.
 */
export function finalStateNoRegions(model, rule) {
  return forEachFinal(model, rule, (el) => {
    const regions = Array.isArray(el.regions) ? el.regions : [];
    if (!regions.length) return null;
    return `${titleOf(el)}: регионов ${regions.length}, а у конечного состояния их быть не может`;
  });
}

/**
 * 14.5.2.5 — `no_entry_behavior`: `entry->isEmpty()`.
 *
 * В конечное состояние не входят — оно завершает область, — поэтому текст
 * входа у него пуст. Заполненное поле — всегда ошибка, границы нет.
 */
export function finalStateNoEntry(model, rule) {
  return forEachFinal(model, rule, (el) => (textOf(el, 'entry')
    ? `${titleOf(el)}: задан текст входа «${textOf(el, 'entry')}», а входить в конечное состояние некуда`
    : null));
}

/**
 * 14.5.2.5 — `no_exit_behavior`: `exit->isEmpty()`.
 *
 * Из конечного состояния не выходят (см. `no_outgoing_transitions`), поэтому и
 * текст выхода у него пуст.
 */
export function finalStateNoExit(model, rule) {
  return forEachFinal(model, rule, (el) => (textOf(el, 'exit')
    ? `${titleOf(el)}: задан текст выхода «${textOf(el, 'exit')}», а выходить из конечного состояния нельзя`
    : null));
}

/**
 * 14.5.2.5 — `no_state_behavior`: `doActivity->isEmpty()`.
 *
 * ПРИБЛИЖЕНИЕ, и оно названо в `hint`: `doActivity` — это ПОВЕДЕНИЕ, а в
 * `uml-model/3` поле `do` хранит текст. Пустое поле — норма, непустое значит,
 * что человеку есть что сказать о «пока в состоянии»; у конечного состояния
 * такого «пока» нет вовсе. Поэтому уровень `warning`, а не `error`: текст в
 * `do` не доказывает, что поведение задано, — он доказывает, что его пытались
 * задать.
 */
export function finalStateNoDo(model, rule) {
  return forEachFinal(model, rule, (el) => (textOf(el, 'do')
    ? `${titleOf(el)}: задан текст do «${textOf(el, 'do')}» `
      + '(приближение: `do` хранит текст, а не поведение)'
    : null));
}
