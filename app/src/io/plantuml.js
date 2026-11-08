// PlantUML import: text → `uml-model/3`.
//
// The mirror of `material/plantuml-export/emit.mjs`: what `emit()` writes with
// an alias, `parse()` reads back into the same element; what it writes as an
// arrow, `parse()` reads back as the same relationship. The mapping is NOT
// guessed from the documentation — it is inverted from the export map
// (`material/plantuml-export/mapping.json`) and from the grammar extracted
// from `plantuml.jar` 1.2021.00 (`docs/plantuml-grammar.json`, 169
// constructions). Every branch below cites the construction it implements, so
// "what we support" is a list of ids, not a feeling.
//
//   parse(text, opts) → { model, warnings, frames }
//
// Pure: no DOM, no `app/`, no network, no Java. Deterministic: the same text
// gives the same model byte for byte — ids come from the aliases in the file
// when they exist, and from the declaration order when they do not.
//
// IMPORT TRANSFERS INFORMATION, NOT LAYOUT. Coordinates are not read (a .puml
// has none) and not invented here: `plantuml-layout.js#seed()` puts every
// shape on a predictable grid afterwards. This module produces `shapes: []`.
//
// Nothing unknown is fatal. A line that matches no construction goes into
// `warnings` as `{ line, text, reason }` and parsing continues: 90 % read is
// better than nothing, and the report says exactly what was lost.

/* ------------------------------------------------------------ vocabulary */

/**
 * Keyword → element kind. The inverse of `STRUCT` in emit.mjs; keywords that
 * are not ours (`entity`, `cloud`, `database`, …) map onto the closest shape
 * we have and are reported when the shape is not the same (`note` warns).
 */
const KIND_BY_KEYWORD = {
  class: 'class',
  interface: 'interface',
  enum: 'enumeration',
  enumeration: 'enumeration',
  annotation: 'class',
  namespace: 'package',
  'struct': 'class',
  abstract: 'class',
  entity: 'class',
  datatype: 'datatype',
  object: 'object',
  package: 'package',
  model: 'model',
  profile: 'profile',
  component: 'component',
  artifact: 'artifact',
  node: 'node',
  device: 'device',
  rectangle: 'systemBoundary',
  usecase: 'usecase',
  actor: 'actor',
  collaboration: 'collaboration',
  port: 'port',
  // PlantUML shapes with no exact UML counterpart here: kept, mapped, noted.
  cloud: 'component',
  folder: 'package',
  frame: 'systemBoundary',
  database: 'component',
  queue: 'component',
  storage: 'component',
  file: 'artifact',
  card: 'component',
  agent: 'component',
  boundary: 'systemBoundary',
  control: 'component',
  circle: 'usecase',
  diamond: 'class',
  collections: 'class',
  label: 'text',
};

/**
 * `<<stereotype>>` → a different kind, but only for the stereotypes the
 * exporter itself writes to mean "this kind is spelled with that keyword"
 * (`node … <<device>>` is a device, `package … <<model>>` is a model).
 * Anything else stays a stereotype on the element — a person's own
 * `<<entity>>` is a stereotype, not a Rob robustness kind.
 */
const KIND_BY_STEREO = {
  dataType: ['class', 'datatype'],
  model: ['package', 'model'],
  profile: ['package', 'profile'],
  'deployment spec': ['artifact', 'deploymentSpec'],
  device: ['node', 'device'],
  executionEnvironment: ['node', 'executionEnvironment'],
  part: ['class', 'part'],
  collaboration: ['usecase', 'collaboration'],
  // UML 2.5.1 §18.1.5: a use-case realization IS a collaboration, and the
  // corpus stores them as such. The export can only spell it this way.
  'usecase realization': ['usecase', 'collaboration'],
  use: ['class', 'collaborationUse'],
  stereotype: ['class', 'stereotype'],
  metaclass: ['class', 'metaclass'],
  subject: ['rectangle', 'systemBoundary'],
  text: ['note', 'text'],
};

/**
 * The stereotype a SHAPE draws by itself (`notation/uml.json#shapes[kind]
 * .stereotype`). Those are not copied onto the element: a device is drawn
 * «device» by its shape, so storing it would draw the word twice. Any other
 * stereotype is the person's own and is kept.
 */
const SHAPE_STEREOTYPE = {
  interface: 'interface',
  enumeration: 'enumeration',
  datatype: 'dataType',
  model: 'model',
  profile: 'profile',
  deploymentSpec: 'deployment spec',
  device: 'device',
  executionEnvironment: 'executionEnvironment',
  part: 'part',
  collaboration: 'collaboration',
  collaborationUse: 'use',
  stereotype: 'stereotype',
  metaclass: 'metaclass',
};

/** Stereotype → kind for the state family (`STATE_KW` in emit.mjs). */
const STATE_BY_STEREO = {
  choice: 'choice',
  junction: 'junction',
  history: 'historyShallow',
  'history*': 'historyDeep',
  entryPoint: 'entryPoint',
  exitPoint: 'exitPoint',
  end: 'terminate',
};

/** Kinds whose body holds members (the class family). */
const MEMBER_KINDS = new Set(['class', 'interface', 'enumeration', 'datatype', 'object',
  'part', 'stereotype', 'metaclass', 'collaborationUse', 'port']);

/** Combined-fragment operators (sequence grammar: `fragment-*`). */
const FRAGMENT_OPS = new Set(['alt', 'opt', 'loop', 'par', 'break', 'critical', 'group',
  'seq', 'strict', 'ignore', 'consider', 'assert', 'neg']);

/** Lines we knowingly drop, each with the reason the report gives. */
const IGNORED_PREFIXES = [
  ['skinparam', 'оформление: у нас своя тема'],
  ['skinparam', 'оформление'],
  ['!theme', 'тема PlantUML: у нас своя'],
  ['!include', 'препроцессор: файл не читается без сети'],
  ['!includeurl', 'препроцессор'],
  ['!define', 'препроцессор'],
  ['!definelong', 'препроцессор'],
  ['!if', 'препроцессор'],
  ['!else', 'препроцессор'],
  ['!endif', 'препроцессор'],
  ['!pragma', 'управление раскладкой'],
  ['sprite', 'растровая графика'],
  ['hide ', 'видимость частей фигуры'],
  ['show ', 'видимость частей фигуры'],
  ['scale ', 'масштаб листа'],
  ['together', 'управление раскладкой'],
  ['left to right direction', 'управление раскладкой'],
  ['top to bottom direction', 'управление раскладкой'],
  ['allowmixing', ''],
  ['allow_mixing', ''],
  ['set separator', 'оформление'],
  ['header', 'колонтитул'],
  ['footer', 'колонтитул'],
  ['legend', 'легенда'],
  ['newpage', 'разрыв страницы'],
  ['autonewpage', 'разрыв страницы'],
  ['caption', 'подпись'],
];

/* --------------------------------------------------------------- helpers */

const isStr = (v) => typeof v === 'string' && v.length > 0;
const oneLine = (v) => String(v ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();

/** "Text" → Text; leaves anything unquoted alone. Spanish quotes included: PlantUML accepts «». */
function unquote(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^["«“]([\s\S]*)["»”]$/);
  if (m) return m[1].replace(/""/g, '"').trim();
  return t;
}

const isQuoted = (s) => /^["«“][\s\S]*["»”]$/.test(String(s ?? '').trim());

/**
 * Split `a "1" -- "*" b : label` without touching text inside quotes.
 * Returns the line with every quoted run replaced by \u0000n\u0000 plus the
 * runs themselves, so the arrow can be found on a string with no names in it.
 */
function maskQuotes(line) {
  const parts = [];
  const masked = line.replace(/"([^"]*)"/g, (_, text) => {
    parts.push(text);
    return `\u0000${parts.length - 1}\u0000`;
  });
  return { masked, parts };
}

const unmask = (s, parts) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)] ?? '');

/**
 * Pull a trailing `<<stereotype>>` (PlantUML allows several; we keep the first
 * and report the rest) off a declaration tail.
 */
function takeStereotypes(rest) {
  const out = [];
  let text = String(rest ?? '');
  const re = /\s*<<\s*([^<>]+?)\s*>>\s*$/;
  for (;;) {
    const m = text.match(re);
    if (!m) break;
    out.unshift(m[1].trim());
    text = text.slice(0, m.index);
  }
  return { text: text.trim(), stereotypes: out };
}

/**
 * `{static}`, `{abstract}` … — flags written before or after a member. Only
 * these two are UML data. `{field}`/`{method}` are PlantUML's own compartment
 * markers: `Member.class` strips them before it reads the row
 * (member-field-method-marker in docs/plantuml-grammar.json), so they carry no
 * data and are dropped here too rather than stored. `{readonly}` is not in the
 * 1.2021 grammar and the model has no `isReadOnly` field, so it is dropped as
 * well — the parser used to keep it on the row, the file writer then wrote it
 * out as a stray key, and the reader dropped it again: a field that existed
 * only between two saves.
 */
function takeBraceFlags(text) {
  const flags = {};
  let s = String(text ?? '');
  const known = { static: 'isStatic', abstract: 'isAbstract', id: 'isID' };
  const stripped = new Set(['field', 'method', 'readonly']);
  s = s.replace(/\{\s*([a-zA-Z]+)\s*\}/g, (all, word) => {
    const w = word.toLowerCase();
    if (stripped.has(w)) return ' ';
    const key = known[w];
    if (!key) return all;                 // `{id}` is handled by the member parser
    flags[key] = true;
    return ' ';
  });
  return { text: s.replace(/\s+/g, ' ').trim(), flags };
}

