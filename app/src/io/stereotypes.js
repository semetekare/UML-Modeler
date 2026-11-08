// The stereotype profile: app/profile/stereotypes.json — the canonical reading
// of the profile the person already uses
// (material/stereotypes.xml: 428 records → 407 definitions → 304 stereotypes,
// see docs/uml/profile.md). Built by tools/build-profile.mjs, loaded once
// at boot, offline, from the file next to index.html.
//
// A record is one stereotype, however many metaclasses it extends
// (UML 2.5.1 §12.3.3.4):
//
//   { id: "st-usecase", name: "usecase", aliases: ["UseCase"],
//     keywordAliases: [], baseTypes: ["UseCase", "Class"], scope: "application",
//     documentation: "",
//     pictogram: { asset, kind, size, glyph, iconPath, iconPaths },
//     pictogramByBaseType: { UseCase: null, Class: { … } },
//     taggedValues: [ { name, type, default, documentation, values } ],
//     taggedValuesByBaseType: { … }, taggedValuesVariants: [ … ] }
//
// Three things the profile carries that the old XML path could not:
//   * `baseTypes` — one name, several extensions. The drawing is per
//     extension: `usecase` has the ellipse on `Class` and nothing on
//     `UseCase`, so a use case must not get the class ellipse;
//   * `aliases` — the spellings that lost canonicalisation. Old files write
//     «UseCase», the profile says `usecase`, and only the normalized name
//     joins them;
//   * `keywordAliases` — derived, not stored: a stereotype named like a UML
//     keyword also answers to `IncludeStereotype`, so a person can name the
//     stereotype without writing the keyword (see `UML_KEYWORDS`).
//
// The parsed profile also answers what of it the app can show — `reachability`
// — and what name a new definition may not take — `stereotypeNameClash`.
//
// The element keeps the stereotype NAME (`stereotype`) and may carry the
// record reference (`stereotypeId`). The name is what the sheet draws and what
// survives a missing profile; the id says which definition was meant when a
// name alone is not enough. Resolution order — `resolveStereotype`.

export const PROFILE_PATH = 'profile/stereotypes.json';

/**
 * Names a stereotype cannot carry without being confused with a UML keyword.
 *
 * `include`, `extend`, `import`, `merge`, `manifest`, `trace`, `use`, `deploy`,
 * `create`, `destroy` are the keywords of the relationship kinds in
 * `notation/uml.json` (field `keyword`), and `substitute` is a UML 2.5.1
 * keyword with no kind of its own. A stereotype named like one of them reads
 * in the inspector as a second «include» next to the relationship kind, and in
 * PlantUML the keyword and the stereotype would print the same `<<include>>`.
 * The list is data, not a rule: the aliases below are derived from it, and
 * `tests/stereotype-hygiene.mjs` proves it covers every notation keyword.
 */
export const UML_KEYWORDS = [
  'create', 'deploy', 'destroy', 'extend', 'import', 'include',
  'manifest', 'merge', 'substitute', 'trace', 'use',
];

/**
 * The predictable alias of a keyword-named stereotype: `include` →
 * `IncludeStereotype`.
 *
 * Why this suffix and not another: the keyword is one lower-case word, so the
 * alias must not be — a person typing `Include` means either the keyword or
 * the stereotype, and no spelling of a single keyword word can say which.
 * `…Stereotype` says it in the name itself, cannot collide with a keyword or
 * with a connector kind, and stays readable in the inspector list. It also
 * survives canonicalisation: `IncludeStereotype` normalizes to itself, so a
 * later import of the same alias finds the same record.
 *
 * @param {string} name stereotype name as written
 * @returns {string} the alias, or `''` when the name is not a UML keyword
 */
export function keywordAliasFor(name) {
  const key = normalizeStereotypeName(name);
  if (!UML_KEYWORDS.includes(key)) return '';
  return `${key[0].toUpperCase()}${key.slice(1)}Stereotype`;
}

/** Every keyword alias a record answers to, without repeats. */
function keywordAliasesFor(spellings) {
  const out = [];
  for (const spelling of spellings) {
    const alias = keywordAliasFor(spelling);
    if (alias && !out.includes(alias)) out.push(alias);
  }
  return out;
}

