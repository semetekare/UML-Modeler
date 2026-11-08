// Seed layout for an imported model: the smallest honest set of rules that
// puts every shape somewhere predictable.
//
// THIS IS NOT A LAYOUT ENGINE. The whole reason a person leaves PlantUML is
// that it decides the arrangement for them («проблема планта — там
// автораскладка»), so the import must not repeat that mistake: no collision
// avoidance, no crossing minimisation, no "nice" pass. What it does is a
// deterministic grid with numbers taken from the mechanics sheet, in the order
// the elements were DECLARED — so the person recognises their own diagram and
// moves the boxes where they want them.
//
//   seed(model, {frames}) → the same model with `shapes`/`links` filled
//
// Consequences that are on purpose:
//   * the same model always gives the same picture (determinism invariant);
//   * links are never consulted for placement (except a sequence message's
//     `y`, which IS its order — the model stores order as vertical position);
//   * a class with more members is drawn taller, a package grows around its
//     contents, and nothing else moves.
//
// Numbers: read from `app/mechanics.json` through the generated sheet (§21 of
// MECHANICS.md). Two kinds sit in it and the comments say which:
//   * code — sequence pitches 80/30 and the grid 10, with their class#method
//     offsets in the original (v/dal/ak#<init>+0x0025/+0x002b, v/dap/r#<init>);
//   * decision — the seed's sibling gap 40, frame inset 20, activity step 120,
//     state step 140, lane 200, sheet 720×440, wrap 1400. The original has no
//     fixed pitch at all (its own sample stands at y 53/171/269/382), because
//     it never places a shape by itself; that is exactly the behaviour the
//     owner asked to keep, so the pitch is this build's choice and is labelled
//     as one.
// Sizes not in the sheet come from `notation/uml.json#defaultSize` and are
// repeated in DEFAULT_SIZE below, because this module must run under Node where
// the notation is not loaded; `tests/types.mjs` checks the two agree.

/** Shape sizes, a copy of `notation/uml.json#shapes[kind].defaultSize`. */
export const DEFAULT_SIZE = {
  class: { w: 190, h: 170 },
  interface: { w: 190, h: 110 },
  enumeration: { w: 140, h: 100 },
  datatype: { w: 150, h: 80 },
  package: { w: 140, h: 100 },
  model: { w: 160, h: 110 },
  profile: { w: 180, h: 120 },
  component: { w: 190, h: 120 },
  artifact: { w: 140, h: 80 },
  deploymentSpec: { w: 150, h: 80 },
  node: { w: 190, h: 120 },
  device: { w: 190, h: 110 },
  executionEnvironment: { w: 190, h: 110 },
  object: { w: 160, h: 80 },
  part: { w: 120, h: 60 },
  // 13×13, not 20×20: the original's own default for a port is
  // `new Dimension(13, 13)` (MECHANICS §33); this copy is checked against
  // notation/uml.json by plantuml-import.mjs#F4.
  port: { w: 13, h: 13 },
  collaboration: { w: 160, h: 80 },
  collaborationUse: { w: 140, h: 60 },
  stereotype: { w: 160, h: 90 },
  metaclass: { w: 160, h: 90 },
  actor: { w: 40, h: 64 },
  usecase: { w: 120, h: 60 },
  systemBoundary: { w: 320, h: 220 },
  note: { w: 80, h: 70 },
  text: { w: 120, h: 24 },
  state: { w: 150, h: 80 },
  initial: { w: 18, h: 18 },
  final: { w: 20, h: 20 },
  choice: { w: 30, h: 30 },
  junction: { w: 16, h: 16 },
  historyShallow: { w: 20, h: 20 },
  historyDeep: { w: 20, h: 20 },
  entryPoint: { w: 18, h: 18 },
  exitPoint: { w: 18, h: 18 },
  terminate: { w: 20, h: 20 },
  action: { w: 140, h: 50 },
  activity: { w: 320, h: 220 },
  decision: { w: 44, h: 44 },
  merge: { w: 44, h: 44 },
  fork: { w: 160, h: 8 },
  join: { w: 160, h: 8 },
  objectNode: { w: 120, h: 50 },
  activityParameter: { w: 120, h: 40 },
  swimlane: { w: 200, h: 300 },   // seed override, see SEED_OVERRIDES
  lifeline: { w: 120, h: 260 },
  actorLifeline: { w: 70, h: 260 },
  activation: { w: 8, h: 80 },
  fragment: { w: 320, h: 160 },
  interactionUse: { w: 220, h: 80 },
  interaction: { w: 260, h: 90 },
  timingLane: { w: 420, h: 80 },
};

