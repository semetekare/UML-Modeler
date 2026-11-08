// Layout and routing on the sheet. Everything here is deterministic: the
// same model always produces the same geometry, on screen and in exports.
//
// Compartments follow the records in MECHANICS.md: 11 px Arial, one text
// line 15 px, the name caption one line 14–15 px, white fill, 1 px black
// border, factory sizes 190×170 (class), 140×100 (package), 80×70 (note),
// 120 wide (lifeline, caption 14), 8 wide (activation), 500 (combined
// fragment, caption 18), 60 (interaction actor).

import { NOTATION } from './notation.js';
import { memberText, internalText } from './model.js';
import { MECHANICS } from '../mechanics.generated.js';
import { DEFAULT_ROUTE as STYLE_DEFAULT_ROUTE, labelAngle } from './connector-style.js';

export const LINE_H = MECHANICS.memberRowHeight;  // 14 — the font's own line height (§32)
export const PAD_X = 8;            // compartment side padding
export const PAD_Y = 3;            // text inset inside a caption
// A member compartment is rows × lineHeight + 2, not + 2×PAD_Y: the program
// multiplies the line height by the member count and adds exactly 2
// (vpplatform.jar!v/due/f#a(v.dvk.i,v.dvk.i,v.cmo.gj,v.drc.l)+0x0342, §32).
export const COMPARTMENT_PAD = MECHANICS.memberBlockPadding; // 2, one px top and bottom
export const MEMBER_PAD = COMPARTMENT_PAD / 2;              // 1 — where the first row's line starts
export const TAB_H = MECHANICS.captionHeight;   // package name tab = Class _captionUIModel @height
// A name plate is lines × 14 and nothing else (§30). The caption model keeps
// x, y, width, height, side and visible; its height is not a constant — it
// starts at 0 and is recomputed from the text — and the records show what that
// recompute produces: 14 for a name alone, 28 with a «stereotype» line above
// it, 42 with two. The build used to add 2 × PAD_Y on top, which made every
// class name 7 px too tall and pushed the first member row down with it.
export const CAPTION_LINE = MECHANICS.captionLineHeight;   // 14
export const NOTE_PAD = MECHANICS.noteTextInset;      // note text inset — the build's own 12 (§30)
export const NOTE_FOLD = MECHANICS.noteTextInset;     // the cut corner is the same 12
export const NOTE_CAP_DELTA = MECHANICS.noteCaptionWidthDelta; // caption = width − 15
// The record's `@side` is a PLACEMENT code, not a distance: 1 SIDE_NONE …
// 12 SIDE_FREEMOVE (openapi.jar!ICaptionUIModel). A note stores 12, i.e. the
// caption moves freely inside the shape — which is why its box starts at 0,0.
export const CAPTION_SIDE_FREEMOVE = MECHANICS.noteCaptionSide; // 12
// Visibility is an index into IClassUIModel.VISIBILITY_STYLES ("Icon", "UML",
// "Off") — the codes are the interface's own fields, read in MECHANICS §16.
export const VIS_ICON = MECHANICS.visibilityStyleIcon; // 0 — painted glyph
export const VIS_UML = MECHANICS.visibilityStyleUml;   // 1 — the + - # ~ character
export const VIS_OFF = MECHANICS.visibilityStyleOff;   // 2 — nothing
// «Показывать пустые отделения» (§20). In the original the value is a
// property of the CLASS, not of the view: the shape's setter writes it through
// `v/bet/gg#setShowEmptyCompartments(I)V` → `v.cnk.vd#M(I)V`, and the property
// registry's own default is 0 = "Follow Diagram". The diagram's key holds only
// 1 (Yes) / 2 (No); the shipped sample writes 2.
export const EC_FOLLOW = MECHANICS.emptyCompartmentsFollow;   // 0 — ask the diagram
export const EC_YES = MECHANICS.emptyCompartmentsYes;         // 1 — draw the empty band
export const EC_NO = MECHANICS.emptyCompartmentsNo;           // 2 — draw nothing
export const EC_DEFAULT = MECHANICS.emptyCompartmentsDefault; // 1 — a fresh diagram shows them
/** The effective switch: the class's own value wins, 0 and junk follow the diagram. */
export function emptyCompartmentsShown(element) {
  const v = element?.emptyCompartments;
  if (v === EC_YES || v === EC_NO) return v === EC_YES;
  return EC_DEFAULT === EC_YES;
}
export const STUB = 12;            // connector stub off a shape's edge
// Heads are painted by the program's own arrow classes (MECHANICS §13): the
// length runs back along the line, the width is the full base width.
export const HEAD_TRI = MECHANICS.headHollowLength;      // HollowArrow1: 8
export const HEAD_TRI_W = MECHANICS.headHollowWidth;     // 11
export const HEAD_OPEN = MECHANICS.headOpenLength;       // Arrow1: 8
export const HEAD_OPEN_W = MECHANICS.headOpenWidth;      // 4
export const HEAD_SOLID = MECHANICS.headSolidLength;     // SolidArrow1: 7
export const HEAD_SOLID_W = MECHANICS.headSolidWidth;    // 4
export const HEAD_DIAMOND = MECHANICS.headDiamondLength; // HollowDiamond: 8
export const HEAD_DIAMOND_W = MECHANICS.headDiamondWidth; // 16