/**
 * Every spelling a record answers to: canonical name, aliases, keyword aliases.
 *
 * A record from `model.profiles` has no `keywordAliases` — that field is put
 * there by `parseProfileJson` for the app profile only — so the keyword alias
 * is derived from the name here as well. Otherwise a person's own profile
 * could hold `Include` and `IncludeStereotype` on one baseType without the
 * clash being noticed, and the same name would behave differently depending on
 * which file it came from.
 */
const spellingsOf = (record) => [
  record?.name,
  ...(record?.aliases ?? []),
  ...(record?.keywordAliases ?? keywordAliasesFor([record?.name])),
];

/**
 * The picture map: iconPath → the SVG this app draws instead. `iconPath`
 * points into the source archive, which this project does not carry.
 * `material/stereotype-icons.json` is the translation table; the icon set
 * reads it at boot to know which `pict-*` files to load. The profile itself
 * already names the asset per record, so only the icon set needs this file.
 */
export const PICTOGRAM_MAP_PATH = 'material/stereotype-icons.json';

/**
 * Which profile baseTypes apply to which element or connector kind.
 *
 * These are the baseType names the profile uses, mapped onto the UML kinds
 * this modeler knows. An element with no matching base type (a fork bar, an
 * initial node) still gets the full list under «Все стереотипы»: the profile lets you
 * apply a stereotype to almost anything, the «Подходящие» group is a
 * convenience, not a rule.
 *
 * `baseTypeFor(kind)` reads the FIRST entry as the kind's own metaclass; the
 * rest are neighbours the profile also accepts a stereotype from (an interface is a
 * Class too, a collaboration is both `Collaboration2` and `Collaboration`).
 */
export const APPLICABILITY = {
  // elements
  class: ['Class', 'SysMLBlock'],
  interface: ['Interface', 'Class'],
  enumeration: ['Class'],
  datatype: ['Class', 'SysMLValueType'],
  package: ['Package', 'Model', 'SubSystem'],
  model: ['Model', 'Package'],
  profile: ['Package', 'Model'],
  component: ['Component', 'SubSystem'],
  artifact: ['Artifact'],
  deploymentSpec: ['Artifact', 'DeploymentSpecification'],
  node: ['Node', 'NodeInstance'],
  device: ['Node', 'NodeInstance'],
  executionEnvironment: ['Node', 'NodeInstance'],
  object: ['Object', 'InstanceSpecification', 'NodeInstance'],
  part: ['Collaboration2', 'SysMLParticipantProperty', 'Property'],
  port: ['Port'],
  collaboration: ['Collaboration2', 'Collaboration'],
  collaborationUse: ['Collaboration2', 'Collaboration'],
  stereotype: ['Class'],
  metaclass: ['Class'],
  actor: ['Actor', 'InteractionActor'],
  usecase: ['UseCase'],
  systemBoundary: ['System', 'SubSystem'],
  note: ['NOTE'],
  text: ['NOTE'],
  state: ['State2'],
  action: ['ActivityAction', 'Activity'],
  activity: ['Activity'],
  objectNode: ['ObjectNode', 'CentralBufferNode', 'DataStoreNode'],
  activityParameter: ['ActivityParameterNode', 'InputPin', 'OutputPin'],
  swimlane: ['ActivityPartition'],
  lifeline: ['InteractionLifeLine'],
  actorLifeline: ['InteractionActor', 'Actor'],
  fragment: ['CombinedFragment'],
  interaction: ['Interaction'],
  interactionUse: ['Interaction'],
  timingLane: ['InteractionLifeLine'],

  // connectors
  association: ['Association', 'AssociationClass', 'AssociationEnd'],
  aggregation: ['Association'],
  composition: ['Association'],
  generalization: ['Generalization'],
  realization: ['Realization'],
  dependency: ['Dependency', 'Abstraction'],
  usage: ['Usage'],
  import: ['Dependency'],
  merge: ['Dependency'],
  include: ['Include'],
  extend: ['Extend'],
  assembly: ['Connector'],
  delegation: ['Connector'],
  connector: ['Connector'],
  controlFlow: ['Connector'],
  objectFlow: ['Connector'],
  transition: ['Transition2'],
  message: ['Message', 'SequenceMessage', 'DiagonalMessage', 'SelfMessage', 'MessageFrom', 'MessageTo'],
  reply: ['Message', 'SequenceMessage', 'DiagonalMessage', 'SelfMessage'],
  createMessage: ['Message', 'SequenceMessage'],
  destroyMessage: ['Message', 'SequenceMessage'],
  link: ['Association'],
  deployment: ['Deployment'],
  communicationPath: ['Association'],
  manifest: ['Dependency'],
  trace: ['Dependency'],
  extension: ['Generalization'],
};