/* ------------------------------------------------------------- numbers */

// Every number below is read from app/mechanics.json through the generated
// sheet (build.mjs turns each row into MECHANICS.<key>). A number may only be
// here if the sheet carries it with its kind, and the kind says where it came
// from — §21 of MECHANICS.md:
//
//   code      read out of the shipped bytecode at jar!class#method+offset
//   record    read out of a diagram the program itself wrote
//   decision  a number the original does NOT have; the original never places
//             a shape by itself, so a pitch can only be this build's choice
//
import { MECHANICS } from '../mechanics.generated.js';

const GRID = MECHANICS.gridSize;                     // 10, code: v/dap/r#<init>+0x0118
const CAPTION = MECHANICS.captionHeight;             // 14, record: _captionUIModel
const LIFELINE_W = MECHANICS.lifelineWidth;          // 120, record
const LIFELINE_HEAD = MECHANICS.lifelineHead;        // 35, code: insert box v/qi/o#e()
const ACTOR_HEAD = MECHANICS.actorLifelineHead;      // 48, record: 34 figure + 14 caption
// The two drawn pitches of a sequence diagram. Code, not only the record:
// v/dal/ak#<init> sets +0x0025 bipush 80 (absoluteLifelineSpacingDistance) and
// +0x002b bipush 30 (absoluteMessageSpacingDistance), and leaves the relative
// pair (lifelineSpacing / messageSpacing) at 0 = auto — §21b.
const LIFELINE_GAP = MECHANICS.lifelineSpacing;      // 80, code: absoluteLifelineSpacingDistance
const MESSAGE_STEP = MECHANICS.messageSpacing;       // 30, code: absoluteMessageSpacingDistance
const FRAGMENT_CAPTION = MECHANICS.fragmentCaption;  // 18, record: CombinedFragment

// The seed's own numbers — decisions, and the sheet says so (§21c). They are
// here, not inline, so nobody can read a pitch and think the original has it.
const ACTIVITY_STEP = MECHANICS.seedActivityStep;    // 120, decision
const STATE_STEP = MECHANICS.seedStateStep;          // 140, decision
const LANE_W = MECHANICS.seedLaneWidth;              // 200, decision

const MARGIN = MECHANICS.seedSiblingGap;     // 40: the gap between siblings
const PAD = MECHANICS.seedFrameInset;        // 20: the inset of a package around its contents
const ROW_H = MECHANICS.memberRowHeight;     // 15: one member line (the line geometry.js draws)
const STATE_INSET = MARGIN;                  // 40: the state column's left offset
const MIN_SEQUENCE_DEPTH = LIFELINE_W * 2 + PAD;  // 260: a lifeline at least this deep


/* ------------------------------------------------------------- helpers */

const isStr = (v) => typeof v === 'string' && v.length > 0;
const sizeOf = (kind) => DEFAULT_SIZE[kind] ?? { w: 190, h: 120 };

/** How many member lines a classifier shows — the only thing that grows it. */
function rowsOf(el) {
  let n = 0;
  for (const f of ['attributes', 'operations', 'literals', 'slots']) n += (el[f] ?? []).length;
  n += (el.extensionPoints ?? []).length;
  for (const f of ['entry', 'do', 'exit']) n += (el[f] ?? []).length;
  return n;
}

/** Kinds whose rectangle is a FRAME around other shapes. */
const FRAMES = new Set(['package', 'model', 'profile', 'component', 'artifact', 'node',
  'device', 'executionEnvironment', 'systemBoundary', 'activity', 'state', 'interaction',
  'collaboration', 'swimlane']);

const isFrame = (el) => FRAMES.has(el.kind);

/**
 * The box an element wants. A frame is at least its declaration size and grows
 * to hold children; a classifier grows downwards by one row per member. No
 * other rule touches a size — that is what keeps the result predictable.
 */
