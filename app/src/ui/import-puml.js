// «Файл → Импорт PlantUML…»: a `.puml` file, or text pasted into a dialog.
//
// The import TRANSFERS INFORMATION, NOT LAYOUT: `io/plantuml.js` reads the
// text into a `uml-model/3` document, `io/plantuml-layout.js` puts the shapes
// on a predictable grid, and this module only does the three things that need
// the running application:
//
//   * ask for the text (file picker or paste dialog);
//   * merge the result into the OPEN model as a NEW SHEET — nothing already in
//     the document is replaced or renamed, ids that would collide are
//     re-issued;
//   * report what was read and what was skipped, with line numbers, in a toast
//     with a «Подробности» action.
//
// Nothing here parses or lays out. That is why the two modules above are pure
// and can be tested under Node without a page.

import { parse } from '../io/plantuml.js';
import { seed } from '../io/plantuml-layout.js';
import { store, set, commit } from '../state/store.js';
import { renderCanvas, fitToWindow } from './canvas.js';
import { ScToast } from '../../ui-kit/js/toast.js';
import { ScDialog } from '../../ui-kit/js/dialog.js';
import { uid } from '../util.js';
import { track } from '../telemetry.js';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Open the file picker for `.puml` / `.plantuml` / `.txt`. */
export function openPumlPicker() {
  document.getElementById('puml-input')?.click();
}

/** Called by the page when the hidden input changes. */
export async function importPumlFile(file) {
  if (!file) return null;
  const text = await file.text();
  return importPumlText(text, file.name);
}

/**
 * Read `text` and put it on a new sheet of the current model.
 *
 * @param {string} text the `.puml` contents
 * @param {string} [fileName] used for the sheet name when the file has no `title`
 * @returns {{sheet: object, elements: number, relationships: number, warnings: Array}|null}
 */
export function importPumlText(text, fileName = null) {
  let parsed;
  try {
    parsed = parse(text, { fileName });
  } catch (e) {
    // `import.plantuml` сообщает только «получилось ли» и сколько конструкций
    // прочитано: ни текста .puml, ни строк с ошибками, ни имени файла.
    track('import.plantuml', { ok: false, constructs: 0 });
    ScToast.show(`PlantUML не прочитан: ${e.message}`, { tone: 'danger' });
    return null;
  }
  const { model: incoming, warnings } = parsed;
  seed(incoming, { frames: parsed.frames, blocks: parsed.blocks });

  const elements = incoming.elements.length;
  const relationships = incoming.relationships.length;
  const title = incoming.diagrams[0]?.name || (fileName ? fileName.replace(/\.[^.]+$/, '') : 'Импорт PlantUML');

  if (!elements) {
    track('import.plantuml', { ok: false, constructs: 0 });
    ScToast.show('В тексте не нашлось ни одного элемента — импорт не выполнен',
      { tone: 'warning', action: warnings.length ? { label: 'Подробности', onSelect: () => showWarnings(warnings) } : undefined });
    return null;
  }

  const sheet = commit('Импорт PlantUML', (m) => addSheet(m, incoming, title));
  set({ selection: [], pending: null, hint: `Импортирован лист «${sheet.name}»: ${elements} элементов, ${relationships} связей.` });
  renderCanvas();
  fitToWindow();

  const skipped = warnings.length;
  const text2 = `Импортировано: ${elements} ${plural(elements, 'элемент', 'элемента', 'элементов')}, `
    + `${relationships} ${plural(relationships, 'связь', 'связи', 'связей')}`
    + (skipped ? `, ${skipped} ${plural(skipped, 'строка', 'строки', 'строк')} пропущено` : '');
  ScToast.show(text2, {
    tone: skipped ? 'warning' : 'success',
    duration: skipped ? 8000 : 4000,
    action: skipped ? { label: 'Подробности', onSelect: () => showWarnings(warnings) } : undefined,
  });
  track('import.plantuml', { ok: true, constructs: elements + relationships });
  return { sheet, elements, relationships, warnings };
}

/**
 * Merge an imported document into `model` as one more sheet.
 *
 * Ids are re-issued on collision (an imported `e3` must not become the editor's
 * own `e3`), and every reference — relationship ends, lanes, owners, shape
 * element ids, link relationship ids — is rewritten with the same table, so a
 * file never joins the document half-renamed.
 */
