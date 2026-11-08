// The model: elements and relationships (what exists) and diagrams (how it is
// shown).
//
// `uml-model/3` splits three things:
//
//   element       name, kind, stereotype, stereotypeId, documentation, members,
//                 tagged values — ONE row in MODEL_ELEMENT, however many views
//   relationship  the semantic connection between two ELEMENTS (association,
//                 transition, message …) — it lives in the model, not on a diagram,
//                 and may be shown on several diagrams
//   shape / link  the VIEW on one diagram: geometry and the two endpoints
//
// Consequences, and the reason for the split:
//   * rename an element once — every diagram shows the new name;
//   * delete a shape (`Delete`) — the element and its relationships stay;
//   * delete an element (`Shift+Delete`) — its views, its relationships and
//     their views go too, on every diagram;
//   * a relationship can be drawn on a second diagram without being a second
//     relationship.
//
// `stereotype` is the name that is drawn and that survives a missing profile;
// `stereotypeId` is the optional reference to the profile record — the tie
// breaker when one name covers more than one definition. Both are absent by
// default, and a file without them re-saves byte for byte.
//
// Members are four fields, not a line of mini-language:
//   { vis: 'public'|'private'|'protected'|'package', name, type, default }
// `default` is the UML `= value` that follows the type. An operation keeps its
// signature in `name` (`updateStudent(st:Student)`) and its return type in
// `type`, so attributes and operations share one row shape and one table.

import { NOTATION, VISIBILITIES, visByKey } from './notation.js';
import { uid } from '../util.js';

export const SCHEMA = 'uml-model/3';
export const MEMBER_FIELDS = ['attributes', 'operations', 'literals', 'slots'];

/**
 * UML 2.5.1 §9.4 (Feature) and §9.5.3 (Property): a member may be static,
 * derived or an identifying attribute. They are three independent booleans on
 * the row, not letters typed into the name — the sheet draws the marks, the
 * file stores the meaning.
 */
export const MEMBER_FLAGS = [
  { key: 'isStatic', short: 'S', title: 'Статический: имя подчёркнуто' },
  { key: 'isDerived', short: '/', title: 'Производный: «/» перед именем' },
  { key: 'isID', short: '{id}', title: 'Идентификатор: «{id}» после имени' },
  // BehavioralFeature::isAbstract (§9.9.2, §9.6.4). Only operations carry it:
  // Property is a StructuralFeature, where the standard has no isAbstract, so
  // the attribute table must not show this box (`only`). No `short`: the
  // standard shows abstractness by italics, not by a letter in the row.
  { key: 'isAbstract', only: 'operations', title: 'Абстрактная: имя курсивом' },
];

/**
 * UML 2.5.1 §9.2: only classifiers can be abstract. The list is not
 * «everything with a name»: it is every notation kind whose metaclass names
 * Classifier (directly or through a chain) in its «Обобщения» section. The
 * mapping, one group per chain, is in the comment below — a kind that is not
 * here has no Classifier among its parents (a note, a state, an action, a
 * lifeline, an instance, a package).
 *
 *   class, interface, datatype, enumeration      → Classifier / DataType
 *   stereotype, metaclass                        → Class → … → Classifier
 *   component, node, device, executionEnvironment → Class → … → Classifier
 *   artifact, deploymentSpec                     → Classifier / Artifact
 *   actor, usecase, activity, interaction, collaboration
 *                                                → BehavioredClassifier → Classifier
 *   association, aggregation, composition, communicationPath
 *                                                → Association → Classifier
 *
 * `aggregation` and `composition` are not metaclasses of their own: they are
 * Association with an aggregation kind, so they inherit Association's
 * Classifier parent. `communicationPath` is an Association subclass (§19.5.2).
 */
export const ABSTRACTABLE = new Set([
  'class', 'interface', 'datatype', 'enumeration', 'stereotype', 'metaclass',
  'component', 'node', 'device', 'executionEnvironment', 'artifact', 'deploymentSpec',
  'actor', 'usecase', 'activity', 'interaction', 'collaboration',
  'association', 'aggregation', 'composition', 'communicationPath',
]);
export const isAbstractable = (kind) => ABSTRACTABLE.has(kind);

