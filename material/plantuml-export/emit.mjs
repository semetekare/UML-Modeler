// PlantUML export: `uml-model/3` → text.
//
// Pure functions, no DOM, no `app/`: the same module runs under Node here and
// can be dropped into the editor. It transfers INFORMATION, not layout —
// PlantUML lays the diagram out itself, and the coordinates in `shapes`/`links`
// are used only where the format stores meaning in geometry:
//
//   * which shape sits inside which frame (there is no `parent` field);
//   * which messages a combined fragment covers (there is no coverage field);
//   * the order of sequence messages (that order IS the `y` of the link view).
//
// Everything else — position, size, fill, route — is dropped on purpose.
//
//   plan(model, diagram)   the structured plan: family, lines, declarations
//   emit(model, opts)      one diagram as a `.puml` string
//   emitAll(model)         every diagram, in model order
//
// `plan()` is what `check.mjs` counts, so "what the exporter claims" and
// "what PlantUML saw" are compared as two separate numbers.

/* ------------------------------------------------------------------ kinds */

/** Keywords of the class-diagram command family (CommandCreateClass). */
const CLASS_ONLY = new Set(['class', 'interface', 'enumeration', 'datatype', 'object',
  'stereotype', 'metaclass', 'part', 'collaborationUse']);

/** Keywords of the description-diagram family (CommandCreateElementFull). */
const DESC_ONLY = new Set(['component', 'artifact', 'deploymentSpec', 'node', 'device',
  'executionEnvironment', 'actor', 'usecase', 'collaboration', 'systemBoundary', 'port']);

/** Frames that hold other shapes when geometry puts them inside. */
const CONTAINERS = new Set(['package', 'model', 'profile', 'systemBoundary', 'node',
  'device', 'executionEnvironment', 'component', 'artifact', 'activity', 'swimlane',
  'state', 'interaction']);

/** Element kinds that live on a state diagram. */
const STATE_KINDS = new Set(['state', 'initial', 'final', 'choice', 'junction',
  'historyShallow', 'historyDeep', 'entryPoint', 'exitPoint', 'terminate']);

/** Element kinds that live on an activity diagram. */
const ACTIVITY_KINDS = new Set(['action', 'activity', 'decision', 'merge', 'fork', 'join',
  'objectNode', 'activityParameter', 'swimlane']);

/** Element kinds that live on a sequence diagram. */
const SEQUENCE_KINDS = new Set(['lifeline', 'actorLifeline', 'activation', 'fragment',
  'interactionUse', 'interaction', 'timingLane']);

/** Pseudo-states whose `[*]` PlantUML keeps as one node per role. */
const PSEUDO = new Set(['initial', 'final']);

const SEQUENCE_CONNECTORS = new Set(['message', 'reply', 'createMessage', 'destroyMessage']);
const ACTIVITY_CONNECTORS = new Set(['controlFlow', 'objectFlow']);

/** Keyword and decoration for a structural element. */
const STRUCT = {
  class: { kw: 'class' },
  interface: { kw: 'interface' },
  enumeration: { kw: 'enum' },
  datatype: { kw: 'class', stereo: 'dataType' },
  package: { kw: 'package', displayFirst: true, container: true },
  model: { kw: 'package', stereo: 'model', displayFirst: true, container: true },
  profile: { kw: 'package', stereo: 'profile', displayFirst: true, container: true },
  component: { kw: 'component', container: true },
  artifact: { kw: 'artifact', container: true },
  deploymentSpec: { kw: 'artifact', stereo: 'deployment spec' },
  node: { kw: 'node', container: true },
  device: { kw: 'node', stereo: 'device', container: true },
  executionEnvironment: { kw: 'node', stereo: 'executionEnvironment', container: true },
  object: { kw: 'object', objectOrder: true },
  part: { kw: 'class', stereo: 'part' },
  port: { kw: 'port' },
  collaboration: { kw: 'usecase', stereo: 'collaboration' },
  collaborationUse: { kw: 'class', stereo: 'use' },
  stereotype: { kw: 'class', stereo: 'stereotype' },
  metaclass: { kw: 'class', stereo: 'metaclass' },
  actor: { kw: 'actor' },
  usecase: { kw: 'usecase' },
  systemBoundary: { kw: 'rectangle', stereo: 'subject', container: true },
  note: { kw: 'note' },
  text: { kw: 'note', stereo: 'text' },
};

/** Markers of the state family (grammar §4.5). */
const STATE_KW = {
  state: null,
  initial: '*',
  final: '*',
  choice: 'choice',
  junction: 'junction',
  historyShallow: 'history',
  historyDeep: 'history*',
  entryPoint: 'entryPoint',
  exitPoint: 'exitPoint',
  terminate: 'end',
};

/* ------------------------------------------------------------------ utils */

const isStr = (v) => typeof v === 'string' && v.length > 0;

/** An identifier PlantUML accepts (`[\p{L}0-9_.]+`, no spaces). */
export function aliasOf(element, index = 0) {
  const raw = String(element?.id ?? '');
  const clean = raw.replace(/[^\p{L}0-9_.]/gu, '_');
  if (clean && !/^\d/.test(clean)) return clean;
  return `x${clean || index + 1}`;
}

