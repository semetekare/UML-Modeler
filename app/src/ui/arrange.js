// Align and distribute a group of shapes (plan 3.3).
//
// The reference frame puts six alignments and two distributions in «Правка»,
// and they only make sense on two or more shapes — one shape is already
// aligned with itself. Everything here works on the selection as a list and
// is one `commit`, so one Ctrl+Z puts the group back.
//
// Geometry is the SHAPE's box, not the drawn box: `layoutOf` may make a class
// taller than its stored height, and aligning drawn boxes would move a shape
// whose text changed. Same measure the resize handles use.
//
// `autoLayout` (iteration 23) is the one command here that can LOSE something:
// the hand-placed bend points of connectors. It therefore asks first — the
// dialog names the count before anything moves — and applies through the same
// single `commit`, so one Ctrl+Z brings shapes and bends back together.

import { store, commit } from '../state/store.js';
import { currentDiagram, findShape, elementOf } from '../model/model.js';
import { layoutOf } from '../model/geometry.js';
import { layoutSupport, planLayout, applyLayoutPlan } from '../model/layout.js';
import { confirmLayout, showError } from './dialog.js';

export const ALIGN_COMMANDS = [
  { id: 'left', label: 'Выровнять по левому краю', icon: 'align-left' },
  { id: 'center', label: 'Выровнять по центру (по вертикали)', icon: 'align-center' },
  { id: 'right', label: 'Выровнять по правому краю', icon: 'align-right' },
  { id: 'top', label: 'Выровнять по верху', icon: 'align-top' },
  { id: 'middle', label: 'Выровнять по середине (по горизонтали)', icon: 'align-middle' },
  { id: 'bottom', label: 'Выровнять по низу', icon: 'align-bottom' },
  { id: 'distribute-h', label: 'Равные промежутки по горизонтали', icon: 'distribute-h' },
  { id: 'distribute-v', label: 'Равные промежутки по вертикали', icon: 'distribute-v' },
];

/** The selected shapes with their drawn boxes, in diagram order. */
export function selectedBoxes(m = store.model) {
  const d = currentDiagram(m);
  if (!d) return [];
  const ids = new Set(store.ui.selection.filter((s) => s.kind === 'shape').map((s) => s.id));
  return d.shapes
    .filter((s) => ids.has(s.id))
    .map((s) => ({ s, box: layoutOf(s, elementOf(m, s)) }));
}

export const canAlign = () => store.ui.selection.filter((s) => s.kind === 'shape').length >= 2;

/**
 * Run one align/distribute command. Returns the number of shapes moved, so the
 * caller can say so; `null` when the selection cannot take the command.
 */
export function arrange(id) {
  const items = selectedBoxes();
  if (items.length < 2) return null;
  const boxes = items.map(({ s, box }) => ({ s, x: s.x, y: s.y, w: box.w, h: box.h }));

  const moved = commit(`Выравнивание: ${id}`, (m) => {
    const live = boxes.map((b) => ({ ...b, s: findShape(m, b.s.id) })).filter((b) => b.s);
    if (live.length < 2) return 0;
    apply(id, live);
    return live.length;
  });
  return moved ?? null;
}

/**
 * «Разложить автоматически…» — добровольная команда.
 *
 * Порядок жёсткий: сначала отказ (последовательность, синхронизация), потом
 * вопрос с числом теряемых изгибов, и только после согласия — `commit`.
 * Ничего не происходит, если человек не нажал кнопку: здесь нет ни таймера,
 * ни подписки, ни вызова из открытия файла.
 *
 * Возвращает `{ ok, moved, pointsRemoved, … }`, `{ cancelled: true }` или
 * `{ refused: true, reason }` — вызывающий говорит об этом в статусбаре.
 */
export async function autoLayout() {
  const m = store.model;
  const support = layoutSupport(currentDiagram(m)?.kind);
  if (!support.ok) {
    await showError('Раскладка недоступна', support.reason);
    return { ok: false, refused: true, reason: support.reason };
  }
  const ids = store.ui.selection.filter((s) => s.kind === 'shape').map((s) => s.id);
  let plan = planLayout(m, { shapeIds: ids });
  if (!plan.ok) {
    await showError('Раскладка недоступна', plan.reason);
    return { ok: false, refused: true, reason: plan.reason };
  }
  const answer = await confirmLayout(plan);
  if (!answer) return { ok: false, cancelled: true };
  if (answer.gap !== plan.gap) {
    const again = planLayout(m, { shapeIds: ids, gap: answer.gap });
    if (!again.ok) {
      await showError('Раскладка недоступна', again.reason);
      return { ok: false, refused: true, reason: again.reason };
    }
    plan = again;
  }
  const result = commit('Автоматическая раскладка', (model) => applyLayoutPlan(model, plan));
  return {
    ok: true,
    ...result,
    planned: plan.counts.points,
    shapes: plan.counts.shapes,
    scope: plan.scope,
    gap: plan.gap,
  };
}

/** One line for the status bar after `autoLayout`. */
export function layoutHint(r) {
  if (!r) return '';
  if (r.ok) {
    // «Переприкреплено связей» говорим только когда это правда: ноль — это
    // не достижение, а обычный случай (связи и так смотрели друг на друга).
    const moved = `Разложено фигур: ${r.moved}. Потеряно ручных точек: ${r.pointsRemoved}.`;
    return r.reattached > 0 ? `${moved} Переприкреплено связей: ${r.reattached}.` : moved;
  }
  if (r.cancelled) return 'Раскладка отменена — ничего не изменилось.';
  return 'Раскладка недоступна на этом листе.';
}

function apply(id, b) {
  const minX = Math.min(...b.map((o) => o.x));
  const maxX = Math.max(...b.map((o) => o.x + o.w));
  const minY = Math.min(...b.map((o) => o.y));
  const maxY = Math.max(...b.map((o) => o.y + o.h));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  switch (id) {
    case 'left': for (const o of b) o.s.x = Math.round(minX); break;
    case 'right': for (const o of b) o.s.x = Math.round(maxX - o.w); break;
    case 'center': for (const o of b) o.s.x = Math.round(midX - o.w / 2); break;
    case 'top': for (const o of b) o.s.y = Math.round(minY); break;
    case 'bottom': for (const o of b) o.s.y = Math.round(maxY - o.h); break;
    case 'middle': for (const o of b) o.s.y = Math.round(midY - o.h / 2); break;
    case 'distribute-h': distribute(b, 'x', 'w'); break;
    case 'distribute-v': distribute(b, 'y', 'h'); break;
    default: break;
  }
}

/**
 * Equal GAPS, not equal centres: that is what "равные промежутки" means and
 * what the eye checks. The outermost two keep their places and everything
 * between them is spread evenly.
 */
function distribute(items, pos, size) {
  if (items.length < 3) {
    // Two shapes have nothing to distribute; put the second one a grid step
    // away so the command is not a silent no-op.
    const sorted = [...items].sort((a, c) => a[pos] - c[pos]);
    if (sorted.length === 2) sorted[1].s[pos] = Math.round(sorted[0][pos] + sorted[0][size] + 10);
    return;
  }
  const sorted = [...items].sort((a, c) => (a[pos] + a[size] / 2) - (c[pos] + c[size] / 2));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = (last[pos] + last[size]) - first[pos];
  const used = sorted.reduce((n, o) => n + o[size], 0);
  const gap = (span - used) / (sorted.length - 1);
  let cursor = first[pos];
  for (const o of sorted) {
    o.s[pos] = Math.round(cursor);
    cursor += o[size] + gap;
  }
}