/**
 * Every baseType the app can carry — the union of APPLICABILITY.
 *
 * This set is the app's side of the reachability question: a profile definition
 * is reachable when its baseType is here, because some element or connector
 * kind claims that metaclass. `material/profile-canonical/build.py` derives its
 * `reachability.json` from this same table, so the panel and the audit answer
 * with one number; `tests/stereotype-hygiene.mjs` proves they agree.
 */
const APPLICABLE_BASE_TYPES = new Set(Object.values(APPLICABILITY).flat());

/**
 * The six metaclasses the profile promises and the notation does not have —
 * our own gap, not somebody else's notation. Б14 fixes the notation, not this
 * list: the panel must show these as honestly unreachable, not hide them.
 */
export const NOTATION_GAPS = {
  element: ['Requirement', 'Reception', 'ValuePin', 'ExpansionNode'],
  connector: ['BindingDependency', 'CollaborationOccurrence'],
};

/**
 * Why a baseType is unreachable, in the words of
 * `material/profile-canonical/reachability.json` `groups[].why`.
 *
 * The wording is copied on purpose: the panel says the same thing the audit
 * says, and `tests/stereotype-hygiene.mjs` compares them sentence by sentence.
 * Two families are not a gap of ours — a member row (attribute, operation) is
 * not an element at all, and BMM/ArchiMate/SysML are other notations entirely.
 */
export const UNREACHABLE_WHY = {
  Attribute: 'у нас атрибут — строка члена (member), а не элемент: стереотип на него не надеть',
  Operation: 'у нас операция — строка члена (member), а не элемент: стереотип на неё не надеть',
  ArchiMate: 'ArchiMate — не UML, вне границ проекта',
  BMM: 'Business Motivation Model (BMM) — не UML, вне границ проекта',
  SysML: 'SysML — вне границ проекта',
  'UML-элемент': 'метакласс UML: вида элемента в нотации нет — можно добавить',
  'UML-связь': 'метакласс UML: вида связи в нотации нет — можно добавить',
};

/**
 * The family and the reason for one unreachable baseType, or null when the
 * app can carry it. The family names match `reachability.json` groups, so the
 * panel can show the audit's wording without reading the audit file.
 *
 * @param {string} baseType profile metaclass
 * @returns {{family: string, why: string}|null}
 */
export function unreachableReason(baseType) {
  const base = String(baseType ?? '');
  if (!base || APPLICABLE_BASE_TYPES.has(base)) return null;
  if (base === 'Attribute' || base === 'Operation') {
    return { family: base, why: UNREACHABLE_WHY[base] };
  }
  if (base.startsWith('ArchiMate')) return { family: 'ArchiMate', why: UNREACHABLE_WHY.ArchiMate };
  if (base.startsWith('BMM')) return { family: 'BMM', why: UNREACHABLE_WHY.BMM };
  if (base.startsWith('SysML')) return { family: 'SysML', why: UNREACHABLE_WHY.SysML };
  if (NOTATION_GAPS.connector.includes(base)) {
    return { family: 'UML-связь', why: UNREACHABLE_WHY['UML-связь'] };
  }
  if (NOTATION_GAPS.element.includes(base)) {
    return { family: 'UML-элемент', why: UNREACHABLE_WHY['UML-элемент'] };
  }
  // Новый baseType, которого нет ни в APPLICABILITY, ни в списках выше: это
  // тоже пробел, и честнее сказать «вида нет», чем придумать семейство.
  return { family: 'UML-элемент', why: UNREACHABLE_WHY['UML-элемент'] };
}