/* ------------------------------------------------------- head size (§28) */
//
// A head is not one size: the original keeps a SIZE CODE on the arrow itself —
// `v/cco/a`'s field `x`, built as `iconst_2` at `<init>+0x0021` — and draws
//
//     length = k[code] · a        (`v/cco/a#b()+0x0001`, a = i())
//     width  = l[code] · b        (`v/cco/a#c()+0x0001`, b = g())
//
// where a and b are the base sizes each painter sets in its own `<init>`
// (HollowArrow1 8×11, Arrow1 8×4, SolidArrow1 7×4, HollowDiamond 8×16) and
// k[]/l[] are that painter's seven multipliers. Code 2 — the default — has
// 1.0 in both tables, so the base sizes are exactly what a fresh connector
// shows; codes 0…6 shrink it to 0.67 and grow it to 5.56 times.
export const HEAD_SIZE_CODES = MECHANICS.headSizeCodes;       // 7 — codes 0…6
export const HEAD_SIZE_DEFAULT = MECHANICS.headSizeDefault;   // 2
// The tables are the painters' own literals (MECHANICS §29c), read instruction
// by instruction out of each `<init>`; code 2 is never written by a painter and
// stays at the 1.0 the base class puts there, which is why it is 1.0 here too.
export const HEAD_SCALE = {
  // HollowArrow1 — v/ccq/h#<init>+0x0016…+0x007e
  triangle: {
    length: [0.7, 0.8, 1, 1.2, 1.4, 2.7, 5.1],
    width: [5 / 7, 6 / 7, 1, 8.5 / 7, 10 / 7, 20 / 7, 38 / 7],
  },
  // Arrow1 — v/ccq/c#<init>+0x0020…+0x0086
  open: {
    length: [0.7, 0.8, 1, 1.2, 1.4, 2.7, 5.1],
    width: [5 / 6, 5 / 6, 1, 7 / 6, 8 / 6, 15 / 6, 27 / 6],
  },
  // SolidArrow1 — v/ccq/n#<init>+0x0025…+0x008b
  filledTriangle: {
    length: [6 / 9, 7 / 9, 1, 11 / 9, 13 / 9, 26 / 9, 50 / 9],
    width: [0.8, 0.8, 1, 1.2, 1.4, 2.8, 5.2],
  },
  // HollowDiamond — v/ccq/q#<init>+0x0026…+0x008c
  diamond: {
    length: [8 / 11, 9 / 11, 1, 13 / 11, 16 / 11, 31 / 11, 58 / 11],
    width: [2 / 3, 17 / 21, 1, 25 / 21, 10 / 7, 20 / 7, 38 / 7],
  },
};
HEAD_SCALE.filledDiamond = HEAD_SCALE.diamond; // the same painter, filled
const HEAD_BASE = {
  triangle: [HEAD_TRI, HEAD_TRI_W],
  open: [HEAD_OPEN, HEAD_OPEN_W],
  filledTriangle: [HEAD_SOLID, HEAD_SOLID_W],
  diamond: [HEAD_DIAMOND, HEAD_DIAMOND_W],
  filledDiamond: [HEAD_DIAMOND, HEAD_DIAMOND_W],
};

/** A stored size code as the arrow accepts it: integer 0…6, else the default. */
export function headSizeOf(size) {
  const n = Number(size);
  if (!Number.isInteger(n) || n < 0 || n >= HEAD_SIZE_CODES) return HEAD_SIZE_DEFAULT;
  return n;
}

/**
 * Drawn length and width of one marker at one size code.
 * A marker the program has no multiplier table for (cross, ball, socket) is
 * drawn as before: it has no size code of its own.
 */
export function headMetrics(type, size = HEAD_SIZE_DEFAULT) {
  const base = HEAD_BASE[type];
  if (!base) return null;
  const scale = HEAD_SCALE[type] ?? HEAD_SCALE.triangle;
  const code = headSizeOf(size);
  return {
    len: base[0] * scale.length[code],
    wid: base[1] * scale.width[code],
  };
}
export const DASH = MECHANICS.dashPattern;               // LineStyle.Style2: "8 5"
// The record puts the multiplicity box 20 px off the line with height 15, so
// the text centre is 20 − 15/2 off it (MECHANICS §5d, build.mjs derives it).
export const MULTI_OFF = MECHANICS.multiOffset;
export const MIN_W = 40;

