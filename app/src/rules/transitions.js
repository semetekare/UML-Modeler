// 14.5.11.8 — два констрейнта Transition о сегментах разделения и объединения.
//
// `fork` и `join` — псевдосостояния машины состояний, и переходы из них (и в
// них) ведут в состояния. В диаграмме деятельности те же фигуры соединены
// `controlFlow`, а не `transition`, поэтому правила видят только машину
// состояний: `fork → action` по `controlFlow` — законная деятельность, и
// ругаться на неё было бы ложным срабатыванием на каждой правильной
// диаграмме деятельности (та же ловушка, что в `pseudostates.js`).
//
// РЕШЕНИЕ О `fork → final` (и `initial → join`). По букве OCL это нарушение:
// `target.oclIsKindOf(State)`, а `final` — FinalState, не State. Но на практике
// так рисуют: разделение сразу в два конечных исхода — обычная запись, и
// объявить её ошибкой значило бы ругаться на нормальные диаграммы пособия.
// Молча пропускать нельзя, поэтому здесь `warning` с объяснением в `hint`:
// замечание есть, но оно не притворяется нарушением формы. Список «что не
// State» — состояния, псевдосостояния и конечное состояние; всё прочее (действие,
// объект, заметка) остаётся `error`: это уже чужая диаграмма, а не запись
// «разделение в финал».

import { elementById } from './meta.js';
import { titleOf } from './graph.js';
import { report } from './finding.js';

/**
 * Псевдосостояния и конечное состояние: State они не являются, но встречаются в
 * сегменте на практике, поэтому дают `warning`, а не `error` (см. шапку).
 * Сам `state` сюда не входит: он и есть норма, и до этой ветки дело не доходит.
 */
const EXCUSED = new Set([
  'final', 'initial', 'choice', 'junction', 'fork', 'join',
  'historyShallow', 'historyDeep', 'entryPoint', 'exitPoint',
]);

/** Переходы модели: связь вида `transition`, у которой оба конца на месте. */
function transitionsOf(model) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (rel.kind !== 'transition') continue;
    const from = elementById(model, rel.from);
    const to = elementById(model, rel.to);
    if (!from || !to) continue;
    out.push({ rel, from, to });
  }
  return out;
}

/**
 * Одно замечание на переход. `culprit` — кто нарушает: цель у сегмента
 * разделения, начало у сегмента объединения.
 */
function segmentFinding(rule, { rel, culprit, what }) {
  const level = EXCUSED.has(culprit.kind) ? 'warning' : null;
  const finding = report(rule, [rel.id, culprit.id],
    `переход ${rel.id}: ${what} — ${titleOf(culprit)} (${culprit.kind})`);
  // Уровень правила — `error`; исключение `fork → final` объявлено `warning`
  // (см. шапку модуля). Уровень живёт в замечании, а не в правиле, потому что
  // одно правило судит и «чужая диаграмма» (ошибка), и «так рисуют» (совет).
  if (level) finding.level = level;
  return finding;
}

/**
 * 14.5.11.8 — `fork_segment_state`: сегмент разделения всегда ведёт в состояние.
 *
 * Замечание — на переход и на его цель: виновата связь, но по клику человеку
 * нужен тот конец, который не состояние.
 */
export function transitionForkTargetState(model, rule) {
  const out = [];
  for (const t of transitionsOf(model)) {
    if (t.from.kind !== 'fork') continue;
    if (t.to.kind === 'state') continue;
    out.push(segmentFinding(rule, { ...t, culprit: t.to, what: 'из разделения переход ведёт не в состояние' }));
  }
  return out;
}

/**
 * 14.5.11.8 — `join_segment_state`: сегмент объединения исходит из состояния.
 */
export function transitionJoinSourceState(model, rule) {
  const out = [];
  for (const t of transitionsOf(model)) {
    if (t.to.kind !== 'join') continue;
    if (t.from.kind === 'state') continue;
    out.push(segmentFinding(rule, { ...t, culprit: t.from, what: 'в объединение переход приходит не из состояния' }));
  }
  return out;
}