/** The text a shape shows: its name, else its stereotype, else nothing. */
function displayOf(el) {
  const name = isStr(el?.name) ? el.name : '';
  return name.replace(/"/g, "'").replace(/\r?\n/g, ' ');
}

/** The name a mixed diagram shows, after duplicate names were made unique. */
const shownName = (ctx, el) => ctx.names.get(el.id) ?? displayOf(el);

const displayedFor = (ctx, el) => (ctx?.mixed ? shownName(ctx, el) : displayOf(el));

/** A quoted display name, or the bare alias when there is nothing to show. */
function declared(alias, text) {
  return text ? `${alias} as "${text}"` : alias;
}

/**
 * In a mixed diagram PlantUML parses everything with the class-diagram
 * commands, and those do not accept `component x as "Name"`. So the shapes
 * that come from the description family are declared by their quoted name
 * alone, and links address them by that name.
 */
function mixedRef(ctx, el, alias) {
  const text = shownName(ctx, el);
  return text ? `"${text}"` : alias;
}

/** Display names of a mixed diagram, made unique — links are matched by name. */
function assignNames(ctx, shown) {
  const seen = new Map();
  for (const el of shown) {
    let text = displayOf(el);
    if (!text) continue;
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    if (n > 1) {
      text = `${text} (${n})`;
      ctx.warnings.push(`имя «${displayOf(el)}» встречается ${n} раз — в выгрузке помечено`);
    }
    ctx.names.set(el.id, text);
  }
}

/** Every text field of an element, flattened for a comment. */
function commentLines(alias, el, out) {
  if (isStr(el.documentation)) {
    out.push(`' doc ${alias}: ${oneLine(el.documentation)}`);
  }
  for (const tv of el.taggedValues ?? []) {
    if (tv && isStr(tv.name)) out.push(`' tag ${alias} ${tv.name} = ${oneLine(tv.value)}`);
  }
  if (isStr(el.source)) out.push(`' source ${alias}: ${oneLine(el.source)}`);
  if (isStr(el.note) && el.kind !== 'note' && el.kind !== 'text') {
    out.push(`' note ${alias}: ${oneLine(el.note)}`);
  }
}

const oneLine = (v) => String(v ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();

/**
 * The guard of a combined fragment. PlantUML prints the fragment label in
 * its own square brackets and eats a `[…]` written by hand (`alt [a != b]`
 * renders as `!= b`), so the model's brackets are removed before writing.
 */
const guardText = (v) => oneLine(v).replace(/^\[\s*/, '').replace(/\s*\]$/, '');

/* -------------------------------------------------------------- geometry */

const centre = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
const inside = (inner, outer) => {
  const c = centre(inner);
  return c.x >= outer.x && c.x <= outer.x + outer.w
    && c.y >= outer.y && c.y <= outer.y + outer.h;
};

/**
 * Parent of every shape, from geometry: the smallest container shape whose
 * rectangle holds the shape's centre. `uml-model/3` has no parent field, so
 * this is the only way to keep a package's contents inside it.
 */
function parentsOf(model, diagram) {
  const shapes = diagram.shapes ?? [];
  const kindOf = new Map((model.elements ?? []).map((e) => [e.id, e.kind]));
  const parent = new Map();
  for (const s of shapes) {
    const own = kindOf.get(s.elementId);
    let best = null;
    let bestArea = Infinity;
    for (const other of shapes) {
      if (other === s) continue;
      const kind = kindOf.get(other.elementId);
      if (!CONTAINERS.has(kind)) continue;
      // Контейнер всегда БОЛЬШЕ того, что в нём лежит. Без этого правила
      // геометрическая вложенность даёт петлю: центр узла попадает внутрь
      // компонента, который сам лежит в этом узле (5106), и выгрузка уходит в
      // бесконечную рекурсию.
      if (other.w * other.h <= s.w * s.h) continue;
      if (!inside(s, other)) continue;
      const area = other.w * other.h;
      if (area < bestArea) { bestArea = area; best = other; }
    }
    if (best && kindOf.get(best.elementId) !== own) parent.set(s.id, best.id);
  }
  return parent;
}

/* ------------------------------------------------------------- members */

function memberLine(row) {
  const vis = { public: '+', private: '-', protected: '#', package: '~' }[row.vis] ?? '+';
  const parts = [vis];
  if (row.isStatic) parts.push('{static}');
  // BehavioralFeature::isAbstract: PlantUML's own member marker. Only an
  // operation can carry it — Property has no isAbstract in UML — so a stray
  // flag on an attribute row would be a bug upstream and is not written.
  if (row.isAbstract && /\(/.test(isStr(row.name) ? row.name : '')) parts.push('{abstract} ');
  if (row.isDerived) parts.push('/');
  parts.push(isStr(row.name) ? row.name : '');
  if (isStr(row.type)) parts.push(` : ${oneLine(row.type)}`);
  if (isStr(row.default)) parts.push(` = ${oneLine(row.default)}`);
  if (row.isID) parts.push(' {id}');
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function slotLine(row) {
  const vis = { public: '+', private: '-', protected: '#', package: '~' }[row.vis] ?? '+';
  const name = isStr(row.name) ? row.name : '';
  const value = isStr(row.default) ? ` = ${oneLine(row.default)}` : '';
  const type = isStr(row.type) ? ` : ${oneLine(row.type)}` : '';
  return `${vis}${name}${type}${value}`;
}

/* ----------------------------------------------------------------- plan */

/**
 * The structured plan of one diagram.
 *
 * @param {object} model a `uml-model/3` document
 * @param {object} diagram one entry of `model.diagrams`
 * @param {object} [opts] `{ allowMixing: boolean }`
 * @returns {{family:string, lines:string[], decls:object[], relations:object[],
 *            notes:string[], warnings:string[]}}
 */
export function plan(model, diagram, opts = {}) {
  const kind = diagram?.kind ?? 'class';
  const elements = model.elements ?? [];
  const byId = new Map(elements.map((e) => [e.id, e]));
  const onDiagram = new Set((diagram.shapes ?? []).map((s) => s.elementId));
  const shown = elements.filter((e) => onDiagram.has(e.id));

  const family = familyOf(shown, kind);
  const warnings = [];
  const decls = [];
  const lines = [];
  const relations = [];

  const ctx = {
    model, diagram, byId, opts, warnings, decls, lines, relations,
    aliases: new Map(elements.map((e, i) => [e.id, aliasOf(e, i)])),
    mixed: family === 'structural' && needsMixing(shown),
    names: new Map(),
  };
  if (ctx.mixed) assignNames(ctx, shown);

  if (family === 'sequence') emitSequence(ctx, shown);
  else if (family === 'activity') emitActivity(ctx, shown);
  else if (family === 'state') emitState(ctx, shown);
  else emitStructural(ctx, shown);

  return {
    family,
    lines,
    decls,
    relations,
    warnings,
    allowMixing: family === 'structural' && needsMixing(shown),
  };
}

/** Which PlantUML command family the diagram's shapes belong to. */
export function familyOf(elements, diagramKind = 'class') {
  const kinds = new Set(elements.map((e) => e.kind));
  if ([...kinds].some((k) => SEQUENCE_KINDS.has(k))) return 'sequence';
  if ([...kinds].some((k) => ACTIVITY_KINDS.has(k))) return 'activity';
  if ([...kinds].some((k) => STATE_KINDS.has(k))) return 'state';
  if (diagramKind === 'state') return 'state';
  if (diagramKind === 'activity') return 'activity';
  if (diagramKind === 'sequence' || diagramKind === 'timing'
    || diagramKind === 'interaction-overview') return 'sequence';
  return 'structural';
}

function needsMixing(elements) {
  const kinds = new Set(elements.map((e) => e.kind));
  const classSide = [...kinds].some((k) => CLASS_ONLY.has(k));
  const descSide = [...kinds].some((k) => DESC_ONLY.has(k));
  return classSide && descSide;
}

/* ----------------------------------------------------------- structural */

function emitStructural(ctx, shown) {
  const { model, diagram, byId, lines, decls } = ctx;
  const parent = parentsOf(model, diagram);
  const shapeOf = (el) => (diagram.shapes ?? []).find((s) => s.elementId === el.id);
  const inOrder = [...shown].sort(
    (a, b) => (diagram.shapes ?? []).findIndex((s) => s.elementId === a.id)
      - (diagram.shapes ?? []).findIndex((s) => s.elementId === b.id),
  );

  /** Emit one element and, inside its braces, everything geometry put in it. */
  const emitOne = (el, indent) => {
    const alias = ctx.aliases.get(el.id);
    const def = STRUCT[el.kind] ?? { kw: 'class' };
    const body = [];
    const own = shapeOf(el);
    const childEls = own
      ? inOrder.filter((kid) => parent.get(shapeOf(kid)?.id) === own.id)
      : [];

    const stereo = isStr(el.stereotype) ? el.stereotype : (def.stereo ?? '');
    const head = header(ctx, el, alias, def, stereo);
    if (el.abstract === true && !head.startsWith('abstract ')) {
      ctx.warnings.push(`«${displayOf(el) || el.kind}» абстрактен, но PlantUML 1.2021 пишет abstract `
        + 'только в семействе классов — флаг в тексте не выражен');
    }

    if (el.kind === 'note' || el.kind === 'text') {
      const text = oneLine(el.documentation || el.name || '');
      lines.push(`note as ${alias}${stereo ? ` <<${stereo}>>` : ''}`);
      for (const l of String(text || ' ').split(/\r?\n/)) lines.push(l || ' ');
      lines.push('end note');
      commentLines(alias, el, lines);
      decls.push({ alias, elementId: el.id, kind: el.kind, name: displayOf(el) || text, counted: true, container: false });
      return;
    }

    for (const row of el.attributes ?? []) body.push(memberLine(row));
    for (const row of el.operations ?? []) body.push(memberLine(row));
    for (const row of el.literals ?? []) body.push(String(row.name ?? '').trim() || ' ');
    for (const row of el.slots ?? []) body.push(slotLine(row));
    for (const l of el.extensionPoints ?? []) body.push(`extension point: ${oneLine(l)}`);
    for (const f of ['entry', 'do', 'exit']) {
      for (const l of el[f] ?? []) body.push(`${f} / ${oneLine(l)}`);
    }

    const hasKids = childEls.length > 0;
    const container = Boolean(def.container) && hasKids;
    const ref = ctx.mixed ? mixedRef(ctx, el, alias) : alias;
    // В семействе описаний тела у фигур нет: члены там не разбираются.
    // В смешанной диаграмме (семейство class) кавычное имя тоже не принимает
    // тело, зато принимает команду «имя : член». В чисто описательной
    // диаграмме члены остаются только комментарием.
    const bodyInBraces = !DESC_ONLY.has(el.kind) && !ctx.mixed;

    if (ctx.mixed) {
      if (container) {
        lines.push(`${head} {`);
        for (const kid of childEls) emitOne(kid, indent + 1);
        lines.push('}');
      } else {
        lines.push(head);
      }
      for (const b of body) lines.push(`${ref} : ${b}`);
      if (body.length) {
        ctx.warnings.push(`члены «${displayOf(el) || el.kind}» выгружены строками «имя : член»`);
      }
    } else if (DESC_ONLY.has(el.kind) && body.length) {
      lines.push(head);
      for (const b of body) lines.push(`' member ${alias}: ${b}`);
      ctx.warnings.push(`члены «${displayOf(el) || el.kind}»: семейство описаний их не разбирает — сохранены комментарием`);
      if (container) for (const kid of childEls) emitOne(kid, indent + 1);
    } else if (container || (bodyInBraces && body.length)) {
      lines.push(head + ' {');
      for (const b of body) lines.push(`  ${b}`);
      for (const kid of childEls) emitOne(kid, indent + 1);
      lines.push('}');
    } else {
      lines.push(head);
    }
    commentLines(alias, el, lines);
    decls.push({
      alias, elementId: el.id, kind: el.kind,
      // Заметка показывает не имя, а текст: именно он и должен найтись в SVG.
      name: (el.kind === 'note' || el.kind === 'text')
        ? oneLine(el.documentation || el.name)
        : shownName(ctx, el),
      counted: !container, container,
    });
  };

  // Top level: shapes with no container parent, in model order.
  for (const el of inOrder) {
    const shape = shapeOf(el);
    if (shape && parent.has(shape.id)) continue;
    emitOne(el, 0);
  }
  // Anything geometry left orphaned (a parent that is not on this diagram).
  for (const el of inOrder) {
    if (decls.some((d) => d.elementId === el.id)) continue;
    emitOne(el, 0);
  }

  emitStructuralLinks(ctx, shown);
}

/**
 * The declaration line. Three orders exist and they are not interchangeable:
 * class and object take `alias as "Name"`, package takes `"Name" as alias`
 * (`CommandPackage` reads the quoted name first), and a mixed file takes the
 * quoted name alone for the description-family shapes.
 */
function header(ctx, el, alias, def, stereo) {
  // `port` в смешанной диаграмме (семейство class) валит отрисовку — GraphViz
  // падает на кластере без родителя. Поэтому там порт становится классом со
  // стереотипом `port`.
  const kw = ctx.mixed && el.kind === 'port' ? 'class' : def.kw;
  // `abstract` is a class-family keyword only: PlantUML 1.2021 rejects
  // `abstract actor` / `abstract usecase` (checked on the jar — syntax error in
  // the description family), so abstractness of everything else is reported
  // instead of written. Every kind that prints as `class` can carry it.
  const abs = el.abstract === true && kw === 'class';
  const kwText = abs ? `abstract ${kw}` : kw;
  const st = stereo ? ` <<${stereo}>>` : (ctx.mixed && el.kind === 'port' ? ' <<port>>' : '');
  const text = displayedFor(ctx, el);
  if (ctx.mixed) {
    return `${kwText} ${mixedRef(ctx, el, alias)}${st}`;
  }
  if (def.displayFirst) {
    return text ? `${kwText} "${text}" as ${alias}${st}` : `${kwText} ${alias}${st}`;
  }
  if (def.objectOrder) {
    return text ? `${kw} "${text}" as ${alias}${st}` : `${kw} ${alias}${st}`;
  }
  if (el.templateParameters?.length) {
    const params = el.templateParameters.map((p) => String(p)).join(', ');
    return `${kwText} ${alias} as "${text || alias}<${params}>"${st}`;
  }
  return `${kwText} ${declared(alias, text)}${st}`;
}

/* -------------------------------------------------------- relationships */

const ARROWS = {
  association: '--',
  aggregation: 'o--',
  composition: '*--',
  generalization: '--|>',
  realization: '..|>',
  dependency: '..>',
  usage: '..>',
  import: '..>',
  merge: '..>',
  include: '..>',
  extend: '..>',
  assembly: '--()',
  delegation: '-->',
  connector: '--',
  link: '--',
  deployment: '..>',
  communicationPath: '--',
  manifest: '..>',
  trace: '..>',
  extension: '--|>',
};

/** Keyword written into the label for the UML dependencies that carry one. */
const KEYWORDS = {
  usage: 'use', import: 'import', merge: 'merge', include: 'include', extend: 'extend',
  deployment: 'deploy', manifest: 'manifest', trace: 'trace', assembly: null,
};

/**
 * The arrow for one relationship: the connector kind fixes the decoration,
 * `navigable` decides where the open head goes.
 *
 * The head never moves an operand. `{a} <-- {b}` and `{b} --> {a}` draw the
 * same line, but the quoted slots that carry the multiplicities belong to the
 * operands, so swapping the ends to get a head on the left would move both
 * multiplicities to the wrong class. PlantUML takes `<--` as it is (checked on
 * the jar: the head is drawn at `a` and `1` stays by `a`), so nothing is
 * swapped.
 *
 * PlantUML allows ONE decoration per end, so a head cannot share an end with
 * an aggregation diamond. There the diamond is kept — it is the relationship's
 * kind — and the head that has nowhere to go is dropped and reported.
 */
export function arrowOf(rel) {
  const base = ARROWS[rel.kind] ?? '--';
  const nav = rel.navigable ?? 'none';
  if (base === '--') {
    if (nav === 'from') return '-->';
    if (nav === 'to') return '<--';
    // `<-->` is the line PlantUML draws for "both ends" (one head drawn per
    // end), but `parse()` in app/src/io/plantuml.js has no `<-->` in its
    // ARROW_FORMS and reads the line as an end called `> b`. Writing it would
    // hand the importer a ghost class, so the arrow is left off and reported.
    return base;
  }
  if (base === 'o--' || base === '*--') {
    // `o-->` is the only place a head fits next to a diamond at `from`.
    return nav === 'from' ? `${base}>` : base;
  }
  return base;
}

/** Heads that the text cannot carry — said out loud, never hidden. */
export function droppedHeads(rel) {
  const base = ARROWS[rel.kind] ?? '--';
  const nav = rel.navigable ?? 'none';
  if (base === '--') {
    return nav === 'both'
      ? 'навигация «в обе стороны» (`<-->`) не выгружена: импорт эту форму пока не читает'
      : '';
  }
  if (base === 'o--' || base === '*--') {
    if (nav === 'to') return 'стрелка у конца с ромбом не выражается — навигация потеряна';
    if (nav === 'both') return 'стрелка у конца с ромбом не выражается — навигация «в обе стороны» не выгружена';
  }
  return '';
}

/** Multiplicity of one end, quoted — PlantUML has no other way to say it. */
const mult = (v) => (isStr(v) ? ` "${String(v).replace(/"/g, '')}"` : '');

/**
 * `{complete, disjoint}` of a generalization set, as UML prints it. PlantUML
 * cannot group several arrows into one set, so the constraint goes into each
 * arrow's label — the text survives, the grouping does not.
 */
function setLabel(model, rel) {
  if (rel.kind !== 'generalization' || !rel.setId) return '';
  const set = (model.generalizationSets ?? []).find((s) => s.id === rel.setId);
  if (!set) return '';
  const parts = [];
  if (set.covering) parts.push('complete');
  if (set.disjoint) parts.push('disjoint');
  if (!parts.length) return set.name ? `{${oneLine(set.name)}}` : '';
  return `{${parts.join(', ')}}`;
}

function labelOf(rel, model) {
  const parts = [];
  const set = model ? setLabel(model, rel) : '';
  if (set) parts.push(set);
  const kw = KEYWORDS[rel.kind];
  if (kw) parts.push(`<<${kw}>>`);
  if (isStr(rel.stereotype) && !kw) parts.push(`<<${rel.stereotype}>>`);
  if (isStr(rel.name)) parts.push(oneLine(rel.name));
  if (isStr(rel.fromRole) || isStr(rel.toRole)) {
    // PlantUML keeps one quoted slot per end and it is the multiplicity there,
    // so the pole names go into the label instead of the ends.
    const from = isStr(rel.fromRole) ? rel.fromRole : '·';
    const to = isStr(rel.toRole) ? rel.toRole : '·';
    parts.push(`${from} → ${to}`);
  }
  return parts.join(' ');
}

function emitStructuralLinks(ctx, shown) {
  const { model, diagram, relations, lines } = ctx;
  const onDiagram = new Set(shown.map((e) => e.id));
  const links = diagram.links ?? [];
  const hasView = new Set(links.map((l) => l.relId));
  const anyView = new Set();
  for (const d of model.diagrams ?? []) for (const l of d.links ?? []) anyView.add(l.relId);
  for (const rel of model.relationships ?? []) {
    if (ACTIVITY_CONNECTORS.has(rel.kind)) continue;
    if (rel.kind === 'transition') continue;
    const from = ctx.byId.get(rel.from);
    const to = ctx.byId.get(rel.to);
    if (!from || !to || !onDiagram.has(rel.from) || !onDiagram.has(rel.to)) continue;
    const shownHere = hasView.has(rel.id);
    if (!shownHere && anyView.has(rel.id)) continue;
    const a = ctx.mixed ? mixedRef(ctx, from, ctx.aliases.get(rel.from)) : ctx.aliases.get(rel.from);
    const b = ctx.mixed ? mixedRef(ctx, to, ctx.aliases.get(rel.to)) : ctx.aliases.get(rel.to);
    // В диаграмме коммуникации сообщения рисуются линиями со стрелкой и
    // номером; имени вида связи у такой линии нет.
    const arrow = rel.kind === 'message' || rel.kind === 'reply'
      ? (rel.kind === 'reply' ? '<--' : '-->') : arrowOf(rel);
    let line;
    if (rel.kind === 'assembly') {
      // Болл — на конце `to`, гнездо — на конце `from`, поэтому порядок обратный.
      line = `${b} ${arrow} ${a}`;
    } else {
      line = `${a}${mult(rel.fromMultiplicity)} ${arrow}${mult(rel.toMultiplicity)} ${b}`;
    }
    const lost = droppedHeads(rel);
    if (lost) ctx.warnings.push(`${displayOf(from)} — ${displayOf(to)}: ${lost}`);
    const label = labelOf(rel, ctx.model);
    if (label) line += ` : ${label}`;
    lines.push(line);
    relations.push({ id: rel.id, kind: rel.kind, line });
  }
}

/* ------------------------------------------------------------ sequence */

function emitSequence(ctx, shown) {
  const { model, diagram, byId, lines, decls, relations, warnings } = ctx;
  // `messageNumbers` — the editor's switch over the message numbering; the
  // vertical order stays the source of the order either way.
  if (model.messageNumbers === true) lines.push('autonumber');
  const lifelines = shown.filter((e) => e.kind === 'lifeline' || e.kind === 'actorLifeline');

  // Диаграммы таймингов: своей формы в PlantUML нет. Дорожка становится
  // участником, её шкала — заметкой со списком состояний.
  for (const el of shown.filter((e) => e.kind === 'timingLane')) {
    const alias = ctx.aliases.get(el.id);
    const states = (el.timeline ?? []).map((t) => `${oneLine(t.state)}: ${t.from}–${t.to}`).join('; ');
    lines.push(`participant ${declared(alias, displayOf(el))}`);
    if (states) lines.push(`note over ${alias} : ${states}`);
    decls.push({
      alias, elementId: el.id, kind: el.kind, name: displayOf(el),
      counted: true, container: false, participant: true,
    });
  }
  for (const el of lifelines) {
    const alias = ctx.aliases.get(el.id);
    const kw = el.kind === 'actorLifeline' ? 'actor' : (el.multiObject ? 'collections' : 'participant');
    // `participant A as "dao" <<interface>>` is what PlantUML draws (checked on
    // the jar: `-syntax` accepts it and «interface» reaches the SVG), and
    // `parse()` reads it back into `el.stereotype`.
    const st = isStr(el.stereotype) ? ` <<${el.stereotype}>>` : '';
    lines.push(`${kw} ${declared(alias, displayOf(el))}${st}`);
    if (isStr(el.classifier)) lines.push(`' classifier ${alias}: ${oneLine(el.classifier)}`);
    decls.push({
      alias, elementId: el.id, kind: el.kind, name: displayOf(el),
      counted: true, container: false, participant: true,
    });
  }

  // Message order is the vertical order of the link views, not model order.
  const links = diagram.links ?? [];
  const linkOf = new Map();
  for (const l of links) if (!linkOf.has(l.relId)) linkOf.set(l.relId, l);
  const messages = (model.relationships ?? [])
    .filter((r) => SEQUENCE_CONNECTORS.has(r.kind))
    .filter((r) => ctx.aliases.has(r.from) && ctx.aliases.has(r.to))
    .map((r, i) => ({ r, y: linkOf.get(r.id)?.y ?? null, i }))
    .filter((m) => m.y != null)
    .sort((a, b) => (a.y - b.y) || (a.i - b.i));
  if (messages.length !== (model.relationships ?? []).filter((r) => SEQUENCE_CONNECTORS.has(r.kind)).length) {
    warnings.push('у части сообщений нет вида на этой диаграмме — они не выгружены');
  }

  // Обзор взаимодействий: кадр взаимодействия — ссылка `ref over` на
  // участников, которые под ним по горизонтали.
  for (const el of shown.filter((e) => e.kind === 'interaction')) {
    const shape = (diagram.shapes ?? []).find((s) => s.elementId === el.id);
    if (!shape) continue;
    const inside = lifelines.filter((l) => {
      const s2 = (diagram.shapes ?? []).find((x) => x.elementId === l.id);
      if (!s2) return false;
      const mid = s2.x + Math.min(s2.w, 20) / 2;
      return mid >= shape.x && mid <= shape.x + shape.w;
    });
    const parts = (inside.length ? inside : lifelines.slice(0, 2)).map((e) => ctx.aliases.get(e.id));
    lines.push(`ref over ${parts.join(', ')} : ${oneLine(el.name) || el.kind}`);
    decls.push({
      alias: ctx.aliases.get(el.id), elementId: el.id, kind: el.kind,
      name: oneLine(el.name), counted: false, container: true,
    });
  }

  const frames = shown
    .filter((e) => e.kind === 'fragment' || e.kind === 'interactionUse')
    .map((e) => {
      const shape = (diagram.shapes ?? []).find((s) => s.elementId === e.id);
      return { el: e, shape, first: Infinity, last: -1 };
    })
    .filter((f) => f.shape)
    .sort((a, b) => a.shape.y - b.shape.y);

  messages.forEach((m, index) => {
    const y = m.y;
    for (const f of frames) {
      if (y >= f.shape.y && y <= f.shape.y + f.shape.h) {
        f.first = Math.min(f.first, index);
        f.last = Math.max(f.last, index);
      }
    }
  });

  // Outer frames open first: sort by area, largest first, so nesting is stable.
  const opened = [];
  const openFrame = (f) => {
    const alias = ctx.aliases.get(f.el.id);
    if (f.el.kind === 'interactionUse') {
      const parts = participantsUnder(diagram, lifelines, f.shape).map((e) => ctx.aliases.get(e.id));
      const ref = oneLine(f.el.refersTo || f.el.name || 'ref');
      lines.push(`ref over ${parts.join(', ')} : ${ref}`);
      opened.push({ ...f, inline: true });
      decls.push({ alias, elementId: f.el.id, kind: f.el.kind, name: ref, counted: false, container: false });
      return;
    }
    const op = (f.el.operator || 'opt').trim();
    const conditions = String(f.el.name ?? '').split(' / ').map(guardText);
    lines.push(`${op}${conditions[0] ? ` ${conditions[0]}` : ''}`);
    opened.push({ ...f, conditions });
    decls.push({
      alias, elementId: f.el.id, kind: f.el.kind,
      name: conditions.map((c) => oneLine(c)).filter(Boolean)[0] ?? '',
      counted: false, container: false,
    });
  };
  const closeFrame = (f) => {
    if (f.inline) return;
    // Операнды после первого: PlantUML пишет `else` на каждый.
    for (const c of f.conditions.slice(1)) lines.push(c ? `else ${c}` : 'else');
    lines.push('end');
  };

  let cursor = 0;
  const closeDownTo = (index) => {
    while (opened.length && opened[opened.length - 1].last < index) closeFrame(opened.pop());
  };

  messages.forEach((m, index) => {
    closeDownTo(index);
    let guard = 0;
    while (cursor < frames.length && frames[cursor].first === index && guard++ < 1000) {
      openFrame(frames[cursor]);
      cursor += 1;
    }
    emitMessage(ctx, m.r, byId, lines, relations);
  });
  closeDownTo(messages.length + 1);

  for (const f of frames) {
    if (f.first === Infinity) {
      warnings.push(`рамка «${f.el.name || f.el.id}» не накрывает ни одного сообщения — выгружена комментарием`);
      lines.push(`' frame ${ctx.aliases.get(f.el.id)}: ${oneLine(f.el.name)} (${f.el.operator || 'opt'})`);
      decls.push({ alias: ctx.aliases.get(f.el.id), elementId: f.el.id, kind: f.el.kind, name: '', counted: false, container: true });
    }
  }
}

function participantsUnder(diagram, lifelines, frame) {
  const picked = lifelines.filter((el) => {
    const s = (diagram.shapes ?? []).find((x) => x.elementId === el.id);
    if (!s) return false;
    const mid = s.x + Math.min(s.w, 20) / 2;
    return mid >= frame.x && mid <= frame.x + frame.w;
  });
  return picked.length ? picked : lifelines.slice(0, 2);
}

function emitMessage(ctx, rel, byId, lines, relations) {
  const a = ctx.aliases.get(rel.from);
  const b = ctx.aliases.get(rel.to);
  const text = oneLine(rel.name);
  const async = rel.asynchronous === true;
  let line;
  switch (rel.kind) {
    case 'reply': line = `${a} --> ${b}`; break;
    case 'createMessage': line = `${a} -> ${b}`; break;
    case 'destroyMessage': line = `${a} -> ${b}`; break;
    default: line = async ? `${a} ->> ${b}` : `${a} -> ${b}`;
  }
  if (rel.kind === 'createMessage') lines.push(`create ${b}`);
  lines.push(`${line} : ${text || ' '}`);
  if (rel.kind === 'destroyMessage') lines.push(`destroy ${b}`);
  relations.push({ id: rel.id, kind: rel.kind, line });
}

/* ------------------------------------------------------------ activity */

function emitActivity(ctx, shown) {
  const { model, diagram, byId, lines, decls, warnings } = ctx;
  const lanes = shown.filter((e) => e.kind === 'swimlane');
  // Swimlanes must be declared before the first statement.
  for (const lane of lanes) {
    lines.push(`|${oneLine(lane.name)}|`);
    decls.push({
      alias: ctx.aliases.get(lane.id), elementId: lane.id, kind: lane.kind,
      name: oneLine(lane.name), counted: false, container: true,
    });
  }

  const nodes = shown.filter((e) => e.kind !== 'swimlane' && e.kind !== 'note');
  const edges = (model.relationships ?? [])
    .filter((r) => ACTIVITY_CONNECTORS.has(r.kind))
    .filter((r) => byId.has(r.from) && byId.has(r.to));
  const out = new Map();
  const into = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
    if (!into.has(e.to)) into.set(e.to, []);
    into.get(e.to).push(e);
  }
  const successors = (id) => out.get(id) ?? [];

  const laneOf = (el) => {
    if (isStr(el.lane)) return byId.get(el.lane)?.name ?? null;
    const shape = (diagram.shapes ?? []).find((s) => s.elementId === el.id);
    if (!shape) return null;
    const holder = shown.filter((x) => x.kind === 'swimlane').map((x) => ({
      x, s: (diagram.shapes ?? []).find((s) => s.elementId === x.id),
    })).filter((h) => h.s).find((h) => inside(shape, h.s));
    return holder ? holder.x.name : null;
  };

  const nameOf = (el) => oneLine(el.name) || el.kind;
  const decl = (el) => decls.push({
    alias: ctx.aliases.get(el.id), elementId: el.id, kind: el.kind,
    // `initial`/`final` draw as circles and an unnamed node draws its kind, so
    // neither has a name to look for in the SVG.
    name: (el.kind === 'initial' || el.kind === 'final') ? ''
      : (isStr(el.name) ? oneLine(el.name)
        : (el.kind === 'note' ? oneLine(el.documentation) : '')),
    counted: false, container: false,
  });
  const laneLine = (el) => {
    const lane = laneOf(el);
    if (lane && lane !== ctx.__lane) { ctx.__lane = lane; lines.push(`|${oneLine(lane)}|`); }
  };

  // A cycle cannot be written with nesting, so such a graph falls back to a
  // flat chain; a merge can — the shared tail is simply written twice.
  if (hasCycle(nodes, out)) {
    warnings.push('в графе деятельности есть цикл: выгрузка плоской цепью с подписями переходов');
    emitActivityFlat(ctx, nodes, out, into, { nameOf, decl, laneLine });
    return;
  }

  const times = new Map();
  let startDone = false;
  const walkChain = (startId) => {
    let id = startId;
    while (id) {
      const el = byId.get(id);
      if (!el) return;
      const next = successors(id);
      const terminal = next.length === 0 || el.kind === 'final';
      const seen = times.get(id) ?? 0;
      if (seen >= 2 && !terminal) return;          // already repeated once
      if (seen === 1) warnings.push(`узел «${nameOf(el)}» накрыт двумя ветвями — повторён`);
      times.set(id, seen + 1);
      laneLine(el);
      decl(el);

      if (el.kind === 'initial') {
        if (!startDone) { lines.push('start'); startDone = true; }
      } else if (el.kind === 'final') {
        lines.push('stop');
        return;
      } else if ((el.kind === 'decision' || el.kind === 'fork') && next.length >= 2) {
        // activity3 принимает только ОДИН `else` на `if` («Cannot find if» на
        // втором — проверено), поэтому ветвей больше двух пишем цепью
        // `else if (?) then (…)`.
        const fork = el.kind === 'fork';
        next.forEach((e, i) => {
          const label = oneLine(e.name) || `ветвь ${i + 1}`;
          if (fork) lines.push(i === 0 ? 'fork' : 'fork again');
          else if (i === 0) lines.push(`if (?) then (${label})`);
          else if (i < next.length - 1) lines.push(`else if (?) then (${label})`);
          else lines.push(`else (${label})`);
          walkChain(e.to);
        });
        lines.push(fork ? 'end fork' : 'endif');
        return;
      } else if (el.kind === 'merge' || el.kind === 'join') {
        // pass-through: nothing to draw
      } else {
        lines.push(`:${nameOf(el)};`);
      }

      if (terminal) return;
      if (next.length > 1) return;
      id = next[0].to;
    }
  };

  const starts = nodes.filter((e) => e.kind === 'initial');
  for (const s of starts) walkChain(s.id);
  for (const el of nodes) {
    if (!times.has(el.id)) {
      warnings.push(`узел «${nameOf(el)}» недостижим от начального — выгружен отдельной цепью`);
      walkChain(el.id);
    }
  }
  if (!startDone) lines.unshift('start');
  for (const el of shown.filter((e) => e.kind === 'note')) {
    lines.push(`note right : ${oneLine(el.documentation || el.name) || ' '}`);
    decl(el);
  }
}

/**
 * The fallback for a graph with a cycle: one depth-first chain, each edge as a
 * labelled arrow. The branching is lost, the nodes and labels are not.
 */
function emitActivityFlat(ctx, nodes, out, into, ui) {
  const { lines } = ctx;
  const order = walk(nodes, out, into);
  let startDone = false;
  for (const el of order) {
    ui.decl(el);
    ui.laneLine(el);
    if (el.kind === 'initial') {
      if (!startDone) { lines.push('start'); startDone = true; }
      continue;
    }
    if (el.kind === 'final') { lines.push('stop'); continue; }
    lines.push(`:${ui.nameOf(el)};`);
    for (const e of out.get(el.id) ?? []) {
      const label = oneLine(e.name);
      lines.push(label ? `-> ${label};` : '->;');
    }
  }
  if (!startDone) lines.unshift('start');
}

function hasCycle(nodes, out) {
  const state = new Map();
  let found = false;
  const visit = (id) => {
    if (found) return;
    const s = state.get(id) ?? 0;
    if (s === 1) { found = true; return; }
    if (s === 2) return;
    state.set(id, 1);
    for (const e of out.get(id) ?? []) visit(e.to);
    state.set(id, 2);
  };
  for (const n of nodes) visit(n.id);
  return found;
}

/** Start from the initial nodes, then from anything unreached, depth first. */
function walk(nodes, out, into) {
  const seen = new Set();
  const order = [];
  const visit = (el) => {
    if (!el || seen.has(el.id)) return;
    seen.add(el.id);
    order.push(el);
    for (const e of out.get(el.id) ?? []) visit(nodes.find((n) => n.id === e.to));
  };
  for (const n of nodes) if (n.kind === 'initial') visit(n);
  for (const n of nodes) if (!into.has(n.id) || (into.get(n.id).length === 0)) visit(n);
  for (const n of nodes) visit(n);
  return order;
}

/* --------------------------------------------------------------- state */

function emitState(ctx, shown) {
  const { model, diagram, byId, lines, decls, relations } = ctx;
  const parent = parentsOf(model, diagram);
  const shapeEl = new Map((diagram.shapes ?? []).map((s) => [s.id, s.elementId]));

  for (const el of shown) {
    if (el.kind === 'note' || el.kind === 'text') continue;
    const alias = ctx.aliases.get(el.id);
    const shape = (diagram.shapes ?? []).find((s) => s.elementId === el.id);
    const kids = shape ? [...parent.entries()].filter(([, p]) => p === shape.id).map(([c]) => shapeEl.get(c)) : [];
    if (el.kind === 'initial' || el.kind === 'final') {
      decls.push({ alias, elementId: el.id, kind: el.kind, name: '', counted: false, pseudo: el.kind, container: false });
      continue;
    }
    const st = STATE_KW[el.kind];
    if (st === null || st === undefined) {
      lines.push(`state ${declared(alias, displayOf(el))}`);
    } else {
      const stereo = st === 'history*' ? 'history*' : st;
      lines.push(`state ${declared(alias, displayOf(el))} <<${stereo}>>`);
    }
    decls.push({ alias, elementId: el.id, kind: el.kind, name: displayOf(el), counted: true, container: false });
    for (const f of ['entry', 'do', 'exit']) {
      for (const l of el[f] ?? []) lines.push(`${alias} : ${f} / ${oneLine(l)}`);
    }
    if (isStr(el.documentation)) lines.push(`' doc ${alias}: ${oneLine(el.documentation)}`);
    if (kids.length) ctx.warnings.push(`вложенные состояния «${el.name}» не выгружены`);
  }

  for (const el of shown.filter((e) => e.kind === 'note')) {
    const alias = ctx.aliases.get(el.id);
    lines.push(`note as ${alias}`);
    lines.push(oneLine(el.documentation || el.name) || ' ');
    lines.push('end note');
    decls.push({ alias, elementId: el.id, kind: el.kind, name: '', counted: true, container: false });
  }

  const anchors = new Map();
  const startAlias = '__start';
  const endAlias = '__end';
  const links = diagram.links ?? [];
  const linkOf = new Map();
  for (const l of links) if (!linkOf.has(l.relId)) linkOf.set(l.relId, l);
  const transitions = (model.relationships ?? []).filter((r) => r.kind === 'transition' || r.kind === 'message');
  for (const rel of transitions) {
    const fromEl = byId.get(rel.from);
    const toEl = byId.get(rel.to);
    if (!fromEl || !toEl) continue;
    const from = fromEl.kind === 'initial' ? `[*]` : ctx.aliases.get(rel.from);
    const to = toEl.kind === 'final' ? `[*]` : ctx.aliases.get(rel.to);
    const label = oneLine(rel.name);
    const line = `${from} --> ${to}${label ? ` : ${label}` : ''}`;
    lines.push(line);
    relations.push({ id: rel.id, kind: rel.kind, line });
  }
  void anchors; void startAlias; void endAlias; void linkOf;
}

/* ------------------------------------------------------------------ api */

/**
 * One diagram as PlantUML text.
 *
 * @param {object} model a `uml-model/3` document
 * @param {object} [opts] `{ diagramId?, title? }`
 * @returns {string} `@startuml` … `@enduml`, newline-terminated
 */
export function emit(model, opts = {}) {
  const diagrams = model.diagrams ?? [];
  const diagram = opts.diagramId
    ? diagrams.find((d) => d.id === opts.diagramId)
    : (diagrams.find((d) => d.id === model.currentDiagramId) ?? diagrams[0]);
  if (!diagram) throw new Error('в модели нет диаграмм');
  return emitDiagram(model, diagram, opts);
}

/**
 * One diagram of a model as PlantUML text.
 *
 * @param {object} model a `uml-model/3` document
 * @param {object} diagram one entry of `model.diagrams`
 * @param {object} [opts] `{ title?: boolean }`
 * @returns {string} the `.puml` file contents
 */
export function emitDiagram(model, diagram, opts = {}) {
  const p = plan(model, diagram);
  const out = ['@startuml'];
  if (opts.title !== false) {
    const title = diagram.name || model.name || '';
    if (title) out.push(`title ${oneLine(title)}`);
  }
  if (p.allowMixing) out.push('allow_mixing');
  if (diagram.ownerElementId) {
    const owner = (model.elements ?? []).find((e) => e.id === diagram.ownerElementId);
    if (owner) out.push(`' вложенная диаграмма элемента: ${oneLine(owner.name)}`);
  }
  for (const l of p.warnings) out.push(`' ! ${l}`);
  out.push(...p.lines);
  out.push('@enduml');
  return out.join('\n') + '\n';
}

/**
 * Every diagram of the model, one `.puml` each, in model order.
 *
 * @param {object} model a `uml-model/3` document
 * @returns {Array<{id:string,name:string,kind:string,text:string}>}
 */
export function emitAll(model) {
  return (model.diagrams ?? []).map((d) => ({
    id: d.id, name: d.name, kind: d.kind, text: emitDiagram(model, d),
  }));
}

/**
 * How many entities PlantUML should report for a diagram, and why.
 *
 * @param {object} model a `uml-model/3` document
 * @param {object} diagram one entry of `model.diagrams`
 * @returns {{family:string,elements:number,containers:number,expected:number,
 *            notes:string[], plan:object}}
 */
export function expectedCount(model, diagram) {
  const p = plan(model, diagram);
  const notes = [];
  const shapes = new Set((diagram.shapes ?? []).map((s) => s.elementId));
  const elements = (model.elements ?? []).filter((e) => shapes.has(e.id)).length;
  let expected = 0;
  let containers = 0;
  if (p.family === 'structural') {
    for (const d of p.decls) {
      if (d.container) { containers += 1; continue; }
      expected += 1;
    }
  } else if (p.family === 'sequence') {
    expected = p.decls.filter((d) => d.participant).length;
  } else if (p.family === 'state') {
    for (const d of p.decls) if (!d.pseudo) expected += 1;
    const starts = p.decls.filter((d) => d.pseudo === 'initial').length;
    const ends = p.decls.filter((d) => d.pseudo === 'final').length;
    if (starts) expected += 1;
    if (ends) expected += 1;
    if (starts > 1) notes.push(`${starts}×[*] начала сливаются в один узел`);
    if (ends > 1) notes.push(`${ends}×[*] конца сливаются в один узел`);
  } else {
    notes.push('activity3 не сообщает число сущностей');
  }
  return { family: p.family, elements, containers, expected, notes, plan: p };
}
