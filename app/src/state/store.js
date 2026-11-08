// Application state with snapshot undo/redo, in the same shape as the
// reference modeler's store: model edits go through `commit()` (which
// snapshots first), drag steps through `mutate()`, UI-only changes through
// `set()`.

import { deepClone } from '../util.js';
import { createModel, currentDiagram } from '../model/model.js';
import { MECHANICS } from '../mechanics.generated.js';

const MAX_HISTORY = 100;
export const AUTOSAVE_KEY = 'uml-class-modeler.autosave';
/**
 * Имя последнего файла, с которым работали. Отдельный ключ, а не поле
 * автосохранения: копия автосохранения исчезает после «Сохранить», а имя
 * файла остаётся нужным — экран «Начало работы» показывает его строкой
 * «Последний файл: …». Ключ живёт только в этом браузере и ничего не
 * отправляет наружу.
 */
export const LAST_FILE_KEY = 'uml-class-modeler.last-file';

export const store = {
  model: createModel(),
  ui: {
    selection: [],          // [{ kind:'shape'|'connector', id }] — always a list
    tool: 'select',         // 'select' | shape kind | connector kind
    pending: null,          // in-progress connector: { from, cursor }
    view: { scale: 1, tx: 0, ty: 0 },
    // ShowGrid comes from the sheet, not from a literal: v/dap/r#<init>+0x0105
    // sets it false, and the packaged first-run preferences leave it false, so a
    // new diagram opens without a grid (MECHANICS §1c).
    showGrid: MECHANICS.showGrid,
    fileName: null,
    dirty: false,
    hint: '',
    // Записка «это поднято из автосохранения» переживает клики и выделения:
    // это не событие, а состояние документа. Гаснет она сама, как только
    // документ действительно изменился, — см. syncDirty.
    restoreNote: '',
    // След перехода от замечания: элементы модели, о которых говорит
    // замечание, и счётчик `at` — он растёт на каждый переход, чтобы дерево
    // знало, когда прокрутить строку ещё раз, а не на каждой перерисовке.
    // Это состояние интерфейса: в файл модели оно не пишется.
    findingFocus: null,
  },
  profile: null,            // loaded stereotype profile (io/stereotypes.js)
  clipboard: null,          // { diagramId, elements:[...], relationships:[...], shapes:[...] }
  _undo: [],
  _redo: [],
  _subs: new Set(),
  _rev: 0,
  // What a file holds right now: `snapshot()` of the model as last loaded from
  // or written to disk, or null when the document has never been saved (a new
  // model, a lesson copy, a recovered autosave). `store.ui.dirty` is derived
  // from it, never set by hand.
  _baseline: null,
};

/**
 * The model as bytes, for comparing against `_baseline`.
 *
 * `currentDiagramId` is a view (which sheet is open), not content: it is
 * written to the file, but A → B → A leaves the file byte for byte as it was,
 * so it is compared as null here and switching sheets never counts as an edit.
 */
const snapshot = (m) => JSON.stringify(m, (k, v) => (k === 'currentDiagramId' ? null : v));

/**
 * Recompute `ui.dirty` — the answer to «does the model differ from the file?»,
 * not «did anything happen?». `emit()` calls it before its subscribers, and
 * every model mutation calls it synchronously as well: callers read the flag
 * right after `commit()`/`undo()`, before the queued emit runs.
 */
function syncDirty() {
  store.ui.dirty = store._baseline === null || snapshot(store.model) !== store._baseline;
  // Записка о восстановлении описывает состояние «поднято из браузера и пока
  // ничем не тронуто». Первая настоящая правка это состояние отменяет: с этого
  // момента в статусбаре должно стоять обычное «есть несохранённые изменения».
  if (store.ui.dirty) store.ui.restoreNote = '';
}

/**
 * The selection is a LIST, so a group move, a group delete and an alignment
 * are the same operation as on one shape. Older code (and the self-checks)
 * still writes `{kind, id}`; `set()` normalises it to a one-item list instead
 * of keeping two shapes of the same idea.
 */