/**
 * What of the profile the app can actually show.
 *
 * Counted by stereotype and by definition, because the two units answer
 * different questions: a stereotype is a row in the inspector (304), a
 * definition is one (name, baseType) extension (407). The audit's third unit —
 * the 428 source records — is not derivable here: the app profile carries the
 * canonical result, not the source records that were merged into it, so the panel
 * does not pretend to count them.
 *
 * `reachable` counts a stereotype as reachable when ANY of its extensions is:
 * `Default` on `State2` is a row a person can use, even though its `Operation`
 * extension is not. Those nine are `partlyReachable`.
 *
 * @param {object|Array} profile parsed profile or an array of definitions
 * @returns {{
 *   baseTypes: {profile: number, reachable: number, unreachable: number},
 *   definitions: {total: number, reachable: number, unreachable: number},
 *   stereotypes: {total: number, reachable: number, fullyReachable: number,
 *                 entirelyUnreachable: number, partlyReachable: number},
 *   isReachable: (record: object) => boolean,
 *   unreachableBaseTypes: (record: object) => string[],
 *   why: (record: object) => string[],
 * }}
 */
export function reachabilityOf(profile) {
  const records = Array.isArray(profile) ? profile : (profile?.stereotypes ?? []);
  const baseTypes = new Set();
  for (const s of records) for (const b of s?.baseTypes ?? []) baseTypes.add(b);
  const reachableBaseTypes = [...baseTypes].filter((b) => APPLICABLE_BASE_TYPES.has(b));

  const isReachable = (record) => (record?.baseTypes ?? []).some((b) => APPLICABLE_BASE_TYPES.has(b));
  const unreachableBaseTypes = (record) => (record?.baseTypes ?? [])
    .filter((b) => !APPLICABLE_BASE_TYPES.has(b));
  const why = (record) => [...new Set(unreachableBaseTypes(record).map((b) => unreachableReason(b).why))];

  let definitions = 0;
  let reachableDefinitions = 0;
  let fullyReachable = 0;
  let entirelyUnreachable = 0;
  let partlyReachable = 0;
  // Разбивка недостижимых по семействам причин — в единицах СТЕРЕОТИПОВ, а не
  // записей профиля: 91 чужая нотация + 38 строк членов + 2 пробела = 131. Числа
  // `reachability.json` про записи (96 + 44 + 11 = 151) — другая единица, и
  // смешивать их в одной строке нельзя (см. `tests/stereotype-hygiene.mjs`).
  const unreachableByFamily = {};
  for (const s of records) {
    const list = s?.baseTypes ?? [];
    definitions += list.length;
    const ok = list.filter((b) => APPLICABLE_BASE_TYPES.has(b));
    reachableDefinitions += ok.length;
    if (!list.length || !ok.length) {
      entirelyUnreachable += 1;
      const lost = list.filter((b) => !APPLICABLE_BASE_TYPES.has(b));
      const family = lost.length ? unreachableReason(lost[0]).family : '—';
      unreachableByFamily[family] = (unreachableByFamily[family] ?? 0) + 1;
    } else if (ok.length < list.length) partlyReachable += 1;
    else fullyReachable += 1;
  }
  return {
    baseTypes: {
      profile: baseTypes.size,
      reachable: reachableBaseTypes.length,
      unreachable: baseTypes.size - reachableBaseTypes.length,
    },
    definitions: {
      total: definitions,
      reachable: reachableDefinitions,
      unreachable: definitions - reachableDefinitions,
    },
    stereotypes: {
      total: records.length,
      reachable: fullyReachable + partlyReachable,
      fullyReachable,
      entirelyUnreachable,
      partlyReachable,
      unreachableByFamily,
    },
    isReachable,
    unreachableBaseTypes,
    why,
  };
}

/* ---------------------------------------------------------- the profile */

/**
 * The profile file → the object the rest of the app reads.
 *
 * `byId`, `byName` and `byNormalized` are lookup tables over the same 304
 * records: `resolveStereotype` must be O(1) on the render path, where it runs
 * for every shape. When two spellings collide the list is ordered
 * «проект раньше прикладного, при равенстве — по порядку файла», so the map
 * keeps the winner the resolver would have chosen.
 *
 * Every record also answers to its keyword alias (`IncludeStereotype` for
 * `include`), so the tables carry it: a name that collides with a UML keyword
 * needs one spelling that cannot be read as the keyword.
 */