function boxOf(el, kids, boxes) {
  const base = sizeOf(el.kind);
  if (!kids.length) {
    if (!isFrame(el) && rowsOf(el)) {
      return { w: base.w, h: Math.max(base.h, CAPTION * 2 + PAD + rowsOf(el) * ROW_H) };
    }
    return { w: base.w, h: base.h };
  }
  const inner = kids.map((k) => boxes.get(k.id));
  const rowW = inner.reduce((s, b) => s + b.w, 0) + MARGIN * (kids.length - 1);
  const rowH = Math.max(...inner.map((b) => b.h));
  return {
    w: Math.max(base.w, rowW + PAD * 2),
    h: Math.max(base.h, CAPTION * 2 + PAD * 2 + rowH),
  };
}

/* ---------------------------------------------------------------- seed */

/**
 * Put every element of every diagram on the sheet.
 *
 * @param {object} model a `uml-model/3` with empty `shapes`/`links`
 * @param {{frames?: Array}} [opts] `frames` from `parse()`: which messages a
 *   combined fragment covers (the model stores coverage as geometry, so the
 *   seed is the only place that can put it back)
 * @returns {object} the same model
 */
export function seed(model, opts = {}) {
  const frames = opts.frames ?? [];
  const membership = membershipOf(model, opts.blocks);
  for (const diagram of model.diagrams ?? []) {
    const family = familyOf(diagram, model, membership.get(diagram.id));
    diagram.shapes = [];
    diagram.links = [];
    const ids = membership.get(diagram.id) ?? new Set();
    if (family === 'sequence') seedSequence(model, diagram, ids, frames);
    else if (family === 'activity') seedActivity(model, diagram, ids);
    else if (family === 'state') seedState(model, diagram, ids);
    else seedStructural(model, diagram, ids);
    fitSheet(model, diagram);
  }
  return model;
}

/**
 * Which elements belong to which sheet. A `uml-model/3` diagram stores its
 * membership as SHAPES, and an imported diagram has none yet, so the parser
 * hands its blocks over: `[{ diagramId, elementIds }]`. One diagram and no
 * blocks means everything is on it.
 */
function membershipOf(model, blocks) {
  const all = (model.elements ?? []).map((e) => e.id);
  const out = new Map();
  const diagrams = model.diagrams ?? [];
  if (Array.isArray(blocks) && blocks.length) {
    for (const b of blocks) out.set(b.diagramId, new Set(b.elementIds));
    return out;
  }
  if (diagrams.length === 1) {
    out.set(diagrams[0].id, new Set(all));
    return out;
  }
  for (const d of diagrams) {
    out.set(d.id, new Set((d.shapes ?? []).map((s) => s.elementId)));
  }
  return out;
}

/** Which layout family a diagram wants. Mirrors `emit.mjs#familyOf`. */
export function familyOf(diagram, model, ids = null) {
  const onDiagram = ids ?? new Set((diagram.shapes ?? []).map((s) => s.elementId));
  const els = (model.elements ?? []).filter((e) => onDiagram.has(e.id));
  const kinds = new Set(els.map((e) => e.kind));
  if (diagram.kind === 'sequence') return 'sequence';
  if (diagram.kind === 'activity' && ![...kinds].some((k) => ['lifeline', 'actorLifeline'].includes(k))) return 'activity';
  if ([...kinds].some((k) => ['lifeline', 'actorLifeline', 'fragment', 'interactionUse'].includes(k))) return 'sequence';
  if ([...kinds].some((k) => ['swimlane', 'action', 'decision', 'merge', 'fork', 'join'].includes(k))) return 'activity';
  if ([...kinds].some((k) => ['state', 'choice', 'initial', 'final', 'junction'].includes(k))) return 'state';
  return 'structural';
}

/** Every element of the diagram, in declaration order. */
function ordered(model, ids) {
  const list = (model.elements ?? []).filter((e) => !ids || ids.has(e.id));
  return list;
}