export function normalizeSelection(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.filter((x) => x && typeof x === 'object' && x.kind && x.id != null)
      .map((x) => ({ kind: x.kind, id: String(x.id) }));
  }
  if (typeof v === 'object' && v.kind && v.id != null) return [{ kind: v.kind, id: String(v.id) }];
  return [];
}

export const selection = () => store.ui.selection;
export const isSelected = (kind, id) => store.ui.selection.some((s) => s.kind === kind && s.id === id);
export const selectionCount = (kind = null) =>
  kind ? store.ui.selection.filter((s) => s.kind === kind).length : store.ui.selection.length;
/** The kind of a single-item selection (the inspector's single-object case). */
export const selectionKind = () => (store.ui.selection.length === 1 ? store.ui.selection[0].kind : null);

export function selectOnly(kind, id) {
  set({ selection: [{ kind, id }], hint: '' });
}

export function addToSelection(kind, id) {
  if (isSelected(kind, id)) return;
  set({ selection: [...store.ui.selection, { kind, id }] });
}

export function toggleSelection(kind, id) {
  set({
    selection: isSelected(kind, id)
      ? store.ui.selection.filter((s) => !(s.kind === kind && s.id === id))
      : [...store.ui.selection, { kind, id }],
  });
}

export const clearSelection = () => set({ selection: [] });


export function subscribe(fn) { store._subs.add(fn); return () => store._subs.delete(fn); }

export const modelRevision = () => store._rev;

let emitQueued = false;
let emitMeta = {};
export function emit(meta = {}) {
  emitMeta = meta.light && emitQueued ? emitMeta : { ...emitMeta, ...meta };
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    const m = emitMeta;
    emitMeta = {};
    syncDirty();
    for (const fn of store._subs) fn(store, m);
  });
}

/**
 * Change UI-only state. `selection` may be a list or one {kind, id}.
 *
 * След замечания (`findingFocus`) живёт ровно столько, сколько человек не
 * выбрал ничего сам: любой патч с `selection` без `findingFocus` его снимает.
 * Благодаря этому переходу от замечания достаточно положить оба поля одним
 * вызовом, а остальному коду — ничего не знать про след: клик по листу или по
 * строке дерева сам гасит подсветку «это про замечание».
 */
export function set(patch) {
  const next = 'selection' in patch ? { ...patch, selection: normalizeSelection(patch.selection) } : patch;
  if ('selection' in next && !('findingFocus' in next)) next.findingFocus = null;
  Object.assign(store.ui, next);
  emit();
}

/**
 * Apply an undoable change. `fn` mutates the model in place; an edit that
 * changes nothing records no history entry, and one that throws leaves the
 * model as it was.
 */
export function commit(label, fn) {
  const before = JSON.stringify(store.model);
  let result;
  try {
    result = fn(store.model);
  } catch (e) {
    store.model = JSON.parse(before);
    store._rev += 1;
    ensureSelection();
    emit();
    throw e;
  }
  if (JSON.stringify(store.model) === before) {
    emit();
    return result;
  }
  store._undo.push({ label, model: JSON.parse(before) });
  if (store._undo.length > MAX_HISTORY) store._undo.shift();
  store._redo.length = 0;
  store._rev += 1;
  syncDirty();
  scheduleAutosave();
  emit();
  return result;
}

/** Change the model without a history entry (during a drag). */
export function mutate(fn) {
  const result = fn(store.model);
  store._rev += 1;
  syncDirty();
  emit({ light: true });
  return result;
}

/** Push a history entry for a change `mutate` already applied. */
export function beginDrag(label) {
  store._undo.push({ label, model: deepClone(store.model) });
  if (store._undo.length > MAX_HISTORY) store._undo.shift();
  store._redo.length = 0;
}

export function endDrag() { syncDirty(); scheduleAutosave(); emit(); }

export function undo() {
  const entry = store._undo.pop();
  if (!entry) return;
  store._redo.push({ label: entry.label, model: deepClone(store.model) });
  store.model = entry.model;
  store._rev += 1;
  ensureSelection();
  syncDirty();
  scheduleAutosave();
  emit();
}