export function parseProfileJson(text) {
  const raw = JSON.parse(text);
  const rows = Array.isArray(raw?.stereotypes) ? raw.stereotypes : [];
  const stereotypes = rows.map((s) => {
    const name = String(s.name ?? '');
    const aliases = Array.isArray(s.aliases) ? s.aliases.map(String) : [];
    return {
      id: String(s.id ?? ''),
      name,
      aliases,
      // Псевдонимы ключевых слов — не данные профиля, а гигиена имён: их
      // порождает `UML_KEYWORDS`, поэтому в файле их нет и `counts.aliases`
      // остаётся прежним (9 псевдонимов канонизации).
      keywordAliases: keywordAliasesFor([name, ...aliases]),
      baseTypes: Array.isArray(s.baseTypes) ? s.baseTypes.map(String) : [],
      scope: s.scope === 'project' ? 'project' : 'application',
      documentation: String(s.documentation ?? ''),
      pictogram: s.pictogram ?? null,
      pictogramByBaseType: s.pictogramByBaseType ?? null,
      taggedValues: Array.isArray(s.taggedValues) ? s.taggedValues : [],
      taggedValuesByBaseType: s.taggedValuesByBaseType ?? null,
      taggedValuesVariants: s.taggedValuesVariants ?? null,
    };
  });
  // Проект раньше прикладного: ближнее пространство имён скрывает внешнее
  // (UML 2.5.1 §7.4.3.3). Внутри области — порядок файла, он же порядок
  // профиля; сортировка стабильна, поэтому результат воспроизводим.
  const ranked = [...stereotypes].sort((a, b) => rank(a) - rank(b));
  const byId = new Map();
  const byName = new Map();
  const byNormalized = new Map();
  for (const s of ranked) {
    if (s.id && !byId.has(s.id)) byId.set(s.id, s);
    // `byName` — только канонические написания: разрешение обязано сказать,
    // что `UseCase` найден нормализацией, а не точным совпадением. Псевдонимы
    // и псевдонимы ключевых слов живут в `byNormalized` — это второй шаг.
    if (s.name && !byName.has(s.name)) byName.set(s.name, s);
    for (const spelling of spellingsOf(s)) {
      const key = normalizeStereotypeName(spelling);
      if (key && !byNormalized.has(key)) byNormalized.set(key, s);
    }
  }
  return {
    version: raw?.version ?? 1,
    source: String(raw?.source ?? ''),
    counts: raw?.counts ?? {},
    stereotypes,
    byId,
    byName,
    byNormalized,
    count: stereotypes.length,
    // Достижимость считается здесь, а не читается файлом: её источник —
    // APPLICABILITY, и приложение обязано уметь ответить на вопрос «что из
    // этого профиля вообще можно применить» без второго артефакта.
    reachability: reachabilityOf(stereotypes),
  };
}

const rank = (s) => (s.scope === 'project' ? 0 : 1);

/**
 * The key spellings are compared by: lower case, spaces, `_` and `-` dropped.
 * This is the canonicalisation rule itself (docs/uml/profile.md §2.2),
 * so `UseCase`, `use case` and `use_case` all reach the record `usecase`.
 */
export const normalizeStereotypeName = (name) => String(name ?? '').toLowerCase().replace(/[\s_-]+/g, '');

/**
 * The stereotype a new definition would clash with, or null.
 *
 * This is our own hygiene rule, not UML's `name_not_clash` (§12.4.9.6, which
 * is about a stereotype sharing a keyword of the element it extends): two
 * definitions with one normalized name on one baseType make the inspector list
 * show «usecase» twice, and the person cannot tell which record is theirs.
 * The standard would call them distinguishable strings; we call them a
 * mistake, because the list is what a person reads.
 *
 * The comparison is the canonicalisation key — the same `normalizeStereotype-
 * Name` that joined 428 records into 304 — applied to every spelling the
 * existing record answers to: its name, its `aliases` and its keyword aliases.
 * A different baseType is not a clash: `Default` on `State2` and `Default` on
 * `Operation` are two extensions of one name (§7.4.3.2), and `usecase` on
 * `Class` does not stop a new `usecase` on `Component`.
 *
 * `exceptId` lets a record keep its own name while it is edited: the record
 * being renamed is not its own competitor.
 *
 * @param {object|Array} records  parsed profile or an array of definitions
 * @param {{name?: string, baseTypes?: string[], id?: string}} draft  what is being created
 * @param {{exceptId?: string}} [opts]
 * @returns {{record: object, baseTypes: string[], message: string}|null}
 *   the occupied record, the baseTypes both claim, and the refusal to show
 */