const VIS_BY_SYMBOL = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };

/**
 * One member row of a class body. The exporter writes `+name : Type = default`
 * with no space after the sign (emit.mjs#memberLine), PlantUML's own examples
 * write `+ name`, and both are one row here.
 */
function parseMemberRow(raw) {
  let text = String(raw ?? '').trim();
  const flags = {};
  const braced = takeBraceFlags(text);
  text = braced.text;
  Object.assign(flags, braced.flags);

  let vis = 'public';
  if (text && VIS_BY_SYMBOL[text[0]]) {
    vis = VIS_BY_SYMBOL[text[0]];
    text = text.slice(1).trim();
  }
  if (text.startsWith('/')) {
    flags.isDerived = true;
    text = text.slice(1).trim();
  }
  if (/\{id\}\s*$/i.test(text)) {
    flags.isID = true;
    text = text.replace(/\{id\}\s*$/i, '').trim();
  }
  let def = '';
  const eq = text.lastIndexOf(' = ');
  if (eq > 0) {
    def = text.slice(eq + 3).trim();
    text = text.slice(0, eq).trim();
  }
  // The type is taken from the LAST colon OUTSIDE parentheses, so
  // `f(a : int) : bool` keeps its parameter list and splits only the return
  // type off (model.js#parseMemberLine takes the last colon and loses this).
  let name = text;
  let type = '';
  const colon = lastTopLevelColon(text);
  if (colon > 0) {
    name = text.slice(0, colon).trim();
    type = text.slice(colon + 1).trim();
  }
  const row = { vis, name: name.replace(/\s*:\s*$/, ''), type, default: def };
  for (const k of ['isStatic', 'isDerived', 'isID']) {
    if (flags[k]) row[k] = true;
  }
  // BehavioralFeature::isAbstract (§9.9.2) is an OPERATION flag: Property is a
  // StructuralFeature and has no isAbstract, so `{abstract}` on a row without
  // parentheses is consumed and dropped instead of inventing one.
  if (flags.isAbstract && isOperation(row)) row.isAbstract = true;
  return row;
}

/** Index of the last `:` that is not inside `( )` — the return-type colon. */
function lastTopLevelColon(text) {
  let depth = 0;
  let at = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) at = i;
  }
  return at;
}

/** Is a member row an operation? PlantUML has no marker: parentheses do. */
const isOperation = (row) => /\(/.test(row.name ?? '');

/* ------------------------------------------------------------- document */

/**
 * The reader. One instance per `parse()` call; keeps the alias table, the
 * warning list and the element/relationship lists being built.
 */
class Reader {
  constructor(opts = {}) {
    this.model = {
      schema: 'uml-model/3',
      id: 'imported',
      name: opts.fileName ? String(opts.fileName).replace(/\.[^.]+$/, '') : 'Импорт PlantUML',
      elements: [],
      relationships: [],
      generalizationSets: [],
      pictograms: true,
      diagrams: [],
      currentDiagramId: null,
    };
    this.warnings = [];
    this.frames = [];
    this.byAlias = new Map();
    this.byId = new Map();
    this.usedIds = new Set();
    this.seq = 0;
    this.relSeq = 0;
    this.pseudoSeq = 0;
    this.diagram = null;
    this.family = null;
    this.pendingLinks = [];
  }

  warn(line, text, reason) {
    this.warnings.push({ line, text: oneLine(text), reason });
  }

  /** A stable element id: the alias when it is free, else the next `eN`. */
  idFor(alias) {
    const clean = String(alias ?? '').replace(/[^A-Za-z0-9_.\-\u0400-\u04FF]/g, '_');
    if (clean && !this.usedIds.has(clean)) {
      this.usedIds.add(clean);
      return clean;
    }
    for (;;) {
      this.seq += 1;
      const id = `e${this.seq}`;
      if (!this.usedIds.has(id)) {
        this.usedIds.add(id);
        return id;
      }
    }
  }

  element(alias, kind, name = '', extra = {}) {
    const key = String(alias ?? '').trim();
    const known = key ? this.byAlias.get(key) : null;
    if (known) {
      // A second statement about the same alias adds to the element, never
      // replaces it (`class A` then `A : +x`).
      if (kind && known.kind !== kind) {
        this.warn(0, `${key} as ${kind}`, `уже объявлен как «${known.kind}» — оставлен первый вид`);
      }
      return known;
    }
    const el = {
      id: this.idFor(key),
      kind,
      name: name ?? '',
      stereotype: extra.stereotype ?? null,
      documentation: '',
      taggedValues: [],
      ...extra,
    };
    if (!isStr(el.stereotype)) el.stereotype = null;
    this.model.elements.push(el);
    this.byId.set(el.id, el);
    if (key) this.byAlias.set(key, el);
    return el;
  }

  /** A pseudostate with no alias in the text: `[*]`, initial, final. */
  pseudo(kind, extra = {}) {
    for (;;) {
      this.pseudoSeq += 1;
      const id = `p${this.pseudoSeq}`;
      if (this.usedIds.has(id)) continue;
      this.usedIds.add(id);
      const el = { id, kind, name: '', stereotype: null, documentation: '', taggedValues: [], ...extra };
      this.model.elements.push(el);
      this.byId.set(id, el);
      return el;
    }
  }

  relationship(kind, from, to, extra = {}) {
    this.relSeq += 1;
    const rel = {
      id: `r${this.relSeq}`,
      kind,
      name: '',
      stereotype: null,
      documentation: '',
      taggedValues: [],
      from: from?.id ?? from,
      to: to?.id ?? to,
      navigable: 'none',
      ...extra,
    };
    this.model.relationships.push(rel);
    if (this.diagram) {
      this.pendingLinks.push({ rel, from: rel.from, to: rel.to, kind: this.family });
    }
    return rel;
  }

  newDiagram(name, kind) {
    const d = {
      id: `d${this.model.diagrams.length + 1}`,
      name: name || 'Диаграмма',
      kind,
      shapes: [],
      links: [],
    };
    this.model.diagrams.push(d);
    this.model.currentDiagramId = d.id;
    this.diagram = d;
    this.family = kind;
    return d;
  }
}

/* ------------------------------------------------------- block splitting */

const START = /^\s*@startuml\b\s*(.*)$/i;
const END = /^\s*@enduml\b\s*$/i;

/** Split a file into `@startuml`…`@enduml` blocks. No marker → one block. */
function blocksOf(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const start = line.match(START);
    if (start) {
      cur = { startLine: i + 1, lines: [], caption: start[1].trim() };
      continue;
    }
    if (END.test(line)) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.lines.push({ text: line, no: i + 1 });
    else if (line.trim() && !/^\s*'/.test(line)) {
      // Text outside a block: PlantUML ignores it; we keep it as a block of
      // its own only when the file has no markers at all.
      if (!lines.some((l) => START.test(l))) {
        if (!out.length) out.push({ startLine: 1, lines: [], caption: '' });
        out[0].lines.push({ text: line, no: i + 1 });
      }
    }
  }
  if (cur) {
    // Unterminated block: read what is there and say so.
    cur.unterminated = true;
    out.push(cur);
  }
  if (!out.length) out.push({ startLine: 1, lines: lines.map((l, i) => ({ text: l, no: i + 1 })), caption: '' });
  return out;
}

/* ------------------------------------------------------ family detection */