export function redo() {
  const entry = store._redo.pop();
  if (!entry) return;
  store._undo.push({ label: entry.label, model: deepClone(store.model) });
  store.model = entry.model;
  store._rev += 1;
  ensureSelection();
  syncDirty();
  scheduleAutosave();
  emit();
}

export const canUndo = () => store._undo.length > 0;
export const canRedo = () => store._redo.length > 0;

export function loadModel(model, fileName = null) {
  store.model = model;
  store._rev += 1;
  store._undo.length = 0;
  store._redo.length = 0;
  store.ui.selection = [];
  store.ui.pending = null;
  store.ui.tool = 'select';
  store.ui.fileName = fileName;
  // Открытый файл — «последний файл» этого браузера: экран начала работы
  // назовёт его, если человек вернётся к пустому старту.
  if (fileName) rememberFile(fileName);
  // A model opened from a file matches that file; a model built in memory (a
  // new one, a lesson copy, a recovered autosave) has nothing to match and is
  // dirty until it is saved under a name.
  store._baseline = fileName ? snapshot(model) : null;
  syncDirty();
  store.ui.hint = '';
  store.ui.restoreNote = '';
  scheduleAutosave();
  emit();
}

/**
 * Take the model on the sheet as the state a file holds, without a file name.
 * Used for the document the app itself opens at start: the person has not
 * written anything yet, so the statusbar stays quiet and closing the tab asks
 * nothing — unlike a new model, which is somebody's unsaved work.
 */
export function markClean() {
  store._baseline = snapshot(store.model);
  syncDirty();
  emit();
}

/** Drop selected items that no longer exist on the current diagram. */
export function ensureSelection() {
  const d = currentDiagram(store.model);
  if (!d) { store.ui.selection = []; return; }
  store.ui.selection = store.ui.selection.filter((sel) => (sel.kind === 'shape'
    ? d.shapes.some((s) => s.id === sel.id)
    : (d.links ?? []).some((c) => c.id === sel.id)));
  const p = store.ui.pending;
  if (p && !d.shapes.some((s) => s.id === p.from.shapeId)) store.ui.pending = null;
}

/** The one selected view (shape or link), or null for an empty/multi selection. */
export const selectedElement = () => {
  const sel = store.ui.selection;
  if (sel.length !== 1) return null;
  const d = currentDiagram(store.model);
  if (!d) return null;
  const it = sel[0];
  return it.kind === 'shape'
    ? d.shapes.find((s) => s.id === it.id) || null
    : (d.links ?? []).find((c) => c.id === it.id) || null;
};

/** Every selected view of one kind, in diagram order (z-order = draw order). */
export const selectedViews = (kind) => {
  const d = currentDiagram(store.model);
  if (!d) return [];
  const ids = new Set(store.ui.selection.filter((s) => s.kind === kind).map((s) => s.id));
  return kind === 'shape'
    ? d.shapes.filter((s) => ids.has(s.id))
    : (d.links ?? []).filter((l) => ids.has(l.id));
};

/* ------------------------------------------------------------- autosave */

let autosaveTimer = null;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (!store.ui.dirty) return;
  autosaveTimer = setTimeout(() => {
    if (!store.ui.dirty) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        at: Date.now(),
        fileName: store.ui.fileName,
        model: store.model,
      }));
    } catch { /* private window: the copy simply won't persist */ }
  }, 700);
}

/** The model was written to a file: clean, and the copy is no longer wanted. */
/** Запомнить имя файла для строки «Последний файл» на экране начала работы. */
function rememberFile(fileName) {
  if (!fileName) return;
  try { localStorage.setItem(LAST_FILE_KEY, fileName); } catch { /* хранилище закрыто */ }
}

export function markSaved(fileName) {
  clearTimeout(autosaveTimer);
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  rememberFile(fileName);
  store._baseline = snapshot(store.model);
  set({ fileName, hint: `Сохранено: ${fileName}` });
  syncDirty();
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearAutosave() {
  clearTimeout(autosaveTimer);
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}
