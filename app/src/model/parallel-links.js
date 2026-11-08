// Two legitimate associations between one pair of figures must not be drawn as
// one line.
//
// The model allows two relationships between the same two elements — an
// association and a dependency, or two associations told apart by roles and
// multiplicities (the tutorial's exercise 4.1 says exactly why the roles are
// named). The router, however, draws both from the same two attach points, so
// the second line lies exactly under the first: the person sees one line with
// two multiplicities and two stereotypes, and concludes the second link was
// never created. That is what once looked like a "duplicate relationship" in
// 4103 — the picture lied, not the rule.
//
// The cure is the one every editor uses for parallel connectors: the ends slide
// along the figure's border, each line by its own share of the side, so the two
// lines leave and meet the shapes at different points and stay apart along the
// whole route. Nothing is written to the file: the offset is a property of the
// DRAWING, computed from how many links join the same pair, so the corpus round
// trip is untouched and a model with one link per pair draws exactly as before.
//
// The original's own project files were asked, and the answer is in the
// records: `myProject.vpp` has no pair with two structural connectors, but
// `Visokih.vpp` has eleven (eleven Association pairs, 342 structural
// connectors) and in every one of them the two connectors carry DIFFERENT
// `_points` — a stored route each, none sharing even a first point. So the
// original separates two lines between one pair by storing each connector's
// own geometry, not by an offset computed at draw time; a second link created
// between the same pair starts on top of the first until somebody routes it.
// Our rule is therefore an addition, not a copy, and it is stated here: 0.12 of
// the side between neighbours, never closer than 0.06 to a corner — on a 190 px
// side that is 23 px between the two lines: far enough that both routes, both
// labels and both arrow heads are separate, close enough that the shift never
// walks a line into a neighbouring figure (0.2 did exactly that in 5223, where
// the pair runs 22 px past a class edge). It is computed per drawing, so the
// file keeps the route the model has and the corpus round trip stays clean.

import { NOTATION } from './notation.js';
import { MECHANICS } from '../mechanics.generated.js';

// Оба числа — из листа механики (`mechanics.json`, §31), чтобы их можно было
// изменить не трогая код: доля стороны между соседними линиями и ближайшее к
// углу место конца.
/** Share of the figure's side between two neighbouring parallel lines. */
export const PARALLEL_STEP = MECHANICS.parallelStep;
/** Closest a shifted end may come to a corner. */
const EDGE = MECHANICS.parallelEdgeMargin;

const pairKey = (a, b) => [String(a), String(b)].sort().join('\u0000');

/** Конец с явной долей/смещением двигать нечем: там решает `attach`. */
const hasAttach = (end) => Boolean(end?.attach && typeof end.attach === 'object');

/**
 * Признак того, что две связи рисуются ОДНОЙ ломаной: те же концы (сторона и
 * доля), тот же маршрут и те же изломы. Связи одной пары с разными концами уже
 * различимы, и трогать их нельзя — сдвиг ради сдвига уводит линию в чужую
 * фигуру (так l8 в 5223 пошёл сквозь класс, когда сдвигали всех подряд).
 */
const attachSig = (link) => {
  if (hasAttach(link.from) || hasAttach(link.to)) return null;
  return [
    link.from?.side ?? '', Number(link.from?.t ?? 0.5),
    link.to?.side ?? '', Number(link.to?.t ?? 0.5),
    link.route ?? '', JSON.stringify(link.waypoints ?? []),
    link.noEdgeStyle ? 1 : 0, link.entryPerimeter ? 1 : 0,
  ].join('|');
};

/** Вид связи по её id: сообщения сдвигать не нужно и нечем. */
function isSequenceLink(link, model) {
  const rel = (model?.relationships ?? []).find((r) => r.id === link?.relId);
  if (rel) return !!NOTATION.connectors[rel.kind]?.sequence;
  // Модели нет — судим по `y`: у сообщения высота есть всегда, у прочих связей
  // её не бывает.
  return link?.y != null;
}

/**
 * Доля сдвига для каждой связи листа: `link.id → delta` (доля стороны).
 *
 * В группу попадают связи между одной и той же парой фигур, в любом
 * направлении и любого вида. Исключение — сообщения: у них своя геометрия
 * (высота `y`), и две связи одной пары там и так не совпадают. Связь с собой
 * (петля) в группу не входит.
 */
export function parallelOffsets(diagram, model = null) {
  const out = new Map();
  const groups = new Map();
  for (const link of diagram?.links ?? []) {
    const a = link?.from?.shapeId;
    const b = link?.to?.shapeId;
    if (a == null || b == null || String(a) === String(b)) continue;
    if (isSequenceLink(link, model)) continue;
    const sig = attachSig(link);
    if (!sig) continue;
    const k = `${pairKey(a, b)}\u0001${sig}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(link);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.forEach((link, i) => out.set(link.id, (i - (list.length - 1) / 2) * PARALLEL_STEP));
  }
  return out;
}

/** Конец связи, сдвинутый вдоль кромки фигуры на `delta` доли стороны. */
export function shiftedEnd(end, delta) {
  if (!end || !delta) return end;
  const t = Number.isFinite(Number(end.t)) ? Number(end.t) : 0.5;
  const next = Math.min(1 - EDGE, Math.max(EDGE, t + delta));
  return { ...end, t: next };
}

/** Оба конца связи с её сдвигом: `{ from, to }` для `endPoint`. */
export function parallelEnds(diagram, link, offsets = parallelOffsets(diagram)) {
  const delta = offsets.get(link?.id) ?? 0;
  if (!delta) return { from: link?.from, to: link?.to };
  return { from: shiftedEnd(link.from, delta), to: shiftedEnd(link.to, delta) };
}