export function stereotypeNameClash(records, draft, { exceptId = '' } = {}) {
  const list = Array.isArray(records) ? records : (records?.stereotypes ?? []);
  const name = String(draft?.name ?? '').trim();
  if (!name) return null;
  const key = normalizeStereotypeName(name);
  const claims = (Array.isArray(draft?.baseTypes) ? draft.baseTypes : []).map(String);
  if (!claims.length) return null;
  const skip = String(exceptId || draft?.id || '');
  for (const record of list) {
    if (!record) continue;
    if (skip && String(record.id ?? '') === skip) continue;
    if (!spellingsOf(record).some((spelling) => normalizeStereotypeName(spelling) === key)) continue;
    const shared = claims.filter((baseType) => (record.baseTypes ?? []).includes(baseType));
    if (!shared.length) continue;
    return {
      record,
      baseTypes: shared,
      message: `имя «${name}» уже занято стереотипом «${record.name}» для ${shared.join(', ')}`,
    };
  }
  return null;
}

/**
 * The profile baseType of an element or connector kind — the metaclass the
 * kind stands for, taken from the kind itself. The entry named like the kind
 * wins (`collaboration` → `Collaboration`, not `Collaboration2`), otherwise
 * the first listed one. A kind with no entry (a note, a fork bar) has no base
 * type: a drawing keyed by baseType cannot be chosen for it, and guessing
 * would be worse than not drawing.
 */
export function baseTypeFor(kind) {
  const bases = baseTypesFor(kind);
  if (!bases.length) return null;
  const key = String(kind).toLowerCase();
  return bases.find((b) => b.toLowerCase() === key) ?? bases[0];
}

/** Every profile baseType the kind accepts, in the table's order. */
export const baseTypesFor = (kind) => APPLICABILITY[kind] ?? [];

/**
 * Which profile record an element or relationship means.
 *
 *   stereotypeId  →  exact name (project → application → file order)
 *                 →  normalized name (project → application → file order)
 *                 →  null: the name stays, no definition found
 *
 * `brokenId` is set when a reference was written but no record answers to it:
 * the caller keeps the name and says so, it does not invent a definition.
 * Returns `{ record, via, brokenId }`, `via` being 'id', 'exact' or
 * 'normalized' — the step that matched, for the inspector and for tests.
 *
 * @param {object|null} profile
 * @param {{stereotypeId?: string, stereotype?: string}} item  element or relationship
 * @returns {{record: object|null, via: string|null, brokenId: string}}
 */
export function resolveStereotype(profile, item = {}) {
  if (!profile) return { record: null, via: null, brokenId: '' };
  const id = String(item.stereotypeId ?? '').trim();
  const name = String(item.stereotype ?? '').trim();
  if (id) {
    const hit = profile.byId.get(id);
    if (hit) return { record: hit, via: 'id', brokenId: '' };
  }
  const brokenId = id;
  if (name) {
    const exact = profile.byName.get(name);
    if (exact) return { record: exact, via: 'exact', brokenId };
    const near = profile.byNormalized.get(normalizeStereotypeName(name));
    if (near) return { record: near, via: 'normalized', brokenId };
  }
  return { record: null, via: null, brokenId };
}

/**
 * Tagged-value definitions for a record on one baseType. The profile stores different
 * sets for different extensions (`XSDschema` has two on `Package` and none on
 * `Class`; `usecase` orders its enumerations differently), and the profile
 * keeps both: reading the element's own baseType is what makes the fields
 * match the element.
 */
export function taggedDefsFor(record, baseType) {
  if (!record) return [];
  const perType = record.taggedValuesByBaseType;
  if (perType && baseType && Object.hasOwn(perType, baseType)) return perType[baseType] ?? [];
  return record.taggedValues ?? [];
}

/**
 * The drawing for a stereotype on an element of a given baseType, or null.
 *
 * `stereotypeRef` is the record id (`stereotypeId`) or, for files written
 * before the id existed, the stereotype name — both reach the same record.
 * `baseType` is required, not optional: the drawing belongs to the extension,
 * not to the name. `usecase` has the ellipse on `Class` only, so a use case
 * (`UseCase`) gets null here, and that is the point.
 *
 * @param {object|null} profile
 * @param {string} stereotypeRef  record id or stereotype name
 * @param {string|null} baseType  the element kind's metaclass
 * @returns {object|null} `{ asset, kind, size, glyph }` or null
 */