function shape(diagram, el, x, y, w, h) {
  const s = {
    id: `s${diagram.shapes.length + 1}`,
    elementId: el.id,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
  diagram.shapes.push(s);
  return s;
}

/** A link with the two endpoint records the model expects. */
function link(diagram, rel, from, to, extra = {}) {
  const sideOf = (a, b) => {
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) return bx >= ax ? ['right', 'left'] : ['left', 'right'];
    return by >= ay ? ['bottom', 'top'] : ['top', 'bottom'];
  };
  const [sideA, sideB] = sideOf(from, to);
  diagram.links.push({
    id: `l${diagram.links.length + 1}`,
    relId: rel.id,
    from: { shapeId: from.id, side: extra.fromSide ?? sideA },
    to: { shapeId: to.id, side: extra.toSide ?? sideB },
    ...extra.extra,
  });
}

/* ---------------------------------------------------------- structural */

/**
 * Structural families: one row per level, in declaration order.
 *
 *   1. elements with no owner sit in one row, left to right, step = width + 40;
 *   2. an element that owns others grows into a frame and draws them inside,
 *      in their own row, inset by 20;
 *   3. a use-case diagram puts the actors in a left-hand column instead, so the
 *      frame of the system stays readable on the right (plan §7.2).
 *
 * Nothing here looks at a relationship: moving a box never re-routes a line.
 */
function seedStructural(model, diagram, ids) {
  const els = ordered(model, ids);
  const byId = new Map(els.map((e) => [e.id, e]));
  const kidsOf = new Map();
  for (const el of els) {
    if (!isStr(el.ownerId) || !byId.has(el.ownerId)) continue;
    if (!kidsOf.has(el.ownerId)) kidsOf.set(el.ownerId, []);
    kidsOf.get(el.ownerId).push(el);
  }
  const roots = els.filter((el) => !isStr(el.ownerId) || !byId.has(el.ownerId));

  // Sizes first (bottom-up), then positions (top-down): a frame must know how
  // wide its row of children is before it can stand in its own row.
  const boxes = new Map();
  const measure = (el) => {
    const kids = kidsOf.get(el.id) ?? [];
    for (const k of kids) measure(k);
    boxes.set(el.id, boxOf(el, kids, boxes));
  };
  for (const el of roots) measure(el);

  const place = (el, x, y) => {
    const box = boxes.get(el.id);
    const s = shape(diagram, el, x, y, box.w, box.h);
    const kids = kidsOf.get(el.id) ?? [];
    if (!kids.length) return s;
    let cx = x + PAD;
    const cy = y + CAPTION * 2;
    for (const kid of kids) {
      const kb = boxes.get(kid.id);
      place(kid, cx, cy);
      cx += kb.w + MARGIN;
    }
    return s;
  };

  // One row per level, in DECLARATION order — actors, use cases and the system
  // frame together, because that is the order the person wrote them in and the
  // order they will look for them. No «актёры слева»: that would be the
  // arrangement deciding itself, which is the one thing the import must not do.
  // A row is broken only when the sheet would get absurdly wide; the constant
  // is a page limit, not an optimisation.
  const MAX_ROW = MECHANICS.seedWrapWidth;   // 1400, decision: a page limit
  let x = MARGIN;
  let y = MARGIN;
  let rowH = 0;
  for (const el of roots) {
    const b = boxes.get(el.id);
    if (x + b.w > MAX_ROW && x > MARGIN) {
      x = MARGIN;
      y += rowH + MARGIN;
      rowH = 0;
    }
    place(el, x, y);
    x += b.w + MARGIN;
    rowH = Math.max(rowH, b.h);
  }

  linkAll(model, diagram, ids);
}

/* ------------------------------------------------------------ sequence */

/**
 * Sequence: lines of life across the sheet, messages down it.
 *
 * The vertical position of a message is not decoration — in this model the
 * order of messages IS their `y` (emit.mjs reads it, and `model.js#messageOrder`
 * too), so the seed must write it: first message at head + 30, step 30.
 * A frame is drawn around the messages it covers, for the same reason.
 */
