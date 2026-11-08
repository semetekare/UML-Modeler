// The UML notation: ONE metamodel for every diagram type.
//
// The model is one UML model, and each diagram type is a *view* that offers a
// subset of the same shapes — a Class shape may stand on a Class, Package,
// Object or Composite Structure diagram.
// So the notation is one file (notation/uml.json): every shape and connector
// once, and `types` naming the palette each diagram type shows.
//
//   NOTATION.shapes      every shape definition, by kind
//   NOTATION.connectors  every connector definition, by kind
//   NOTATION.types       the 14 UML 2.5 diagram types (id → definition)
//   paletteFor(kind)     which tools that diagram type offers, in order
//
// A diagram's kind decides the palette; the model does not care. That is why
// an element placed on a Class diagram can be shown on a Component diagram.

export const NOTATION = {
  id: '',
  title: '',
  subtitle: '',
  schema: '',
  meta: {},
  shapes: {},
  connectors: {},
  types: {},
  typeOrder: [],
  visibilities: [],
};

export const VISIBILITIES = [];
export const visByKey = {};

export const SHAPE_KINDS = () => Object.keys(NOTATION.shapes);
export const CONNECTOR_KINDS = () => Object.keys(NOTATION.connectors);
export const TYPE_IDS = () => (NOTATION.typeOrder.length
  ? NOTATION.typeOrder
  : Object.keys(NOTATION.types));

export const typeOf = (kind) => NOTATION.types[kind]
  ?? NOTATION.types[NOTATION.typeOrder[0]]
  ?? null;

/** The palette a diagram type shows; a diagram of unknown type gets everything. */
export function paletteFor(kind) {
  const t = NOTATION.types[kind];
  if (!t?.palette) return { shapes: SHAPE_KINDS(), connectors: CONNECTOR_KINDS() };
  return {
    shapes: (t.palette.shapes ?? []).filter((k) => NOTATION.shapes[k]),
    connectors: (t.palette.connectors ?? []).filter((k) => NOTATION.connectors[k]),
  };
}

/**
 * Подсказка инструмента одной фразой. В uml.json `hint` уже начинается с
 * названия фигуры («Примечание — комментарий на поле»), поэтому второе
 * «Примечание» перед ним не ставим: в полосе это читалось как
 * «Примечание — Примечание — комментарий на поле».
 */
export function toolHint(def) {
  const hint = String(def?.hint ?? '').trim();
  const label = String(def?.label ?? '').trim();
  if (!hint) return label;
  if (!label) return hint;
  return hint.toLowerCase().startsWith(label.toLowerCase()) ? hint : `${label} — ${hint}`;
}

/** The keyboard letter for a tool in a given diagram type. */
export function keyFor(kind, tool) {
  const keys = NOTATION.types[kind]?.keys ?? {};
  return keys[tool] ?? '';
}

/** Does this diagram type offer the tool? Keeps a foreign tool honest. */
export const allows = (kind, tool) => {
  const p = paletteFor(kind);
  return p.shapes.includes(tool) || p.connectors.includes(tool);
};

/* ------------------------------------------------------------- loading */

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Cheap structural check: a broken package says what is wrong, not half-loads. */
export function validatePackage(pkg, name = '?') {
  const bad = [];
  if (!pkg || typeof pkg !== 'object') {
    bad.push('файл не объект');
  } else {
    if (!pkg.id) bad.push('нет id');
    if (!pkg.meta?.font || !pkg.meta?.ink || !pkg.meta?.fill) bad.push('в meta нет font/ink/fill');
    if (!pkg.shapes || !Object.keys(pkg.shapes).length) bad.push('нет фигур');
    if (!pkg.connectors || !Object.keys(pkg.connectors).length) bad.push('нет связей');
    if (!pkg.types || !Object.keys(pkg.types).length) bad.push('нет типов диаграмм');
    if (!Array.isArray(pkg.visibilities) || !pkg.visibilities.length) bad.push('нет видимостей');
    for (const [kind, def] of Object.entries(pkg.shapes ?? {})) {
      if (!def.label) bad.push(`фигура ${kind}: нет label`);
      if (!def.defaultSize?.w || !def.defaultSize?.h) bad.push(`фигура ${kind}: нет defaultSize`);
      if (!def.style) bad.push(`фигура ${kind}: нет style`);
    }
    for (const [kind, def] of Object.entries(pkg.connectors ?? {})) {
      if (!def.label) bad.push(`связь ${kind}: нет label`);
    }
    for (const [type, def] of Object.entries(pkg.types ?? {})) {
      for (const kind of [...(def.palette?.shapes ?? []), ...(def.palette?.connectors ?? [])]) {
        if (!pkg.shapes?.[kind] && !pkg.connectors?.[kind]) {
          bad.push(`тип ${type}: в палитре неизвестный инструмент ${kind}`);
        }
      }
    }
  }
  if (bad.length) throw new Error(`Пакет нотации «${name}»: ${bad.join('; ')}`);
  return pkg;
}

export function applyPackage(pkg) {
  validatePackage(pkg, pkg?.id);
  NOTATION.id = pkg.id;
  NOTATION.title = pkg.title ?? '';
  NOTATION.subtitle = pkg.subtitle ?? '';
  NOTATION.schema = pkg.schema ?? '';
  NOTATION.meta = { ...pkg.meta };
  NOTATION.typeOrder = [...(pkg.typeOrder ?? Object.keys(pkg.types))];
  NOTATION.visibilities = [...pkg.visibilities];

  for (const k of Object.keys(NOTATION.shapes)) delete NOTATION.shapes[k];
  Object.assign(NOTATION.shapes, pkg.shapes);
  for (const k of Object.keys(NOTATION.connectors)) delete NOTATION.connectors[k];
  Object.assign(NOTATION.connectors, pkg.connectors);
  for (const k of Object.keys(NOTATION.types)) delete NOTATION.types[k];
  Object.assign(NOTATION.types, pkg.types);

  VISIBILITIES.length = 0;
  VISIBILITIES.push(...pkg.visibilities);
  for (const k of Object.keys(visByKey)) delete visByKey[k];
  for (const v of VISIBILITIES) visByKey[v.key] = v;
  return NOTATION;
}

/** Load the package. Everything is a local file, so this works offline. */
export async function loadNotation({ base = 'notation/' } = {}) {
  const index = await fetchJson(`${base}index.json`);
  const id = index.default || 'uml';
  const pkg = validatePackage(await fetchJson(`${base}${id}.json`), id);
  applyPackage(pkg);
  return { id, pkg, index };
}