/** Association-end properties (UML 2.5.1 §11.5.3–11.5.4). */
export const NAVIGABILITIES = ['none', 'from', 'to', 'both'];
export const AGGREGATIONS = ['none', 'shared', 'composite'];

let nameSeq = {};
/** A fresh class is Class1, the next Class2 … */
export function nextName(kind) {
  nameSeq[kind] = (nameSeq[kind] || 0) + 1;
  const base = NOTATION.shapes[kind]?.label ?? 'Shape';
  return `${base}${nameSeq[kind]}`;
}

export function resetNameSeq() { nameSeq = {}; }

/* ------------------------------------------------------------- documents */

export function createDiagram(name = 'Диаграмма 1', kind = 'class', ownerElementId = null) {
  return {
    id: uid('d'),
    name,
    kind,
    ownerElementId,
    shapes: [],
    links: [],
  };
}

export function createModel(name = 'Новая модель') {
  const diagram = createDiagram('Диаграмма 1', 'class');
  return {
    schema: SCHEMA,
    id: uid('m'),
    name,
    created: new Date().toISOString().slice(0, 10),
    revised: '',
    elements: [],
    relationships: [],
    generalizationSets: [],
    // Stereotype drawings are on by default; the «Вид» menu turns them off.
    pictograms: true,
    diagrams: [diagram],
    currentDiagramId: diagram.id,
  };
}

/** The diagram the editor is on. Never null for a model built here. */
export function currentDiagram(m) {
  const list = Array.isArray(m.diagrams) ? m.diagrams : [];
  return list.find((d) => d.id === m.currentDiagramId) ?? list[0] ?? null;
}

export const findDiagram = (m, id) => (m.diagrams ?? []).find((d) => d.id === id) || null;

/** Diagrams whose owner is this element (a diagram belongs to an element). */
export const nestedDiagrams = (m, elementId) =>
  (m.diagrams ?? []).filter((d) => d.ownerElementId === elementId);

/* ------------------------------------------------------------- elements */

/** An empty member row. */
export function member(vis = 'public', name = '', type = '', def = '') {
  return { vis, name, type, default: def };
}

/** The fields a shape's compartments edit, from the notation package. */
export const compartmentsOf = (kind) => NOTATION.shapes[kind]?.compartments ?? [];

export function createElement(kind, { name } = {}) {
  const def = NOTATION.shapes[kind];
  if (!def) throw new Error(`Неизвестный тип элемента: ${kind}`);
  const element = {
    id: uid('e'),
    kind,
    name: name ?? (def.nameless ? '' : nextName(kind)),
    stereotype: def.stereotype ?? null,
    documentation: '',
    taggedValues: [],
  };
  // Compartments come from the package: it names the field each one edits.
  for (const c of compartmentsOf(kind)) {
    if (!Array.isArray(element[c.field])) element[c.field] = [];
  }
  if (def.wrap) element.note = '';
  if (def.style === 'frame') element.operator = def.operator ?? 'ref';
  if (def.style === 'timingLane') element.timeline = [{ state: 'Состояние', from: 0, to: 100 }];
  return element;
}

export const findElement = (m, id) => m.elements.find((e) => e.id === id) || null;
export const elementOf = (m, shape) => (shape ? findElement(m, shape.elementId) : null);

/* --------------------------------------------------------------- shapes */

/** A view of `element` on a diagram. Geometry only: meaning lives on the element. */
export function createShape(element, x, y, { w, h, fill } = {}) {
  const def = NOTATION.shapes[element.kind];
  return {
    id: uid('s'),
    elementId: element.id,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w ?? def?.defaultSize.w ?? 190),
    h: Math.round(h ?? def?.defaultSize.h ?? 120),
    fill: fill ?? null,
  };
}

/** Add a new element and show it on the current diagram. */
export function placeElement(m, kind, x, y, opts = {}) {
  const element = createElement(kind, opts);
  m.elements.push(element);
  const shape = createShape(element, x, y, opts);
  currentDiagram(m).shapes.push(shape);
  return { element, shape };
}

