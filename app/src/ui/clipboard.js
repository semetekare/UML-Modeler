// Copy / cut / paste / duplicate, in the model's own terms.
//
// The model has one element and many views of it (`uml-model/3`), so "paste"
// means two different things and both are honest:
//
//   * into the SAME diagram — a duplicate: new elements with new ids, new
//     shapes, and the links between the copied shapes re-created between the
//     copies (Ctrl+D always does this, whatever the diagram);
//   * into ANOTHER diagram — a view of the element that already exists, not a
//     second element. That is what "the same class on two sheets" means, and
//     it is the reason the clipboard stores element ids as well as contents.
//
// If an element was deleted between copy and paste, the paste falls back to a
// copy: a view of something that no longer exists would be a dangling shape.
//
// Every paste is one `commit`, so one Ctrl+Z takes the whole thing back.

import { deepClone } from '../util.js';
import { store, set, commit } from '../state/store.js';
import {
  currentDiagram, findElement, createElement, createShape,
  createRelationship, createLink, findRelationship,
} from '../model/model.js';
import { renderCanvas, deleteSelection } from './canvas.js';

const SNAP = 10;

/** What Ctrl+C remembers: element snapshots, the links among them, geometry. */
export function copySelection() {
  const m = store.model;
  const d = currentDiagram(m);
  const sel = store.ui.selection;
  if (!d || !sel.length) return 0;

  const shapeIds = new Set(sel.filter((s) => s.kind === 'shape').map((s) => s.id));
  const shapes = d.shapes.filter((s) => shapeIds.has(s.id));
  if (!shapes.length && !sel.some((s) => s.kind === 'connector')) return 0;

  // Links between copied shapes come along; a link whose other end was not
  // copied would need a shape that is not in the clipboard.
  const linkIds = new Set(sel.filter((s) => s.kind === 'connector').map((s) => s.id));
  const links = d.links.filter((l) => (linkIds.has(l.id)
    || (l.from && l.to && shapeIds.has(l.from.shapeId) && shapeIds.has(l.to.shapeId))));

  const relIds = new Set(links.map((l) => l.relId));
  const relationships = m.relationships.filter((r) => relIds.has(r.id));

  store.clipboard = {
    diagramId: d.id,
    elements: shapes.map((s) => deepClone(findElement(m, s.elementId))).filter(Boolean),
    shapes: deepClone(shapes),
    relationships: deepClone(relationships),
    links: deepClone(links),
    pastes: 0,
  };
  return shapes.length + links.length;
}

/** Ctrl+X: remember, then take the views off this diagram (the model stays). */
export function cutSelection() {
  const n = copySelection();
  if (!n) return 0;
  // A cut is a promise that the next paste puts the SAME elements back: the
  // clipboard remembers that, so Ctrl+V here re-shows their views instead of
  // duplicating them (Ctrl+D is the command that always duplicates).
  store.clipboard.cut = true;
  deleteSelection();
  set({ hint: `Вырезано: ${n}. Элементы остались в модели — Ctrl+V вернёт их вид.` });
  return n;
}

/**
 * Ctrl+V. Same diagram → duplicate; another diagram → views of the same
 * elements. Returns a short report for the status line.
 */
export function pasteClipboard() {
  const cb = store.clipboard;
  if (!cb) return null;
  if (!cb.shapes.length) {
    set({ hint: 'В буфере только связи — скопируйте фигуры, связь вставляется вместе с концами.' });
    return null;
  }
  const d = currentDiagram(store.model);
  if (!d) return null;

  cb.pastes = (cb.pastes ?? 0) + 1;
  const step = SNAP * cb.pastes;
  const same = cb.diagramId === d.id;
  // Same sheet duplicates — unless the copy came from a cut, which promises to
  // put the same elements back rather than clone them.
  const asViews = !same || cb.cut === true;
  if (cb.cut) cb.cut = false;

  const result = commit('Вставка', (m) => {
    const target = currentDiagram(m);
    const elementMap = new Map();      // clipboard element id → element id here
    return asViews
      ? pasteAsViews(m, target, cb, step, elementMap)
      : duplicateInto(m, target, cb, step, elementMap);
  });

  renderCanvas();
  set({
    selection: result.shapes.map((s) => ({ kind: 'shape', id: s.id })),
    hint: asViews
      ? `Вставлено видов существующих элементов: ${result.reused}`
        + `${result.added ? `, новых элементов: ${result.added}` : ''}.`
      : `Вставлено фигур: ${result.added} — это новые элементы (Ctrl+D делает то же с выделением).`,
  });
  return { count: result.shapes.length, same };
}

/** Ctrl+D: always new elements, always on this diagram, offset by one grid step. */
export function duplicateSelection() {
  const m = store.model;
  const d = currentDiagram(m);
  const ids = new Set(store.ui.selection.filter((s) => s.kind === 'shape').map((s) => s.id));
  if (!d || !ids.size) return null;
  const shapes = d.shapes.filter((s) => ids.has(s.id));
  const cb = {
    diagramId: d.id,
    elements: shapes.map((s) => deepClone(findElement(m, s.elementId))).filter(Boolean),
    shapes: deepClone(shapes),
    relationships: [],
    links: [],
  };
  const made = commit('Дубликат', (mm) => duplicateInto(mm, currentDiagram(mm), cb, SNAP, new Map()));
  if (!made.added) return null;
  renderCanvas();
  set({
    selection: made.shapes.map((s) => ({ kind: 'shape', id: s.id })),
    hint: `Дубликат: ${made.added} фигур со сдвигом на шаг сетки.`,
  });
  return { count: made.added };
}