// Sequence diagram: the record's own layout options
// (_interactionDiagramLayoutOptions: absoluteLifelineSpacingDistance=80,
// absoluteMessageSpacingDistance=30) and the lifeline head (caption 14).
export const LIFELINE_HEAD = MECHANICS.lifelineHead;
export const ACTOR_LIFELINE_HEAD = MECHANICS.actorLifelineHead;
export const MESSAGE_GAP = MECHANICS.messageSpacing;
export const LIFELINE_GAP = MECHANICS.lifelineSpacing;

const measCanvas = typeof document !== 'undefined'
  ? document.createElement('canvas') : null;
const measCtx = measCanvas ? measCanvas.getContext('2d') : null;

export function textWidth(text, { bold = false, italic = false } = {}) {
  if (!measCtx) return String(text ?? '').length * 6;
  measCtx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${NOTATION.meta.font}`;
  return measCtx.measureText(String(text ?? '')).width;
}

/** Wrap text into lines that fit `widthPx` (notes). */
export function wrapText(text, widthPx) {
  const out = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const probe = line ? `${line} ${word}` : word;
      if (line && textWidth(probe) > widthPx) {
        out.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * The boxes a shape draws, with the shape's effective size.
 *
 * A classifier draws a name compartment and its member compartments; a state
 * draws entry/do/exit as plain lines; a use case is an ellipse whose only box
 * is the name; a lifeline is a head box plus a dashed tail. `boxes` is what
 * hit-testing, inline editing and the renderer share, so a double click lands
 * on the same row the painter drew.
 */
export function layoutOf(shape, element) {
  const def = NOTATION.shapes[element?.kind ?? ''];
  const style = def?.style ?? 'classifier';
  const boxes = [];
  const name = String(element?.name ?? '');
  const stereo = element?.stereotype ? 1 : 0;

  if (style === 'note' || style === 'text' || def?.wrap) {
    // The record's caption box is the shape's width − 15 and its height is 0
    // (it follows the text). The strip the record reserves at the right is the
    // fold; it narrows the column only while the caption is free to move —
    // a caption pinned to a side is laid out by the program, not by the fold
    // (§30d). The text inset is the build's own (§8), the delta is the record's.
    const freeMove = (element?.captionSide ?? CAPTION_SIDE_FREEMOVE) === CAPTION_SIDE_FREEMOVE;
    const column = freeMove ? shape.w - NOTE_CAP_DELTA - NOTE_PAD : shape.w - 2 * NOTE_PAD;
    const lines = wrapText(element?.note ?? '', Math.max(20, column));
    const h = Math.max(shape.h, lines.length * LINE_H + 2 * PAD_Y + 6);
    const w = Math.max(shape.w, 64);
    return { w, h, boxes: [{ id: 'note', y: 0, h, lines }] };
  }

  const named = !def?.nameless;
  const nameLines = stereo + (name.trim() ? 1 : 0) || 1;
  // lines × 14, no padding: that is the plate the program writes (§30).
  const nameH = nameLines * CAPTION_LINE;
  if (named) {
    if (style === 'lifeline' || style === 'actorLifeline') {
      boxes.push({ id: 'name', y: 0, h: style === 'actorLifeline' ? ACTOR_LIFELINE_HEAD : LIFELINE_HEAD, lines: nameLines });
    } else if (style === 'actor') {
      boxes.push({ id: 'name', y: Math.max(0, shape.h - 2 * LINE_H), h: 2 * LINE_H, lines: nameLines });
    } else if (style === 'frame') {
      boxes.push({ id: 'name', y: 0, h: 20, lines: 1 });
    } else if (style === 'ellipse' || style === 'action' || style === 'part' || style === 'objectnode'
      || style === 'diamond' || style === 'node' || style === 'component' || style === 'artifact'
      || style === 'swimlane' || style === 'boundary' || style === 'activity' || style === 'timingLane') {
      const headH = style === 'swimlane' ? 28 : style === 'timingLane' ? 24 : nameH;
      boxes.push({ id: 'name', y: 0, h: headH, lines: nameLines });
    } else {
      boxes.push({ id: 'name', y: 0, h: nameH, lines: nameLines });
    }
  }

  // A nameless glyph (initial, final, junction, sync bar) is exactly the size
  // it was placed at: padding for a name it never draws would turn an 18 px
  // initial node into a 24 px dot.
  let minW = def?.nameless
    ? shape.w
    : Math.max(textWidth(name, { bold: true }), textWidth(element?.stereotype ? `«${element.stereotype}»` : '')) + 2 * PAD_X + 8;
  let y = named ? boxes[0].h : 0;

  // Member and text compartments (classifier, state, component, …).
  // An empty member compartment is still a band on the sheet while the class
  // says so (§20): 0 follows the diagram (default 1 = Yes), 2 hides it.
  const showEmpty = emptyCompartmentsShown(element);
  for (const c of def?.compartments ?? []) {
    const rows = Array.isArray(element?.[c.field]) ? element[c.field] : [];
    const shown = rows.length;
    if (!shown) {
      if (c.mode === 'members' && showEmpty) {
        const h = LINE_H + COMPARTMENT_PAD;
        boxes.push({ id: c.field, y, h, rows: [], blank: true, mode: c.mode, prefix: c.prefix ?? '', title: c.title });
        y += h;
      }
      continue;
    }
    const h = shown * LINE_H + COMPARTMENT_PAD;
    boxes.push({ id: c.field, y, h, rows, mode: c.mode, prefix: c.prefix ?? '', title: c.title });
    y += h;
    if (c.mode === 'members' || c.mode === 'slots') {
      for (const r of rows) {
        const w = textWidth(memberText(r)) + PAD_X * 2 + (c.mode === 'members' ? 14 : 0);
        if (w > minW) minW = w;
      }
    } else {
      for (const r of rows) {
        const w = textWidth(`${c.prefix}${r}`) + PAD_X * 2;
        if (w > minW) minW = w;
      }
    }
  }

  // Внутренние переходы состояния (§14.5.10) — такие же строки, как entry/do/
  // exit: у них нет ни видимости, ни типа. Бокс только увеличивает фигуру и
  // даёт строке место; правится он в инспекторе, а не двойным щелчком.
  const internals = Array.isArray(element?.internals) ? element.internals : [];
  if (internals.length) {
    const rows = internals.map(internalText).filter((r) => r.trim());
    if (rows.length) {
      const h = rows.length * LINE_H + COMPARTMENT_PAD;
      boxes.push({ id: 'internals', y, h, rows, mode: 'lines', prefix: '', title: 'Внутренние переходы', readonly: true });
      y += h;
      for (const r of rows) minW = Math.max(minW, textWidth(r) + PAD_X * 2);
    }
  }

  if (def?.tab) minW = Math.max(minW, textWidth(name) + 20, 60);
  // An actor's name sits BELOW the figure and may be wider than it; the
  // bounding box stays the figure's width so a connector meets the drawn
  // stick figure instead of empty space.
  if (style === 'actor') minW = Math.max(shape.w, 40);
  if (style === 'lifeline') minW = Math.max(minW, MECHANICS.lifelineWidth);
  if (style === 'actorLifeline') minW = Math.max(minW, MECHANICS.interactionActorWidth);
  if (style === 'part') minW = Math.max(minW, MECHANICS.partWidth);
  if (style === 'activation') minW = Math.max(minW, MECHANICS.activationWidth);
  // A decision's name must fit inside the diamond's widest row, not just its
  // bounding box: the inscribed rectangle is half the width.
  if (style === 'diamond') minW = Math.max(minW, textWidth(name) * 2 + 24);
  const w = Math.max(shape.w, Math.ceil(minW), def?.nameless ? shape.w : MIN_W);
  let h;
  if (style === 'lifeline' || style === 'actorLifeline') {
    h = Math.max(shape.h, (style === 'actorLifeline' ? ACTOR_LIFELINE_HEAD : LIFELINE_HEAD) + 120);
  } else if (def?.tab) {
    h = Math.max(y, shape.h - TAB_H) + TAB_H;
  } else {
    h = Math.max(y, shape.h);
  }
  return { w, h: Math.max(h, (named ? nameH : 8) + 4), boxes };
}

/** The edge anchor point of a shape for a connector end. */
export function edgePoint(shape, layout, side, t) {
  const { w, h } = layout;
  const x = shape.x;
  const y = shape.y;
  switch (side) {
    case 'top': return { x: x + w * t, y, side, t };
    case 'bottom': return { x: x + w * t, y: y + h, side, t };
    case 'left': return { x, y: y + h * t, side, t };
    case 'right': return { x: x + w, y: y + h * t, side, t };
    default: return { x: x + w / 2, y: y + h / 2, side: 'bottom', t: 0.5 };
  }
}

/**
 * A connector end written as a FRACTION of the shape's box plus a pixel offset
 * — the shape draw.io keeps in `entryX`/`entryY`/`entryDx`/`entryDy`
 * (research §3.1, `mxGraph.prototype.getConnectionPoint`, draw.io 20.8.3):
 *
 *   x = shape.x + fx·w + dx        y = shape.y + fy·h + dy
 *   if (project) спроецировать на границу по лучу из центра
 *
 * `fx`/`fy` are NOT clamped: a real file holds −0.008 and 1.001, and a value
 * outside 0…1 means the end hangs outside the box. Nothing is rounded here —
 * the file keeps the numbers it was read with; only the drawing rounds.
 */
export function attachPoint(shape, layout, attach = {}) {
  const { w, h } = layout;
  const fx = Number(attach.fx ?? 0.5);
  const fy = Number(attach.fy ?? 0.5);
  const dx = Number(attach.dx ?? 0);
  const dy = Number(attach.dy ?? 0);
  const x = shape.x + fx * w + dx;
  const y = shape.y + fy * h + dy;
  if (!attach.project) return { x, y };
  // The ray from the centre through the point meets the border where the
  // smaller of the two box fractions is reached: that is the perimeter point
  // draw.io's getPerimeterPoint returns, without its rounded-off corners.
  const cx = shape.x + w / 2;
  const cy = shape.y + h / 2;
  const vx = x - cx;
  const vy = y - cy;
  if (!vx && !vy) return { x: cx, y: cy };
  const sx = vx ? (w / 2) / Math.abs(vx) : Infinity;
  const sy = vy ? (h / 2) / Math.abs(vy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + vx * s, y: cy + vy * s };
}

/**
 * The point a connector end attaches at: the fraction+offset form when the
 * end carries `attach`, the old side+`t` form otherwise. An imported file
 * therefore keeps its exact end without touching any old one.
 *
 * `perimeter` is the link-wide `entryPerimeter` flag (§7.6): it asks for the
 * border projection even when the end itself does not.
 */
export function endPoint(shape, layout, end, perimeter = false) {
  const a = end?.attach;
  if (a && typeof a === 'object' && (Number.isFinite(Number(a.fx)) || Number.isFinite(Number(a.fy)))) {
    return attachPoint(shape, layout, { ...a, project: a.project === true || perimeter === true });
  }
  return edgePoint(shape, layout, end?.side, end?.t ?? 0.5);
}

const NORMALS = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** The polyline a connector draws between two attached ends. */
// DefaultConnectorStyle is the diagram preference the program stores
// (v/dap/r#<init>+0x003a = 1) and its own value table names the numbers:
// 0 Rectilinear, 1 Oblique, 2 Curve, 3 Follow Diagram, 4 Round Oblique,
// 5 Round Rectilinear (§22a). The build's map from code to route lives in
// connector-style.js, next to the table it came from.
const DEFAULT_ROUTE = STYLE_DEFAULT_ROUTE;

export function routePoints(p1, p2, route = DEFAULT_ROUTE) {
  if (route === 'direct') return [[p1.x, p1.y], [p2.x, p2.y]];
  const n1 = NORMALS[p1.side] ?? NORMALS.bottom;
  const n2 = NORMALS[p2.side] ?? NORMALS.bottom;
  const s1 = { x: p1.x + n1.x * STUB, y: p1.y + n1.y * STUB };
  const s2 = { x: p2.x + n2.x * STUB, y: p2.y + n2.y * STUB };
  const dot = n1.x * n2.x + n1.y * n2.y;
  const pts = [];

  if (dot <= -0.5) {
    // Facing sides: one straight run. The reference's rectilinear style adds a
    // mid elbow, but a 20 px jog reads as a mistake; a straight line between
    // two facing edges is the same UML and never doubles a frame's border.
    pts.push([p1.x, p1.y], [p2.x, p2.y]);
  } else if (dot >= 0.5) {
    // Same side: U-turn around both shapes.
    const extra = 24;
    if (n1.y !== 0) {
      const fy2 = n1.y > 0 ? Math.max(s1.y, s2.y) + extra : Math.min(s1.y, s2.y) - extra;
      pts.push([p1.x, p1.y], [s1.x, s1.y], [s1.x, fy2], [s2.x, fy2], [s2.x, s2.y], [p2.x, p2.y]);
    } else {
      const fx2 = n1.x > 0 ? Math.max(s1.x, s2.x) + extra : Math.min(s1.x, s2.x) - extra;
      pts.push([p1.x, p1.y], [s1.x, s1.y], [fx2, s1.y], [fx2, s2.y], [s2.x, s2.y], [p2.x, p2.y]);
    }
  } else {
    // Perpendicular sides: one corner.
    const c1 = { x: s1.x, y: s2.y };
    const c2 = { x: s2.x, y: s1.y };
    const ok1 = (c1.x - s1.x) * n1.x + (c1.y - s1.y) * n1.y >= -0.5
      && (c1.x - s2.x) * n2.x + (c1.y - s2.y) * n2.y >= -0.5;
    const corner = ok1 ? c1 : c2;
    pts.push([p1.x, p1.y], [s1.x, s1.y], [corner.x, corner.y], [s2.x, s2.y], [p2.x, p2.y]);
  }

  // Drop nearly-duplicate points so the path stays clean.
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.6) out.push(p);
  }
  if (out.length < 2) out.push([p1.x, p1.y], [p2.x, p2.y]);
  return out;
}

/**
 * The route a connector takes, waypoints included.
 *
 * A link may carry `waypoints: [[x, y], …]` — bends the person placed by hand
 * in world coordinates. They sit BETWEEN the two attached ends: the ends still
 * snap to the shapes' edges, and the line goes through every waypoint in order.
 * Without waypoints this is exactly `routePoints`, so a file that never had a
 * bend keeps the automatic route byte for byte.
 */
export function linkPoints(p1, p2, route, waypoints, noEdgeStyle = false) {
  const wp = Array.isArray(waypoints)
    ? waypoints.filter((p) => Array.isArray(p) && p.length >= 2
      && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map((p) => [Number(p[0]), Number(p[1])])
    : [];
  // `noEdgeStyle` (§7.6, a real file's "the router must not touch this route")
  // means the points ARE the route: the ends are joined straight through them
  // and no elbow is computed. It is read from a file, never invented on save.
  if (noEdgeStyle) return [[p1.x, p1.y], ...wp, [p2.x, p2.y]];
  const base = routePoints(p1, p2, route);
  if (!wp.length) return base;
  return [base[0], ...wp, base[base.length - 1]];
}

/**
 * The corner cut of the rounded styles (px) — ONE size, the program's own:
 * `v/cct/es#a(D)+0x00b1` multiplies 7.0 by the sheet's zoom and truncates to
 * an int, so a corner is cut 7 px back along both legs at 100 % (§27b).
 * `small` and `large` both carry it: the original has no second radius, and
 * `arcSize` (a draw.io file's own radius) still wins when a file has one.
 */
export const ROUNDED_CUT = MECHANICS.connectorCornerCut;  // 7 at zoom 1
export const ROUND_R = { off: 0, small: ROUNDED_CUT, large: ROUNDED_CUT };

/**
 * `[[x,y], …]` → the SVG path of a plain polyline. */
export const polylinePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * The samples of the program's Curve connector (§27a), read out of
 * `v/cct/ba#l()` and run against the original's own classes:
 *
 *  - the route's points (ends + waypoints) are the spline's knots;
 *  - the parameter is the CHORD LENGTH, accumulated then divided by the total
 *    (`v/cdi/g#<init>`), so a long leg gets the same share of t as it has of
 *    the line;
 *  - each axis is a natural cubic spline — second derivative 0 at both ends
 *    (`v/cdi/f#<init>` + `#a()`, the tridiagonal solve);
 *  - t runs 0 … 1 in steps of 1/160 and every sample is a point of the path
 *    (`v/cct/ba#l()+0x0200…+0x0233`), so the curve is drawn as a 161-point
 *    polyline;
 *  - two identical points in a row are nudged by +8,+8 px, or the segment
 *    between them would have no length and no direction (`+0x0130`).
 *
 * Two points are a straight line (`v/cct/ba#l()+0x0020`), which is why a
 * connector with no bends does not become a curve.
 */
export function curveSamples(pts) {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);
  const src = pts.map((p) => [p[0], p[1]]);
  for (let i = 1; i < src.length; i += 1) {
    if (src[i][0] === src[i - 1][0] && src[i][1] === src[i - 1][1]) {
      src[i][0] += MECHANICS.connectorCurveNudge;
      src[i][1] += MECHANICS.connectorCurveNudge;
    }
  }
  const n = src.length;
  const knots = new Array(n).fill(0);
  let total = 0;
  for (let i = 1; i < n; i += 1) {
    const dx = src[i][0] - src[i - 1][0];
    const dy = src[i][1] - src[i - 1][1];
    total += dx === 0 ? Math.abs(dy) : (dy === 0 ? Math.abs(dx) : Math.hypot(dx, dy));
    knots[i] = total;
  }
  if (total === 0) return src;
  for (let i = 1; i < n - 1; i += 1) knots[i] /= total;
  knots[n - 1] = 1;
  const fx = splineAxis(knots, src.map((p) => p[0]));
  const fy = splineAxis(knots, src.map((p) => p[1]));
  const out = [];
  for (let t = 0; t <= 1; t += MECHANICS.connectorCurveStep) out.push([fx(t), fy(t)]);
  return out;
}

/** Natural cubic spline through (knots[i], values[i]) → value(t). */
function splineAxis(knots, values) {
  const n = values.length;
  const M = new Array(n).fill(0);         // second derivatives, 0 at both ends
  if (n > 2) {
    const c = new Array(n).fill(0);
    const d = new Array(n).fill(0);
    const rhs = (i) => 6 * ((values[i + 1] - values[i]) / (knots[i + 1] - knots[i])
      - (values[i] - values[i - 1]) / (knots[i] - knots[i - 1]));
    const h = (i) => knots[i + 1] - knots[i];
    d[1] = 2 * (h(0) + h(1));
    c[1] = h(1) / d[1];
    M[1] = rhs(1) / d[1];
    for (let i = 2; i <= n - 2; i += 1) {
      d[i] = 2 * (h(i - 1) + h(i)) - h(i - 1) * c[i - 1];
      c[i] = h(i) / d[i];
      M[i] = (rhs(i) - h(i - 1) * M[i - 1]) / d[i];
    }
    for (let i = n - 3; i >= 1; i -= 1) M[i] -= c[i] * M[i + 1];
  }
  return (t) => {
    if (t <= 0) return values[0];
    if (t >= 1) return values[n - 1];
    let i = 0;
    while (i < n - 2 && t > knots[i + 1]) i += 1;
    const h = knots[i + 1] - knots[i];
    const u = t - knots[i];
    return values[i]
      + ((values[i + 1] - values[i]) / h - (h * (2 * M[i] + M[i + 1])) / 6) * u
      + (M[i] / 2) * u * u
      + ((M[i + 1] - M[i]) / (6 * h)) * u * u * u;
  };
}

export function curvePath(pts) {
  const s = curveSamples(pts);
  return s.length < 2 ? polylinePath(pts) : samplesPath(s);
}

/** The path of ALREADY sampled points — no second pass through the spline. */
export const samplesPath = (s) => s
  .map((p, i) => `${i ? 'L' : 'M'} ${round2(p[0])} ${round2(p[1])}`).join(' ');

/**
 * Path data for a connector: a polyline, or the same polyline with its corners
 * softened.
 *
 * Both the sheet and the SVG export call this one function, so the picture in
 * the file cannot drift from the picture on screen.
 *
 * Each inner vertex is cut back 7 px along both of its segments and bridged by
 * one cubic `C` whose controls are (cut point, the vertex, cut point) — the
 * program's own softening, `v/cct/es#a(D)+0x00b1…+0x01a6` (§27b). A vertex
 * that goes straight on is not a corner and keeps its `L`. A file that carries
 * its own `arcSize` (draw.io's radius, §7.3) keeps its circular arc `A`
 * instead, with a `Q` fallback when the arc cannot stay tangent. The cut is
 * never longer than half of the shorter adjacent segment, so a short leg
 * cannot fold the line back on itself.
 */
export function pathD(pts, rounded = 'off', arcSize = null, curve = false) {
  // A curve is a different shape of line, not a rounded polyline: the branch
  // comes first so `rounded`/`arcSize` cannot turn its control points into
  // corners (§7.3).
  if (curve) return curvePath(pts);
  // `arcSize` is a number over `rounded` (§7.3, draw.io's own style key): the
  // file's value is the RADIUS; the named steps stay for old files.
  const custom = Number(arcSize);
  // `arcSize` is a draw.io file's own radius and keeps the arc it describes
  // (§7.3). Without one, a rounded style is the ORIGINAL's softening, not an
  // arc: cut the corner 7 px back along both legs and lay a cubic whose
  // controls are (cut point, the corner, cut point) — v/cct/es#a(D)+0x00b1…
  // +0x01a6 (§27b). The cut is clamped to half of the shorter leg: the
  // original does not clamp, and its router never emits a leg shorter than 2×7
  // px, while a hand-placed waypoint right next to a bend can.
  const customR = Number.isFinite(custom) && custom > 0 ? custom : 0;
  const cut = customR || (ROUND_R[rounded] ?? 0);
  if (cut <= 0 || pts.length < 3) return polylinePath(pts);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    let ux = x1 - x0;
    let uy = y1 - y0;
    const ul = Math.hypot(ux, uy);
    let vx = x2 - x1;
    let vy = y2 - y1;
    const vl = Math.hypot(vx, vy);
    if (!ul || !vl) continue;
    ux /= ul; uy /= ul; vx /= vl; vy /= vl;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    // A vertex that goes straight on is not a corner: the line passes through
    // it, exactly as v/cct/es#a(D)+0x011e…+0x0139 skips collinear points.
    if (turn < 0.06 || turn > Math.PI - 0.06) {
      d += ` L ${x1} ${y1}`;
      continue;
    }
    if (customR) {
      // draw.io's radius: a circular arc, tangent when the turn allows it.
      const want = customR * Math.tan(turn / 2);
      const t = Math.min(want, Math.min(ul, vl) / 2);
      const ax = x1 - ux * t;
      const ay = y1 - uy * t;
      const bx = x1 + vx * t;
      const by = y1 + vy * t;
      d += ` L ${round2(ax)} ${round2(ay)}`;
      if (want <= customR + 1e-9 && t >= want - 1e-9) {
        // SVG's y axis points down, so a clockwise turn is sweep 1.
        const sweep = ux * vy - uy * vx > 0 ? 1 : 0;
        d += ` A ${round2(customR)} ${round2(customR)} 0 0 ${sweep} ${round2(bx)} ${round2(by)}`;
      } else {
        d += ` Q ${round2(x1)} ${round2(y1)} ${round2(bx)} ${round2(by)}`;
      }
      continue;
    }
    const t = Math.min(cut, ul / 2, vl / 2);
    const ax = x1 - ux * t;
    const ay = y1 - uy * t;
    const bx = x1 + vx * t;
    const by = y1 + vy * t;
    d += ` L ${round2(ax)} ${round2(ay)}`;
    d += ` C ${round2(ax)} ${round2(ay)} ${round2(x1)} ${round2(y1)} ${round2(bx)} ${round2(by)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/**
 * Where a connector's name label sits (its own drag offsets included) and
 * which way it reads.
 *
 * `orientation` is `connectorLabelOrientation` (§22b): the diagram preference
 * is 0 = "Horizontal Only" in the program and in every record it writes, so a
 * label is normally flat; 1 keeps it on one of the two axes, 2 follows the
 * segment even upside down, 3 follows the segment and turns it upright, and 4
 * is the CONNECTOR's own "follow the diagram" code, resolved to the
 * preference.
 *
 * The place is the MIDDLE OF THE WHOLE ROUTE by path length: on a three-leg
 * route the label used to sit halfway along the first leg, which on an elbow
 * put it in the corner and on a U-turn put it on the way out.
 */
export function labelPos(pts, ldx = 0, ldy = 0, orientation = MECHANICS.labelOrientation) {
  const lens = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l);
    total += l;
  }
  let bi = 0;
  let target = total / 2;
  while (bi < lens.length - 1 && target > lens[bi]) {
    target -= lens[bi];
    bi += 1;
  }
  const l = lens[bi] || 1;
  const t = Math.min(1, Math.max(0, target / l));
  const mid = pts[bi];
  const next = pts[bi + 1] ?? mid;
  const mx = mid[0] + (next[0] - mid[0]) * t;
  const my = mid[1] + (next[1] - mid[1]) * t;
  const dx = next[0] - mid[0];
  const dy = next[1] - mid[1];
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { x: mx + ldx, y: my + ldy, angle: labelAngle(raw, orientation) };
}

/** Where a multiplicity label sits: `f` along the route from the given end. */
export function multiPos(pts, fromEnd, f) {
  const seq = fromEnd === 'from' ? pts : [...pts].reverse();
  let total = 0;
  const lens = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const l = Math.hypot(seq[i + 1][0] - seq[i][0], seq[i + 1][1] - seq[i][1]);
    lens.push(l);
    total += l;
  }
  let target = total * f;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i]) {
      const t = lens[i] ? target / lens[i] : 0;
      const x = seq[i][0] + (seq[i + 1][0] - seq[i][0]) * t;
      const y = seq[i][1] + (seq[i + 1][1] - seq[i][1]) * t;
      return { x, y: y - MULTI_OFF };
    }
    target -= lens[i];
  }
  const last = seq[seq.length - 1];
  return { x: last[0], y: last[1] - MULTI_OFF };
}

/** Nearest side and position along it for a point on a shape's bounds. */
export function sideAndT(x, y, w, h, px, py) {
  const dl = Math.abs(px - x);
  const dr = Math.abs(px - (x + w));
  const dt = Math.abs(py - y);
  const db = Math.abs(py - (y + h));
  const min = Math.min(dl, dr, dt, db);
  if (min === dt) return { side: 'top', t: w ? clamp01((px - x) / w) : 0.5 };
  if (min === db) return { side: 'bottom', t: w ? clamp01((px - x) / w) : 0.5 };
  if (min === dl) return { side: 'left', t: h ? clamp01((py - y) / h) : 0.5 };
  return { side: 'right', t: h ? clamp01((py - y) / h) : 0.5 };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