export function pictogramFor(profile, stereotypeRef, baseType) {
  if (!profile || !stereotypeRef) return null;
  const ref = String(stereotypeRef);
  const record = profile.byId.get(ref) ?? resolveStereotype(profile, { stereotype: ref }).record;
  if (!record) return null;
  const base = baseType ? String(baseType) : '';
  const perType = record.pictogramByBaseType;
  if (perType) {
    // Есть рисунки по расширениям — значит ответ известен точно: либо
    // рисунок этого baseType, либо его нет. Подставлять общий `pictogram`
    // тут нельзя: он принадлежит другому расширению.
    return base && Object.hasOwn(perType, base) ? (perType[base] ?? null) : null;
  }
  if (base && record.baseTypes.length && !record.baseTypes.includes(base)) return null;
  return record.pictogram ?? null;
}

/** Fetch + parse the profile. A broken file is an error the statusbar shows. */
export async function loadProfile() {
  const res = await fetch(PROFILE_PATH, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${PROFILE_PATH}: HTTP ${res.status}`);
  return parseProfileJson(await res.text());
}

/** Stereotypes applicable to an element kind, applicable first. */
export function applicable(profile, kind) {
  if (!profile) return { applicable: [], rest: [] };
  const bases = APPLICABILITY[kind] ?? [];
  const fits = (s) => s.baseTypes.some((b) => bases.includes(b));
  return {
    applicable: profile.stereotypes.filter(fits),
    rest: profile.stereotypes.filter((s) => !fits(s)),
  };
}

/**
 * Group the profile for the «Профиль» panel: one row per stereotype, under
 * its first baseType. A stereotype with three extensions appears once — the
 * panel lists stereotypes, not definitions.
 */
export function groupedByBaseType(profile) {
  const groups = [];
  const index = new Map();
  for (const s of profile.stereotypes) {
    const baseType = s.baseTypes[0] ?? '—';
    if (!index.has(baseType)) {
      const g = { baseType, items: [] };
      index.set(baseType, g);
      groups.push(g);
    }
    index.get(baseType).items.push(s);
  }
  return groups;
}

/*
 * XML здесь больше не разбирается. `material/stereotypes.xml` остаётся
 * входом канонизации (material/profile-canonical/build.py), а приложение
 * читает её результат — app/profile/stereotypes.json. Разбирать 428 записей
 * в браузере значило бы держать вторую копию правил сведения и разойтись с
 * check.mjs при первой же правке; профиль собирается один раз и проверяется
 * там, где его собрали.
 */

/**
 * iconPath → { asset, kind, size } from `material/stereotype-icons.json`.
 *
 * `kind` decides how the renderer uses it: `badge` is a 16 px glyph in the
 * corner of a shape, `figure` is a drawing that stands in for the whole
 * shape (the fish, the waves, the big ellipse). The map is data, not code,
 * so a new stereotype picture is a JSON row plus one SVG file.
 */
export function parsePictogramMap(text) {
  const raw = JSON.parse(text);
  const byPath = new Map();
  for (const [iconPath, row] of Object.entries(raw?.map ?? {})) {
    if (!row?.asset) continue;
    byPath.set(iconPath, {
      asset: String(row.asset),
      kind: row.kind === 'figure' ? 'figure' : 'badge',
      size: Array.isArray(row.size) && row.size.length === 2
        ? [Number(row.size[0]) || 16, Number(row.size[1]) || 16]
        : [16, 16],
      glyph: row.glyph || row.asset,
    });
  }
  return { byPath, count: byPath.size };
}

/**
 * Fetch the drawing map once and keep it: the icon set asks for the asset
 * names at boot, and a second request for a 12 KB local file buys nothing.
 */
let mapPromise = null;
export function loadPictogramMap() {
  if (mapPromise) return mapPromise;
  mapPromise = (async () => {
    try {
      const res = await fetch(PICTOGRAM_MAP_PATH, { cache: 'no-store' });
      if (!res.ok) return { byPath: new Map(), count: 0 };
      return parsePictogramMap(await res.text());
    } catch {
      return { byPath: new Map(), count: 0 };
    }
  })();
  return mapPromise;
}