/* ------------------------------------------------------------- internals */

/** New elements + new shapes + the links between them, offset by `step`. */
function duplicateInto(m, d, cb, step, elementMap) {
  const shapes = [];
  for (const src of cb.shapes) {
    const el = cb.elements.find((e) => e.id === src.elementId);
    if (!el) continue;
    const copy = createElement(el.kind, { name: el.name });
    // Everything that makes the element itself: name, stereotype, members,
    // flags, tagged values. The id is the only thing that must differ.
    Object.assign(copy, deepClone(el), { id: copy.id });
    m.elements.push(copy);
    elementMap.set(el.id, copy.id);
    const shape = createShape(copy, src.x + step, src.y + step, { w: src.w, h: src.h, fill: src.fill });
    if (src.fixedH) shape.fixedH = true;
    d.shapes.push(shape);
    shapes.push(shape);
  }
  const shapeOf = (clipShapeId) => {
    const i = cb.shapes.findIndex((s) => s.id === clipShapeId);
    return i < 0 ? null : shapes[i] ?? null;
  };
  for (const l of cb.links) {
    const rel = cb.relationships.find((r) => r.id === l.relId);
    if (!rel) continue;
    // Свободный конец сообщения (найдено/потеряно) переносится как свободный.
    const from = rel.from == null ? null : elementMap.get(rel.from);
    const to = rel.to == null ? null : elementMap.get(rel.to);
    const sf = l.from ? shapeOf(l.from.shapeId) : null;
    const st = l.to ? shapeOf(l.to.shapeId) : null;
    if ((rel.from != null && !from) || (rel.to != null && !to)) continue;
    if ((l.from && !sf) || (l.to && !st)) continue;
    const made = createRelationship(rel.kind, from, to, rel.name);
    Object.assign(made, deepClone(rel), { id: made.id, from, to });
    m.relationships.push(made);
    d.links.push(createLink(made,
      sf ? { ...deepClone(l.from), shapeId: sf.id } : null,
      st ? { ...deepClone(l.to), shapeId: st.id } : null,
      l.y != null ? { y: l.y } : {}));
  }
  return { added: shapes.length, reused: 0, shapes };
}

/** A view of the element that already exists, on this diagram. */
function pasteAsViews(m, d, cb, step, elementMap) {
  const shapes = [];
  let added = 0;
  let reused = 0;
  for (const src of cb.shapes) {
    const clipEl = cb.elements.find((e) => e.id === src.elementId);
    if (!clipEl) continue;
    let el = findElement(m, clipEl.id);
    if (el) {
      reused += 1;
    } else {
      // The element was deleted since the copy: paste a copy, not a ghost.
      const copy = createElement(clipEl.kind, { name: clipEl.name });
      Object.assign(copy, deepClone(clipEl), { id: copy.id });
      m.elements.push(copy);
      el = copy;
      added += 1;
    }
    elementMap.set(clipEl.id, el.id);
    const already = d.shapes.find((s) => s.elementId === el.id);
    if (already) { shapes.push(already); continue; }
    const shape = createShape(el, src.x + step, src.y + step, { w: src.w, h: src.h, fill: src.fill });
    if (src.fixedH) shape.fixedH = true;
    d.shapes.push(shape);
    shapes.push(shape);
  }
  const shapeOf = (clipShapeId) => {
    const i = cb.shapes.findIndex((s) => s.id === clipShapeId);
    return i < 0 ? null : shapes[i] ?? null;
  };
  // A relationship that already exists between two pasted elements is reused;
  // its view is added only if this diagram does not show it yet.
  for (const l of cb.links) {
    const rel = cb.relationships.find((r) => r.id === l.relId);
    if (!rel) continue;
    const from = rel.from == null ? null : elementMap.get(rel.from);
    const to = rel.to == null ? null : elementMap.get(rel.to);
    const sf = l.from ? shapeOf(l.from.shapeId) : null;
    const st = l.to ? shapeOf(l.to.shapeId) : null;
    if ((rel.from != null && !from) || (rel.to != null && !to)) continue;
    if ((l.from && !sf) || (l.to && !st)) continue;
    let existing = findRelationship(m, rel.id);
    if (!existing) {
      existing = createRelationship(rel.kind, from, to, rel.name);
      Object.assign(existing, deepClone(rel), { id: existing.id, from, to });
      m.relationships.push(existing);
    }
    const shown = d.links.some((x) => x.relId === existing.id
      && x.from?.shapeId === sf?.id && x.to?.shapeId === st?.id);
    if (shown) continue;
    d.links.push(createLink(existing,
      sf ? { ...deepClone(l.from), shapeId: sf.id } : null,
      st ? { ...deepClone(l.to), shapeId: st.id } : null,
      l.y != null ? { y: l.y } : {}));
  }
  return { added, reused, shapes };
}
