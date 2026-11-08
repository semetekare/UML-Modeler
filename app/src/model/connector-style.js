// The connector's two enums, exactly as the original numbers them.
//
// Both come from the program's own value→label table, `lib01.jar!v/cni/b#a()V`
// (read in Deep mode, MECHANICS.md §22): it is the class the properties dialog
// calls to print the name of a stored number —
// `a(prefix, property, value)` looks up `prefix.property.value`, then
// `property.value`, so "connectorStyle.1" → "Oblique" is the program saying
// what 1 means.
//
// Nothing here is invented: the numbers, the names and the defaults are in the
// sheet, and a missing value fails the build (build.mjs SHEET_KEYS).

import { MECHANICS } from '../mechanics.generated.js';
import { NOTATION } from './notation.js';

/** `connectorStyle` — how a connector's line is laid out (§22a). */
export const CONNECTOR_STYLE = {
  rectilinear: MECHANICS.connectorStyleRectilinear,            // 0 Rectilinear
  oblique: MECHANICS.connectorStyleOblique,                    // 1 Oblique
  curve: MECHANICS.connectorStyleCurve,                        // 2 Curve
  followDiagram: MECHANICS.connectorStyleFollowDiagram,        // 3 Follow Diagram
  roundOblique: MECHANICS.connectorStyleRoundOblique,          // 4 Round Oblique
  roundRectilinear: MECHANICS.connectorStyleRoundRectilinear,   // 5 Round Rectilinear
};

/**
 * Style code → the route this editor draws.
 *
 * `curve` (2) is its own route and the program has its own painter for it:
 * `v/dfl/acb#a(Z,I)` sends style 2 to `v/cct/ba`, which draws a NATURAL CUBIC
 * SPLINE through the same points (ends + waypoints), parameterised by chord
 * length and sampled 161 times — geometry.js::curveSamples, MECHANICS §27a.
 * `followDiagram` (3) is the CONNECTOR's own "inherit" value; at diagram level
 * there is nothing above a diagram, so it falls back to the rectilinear route
 * this editor has always drawn.
 */
const ROUTE_OF_STYLE = {
  [CONNECTOR_STYLE.rectilinear]: 'rect',
  [CONNECTOR_STYLE.oblique]: 'direct',
  [CONNECTOR_STYLE.curve]: 'curve',
  [CONNECTOR_STYLE.followDiagram]: 'rect',
  [CONNECTOR_STYLE.roundOblique]: 'direct',
  [CONNECTOR_STYLE.roundRectilinear]: 'rect',
};

/** Style code → corner softening. 4 and 5 are the two "Round …" styles. */
const ROUNDED_OF_STYLE = {
  [CONNECTOR_STYLE.rectilinear]: 'off',
  [CONNECTOR_STYLE.oblique]: 'off',
  [CONNECTOR_STYLE.curve]: 'off',
  [CONNECTOR_STYLE.followDiagram]: 'off',
  [CONNECTOR_STYLE.roundOblique]: 'small',
  [CONNECTOR_STYLE.roundRectilinear]: 'small',
};

export const isConnectorStyle = (code) => Object.prototype.hasOwnProperty.call(ROUTE_OF_STYLE, code);

/* ------------------------------------------------------------- самосвязь */

/**
 * Может ли связь этого вида соединить элемент с самим собой.
 *
 * Значение живёт в нотации (`connectors[kind].self`) и пришло из стандарта, а
 * не из удобства: ассоциация, агрегация, композиция и сообщение самосвязь
 * разрешают (§11.5, §17.4.4), обобщение — запрещает (`no_cycles_in_generalization`,
 * §9.9.4.8), включение — тоже (`UseCase::cannot_include_self`, §18.2.5.6).
 *
 *   allowed   — петля разрешена и рисуется;
 *   forbidden — отказ с пунктом стандарта;
 *   hidden    — связь читается и сохраняется, но на листе её нет: так в чужих
 *               файлах может прийти внутренний переход, который в этой модели
 *               живёт не связью, а `internals[]` состояния (§14.2.4.9).
 */
export const SELF = { allowed: 'allowed', forbidden: 'forbidden', hidden: 'hidden' };
const SELF_RULES = new Set(Object.values(SELF));

/** Правило вида связи; вид без поля считается запрещающим. */
export function selfRuleOf(kind) {
  const rule = NOTATION.connectors[kind]?.self;
  return SELF_RULES.has(rule) ? rule : SELF.forbidden;
}

/** Правило для конкретной связи: `internal: true` — это скрытый переход. */
export function selfRuleOfRelationship(rel) {
  if (!rel) return SELF.forbidden;
  if (rel.internal === true) {
    const rule = NOTATION.connectors[rel.kind]?.selfInternal;
    return SELF_RULES.has(rule) ? rule : SELF.hidden;
  }
  return selfRuleOf(rel.kind);
}