/** Show an element that already exists on the current diagram. */
export function showElement(m, element, x, y) {
  const shape = createShape(element, x, y);
  currentDiagram(m).shapes.push(shape);
  return shape;
}

export const shapesOf = (m, elementId) =>
  (m.diagrams ?? []).flatMap((d) => d.shapes.filter((s) => s.elementId === elementId));

export const findShape = (m, id) => currentDiagram(m)?.shapes.find((s) => s.id === id) || null;
export const findShapeIn = (m, diagramId, id) =>
  findDiagram(m, diagramId)?.shapes.find((s) => s.id === id) || null;

/* --------------------------------------------------------- relationships */

/**
 * The aggregation a connector kind implies at one of its ends. UML 2.5.1 keeps
 * aggregation on the association END, so a plain association is `none` at both
 * ends while the «Агрегация» and «Композиция» tools start with the diamond
 * already on the source end — that is what those tools are for.
 */
export function defaultAggregation(kind, end = 'from') {
  if (end !== 'from') return 'none';
  if (kind === 'aggregation') return 'shared';
  if (kind === 'composition') return 'composite';
  return 'none';
}

/** The effective aggregation at an end, defaulting from the connector kind. */
export const aggregationOf = (rel, end = 'from') => {
  const v = rel?.[end === 'from' ? 'fromAggregation' : 'toAggregation'];
  return AGGREGATIONS.includes(v) ? v : defaultAggregation(rel?.kind, end);
};

/** The effective navigability of an association (UML 2.5.1 §11.5.4). */
export const navigableOf = (rel) =>
  (NAVIGABILITIES.includes(rel?.navigable) ? rel.navigable : 'none');

/**
 * A relationship between two ELEMENTS. It is not tied to a diagram: the same
 * association can be shown on a Class diagram and again on a Package diagram,
 * and editing its name changes both views.
 */
export function createRelationship(kind, fromElementId, toElementId, name = '') {
  const def = NOTATION.connectors[kind];
  if (!def) throw new Error(`Неизвестный тип связи: ${kind}`);
  const rel = {
    id: uid('r'),
    kind,
    name,
    stereotype: def.keyword ?? null,
    documentation: '',
    taggedValues: [],
    from: fromElementId,
    to: toElementId,
    navigable: 'none',
    fromAggregation: defaultAggregation(kind, 'from'),
    toAggregation: defaultAggregation(kind, 'to'),
  };
  // Кратность концов (D12). Заводская «1» у источника была не смыслом, а
  // привычкой: на диаграмме вариантов использования ассоциация «актёр —
  // вариант» означает участие, а не «ровно один», и лишняя «1» на линии —
  // ложное утверждение о модели. Подразумеваемую единицу не
  // рисуют. Поэтому поле остаётся ПУСТЫМ и в файл не пишется (umljson.js
  // пишет кратность только непустой), а явную кратность человек задаёт в
  // инспекторе — тогда она и попадает в файл.
  //
  // Замер до правки: 36 из 715 связей корпуса (18 файлов) хранят
  // fromMultiplicity='1'. Это ФАЙЛЫ — их читает deserialize, а не
  // createRelationship, поэтому круг «файл → модель → файл» не двигается;
  // проверено corpus 9/9, recovery 14/14, эталон old-v3.json 4611 Б.
  if (def.multiplicity) {
    rel.fromMultiplicity = '';
    rel.toMultiplicity = '';
  }
  if (def.roles) {
    rel.fromRole = '';
    rel.toRole = '';
  }
  return rel;
}

/* ------------------------------------------------------------- ownership */

/**
 * Владение элементом (UML 2.5.1 §12.2, §11.4.6): `ownerId` — поле ЭЛЕМЕНТА,
 * а не пакета. Списка детей в файле нет: он вычисляется, иначе два источника
 * истины разъедутся при первом же переносе.
 *
 * Отсутствие поля означает «верхний уровень» — читатель не подставляет null.
 * Удаление владельца НЕ удаляет детей: `ownerId` снимается, элементы
 * всплывают наверх (иначе удаление пакета молча уносило бы модель).
 */