function seedSequence(model, diagram, ids, frames) {
  const els = ordered(model, ids);
  const lifelines = els.filter((e) => e.kind === 'lifeline' || e.kind === 'actorLifeline');
  const shapeOf = new Map();

  let x = MARGIN;
  for (const el of lifelines) {
    const def = sizeOf(el.kind);
    const w = el.kind === 'actorLifeline' ? Math.max(def.w, sizeOf('actorLifeline').w) : LIFELINE_W;
    const head = el.kind === 'actorLifeline' ? ACTOR_HEAD : LIFELINE_HEAD;
    const s = shape(diagram, el, x, MARGIN, w, head + MESSAGE_STEP);
    shapeOf.set(el.id, s);
    x += w + LIFELINE_GAP;
  }

  const messages = (model.relationships ?? []).filter((r) => ['message', 'reply', 'createMessage', 'destroyMessage'].includes(r.kind));
  const yOf = new Map();
  let y = MARGIN + LIFELINE_HEAD + MESSAGE_STEP;
  for (const rel of messages) {
    yOf.set(rel.id, y);
    const from = shapeOf.get(rel.from);
    const to = shapeOf.get(rel.to);
    if (from && to) {
      const rightwards = (to.x + to.w / 2) >= (from.x + from.w / 2);
      link(diagram, rel, from, to, {
        fromSide: rightwards ? 'right' : 'left',
        toSide: rightwards ? 'left' : 'right',
        extra: { y },
      });
    }
    y += MESSAGE_STEP;
  }

  // Lifelines run to the last message, plus a breath.
  const bottom = Math.max(y, MARGIN + MIN_SEQUENCE_DEPTH);
  for (const el of lifelines) {
    const s = shapeOf.get(el.id);
    if (s) s.h = bottom - s.y + MESSAGE_STEP;
  }

  // Frames: a rectangle from the first covered message to the last one, over
  // the lifelines it spans. `frames` comes from the parser; without it a frame
  // keeps its default size at the top right, which is still deterministic.
  let fx = MARGIN;
  let refNo = 0;
  for (const el of els) {
    if (el.kind !== 'fragment' && el.kind !== 'interactionUse') continue;
    const cover = frames.find((f) => f.elementId === el.id
      && (!f.diagramId || f.diagramId === diagram.id));
    // `ref over A, B` — the frame spans exactly those lifelines, so the export
    // writes the same participant list back.
    if (cover?.kind === 'ref') {
      const spans = cover.refs.map((id) => shapeOf.get(id)).filter(Boolean);
      if (spans.length) {
        const left = Math.min(...spans.map((s) => s.x));
        const right = Math.max(...spans.map((s) => s.x + s.w));
        // A `ref over` sits at a POINT of the sequence: the export finds the
        // lifelines under its rectangle, and drops the frame unless at least
        // one message's `y` falls inside it. So it is placed on the band of a
        // message — every second one, so two refs do not land on one another.
        const slot = messages.length ? Math.min(refNo * 2, messages.length - 1) : 0;
        const at = messages.length ? yOf.get(messages[slot].id) : bottom;
        const h = MESSAGE_STEP;
        shape(diagram, el, left, at - h / 2, right - left, h);
        refNo += 1;
        continue;
      }
    }
    if (!cover || cover.from == null || cover.to == null) {
      shape(diagram, el, fx, MARGIN, sizeOf(el.kind).w, sizeOf(el.kind).h);
      fx += sizeOf(el.kind).w + MARGIN;
      continue;
    }
    const covered = messages.slice(cover.from, cover.to + 1);
    const ys = covered.map((r) => yOf.get(r.id)).filter((v) => v != null);
    const tops = covered.map((r) => shapeOf.get(r.from)).filter(Boolean);
    const xy = [...covered.map((r) => shapeOf.get(r.from)), ...covered.map((r) => shapeOf.get(r.to))].filter(Boolean);
    const first = Math.min(...xy.map((s) => s.x));
    const last = Math.max(...xy.map((s) => s.x + s.w));
    const top = (ys.length ? Math.min(...ys) : y) - FRAGMENT_CAPTION - MESSAGE_STEP;
    const bottom2 = (ys.length ? Math.max(...ys) : y) + MESSAGE_STEP;
    shape(diagram, el, first - PAD, top, Math.max(last - first + PAD * 2, sizeOf(el.kind).w), Math.max(bottom2 - top, sizeOf(el.kind).h));
    void tops;
  }

  // Notes go in one row under the lifelines — never on top of a message.
  let nx = MARGIN;
  const noteY = bottom + MESSAGE_STEP * 2;
  for (const el of els) {
    if (el.kind !== 'note') continue;
    shape(diagram, el, nx, noteY, sizeOf('note').w, sizeOf('note').h);
    nx += sizeOf('note').w + MARGIN;
  }
}