/**
 * Почему петлю нельзя нарисовать — фраза с пунктом стандарта, а не «нельзя».
 * Для вида без собственного пункта остаётся честное объяснение без номера.
 */
export function selfRefusal(kind, { internal = false } = {}) {
  if (internal) return 'Внутренний переход не показывается на диаграмме (UML 2.5.1 §14.2.4.9).';
  if (kind === 'generalization') return 'Обобщение не может быть собственным предком (UML 2.5.1 §9.9.4.8).';
  if (kind === 'include') return 'Вариант использования не может включать сам себя (UML 2.5.1 §18.2.5.6).';
  const label = NOTATION.connectors[kind]?.label ?? kind;
  return `Связь «${label}» не может соединять элемент с самим собой.`;
}

export const routeOfStyle = (code) => ROUTE_OF_STYLE[code] ?? null;
export const roundedOfStyle = (code) => ROUNDED_OF_STYLE[code] ?? 'off';

/** The diagram default (`DefaultConnectorStyle`, 1 = Oblique in the record). */
export const DEFAULT_ROUTE = routeOfStyle(MECHANICS.connectorStyle) ?? 'rect';

/** The route a link draws: its own style wins over the stored route. */
export function routeOfLink(link, fallback = DEFAULT_ROUTE) {
  const code = link?.style;
  if (code != null && isConnectorStyle(code)) return routeOfStyle(code);
  return link?.route ?? fallback;
}

/**
 * The value a connector's own property carries when nobody chose one:
 * `Connector.connectorStyle` is 3 = Follow Diagram in the program's registry
 * (lib01.jar!v/cni/a#<clinit>+0x0e42).
 */
export const STYLE_INHERIT = MECHANICS.connectorStyleInherit;

/** The six styles, in the program's order, for the inspector's list. */
export const STYLE_OPTIONS = [
  [CONNECTOR_STYLE.rectilinear, 'Rectilinear'],
  [CONNECTOR_STYLE.oblique, 'Oblique'],
  [CONNECTOR_STYLE.curve, 'Curve'],
  [CONNECTOR_STYLE.followDiagram, 'как на диаграмме'],
  [CONNECTOR_STYLE.roundOblique, 'Round Oblique'],
  [CONNECTOR_STYLE.roundRectilinear, 'Round Rectilinear'],
];

/** `connectorLabelOrientation` — where a connector's name may turn (§22b). */
export const LABEL_ORIENTATION = {
  horizontalOnly: MECHANICS.labelOrientationHorizontal,                    // 0
  horizontalOrVertical: MECHANICS.labelOrientationHorizontalOrVertical,    // 1
  followAngle: MECHANICS.labelOrientationFollowAngle,                      // 2
  followUpright: MECHANICS.labelOrientationFollowUpright,                  // 3
  followDiagram: MECHANICS.labelOrientationFollowDiagram,                  // 4
};

/** The five orientations, in the program's order, for the inspector's list. */
export const ORIENTATION_OPTIONS = [
  [LABEL_ORIENTATION.horizontalOnly, 'горизонтально'],
  [LABEL_ORIENTATION.horizontalOrVertical, 'по осям'],
  [LABEL_ORIENTATION.followAngle, 'вдоль линии'],
  [LABEL_ORIENTATION.followUpright, 'вдоль линии, не вверх ногами'],
  [LABEL_ORIENTATION.followDiagram, 'как на диаграмме'],
];

/**
 * A connector's `4` (Follow Diagram) resolves to the diagram preference, and
 * the preference never holds 4 — its setter accepts 0..3 (§22b) — so a missing
 * or inherited value lands on the packaged default, 0 = Horizontal Only.
 */
export function resolveOrientation(code) {
  if (code == null || code === LABEL_ORIENTATION.followDiagram) return MECHANICS.labelOrientation;
  return code;
}

/**
 * The rotation of a label on a segment running at `raw` degrees (SVG's screen
 * angle: y points down, so atan2 of a downward run is positive).
 */
export function labelAngle(raw, code) {
  const mode = resolveOrientation(code);
  // -180..180, and a hair off horizontal stays horizontal: the reference's
  // flat runs are not tilted by a rounding artefact.
  let a = raw;
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  switch (mode) {
    case LABEL_ORIENTATION.horizontalOnly:
      return 0;
    case LABEL_ORIENTATION.horizontalOrVertical: {
      // Only the two readable directions: the nearer axis wins.
      const flat = Math.abs(a) < 45 || Math.abs(a) > 135;
      if (flat) return 0;
      return a > 0 ? 90 : -90;
    }
    case LABEL_ORIENTATION.followAngle:
      // The angle as it is, even upside down — the untamed option.
      return Math.abs(a) < 0.5 ? 0 : a;
    case LABEL_ORIENTATION.followUpright:
    default:
      // Follow the segment, never hang upside down: a vertical run reads
      // bottom-to-top.
      if (a >= 90) a -= 180;
      if (a < -90) a += 180;
      return Math.abs(a) < 0.5 ? 0 : a;
  }
}