export const OWNER_KINDS = new Set([
  'package', 'model', 'profile', 'component', 'node', 'device',
  'executionEnvironment', 'class', 'interface', 'artifact',
]);

export const ownerOf = (m, element) => (element?.ownerId ? findElement(m, element.ownerId) : null);
export const childrenOf = (m, id) => (m.elements ?? []).filter((e) => e.ownerId === id);
export const rootsOf = (m) => (m.elements ?? []).filter((e) => !e.ownerId || !findElement(m, e.ownerId));

/** Everything the element contains, transitively — the set a new owner may not be in. */
export function descendantsOf(m, id) {
  const out = new Set();
  const walk = (parent) => {
    for (const child of childrenOf(m, parent)) {
      if (out.has(child.id)) continue;
      out.add(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** Owners an element may be given: not itself, not its own descendant. */
export const ownerCandidates = (m, element) => {
  const inside = descendantsOf(m, element.id);
  return (m.elements ?? []).filter((e) => e.id !== element.id && !inside.has(e.id)
    && OWNER_KINDS.has(e.kind));
};

/** `Пакет «Домен» / Компонент «Ядро»` — the inspector's read-only path. */
export function ownerPath(m, element) {
  const names = [];
  const seen = new Set();
  let cur = ownerOf(m, element);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name || cur.id);
    cur = ownerOf(m, cur);
  }
  return names.join(' / ');
}

/**
 * Give the element an owner. A cycle is refused (`false`) instead of written:
 * the owner chain is what the model tree walks, and a loop would hang it.
 */
export function setOwner(m, element, ownerId) {
  if (!element) return false;
  if (!ownerId) { delete element.ownerId; return true; }
  if (ownerId === element.id) return false;
  if (!findElement(m, ownerId)) return false;
  if (descendantsOf(m, element.id).has(ownerId)) return false;
  element.ownerId = ownerId;
  return true;
}

/**
 * Владелец ДИАГРАММЫ (§3.1, `ownerElementId`): лист принадлежит элементу
 * модели и виден под ним в дереве. Пособие (упр. 4.3.3) требует переносить
 * уже созданную диаграмму: «сначала создали Interaction Use, а затем
 * диаграмму — среда помещает её в корень, переместите её на подобающее
 * место». До этой функции владельца можно было задать только при создании.
 *
 * Отказ (`false`) один и по делу: элемент, показанный на самой диаграмме,
 * не может ею владеть — лист оказался бы внутри своего же содержимого.
 * Пустой `elementId` возвращает лист в корень: это не ошибка и не потеря.
 */
export function setDiagramOwner(m, diagramId, elementId) {
  const d = (m.diagrams ?? []).find((x) => x.id === diagramId);
  if (!d) return false;
  if (!elementId) { delete d.ownerElementId; return true; }
  if (!findElement(m, elementId)) return false;
  if ((d.shapes ?? []).some((s) => s.elementId === elementId)) return false;
  d.ownerElementId = elementId;
  return true;
}

/** Кандидаты в владельцы диаграммы: все элементы, кроме показанных на ней. */
export function diagramOwnerCandidates(m, diagram) {
  const inside = new Set((diagram?.shapes ?? []).map((s) => s.elementId));
  return (m.elements ?? []).filter((e) => !inside.has(e.id));
}


/* --------------------------------------------------- messages, operands */

/**
 * A message is a RELATIONSHIP, not a shape (§17.4): its ends may be missing —
 * a found message has no sender, a lost message has no receiver.
 */
export const messageKind = (kind) => !!NOTATION.connectors[kind]?.sequence;
export const isMessage = (rel) => messageKind(rel?.kind);

/**
 * Порядок сообщений (§3.2). Без `seq` порядок задаёт геометрия: верхнее —
 * первое. Как только `seq` есть хотя бы у одного сообщения диаграммы, он
 * главный для всех; сообщения без `seq` получают порядок по геометрии и идут
 * после нумерованных.
 */
export function messageOrder(diagram, model) {
  const rows = (diagram?.links ?? [])
    .map((l) => ({ l, rel: relOf(model, l) }))
    .filter(({ rel }) => isMessage(rel));
  const y = ({ l }) => (l.y == null ? Infinity : Number(l.y));
  const seqOf = ({ rel }) => (Number.isFinite(Number(rel?.seq)) ? Number(rel.seq) : null);
  const withSeq = rows.filter((r) => seqOf(r) != null);
  const rest = rows.filter((r) => seqOf(r) == null).sort((a, b) => y(a) - y(b));
  const ordered = withSeq.length
    ? [...withSeq.sort((a, b) => (seqOf(a) - seqOf(b)) || (y(a) - y(b))), ...rest]
    : rest;
  const map = new Map();
  ordered.forEach(({ l }, i) => map.set(l.id, { index: i, seq: seqOf(ordered[i]) }));
  return map;
}

/** The free end of a found/lost message: `null` end, not an empty string. */
export const endIsFree = (rel, end = 'to') => rel?.[end] == null;

/** Внутренние переходы состояния (§14.5.10): без исходного и целевого. */
export const internalsOf = (el) => (Array.isArray(el?.internals) ? el.internals : []);

/* --------------------------------------------------------------- regions */

/**
 * Регион — часть элемента: у составного состояния (§14.5.9) и у
 * структурированного узла деятельности (§15.3.4). Членов региона хранит
 * сам регион, а не они его: узел называет регион один раз, и перенос узла
 * не оставляет позади второй список.
 *
 * План (§3.6, §3.7) называет членов по-разному — `nodes` у деятельности,
 * `states` у состояния. Читаются оба имени, пишется то, что задал вид
 * элемента: это не два поля, а одно понятие.
 */
export const regionsOf = (el) => (Array.isArray(el?.regions) ? el.regions : []);
export const regionMembers = (r) => [
  ...(Array.isArray(r?.nodes) ? r.nodes : []),
  ...(Array.isArray(r?.states) ? r.states : []),
];
export const regionEdges = (r) => [
  ...(Array.isArray(r?.edges) ? r.edges : []),
  ...(Array.isArray(r?.transitions) ? r.transitions : []),
];
export const findRegion = (el, id) => regionsOf(el).find((r) => r.id === id) || null;

/** Regions an element belongs to, across the model. */
export const regionsOfElement = (m, elementId) => (m.elements ?? [])
  .flatMap((owner) => regionsOf(owner)
    .filter((r) => regionMembers(r).includes(elementId))
    .map((region) => ({ owner, region })));

export function createRegion(name = '', kind = 'activity') {
  return kind === 'state'
    ? { id: uid('g'), name, states: [], transitions: [] }
    : { id: uid('g'), name, nodes: [], edges: [] };
}

/* ------------------------------------------------------------ qualifiers */

/** Квалификатор полюса ассоциации (§11.4.4): список строк у конца связи. */
export const qualifiersOf = (rel, end = 'from') => {
  const v = rel?.[end === 'from' ? 'fromQualifiers' : 'toQualifiers'];
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
};

/* ------------------------------------------------- generalization sets */

/**
 * UML 2.5.1 §9.7: a GeneralizationSet groups generalizations and carries the
 * `isCovering` / `isDisjoint` constraints, drawn as `{complete, disjoint}`.
 * The set is an entity of the model, not a label on one arrow: several
 * arrows may belong to it, and the label is drawn once per arrow.
 */
export function createGeneralizationSet(name = 'Набор обобщений') {
  return { id: uid('gs'), name, disjoint: false, covering: false };
}

export const generalizationSetsOf = (m) => (Array.isArray(m.generalizationSets) ? m.generalizationSets : []);

export const findGeneralizationSet = (m, id) =>
  generalizationSetsOf(m).find((s) => s.id === id) || null;

/** The set a generalization belongs to, or null. */
export const setOfRelationship = (m, rel) =>
  (rel?.setId ? findGeneralizationSet(m, rel.setId) : null);

/** `{complete, disjoint}` — the constraint list UML prints on the arrow. */
export function generalizationSetLabel(set) {
  const parts = [];
  if (set?.covering) parts.push('complete');
  if (set?.disjoint) parts.push('disjoint');
  if (!parts.length) return set?.name ? `{${set.name}}` : '';
  return `{${parts.join(', ')}}`;
}

export const findRelationship = (m, id) => m.relationships.find((r) => r.id === id) || null;

/** The relationship a link view shows. */
export const relOf = (m, link) => (link ? findRelationship(m, link.relId) : null);

/**
 * Which end of the RELATIONSHIP a view end stands for — «from» or «to» — or
 * null when the shape is not part of this relationship at all.
 *
 * The view's `from`/`to` is only «where the line was pulled from»: dragging an
 * end onto another shape rewrites it, and such a file can perfectly well have
 * the line drawn from B to A while the model says A → B. Aggregation and
 * navigability belong to the MODEL's ends, so the drawing asks this first and
 * only then asks `aggregationOf` / `navigableOf`. That is what keeps the
 * diamond on its semantic end, wherever the gesture started.
 */
export function semanticEndOf(diagram, link, rel, end) {
  if (!rel) return null;
  const shape = (diagram?.shapes ?? []).find((s) => s.id === link?.[end]?.shapeId);
  const el = shape?.elementId ?? null;
  if (!el) return null;
  // A self-relationship has both ends on one element: the view's own order is
  // then the only thing that tells them apart.
  if (rel.from === rel.to) return end;
  if (el === rel.from) return 'from';
  if (el === rel.to) return 'to';
  return null;
}

/** Every link view of a relationship, across diagrams. */
export const linksOf = (m, relId) =>
  (m.diagrams ?? []).flatMap((d) => d.links.filter((l) => l.relId === relId).map((l) => ({ d, l })));

/** Relationships touching an element. */
export const relsOfElement = (m, elementId) =>
  m.relationships.filter((r) => r.from === elementId || r.to === elementId);

/**
 * A view of `rel` between two shapes on the current diagram. `from`/`to` are
 * the endpoint records { shapeId, side, t }; a sequence message also carries
 * the y it is drawn at, because its order is its vertical position.
 */
export function createLink(rel, from, to, extra = {}) {
  return {
    id: uid('l'),
    relId: rel.id,
    from,
    to,
    route: 'rect',
    // No `waypoints` and no `rounded`: a fresh link takes the automatic route
    // with square corners, and only a person's edit adds either field — that
    // is what keeps an untouched file byte-identical on re-save.
    ldx: 0,
    ldy: 0,
    ...extra,
  };
}

export const findLink = (m, id) => currentDiagram(m)?.links.find((l) => l.id === id) || null;

/* --------------------------------------------------------------- views */

/** Take the shape's view off the current diagram. The element stays. */
export function removeShape(m, id) {
  const d = currentDiagram(m);
  if (!d) return;
  d.shapes = d.shapes.filter((s) => s.id !== id);
  d.links = d.links.filter((l) => l.from?.shapeId !== id && l.to?.shapeId !== id);
}

/** Take one link view off the current diagram. The relationship stays. */
export function removeLink(m, id) {
  const d = currentDiagram(m);
  if (d) d.links = d.links.filter((l) => l.id !== id);
}

/** Delete the relationship itself: every view of it, on every diagram. */
export function removeRelationship(m, id) {
  for (const d of m.diagrams ?? []) d.links = d.links.filter((l) => l.relId !== id);
  m.relationships = m.relationships.filter((r) => r.id !== id);
}

/**
 * Remove the element itself: every view of it, every relationship it takes
 * part in, and the diagrams it owns.
 *
 * Children do NOT go with it (§3.1): their `ownerId` is dropped and they
 * surface at the top level. Deleting a package that silently carried the model
 * away is the one thing the plan forbids outright.
 */
export function removeElement(m, id) {
  const owned = new Set((m.diagrams ?? []).filter((d) => d.ownerElementId === id).map((d) => d.id));
  const gone = new Set();
  for (const d of m.diagrams ?? []) {
    for (const s of d.shapes) if (s.elementId === id) gone.add(s.id);
    d.shapes = d.shapes.filter((s) => s.elementId !== id);
  }
  for (const d of m.diagrams ?? []) {
    d.links = d.links.filter((l) => !gone.has(l.from?.shapeId) && !gone.has(l.to?.shapeId));
  }
  m.relationships = m.relationships.filter((r) => r.from !== id && r.to !== id);
  const alive = new Set(m.relationships.map((r) => r.id));
  for (const d of m.diagrams ?? []) d.links = d.links.filter((l) => alive.has(l.relId));
  for (const child of childrenOf(m, id)) delete child.ownerId;
  m.elements = m.elements.filter((e) => e.id !== id);
  // Ссылки на ушедший элемент снимаются здесь же: поле, указывающее в пустоту,
  // — это потеря смысла, а не «пустое значение».
  for (const e of m.elements) {
    if (e.laneId === id) delete e.laneId;
    if (e.represents === id) delete e.represents;
    if (e.behaviorRef === id) delete e.behaviorRef;
    if (e.classifierId === id) delete e.classifierId;
    if (e.refersTo === id) delete e.refersTo;
    for (const r of regionsOf(e)) {
      if (Array.isArray(r.nodes)) r.nodes = r.nodes.filter((x) => x !== id);
      if (Array.isArray(r.states)) r.states = r.states.filter((x) => x !== id);
    }
  }
  if (owned.size) {
    m.diagrams = m.diagrams.filter((d) => !owned.has(d.id));
    if (owned.has(m.currentDiagramId)) m.currentDiagramId = m.diagrams[0]?.id ?? null;
  }
}

/** Delete a diagram (and, if it was open, move to another one). */
export function removeDiagram(m, id) {
  const gone = (m.diagrams ?? []).find((d) => d.id === id);
  if (!gone) return;
  m.diagrams = m.diagrams.filter((d) => d.id !== id);
  if (m.currentDiagramId === id) m.currentDiagramId = m.diagrams[0]?.id ?? null;
  // Diagrams owned by an element are gone with it; a nested diagram removed
  // on its own leaves the element alone.
  return gone;
}

/** Move a shape and keep its connectors attached (they route from edges). */
export function moveShape(s, x, y) {
  s.x = Math.round(x);
  s.y = Math.round(y);
}

export function resizeShape(s, x, y, w, h, kind = null) {
  const def = NOTATION.shapes[kind ?? ''] ?? null;
  s.x = Math.round(x);
  s.y = Math.round(y);
  s.w = Math.max(8, Math.round(w));
  s.h = Math.max(def?.wrap ? 40 : (def?.style === 'bar' ? 8 : 20), Math.round(h));
  // The dragged height becomes the box's floor: the layout keeps honouring it
  // after the text changes, so a resize is not undone by the next repaint.
  s.fixedH = true;
}

/* -------------------------------------------------------------- members */

/**
 * Parse one member line the way the sheet and the inline editor carry it:
 * an optional visibility symbol (+ - # ~), then `name: type = default`.
 * The type is taken from the LAST colon, so `updateStudent(st:Student):bool`
 * keeps its parameter and splits only the return type off.
 *
 * The UML marks are accepted here too — a leading `/` means derived and a
 * trailing `{id}` means identifying — so typing them on the sheet works. Only
 * `true` is ever returned for a flag: an absent mark must not clear a flag the
 * inspector set (the row is merged, not replaced).
 */
export function parseMemberLine(line) {
  let text = String(line ?? '').trim();
  const flags = {};
  let vis = 'public';
  if (text) {
    const v = VISIBILITIES.find((x) => x.symbol === text[0]);
    if (v && (text.length === 1 || text[1] === ' ')) {
      vis = v.key;
      text = text.slice(1).trim();
    }
  }
  if (text.startsWith('/')) {
    flags.isDerived = true;
    text = text.slice(1).trim();
  }
  if (/\{id\}$/i.test(text)) {
    flags.isID = true;
    text = text.replace(/\{id\}$/i, '').trim();
  }
  let def = '';
  const eq = text.lastIndexOf(' = ');
  if (eq > 0) {
    def = text.slice(eq + 3).trim();
    text = text.slice(0, eq).trim();
  }
  let name = text;
  let type = '';
  const colon = text.lastIndexOf(':');
  if (colon > 0) {
    name = text.slice(0, colon).trim();
    type = text.slice(colon + 1).trim();
  }
  return { vis, name, type, default: def, ...flags };
}

/** The row as typed: no UML marks, they are flags and have their own controls. */
export const memberRawText = (r) => `${r.name ?? ''}${r.type ? `: ${r.type}` : ''}${r.default ? ` = ${r.default}` : ''}`;

/**
 * The row as the sheet draws it — the visibility is an icon, not text, and the
 * three UML marks are drawn where the standard puts them: `/` before the name,
 * `{id}` after the whole row.
 */
export const memberText = (r) =>
  `${r.isDerived ? '/' : ''}${memberRawText(r)}${r.isID ? ' {id}' : ''}`;

/** The row as one editable line, visibility symbol included. */
export const memberLine = (r) =>
  `${visByKey[r.vis]?.symbol ?? '+'}${r.vis === 'public' ? '' : ' '}${memberRawText(r)}`;

export const memberLines = (element, field) =>
  (Array.isArray(element[field]) ? element[field] : []).map((r) => (typeof r === 'string' ? r : memberLine(r)));

/**
 * Внутренний переход одной строкой: `trigger [guard] / effect` (§14.5.10).
 * Сторож в скобках не удваивается — корпус пишет его уже со скобками.
 */
export const internalText = (r) => {
  const trigger = String(r?.trigger ?? '').trim();
  const guardRaw = String(r?.guard ?? '').trim();
  const guard = guardRaw ? (/^[[(]/.test(guardRaw) ? ` ${guardRaw}` : ` [${guardRaw}]`) : '';
  const effect = String(r?.effect ?? '').trim();
  return `${trigger}${guard}${effect ? ` / ${effect}` : ''}`.trim();
};

/** Rewrite a compartment from lines of text (the mini-language is a fallback). */
export function setMemberLines(element, field, text) {
  const lines = String(text ?? '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  element[field] = lines.map(parseMemberLine);
}

/** Rewrite one row from one line, keeping its position. */
export function setMemberRow(element, field, index, line) {
  if (!Array.isArray(element[field])) element[field] = [];
  element[field][index] = { ...element[field][index], ...parseMemberLine(line) };
}

export function addMemberRow(element, field) {
  if (!Array.isArray(element[field])) element[field] = [];
  element[field].push(member());
  return element[field].length - 1;
}

export function removeMemberRow(element, field, index) {
  if (Array.isArray(element[field])) element[field].splice(index, 1);
}

export function moveMemberRow(element, field, index, delta) {
  const rows = element[field];
  if (!Array.isArray(rows)) return;
  const to = index + delta;
  if (to < 0 || to >= rows.length) return;
  const [row] = rows.splice(index, 1);
  rows.splice(to, 0, row);
}

/* ------------------------------------------------------- text compartments */
/* entry / do / exit and extension points are plain lines of text, not member
 * rows: UML gives them no visibility and no type. */

export const linesOf = (element, field) => (Array.isArray(element[field]) ? element[field] : []);

export function setLine(element, field, index, text) {
  if (!Array.isArray(element[field])) element[field] = [];
  element[field][index] = String(text ?? '');
}

export function addLine(element, field, text = '') {
  if (!Array.isArray(element[field])) element[field] = [];
  element[field].push(String(text));
  return element[field].length - 1;
}

export function removeLine(element, field, index) {
  if (Array.isArray(element[field])) element[field].splice(index, 1);
}

/* -------------------------------------------------------- tagged values */

export function taggedValue(shapeOrConn, name) {
  return (shapeOrConn.taggedValues || []).find((t) => t.name === name) || null;
}

export function setTaggedValue(shapeOrConn, name, value) {
  if (!Array.isArray(shapeOrConn.taggedValues)) shapeOrConn.taggedValues = [];
  const row = shapeOrConn.taggedValues.find((t) => t.name === name);
  if (row) row.value = value;
  else shapeOrConn.taggedValues.push({ name, value });
}

export function removeTaggedValue(shapeOrConn, name) {
  if (Array.isArray(shapeOrConn.taggedValues)) {
    shapeOrConn.taggedValues = shapeOrConn.taggedValues.filter((t) => t.name !== name);
  }
}