// `actor Bob` alone is NOT a sequence hint: a use-case diagram declares actors
// too, and taking them for lifelines turned 3101–3201 into sequence sheets.
// Sequence is recognised by participants, messages and frames instead.
const SEQ_HINT = /^(participant|boundary|control|entity|queue|database|collections\b|activate\b|deactivate\b|autonumber|destroy\s|create\s|ref\s+over)/i;
// A message needs a HEADED arrow (`->`, `->>`, `-->`, `<-`). A bare `a -- b :
// label` is an association with a label — reading it as a message turned the
// deployment diagram 5106 into a sequence sheet.
const SEQ_MESSAGE = /^\S+\s*(<--|-->|->>|->|<-)\s*\S+\s*:/;
// `else` and `end` are NOT activity signals on their own: `else` belongs to a
// sequence fragment too, and `end` closes it. Only constructs that exist in
// activity only are counted.
const ACT_START = /^(start;?$|stop;?$|detach$|kill$|:.*|#[\w;-]+\s*:|if\s*\(|elseif\b|while\s*\(|endwhile|repeat\b|fork\b|fork\s+again|end\s+fork|split\b|end\s*split|-\[#|\[\[|swimlane\s|->|\|[^|]+\|$)/;

/** Which family a block belongs to. First hit wins; the order is deliberate. */
function familyOfBlock(lines) {
  let seqScore = 0;
  let actScore = 0;
  let stateScore = 0;
  let structScore = 0;
  for (const { text } of lines) {
    const t = text.trim();
    if (!t || t.startsWith("'")) continue;
    if (/^\[\*\]/.test(t) || /^state\b/.test(t)) { stateScore += 2; continue; }
    if (SEQ_HINT.test(t)) { seqScore += 2; continue; }
    if (/^alt\b|^opt\b|^loop\b|^par\b|^break\b|^critical\b|^group\b/i.test(t)) { seqScore += 1; continue; }
    if (ACT_START.test(t)) { actScore += 2; continue; }
    if (/^:/i.test(t) && /;\s*$/.test(t)) { actScore += 2; continue; }
    if (/^->/.test(t) || /^\|.*\|\s*$/.test(t)) { actScore += 1; continue; }
    if (/^(class|interface|enum|abstract|package|component|artifact|node|device|usecase|actor|object|rectangle)\b/i.test(t)) structScore += 1;
    if (SEQ_MESSAGE.test(t) || /^\s*\S+\s*->>?\s*\S+/.test(t)) seqScore += 1;
  }
  // Every family votes, and the winner takes the block: comparing sequence
  // against behaviour only made a class diagram with one labelled link
  // (`e8 --> e7 : …`) a sequence diagram.
  const best = Math.max(seqScore, actScore, stateScore, structScore);
  if (best === 0) return 'structural';
  if (seqScore === best) return 'sequence';
  if (actScore === best) return 'activity';
  if (stateScore === best) return 'state';
  return 'structural';
  // Nothing recognisable: still build a diagram, every line becomes a warning.
  return 'structural';
}

/** Which diagram kind a structural block shows (drives the palette and seed). */
function structuralDiagramKind(elements) {
  const kinds = new Set(elements.map((e) => e.kind));
  if (kinds.has('actor') || kinds.has('usecase') || kinds.has('systemBoundary')) return 'usecase';
  if (kinds.has('node') || kinds.has('device') || kinds.has('executionEnvironment') || kinds.has('artifact')) return 'deployment';
  if (kinds.size && [...kinds].every((k) => k === 'object')) return 'object';
  if (kinds.size && [...kinds].every((k) => k === 'package' || k === 'model' || k === 'profile')) return 'package';
  if (kinds.has('component')) return 'component';
  return 'class';
}

/* ------------------------------------------------------- shared parsing */

/**
 * PlantUML declares a name the moment it appears in a link or a message, so
 * the import does too — `A --> B` on its own is a valid diagram of two classes.
 *
 * The exception is a token shaped like an ALIAS the editor itself hands out
 * (`e12`, `p3`): that is a reference to something the file forgot to declare
 * (the export writes `e3 --> e10` when e10 has no declaration), and inventing a
 * class called «e10» would be worse than dropping the arrow.
 */
function declareUnknown(rd, alias, kind) {
  if (!alias || GENERATED_ID.test(alias)) return null;
  return rd.element(alias, kind, alias);
}

/** `alias "1"` → {alias, multiplicity}; `"*" alias` → the same. */
function endSpec(text, parts) {
  let raw = String(text ?? '').trim();
  let multiplicity = '';
  // A quoted multiplicity is a masked literal by now (\u0000n\u0000), which is
  // exactly what keeps `"1"` from being read as part of the alias. PlantUML
  // writes it AFTER the alias of the left end and BEFORE the alias of the
  // right one, so both orders are read.
  const tail = raw.match(/^(.*?)\s*\u0000(\d+)\u0000\s*$/);
  const head = raw.match(/^\u0000(\d+)\u0000\s*(.*)$/);
  if (tail) {
    multiplicity = (parts[Number(tail[2])] ?? '').trim();
    raw = tail[1].trim();
  } else if (head) {
    multiplicity = (parts[Number(head[1])] ?? '').trim();
    raw = head[2].trim();
  }
  const alias = unmask(raw, parts).replace(/^["«“]|["»”]$/g, '').trim();
  return { alias, multiplicity };
}

/** The arrow of a masked declaration line: longest match, leftmost first. */
const ARROW_FORMS = [
  // `--` with a head at both ends. It is listed first because it is longer
  // than `<--`: the scanner keeps the leftmost match and breaks the length tie
  // by the order here, and a shorter `<--` would swallow it.
  '<-->',
  '<|--', '--|>', '<|..', '..|>', '<|', '|>',
  '<*--', '*-->', '*--', '--*', '<o--', 'o-->', 'o--', '--o',
  '<--', '-->', '<..', '..>', '--()', '()--',
  // Sequence arrows: `->`, `->>`, `<-`, `-->>` (async) travel with the same
  // scanner, otherwise `A -> B : text` would be read as a declaration.
  '-->>', '->>', '<-', '->',
  '--', '..',
].sort((a, b) => b.length - a.length);

function findArrow(maskedRaw) {
  // `-[#red]->` and `-[#blue,dashed]->` are the same arrow with a colour: the
  // colour specifier sits INSIDE the line, so it is removed before scanning.
  const masked = String(maskedRaw).replace(/-\[[^\]]*\]/g, '-');
  let best = null;
  for (const form of ARROW_FORMS) {
    let at = masked.indexOf(form);
    while (at >= 0) {
      const before = masked[at - 1] ?? ' ';
      const after = masked[at + form.length] ?? ' ';
      // A dashed line (`--`, `..`) must stand alone, or the dash inside a name
      // would be read as an arrow. An arrow WITH a head (`->`, `-->`) may touch
      // its neighbours: `A-->B` is legal PlantUML.
      const ok = /[<>]/.test(form) || (!/[\w\u0000]/.test(before) && !/[\w\u0000]/.test(after));
      if (ok && (!best || at < best.at || (at === best.at && form.length > best.form.length))) {
        best = { at, form };
        break;
      }
      at = masked.indexOf(form, at + 1);
    }
  }
  return best;
}

/**
 * The UML relationship a PlantUML arrow denotes, plus which end carries the
 * decoration. `*--` puts the diamond at the LEFT end (`,--*` at the right) —
 * the exporter's note in §7 of the plan: swapping the ends moves the
 * multiplicities with it.
 */
function relationOfArrow(form) {
  const has = (s) => form.includes(s);
  const left = form.startsWith('<') || form.startsWith('<|');
  const dashed = form.includes('..');
  if (has('|>') || form.startsWith('<|')) {
    return { kind: dashed ? 'realization' : 'generalization', extra: {} };
  }
  if (has('*')) {
    const atRight = form.endsWith('*') || /^--\*/.test(form);
    if (!atRight) return { kind: 'composition', extra: { fromAggregation: 'composite', toAggregation: 'none' } };
    return { kind: 'association', extra: { fromAggregation: 'none', toAggregation: 'composite' } };
  }
  if (has('o')) {
    const atRight = form.endsWith('o') || /^--o/.test(form);
    if (!atRight) return { kind: 'aggregation', extra: { fromAggregation: 'shared', toAggregation: 'none' } };
    return { kind: 'association', extra: { fromAggregation: 'none', toAggregation: 'shared' } };
  }
  if (has('()')) return { kind: 'assembly', extra: {} };
  if (dashed) return { kind: 'dependency', extra: {} };
  // Plain line: an association; navigation is decided by the head, below.
  return { kind: 'association', extra: {} };
}

/**
 * Navigability from the arrow's heads. `A --> B` is navigable from A to B
 * (`navigable: 'from'` — the head sits at `to`), `A <-- B` the reverse.
 */
function navigabilityOf(form) {
  const headRight = /(>|\|>)$/.test(form) && !/<\||<--$|<\.\.$/.test(form);
  const headLeft = form.startsWith('<') && !/^\|>/.test(form);
  if (headRight && headLeft) return 'both';
  if (headRight) return 'from';
  if (headLeft) return 'to';
  return 'none';
}

/**
 * The label of a relationship. The exporter packs four things into it
 * (emit.mjs#labelOf): `{complete, disjoint}`, `<<keyword>>`, the name and
 * `fromRole → toRole`. Each is taken back out here.
 */
function splitLabel(label) {
  let text = String(label ?? '').trim();
  let set = null;
  const setM = text.match(/^\{([^{}]*)\}\s*/);
  if (setM) {
    set = setM[1];
    text = text.slice(setM[0].length).trim();
  }
  let stereotype = null;
  const stM = text.match(/^<<\s*([^<>]+?)\s*>>\s*/);
  if (stM) {
    stereotype = stM[1].trim();
    text = text.slice(stM[0].length).trim();
  }
  let fromRole = null;
  let toRole = null;
  const roleM = text.match(/^(.*?)\s*(\S*)\s*→\s*(\S*)\s*$/);
  if (roleM) {
    text = roleM[1].trim();
    fromRole = roleM[2] === '·' ? '' : roleM[2];
    toRole = roleM[3] === '·' ? '' : roleM[3];
  }
  return { text: text.trim(), set, stereotype, fromRole, toRole };
}

/* --------------------------------------------------------- comments */

/**
 * The comments the exporter writes carry data it could not put on the drawing
 * (`' doc`, `' source`, `' tag`, `' member`, `' classifier`). Reading them
 * back is what makes the round trip keep documentation instead of dropping it.
 */