/* ------------------------------------------------------------ activity */

/**
 * Activity: one column per swimlane, one node after another down it.
 *
 * The order is the declaration order, not the flow: a chain would be a layout
 * decision, and the flow is already drawn by the arrows. Step 120, lane 200 —
 * both are this build's decisions, labelled `decision` in the sheet (MECHANICS
 * §21c): the original has no pitch, its own sample stands at y 53/171/269/382.
 */
function seedActivity(model, diagram, ids) {
  const els = ordered(model, ids);
  const lanes = els.filter((e) => e.kind === 'swimlane');
  const laneX = new Map();
  let x = MARGIN;
  for (const lane of lanes) {
    laneX.set(lane.id, x);
    x += LANE_W;
  }

  // Nodes without a lane stand in the first column.
  const firstX = lanes.length ? MARGIN : MARGIN;
  const columnOf = (el) => (el.lane && laneX.has(el.lane) ? laneX.get(el.lane) : firstX);

  const rows = new Map();      // column → how many nodes already stand there
  let y = MARGIN + (lanes.length ? CAPTION * 2 : 0);
  for (const el of els) {
    if (el.kind === 'swimlane') continue;
    const col = columnOf(el);
    const def = sizeOf(el.kind);
    const n = rows.get(col) ?? 0;
    rows.set(col, n + 1);
    // Small nodes (start/end/diamond) keep the same pitch as an action, so the
    // column reads as one chain and never needs a second pass.
    shape(diagram, el, col + PAD, y + n * ACTIVITY_STEP, def.w, def.h);
  }

  // Lane frames: full height of the sheet, drawn after the nodes so their
  // rectangle can cover them.
  const nodesBottom = y + Math.max(1, Math.max(...[...rows.values()])) * ACTIVITY_STEP;
  let lx = MARGIN;
  for (const lane of lanes) {
    shape(diagram, lane, lx, MARGIN, LANE_W, Math.max(nodesBottom - MARGIN, sizeOf('swimlane').h));
    lx += LANE_W;
  }

  // Notes under everything.
  let nx = MARGIN;
  for (const el of els.filter((e) => e.kind === 'note')) {
    shape(diagram, el, nx, nodesBottom + MARGIN, sizeOf('note').w, sizeOf('note').h);
    nx += sizeOf('note').w + MARGIN;
  }

  linkAll(model, diagram, ids);
}

/* --------------------------------------------------------------- state */

/** State: a vertical chain, step 140 — a `decision` row, see MECHANICS §21c. */
function seedState(model, diagram, ids) {
  const els = ordered(model, ids);
  let y = MARGIN;
  const shapeOf = new Map();
  for (const el of els) {
    const def = sizeOf(el.kind);
    const s = shape(diagram, el, MARGIN + STATE_INSET, y, def.w, def.h);
    shapeOf.set(el.id, s);
    y += Math.max(def.h, MARGIN) + (STATE_STEP - Math.max(def.h, MARGIN));
  }
  linkAll(model, diagram, ids);
}

/* ---------------------------------------------------------------- links */

/** A link for every relationship whose two ends are on this sheet. */
function linkAll(model, diagram, ids) {
  const shapeOf = new Map(diagram.shapes.map((s) => [s.elementId, s]));
  void ids;
  for (const rel of model.relationships ?? []) {
    const from = shapeOf.get(rel.from);
    const to = shapeOf.get(rel.to);
    if (!from || !to) continue;
    if (['message', 'reply', 'createMessage', 'destroyMessage'].includes(rel.kind)) continue;
    link(diagram, rel, from, to);
  }
}

/* ---------------------------------------------------------------- sheet */

/** The sheet is the bounding box of what was placed, rounded up to the grid. */
function fitSheet(model, diagram) {
  const shapes = diagram.shapes ?? [];
  let w = MECHANICS.seedSheetWidth;    // 720, decision
  let h = MECHANICS.seedSheetHeight;   // 440, decision
  for (const s of shapes) {
    w = Math.max(w, s.x + s.w + MARGIN);
    h = Math.max(h, s.y + s.h + MARGIN);
  }
  const round = (v) => Math.ceil(v / GRID) * GRID;
  model.sheet = { w: round(w), h: round(h) };
}