function addSheet(model, incoming, title) {
  if (!Array.isArray(model.elements)) model.elements = [];
  if (!Array.isArray(model.relationships)) model.relationships = [];
  if (!Array.isArray(model.diagrams)) model.diagrams = [];
  if (!Array.isArray(model.generalizationSets)) model.generalizationSets = [];

  const taken = new Set([
    ...model.elements.map((e) => e.id),
    ...model.relationships.map((r) => r.id),
    ...model.diagrams.map((d) => d.id),
  ]);
  const ids = new Map();
  const fresh = (kind) => {
    let id = uid(kind);
    while (taken.has(id)) id = uid(kind);
    taken.add(id);
    return id;
  };

  for (const el of incoming.elements) {
    const id = taken.has(el.id) ? fresh('e') : el.id;
    taken.add(id);
    ids.set(el.id, id);
  }
  for (const rel of incoming.relationships) {
    const id = taken.has(rel.id) ? fresh('r') : rel.id;
    taken.add(id);
    ids.set(rel.id, id);
  }
  const sets = new Map();
  for (const s of incoming.generalizationSets ?? []) {
    const id = taken.has(s.id) ? fresh('gs') : s.id;
    taken.add(id);
    sets.set(s.id, id);
  }

  for (const el of incoming.elements) {
    el.id = ids.get(el.id);
    if (el.ownerId && ids.has(el.ownerId)) el.ownerId = ids.get(el.ownerId);
    if (el.lane && ids.has(el.lane)) el.lane = ids.get(el.lane);
    model.elements.push(el);
  }
  for (const rel of incoming.relationships) {
    rel.id = ids.get(rel.id);
    rel.from = ids.get(rel.from) ?? null;
    rel.to = ids.get(rel.to) ?? null;
    if (rel.setId && sets.has(rel.setId)) rel.setId = sets.get(rel.setId);
    model.relationships.push(rel);
  }
  for (const s of incoming.generalizationSets ?? []) {
    s.id = sets.get(s.id);
    model.generalizationSets.push(s);
  }

  const source = incoming.diagrams[0] ?? { kind: 'class', shapes: [], links: [] };
  // Shapes and links are numbered per sheet, so they only need to be unique
  // INSIDE the new diagram; the element and relationship ids are what had to
  // be re-issued, and `ids` already did it.
  const shapeIds = new Map();
  const shapes = (source.shapes ?? []).map((s, i) => {
    const id = `s${i + 1}`;
    shapeIds.set(s.id, id);
    return {
      id,
      elementId: ids.get(s.elementId) ?? s.elementId,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      fill: null,
    };
  });
  const links = (source.links ?? []).map((l, i) => ({
    id: `l${i + 1}`,
    relId: ids.get(l.relId) ?? l.relId,
    from: { ...l.from, shapeId: shapeIds.get(l.from?.shapeId) ?? l.from?.shapeId },
    to: { ...l.to, shapeId: shapeIds.get(l.to?.shapeId) ?? l.to?.shapeId },
    ...(l.y != null ? { y: l.y } : {}),
  }));
  const diagram = {
    id: fresh('d'),
    name: title,
    kind: source.kind,
    ownerElementId: null,
    shapes,
    links,
  };
  model.diagrams.push(diagram);
  model.currentDiagramId = diagram.id;

  // The sheet grows to hold the imported picture; it never shrinks under what
  // was already there.
  const want = incoming.sheet ?? { w: 720, h: 440 };
  model.sheet = {
    w: Math.max(model.sheet?.w ?? 720, want.w),
    h: Math.max(model.sheet?.h ?? 440, want.h),
  };
  return diagram;
}

/** The list a person reads after an import: line, text, reason. */
export function showWarnings(warnings) {
  const rows = warnings.slice(0, 80).map((w) => `<li><b>строка ${w.line}</b> — ${escapeHtml(w.reason)}`
    + `<br><span class="mono">${escapeHtml(w.text)}</span></li>`).join('');
  const more = warnings.length > 80 ? `<p>…и ещё ${warnings.length - 80}.</p>` : '';
  return ScDialog.open({
    heading: `Что не прочитано — ${warnings.length}`,
    body: warnings.length
      ? `<p>Остальное импортировано. Каждая строка ниже осталась за пределами модели.</p>
         <ul class="puml-warnings">${rows}</ul>${more}`
      : '<p>Ни одной пропущенной строки.</p>',
    buttons: [{ id: 'ok', label: 'Понятно', kind: 'primary' }],
  });
}

/**
 * «Вставить текст»: read a `.puml` from the clipboard-sized textarea, so a
 * person can try an import without making a file first.
 */
export async function openPasteDialog() {
  let value = '';
  const pending = ScDialog.open({
    heading: 'Импорт PlantUML из текста',
    body: `
      <p>Вставьте текст от <span class="mono">@startuml</span> до <span class="mono">@enduml</span>.
      Импорт пойдёт на <b>новый лист</b> текущей модели — ничего существующего не заменится,
      а раскладку вы сделаете сами.</p>
      <label class="field">Текст PlantUML
        <textarea id="puml-paste" rows="14" spellcheck="false" autofocus
          placeholder="@startuml&#10;class A&#10;class B&#10;A --> B&#10;@enduml"></textarea>
      </label>`,
    buttons: [
      { id: 'cancel', label: 'Отмена', kind: 'ghost' },
      { id: 'ok', label: 'Импортировать', kind: 'primary' },
    ],
  });
  const dlg = document.querySelector('sc-dialog[open]');
  const area = dlg?.querySelector('#puml-paste');
  area?.addEventListener('input', () => { value = area.value; });
  const id = await pending;
  if (id !== 'ok') return null;
  const text = area ? area.value : value;
  if (!text.trim()) {
    ScToast.show('Пустой текст — импортировать нечего', { tone: 'warning' });
    return null;
  }
  return importPumlText(text, 'Импорт PlantUML');
}

/** Russian plural, so the toast does not read «3 строка пропущено». */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** How many elements and links the current model holds (for tests and hints). */
export const importedCounts = () => ({
  elements: store.model.elements.length,
  relationships: store.model.relationships.length,
  diagrams: store.model.diagrams.length,
});
