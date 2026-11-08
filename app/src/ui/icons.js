// The icon set: app/src/brand/icons/*.svg, inlined into the DOM.
//
// One file per glyph, drawn in VectorCraft by tools/make-icons.py: 51 shapes
// on the 24 px grid plus their 16 px tree twins, 27 connectors, and the UI
// glyphs. Before this pass 36 files served 78 kinds — nine different shapes
// shared the class glyph, five shared the note glyph, every dependency-like
// connector looked identical. The package (notation/uml.json) now names a
// distinct file for every kind, so the tool strip and the model tree show
// what a tool actually draws.
//
// Stroke weights (1.5 on 24, 1.25 on 16) are baked into the files and are not
// touched here.
//
// WHY INLINE AND NOT <img> OR mask-image.
//   * <img src="…"> cannot inherit the parent's colour: currentColor inside
//     the file resolves to the file's own default (black), so an active tool
//     or a selected tree row would keep a black glyph on an orange tint.
//   * mask-image + background:currentColor is the no-JS alternative and is
//     right for HTML chrome, but the sheet is an <svg> document: a mask
//     cannot paint a visibility glyph inside it, so we would need a second
//     mechanism for the same set — exactly the drift this task removes.
//   Inlining after fetch gives ONE mechanism for both, and currentColor then
//   works everywhere for free.
//
// THE TRAP: every file carries id attributes, all of them id="Layer_1".
// Inlining several into one document would duplicate ids (invalid, and
// url(#…) references would resolve to the wrong node). Every id is stripped
// on load; nothing in the set references its own ids.
//
// Load is one parallel batch at boot (local files), so the first paint
// already has every glyph — no icon pop-in and no re-render.

const NS = 'http://www.w3.org/2000/svg';
const DIR = new URL('../brand/icons/', import.meta.url);

// Read at call time, never at module load: the notation package arrives after
// this module is imported (main.js awaits loadNotation before initIcons).
import { NOTATION } from '../model/notation.js';
import { loadPictogramMap } from '../io/stereotypes.js';

/** Glyphs the chrome asks for by hand (everything else comes from the package). */
export const UI_ICONS = [
  'ui-panel-left', 'ui-panel-right', 'ui-help', 'ui-plus', 'ui-close',
  'ui-chevron-down', 'ui-arrow-up', 'ui-arrow-down', 'ui-diagram',
  'ui-undo', 'ui-redo', 'ui-save', 'ui-open', 'ui-export', 'ui-grid',
  'ui-palette', 'ui-library', 'ui-course', 'ui-pin',
  // Ссылка на исходный код: приветствие и справка, не тулбар (§5.1).
  'ui-github',
  // Theme switch: the button shows the appearance that is on screen.
  'ui-sun', 'ui-moon', 'ui-contrast',
];

/** The sheet's own markers: cursor and visibility sigils. */
const SHEET_ICONS = [
  'tool-select', 'vis-public', 'vis-private', 'vis-protected', 'vis-package',
];

/**
 * Every file the current package can ask for. Built from the notation, so a
 * kind whose file is missing shows up as a gap instead of a stale glyph.
 */
export function iconNames() {
  const names = new Set([...SHEET_ICONS, ...UI_ICONS]);
  for (const [kind, def] of Object.entries(NOTATION.shapes)) {
    names.add(def.icon ?? `shape-${kind}`);
    names.add(def.treeIcon ?? `shape-${kind}-16`);
  }
  for (const [kind, def] of Object.entries(NOTATION.connectors)) {
    names.add(def.icon ?? `conn-${kind}`);
  }
  return [...names];
}

const cache = new Map();   // name -> { viewBox, nodes } | null
const pending = new Map(); // name -> Promise

async function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (pending.has(name)) return pending.get(name);
  const p = (async () => {
    try {
      const res = await fetch(new URL(`${name}.svg`, DIR), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error(`${name}: not an svg`);
      // Duplicate ids across files — see the header. Strip before importing.
      for (const n of root.querySelectorAll('[id]')) n.removeAttribute('id');
      const viewBox = root.getAttribute('viewBox') || '0 0 24 24';
      const nodes = [...root.children]
        .filter((n) => n.nodeName.toLowerCase() !== 'title')
        .map((n) => document.importNode(n, true));
      cache.set(name, { viewBox, nodes });
    } catch {
      // A missing file must not take the app down: the caller gets an empty
      // svg of the right size and the UI keeps its layout.
      cache.set(name, null);
    }
    pending.delete(name);
    return cache.get(name);
  })();
  pending.set(name, p);
  return p;
}

/** Load the whole set (or a subset) before the first render. */
export function initIcons(names = null) {
  return (async () => {
    const list = names ?? [...iconNames(), ...(await pictogramNames())];
    return Promise.all(list.map(load));
  })();
}

/**
 * The stereotype drawings (`pict-*`), named by the profile's own map rather
 * than by a list kept in step by hand. A map that will not load costs the
 * drawings and nothing else — `load` already turns a missing file into an
 * empty svg of the right size.
 */
async function pictogramNames() {
  const map = await loadPictogramMap();
  return [...new Set([...map.byPath.values()].map((r) => r.asset).filter(Boolean))];
}

/**
 * An inline <svg> for `name` at `size` px. currentColor is inherited from
 * whatever the icon sits in, so colour comes from the token, not the file.
 */
export function icon(name, size = 24) {
  const svg = document.createElementNS(NS, 'svg');
  const ent = cache.get(name);
  svg.setAttribute('viewBox', ent?.viewBox ?? `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon');
  if (ent) {
    for (const n of ent.nodes) svg.append(n.cloneNode(true));
  } else {
    // Кэш ещё пуст: либо набор грузится, либо файла нет. Раньше здесь
    // оставалась пустая обёртка навсегда — так и вышли «белые кнопки»
    // читалки (initReference звался до await initIcons). Теперь оболочка
    // рисуется сразу, а содержимое досыпается, когда файл доедет.
    load(name).then((got) => {
      if (!got || svg.childElementCount) return;
      svg.setAttribute('viewBox', got.viewBox);
      for (const n of got.nodes) svg.append(n.cloneNode(true));
    });
  }
  return svg;
}

/** The package names a glyph file directly; `kind` is only the fallback. */
function glyphName(def, kind) {
  return def?.icon ?? `shape-${kind}`;
}

/** A tool in the strip: 24 px, the file the notation names. */
export function toolIcon(kind, size = 24) {
  if (kind === 'select') return icon('tool-select', size);
  const shape = NOTATION.shapes[kind];
  if (shape) return icon(shape.icon ?? `shape-${kind}`, size);
  const conn = NOTATION.connectors[kind];
  if (conn) return icon(conn.icon ?? `conn-${kind}`, size);
  return icon('tool-select', size);
}

/** A node in the model tree: the 16 px grid of the same set. */
export function shapeIcon(kind, size = 16) {
  const def = NOTATION.shapes[kind];
  return icon(def?.treeIcon ?? `shape-${kind}-16`, size);
}

/** A visibility marker (+ − # ~) on the sheet: 16 px, monochrome. */
export function visIcon(key, size = 16) {
  return icon(`vis-${key}`, size);
}