function readComment(rd, text, no) {
  const m = text.match(/^'\s*(doc|source|note|tag|member|classifier|frame)\s+(\S+?)\s*:\s*([\s\S]*)$/);
  if (m) {
    const [, what, alias, body] = m;
    const el = rd.byAlias.get(alias);
    if (!el) return false;
    if (what === 'doc') el.documentation = body.trim();
    else if (what === 'source') el.source = body.trim();
    else if (what === 'note') el.note = body.trim();
    else if (what === 'classifier') el.classifier = body.trim();
    else if (what === 'member') {
      const row = parseMemberRow(body);
      const field = isOperation(row) ? 'operations' : 'attributes';
      if (!Array.isArray(el[field])) el[field] = [];
      el[field].push(row);
    } else if (what === 'frame') {
      // `' frame alias: text (opt)` — a frame that covered no message.
      const opM = body.match(/^(.*)\s+\(([a-z]+)\)\s*$/i);
      const op = opM ? opM[2] : 'opt';
      const name = opM ? opM[1] : body;
      const fr = rd.element(alias, 'fragment', name, { operator: op });
      fr.operator = op;
      rd.frames.push({ elementId: fr.id, from: null, to: null });
    }
    return true;
  }
  const tag = text.match(/^'\s*tag\s+(\S+)\s+(\S+)\s*=\s*([\s\S]*)$/);
  if (tag) {
    const el = rd.byAlias.get(tag[1]);
    if (el) {
      if (!Array.isArray(el.taggedValues)) el.taggedValues = [];
      el.taggedValues.push({ name: tag[2], value: tag[3].trim() });
      return true;
    }
  }
  return true;                            // any other comment is just a comment
}

/* --------------------------------------------------------- structural */

/**
 * `class Foo as "Bar" <<st>> { members }` — class grammar (`class-decl`,
 * `class-body`, `class-member`), and the same shape for package/component/
 * actor/usecase from the description family (`element-usecase`).
 */
function parseStructural(rd, lines, title) {
  const stack = [];            // open containers: { element, kind }
  let inNote = null;           // { element } while inside `note as … / end note`

  const ownerOf = () => (stack.length ? stack[stack.length - 1].element.id : null);

  const closeBody = () => {
    const top = stack.pop();
    if (!top) return;
    // The exporter nests by geometry; the model nests by `ownerId`. Anything
    // that ended up inside a frame gets the frame as its owner.
    for (const el of rd.model.elements) {
      if (el.__inside === top.element.id && !el.ownerId) el.ownerId = top.element.id;
    }
  };

  for (const { text, no } of lines) {
    const raw = text.replace(/\s+$/, '');
    const t = raw.trim();
    if (!t) continue;

    if (inNote) {
      if (/^end\s*note$/i.test(t)) { inNote = null; continue; }
      inNote.body.push(t);
      continue;
    }

    if (t.startsWith("'")) { readComment(rd, t, no); continue; }
    if (t.startsWith('//') || t.startsWith('/*')) continue;

    const ignored = IGNORED_PREFIXES.find(([p]) => t.toLowerCase().startsWith(p));
    if (ignored) {
      if (ignored[1]) rd.warn(no, t, `${ignored[1]} — пропущено`);
      continue;
    }

    if (/^title\b/i.test(t)) continue;             // read as the sheet name before the loop

    if (/^note\b/i.test(t)) {
      const bare = t.match(/^note\s+(?:left|right|top|bottom)\s*:\s*(.*)$/i);
      if (bare) {
        const el = rd.element(undefined, 'note', '');
        el.documentation = bare[1].trim();
        continue;
      }
      const multi = t.match(/^note\s+(?:left|right|top|bottom)(?:\s+of\s+(\S+))?\s*$/i);
      if (multi) {
        const el = rd.element(undefined, 'note', '');
        el.__noteBody = [];
        inNote = { element: el, body: el.__noteBody };
        continue;
      }
      const single = t.match(/^note\s+(left|right|top|bottom)\s+of\s+(\S+)\s*:\s*(.*)$/i);
      if (single) {
        const ref = rd.byAlias.get(single[2]);
        const el = rd.element(undefined, 'note', '');
        el.documentation = single[3];
        el.__noteOf = ref?.id ?? null;
        continue;
      }
      const quoted = t.match(/^note\s+"([^"]*)"\s+as\s+(\S+)\s*$/i);
      if (quoted) {
        const el = rd.element(quoted[2], 'note', '', {});
        el.documentation = quoted[1];
        continue;
      }
      const m = t.match(/^note\s+(?:as\s+)?(\S+)?\s*(<<[^>]+>>)?\s*$/i);
      if (m && !/:/.test(t)) {
        const alias = m[1] && !m[1].startsWith('<<') ? m[1] : undefined;
        const el = rd.element(alias, 'note', '');
        if (m[2]) el.stereotype = m[2].replace(/^<<|>>$/g, '').trim();
        inNote = { element: el, body: [] };
        el.__noteBody = inNote.body;
        continue;
      }
      rd.warn(no, t, 'заметка этой формы не разобрана');
      continue;
    }
    if (/^end\s*note$/i.test(t)) { inNote = null; continue; }

    if (t === '{' || t === '}') {
      if (t === '}') closeBody();
      continue;
    }

    // A declaration, possibly opening a body with a trailing `{`.
    const decl = readDeclaration(t);
    if (decl) {
      const el = applyDeclaration(rd, decl, no, ownerOf());
      if (el) {
        if (decl.opensBody) stack.push({ element: el, kind: el.kind });
        if (el.kind === 'note') inNote = { element: el, body: [], single: true };
      }
      continue;
    }

    if (t === '}') { closeBody(); continue; }

    // A member line, a note-body line, or inside an open container.
    const top = stack.length ? stack[stack.length - 1].element : null;
    if (top && MEMBER_KINDS.has(top.kind) && (/^[+\-#~/]/.test(t) || /^\{[a-z]+\}/i.test(t))) {
      addMember(top, t);
      continue;
    }
    if (top && MEMBER_KINDS.has(top.kind) && t === '--') {
      top.__ops = true;                     // the compartment separator
      continue;
    }
    if (top && top.kind === 'enumeration') {
      if (!Array.isArray(top.literals)) top.literals = [];
      top.literals.push({ name: t });
      continue;
    }
    if (top) {
      if (/^--/.test(t) && /--$/.test(t)) continue;   // compartment rule
      if (/^(entry|do|exit)\s*\/\s*/i.test(t)) {
        const kind = t.slice(0, 4).toLowerCase();
        if (!Array.isArray(top[kind])) top[kind] = [];
        top[kind].push(t.replace(/^(entry|do|exit)\s*\/\s*/i, ''));
        continue;
      }
      if (/^extension\s+point\s*:/i.test(t)) {
        if (!Array.isArray(top.extensionPoints)) top.extensionPoints = [];
        top.extensionPoints.push(t.replace(/^extension\s+point\s*:\s*/i, ''));
        continue;
      }
    }

    // `Foo <<entity>>` on its own: a stereotype added to a known element.
    const stOnly = t.match(/^([\w.\u0400-\u04FF]+)\s*<<\s*([^<>]+?)\s*>>$/);
    if (stOnly && rd.byAlias.has(stOnly[1])) {
      rd.byAlias.get(stOnly[1]).stereotype = stOnly[2].trim();
      continue;
    }

    // A relationship.
    if (readRelationship(rd, t, no, ownerOf)) continue;

    rd.warn(no, t, 'не понята конструкция — строка пропущена');
  }

  void title;
}

/** Recognise `<keyword> [abstract ]<name or alias> [as "Name"] [<<st>>] [{]`. */
function readDeclaration(t) {
  const m = t.match(/^(abstract\s+)?([A-Za-z_]+)\b\s*([\s\S]*)$/);
  if (!m) return null;
  const [, abs, wordRaw, tailRaw] = m;
  const word = wordRaw.toLowerCase();
  if (!KIND_BY_KEYWORD[word]) return null;
  if (word === 'abstract' && !abs) {
    // `abstract Foo` (PlantUML's own spelling) or `abstract class Foo`.
    return readDeclaration(`abstract class${tailRaw ? ` ${tailRaw}` : ''}`);
  }
  let tail = tailRaw.trim();
  let opensBody = false;
  if (/\{\s*\}$/.test(tail)) {
    // `class Foo {}` — an empty body, which is no body at all.
    tail = tail.replace(/\{\s*\}$/, '').trim();
  } else if (tail.endsWith('{')) {
    opensBody = true;
    tail = tail.slice(0, -1).trim();
  }
  if (tail.endsWith(';')) tail = tail.slice(0, -1).trim();
  if (tail.endsWith('[')) {
    // `usecase UC1 [` — a declaration whose description follows on the lines
    // below; the bracket is the opening of that block, not part of the name.
    tail = tail.slice(0, -1).trim();
  }
  // `extends` / `implements` are drawn as a generalization / realization.
  let extendsOf = null;
  let implementsOf = null;
  const ext = tail.match(/\s+extends\s+(\S+)\s*$/i);
  if (ext) { extendsOf = ext[1]; tail = tail.slice(0, ext.index).trim(); }
  const imp = tail.match(/\s+implements\s+([\s\S]+)$/i);
  if (imp) { implementsOf = imp[1].split(',').map((x) => x.trim()).filter(Boolean); tail = tail.slice(0, imp.index).trim(); }
  const { text, stereotypes } = takeStereotypes(tail);
  // Style that the editor has no slot for: colour, a link, spot tags. Dropped
  // here and reported once per line, so the name stays the name.
  const style = [];
  let clean = text;
  clean = clean.replace(/\s*#\w[\w;-]*\s*$/, () => { style.push('цвет'); return ''; });
  clean = clean.replace(/\s*\[\[[^\]]*\]\]\s*$/, () => { style.push('ссылка'); return ''; });
  clean = clean.replace(/\s*\$[\w.]+\s*$/g, () => { style.push('метка'); return ''; });
  const spec = parseNameSpec(clean.trim());
  if (!spec) return null;
  return {
    keyword: word,
    abstract: Boolean(abs) || word === 'abstract',
    alias: spec.alias,
    name: spec.name,
    order: spec.order,
    stereotypes,
    opensBody,
    extendsOf,
    implementsOf,
    style,
    bare: !tail,
  };
}

/**
 * An id the editor generated (`e12`, `p3`). The exporter writes such an element
 * as a bare alias when it has nothing to display (`declared()` in emit.mjs), so
 * a bare `e6` is read as «no caption», not as a state called «e6».
 */
const GENERATED_ID = /^[ep]\d+$/;

/** The caption a declaration shows; '' when the alias is all there is. */
function captionOf(spec) {
  if (spec?.order === 'bare' && GENERATED_ID.test(spec.alias ?? '')) return '';
  return spec?.name ?? '';
}

/**
 * `Foo as "Bar"` / `"Bar" as Foo` / `Foo` / `"Bar"`. PlantUML accepts all
 * four orders, and package uses the quoted-name-first one (emit.mjs#header).
 */
function parseNameSpec(text) {
  let s = String(text ?? '').trim();
  if (!s) return { alias: null, name: '', order: 'bare' };
  const asM = s.match(/^([\s\S]*?)\s+as\s+([\s\S]*)$/i);
  if (asM) {
    const left = asM[1].trim();
    const right = asM[2].trim();
    const leftQuoted = isQuoted(left);
    const rightQuoted = isQuoted(right);
    if (leftQuoted && !rightQuoted) return { alias: right, name: unquote(left), order: 'name-first' };
    if (rightQuoted && !leftQuoted) return { alias: left, name: unquote(right), order: 'alias-first' };
    return { alias: right, name: unquote(left), order: 'alias-first' };
  }
  if (isQuoted(s)) return { alias: null, name: unquote(s), order: 'name-only' };
  // A bare token may carry a template parameter list: `Foo<E>`.
  const bare = s.replace(/\s*<[^<>]*>\s*$/, '').trim();
  return { alias: bare || null, name: bare, order: 'bare' };
}

function applyDeclaration(rd, decl, no, ownerId) {
  const base = KIND_BY_KEYWORD[decl.keyword] ?? 'class';
  let kind = base;
  let stereotype = decl.stereotypes[0] ?? null;
  for (const st of decl.stereotypes) {
    const map = KIND_BY_STEREO[st];
    if (!map || map[0] !== decl.keyword) continue;
    kind = map[1];
    // The shape draws its own stereotype («device», «model», …); only a
    // stereotype the shape does NOT draw («subject» on a system boundary) is
    // kept on the element.
    stereotype = SHAPE_STEREOTYPE[kind] === st ? null : st;
    break;
  }
  if (decl.stereotypes.length > 1) {
    rd.warn(no, decl.stereotypes.join(' '), `стехреотипов несколько — оставлен «${stereotype ?? decl.stereotypes[0]}»`);
  }
  if (decl.keyword === 'entity') rd.warn(no, 'entity', '«entity» показан классом со стереотипом entity');
  if (decl.keyword === 'entity' && !stereotype) stereotype = 'entity';
  if (decl.keyword === 'annotation' && !stereotype) stereotype = 'annotation';
  if (decl.style?.length) rd.warn(no, decl.style.join(', '), 'оформление не переносится');

  const caption = captionOf({ name: decl.name, alias: decl.alias, order: decl.order });
  // `ArrayList<E>`: the exporter writes the parameter list into the quoted
  // name (emit.mjs#header), so it is split off again here.
  const generic = caption.match(/^(.*?)\s*<([^<>]+)>$/);
  const name = (generic ? generic[1] : caption) || decl.alias || '';
  const el = rd.element(decl.alias ?? name, kind, name, { stereotype });
  if (generic) el.templateParameters = generic[2].split(',').map((x) => x.trim());
  if (!el) return null;
  if (decl.abstract && (kind === 'class' || kind === 'datatype')) el.abstract = true;
  else if (decl.abstract) el.abstract = true;
  if (ownerId && !el.ownerId) el.ownerId = ownerId;
  el.__inside = ownerId ?? null;
  if (!isStr(el.name) || el.name === '') el.name = name;

  // `class Foo extends Bar` / `class Foo implements IBar` — PlantUML's own
  // shortcut for a generalization / realization; read as that relationship.
  const ref = (word2) => {
    const known = rd.byAlias.get(word2);
    if (known) return known;
    return rd.element(word2, 'class', word2);
  };
  if (decl.extendsOf) rd.relationship('generalization', el, ref(decl.extendsOf));
  for (const name2 of decl.implementsOf ?? []) rd.relationship('realization', el, ref(name2));
  return el;
}

function addMember(el, text) {
  const row = parseMemberRow(text);
  if (!row.name && !row.type) return;
  const field = isOperation(row) || el.__ops ? 'operations' : 'attributes';
  if (!Array.isArray(el[field])) el[field] = [];
  el[field].push(row);
}

/**
 * `A "1" -- "*" B : label` — class grammar `link`. The two ends, the arrow,
 * the multiplicities and the label are read on a quote-masked line, so a name
 * with a dash in it cannot be mistaken for an arrow.
 */
function readRelationship(rd, t, no, ownerId) {
  const { masked, parts } = maskQuotes(t);
  const arrow = findArrow(masked);
  if (!arrow) return readInlineMember(rd, t, no);
  const left = masked.slice(0, arrow.at);
  const right = masked.slice(arrow.at + arrow.form.length);
  if (!left.trim() || !right.trim()) return false;

  // A colour may follow the target end: `A --> B #red`. It is style, not data.
  const rightStyled = right.replace(/\s*#[\w-]+\s*$/, '');
  const labelM = rightStyled.match(/\s*:\s*([\s\S]*)$/);
  const label = labelM ? unmask(labelM[1], parts).trim() : '';
  const rightSide = labelM ? rightStyled.slice(0, labelM.index) : rightStyled;

  const fromEnd = endSpec(left, parts);
  const toEnd = endSpec(rightSide, parts);
  if (!fromEnd.alias || !toEnd.alias) return false;
  if (/^\{.*\}$/.test(fromEnd.alias) || /^\{.*\}$/.test(toEnd.alias)) {
    rd.warn(no, t, 'якорь связи (`{a} -- {b}`) не переносится');
    return true;
  }
  const from = rd.byAlias.get(fromEnd.alias) ?? declareUnknown(rd, fromEnd.alias, 'class');
  const to = rd.byAlias.get(toEnd.alias) ?? declareUnknown(rd, toEnd.alias, 'class');
  if (!from || !to) {
    const missing = !from ? fromEnd.alias : toEnd.alias;
    rd.warn(no, t, `конец «${missing}» не объявлен — связь пропущена`);
    return true;
  }

  let { kind, extra } = relationOfArrow(arrow.form);
  const nav = navigabilityOf(arrow.form);
  // UML 2.5.1 §11.8: a line between two INSTANCES is a link, not an
  // association. The export writes both as `--`, so the ends decide.
  if (kind === 'association' && from.kind === 'object' && to.kind === 'object') kind = 'link';
  // UML 2.5.1 §19.4.2: a line between two deployment nodes is a communication
  // path (the same `--` on the sheet, a different meaning in the model).
  const NODE_KINDS = new Set(['node', 'device', 'executionEnvironment', 'artifact']);
  if (kind === 'association' && NODE_KINDS.has(from.kind) && NODE_KINDS.has(to.kind)) {
    kind = 'communicationPath';
  }
  const lab = splitLabel(label);
  const rel = rd.relationship(kind, from, to, {
    ...extra,
    navigable: kind === 'association' || kind === 'aggregation' || kind === 'composition' ? nav : 'none',
  });
  if (fromEnd.multiplicity) rel.fromMultiplicity = fromEnd.multiplicity;
  if (toEnd.multiplicity) rel.toMultiplicity = toEnd.multiplicity;
  if (lab.text) rel.name = lab.text;
  // `<<import>>`, `<<include>>`, `<<use>>` … are UML stereotypes of a
  // dependency (2.5.1 §7.4, §12.2.6), so they stay a stereotype. Keeping them
  // as a stereotype also covers the export map's own kinds (`import`, `usage`),
  // which are written with exactly this text.
  if (lab.stereotype) rel.stereotype = lab.stereotype;
  if (lab.fromRole != null) rel.fromRole = lab.fromRole;
  if (lab.toRole != null) rel.toRole = lab.toRole;
  if (lab.set) {
    const parts2 = lab.set.split(',').map((x) => x.trim()).filter(Boolean);
    const name = parts2.find((x) => !['complete', 'disjoint', 'incomplete', 'overlapping'].includes(x));
    const set = {
      id: `gs${rd.model.generalizationSets.length + 1}`,
      name: name ?? '',
      covering: parts2.includes('complete'),
      disjoint: parts2.includes('disjoint'),
    };
    rd.model.generalizationSets.push(set);
    rel.setId = set.id;
  }
  if (ownerId) void ownerId;
  return true;
}

/** `+field : Type` written outside a body: `Foo : +field`. */
function readInlineMember(rd, t, no) {
  const m = t.match(/^([\w.\u0400-\u04FF]+)\s*:\s*([+\-#~][\s\S]*)$/);
  if (!m) return false;
  const el = rd.byAlias.get(m[1]);
  if (!el) return false;
  addMember(el, m[2]);
  return true;
}

/* ----------------------------------------------------------- sequence */

/**
 * Sequence grammar (`participant`, `participant-actor`, `arrow`, `activate`,
 * `fragment-alt`, `note`, `ref`). Messages become relationships; the vertical
 * order of the text is the order of the messages, and `frames` records which
 * messages a combined fragment covers — the seed needs that to draw the frame
 * around them, because the model itself stores coverage as geometry.
 */
function parseSequence(rd, lines, title) {
  const diagrams = [];
  const frames = [];
  const activations = new Map();       // lifeline id → stack of activation elements
  let messageNo = 0;
  let pendingCreate = null;
  let pendingDestroy = null;
  let frameStack = [];

  const lifeline = (alias, kind, name, extra = {}) => {
    const el = rd.element(alias, kind, name, extra);
    if (el.kind !== kind && el.kind !== 'lifeline') return el;
    return el;
  };

  for (const { text, no } of lines) {
    const t = text.trim();
    if (!t) continue;
    if (t.startsWith("'")) { readComment(rd, t, no); continue; }

    const ignored = IGNORED_PREFIXES.find(([p]) => t.toLowerCase().startsWith(p));
    if (ignored) {
      if (ignored[1]) rd.warn(no, t, `${ignored[1]} — пропущено`);
      continue;
    }
    if (/^title\b/i.test(t)) continue;
    if (/^autonumber\b/i.test(t)) { rd.model.messageNumbers = true; continue; }
    if (/^newpage\b/i.test(t) || /^box\b/i.test(t) || /^end\s*box$/i.test(t)) {
      rd.warn(no, t, 'группировка участников не переносится');
      continue;
    }

    // Participants.
    let m = t.match(/^(participant|actor|boundary|control|entity|queue|database|collections)\s+([\s\S]+)$/i);
    if (m) {
      const word = m[1].toLowerCase();
      // `participant A order 10` — the number orders the drawing, not the model.
      const ordered = m[2].replace(/\s+order\s+-?\d+\s*$/i, '');
      const { text: tail, stereotypes } = takeStereotypes(ordered);
      const spec = parseNameSpec(tail);
      if (!spec) { rd.warn(no, t, 'участник без имени'); continue; }
      const kind = word === 'actor' ? 'actorLifeline' : 'lifeline';
      const extra = word === 'collections' ? { multiObject: true } : {};
      if (stereotypes.length) extra.stereotype = stereotypes[0];
      const alias = spec.alias ?? spec.name;
      const el = lifeline(alias, kind, spec.name || alias, extra);
      el.__participant = true;
      continue;
    }
    m = t.match(/^create\s+(\S+)$/i);
    if (m) {
      pendingCreate = m[1];
      // `create X` also declares X: PlantUML draws the lifeline from that line
      // on, so a file may never mention X before.
      if (!rd.byAlias.has(m[1])) lifeline(m[1], 'lifeline', m[1]);
      continue;
    }
    m = t.match(/^destroy\s+(\S+)$/i);
    if (m) {
      // A destroy occurrence belongs to a message into that lifeline; the
      // exporter writes it right after that message, so the message has to be
      // the LAST one seen. Anything else is a destroy with no message and is
      // reported instead of guessed.
      const target = rd.byAlias.get(m[1]);
      const prev = rd.model.relationships[rd.model.relationships.length - 1];
      if (target && prev && (prev.kind === 'message' || prev.kind === 'createMessage')
        && prev.to === target.id && prev.from !== target.id) {
        prev.kind = 'destroyMessage';
      } else {
        rd.warn(no, t, 'destroy не следует за сообщением к этому участнику — не перенесён');
      }
      continue;
    }
    m = t.match(/^(activate|deactivate)\s*(\S*)$/i) || null;
    if (m && m[1].toLowerCase() === 'deactivate' && !m[2]) {
      // `deactivate` with no name: close the most recent activation.
      let last = null;
      for (const [id, stack] of activations) if (stack.length) last = { id, stack };
      if (last) last.stack.pop();
      else rd.warn(no, t, 'деактивация без активации');
      continue;
    }
    if (m && !m[2]) m = null;
    if (m) {
      const target = rd.byAlias.get(m[2]);
      if (!target) { rd.warn(no, t, `участник «${m[2]}» не объявлен`); continue; }
      if (m[1].toLowerCase() === 'activate') {
        const el = rd.pseudo('activation', { name: target.name, ownerId: target.id });
        el.__activationOf = target.id;
        if (!activations.has(target.id)) activations.set(target.id, []);
        activations.get(target.id).push(el);
      } else {
        const stack = activations.get(target.id) ?? [];
        const el = stack.pop();
        if (el) el.__closed = true;
        else rd.warn(no, t, 'деактивация без активации');
      }
      continue;
    }

    // Notes.
    m = t.match(/^note\s+(?:right|left)\s*:\s*([\s\S]*)$/i);
    if (m) {
      const el = rd.element(undefined, 'note', '');
      el.documentation = m[1].trim();
      continue;
    }
    m = t.match(/^note\s+(?:over|left of|right of|top of|bottom of)\s+([^:]+?)\s*:\s*([\s\S]*)$/i);
    if (m) {
      const el = rd.element(undefined, 'note', '');
      el.documentation = m[2].trim();
      el.__noteOver = m[1].split(',').map((x) => x.trim());
      continue;
    }

    // Combined fragments.
    m = t.match(/^(alt|opt|loop|par|break|critical|group|seq|strict|ignore|consider|assert|neg)\b\s*([\s\S]*)$/i);
    if (m && FRAGMENT_OPS.has(m[1].toLowerCase())) {
      const op = m[1].toLowerCase();
      const guard = guardOf(m[2]);
      const el = rd.element(undefined, 'fragment', guard, { operator: op });
      el.operator = op;
      el.__operands = [guard];
      const frame = { id: el.id, el, from: messageNo, to: null, depth: frameStack.length };
      frames.push(frame);
      frameStack.push(frame);
      continue;
    }
    m = t.match(/^else\b\s*([\s\S]*)$/i);
    if (m) {
      const top = frameStack[frameStack.length - 1];
      if (!top) { rd.warn(no, t, '«else» без фрагмента'); continue; }
      top.el.__operands.push(guardOf(m[1]));
      continue;
    }
    if (/^end\s*(note|box)?\s*$/i.test(t)) {
      const top = frameStack.pop();
      if (top) { top.to = messageNo - 1; top.el.name = top.el.__operands.join(' / '); }
      continue;
    }

    // `ref over A, B : text` — an interaction use.
    m = t.match(/^ref\s+over\s+([^:]+?)\s*:\s*([\s\S]*)$/i);
    if (m) {
      const name = m[2].trim();
      const el = rd.element(undefined, 'interactionUse', name);
      el.refersTo = name;
      // Which lifelines the frame spans. The export recomputes this from the
      // rectangle's horizontal extent, so the seed needs it to stay faithful.
      const refs = m[1].split(',').map((x) => x.trim())
        .map((alias) => rd.byAlias.get(alias)?.id).filter(Boolean);
      if (refs.length) frames.push({ elementId: el.id, refs, kind: 'ref', from: null, to: null });
      continue;
    }

    // `A -> B : text`
    const msg = readMessage(rd, t, no);
    if (msg) {
      const { rel, to } = msg;
      // `create X` names the participant the NEXT message constructs; `destroy
      // X` names the one the PREVIOUS message destroyed (emit.mjs#emitMessage
      // writes both around the arrow).
      if (pendingCreate && to.id === rd.byAlias.get(pendingCreate)?.id) {
        rel.kind = 'createMessage';
        pendingCreate = null;
      }
      messageNo += 1;
      rel.__index = messageNo - 1;
      continue;
    }

    rd.warn(no, t, 'не понята конструкция — строка пропущена');
  }

  for (const frame of frames) {
    if (frame.kind === 'ref') continue;           // a `ref over`: no operands
    if (frame.to == null) frame.to = messageNo - 1;
    delete frame.el.__operands;
  }
  for (const f of frameStack) f.to = messageNo - 1;
  // Activations are views of a message range in UML; here they are elements
  // with their lifeline as owner, and the seed draws them on that lifeline.
  for (const el of rd.model.elements) {
    if (el.kind !== 'activation') continue;
    delete el.__closed;
  }
  void diagrams; void title;
  return { frames, messageNo };
}

/**
 * A combined-fragment guard as the sheet draws it: inside square brackets.
 *
 * PlantUML prints the pair itself and eats one written by hand, so the exporter
 * strips exactly one outer pair (`guardText`, emit.mjs). Adding exactly one
 * pair back is the inverse — and it makes `parse → emit → parse` a fixed
 * point even for a guard that already contains brackets of its own
 * (`[(1, 10) [готовность…]]` → `(1, 10) [готовность…]` → the same again).
 */
function guardOf(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return `[${text}]`;
}
/** `A -> B : teкст`, `A ->> B`, `A --> B`, `A <- B`, `A -> B`. */
function readMessage(rd, t, no) {
  const { masked, parts } = maskQuotes(t);
  const arrow = findArrow(masked);
  if (!arrow) return null;
  if (arrow.form.includes('|') || arrow.form.includes('()')) return null;
  const left = masked.slice(0, arrow.at).trim();
  const rightRaw = masked.slice(arrow.at + arrow.form.length);
  if (!left || !rightRaw.trim()) return null;
  const labelM = rightRaw.match(/\s*:\s*([\s\S]*)$/);
  const text = labelM ? labelM[1].trim() : '';
  const right = (labelM ? rightRaw.slice(0, labelM.index) : rightRaw).trim();
  const fromAlias = left.split(/\s+/).pop();
  const toAlias = right.split(/\s+/)[0];
  const fromName = unmask(fromAlias, parts).replace(/^\{[^}]*\}\s*/, '').trim();
  const toName = unmask(toAlias, parts).trim();
  if (/^\{.*\}$/.test(t.trim())) {
    rd.warn(no, t, 'якорь связи (`{a} <-> {b}`) не переносится');
    return null;
  }
  if (/^\{[^}]*\}$/.test(fromName) && /^\{[^}]*\}$/.test(toName)) {
    rd.warn(no, t, 'якорь связи (`{a} <-> {b}`) не переносится');
    return null;
  }
  if (/^[\[\]]$/.test(fromName) || /^[\[\]]$/.test(toName)) {
    rd.warn(no, t, 'внешняя стрелка кадра (`[->`, `->]`) не переносится');
    return null;
  }
  const from = rd.byAlias.get(fromName)
    ?? declareUnknown(rd, fromName, 'lifeline');
  const to = rd.byAlias.get(toName) ?? declareUnknown(rd, toName, 'lifeline');
  if (!from || !to) {
    rd.warn(no, t, `участник «${!from ? fromName : toName}» не объявлен — сообщение пропущено`);
    return null;
  }
  const form = arrow.form;
  let kind = 'message';
  if (/^<-+$/.test(form)) kind = 'reply';
  else if (/^--+>?$/.test(form) && form.includes('--')) kind = 'reply';
  const async = /->>/.test(form) || /-->>/.test(form);
  const extra = {};
  if (async) extra.asynchronous = true;
  // `A <- B` is a message from B to A.
  const reverse = form.startsWith('<');
  const a = reverse ? to : from;
  const b = reverse ? from : to;
  const rel = rd.relationship(kind, a, b, { ...extra, name: unmask(text, parts) });
  return { from: a, to: b, kind: rel.kind, text: unmask(text, parts), rel };
}

/* ----------------------------------------------------------- activity */

/**
 * Activity3 grammar (`start`, `stop`, `action`, `if/else/endif`, `fork`,
 * `swimlane`, `arrow`). The text is a tree; the model is a graph. The tree is
 * the part PlantUML can express, so that is what is read: a statement after
 * `:` is a node, the previous node is its predecessor, and the label of a
 * branch (`then (label)`) is the name of the control-flow edge — which is
 * exactly what the exporter wrote there.
 */
function parseActivity(rd, lines, title) {
  const laneEls = [];
  let lane = null;                 // current swimlane element
  let tail = null;                 // node the next statement hangs from
  const open = [];                 // if/fork scopes
  let pending = null;              // branches that have not met yet
  let pendingLabel = '';           // `-> label;` waiting for its target

  const node = (kind, name, extra = {}) => {
    const el = rd.element(undefined, kind, name, extra);
    if (lane) el.lane = lane.id;
    return el;
  };
  const edge = (from, to, name = '') => {
    if (!from || !to) return null;
    return rd.relationship('controlFlow', from, to, { name });
  };

  /**
   * Branches meet where the next statement begins, not at `endif`: a decision
   * whose branches both `stop` has no merge, and inventing one would add a
   * node the diagram does not have. So the merge is created lazily, on the
   * first statement after the block.
   */
  const flushPending = () => {
    if (!pending) return;
    const { tails, kind } = pending;
    pending = null;
    const meet = node(kind, '');
    for (const b of tails) edge(b, meet);
    tail = meet;
  };
  const pushNode = (kind, name, extra = {}) => {
    flushPending();
    const el = node(kind, name, extra);
    edge(tail, el, pendingLabel);
    pendingLabel = '';
    tail = el;
    return el;
  };

  for (const { text, no } of lines) {
    let t = text.trim();
    if (!t) continue;
    if (t.startsWith("'")) { readComment(rd, t, no); continue; }
    const ignored = IGNORED_PREFIXES.find(([p]) => t.toLowerCase().startsWith(p));
    if (ignored) {
      if (ignored[1]) rd.warn(no, t, `${ignored[1]} — пропущено`);
      continue;
    }
    if (/^title\b/i.test(t)) continue;
    // `if (a) then when (b)` is PlantUML's older spelling of `then (b)`.
    t = t.replace(/\bthen\s+when\s*\(/i, 'then (');
    // `-[#red]->` is `->` with a colour; the colour has no slot in the model.
    t = t.replace(/-\[[^\]]*\]/g, '');

    // `swimlane L` declares a lane without entering it; `|L|` enters it.
    const laneKw = t.match(/^swimlane\s+(.+)$/i);
    if (laneKw) {
      const name = laneKw[1].trim();
      if (!laneEls.some((x) => x.name === name)) laneEls.push(rd.element(undefined, 'swimlane', name));
      continue;
    }

    // Swimlanes: `|Name|` (empty means "stay in the current one").
    if (/^\|[^|]*\|$/.test(t)) {
      const name = t.slice(1, -1).trim();
      if (!name) continue;
      let el = laneEls.find((x) => x.name === name);
      if (!el) {
        el = rd.element(undefined, 'swimlane', name);
        laneEls.push(el);
      }
      lane = el;
      continue;
    }

    if (/^start;?$/i.test(t)) { pushNode('initial', ''); continue; }
    if (/^stop;?$/i.test(t) || /^end$/i.test(t)) {
      pushNode('final', '');
      tail = null;                       // the branch ends here
      continue;
    }
    if (/^detach$/i.test(t) || /^kill$/i.test(t)) { tail = null; continue; }

    // `#red :Do work;` (colour) and `[[http://x]] :Do work;` (link) — an action
    // with style in front of it.
    const actionText = t.replace(/^#[\w;-]+\s*(?=:)/, '').replace(/^\[\[[^\]]*\]\]\s*/, '');

    // `:text;` — one action. A trailing `|` or `}` closes a branch.
    if (/^:/.test(actionText)) {
      const m = actionText.match(/^:([\s\S]*?);?\s*\|?\s*\}?\s*$/);
      const name = m ? m[1].trim() : actionText.slice(1).trim();
      pushNode('action', name);
      continue;
    }

    // `if (cond) then (label)` / `if (cond)` / `elseif` / `else` / `endif`
    let m = t.match(/^if\s*\(([\s\S]*?)\)\s*(?:(?:then|is)\s*(?:\(([\s\S]*)\))?)?\s*$/i);
    if (m) {
      flushPending();
      const dec = node('decision', '');
      edge(tail, dec, pendingLabel);
      pendingLabel = '';
      open.push({ dec, branchTails: [], label: m[2] ? m[2].trim() : '', kind: 'if' });
      tail = dec;
      pendingLabel = m[2] ? m[2].trim() : '';   // the label of the first branch
      continue;
    }
    m = t.match(/^else\s*if\s*\(([\s\S]*?)\)\s*(?:(?:then|is)\s*(?:\(([\s\S]*)\))?)?\s*$/i);
    if (m) {
      const scope = open[open.length - 1];
      if (!scope || scope.kind !== 'if') { rd.warn(no, t, '«else if» без «if»'); continue; }
      scope.branchTails.push(tail);
      tail = scope.dec;
      scope.label = m[2] ? m[2].trim() : '';
      pendingLabel = scope.label;
      continue;
    }
    m = t.match(/^else\s*(?:\(([\s\S]*)\))?\s*$/i);
    if (m) {
      const scope = open[open.length - 1];
      if (!scope || scope.kind !== 'if') { rd.warn(no, t, '«else» без «if»'); continue; }
      scope.branchTails.push(tail);
      tail = scope.dec;
      scope.label = m[1] ? m[1].trim() : '';
      pendingLabel = scope.label;
      continue;
    }
    if (/^endif$/i.test(t)) {
      const scope = open.pop();
      if (!scope) { rd.warn(no, t, '«endif» без «if»'); continue; }
      scope.branchTails.push(tail);
      pendingLabel = '';
      pending = { tails: scope.branchTails, kind: 'merge' };
      tail = null;
      continue;
    }

    // `while (cond)` / `endwhile`
    m = t.match(/^while\s*\(([\s\S]*?)\)/i);
    if (m) {
      flushPending();
      const dec = node('decision', '');
      edge(tail, dec, pendingLabel);
      pendingLabel = '';
      open.push({ dec, branchTails: [], kind: 'while' });
      tail = dec;
      continue;
    }
    if (/^endwhile$/i.test(t)) {
      const scope = open.pop();
      if (!scope) { rd.warn(no, t, '«endwhile» без «while»'); continue; }
      if (tail) edge(tail, scope.dec);          // the loop back
      pending = { tails: [scope.dec], kind: 'merge' };
      tail = null;
      continue;
    }

    // `split` is `fork` under another name (the bars differ only in where the
    // branches go), so both spell the same element.
    t = t.replace(/^split$/i, 'fork').replace(/^split\s+again$/i, 'fork again')
      .replace(/^end\s*split$/i, 'end fork');

    // `fork` / `fork again` / `end fork`
    if (/^fork$/i.test(t)) {
      flushPending();
      const fork = node('fork', '');
      edge(tail, fork, pendingLabel);
      pendingLabel = '';
      open.push({ dec: fork, branchTails: [], kind: 'fork' });
      tail = fork;
      continue;
    }
    if (/^fork\s+again$/i.test(t)) {
      const scope = open[open.length - 1];
      if (!scope || scope.kind !== 'fork') { rd.warn(no, t, '«fork again» без «fork»'); continue; }
      scope.branchTails.push(tail);
      tail = scope.dec;
      continue;
    }
    if (/^end\s*fork$/i.test(t)) {
      const scope = open.pop();
      if (!scope) { rd.warn(no, t, '«end fork» без «fork»'); continue; }
      scope.branchTails.push(tail);
      pending = { tails: scope.branchTails, kind: 'join' };
      tail = null;
      continue;
    }

    // `-> label;` — an edge of a flat chain (the exporter's cycle fallback).
    m = t.match(/^->\s*(.*?);?\s*$/);
    if (m) {
      if (tail) {
        if (pendingLabel) rd.warn(no, t, 'вторая подпись перехода подряд — прочитана первая');
        else pendingLabel = m[1].trim();
      } else rd.warn(no, t, 'переход без предыдущего узла — пропущен');
      continue;
    }

    // Notes.
    m = t.match(/^note\s+(?:right|left|top|bottom)\s*:\s*([\s\S]*)$/i);
    if (m) {
      const el = rd.element(undefined, 'note', '');
      el.documentation = m[1].trim();
      if (lane) el.lane = lane.id;
      continue;
    }

    rd.warn(no, t, 'не понята конструкция — строка пропущена');
  }

  void title;
  return { lanes: laneEls };
}

/* -------------------------------------------------------------- state */

/** State grammar (`state`, `state-as`, `[*]`, `state-transition`). */
function parseState(rd, lines, title) {
  let parent = null;
  let noteBuf = null;              // `note as X` … `end note`
  const stack = [];

  for (const { text, no } of lines) {
    const t = text.trim();
    if (!t) continue;
    if (t.startsWith("'")) { readComment(rd, t, no); continue; }
    const ignored = IGNORED_PREFIXES.find(([p]) => t.toLowerCase().startsWith(p));
    if (ignored) {
      if (ignored[1]) rd.warn(no, t, `${ignored[1]} — пропущено`);
      continue;
    }
    if (/^title\b/i.test(t)) continue;

    if (t === '}' || /^end\s+state$/i.test(t)) {
      stack.pop();
      parent = stack.length ? stack[stack.length - 1] : null;
      continue;
    }

    // `state X as "Name" <<choice>>` / `state "Name" as X`
    // `state Foo : entry / x` — a state and one line inside it.
    const described = t.match(/^state\s+((?:"[^"]*"|\S+)(?:\s+as\s+(?:"[^"]*"|\S+))?)\s*:\s*([\s\S]*)$/i);
    if (described) {
      const spec2 = parseNameSpec(described[1].trim());
      const alias2 = spec2?.alias ?? spec2?.name;
      const el2 = rd.element(alias2, 'state', captionOf(spec2) || alias2);
      const body2 = described[2].trim();
      const em2 = body2.match(/^(entry|do|exit)\s*\/\s*([\s\S]*)$/i);
      if (em2) {
        const field2 = em2[1].toLowerCase();
        if (!Array.isArray(el2[field2])) el2[field2] = [];
        el2[field2].push(em2[2].trim());
      } else {
        if (!Array.isArray(el2.internals)) el2.internals = [];
        el2.internals.push({ text: body2 });
      }
      continue;
    }

    let m = t.match(/^state\s+([\s\S]+?)\s*(?:\{|begin\s*)$/i);
    let opens = Boolean(m);
    if (!m) m = t.match(/^state\s+([\s\S]+?)\s*$/i);
    if (m && /:/.test(m[1]) && !/^state\s+"[^"]*"/.test(t)) m = null;   // `state A : entry / x`
    if (m && !/^state\s+(\*)/.test(t)) {
      const { text: tail, stereotypes } = takeStereotypes(m[1]);
      const spec = parseNameSpec(tail);
      if (!spec || (!spec.alias && !spec.name)) { rd.warn(no, t, 'состояние без имени'); continue; }
      const st = stereotypes[0] ?? null;
      const kind = (st && STATE_BY_STEREO[st]) || 'state';
      const alias = spec.alias ?? spec.name;
      const el = rd.element(alias, kind, captionOf(spec));
      if (st && !STATE_BY_STEREO[st]) el.stereotype = st;
      if (parent) el.ownerId = parent.id;
      if (opens) { stack.push(el); parent = el; }
      continue;
    }

    // `X : entry / e`, `X : do / e`, `X : exit / e`, `X : trigger[guard]/effect`
    m = t.match(/^([\w.\u0400-\u04FF]+)\s*:\s*([\s\S]*)$/);
    if (m && !/^\*/.test(t)) {
      const el = rd.byAlias.get(m[1]);
      if (!el) { rd.warn(no, t, `состояние «${m[1]}» не объявлено`); continue; }
      const body = m[2].trim();
      const em = body.match(/^(entry|do|exit)\s*\/\s*([\s\S]*)$/i);
      if (em) {
        const field = em[1].toLowerCase();
        if (!Array.isArray(el[field])) el[field] = [];
        el[field].push(em[2].trim());
        continue;
      }
      if (!Array.isArray(el.internals)) el.internals = [];
      el.internals.push({ text: body });
      continue;
    }

    // `note as X` … `end note`
    const noteM = t.match(/^note\s+(?:as\s+)?(\S+)?\s*$/i);
    if (noteM && !noteM[1]?.includes(':')) {
      const alias = noteM[1] && !noteM[1].startsWith('<<') ? noteM[1] : undefined;
      const el = rd.element(alias, 'note', '');
      el.__noteLines = [];
      noteBuf = el;
      continue;
    }
    if (/^end\s*note$/i.test(t)) { noteBuf = null; continue; }
    if (noteBuf) { noteBuf.__noteLines.push(t); continue; }

    // Transitions, including `[*] --> X` and `X --> [*]`.
    const { masked, parts } = maskQuotes(t);
    const arrow = findArrow(masked);
    if (!arrow) { rd.warn(no, t, 'не понята конструкция — строка пропущена'); continue; }
    const leftRaw = masked.slice(0, arrow.at).trim();
    const rightRaw = masked.slice(arrow.at + arrow.form.length);
    const labelM = rightRaw.match(/\s*:\s*([\s\S]*)$/);
    const label = labelM ? unmask(labelM[1], parts).trim() : '';
    const right = (labelM ? rightRaw.slice(0, labelM.index) : rightRaw).trim();

    const from = stateEnd(rd, leftRaw, parts, no, t, 'initial');
    const to = stateEnd(rd, right, parts, no, t, 'final');
    if (!from || !to) continue;
    rd.relationship('transition', from, to, { name: label });
  }
  void title;
}

function stateEnd(rd, raw, parts, no, t, pseudoKind = 'initial') {
  // `A[H] --> B` starts the transition at A's history pseudostate; the name is
  // still A, so the suffix is dropped and the history is noted.
  let text = unmask(String(raw ?? '').trim(), parts);
  const hist = text.match(/^(.*?)\[(H\*?)\]$/);
  if (hist) {
    text = hist[1].trim();
    rd.byAlias.get(text) ?? null;
  }
  // `[*] --> X` is the entry point, `X --> [*]` the exit: one spelling, two
  // meanings, told apart by the side it stands on.
  if (text === '[*]') return rd.pseudo(pseudoKind);
  const spec = parseNameSpec(text);
  const alias = spec?.alias ?? spec?.name;
  const known = alias ? rd.byAlias.get(alias) : null;
  if (known) return known;
  const made = declareUnknown(rd, alias, 'state');
  if (made) return made;
  if (/^\[\*\]$/.test(text)) return rd.pseudo(pseudoKind);
  rd.warn(no, t, `состояние «${alias ?? text}» не объявлено — переход пропущен`);
  return null;
}

/* ----------------------------------------------------------------- api */

/**
 * Read a `.puml` file into a model.
 *
 * @param {string} text the file contents
 * @param {{fileName?: string}} [opts] `fileName` names the sheet when the file
 *   has no `title`
 * @returns {{model: object, warnings: Array<{line:number,text:string,reason:string}>, frames: Array<object>}}
 */
export function parse(text, opts = {}) {
  const rd = new Reader(opts);
  const blocks = blocksOf(text);
  const frames = [];
  const sheets = [];              // which elements each @startuml block brought

  for (const block of blocks) {
    if (block.unterminated) rd.warn(block.startLine, '@startuml', 'блок не закрыт `@enduml` — прочитано до конца файла');
    const lines = block.lines;
    const family = familyOfBlock(lines);
    let title = block.caption || '';
    for (const { text: t } of lines) {
      const m = t.trim().match(/^title\s+([\s\S]*)$/i);
      if (m) title = m[1].trim();
    }
    const before = rd.model.elements.length;
    rd.family = family;
    if (family === 'sequence') {
      const diagram = rd.newDiagram(title || opts.fileName || 'Диаграмма последовательности', 'sequence');
      const res = parseSequence(rd, lines, title);
      for (const f of res.frames) frames.push({ ...f, diagramId: diagram.id });
    } else if (family === 'activity') {
      rd.newDiagram(title || opts.fileName || 'Диаграмма деятельности', 'activity');
      parseActivity(rd, lines, title);
    } else if (family === 'state') {
      rd.newDiagram(title || opts.fileName || 'Диаграмма состояний', 'state');
      parseState(rd, lines, title);
    } else {
      rd.newDiagram(title || opts.fileName || 'Диаграмма классов', 'class');
      parseStructural(rd, lines, title);
      const added = rd.model.elements.slice(before);
      rd.diagram.kind = structuralDiagramKind(added);
    }
    if (rd.diagram) {
      sheets.push({
        diagramId: rd.diagram.id,
        elementIds: rd.model.elements.slice(before).map((e) => e.id),
      });
    }
  }

  // A block with nothing in it still gives a sheet, so the import always has
  // somewhere to put shapes.
  if (!rd.model.diagrams.length) rd.newDiagram(opts.fileName || 'Диаграмма', 'class');

  // Temporary pointers the parsers used (`__inside`, `__noteBody`, …) never
  // reach the model: every field starting with `__` is an implementation
  // detail, and a note's collected lines become its documentation.
  for (const el of rd.model.elements) {
    const body = el.__noteBody ?? el.__noteLines;
    if (Array.isArray(body) && body.length && !isStr(el.documentation)) {
      el.documentation = body.join('\n').trim();
    }
    for (const key of Object.keys(el)) if (key.startsWith('__')) delete el[key];
    if (!isStr(el.name)) el.name = '';
    if (el.stereotype === undefined) el.stereotype = null;
  }
  for (const rel of rd.model.relationships) {
    delete rel.__index;
    if (!Array.isArray(rel.taggedValues)) rel.taggedValues = [];
  }

  return { model: rd.model, warnings: rd.warnings, frames, blocks: sheets };
}

