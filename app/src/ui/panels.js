// The side panels and the statusbar.
//   left: the model tree — diagrams (a diagram may belong to an element) and
//         every element of the model, not just the shapes on this sheet
//   right: Свойства (inspector), Профиль
//   statusbar: hint, selection, zoom menu, coordinates, counts, profile.
//
// `uml-model/3`: the inspector edits the ELEMENT (name, stereotype,
// documentation, members, tagged values) and the SHAPE only where the property
// is per diagram (fill, size). A connector's inspector edits the RELATIONSHIP,
// so its name, stereotype and tagged values are the same on every diagram.

import { el, clear, uid, plural } from '../util.js';
import { NOTATION, VISIBILITIES, visByKey, typeOf } from '../model/notation.js';
import {
  store, set, commit, mutate, beginDrag, endDrag, selectedElement, selectionKind,
} from '../state/store.js';
import {
  elementOf, findElement, findShape, findLink, currentDiagram, shapesOf,
  showElement, addMemberRow, removeMemberRow, moveMemberRow, compartmentsOf,
  setTaggedValue, removeTaggedValue, relOf, findRelationship, createDiagram,
  addLine, removeLine, setLine, nestedDiagrams, findDiagram, removeDiagram,
  removeLink, removeRelationship, removeShape, removeElement, linksOf, relsOfElement,
  MEMBER_FLAGS, isAbstractable, AGGREGATIONS, NAVIGABILITIES,
  aggregationOf, navigableOf, generalizationSetsOf, createGeneralizationSet,
  setOfRelationship, findGeneralizationSet,
  ownerCandidates, setOwner, ownerPath, isMessage, regionMembers,
  createRegion, internalsOf, regionsOf, qualifiersOf,
  diagramOwnerCandidates, setDiagramOwner, internalText,
} from '../model/model.js';
import {
  applicable, groupedByBaseType, baseTypeFor, baseTypesFor, resolveStereotype, taggedDefsFor,
  reachabilityOf, NOTATION_GAPS,
} from '../io/stereotypes.js';
import { fillOf, themeFill, FILL_SOLID, FILL_GRADIENT, GRADIENT_STYLES } from '../model/fill.js';
import { icon, shapeIcon } from './icons.js';
import { layoutOf, headSizeOf } from '../model/geometry.js';
import {
  isConnectorStyle, STYLE_INHERIT, STYLE_OPTIONS, LABEL_ORIENTATION, ORIENTATION_OPTIONS,
} from '../model/connector-style.js';
import { isLineJumps, JUMP_INHERIT, JUMP_OPTIONS } from '../model/line-jumps.js';
import { MECHANICS } from '../mechanics.generated.js';
import { setZoom, fitToWindow, addMemberRowOnSheet, renderCanvas, DND_ELEMENT } from './canvas.js';
import { chooseDiagramType } from './dialog.js';
import { ALIGN_COMMANDS, arrange } from './arrange.js';
import { alignIcon } from './align-icons.js';
import { openChecksPanel, renderChecksStatus } from './checks.js';

export const FILL_SWATCHES = [
  { key: null, css: '#ffffff', title: 'Белый лист' },
  { key: '#ffffe0', css: '#ffffe0', title: 'Светло-жёлтый' },
  { key: '#e8f4ff', css: '#e8f4ff', title: 'Светло-голубой' },
  { key: '#e9ffe0', css: '#e9ffe0', title: 'Светло-зелёный' },
  { key: '#ffe8e8', css: '#ffe8e8', title: 'Светло-розовый' },
];

/* ------------------------------------------------------------ helpers */

/** Тема, в которой сейчас рисуется лист (см. src/ui/appearance.js). */
const themeIsDark = () => document.documentElement.dataset.race === 'dark';

function bindText(input, value, apply) {
  input.value = value ?? '';
  let began = false;
  input.addEventListener('input', () => {
    if (!began) { beginDrag('Правка'); began = true; }
    mutate((m) => apply(m, input.value));
  });
  const stop = () => { if (began) { endDrag(); began = false; } };
  input.addEventListener('change', stop);
  input.addEventListener('blur', stop);
}

function bindCommit(input, value, apply) {
  input.value = value ?? '';
  input.addEventListener('change', () => commit('Правка', (m) => apply(m, input.value)));
}

const field = (labelText, control) => {
  if (!control.getAttribute('aria-label')) control.setAttribute('aria-label', labelText);
  return el('div', { class: 'field' }, el('label', { text: labelText }), control);
};

const section = (titleText, extra) => el('h3', { class: 'sect' }, titleText, extra ?? '');

let modelQuery = '';

const STATE_GLYPH = { here: '●', other: '○', nowhere: '◌' };

export function initPanels() {
  const search = document.getElementById('model-search');
  if (search) {
    search.addEventListener('input', () => {
      modelQuery = search.value;
      renderModel();
    });
  }
}

/* ---------------------------------------------------- память дерева */

// Свёрнутость и порядок — состояние ЧЕЛОВЕКА, а не модели: в файл они не
// пишутся, но переживают перезагрузку через localStorage. Ключ
// `uml-tree-collapsed` — множество id свёрнутых узлов; второй ключ хранит те
// узлы, что свёрнуты ПО УМОЛЧАНИЮ (группы видов, связи, вложенные листы,
// ветка «Модель») и которые человек развернул. Без него «не трогали» и
// «развернули обратно» были бы одним состоянием.
const TREE_COLLAPSED = 'uml-tree-collapsed';
const TREE_OPENED = 'uml-tree-open';
const TREE_SORT = 'uml-tree-sort';

const TREE_SORTS = [
  ['file', 'по порядку в файле'],
  ['name', 'по имени'],
  ['kind', 'по виду'],
];

/** Сломанное хранилище — это «память пуста», а не падение панели. */
function readIdSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch { return new Set(); }
}

function writeIdSet(key, ids) {
  try { localStorage.setItem(key, JSON.stringify([...ids])); } catch { /* хранилище закрыто */ }
}

let collapsedIds = readIdSet(TREE_COLLAPSED);
let openedIds = readIdSet(TREE_OPENED);
let treeSort = (() => {
  try {
    const v = localStorage.getItem(TREE_SORT);
    return TREE_SORTS.some(([k]) => k === v) ? v : 'file';
  } catch { return 'file'; }
})();

/**
 * Стабильные id узлов дерева: по ним помнится свёрнутость.
 *   sheet:<лист>            корень и вложенные листы
 *   els:<лист>              группа «Элементы (N)» внутри листа
 *   srels:<лист>            «Связи (N)» листа
 *   nested:<лист>           «Сложенные диаграммы (N)»
 *   model                   ветка «Модель»
 *   e:<элемент>             строка элемента в ветке «Модель»
 *   mrels:<элемент>         «Связи (N)» элемента в ветке «Модель»
 */
const TREE_ID = {
  sheet: (id) => `sheet:${id}`,
  nested: (id) => `nested:${id}`,
  model: () => 'model',
  element: (id) => `e:${id}`,
  elementRels: (id) => `mrels:${id}`,
};

const isCollapsed = (id, byDefault = false) => collapsedIds.has(id)
  || (byDefault && !openedIds.has(id));

function setCollapsed(id, collapsed, byDefault = false) {
  if (collapsed) { collapsedIds.add(id); openedIds.delete(id); }
  else { collapsedIds.delete(id); if (byDefault) openedIds.add(id); }
  writeIdSet(TREE_COLLAPSED, collapsedIds);
  writeIdSet(TREE_OPENED, openedIds);
}

/* ------------------------------------------------ подписи и порядок видов */

const kindLabel = (kind) => NOTATION.shapes[kind]?.label
  ?? NOTATION.connectors[kind]?.label ?? kind;
const diagramKind = (d) => typeOf(d?.kind)?.label ?? d?.kind ?? 'диаграмма';

const cmpName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru');
const cmpKind = (a, b) => kindLabel(a.kind).localeCompare(kindLabel(b.kind), 'ru') || cmpName(a, b);
const cmpDiagram = (a, b) => diagramKind(a).localeCompare(diagramKind(b), 'ru') || cmpName(a, b);

const sortList = (list) => (treeSort === 'file'
  ? list
  : [...list].sort(treeSort === 'name' ? cmpName : cmpKind));

/* ------------------------------------------------------------ поиск */

/** Члены, по именам которых тоже ищут: атрибуты, операции, литералы, слоты. */
const MEMBER_LISTS = ['attributes', 'operations', 'literals', 'slots'];

function memberNames(e) {
  const out = [];
  for (const f of MEMBER_LISTS) {
    for (const row of (Array.isArray(e?.[f]) ? e[f] : [])) {
      if (row?.name) out.push(String(row.name));
      if (row?.type) out.push(String(row.type));
    }
  }
  return out;
}

/** Поля самого элемента: имя, вид, стереотип, документация, члены. */
const ownFields = (e) => [
  e.name, kindLabel(e.kind), e.stereotype, e.documentation, ...memberNames(e),
];

const ownMatch = (e, q) => ownFields(e).some((v) => String(v ?? '').toLowerCase().includes(q));

/** Элемент подходит: свои поля или имя любой его связи. */
const matchesQuery = (m, e, q) => ownMatch(e, q)
  || relsOfElement(m, e.id).some((r) => String(r.name ?? '').toLowerCase().includes(q));

const matchesDiagram = (d, q) => String(d.name ?? '').toLowerCase().includes(q)
  || diagramKind(d).toLowerCase().includes(q);

/**
 * Поиск по дереву скрывает элемент, к которому ведёт замечание. Возвращает
 * true, если такой элемент есть и запрос его не пропускает: тогда фильтр надо
 * снять, иначе переход упирается в «Ничего не найдено».
 */
function hidesFindingFocus(m, q) {
  const ids = store.ui.findingFocus?.elementIds ?? [];
  return ids.some((id) => {
    const e = m.elements.find((x) => x.id === id);
    return !!e && !matchesQuery(m, e, q);
  });
}

/** `at` последнего перехода, до которого дерево уже доскроллило. */
let scrolledFindingAt = 0;

/* ------------------------------------------------------------ модель */

function elementState(m, element) {
  const diagram = currentDiagram(m);
  if (diagram?.shapes.some((s) => s.elementId === element.id)) return 'here';
  return shapesOf(m, element.id).length ? 'other' : 'nowhere';
}

/** Диаграммы, на которых элемент показан, — для инспектора и подсказки. */
const usedOn = (m, elementId) => (m.diagrams ?? [])
  .filter((d) => (d.shapes ?? []).some((s) => s.elementId === elementId));

/** Элементы листа без повторов: одна фигура на элемент на этом листе. */
function elementsOn(m, diagram) {
  const ids = [];
  const seen = new Set();
  for (const s of diagram?.shapes ?? []) {
    if (seen.has(s.elementId)) continue;
    seen.add(s.elementId);
    const e = m.elements.find((x) => x.id === s.elementId);
    if (e) ids.push(e);
  }
  return ids;
}

function freeSpot(diagram, w, h) {
  const shapes = diagram?.shapes ?? [];
  for (let y = 40; y < 4000; y += 20) {
    for (let x = 40; x < 4000; x += 20) {
      const hit = shapes.some((s) => x < s.x + s.w + 20 && x + w + 20 > s.x
        && y < s.y + s.h + 20 && y + h + 20 > s.y);
      if (!hit) return { x, y };
    }
  }
  return { x: 40, y: 40 };
}

/** Switch the sheet to `id` (used by the tree and the inspector). */
function openDiagram(id) {
  if (!findDiagram(store.model, id)) return;
  if (store.model.currentDiagramId === id) return;
  commit('Смена диаграммы', (m) => { m.currentDiagramId = id; });
  set({ selection: null, pending: null, hint: '' });
  fitToWindow();
  renderModel();
}

/** Текст с подсветкой совпадения: `<mark>` вокруг найденного, остальное — текст. */
function marked(text, q) {
  const s = String(text ?? '');
  if (!q) return [document.createTextNode(s)];
  const low = s.toLowerCase();
  const out = [];
  let at = 0;
  let i = low.indexOf(q);
  while (i >= 0) {
    if (i > at) out.push(document.createTextNode(s.slice(at, i)));
    out.push(el('mark', { text: s.slice(i, i + q.length) }));
    at = i + q.length;
    i = low.indexOf(q, at);
  }
  if (!out.length) return [document.createTextNode(s)];
  if (at < s.length) out.push(document.createTextNode(s.slice(at)));
  return out;
}

/* -------------------------------------------------------- строки дерева */

/**
 * Треугольник узла. Это <button>, а не глиф: у него есть `aria-expanded` и
 * имя для экранного диктора. Из обхода Tab он убран (`tabindex=-1`) — стоп
 * один на строку, иначе клавиатура проходила бы каждый узел дважды.
 */
function twisty(collapsed, id, byDefault, label) {
  return el('button', {
    type: 'button',
    class: `tr-twisty${collapsed ? '' : ' open'}`,
    'aria-expanded': collapsed ? 'false' : 'true',
    'aria-label': `${collapsed ? 'Развернуть' : 'Свернуть'}: ${label}`,
    title: collapsed ? 'Развернуть' : 'Свернуть',
    tabindex: '-1',
    onclick: (ev) => { ev.stopPropagation(); toggleNode(id, byDefault); },
  }, el('span', { 'aria-hidden': 'true', text: collapsed ? '▸' : '▾' }));
}

function toggleNode(id, byDefault = false) {
  setCollapsed(id, !isCollapsed(id, byDefault), byDefault);
  renderModel();
  // Панель перерисована — фокус возвращается на тот же узел, иначе с
  // клавиатуры его пришлось бы искать заново.
  requestAnimationFrame(() => {
    document.querySelector(`#model [data-tree-id="${id}"]`)?.focus();
  });
}

/**
 * Строка связи. `end` — элемент, под которым связь показана (ветка «Модель»):
 * тогда второй конец называется относительно него. Без `end` (связи листа)
 * называются оба конца: «Студент → Войти в систему».
 */
function relRow(rel, q, end = null) {
  const m = store.model;
  const label = NOTATION.connectors[rel.kind]?.label ?? rel.kind;
  const from = findElement(m, rel.from);
  const to = findElement(m, rel.to);
  const self = rel.from === rel.to;
  const name = rel.name || '(без имени)';
  const ends = end
    ? `${end.id === rel.from ? '→' : '←'} ${(end.id === rel.from ? to : from)?.name || '(без имени)'}`
    : `${from?.name || '(без имени)'} ${self ? '↻' : '→'} ${to?.name || '(без имени)'}`;
  const link = (currentDiagram(m)?.links ?? []).find((l) => l.relId === rel.id);
  const selected = !!link
    && store.ui.selection.some((s) => s.kind === 'connector' && s.id === link.id);
  return el('li', { role: 'none' }, el('div', {
    class: `tr-rel${selected ? ' current' : ''}`,
    role: 'treeitem',
    tabindex: '0',
    'data-rel-id': rel.id,
    title: `${label}: ${name} — ${ends}. Двойной щелчок откроет свойства, правый — меню.`,
    onclick: () => selectRel(rel),
    ondblclick: () => openRelProps(rel),
    oncontextmenu: (ev) => { ev.preventDefault(); openRelMenu(ev, rel); },
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectRel(rel); }
      else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
        ev.preventDefault(); openRelMenu(ev, rel);
      }
    },
  },
  el('span', { class: 'tr-rkind', text: label }),
  el('span', { class: 'nm' }, ...marked(name, q)),
  el('span', { class: 'tr-rend', text: ends })));
}

/** Клик по связи выделяет её ВИД на текущем листе, если вид есть. */
function selectRel(rel) {
  const link = (currentDiagram(store.model)?.links ?? []).find((l) => l.relId === rel.id);
  if (link) set({ selection: [{ kind: 'connector', id: link.id }], hint: '' });
  else set({ hint: 'Связь есть в модели, но не показана на этом листе.' });
}

/**
 * Двойной щелчок открывает свойства связи: в инспекторе справа их показывает
 * выделенный вид. Вида на этом листе нет — лист меняется на тот, где связь
 * нарисована; вида нет нигде — честная подсказка вместо пустого инспектора.
 */
function openRelProps(rel) {
  const m = store.model;
  const here = (currentDiagram(m)?.links ?? []).find((l) => l.relId === rel.id);
  if (here) { set({ selection: [{ kind: 'connector', id: here.id }], hint: '' }); return; }
  const elsewhere = linksOf(m, rel.id)[0];
  if (!elsewhere) {
    set({ hint: 'Связь есть в модели, но не показана ни на одной диаграмме — свойства откроются, когда она появится на листе.' });
    return;
  }
  commit('Переход к связи', (mm) => { mm.currentDiagramId = elsewhere.d.id; });
  set({
    selection: [{ kind: 'connector', id: elsewhere.l.id }],
    hint: `Связь показана на диаграмме «${elsewhere.d.name}» — свойства открыты там.`,
  });
  fitToWindow();
  renderModel();
}

/* --------------------------------------------------- действия строки */

function selectElement(e) {
  const d = currentDiagram(store.model);
  const shape = d?.shapes.find((s) => s.elementId === e.id);
  if (shape) set({ selection: [{ kind: 'shape', id: shape.id }], hint: '' });
  else set({
    hint: `«${e.name || '(без имени)'}» нет на этом листе — двойной щелчок или перетаскивание поставит элемент на лист.`,
  });
}

/**
 * Поставить элемент на ТЕКУЩИЙ лист. Если вид уже есть — выделяем его:
 * второй такой же вид на том же листе был бы дубликатом, а не «ещё одной
 * фигурой» (модель такого не запрещает, но человек этого не просил).
 */
function placeElementOnSheet(e) {
  const m = store.model;
  const d = currentDiagram(m);
  // Модель без диаграмм — пустой старт, а не ошибка: показать некуда, и
  // `showElement` упал бы на `currentDiagram(m).shapes`. Говорим, что делать.
  if (!d) {
    set({ hint: 'Сначала создайте диаграмму — Файл → Создать диаграмму.' });
    return;
  }
  const exists = d?.shapes.find((s) => s.elementId === e.id);
  if (exists) {
    set({ selection: [{ kind: 'shape', id: exists.id }], hint: `«${e.name || '(без имени)'}» уже на этом листе.` });
    return;
  }
  const def = NOTATION.shapes[e.kind];
  const spot = freeSpot(d, def?.defaultSize.w ?? 190, def?.defaultSize.h ?? 120);
  const shape = commit('Поставить элемент на диаграмму', (mm) => {
    const target = findElement(mm, e.id);
    if (!target) return null;
    return showElement(mm, target, spot.x, spot.y);
  });
  if (shape) set({ selection: [{ kind: 'shape', id: shape.id }], hint: `«${e.name || '(без имени)'}» поставлен на лист.` });
}

/** Переименование прямо в строке: Enter — принять, Esc — оставить. */
function startRename(e, row) {
  const nm = row?.querySelector('.nm');
  if (!nm) return;
  const input = el('input', {
    class: 'tr-rename', type: 'text', value: e.name ?? '',
    'aria-label': `Новое имя: ${e.name || '(без имени)'}`,
  });
  nm.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (!save) { renderModel(); return; }
    const value = input.value.trim();
    commit('Переименовать', (m) => {
      const target = findElement(m, e.id);
      if (target) target.name = value;
    });
    set({ hint: value ? `Переименовано в «${value}».` : 'Имя очищено.' });
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());
}

/** `openContextMenu` — модуль W1: ленивый импорт, панель не падает без него. */
async function showMenu(ev, items) {
  const rect = ev.target?.getBoundingClientRect?.() ?? { left: 0, bottom: 0 };
  const x = ev.clientX || rect.left;
  const y = ev.clientY || rect.bottom;
  try {
    const { openContextMenu } = await import('./context-menu.js');
    openContextMenu(x, y, items);
  } catch {
    set({ hint: 'Контекстное меню недоступно: модуль меню ещё не подключён.' });
  }
}

/** Меню элемента: свойства, переименование, лист, модель. */
function elementMenuItems(e) {
  const m = store.model;
  const d = currentDiagram(m);
  const shape = d?.shapes.find((s) => s.elementId === e.id);
  return [
    { label: 'Свойства', hint: 'в инспекторе справа', run: () => selectElement(e) },
    { label: 'Переименовать', run: () => startRename(e, document.querySelector(`#model [data-element-id="${e.id}"]`)) },
    {
      label: 'Поставить на лист',
      hint: d?.name ?? '',
      disabled: !!shape,
      run: () => placeElementOnSheet(e),
    },
    {
      label: 'Снять с диаграммы',
      hint: d?.name ?? '',
      disabled: !shape,
      run: () => {
        commit('Снять с диаграммы', (mm) => { if (shape) removeShape(mm, shape.id); });
        set({ selection: [], hint: `«${e.name || '(без имени)'}» снят с листа — в модели он остался.` });
      },
    },
    {
      label: 'Удалить из модели',
      hint: 'со всех листов и связей',
      danger: true,
      run: () => {
        commit('Удалить элемент', (mm) => removeElement(mm, e.id));
        set({ selection: [], hint: `«${e.name || '(без имени)'}» удалён из модели.` });
      },
    },
  ];
}

/** Меню листа: открыть, удалить, владелец. */
function sheetMenuItems(d) {
  const m = store.model;
  return [
    { label: 'Открыть', hint: d.name, run: () => openDiagram(d.id) },
    {
      label: 'Удалить диаграмму',
      hint: 'вместе с видами на ней',
      danger: true,
      disabled: (m.diagrams ?? []).length <= 1,
      run: () => {
        commit('Удалить диаграмму', (mm) => removeDiagram(mm, d.id));
        set({ hint: `Диаграмма «${d.name}» удалена.` });
      },
    },
    {
      label: 'Владелец…',
      hint: 'в инспекторе справа',
      run: () => {
        openDiagram(d.id);
        set({ selection: [] });
        requestAnimationFrame(() => {
          const sel = document.querySelector('#props select[aria-label="Владелец диаграммы"]');
          sel?.focus();
          sel?.scrollIntoView({ block: 'nearest' });
        });
        set({ hint: 'Владелец листа — в инспекторе справа, секция «Диаграмма».' });
      },
    },
  ];
}

/** Меню связи (как было): свойства, снять с листа, удалить из модели. */
function relMenuItems(rel) {
  const m = store.model;
  const link = (currentDiagram(m)?.links ?? []).find((l) => l.relId === rel.id);
  return [
    { label: 'Свойства', hint: 'в инспекторе справа', run: () => openRelProps(rel) },
    {
      label: 'Снять с диаграммы',
      hint: currentDiagram(m)?.name ?? '',
      disabled: !link,
      run: () => {
        commit('Снять связь с диаграммы', (mm) => { if (link) removeLink(mm, link.id); });
        set({ selection: [], hint: 'Связь снята с листа — в модели она осталась.' });
      },
    },
    {
      label: 'Удалить из модели',
      hint: 'со всех диаграмм',
      danger: true,
      run: () => {
        const label = NOTATION.connectors[rel.kind]?.label ?? rel.kind;
        commit('Удалить связь', (mm) => removeRelationship(mm, rel.id));
        set({ selection: [], hint: `Связь «${label}» удалена из модели.` });
      },
    },
  ];
}

const openRelMenu = (ev, rel) => showMenu(ev, relMenuItems(rel));

/* ------------------------------------------------------- перебор узлов */

/**
 * Какие листы раскрыты по умолчанию: первый и текущий. Остальные — свёрнуты.
 *
 * Почему не «все свёрнуты»: строку элемента из дерева берут сценарии
 * (smoke: «перетаскивание элемента из дерева на лист», types: treeRow) — при
 * полностью свёрнутом дереве такой строки в DOM нет вовсе. Свёрнутое до
 * одной строки на лист дерево получается кнопкой «Свернуть всё».
 */
function isSheetOpenByDefault(d, m) {
  const first = (m.diagrams ?? []).find((x) => !x.ownerElementId);
  return d.id === m.currentDiagramId || d.id === first?.id;
}

/**
 * Все узлы модели, у которых есть дети, — для «свернуть / развернуть всё».
 * Схема дерева: лист → «Элементы (N)» → элемент → диаграммы, которыми он
 * владеет (рекурсивно); у листа ещё «Связи (N)». Плюс ветка «Модель».
 */
function allTreeNodes(m) {
  const out = [];
  const shown = new Set((m.diagrams ?? []).flatMap((d) => d.shapes.map((s) => s.elementId)));
  for (const d of m.diagrams ?? []) {
    // Та же свёрнутость по умолчанию, что в sheetRow: первый и текущий открыты.
    out.push({ id: TREE_ID.sheet(d.id), byDefault: !isSheetOpenByDefault(d, m) });
  }
  for (const e of m.elements) {
    const owns = (m.diagrams ?? []).some((d) => d.ownerElementId === e.id);
    if (owns) out.push({ id: TREE_ID.element(e.id), byDefault: false });
    if (relsOfElement(m, e.id).length) out.push({ id: TREE_ID.elementRels(e.id), byDefault: true });
  }
  const orphans = m.elements.filter((e) => !shown.has(e.id));
  if (orphans.length) out.push({ id: TREE_ID.model(), byDefault: true });
  return out;
}

function collapseAll(collapsed) {
  const nodes = allTreeNodes(store.model);
  if (collapsed) {
    for (const n of nodes) { collapsedIds.add(n.id); openedIds.delete(n.id); }
  } else {
    collapsedIds.clear();
    openedIds.clear();
    for (const n of nodes) if (n.byDefault) openedIds.add(n.id);
  }
  writeIdSet(TREE_COLLAPSED, collapsedIds);
  writeIdSet(TREE_OPENED, openedIds);
  renderModel();
}

/** Шапка дерева: свернуть/развернуть всё, порядок и счётчик найденного. */
function treeBar(q, found) {
  const bar = el('div', { class: 'tr-bar' });
  bar.append(
    el('button', {
      type: 'button', class: 'tr-tool', text: '⊟',
      title: 'Свернуть всё', 'aria-label': 'Свернуть всё',
      onclick: () => collapseAll(true),
    }),
    el('button', {
      type: 'button', class: 'tr-tool', text: '⊞',
      title: 'Развернуть всё', 'aria-label': 'Развернуть всё',
      onclick: () => collapseAll(false),
    }),
  );
  const sort = el('select', {
    class: 'tr-sort', 'aria-label': 'Порядок в дереве', title: 'Сортировка дерева',
  });
  for (const [key, label] of TREE_SORTS) {
    sort.append(el('option', { value: key, text: label, selected: treeSort === key ? true : null }));
  }
  sort.addEventListener('change', () => {
    treeSort = sort.value;
    try { localStorage.setItem(TREE_SORT, treeSort); } catch { /* закрыто */ }
    renderModel();
  });
  bar.append(sort);
  if (q) {
    bar.append(el('span', {
      class: 'tr-found',
      text: `найдено ${found}`,
      title: 'Элементы и диаграммы, совпавшие с запросом: имя, вид, стереотип, документация, члены, связи',
    }));
  }
  return bar;
}

/* ------------------------------------------------------------ дерево */

export function renderModel() {
  const host = document.getElementById('model');
  if (!host) return;
  clear(host);
  const m = store.model;
  let q = modelQuery.trim().toLowerCase();
  if (q && hidesFindingFocus(m, q)) {
    // Поиск не вправе прятать то, к чему только что вели: переход обязан
    // показать строку, а не пустой список. Сброс — разовый, с подсказкой о нём.
    modelQuery = '';
    const search = document.getElementById('model-search');
    if (search) search.value = '';
    q = '';
    set({ hint: 'Поиск по дереву сброшен: он скрывал элемент, к которому ведёт замечание.' });
  }

  const selectedShapeIds = new Set(store.ui.selection.filter((s) => s.kind === 'shape').map((s) => s.id));
  const selectedElementIds = new Set([...selectedShapeIds]
    .map((id) => findShape(m, id)?.elementId).filter(Boolean));
  // Строки, о которых говорит замечание: `hit` — «это про замечание», в
  // отличие от `current` — «это выбрано».
  const hitIds = new Set((store.ui.findingFocus?.elementIds ?? []).map(String));

  // След замечания: переход обязан ПОКАЗАТЬ строку, а не упереться в
  // свёрнутый лист или свёрнутую ветку «Модель». Поэтому контейнеры на пути
  // к найденному раскрываются принудительно, пока след жив.
  const focusIds = new Set((store.ui.findingFocus?.elementIds ?? []).map(String));
  const focusAncestors = new Set();
  for (const id of focusIds) {
    let cur = findElement(m, id);
    while (cur) {
      focusAncestors.add(cur.id);
      cur = cur.ownerId ? findElement(m, cur.ownerId) : null;
    }
  }
  const sheetHasFocus = (d) => focusIds.size > 0
    && (d.shapes ?? []).some((s) => focusIds.has(String(s.elementId)));

  const shownAnywhere = new Set((m.diagrams ?? []).flatMap((d) => d.shapes.map((s) => s.elementId)));
  const roots = (m.diagrams ?? []).filter((d) => !d.ownerElementId
    || !shownAnywhere.has(d.ownerElementId));

  /* --- что нашлось (только при запросе) ---------------------------- */
  const matchedEls = new Set();
  const matchedSheets = new Set();
  if (q) {
    for (const d of m.diagrams ?? []) if (matchesDiagram(d, q)) matchedSheets.add(d.id);
    for (const e of m.elements) if (matchesQuery(m, e, q)) matchedEls.add(e.id);
    // Лист считается найденным, если на нём есть совпавшая фигура.
    for (const d of m.diagrams ?? []) {
      if (elementsOn(m, d).some((e) => matchedEls.has(e.id))) matchedSheets.add(d.id);
    }
  }
  const foundCount = matchedEls.size + matchedSheets.size;
  const searching = !!q;

  host.append(treeBar(q, foundCount));
  const wrap = el('div', { class: 'tree', role: 'tree', 'aria-label': 'Дерево модели' });
  const rendered = new Set();

  /**
   * Строка элемента. Дети — вложенные элементы (ownerId, только если владелец
   * тоже в этом списке) и диаграммы, которыми элемент владеет. Список внутри
   * листа остаётся плоским там, где вложенности нет (в корпусе её нет вовсе),
   * и не теряет структуру там, где она есть (пакет → класс).
   */
  const elementNode = (e, ctx) => {
    const state = elementState(m, e);
    const cur = selectedElementIds.has(e.id);
    const name = e.name || '(без имени)';
    const where = state === 'here' ? 'на этой диаграмме'
      : state === 'other' ? 'есть на другой диаграмме' : 'нигде не показан';
    const sheets = usedOn(m, e.id).map((d) => d.name);
    const whereMore = sheets.length ? ` Листы: ${sheets.join(', ')}.` : '';
    const owns = nestedDiagrams(m, e.id);
    const kids = ctx.childrenMap?.get(e.id) ?? [];
    const rels = relsOfElement(m, e.id);
    const id = TREE_ID.element(e.id);
    const hasChildren = kids.length > 0 || owns.length > 0;
    const collapsed = (ctx.forceOpen || focusAncestors.has(e.id)) ? false : isCollapsed(id, false);
    const row = el('div', {
      class: `node${cur ? ' current' : ''}${hitIds.has(String(e.id)) ? ' hit' : ''}`,
      role: 'treeitem',
      tabindex: '0',
      // id элемента — то, по чему переход от замечания находит и подсвечивает
      // строку; без него панель знала бы только имя, а оно не уникально.
      'data-element-id': e.id,
      'data-owner': e.ownerId ?? '',
      'data-tree-id': id,
      // Перетаскивание на лист — второй способ показать элемент (план 3.4).
      draggable: 'true',
      ondragstart: (ev) => {
        ev.dataTransfer.setData(DND_ELEMENT, e.id);
        ev.dataTransfer.setData('text/plain', name);
        ev.dataTransfer.effectAllowed = 'copy';
      },
      title: `${kindLabel(e.kind)}: ${name} — ${where}.${whereMore}`
        + (owns.length ? ` Своих диаграмм: ${owns.length}.` : '')
        + ' Двойной щелчок поставит элемент на текущий лист.',
      'aria-selected': cur ? 'true' : 'false',
      'aria-expanded': hasChildren ? (collapsed ? 'false' : 'true') : null,
      onclick: () => selectElement(e),
      ondblclick: () => placeElementOnSheet(e),
      oncontextmenu: (ev) => { ev.preventDefault(); showMenu(ev, elementMenuItems(e)); },
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectElement(e); }
        else if (ev.key === 'F2') { ev.preventDefault(); startRename(e, row); }
        else if (hasChildren && ev.key === 'ArrowLeft' && !collapsed) { ev.preventDefault(); toggleNode(id, false); }
        else if (hasChildren && ev.key === 'ArrowRight' && collapsed) { ev.preventDefault(); toggleNode(id, false); }
      },
    },
    hasChildren
      ? twisty(collapsed, id, false, name)
      : el('span', { class: 'tr-twisty tr-twisty-none', 'aria-hidden': 'true' }),
    shapeIcon(e.kind, 16),
    el('span', { class: 'nm' }, ...marked(name, q)),
    owns.length
      ? el('span', { class: 'nested-count', text: `▤ ${owns.length}`, title: `своих диаграмм: ${owns.length}` })
      : null,
    rels.length
      ? el('span', { class: 'tr-relcount', text: `↔ ${rels.length}`, title: `связей в модели: ${rels.length}` })
      : null,
    el('span', { class: `st-glyph st-${state}`, text: STATE_GLYPH[state], 'aria-label': where }));

    const li = el('li', { role: 'none' }, row);
    if (hasChildren && !collapsed) {
      const ul = el('ul', { class: 'nested tr-kids', role: 'group' });
      for (const child of kids) ul.append(elementNode(child, ctx));
      for (const x of owns) {
        // `inNested` — чтобы подпись строки сказала «вложенный лист», а не
        // «корень модели»: владелец ищет лист именно здесь, под элементом.
        const sheetLi = sheetRow(x, { inNested: true });
        if (sheetLi) ul.append(sheetLi);
      }
      li.append(ul);
    }
    return li;
  };

  /**
   * Раскладка списка элементов по владельцам: элемент, чей владелец тоже в
   * этом списке, — ребёнок владельца; остальные — верхний уровень списка.
   * Так «пакет → класс» читается вложенностью, а обычный лист без ownerId
   * остаётся плоским списком.
   */
  const ownerLayout = (list) => {
    const present = new Set(list.map((e) => e.id));
    const map = new Map();
    for (const e of sortList(list)) {
      const key = e.ownerId && present.has(e.ownerId) ? e.ownerId : null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return map;
  };

  /* --- строка листа (рекурсивно) ----------------------------------- */
  /**
   * Лист — корень дерева. Внутри — список содержимого: элементы в порядке
   * `diagram.shapes[]` (порядок, в котором их ставили на лист) и затем связи
   * в порядке `diagram.links[]`. Групп «Элементы»/«Связи» нет: владелец
   * попросил строки подряд, без собирающих узлов.
   */
  const sheetRow = (d, { inNested = false } = {}) => {
    if (rendered.has(d.id)) return null;
    rendered.add(d.id);
    const id = TREE_ID.sheet(d.id);
    const cur = d.id === m.currentDiagramId;
    const byDefault = !isSheetOpenByDefault(d, m);
    const forceOpen = (searching && matchedSheets.has(d.id)) || sheetHasFocus(d);
    const collapsed = forceOpen ? false : isCollapsed(id, byDefault);
    const elsAll = elementsOn(m, d);
    const els = searching ? elsAll.filter((e) => matchedEls.has(e.id)) : elsAll;
    const relsAll = (d.links ?? []).map((l) => relOf(m, l)).filter(Boolean);
    const rels = searching
      ? relsAll.filter((r) => String(r.name ?? '').toLowerCase().includes(q))
      : relsAll;
    const note = inNested ? 'вложенный лист' : 'корень модели';

    const row = el('div', {
      class: `node diagram${cur ? ' current' : ''}`,
      role: 'treeitem',
      tabindex: '0',
      'data-tree-id': id,
      'data-diagram-id': d.id,
      title: `${diagramKind(d)}: ${d.name} — ${note}. ${elsAll.length} фигур, ${relsAll.length} связей.`,
      'aria-selected': cur ? 'true' : 'false',
      'aria-expanded': collapsed ? 'false' : 'true',
      onclick: () => openDiagram(d.id),
      oncontextmenu: (ev) => { ev.preventDefault(); showMenu(ev, sheetMenuItems(d)); },
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDiagram(d.id); }
        else if (ev.key === 'ArrowLeft' && !collapsed) { ev.preventDefault(); toggleNode(id, byDefault); }
        else if (ev.key === 'ArrowRight' && collapsed) { ev.preventDefault(); toggleNode(id, byDefault); }
      },
    },
    twisty(collapsed, id, byDefault, d.name),
    el('span', { class: 'dglyph' }, icon('ui-diagram', 12)),
    el('span', { class: 'nm' }, ...marked(`Диаграмма «${d.name}»`, q)),
    el('span', { class: 'dtype', text: diagramKind(d) }));

    const li = el('li', { role: 'none' }, row);
    if (collapsed) return li;

    // Элементы и связи идут двумя блоками, а не вперемешку: связь между двумя
    // классами, вклинившаяся между ними, читалась бы как третий класс.
    const ctx = { childrenMap: ownerLayout(els), forceOpen: searching };
    const kids = [];
    for (const e of ctx.childrenMap.get(null) ?? []) kids.push(elementNode(e, ctx));
    for (const r of sortList(rels)) kids.push(relRow(r, q));
    if (kids.length) li.append(el('ul', { class: 'nested tr-kids', role: 'group' }, ...kids));
    return li;
  };

  /* --- ветка «Модель»: только сироты ------------------------------- */
  /**
   * Элементы, не показанные ни на одном листе. Это НЕ «где используется»,
   * а наоборот: без этой ветки сироту не найти и не поставить на лист.
   * Показывается одной строкой и только когда такие есть.
   */
  const modelBranch = () => {
    const orphansAll = m.elements.filter((e) => !shownAnywhere.has(e.id));
    const base = searching ? orphansAll.filter((e) => matchedEls.has(e.id)) : orphansAll;
    if (!base.length) return null;
    const id = TREE_ID.model();
    // Открыта, если иначе содержимое модели не видно вовсе (все элементы —
    // сироты) или если переход от замечания ведёт внутрь неё.
    const forceOpen = searching || (!searching && orphansAll.length === m.elements.length)
      || base.some((e) => focusIds.has(e.id));
    const collapsed = forceOpen ? false : isCollapsed(id, true);
    const row = el('div', {
      class: 'tr-group tr-model',
      role: 'treeitem',
      tabindex: '0',
      'data-tree-id': id,
      'aria-expanded': collapsed ? 'false' : 'true',
      title: 'Элементы модели, которых нет ни на одном листе: перетащите строку на лист или щёлкните дважды',
      onclick: () => toggleNode(id, true),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleNode(id, true); }
        else if (ev.key === 'ArrowLeft' && !collapsed) { ev.preventDefault(); toggleNode(id, true); }
        else if (ev.key === 'ArrowRight' && collapsed) { ev.preventDefault(); toggleNode(id, true); }
      },
    },
    twisty(collapsed, id, true, 'Модель'),
    el('span', { class: 'tr-glabel', text: `Модель — нигде не показаны: ${base.length}` }));
    const li = el('li', { role: 'none' }, row);
    if (!collapsed) {
      const ctx = { childrenMap: ownerLayout(base), forceOpen: searching };
      const ul = el('ul', { class: 'nested tr-kids', role: 'group' });
      for (const e of ctx.childrenMap.get(null) ?? []) ul.append(elementNode(e, ctx));
      li.append(ul);
    }
    return li;
  };

  /* --- сборка ------------------------------------------------------ */
  const rootsOrdered = roots.filter((d) => !searching || matchedSheets.has(d.id));
  const sheets = treeSort === 'file'
    ? rootsOrdered
    : [...rootsOrdered].sort(treeSort === 'name' ? cmpName : cmpDiagram);
  if (sheets.length) {
    // Листы идут списком без заголовка: строка сама называет себя именем и
    // типом, а ветка «Модель» отделена линией.
    const ul = el('ul');
    for (const d of sheets) {
      const li = sheetRow(d);
      if (li) ul.append(li);
    }
    wrap.append(ul);
  }

  const branch = modelBranch();
  if (branch) wrap.append(el('ul', { class: 'tr-model-list' }, branch));

  if (!sheets.length && !branch) {
    // Пока в модели НЕТ НИ ОДНОГО листа, «поставьте фигуру» — неправда: полоса
    // инструментов работает только на листе, а лист создают кнопкой. Первый
    // запуск говорит то же, что приглашение поверх листа.
    const text = searching
      ? 'Ничего не найдено.'
      : ((store.model.diagrams ?? []).length
        ? 'Пока пусто — поставьте фигуру из полосы над листом.'
        : 'Модель пуста — создайте диаграмму.');
    wrap.append(el('div', { class: 'empty', text }));
  }
  host.append(wrap);

  // Прокрутка к строке замечания — только на новый переход: `at` меняется
  // тогда и только тогда, когда человек кликнул по замечанию. Иначе дерево
  // дёргалось бы к подсвеченной строке на каждой перерисовке.
  const focus = store.ui.findingFocus;
  if (focus && focus.at && focus.at !== scrolledFindingAt) {
    scrolledFindingAt = focus.at;
    host.querySelector('.node.hit')?.scrollIntoView({ block: 'nearest' });
  }

  const foot = document.getElementById('model-foot');
  if (foot) {
    clear(foot);
    const d = currentDiagram(m);
    foot.append(
      el('span', {}, 'элементов ', el('b', { text: String(m.elements.length) })),
      el('span', {}, 'связей ', el('b', { text: String(m.relationships.length) })),
      el('span', {}, 'фигур ', el('b', { text: String(d?.shapes.length ?? 0) })),
    );
  }
}

/* -------------------------------------------------------------- props */

export function renderProps() {
  const host = document.getElementById('props');
  clear(host);
  const sel = store.ui.selection;
  const it = selectedElement();

  if (!sel.length || !it) {
    if (sel.length > 1) { renderGroupProps(host); return; }
    host.append(
      section('Модель'),
      field('Имя', el('input', { type: 'text' })),
    );
    bindText(host.querySelector('input[type=text]'), store.model.name, (m, v) => { m.name = v; });
    // Ничего не выделено — значит выбран сам ЛИСТ: его спецификация и живёт
    // здесь. Владелец диаграммы (`Parent model` в пособии 4.3.3) — поле
    // диаграммы, а не элемента, и другого места у него нет.
    diagramSection(host);
    host.append(el('div', { class: 'empty', text: 'Выберите фигуру или связь на листе, чтобы править её свойства.' }));
    return;
  }

  if (sel[0].kind === 'shape') {
    const element = elementOf(store.model, it);
    if (element) renderShapeProps(host, it, element);
  } else {
    renderConnectorProps(host, it);
  }
}

/**
 * Спецификация листа. Ничего не выделено — значит выбран сам лист: здесь его
 * владелец (в исходном редакторе — `Parent model`). Пособие 4.3.3 требует перенести готовую
 * диаграмму из корня внутрь кооперации, а не пересоздать её там, поэтому
 * `ownerElementId` меняется, а не создаётся заново.
 */
function diagramSection(host) {
  const m = store.model;
  const d = currentDiagram(m);
  if (!d) return;
  // Кандидаты — вся модель, но элемент, показанный на самой диаграмме,
  // помечен недоступным: диаграмма оказалась бы внутри своего же содержимого.
  // Он остаётся в списке, а не исчезает: иначе человек не понял бы, почему
  // «Класс: Заказ» не предлагается, и решил бы, что список сломан.
  const inside = new Set((d.shapes ?? []).map((s) => s.elementId));
  const candidates = m.elements;
  const owner = d.ownerElementId ? findElement(m, d.ownerElementId) : null;
  const sel = el('select', { 'aria-label': 'Владелец диаграммы' });
  sel.append(el('option', {
    value: '', text: '— верхний уровень —', selected: d.ownerElementId ? null : true,
  }));
  for (const e of candidates) {
    const shown = inside.has(e.id);
    sel.append(el('option', {
      value: e.id,
      text: labelOfElement(e) + (shown ? ' (показан здесь)' : ''),
      title: shown ? 'Нельзя: элемент показан на этой диаграмме — она оказалась бы внутри себя' : null,
      disabled: shown ? true : null,
      selected: e.id === d.ownerElementId ? true : null,
    }));
  }
  // Владелец, которого нет среди кандидатов, остаётся видимым: молча показать
  // «верхний уровень» значило бы соврать о том, что лежит в файле.
  if (d.ownerElementId && !candidates.some((e) => e.id === d.ownerElementId)) {
    sel.append(el('option', {
      value: d.ownerElementId, text: `${d.ownerElementId} (нет в модели)`, selected: true,
    }));
  }
  sel.addEventListener('change', () => {
    const ok = commit('Владелец диаграммы', (mm) => setDiagramOwner(mm, d.id, sel.value || null));
    if (ok === false) {
      set({ hint: 'Так нельзя: этот элемент показан на самой диаграмме — она оказалась бы внутри себя.' });
      return;
    }
    set({
      hint: sel.value
        ? 'Диаграмма перенесена в элемент — она видна в дереве под ним.'
        : 'Диаграмма вернулась в корень дерева.',
    });
  });
  const path = owner
    ? [ownerPath(m, owner), owner.name || owner.id].filter(Boolean).join(' / ')
    : '';

  // Имя листа (`diagrams[].name`) — поле формата, отдельной правки схемы не
  // нужно: umljson.js пишет его всегда, а файл без имени читается как
  // «Диаграмма N» (readDiagram). Сохранение — по Enter и по снятию фокуса:
  // поле в инспекторе перерисовывается вместе с панелью.
  const nameIn = el('input', {
    type: 'text', value: d.name ?? '', 'aria-label': 'Имя диаграммы',
    title: 'Имя листа: видно в селекторе сверху и в дереве',
  });
  const applyName = () => {
    const value = nameIn.value.trim();
    if (!value) {
      // Пустое имя — не молчаливая потеря: возвращаем прежнее и говорим об
      // этом. Придумывать «Диаграмма N» вместо стёртого имени значило бы
      // подменить то, что человек напечатал, своим.
      nameIn.value = d.name ?? '';
      set({ hint: 'Имя листа не может быть пустым — оставлено прежнее.' });
      return;
    }
    if (value === d.name) return;
    commit('Имя диаграммы', (m) => {
      const target = findDiagram(m, d.id);
      if (target) target.name = value;
    });
    set({ hint: `Лист переименован в «${value}».` });
  };
  nameIn.addEventListener('change', applyName);
  nameIn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); applyName(); nameIn.blur(); }
    if (ev.key === 'Escape') { nameIn.value = d.name ?? ''; nameIn.blur(); }
  });

  host.append(
    section('Диаграмма', el('span', { class: 'mini', text: typeOf(d.kind)?.label ?? d.kind })),
    field('Имя', nameIn),
    field('Владелец', sel),
    el('div', {
      class: 'member-hint',
      text: owner ? `в составе: ${path}` : 'верхний уровень — диаграмма стоит в корне дерева',
    }),
  );
}

/**
 * The group inspector: what is selected, and the eight arrangement commands.
 * The pictograms appear only here — with one shape there is nothing to align,
 * and a row of dead buttons is worse than no row (plan 3.3).
 */
function renderGroupProps(host) {
  const m = store.model;
  const shapes = store.ui.selection.filter((s) => s.kind === 'shape')
    .map((s) => findShape(m, s.id)).filter(Boolean);
  const links = store.ui.selection.filter((s) => s.kind === 'connector')
    .map((s) => findLink(m, s.id)).filter(Boolean);

  host.append(section('Выделение', el('span', { class: 'mini', text: `${shapes.length + links.length} объектов` })));
  host.append(el('div', { class: 'kv' },
    el('span', { text: 'фигур' }), el('b', { class: 'mono', text: String(shapes.length) })));
  host.append(el('div', { class: 'kv' },
    el('span', { text: 'связей' }), el('b', { class: 'mono', text: String(links.length) })));

  if (shapes.length >= 2) {
    host.append(section('Выравнивание', el('span', { class: 'mini', text: 'по краям и промежуткам' })));
    const strip = el('div', { class: 'align-strip', role: 'toolbar', 'aria-label': 'Выравнивание и распределение' });
    for (const cmd of ALIGN_COMMANDS) {
      strip.append(el('button', {
        type: 'button',
        class: 'align-btn',
        title: cmd.label,
        'aria-label': cmd.label,
        'data-align': cmd.id,
        onclick: () => {
          const n = arrange(cmd.id);
          set({ hint: n ? `${cmd.label}: ${n} фигур.` : 'Нужно две фигуры или больше.' });
          renderCanvas();
        },
      }, alignIcon(cmd.icon, 16)));
    }
    host.append(strip);
  }

  if (shapes.length) {
    const names = shapes.map((s) => elementOf(m, s)?.name || '(без имени)');
    host.append(section('Фигуры', el('span', { class: 'mini', text: 'в выделении' })));
    const list = el('div', { class: 'nested-list' });
    for (const name of names.slice(0, 12)) list.append(el('div', { class: 'nested-row' }, el('span', { class: 'nm', text: name })));
    if (names.length > 12) list.append(el('div', { class: 'empty', text: `… и ещё ${names.length - 12}` }));
    host.append(list);
  }

  host.append(el('div', { class: 'member-hint' },
    'Delete снимает выделенное с листа, Shift+Delete удаляет из модели. Ctrl+C / Ctrl+V — копия, '
    + 'Ctrl+D — дубликат со сдвигом, стрелки — сдвиг на шаг сетки.'));
}

/**
 * Выбор стереотипа. Значение пункта — `stereotypeId`, подпись — каноническое
 * имя: пункт один на стереотип, даже если тот расширяет несколько
 * метаклассов (у `entity` их пять), а «Подходящие» — те записи, у которых
 * хотя бы одно расширение есть у вида элемента.
 *
 * Выбор пишет ОБА поля: имя (его рисует лист и оно переживает чужой профиль)
 * и ссылку (по ней находится именно эта запись, когда имён несколько).
 */
function stereotypePicker(it, kind, findTarget) {
  const wrap = el('div', { class: 'stereo-filter' });
  const filter = el('input', {
    type: 'text', class: 'filter', placeholder: 'фильтр…',
    'aria-label': 'Фильтр стереотипов', style: 'margin-bottom:4px',
  });
  const select = el('select', { 'aria-label': 'Стереотип' });
  wrap.append(filter, select);
  const rebuild = () => {
    clear(select);
    select.append(el('option', { value: '', text: '— без стереотипа —' }));
    const p = store.profile;
    if (!p) {
      select.append(el('option', { value: '', text: '(профиль не загружен)', disabled: true }));
      return;
    }
    const { applicable: app, rest } = applicable(p, kind);
    // Текущий стереотип разрешается тем же путём, что и на листе: id → имя →
    // нормализованное имя. Поэтому отмечен именно тот пункт, который запись
    // означает, а не первый с таким именем.
    const current = resolveStereotype(p, it, baseTypeFor(kind)).record;
    const q = filter.value.trim().toLowerCase();
    const matches = (s) => !q
      || s.name.toLowerCase().includes(q)
      || s.aliases.some((a) => a.toLowerCase().includes(q))
      || (s.keywordAliases ?? []).some((a) => a.toLowerCase().includes(q))
      || s.baseTypes.some((b) => b.toLowerCase().includes(q))
      || s.documentation.toLowerCase().includes(q);
    // У имени с несколькими расширениями показываются только те, что есть у
    // ЭТОГО вида: `entity` на классе — «entity · Class», а не пять baseType
    // сразу. Сама запись одна, поэтому и пункт один.
    const kindBases = baseTypesFor(kind);
    const addOpt = (s) => el('option', {
      value: s.id,
      text: `${s.name} · ${s.baseTypes.filter((b) => kindBases.includes(b)).join(' / ') || s.baseTypes.join(' / ') || '—'}`,
      // Каноническое имя остаётся в пункте, псевдоним ключевого слова — в
      // title: `include` иначе пришлось бы искать, набирая ключевое слово.
      title: s.keywordAliases?.length ? `Псевдоним: ${s.keywordAliases.join(', ')}` : null,
      selected: current?.id === s.id ? true : null,
    });
    if (app.length) {
      const g = el('optgroup', { label: `Подходящие (${app.length})` });
      app.filter((s) => matches(s)).forEach((s) => g.append(addOpt(s)));
      if (g.children.length) select.append(g);
    }
    if (!q) {
      const g = el('optgroup', { label: `Все стереотипы (${rest.length})` });
      rest.forEach((s) => g.append(addOpt(s)));
      select.append(g);
    } else {
      const g = el('optgroup', { label: 'Остальные' });
      rest.filter((s) => matches(s)).forEach((s) => g.append(addOpt(s)));
      if (g.children.length) select.append(g);
    }
  };
  rebuild();
  filter.addEventListener('input', rebuild);
  select.addEventListener('change', () => {
    const record = select.value ? (store.profile?.byId.get(select.value) ?? null) : null;
    commit('Правка стереотипа', (m) => {
      const target = findTarget(m);
      if (!target) return;
      target.stereotype = record ? record.name : null;
      target.stereotypeId = record ? record.id : null;
    });
  });
  return wrap;
}

function taggedValuesSection(host, it, findTarget) {
  host.append(section('Tagged values', el('span', { class: 'mini', text: 'из профиля и свои' })));
  const cont = el('div');
  host.append(cont);

  const renderRows = () => {
    clear(cont);
    const p = store.profile;
    const tvs = Array.isArray(it.taggedValues) ? it.taggedValues : [];
    const tv = (name) => tvs.find((t) => t.name === name);
    const defRow = (def) => {
      const cur = tv(def.name);
      const input = def.type === 'enum'
        ? el('select', {}, el('option', { value: '', text: '—' }),
          ...def.values.map((v) => el('option', { value: v, text: v, selected: cur?.value === v ? true : null })))
        : def.type === 'longtext'
          ? el('textarea', { rows: 2 })
          : el('input', { type: 'text' });
      if (def.type !== 'enum') input.value = cur?.value ?? def.default ?? '';
      input.classList.add('tag-val');
      input.setAttribute('aria-label', `Значение tagged value «${def.name}»`);
      input.addEventListener('change', () => commit('Правка tagged value', (m) => {
        const target = findTarget(m);
        if (target) setTaggedValue(target, def.name, input.value);
      }));
      return el('div', { class: 'tag-row', title: def.documentation || def.name },
        el('input', {
          class: 'tag-name', type: 'text', value: def.name, readonly: true,
          'aria-label': `Имя tagged value: ${def.name}`,
          style: 'background:transparent;border-style:dashed',
        }),
        input);
    };
    if (it.stereotype && p) {
      // Запись ищется тем же резолвером (id → имя → нормализованное имя), а
      // набор полей берётся для baseType ЭТОГО элемента: у `XSDschema` поля
      // разные на Package и на Class, и подставлять чужой набор нельзя.
      const st = resolveStereotype(p, it, baseTypeFor(it.kind)).record;
      const defs = taggedDefsFor(st, baseTypeFor(it.kind));
      if (defs.length) {
        cont.append(el('div', { class: 'tag-head' }, el('span', { text: 'имя' }), el('span', { text: 'значение' })));
        defs.forEach((d) => cont.append(defRow(d)));
      }
    }
    const customs = tvs.filter((t) => !stDefs(it, t.name));
    if (customs.length) {
      cont.append(el('div', { class: 'tag-head', style: 'margin-top:8px' }, el('span', { text: 'свои' }), el('span', { text: 'значение' })));
      for (const t of customs) {
        const nameIn = el('input', { class: 'tag-name', type: 'text', value: t.name, 'aria-label': 'Имя tagged value' });
        const valIn = el('input', { class: 'tag-val', type: 'text', value: t.value, 'aria-label': `Значение tagged value «${t.name}»` });
        nameIn.addEventListener('change', () => commit('Правка tagged value', (m) => {
          const target = findTarget(m);
          if (!target) return;
          const row = (target.taggedValues || []).find((x) => x.name === t.name);
          if (row) row.name = nameIn.value.trim() || t.name;
        }));
        valIn.addEventListener('change', () => commit('Правка tagged value', (m) => {
          const target = findTarget(m);
          if (target) setTaggedValue(target, t.name, valIn.value);
        }));
        cont.append(el('div', { class: 'tag-row' }, nameIn, valIn,
          el('button', {
            class: 'xbtn', title: 'Убрать',
            'aria-label': `Убрать tagged value «${t.name}»`,
            onclick: () => {
              commit('Правка tagged value', (m) => { removeTaggedValue(findTarget(m), t.name); });
              emitSoon();
            },
          }, icon('ui-close', 13))));
      }
    }
    cont.append(el('div', { class: 'addbar' },
      el('button', {
        class: 'btn', text: '+ Свой tagged value',
        onclick: () => {
          commit('Tagged value', (m) => {
            const target = findTarget(m);
            if (target) setTaggedValue(target, 'имя', '');
          });
          emitSoon();
        },
      })));
    if (!it.stereotype && !customs.length) {
      cont.append(el('div', { class: 'empty', text: 'Выберите стереотип — его tagged values появятся из профиля; свои добавляются кнопкой.' }));
    }
  };
  renderRows();
}

const stDefs = (it, name) => {
  const p = store.profile;
  if (!p || !it.stereotype) return false;
  const st = resolveStereotype(p, it, baseTypeFor(it.kind)).record;
  return taggedDefsFor(st, baseTypeFor(it.kind)).some((d) => d.name === name);
};

let emitTimer = null;
const emitSoon = () => { clearTimeout(emitTimer); emitTimer = setTimeout(() => set({}), 0); };

/* ------------------------------------------------------ model references */

/**
 * Строка-флажок: значение пишется только когда включено (§2 правила).
 * `apply` получает модель и новое значение и само решает, что записать.
 */
function flagRow(host, { id, label, title, checked, apply }) {
  const cb = el('input', { type: 'checkbox', id, checked: checked ? true : null, 'aria-label': title ?? label });
  cb.addEventListener('change', () => commit(label, (m) => apply(m, cb.checked)));
  host.append(el('div', { class: 'checkrow' }, el('label', { for: id }, cb, el('span', { text: label }))));
  return cb;
}

/** Выпадающий список ссылок на сущности модели с пустым значением «нет». */
function refSelect(items, current, emptyLabel, aria) {
  const sel = el('select', { 'aria-label': aria ?? emptyLabel });
  sel.append(el('option', { value: '', text: emptyLabel, selected: current ? null : true }));
  for (const it of items) {
    sel.append(el('option', {
      value: it.id, text: it.label, selected: String(current) === String(it.id) ? true : null,
    }));
  }
  // Ссылка, которой нет в списке (в файле записана именем), остаётся видимой:
  // молча показать «нет» значило бы соврать о содержимом модели.
  if (current && !items.some((it) => String(it.id) === String(current))) {
    sel.append(el('option', { value: current, text: `${current} (нет в файле)`, selected: true }));
  }
  return sel;
}

const labelOfElement = (e) => `${NOTATION.shapes[e.kind]?.label ?? e.kind}: ${e.name || e.id}`;

/**
 * Классификаторы, которые может представлять линия жизни (§17.3.4,
 * `Lifeline::represents`). Это метаклассы Classifier по разделу «Обобщения» в
 * `material/spec-ru/`: пакет, примечание, состояние и действие классификаторами
 * не являются, и предлагать их значило бы разрешать заведомо неверную ссылку.
 * Список шире, чем у объекта (`classifierId`): участником взаимодействия может
 * быть и актёр, и вариант использования, и артефакт — а экземпляром актёра
 * объект быть не может. Правило `lifeline-represents-classifier` (пишет другой
 * агент) сузит список по существу; здесь — только то, что не бессмыслица.
 */
const REPRESENTABLE_KINDS = ['class', 'interface', 'component', 'actor', 'usecase',
  'node', 'artifact', 'enumeration', 'datatype'];

/** Владение (§3.1): владелец — выпадающий список допустимых, циклы запрещены. */
function ownerSection(host, element, findEl) {
  const m = store.model;
  const candidates = ownerCandidates(m, element);
  const path = ownerPath(m, element);
  if (!candidates.length) {
    host.append(field('Владелец', el('div', { class: 'member-hint', text: path ? `в составе: ${path}` : 'верхний уровень — владельцев в модели нет' })));
    return;
  }
  const sel = refSelect(candidates.map((e) => ({ id: e.id, label: labelOfElement(e) })), element.ownerId, '— верхний уровень —', 'Владелец элемента');
  sel.addEventListener('change', () => {
    const ok = commit('Владелец элемента', (mm) => setOwner(mm, findEl(mm), sel.value || null));
    if (ok === false) set({ hint: 'Так нельзя: владелец — сам элемент или то, что он содержит.' });
  });
  host.append(field('Владелец', sel));
}

/** Операнды фрагмента (§3.4): сторож и покрытие, покрытие — только сообщения. */
function operandsSection(host, element, findEl) {
  const rows = Array.isArray(element.operands) ? element.operands : [];
  const messages = store.model.relationships.filter(isMessage)
    .map((r) => ({ id: r.id, label: `${r.name || r.kind} (${r.id})` }));
  host.append(section('Операнды', el('span', { class: 'mini', text: 'сторож · какие сообщения покрыты' })));
  rows.forEach((operand, i) => {
    const guard = el('input', { type: 'text', value: operand.guard ?? '', 'aria-label': `Сторож операнда ${i + 1}`, placeholder: 'сторож' });
    guard.addEventListener('change', () => commit('Сторож операнда', (m) => {
      const e = findEl(m);
      if (e?.operands?.[i]) e.operands[i].guard = guard.value;
    }));
    const pick = el('select', { multiple: 'multiple', size: '3', 'aria-label': `Сообщения операнда ${i + 1}` });
    for (const msg of messages) {
      pick.append(el('option', {
        value: msg.id, text: msg.label,
        selected: (operand.messages ?? []).includes(msg.id) ? true : null,
      }));
    }
    pick.addEventListener('change', () => commit('Покрытие операнда', (m) => {
      const e = findEl(m);
      if (!e?.operands?.[i]) return;
      e.operands[i].messages = [...pick.selectedOptions].map((o) => o.value);
    }));
    const del = el('button', {
      type: 'button', class: 'xbtn', title: 'Удалить операнд',
      onclick: () => commit('Удаление операнда', (m) => {
        const e = findEl(m);
        if (e?.operands) e.operands.splice(i, 1);
        if (e?.operands && !e.operands.length) delete e.operands;
      }),
    }, icon('ui-close', 12));
    host.append(el('div', { class: 'line-row' }, guard, del), el('div', { class: 'line-row' }, pick));
  });
  const bar = el('div', { class: 'addbar' }, el('button', {
    type: 'button', class: 'btn', text: '+ операнд', 'aria-label': 'Добавить операнд',
    onclick: () => commit('Добавление операнда', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (!Array.isArray(e.operands)) e.operands = [];
      e.operands.push({ id: `o${e.operands.length + 1}`, guard: '', messages: [] });
    }),
  }));
  // try/except — это `alt` с двумя операндами, а не отдельный оператор UML.
  // Пара кнопок рядом: одна половина сразу двумя операциями не делается, и
  // человек, пришедший из книги, ищет именно «Add Operand» в меню фигуры —
  // там эта же команда есть (canvas.js#splitFragment).
  if (rows.length < 2) {
    bar.append(el('button', {
      type: 'button', class: 'btn', text: 'Разделить: успех / исключение',
      title: 'Два операнда: [успех] и [исключение]',
      onclick: () => commit('Разделение фрагмента на две половины', (m) => {
        const e = findEl(m);
        if (!e) return;
        const ops = Array.isArray(e.operands) ? e.operands : [];
        const first = ops[0] ?? { id: 'o1', guard: '', messages: [] };
        e.operands = [
          { ...first, id: first.id || 'o1', guard: first.guard || 'успех' },
          { id: 'o2', guard: 'исключение', messages: [] },
        ];
      }),
    }));
  }
  host.append(bar);
}

/** Внутренние переходы состояния (§14.5.10): `trigger [guard] / effect`. */
function internalsSection(host, element, findEl) {
  const rows = internalsOf(element);
  host.append(section('Внутренние переходы', el('span', { class: 'mini', text: 'trigger · сторож · действие' })));
  rows.forEach((row, i) => {
    const trigger = el('input', { type: 'text', value: row.trigger ?? '', 'aria-label': `Событие ${i + 1}`, placeholder: 'событие' });
    const guard = el('input', { type: 'text', value: row.guard ?? '', 'aria-label': `Сторож ${i + 1}`, placeholder: 'сторож' });
    const effect = el('input', { type: 'text', value: row.effect ?? '', 'aria-label': `Действие ${i + 1}`, placeholder: 'действие' });
    const bind = (input, key) => input.addEventListener('change', () => commit('Внутренний переход', (m) => {
      const e = findEl(m);
      if (e?.internals?.[i]) e.internals[i][key] = input.value;
    }));
    bind(trigger, 'trigger'); bind(guard, 'guard'); bind(effect, 'effect');
    const del = el('button', {
      type: 'button', class: 'xbtn', title: 'Удалить переход',
      onclick: () => commit('Удаление внутреннего перехода', (m) => {
        const e = findEl(m);
        if (e?.internals) e.internals.splice(i, 1);
        if (e?.internals && !e.internals.length) delete e.internals;
      }),
    }, icon('ui-close', 12));
    host.append(el('div', { class: 'line-row' }, trigger, guard, effect, del));
  });
  host.append(el('div', { class: 'addbar' }, el('button', {
    type: 'button', class: 'btn', text: '+ переход',
    onclick: () => commit('Добавление внутреннего перехода', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (!Array.isArray(e.internals)) e.internals = [];
      e.internals.push({ trigger: '', guard: '', effect: '' });
    }),
  })));
}

/** Регионы (§3.6, §3.7): члены — элементы модели, границы берутся из фигур. */
function regionsSection(host, element, findEl) {
  const kind = element.kind === 'state' ? 'state' : 'activity';
  const memberKey = kind === 'state' ? 'states' : 'nodes';
  const rows = regionsOf(element);
  const candidates = store.model.elements.filter((e) => e.id !== element.id);
  host.append(section('Регионы', el('span', { class: 'mini', text: kind === 'state' ? 'подсостояния' : 'узлы региона' })));
  rows.forEach((region, i) => {
    const nameIn = el('input', { type: 'text', value: region.name ?? '', 'aria-label': `Имя региона ${i + 1}`, placeholder: 'имя региона' });
    nameIn.addEventListener('change', () => commit('Имя региона', (m) => {
      const e = findEl(m);
      if (e?.regions?.[i]) e.regions[i].name = nameIn.value;
    }));
    const pick = el('select', { multiple: 'multiple', size: '3', 'aria-label': `Состав региона ${i + 1}` });
    for (const cand of candidates) {
      pick.append(el('option', {
        value: cand.id, text: labelOfElement(cand),
        selected: regionMembers(region).includes(cand.id) ? true : null,
      }));
    }
    pick.addEventListener('change', () => commit('Состав региона', (m) => {
      const e = findEl(m);
      if (!e?.regions?.[i]) return;
      e.regions[i][memberKey] = [...pick.selectedOptions].map((o) => o.value);
    }));
    const del = el('button', {
      type: 'button', class: 'xbtn', title: 'Удалить регион',
      onclick: () => commit('Удаление региона', (m) => {
        const e = findEl(m);
        if (e?.regions) e.regions.splice(i, 1);
        if (e?.regions && !e.regions.length) delete e.regions;
      }),
    }, icon('ui-close', 12));
    host.append(el('div', { class: 'line-row' }, nameIn, del), el('div', { class: 'line-row' }, pick));
  });
  host.append(el('div', { class: 'addbar' }, el('button', {
    type: 'button', class: 'btn', text: '+ регион',
    onclick: () => commit('Добавление региона', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (!Array.isArray(e.regions)) e.regions = [];
      e.regions.push(createRegion(`Регион ${e.regions.length + 1}`, kind));
    }),
  })));
}

/* ------------------------------------------------------- member table */

const VIS_CYCLE = () => VISIBILITIES.map((v) => v.key);

function focusCell(elementId, field, row, col) {
  const q = `#props [data-element="${elementId}"][data-field="${field}"][data-row="${row}"][data-col="${col}"]`;
  const node = document.querySelector(q);
  if (node) { node.focus(); return; }
  requestAnimationFrame(() => document.querySelector(q)?.focus());
}

const CELL_ORDER = ['name', 'type', 'default'];

function neighbourCell(col, row, count, back) {
  let c = CELL_ORDER.indexOf(col) + (back ? -1 : 1);
  let r = row;
  if (c < 0) { c = CELL_ORDER.length - 1; r -= 1; }
  if (c >= CELL_ORDER.length) { c = 0; r += 1; }
  if (r < 0 || r >= count) return null;
  return { row: r, col: CELL_ORDER[c] };
}

/** Member rows: visibility · name · type · default (slots drop the visibility). */
function memberTable(element, fieldName, title, { slots = false, literals = false } = {}) {
  const rows = Array.isArray(element[fieldName]) ? element[fieldName] : [];
  const wrapEl = el('div', { class: 'mtable-wrap' });
  const table = el('table', { class: 'mtable', 'aria-label': title });
  const withFlags = !slots && !literals;
  // `isAbstract` is BehavioralFeature's flag (§9.9.2), so it is offered on
  // operations only: Property (an attribute) has no such property in the
  // standard, and a box there would invent one.
  const flags = MEMBER_FLAGS.filter((f) => !f.only || f.only === fieldName);
  table.append(el('thead', {}, el('tr', {},
    slots || literals ? null : el('th', { class: 'c-vis', title: 'Видимость', text: 'вид' }),
    el('th', { text: 'имя' }),
    slots ? el('th', { text: 'значение' }) : el('th', { text: 'тип' }),
    slots ? null : el('th', { text: 'знач.' }),
    withFlags
      ? el('th', {
        class: 'c-flags',
        title: 'S — статический (подчёркнут), / — производный, id — идентификатор {id}'
          + (fieldName === 'operations' ? ', галочка «абстрактная» — имя курсивом' : ''),
        text: 'S / id',
      })
      : null,
    el('th', { class: 'c-act', text: '' }))));

  const tbody = el('tbody');
  rows.forEach((row, i) => {
    const cell = (col, value, aria) => {
      const input = el('input', {
        type: 'text',
        value: value ?? '',
        'aria-label': `${title}: строка ${i + 1}, ${aria}`,
        'data-element': element.id,
        'data-field': fieldName,
        'data-row': String(i),
        'data-col': col,
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Tab') {
          const to = neighbourCell(col, i, rows.length, ev.shiftKey);
          if (!to) return;
          ev.preventDefault();
          ev.target.blur();
          renderProps();
          focusCell(element.id, fieldName, to.row, to.col);
          return;
        }
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        if (i === rows.length - 1 && String(row.name || '').trim()) {
          const idx = commit('Добавление строки', (m) => {
            const e = findElement(m, element.id);
            return e ? addMemberRow(e, fieldName) : null;
          });
          if (typeof idx === 'number') {
            renderProps();
            focusCell(element.id, fieldName, idx, 'name');
          }
        } else if (i < rows.length - 1) {
          ev.target.blur();
          renderProps();
          focusCell(element.id, fieldName, i + 1, col);
        } else {
          ev.target.blur();
        }
      });
      bindText(input, value, (m, v) => {
        const e = findElement(m, element.id);
        const r = e?.[fieldName]?.[i];
        if (r) r[col] = v;
      });
      return input;
    };

    const visBtn = el('button', {
      type: 'button',
      class: `vis-btn vis-${row.vis}`,
      text: visByKey[row.vis]?.symbol ?? '+',
      title: `Видимость: ${visByKey[row.vis]?.title ?? 'public'} — нажмите, чтобы сменить`,
      'aria-label': `Видимость строки ${i + 1}: ${visByKey[row.vis]?.title ?? 'public'}`,
      onclick: () => {
        const order = VIS_CYCLE();
        const next = order[(order.indexOf(row.vis) + 1) % order.length];
        commit('Видимость члена', (m) => {
          const e = findElement(m, element.id);
          const r = e?.[fieldName]?.[i];
          if (r) r.vis = next;
        });
      },
    });

    // Independent UML flags on one row (UML 2.5.1 §9.4, §9.5.3, §9.9.2). Each
    // is a checkbox of its own: the sheet draws the mark, this stores it.
    // `flags`, not MEMBER_FLAGS: `isAbstract` belongs to operations only.
    const flagBox = (f) => {
      const cb = el('input', {
        type: 'checkbox',
        class: `flag flag-${f.key}`,
        checked: rows[i][f.key] ? true : null,
        title: f.title,
        'aria-label': `${title}: строка ${i + 1}, ${f.title}`,
        'data-element': element.id,
        'data-field': fieldName,
        'data-row': String(i),
        'data-col': f.key,
      });
      cb.addEventListener('change', () => commit('Флаг члена', (m) => {
        const e = findElement(m, element.id);
        const r = e?.[fieldName]?.[i];
        if (r) r[f.key] = cb.checked;
      }));
      return cb;
    };

    tbody.append(el('tr', {},
      slots || literals ? null : el('td', { class: 'c-vis' }, visBtn),
      el('td', {}, cell('name', row.name, 'имя')),
      slots
        ? el('td', {}, cell('default', row.default, 'значение'))
        : el('td', {}, cell('type', row.type, 'тип')),
      slots ? null : el('td', {}, cell('default', row.default, 'значение по умолчанию')),
      withFlags ? el('td', { class: 'c-flags' }, ...flags.map(flagBox)) : null,
      el('td', { class: 'c-act' },
        el('button', {
          type: 'button', class: 'xbtn', title: 'Выше',
          'aria-label': `Строка ${i + 1} выше`,
          disabled: i === 0,
          onclick: () => commit('Порядок членов', (m) => {
            const e = findElement(m, element.id);
            if (e) moveMemberRow(e, fieldName, i, -1);
          }),
        }, icon('ui-arrow-up', 12)),
        el('button', {
          type: 'button', class: 'xbtn', title: 'Ниже',
          'aria-label': `Строка ${i + 1} ниже`,
          disabled: i === rows.length - 1,
          onclick: () => commit('Порядок членов', (m) => {
            const e = findElement(m, element.id);
            if (e) moveMemberRow(e, fieldName, i, 1);
          }),
        }, icon('ui-arrow-down', 12)),
        el('button', {
          type: 'button', class: 'xbtn', title: 'Удалить строку',
          'aria-label': `Удалить строку ${i + 1}`,
          onclick: () => commit('Удаление строки', (m) => {
            const e = findElement(m, element.id);
            if (e) removeMemberRow(e, fieldName, i);
          }),
        }, icon('ui-close', 12)))));
  });
  if (!rows.length) {
    tbody.append(el('tr', {}, el('td', { colspan: withFlags ? '6' : '5', class: 'mtable-empty', text: 'пусто — добавьте строку' })));
  }
  table.append(tbody);
  wrapEl.append(table);
  return wrapEl;
}

/** Text compartment editor: entry / do / exit, extension points. */
function linesEditor(element, fieldName, title, prefix) {
  const rows = Array.isArray(element[fieldName]) ? element[fieldName] : [];
  const wrapEl = el('div', { class: 'mtable-wrap' });
  for (let i = 0; i < rows.length; i++) {
    const input = el('input', {
      type: 'text', value: rows[i] ?? '',
      'aria-label': `${title}: строка ${i + 1}`,
      'data-element': element.id, 'data-field': fieldName, 'data-row': String(i),
    });
    input.addEventListener('change', () => commit('Правка строки', (m) => {
      const e = findElement(m, element.id);
      if (e) setLine(e, fieldName, i, input.value);
    }));
    wrapEl.append(el('div', { class: 'line-row' },
      el('span', { class: 'line-prefix', text: prefix || '' }),
      input,
      el('button', {
        class: 'xbtn', title: 'Удалить строку',
        onclick: () => commit('Удаление строки', (m) => {
          const e = findElement(m, element.id);
          if (e) removeLine(e, fieldName, i);
        }),
      }, icon('ui-close', 12))));
  }
  return wrapEl;
}

/* ------------------------------------------------------- где показан */

/**
 * Список листов, на которых показан элемент. Живёт в инспекторе, а не в
 * дереве: в дереве лист — корень, и его имя уже есть строкой-родителем.
 * Клик по листу открывает его, как в «Вложенных диаграммах» рядом.
 */
function shownOnSection(host, element) {
  const m = store.model;
  const sheets = usedOn(m, element.id);
  const word = (sheets.length % 10 === 1 && sheets.length % 100 !== 11) ? 'листе' : 'листах';
  host.append(section('Показан на', el('span', { class: 'mini', text: `${sheets.length} ${word}` })));
  if (!sheets.length) {
    host.append(el('div', {
      class: 'empty',
      text: 'Ни на одном листе не показан — двойной щелчок по строке дерева поставит его на текущий лист.',
    }));
    return;
  }
  const list = el('div', { class: 'nested-list' });
  for (const d of sheets) {
    const cur = d.id === m.currentDiagramId;
    list.append(el('div', { class: 'nested-row' },
      el('button', {
        class: 'linkbtn',
        text: d.name,
        title: `Открыть «${d.name}» (${diagramKind(d)})${cur ? ' — это текущий лист' : ''}`,
        onclick: () => openDiagram(d.id),
      }),
      el('span', { class: 'dtype', text: diagramKind(d) })));
  }
  host.append(list);
}

/* --------------------------------------------------------- attachments */

/**
 * Предел на один файл. Отказ называет число («2,4 МБ при пределе 2 МБ»), а не
 * отделывается «нельзя»: человеку нужно знать, на сколько уменьшить файл.
 */
const ATTACH_MAX = 2 * 1024 * 1024;

/** Размер по-русски: мелочь — в байтах, остальное — в КБ с запятой.
 *  «0.0 КБ» у файла в 32 байта читалось как «файл пустой». */
function fileSize(n) {
  const bytes = Math.max(0, Number(n) || 0);
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} КБ`;
}

/** base64 → Blob → `<a download>`: файл уходит на диск, модель не меняется. */
function downloadAttachment(a) {
  try {
    const bin = atob(String(a?.data ?? ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: a?.mime || 'application/octet-stream' }));
    const link = el('a', { href: url, download: a?.name || 'attachment' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    set({ hint: 'Вложение не читается: данные в модели повреждены.' });
  }
}

/**
 * Вложения элемента. Схема `{ id, name, mime, size, data }`, где `data` —
 * base64 без префикса `data:` (согласована с W4, пишет её `umljson.js`).
 * Порядок — порядок приложения, и он же порядок в файле: список здесь обязан
 * совпадать с моделью, иначе «скачать» отдаст чужой файл.
 */
function attachmentsSection(host, element, findEl) {
  const rows = Array.isArray(element.attachments) ? element.attachments : [];
  host.append(section('Вложения', el('span', { class: 'mini', text: 'файлы в модели' })));
  const list = el('div', { class: 'tr-att-list' });
  for (const a of rows) {
    const label = a.name || '(без имени)';
    list.append(el('div', { class: 'tr-att-row' },
      el('span', { class: 'tr-att-name', text: label, title: a.mime || label }),
      el('span', { class: 'tr-att-size', text: fileSize(a.size) }),
      el('button', {
        type: 'button', class: 'xbtn', title: 'Скачать', 'aria-label': `Скачать «${label}»`,
        onclick: () => downloadAttachment(a),
      }, icon('ui-arrow-down', 12)),
      el('button', {
        type: 'button', class: 'xbtn', title: 'Удалить', 'aria-label': `Удалить вложение «${label}»`,
        onclick: () => commit('Удаление вложения', (m) => {
          const e = findEl(m);
          if (!Array.isArray(e?.attachments)) return;
          e.attachments = e.attachments.filter((x) => x.id !== a.id);
          // Пустой массив не пишется в файл — поле убирается вместе с последним
          // файлом, как и остальные пустые поля модели.
          if (!e.attachments.length) delete e.attachments;
        }),
      }, icon('ui-close', 12))));
  }
  if (!rows.length) list.append(el('div', { class: 'empty', text: 'Файлов нет.' }));
  host.append(list);

  const total = rows.reduce((n, a) => n + (Number(a.size) || 0), 0);
  host.append(el('div', {
    class: 'tr-att-total',
    text: `всего ${rows.length} · ${fileSize(total)}; предел — 2 МБ на файл`,
  }));
  // Отказ и ошибка чтения — отдельной живой строкой, а не вместо итога:
  // итог — состояние списка, сообщение — событие одной попытки.
  const status = el('div', { class: 'tr-att-status', 'aria-live': 'polite' });
  host.append(status);

  const input = el('input', { type: 'file', class: 'tr-att-file', 'aria-label': 'Приложить файл' });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > ATTACH_MAX) {
      status.textContent = `«${file.name}» не приложен: ${fileSize(file.size)} при пределе 2 МБ (2048 КБ).`;
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      status.textContent = `«${file.name}» не прочитан: ${reader.error?.message ?? 'ошибка чтения'}.`;
    };
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const comma = url.indexOf(',');
      // `data:` префикс снимается: в модели лежит только base64, иначе файл
      // распух бы на «data:<mime>;base64,» у каждого вложения.
      const data = comma >= 0 ? url.slice(comma + 1) : '';
      commit('Вложение файла', (m) => {
        const e = findEl(m);
        if (!e) return;
        if (!Array.isArray(e.attachments)) e.attachments = [];
        e.attachments.push({
          id: uid('a'),
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          data,
        });
      });
      set({ hint: `«${file.name}» приложен к «${element.name || '(без имени)'}».` });
    };
    reader.readAsDataURL(file);
  });
  host.append(el('div', { class: 'addbar' },
    el('button', { type: 'button', class: 'btn', text: 'Приложить файл…', onclick: () => input.click() }),
    input));
}

/* ------------------------------------------------------- shape props */

function renderShapeProps(host, shape, element) {
  const def = NOTATION.shapes[element.kind];
  const findEl = (m) => findElement(m, element.id);
  const findSh = (m) => findShape(m, shape.id);

  host.append(
    section(def.label, el('span', { class: 'mini', text: 'элемент модели' })),
    field('Имя', el('input', { type: 'text' })),
    field('Стереотип', stereotypePicker(element, element.kind, findEl)),
    field('Документация', el('textarea', { rows: 3 })),
  );
  bindText(host.querySelectorAll('.field input[type=text]')[0], element.name, (m, v) => {
    const e = findEl(m);
    if (e) e.name = v;
  });
  bindText(host.querySelector('.field textarea'), element.documentation, (m, v) => {
    const e = findEl(m);
    if (e) e.documentation = v;
  });

  // Abstract classifier (UML 2.5.1 §9.2.4): a checkbox, because the sheet's
  // italics are the visible half of a boolean that lives in the file.
  if (isAbstractable(element.kind)) {
    const cb = el('input', {
      type: 'checkbox', id: 'p-abstract', checked: element.abstract ? true : null,
      'aria-label': 'Абстрактный классификатор',
    });
    cb.addEventListener('change', () => commit('Абстрактный элемент', (m) => {
      const e = findEl(m);
      if (e) e.abstract = cb.checked;
    }));
    host.append(el('div', { class: 'checkrow' },
      el('label', { for: 'p-abstract' }, cb, el('span', { text: 'Абстрактный (имя курсивом)' }))));
  }

  // Владение (§3.1): вложенность видна в дереве модели, на лист не выносится.
  ownerSection(host, element, findEl);

  // «Показать пустые отделения» (§20). В оригинале это свойство класса, а не
  // вида: 0 — как на диаграмме (значение по умолчанию в его реестре свойств),
  // 1 — да, 2 — нет; подпись взята из его же словаря.
  if (compartmentsOf(element.kind).some((c) => c.mode === 'members')) {
    const ec = el('select', { 'aria-label': 'Показать пустые отделения' });
    for (const [v, t] of [['0', 'Как на диаграмме'], ['1', 'Да'], ['2', 'Нет']]) {
      ec.append(el('option', { value: v, text: t, selected: String(element.emptyCompartments ?? 0) === v ? true : null }));
    }
    ec.addEventListener('change', () => commit('Пустые отделения', (m) => {
      const e = findEl(m);
      if (!e) return;
      const n = Number(ec.value);
      if (n === 1 || n === 2) e.emptyCompartments = n;
      else delete e.emptyCompartments;
    }));
    host.append(field('Пустые отделения', ec));
  }

  // Линия жизни (§3.3): множественная и завершённая — два флага стандарта.
  if (def.style === 'lifeline' || def.style === 'actorLifeline') {
    flagRow(host, {
      id: 'p-multi', label: 'Множественная (несколько экземпляров)', checked: element.multiObject,
      title: 'Multi-object: две наклонные черты у головы',
      apply: (m, v) => { const e = findEl(m); if (e) e.multiObject = v ? true : undefined; },
    });
    flagRow(host, {
      id: 'p-stopped', label: 'Завершена (крест на конце)', checked: element.stopped,
      title: 'Stopped: линия жизни завершена',
      apply: (m, v) => { const e = findEl(m); if (e) e.stopped = v ? true : undefined; },
    });
  }

  // Линия жизни представляет классификатор (§17.3.4, `Lifeline::represents`):
  // на листе это подпись `имя : Класс` (render.js), а правила сверяют класс с
  // операциями сообщений. Шкала времени — та же линия жизни, только
  // горизонтальная, поэтому список общий. Селект — тот же `refSelect`, что у
  // дорожки деятельности: новый виджет здесь не нужен.
  if (element.kind === 'lifeline' || element.kind === 'actorLifeline' || element.kind === 'timingLane') {
    const classes = store.model.elements.filter((e) => e.id !== element.id
      && REPRESENTABLE_KINDS.includes(e.kind));
    const rep = refSelect(classes.map((e) => ({ id: e.id, label: labelOfElement(e) })),
      element.represents, '— классификатор не указан —', 'Классификатор, который представляет линия жизни');
    rep.addEventListener('change', () => commit('Классификатор линии жизни', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (rep.value) e.represents = rep.value; else delete e.represents;
    }));
    host.append(field('Представляет', rep));
  }

  if (def.style === 'frame') {
    const op = el('select', { 'aria-label': 'Оператор фрагмента' });
    for (const k of ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'assert', 'strict', 'seq', 'ignore', 'consider', 'ref', 'sd']) {
      op.append(el('option', { value: k, text: k, selected: (element.operator || 'ref') === k ? true : null }));
    }
    op.addEventListener('change', () => commit('Оператор фрагмента', (m) => {
      const e = findEl(m);
      if (e) e.operator = op.value;
    }));
    host.append(field('Оператор', op));
    // Операнды и сторожа — только у комбинированного фрагмента (§3.4).
    if (element.kind === 'fragment') operandsSection(host, element, findEl);
  }

  for (const c of compartmentsOf(element.kind)) {
    if (c.mode === 'lines') {
      host.append(
        section(c.title, el('span', { class: 'mini', text: 'строка на листе' })),
        linesEditor(element, c.field, c.title, c.prefix),
        el('div', { class: 'addbar' }, el('button', {
          class: 'btn', text: '+ строка',
          onclick: () => {
            const idx = commit('Добавление строки', (m) => {
              const e = findEl(m);
              return e ? addLine(e, c.field) : null;
            });
            if (typeof idx === 'number') renderProps();
          },
        })),
      );
      continue;
    }
    const slots = c.mode === 'slots';
    const literals = c.mode === 'members' && c.novis;
    host.append(
      section(c.title, el('span', { class: 'mini', text: slots ? 'имя · значение' : 'видимость · имя · тип · значение' })),
      memberTable(element, c.field, c.title, { slots, literals }),
      el('div', { class: 'addbar' },
        el('button', {
          class: 'btn', text: '+ строка',
          'aria-label': `Добавить строку в «${c.title}»`,
          onclick: () => {
            const idx = commit('Добавление строки', (m) => {
              const e = findEl(m);
              return e ? addMemberRow(e, c.field) : null;
            });
            if (typeof idx === 'number') focusCell(element.id, c.field, idx, 'name');
          },
        }),
        el('button', {
          class: 'btn', text: '+ на листе', title: 'Добавит строку и откроет правку прямо на фигуре',
          onclick: () => addMemberRowOnSheet(shape, c.field),
        })),
    );
  }

  if (def.style === 'timingLane') {
    host.append(section('Состояния во времени', el('span', { class: 'mini', text: 'состояние · с · по (0–100)' })));
    const segs = Array.isArray(element.timeline) ? element.timeline : [];
    segs.forEach((s, i) => {
      const st = el('input', { type: 'text', value: s.state ?? '', 'aria-label': `Состояние ${i + 1}` });
      const from = el('input', { type: 'number', value: s.from ?? 0, min: '0', max: '100', 'aria-label': `Начало ${i + 1}` });
      const to = el('input', { type: 'number', value: s.to ?? 100, min: '0', max: '100', 'aria-label': `Конец ${i + 1}` });
      st.addEventListener('change', () => commit('Правка шкалы', (m) => {
        const e = findEl(m);
        if (e?.timeline?.[i]) e.timeline[i].state = st.value;
      }));
      from.addEventListener('change', () => commit('Правка шкалы', (m) => {
        const e = findEl(m);
        if (e?.timeline?.[i]) e.timeline[i].from = Number(from.value);
      }));
      to.addEventListener('change', () => commit('Правка шкалы', (m) => {
        const e = findEl(m);
        if (e?.timeline?.[i]) e.timeline[i].to = Number(to.value);
      }));
      host.append(el('div', { class: 'line-row' }, st, from, to,
        el('button', {
          class: 'xbtn', title: 'Удалить отрезок',
          onclick: () => commit('Правка шкалы', (m) => {
            const e = findEl(m);
            if (e?.timeline) e.timeline.splice(i, 1);
          }),
        }, icon('ui-close', 12))));
    });
    host.append(el('div', { class: 'addbar' }, el('button', {
      class: 'btn', text: '+ отрезок',
      onclick: () => commit('Правка шкалы', (m) => {
        const e = findEl(m);
        if (!e) return;
        if (!Array.isArray(e.timeline)) e.timeline = [];
        const last = e.timeline[e.timeline.length - 1];
        e.timeline.push({ state: 'Состояние', from: last ? last.to : 0, to: 100 });
      }),
    })));
  }

  // Состояние (§3.7): внутренние переходы и регионы — то, чем составное
  // состояние отличается от простого.
  if (element.kind === 'state') {
    internalsSection(host, element, findEl);
    regionsSection(host, element, findEl);
  }
  // Регионы структурированного узла деятельности (§3.6): Conditional/Loop.
  if (element.kind === 'action') regionsSection(host, element, findEl);

  // Деятельность (§3.6): дорожка узла, представляемый элемент дорожки и
  // вызываемая деятельность. Это ссылки модели — на листе они не рисуются.
  const swimlanes = store.model.elements.filter((e) => e.kind === 'swimlane');
  if (swimlanes.length && (element.kind === 'action' || element.kind === 'decision'
    || element.kind === 'merge' || element.kind === 'initial' || element.kind === 'final'
    || element.kind === 'objectNode')) {
    const lane = refSelect(swimlanes.map((e) => ({ id: e.id, label: labelOfElement(e) })), element.laneId, '— без дорожки —', 'Дорожка узла');
    lane.addEventListener('change', () => commit('Дорожка узла', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (lane.value) e.laneId = lane.value; else delete e.laneId;
    }));
    host.append(field('Дорожка', lane));
  }
  if (element.kind === 'swimlane') {
    const all = store.model.elements.filter((e) => e.id !== element.id);
    const rep = refSelect(all.map((e) => ({ id: e.id, label: labelOfElement(e) })), element.represents, '— ничего не представляет —', 'Представляемый элемент');
    rep.addEventListener('change', () => commit('Что представляет дорожка', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (rep.value) e.represents = rep.value; else delete e.represents;
    }));
    host.append(field('Представляет', rep));
  }
  if (element.kind === 'action') {
    const acts = store.model.elements.filter((e) => e.kind === 'activity');
    const beh = refSelect(acts.map((e) => ({ id: e.id, label: labelOfElement(e) })), element.behaviorRef, '— обычное действие —', 'Вызываемая деятельность');
    beh.addEventListener('change', () => commit('Вызов деятельности', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (beh.value) e.behaviorRef = beh.value; else delete e.behaviorRef;
    }));
    host.append(field('Вызывает', beh));
  }
  // Экземпляр (§3.5): классификатор, экземпляром которого он является.
  if (element.kind === 'object') {
    const classes = store.model.elements.filter((e) => ['class', 'interface', 'component', 'node', 'datatype', 'enumeration'].includes(e.kind));
    const cls = refSelect(classes.map((e) => ({ id: e.id, label: labelOfElement(e) })), element.classifierId, '— классификатор не указан —', 'Классификатор экземпляра');
    cls.addEventListener('change', () => commit('Классификатор экземпляра', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (cls.value) e.classifierId = cls.value; else delete e.classifierId;
    }));
    host.append(field('Классификатор', cls));
  }
  // Ссылка на взаимодействие (§3.5): на какую диаграмму она указывает.
  if (element.kind === 'interactionUse') {
    const ref = refSelect((store.model.diagrams ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.kind})` })), element.refersTo, '— ни на что не ссылается —', 'Ссылка на взаимодействие');
    ref.addEventListener('change', () => commit('Ссылка на взаимодействие', (m) => {
      const e = findEl(m);
      if (!e) return;
      if (ref.value) e.refersTo = ref.value; else delete e.refersTo;
    }));
    host.append(field('Ссылается на', ref));
  }

  if (def.wrap) {
    const ta = el('textarea', { rows: 4, 'aria-label': 'Текст примечания' });
    host.append(section('Текст'), ta);
    bindText(ta, element.note ?? '', (m, v) => {
      const e = findEl(m);
      if (e) e.note = v;
    });
  }

  host.append(section('Заливка',
    themeIsDark() ? el('span', { class: 'mini', text: 'в тёмной теме приглушена' }) : ''));
  const sw = el('div', { class: 'swatches' });
  for (const s of FILL_SWATCHES) {
    // Кружок показывает цвет, которым фигура будет залита НА ЭКРАНЕ: в тёмной
    // теме это тот же оттенок в полосе листа (fill.js#themeFill). Иначе
    // выбранная пастель и нарисованный блок выглядели бы разными цветами.
    sw.append(el('button', {
      class: `swatch${(shape.fill ?? null) === s.key ? ' on' : ''}`,
      style: `background:${themeFill(s.css, themeIsDark())}`,
      title: s.title,
      'aria-label': `Заливка: ${s.title}`,
      'aria-pressed': (shape.fill ?? null) === s.key ? 'true' : 'false',
      onclick: () => commit('Заливка', (m) => {
        const target = findSh(m);
        if (target) target.fill = s.key;
      }),
    }));
  }
  const custom = el('input', {
    type: 'color', value: fillOf(shape).color1 ?? '#ffffff', title: 'Свой цвет', 'aria-label': 'Заливка: свой цвет',
  });
  custom.addEventListener('change', () => commit('Заливка', (m) => {
    const target = findSh(m);
    if (!target) return;
    const cur = fillOf(target);
    // Второй цвет и направление градиента остаются: меняется только первый.
    target.fill = cur.type === FILL_GRADIENT
      ? { ...cur, color1: custom.value }
      : custom.value;
  }));
  sw.append(custom, el('span', { class: 'color-custom', text: 'свой цвет' }));
  host.append(sw);

  // Градиент — то же правило, что в оригинале (v/cmw/aw#a(...)): два цвета
  // и одно из 16 направлений. type=1 — сплошной цвет выше, type=2 — градиент.
  const fillNow = fillOf(shape);
  const gradBox = el('div', { class: 'fillgrad' });
  gradBox.append(el('button', {
    class: `btn grad-toggle${fillNow.type === FILL_GRADIENT ? ' on' : ''}`,
    text: fillNow.type === FILL_GRADIENT ? 'градиент: вкл' : 'градиент: выкл',
    title: 'Заливка градиентом из двух цветов',
    'aria-pressed': fillNow.type === FILL_GRADIENT ? 'true' : 'false',
    onclick: () => commit('Заливка', (m) => {
      const target = findSh(m);
      if (!target) return;
      const cur = fillOf(target);
      target.fill = cur.type === FILL_GRADIENT
        ? { type: FILL_SOLID, color1: cur.color1 || '#ffffff' }
        : {
          type: FILL_GRADIENT,
          color1: cur.color1 || '#ffffff',
          color2: cur.color2 || '#7acff5',
          style: cur.style || 1,
        };
    }),
  }));
  if (fillNow.type === FILL_GRADIENT) {
    const darkPreview = themeIsDark();
    const c1 = themeFill(fillNow.color1 || '#ffffff', darkPreview);
    const c2 = themeFill(fillNow.color2 || '#7acff5', darkPreview);
    const dirs = el('div', { class: 'grad-dirs', role: 'group', 'aria-label': 'Направление градиента' });
    for (const d of GRADIENT_STYLES) {
      const angle = Math.round((Math.atan2(d.x2 - d.x1, -(d.y2 - d.y1)) * 180) / Math.PI);
      dirs.append(el('button', {
        class: `grad-dir${fillNow.style === d.style ? ' on' : ''}`,
        style: `background:linear-gradient(${angle}deg, ${c1}, ${c2})`,
        title: `${d.style}. ${d.label}`,
        'aria-label': `Градиент ${d.style}: ${d.label}`,
        'aria-pressed': fillNow.style === d.style ? 'true' : 'false',
        onclick: () => commit('Заливка', (m) => {
          const target = findSh(m);
          if (!target) return;
          const cur = fillOf(target);
          target.fill = {
            type: FILL_GRADIENT,
            color1: cur.color1 || '#ffffff',
            color2: cur.color2 || '#7acff5',
            style: d.style,
          };
        }),
      }));
    }
    gradBox.append(dirs);
    const second = el('input', {
      type: 'color', value: c2, title: 'Второй цвет', 'aria-label': 'Градиент: второй цвет',
    });
    second.addEventListener('change', () => commit('Заливка', (m) => {
      const target = findSh(m);
      if (!target) return;
      const cur = fillOf(target);
      target.fill = {
        type: FILL_GRADIENT,
        color1: cur.color1 || '#ffffff',
        color2: second.value,
        style: cur.style || 1,
      };
    }));
    gradBox.append(second, el('span', { class: 'color-custom', text: 'второй цвет' }));
  }
  host.append(gradBox);

  taggedValuesSection(host, element, findEl);

  // Nested diagrams: a diagram may belong to this element (owned diagrams).
  const kids = nestedDiagrams(store.model, element.id);
  host.append(section('Вложенные диаграммы', el('span', { class: 'mini', text: 'принадлежат элементу' })));
  if (kids.length) {
    const list = el('div', { class: 'nested-list' });
    for (const d of kids) {
      list.append(el('div', { class: 'nested-row' },
        el('button', {
          class: 'linkbtn', text: d.name,
          title: `Открыть «${d.name}» (${typeOf(d.kind)?.label ?? d.kind})`,
          onclick: () => openDiagram(d.id),
        }),
        el('span', { class: 'dtype', text: typeOf(d.kind)?.label ?? d.kind }),
        el('button', {
          class: 'xbtn', title: 'Удалить диаграмму',
          onclick: () => commit('Удаление диаграммы', (m) => { removeDiagram(m, d.id); }),
        }, icon('ui-close', 12))));
    }
    host.append(list);
  } else {
    host.append(el('div', { class: 'empty', text: 'У элемента нет своих диаграмм.' }));
  }
  host.append(el('div', { class: 'addbar' }, el('button', {
    class: 'btn', text: '+ Вложенная диаграмма',
    onclick: async () => {
      const pick = await chooseDiagramType({ owner: element.name });
      if (!pick) return;
      const created = commit('Новая вложенная диаграмма', (m) => {
        const d = createDiagram(pick.name, pick.kind, element.id);
        m.diagrams.push(d);
        return d;
      });
      openDiagram(created.id);
      set({ hint: `Диаграмма «${created.name}» создана внутри «${element.name}».` });
    },
  })));

  // «Где показан» — вопрос про ЭЛЕМЕНТ, поэтому ответ здесь, а не строкой
  // дерева. В дереве лист назван один раз; повторять его имя под каждым
  // элементом значило бы отдать четверть панели одному и тому же слову
  // (замер: 16 строк из 66 на 3102, 81 из 266 на ?model=all).
  shownOnSection(host, element);

  // Вложения — файлы при элементе модели (пособие: артефакты вложения). Схема
  // и запись в файл — зона W4; здесь только чтение, скачивание и удаление.
  attachmentsSection(host, element, findEl);

  host.append(
    section('Размер'),
    el('div', { class: 'kv' }, el('span', { text: 'по листу' }),
      el('b', { class: 'mono', text: `${shape.w}×${shape.h}` })),
    el('div', { class: 'kv' }, el('span', { text: 'рисуется' }),
      el('b', { class: 'mono', text: (() => { const { w, h } = layoutOf(shape, element); return `${w}×${h}`; })() })),
  );
}

/* --------------------------------------------------- connector props */

/** Быстрый набор цветов линии. Это не палитра связи (её у связи нет):
 * это те цвета, которыми в пособии помечают акценты — исключения, главный
 * поток, ошибку. */
const LINE_COLORS = [
  { key: null, title: 'Чернила листа' },
  { key: '#c62828', title: 'Красный' },
  { key: '#1b7f3b', title: 'Зелёный' },
  { key: '#1565c0', title: 'Синий' },
  { key: '#6a1b9a', title: 'Фиолетовый' },
];

/**
 * Цвет линии связи.
 *
 * ЗАЧЕМ ЗДЕСЬ, А НЕ В «СТИЛЕ». Стиль связи — это её форма (прямая, ломаная,
 * с изгибом), а цвет — не форма, а пометка: одна и та же ассоциация на разных
 * листах бывает главной и вспомогательной. Поэтому цвет живёт отдельным полем
 * и пишется в файл только когда он задан (`color` у связи).
 *
 * В тёмной теме выбранный цвет приводится к теме так же, как заливка фигуры:
 * «чёрная» линия на тёмном листе была бы невидимой. Экспорт берёт исходный.
 */
function lineColorField(link, findLinkT) {
  const wrap = el('div', { class: 'swatches' });
  for (const c of LINE_COLORS) {
    const on = (link.color ?? null) === c.key;
    const sw = el('button', {
      type: 'button',
      class: `swatch${on ? ' on' : ''}`,
      title: c.title,
      'aria-label': `Цвет линии: ${c.title}`,
      'aria-pressed': on ? 'true' : 'false',
      style: c.key ? `background:${c.key}` : 'background:transparent',
    }, c.key ? '' : '∅');
    if (!c.key) sw.classList.add('swatch-none');
    sw.addEventListener('click', () => commit('Цвет линии', (m) => {
      const l = findLinkT(m);
      if (!l) return;
      if (c.key) l.color = c.key;
      else delete l.color;
    }));
    wrap.append(sw);
  }
  const pick = el('input', {
    type: 'color',
    value: link.color || '#1d1e1c',
    'aria-label': 'Цвет линии: свой цвет',
    title: 'Свой цвет',
  });
  pick.addEventListener('change', () => commit('Цвет линии', (m) => {
    const l = findLinkT(m);
    if (l) l.color = pick.value;
  }));
  wrap.append(pick);
  return el('div', { class: 'field' }, el('label', { text: 'Цвет линии' }), wrap);
}

function renderConnectorProps(host, link) {
  const rel = relOf(store.model, link);
  if (!rel) return;
  const def = NOTATION.connectors[rel.kind];
  const findRel = (m) => findRelationship(m, rel.id);
  const findLinkT = (m) => findLink(m, link.id);

  host.append(
    section(def.label, el('span', { class: 'mini', text: 'связь модели' })),
    field('Имя', el('input', { type: 'text' })),
    field('Стереотип', stereotypePicker(rel, rel.kind, findRel)),
    lineColorField(link, findLinkT),
  );
  bindText(host.querySelectorAll('.field input[type=text]')[0], rel.name, (m, v) => {
    const r = findRel(m);
    if (r) r.name = v;
  });

  // Association is a Classifier too (UML 2.5.1 §11.8.1.3), so its name may be
  // abstract and is then set in italics. `aggregation`/`composition` are an
  // Association with an aggregation kind, `communicationPath` is an Association
  // subclass (§19.5.2) — all four inherit Classifier and get the same box.
  if (isAbstractable(rel.kind)) {
    const cb = el('input', {
      type: 'checkbox', id: 'p-abstract', checked: rel.abstract ? true : null,
      'aria-label': 'Абстрактная связь',
    });
    cb.addEventListener('change', () => commit('Абстрактная связь', (m) => {
      const r = findRel(m);
      if (r) r.abstract = cb.checked;
    }));
    host.append(el('div', { class: 'checkrow' },
      el('label', { for: 'p-abstract' }, cb, el('span', { text: 'Абстрактная (имя курсивом)' }))));
  }

  // How the line is laid out, and which way its name may turn: two enums of the
  // original, read out of its own value→label table (§22). A connector keeps
  // its own value, defaulting to "follow the diagram" — the registry default of
  // both properties — so the diagram's choice shows through until one link
  // overrides it.
  if (!def.sequence) {
    const styleSel = el('select', { 'aria-label': 'Стиль связи' });
    const styleNow = isConnectorStyle(link.style) ? link.style : STYLE_INHERIT;
    for (const [code, text] of STYLE_OPTIONS) {
      styleSel.append(el('option', {
        value: String(code), text, selected: styleNow === code ? true : null,
      }));
    }
    styleSel.addEventListener('change', () => commit('Стиль связи', (m) => {
      const l = findLinkT(m);
      if (!l) return;
      const code = Number(styleSel.value);
      if (code === STYLE_INHERIT) delete l.style;
      else l.style = code;
    }));

    const orSel = el('select', { 'aria-label': 'Поворот подписи связи' });
    const orNow = link.labelOrientation ?? LABEL_ORIENTATION.followDiagram;
    for (const [code, text] of ORIENTATION_OPTIONS) {
      orSel.append(el('option', {
        value: String(code), text, selected: orNow === code ? true : null,
      }));
    }
    orSel.addEventListener('change', () => commit('Поворот подписи связи', (m) => {
      const l = findLinkT(m);
      if (!l) return;
      const code = Number(orSel.value);
      if (code === LABEL_ORIENTATION.followDiagram) delete l.labelOrientation;
      else l.labelOrientation = code;
    }));

    host.append(
      field('Стиль связи', styleSel),
      field('Подпись связи', orSel),
    );

    // Скачки на пересечениях (§26): у связи свой код, у настройки — своя
    // тройка размеров. «Как на диаграмме» — значение реестра (4), поэтому
    // выбор этого пункта стирает поле, а не пишет 4 в файл.
    const jumpSel = el('select', { 'aria-label': 'Скачки на пересечениях' });
    const jumpNow = isLineJumps(link.lineJumps) ? link.lineJumps : JUMP_INHERIT;
    for (const [code, text] of JUMP_OPTIONS) {
      jumpSel.append(el('option', {
        value: String(code), text, selected: jumpNow === code ? true : null,
      }));
    }
    jumpSel.addEventListener('change', () => commit('Скачки на пересечениях', (m) => {
      const l = findLinkT(m);
      if (!l) return;
      const code = Number(jumpSel.value);
      if (code === JUMP_INHERIT) delete l.lineJumps;
      else l.lineJumps = code;
    }));

    const sizeSel = el('select', { 'aria-label': 'Размер скачка' });
    const sizeNow = Number.isInteger(link.lineJumpsSize) ? link.lineJumpsSize : MECHANICS.lineJumpSizeDefault;
    for (let s = 0; s <= MECHANICS.lineJumpSizeMax; s += 1) {
      sizeSel.append(el('option', {
        value: String(s), text: String(s) + (s === MECHANICS.lineJumpSizeDefault ? ' (умолчание)' : ''),
        selected: sizeNow === s ? true : null,
      }));
    }
    sizeSel.addEventListener('change', () => commit('Размер скачка', (m) => {
      const l = findLinkT(m);
      if (!l) return;
      const s = Number(sizeSel.value);
      if (s === MECHANICS.lineJumpSizeDefault) delete l.lineJumpsSize;
      else l.lineJumpsSize = s;
    }));

    host.append(
      field('Скачки на пересечениях', jumpSel),
      field('Размер скачка', sizeSel),
      el('div', {
        class: 'member-hint',
        text: 'Стиль: 0 Rectilinear, 1 Oblique, 2 Curve, 4/5 — со скруглением. '
          + 'Подпись: 0 только горизонтально (как в оригинале), 1 по осям, '
          + '2 вдоль линии, 3 вдоль линии и не вверх ногами. '
          + 'Скачок рисуется там, где эту линию пересекает другая связь.',
      }),
    );
  }

  if (def.multiplicity) {
    const a = el('input', { type: 'text' });
    const b = el('input', { type: 'text' });
    const ra = el('input', { type: 'text', 'aria-label': 'Роль у источника' });
    const rb = el('input', { type: 'text', 'aria-label': 'Роль у цели' });
    host.append(
      section('Множественность и роли'),
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'от' }), a),
        el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'к' }), b)),
      el('div', { class: 'row' },
        el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'роль от' }), ra),
        el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'роль к' }), rb)),
      el('div', { class: 'member-hint', text: 'например 1, 0..1, *' }),
    );
    bindCommit(a, rel.fromMultiplicity, (m, v) => { const r = findRel(m); if (r) r.fromMultiplicity = v; });
    bindCommit(b, rel.toMultiplicity, (m, v) => { const r = findRel(m); if (r) r.toMultiplicity = v; });
    bindCommit(ra, rel.fromRole, (m, v) => { const r = findRel(m); if (r) r.fromRole = v; });
    bindCommit(rb, rel.toRole, (m, v) => { const r = findRel(m); if (r) r.toRole = v; });
  }

  if (def.sequence) {
    const y = el('input', { type: 'number', value: String(Math.round(link.y ?? 0)) });
    y.addEventListener('change', () => commit('Порядок сообщений', (m) => {
      const l = findLinkT(m);
      if (l) l.y = Number(y.value);
    }));
    host.append(section('Сообщение'), field('Высота (порядок сверху вниз)', y),
      el('div', { class: 'member-hint', text: 'Номер сообщения считается по высоте: верхнее — 1. Перетаскивание линии на листе тоже меняет порядок.' }));

    // `seq` (§3.2): разрежённый порядок. Есть хоть у одного сообщения
    // диаграммы — он главный для всех; пустое поле убирает его из файла.
    const seqIn = el('input', {
      type: 'number', value: rel.seq == null ? '' : String(rel.seq),
      'aria-label': 'Порядок сообщения (seq)', placeholder: 'по геометрии',
    });
    seqIn.addEventListener('change', () => commit('Порядок сообщения', (m) => {
      const r = findRel(m);
      if (!r) return;
      if (seqIn.value === '') delete r.seq;
      else r.seq = Number(seqIn.value);
    }));
    host.append(field('Порядок (seq)', seqIn));

    // Подпись сообщения (§17.12.18.7, `Message::signature`): вызываемая
    // операция с параметрами. Это НЕ `name`: имя связи — метка на линии
    // («2: зарегистрировать»), а сигнатура — то, что правило сверяет с
    // `operations[]` классификатора получателя. Поэтому два поля, а не одно
    // склеенное: склейка потеряла бы, где кончается метка и начинается
    // операция. Пустая строка УДАЛЯЕТ поле, как у остальных необязательных
    // полей модели.
    const sigIn = el('input', {
      type: 'text', value: rel.signature ?? '', 'aria-label': 'Сигнатура сообщения',
      placeholder: 'например: updateStudent(st: Student)',
    });
    sigIn.addEventListener('change', () => commit('Сигнатура сообщения', (m) => {
      const r = findRel(m);
      if (!r) return;
      const v = sigIn.value.trim();
      if (v) r.signature = v; else delete r.signature;
    }));
    host.append(field('Сигнатура', sigIn),
      el('div', {
        class: 'member-hint',
        text: 'операция с параметрами; на листе рисуется мелким под именем сообщения',
      }));

    // Асинхронность (§3.2): открытая стрелка вместо залитой.
    flagRow(host, {
      id: 'p-async', label: 'Асинхронное сообщение', checked: rel.asynchronous,
      title: 'Открытая стрелка вместо залитой',
      apply: (m, v) => { const r = findRel(m); if (r) r.asynchronous = v ? true : undefined; },
    });

    // Концы сообщения: у найденного нет отправителя, у потерянного —
    // получателя (§17.4.4). Список — только линии жизни этой диаграммы:
    // конец без фигуры нарисовать негде.
    const d = currentDiagram(store.model);
    const lifelines = (d?.shapes ?? [])
      .map((s) => elementOf(store.model, s))
      .filter((e) => e && ['lifeline', 'actorLifeline'].includes(NOTATION.shapes[e.kind]?.style));
    const endKeys = [['from', 'Отправитель'], ['to', 'Получатель']];
    for (const [end, label] of endKeys) {
      const sel = el('select', { 'aria-label': label });
      sel.append(el('option', {
        value: '', text: end === 'from' ? '— нет (найденное сообщение) —' : '— нет (потерянное сообщение) —',
        selected: rel[end] == null ? true : null,
      }));
      for (const e of lifelines) {
        sel.append(el('option', {
          value: e.id, text: e.name || e.id, selected: rel[end] === e.id ? true : null,
        }));
      }
      sel.addEventListener('change', () => commit(label, (m) => {
        const r = findRel(m);
        if (!r) return;
        const l = findLinkT(m);
        const wanted = sel.value || null;
        if (!wanted) {
          r[end] = null;
          if (l) l[end] = null;
          return;
        }
        const shape = (currentDiagram(m)?.shapes ?? []).find((s) => s.elementId === wanted);
        if (!shape) { set({ hint: 'Этого элемента нет на диаграмме — конец остался как был.' }); return; }
        if (r[end] == null && l) l[end] = { shapeId: shape.id, side: end === 'from' ? 'right' : 'left', t: 0.5 };
        r[end] = wanted;
      }));
      host.append(field(label, sel));
    }
    host.append(el('div', { class: 'member-hint', text: 'Свободный конец рисуется кружком — это найденное или потерянное сообщение.' }));
  }

  // Переход состояния (§3.7): `local` — переход внутри составного состояния.
  if (rel.kind === 'transition') {
    // Подпись перехода (§14.5.4): `событие [сторож] / действие`. Три поля, а не
    // одна строка: сторож и действие — разные свойства перехода в стандарте, и
    // склеенная строка потеряла бы, где кончается одно и начинается другое.
    // Пустая строка УДАЛЯЕТ поле — как у остальных необязательных полей модели.
    const trig = el('input', {
      type: 'text', value: rel.trigger ?? '', 'aria-label': 'Событие перехода',
      placeholder: 'например: заявка принята',
    });
    const guard = el('input', {
      type: 'text', value: rel.guard ?? '', 'aria-label': 'Сторожевое условие перехода',
      placeholder: 'например: мест > 0',
    });
    const effect = el('input', {
      type: 'text', value: rel.effect ?? '', 'aria-label': 'Действие перехода',
      placeholder: 'например: зачислить()',
    });
    const bind = (input, key) => input.addEventListener('change', () => commit('Подпись перехода', (m) => {
      const r = findRel(m);
      if (!r) return;
      const v = input.value.trim();
      if (v) r[key] = v;
      else delete r[key];
    }));
    bind(trig, 'trigger'); bind(guard, 'guard'); bind(effect, 'effect');
    const line = internalText({ trigger: rel.trigger, guard: rel.guard, effect: rel.effect });
    host.append(
      section('Подпись перехода', el('span', { class: 'mini', text: 'событие · сторож · действие' })),
      field('Событие', trig),
      field('Сторожевое условие', guard),
      field('Действие', effect),
      el('div', {
        class: 'member-hint',
        text: 'пишется как `событие [условие] / действие` на линии',
      }),
      el('div', {
        class: 'tr-transition-preview',
        text: line || 'пусто — линия без подписи',
        title: 'Так подпись будет собрана из трёх полей',
      }),
    );
    flagRow(host, {
      id: 'p-local', label: 'Внутренний (local) переход', checked: rel.local,
      title: 'local: переход не выходит из состояния при переходе в подобласть',
      apply: (m, v) => { const r = findRel(m); if (r) r.local = v ? true : undefined; },
    });
  }

  // Association-end properties: navigation and aggregation. UML 2.5.1 puts
  // both on the END (§11.5.3–11.5.4), so they are per-relationship fields and
  // the sheet draws an arrow or a diamond at the end they belong to.
  const assocFamily = rel.kind === 'association' || rel.kind === 'aggregation' || rel.kind === 'composition';
  if (assocFamily) {
    const nav = el('select', { 'aria-label': 'Навигация ассоциации' });
    for (const [v, label] of [['none', 'без стрелок'], ['from', 'от источника'], ['to', 'к цели'], ['both', 'в обе стороны']]) {
      nav.append(el('option', { value: v, text: label, selected: navigableOf(rel) === v ? true : null }));
    }
    nav.addEventListener('change', () => commit('Навигация связи', (m) => {
      const r = findRel(m);
      if (r) r.navigable = nav.value;
    }));

    const aggSelect = (end, label) => {
      const sel = el('select', { 'aria-label': label });
      for (const [v, text] of [['none', 'нет'], ['shared', 'агрегация (полый ромб)'], ['composite', 'композиция (залитый ромб)']]) {
        sel.append(el('option', { value: v, text, selected: aggregationOf(rel, end) === v ? true : null }));
      }
      sel.addEventListener('change', () => commit('Агрегация связи', (m) => {
        const r = findRel(m);
        if (!r) return;
        if (end === 'from') r.fromAggregation = sel.value;
        else r.toAggregation = sel.value;
      }));
      return sel;
    };

    host.append(
      field('Навигация', nav),
      section('Агрегация концов', el('span', { class: 'mini', text: 'ромб у конца связи' })),
      field('у источника', aggSelect('from', 'Агрегация у источника')),
      field('у цели', aggSelect('to', 'Агрегация у цели')),
      el('div', { class: 'member-hint', text: 'Полый ромб — агрегация, залитый — композиция. Стрелка показывает, откуда конец достижим.' }),
    );

    // Квалификаторы полюсов (§11.4.4, §3.8): список строк через запятую,
    // рисуется маленьким прямоугольником у конца связи.
    const qFrom = el('input', { type: 'text', value: qualifiersOf(rel, 'from').join(', '), 'aria-label': 'Квалификаторы у источника', placeholder: 'code' });
    const qTo = el('input', { type: 'text', value: qualifiersOf(rel, 'to').join(', '), 'aria-label': 'Квалификаторы у цели', placeholder: 'semester' });
    const bindQ = (input, field) => input.addEventListener('change', () => commit('Квалификатор', (m) => {
      const r = findRel(m);
      if (!r) return;
      const list = input.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (list.length) r[field] = list; else delete r[field];
    }));
    bindQ(qFrom, 'fromQualifiers');
    bindQ(qTo, 'toQualifiers');
    host.append(
      section('Квалификаторы', el('span', { class: 'mini', text: 'через запятую' })),
      field('у источника', qFrom),
      field('у цели', qTo),
    );
  }

  // Generalization set (UML 2.5.1 §9.7): the set is a model entity, the
  // generalization points at it, and the sheet prints {complete, disjoint}.
  if (rel.kind === 'generalization') {
    const sets = generalizationSetsOf(store.model);
    const cur = setOfRelationship(store.model, rel);
    const pick = el('select', { 'aria-label': 'Набор обобщений' });
    pick.append(el('option', { value: '', text: '— без набора —', selected: cur ? null : true }));
    for (const s of sets) {
      pick.append(el('option', { value: s.id, text: s.name || s.id, selected: cur?.id === s.id ? true : null }));
    }
    pick.append(el('option', { value: '__new', text: '+ новый набор…' }));
    pick.addEventListener('change', () => {
      if (pick.value === '__new') {
        const created = commit('Новый набор обобщений', (m) => {
          const s = createGeneralizationSet(`Набор ${generalizationSetsOf(m).length + 1}`);
          m.generalizationSets = [...generalizationSetsOf(m), s];
          const r = findRel(m);
          if (r) r.setId = s.id;
          return s;
        });
        set({ hint: `Набор «${created.name}» создан и привязан к обобщению.` });
        return;
      }
      commit('Набор обобщений', (m) => {
        const r = findRel(m);
        if (r) r.setId = pick.value || undefined;
      });
    });
    host.append(section('Набор обобщений', el('span', { class: 'mini', text: 'UML 2.5.1 §9.7' })), field('Набор', pick));

    if (cur) {
      const box = (key, label) => {
        const cb = el('input', {
          type: 'checkbox', checked: cur[key] ? true : null,
          'aria-label': label, 'data-set': cur.id, 'data-prop': key,
        });
        cb.addEventListener('change', () => commit('Свойство набора', (m) => {
          const s = findGeneralizationSet(m, cur.id);
          if (s) s[key] = cb.checked;
        }));
        return el('label', { class: 'checkrow' }, cb, el('span', { text: label }));
      };
      const nameIn = el('input', { type: 'text', value: cur.name ?? '', 'aria-label': 'Имя набора обобщений' });
      nameIn.addEventListener('change', () => commit('Имя набора', (m) => {
        const s = findGeneralizationSet(m, cur.id);
        if (s) s.name = nameIn.value;
      }));
      host.append(
        field('Имя набора', nameIn),
        box('covering', 'Полный (complete)'),
        box('disjoint', 'Непересекающийся (disjoint)'),
        el('div', { class: 'member-hint', text: 'На листе: {complete, disjoint} у стрелы обобщения.' }),
      );
    }
  }

  const route = el('select', {},
    el('option', { value: 'rect', text: 'прямоугольный', selected: link.route !== 'direct' ? true : null }),
    el('option', { value: 'direct', text: 'прямой', selected: link.route === 'direct' ? true : null }));
  route.addEventListener('change', () => commit('Маршрут связи', (m) => {
    const l = findLinkT(m);
    if (!l) return;
    l.route = route.value;
    // An explicit line replaces an inherited style, or the style would keep
    // winning in routeOfLink and this list would look dead (§24f).
    delete l.style;
  }));
  host.append(field('Линия', route));

  // Скругление углов: та же ломаная, но изломы срезаны дугой. Радиусы — 6 и
  // 16; на коротких сегментах радиус укорачивается сам, поэтому «большое» не
  // может вывернуть линию (geometry.js::pathD).
  const round = el('select', { 'aria-label': 'Скругление углов связи' },
    el('option', { value: 'off', text: 'без скругления', selected: link.rounded !== 'small' && link.rounded !== 'large' ? true : null }),
    el('option', { value: 'small', text: 'малое (6)', selected: link.rounded === 'small' ? true : null }),
    el('option', { value: 'large', text: 'большое (16)', selected: link.rounded === 'large' ? true : null }));
  round.addEventListener('change', () => commit('Скругление связи', (m) => {
    const l = findLinkT(m);
    if (!l) return;
    if (round.value === 'off') delete l.rounded;
    else l.rounded = round.value;
  }));
  host.append(field('Скругление', round));

  if (Array.isArray(link.waypoints) && link.waypoints.length) {
    const drop = el('button', { type: 'button', class: 'btn', text: 'Убрать точки перегиба' });
    drop.addEventListener('click', () => {
      commit('Точки перегиба', (m) => {
        const l = findLinkT(m);
        if (l) delete l.waypoints;
      });
      set({ wp: null, hint: 'Связь снова идёт автоматически.' });
      renderCanvas();
    });
    host.append(field('Точки перегиба', el('div', { class: 'row' },
      el('span', { class: 'mini', text: String(link.waypoints.length) }), drop)));
  }

  const doc = el('textarea', { rows: 3, 'aria-label': 'Документация' });
  host.append(field('Документация', doc));
  bindText(doc, rel.documentation, (m, v) => {
    const r = findRel(m);
    if (r) r.documentation = v;
  });

  taggedValuesSection(host, rel, findRel);

  host.append(
    section('Концы'),
    el('div', { class: 'kv' }, el('span', { text: 'источник' }), el('b', { class: 'mono', text: endLabel(store.model, link.from) })),
    el('div', { class: 'kv' }, el('span', { text: 'цель' }), el('b', { class: 'mono', text: endLabel(store.model, link.to) })),
  );
  // У сообщения на диаграмме последовательности концы — не края рамки, а
  // центры линий жизни: доля рамки там ничего не значит, поэтому поля
  // привязки показываются только у обычной связи.
  if (!def.sequence) {
    attachFields(host, link, 'from', findLinkT);
    attachFields(host, link, 'to', findLinkT);
    host.append(el('div', { class: 'member-hint', text: 'Доля считается от рамки фигуры: 0 — левый/верхний край, 1 — правый/нижний. Значения вне 0…1 выносят точку за фигуру.' }));
  }
  // Размер наконечника (§28) — свойство КОНЦА, как и привязка: код живёт на
  // самом наконечнике (`v/cco/a`'s поле x, заводское 2), поэтому источник и
  // цель выбираются отдельно. Двойка — умолчание, и файл её не пишет.
  const headSizeField = (endName) => {
    const isFrom = endName === 'from';
    const key = isFrom ? 'headSizeFrom' : 'headSizeTo';
    const sel = el('select', { 'aria-label': `${isFrom ? 'источник' : 'цель'}: размер наконечника` });
    const now = headSizeOf(link[key]);
    for (let c = 0; c < MECHANICS.headSizeCodes; c += 1) {
      sel.append(el('option', {
        value: String(c),
        text: String(c) + (c === MECHANICS.headSizeDefault ? ' (умолчание)' : ''),
        selected: now === c ? true : null,
      }));
    }
    sel.addEventListener('change', () => commit('Размер наконечника', (m) => {
      const l = findLinkT(m);
      if (!l) return;
      const c = Number(sel.value);
      if (c === MECHANICS.headSizeDefault) delete l[key];
      else l[key] = c;
    }));
    return sel;
  };
  host.append(
    field('Наконечник: источник', headSizeField('from')),
    field('Наконечник: цель', headSizeField('to')),
    el('div', {
      class: 'member-hint',
      text: 'Код 0…6 — размер стрелки из оригинала: длина = k[код]·база, ширина = l[код]·база '
        + '(§28). 2 — заводское значение, при нём стрелка ровно базовая.',
    }),
  );
  host.append(
    el('div', { class: 'member-hint', text: 'Перетащите белый квадрат конца связи на другую фигуру прямо на листе: конец станет «к стороне», привязка к точке снимется.' }),
    el('div', { class: 'member-hint', text: 'Delete снимает связь с этой диаграммы, Shift+Delete удаляет её из модели на всех диаграммах.' }),
  );
}

/**
 * Привязка одного конца связи (§3.1, §7.1): доля рамки плюс смещение.
 *
 * Инспектор — единственное место, где доля задаётся руками: перетаскивание
 * конца на листе всегда возвращает `side`+`t` и снимает `attach`, иначе в
 * модели жили бы две правды об одном конце.
 *
 * Пишется только заданное: «к стороне» УДАЛЯЕТ поле `attach`, а `dx`/`dy`,
 * равные нулю, и `project: false` не пишутся вовсе — так файл без долей и
 * круг «сохранил конец точкой → прочитал» остаются байт в байт (umljson.js::
 * canonicalAttach).
 */
function attachFields(host, link, endName, findLinkT) {
  const end = link[endName];
  if (!end) return;
  const isFrom = endName === 'from';
  const title = isFrom ? 'источник' : 'цель';
  const attach = end.attach && typeof end.attach === 'object' ? end.attach : null;

  const mode = el('select', { 'aria-label': `${title}: привязка конца` },
    el('option', { value: 'side', text: 'к стороне', selected: attach ? null : true }),
    el('option', { value: 'point', text: 'к точке', selected: attach ? true : null }));
  mode.addEventListener('change', () => {
    // The panel is rebuilt only when the inspector no longer holds focus;
    // drop it first so the fraction fields appear at once instead of after
    // the next click somewhere else.
    mode.blur();
    if (mode.value === 'point') {
      // Already a point? Nothing to do — deleting the field here would make
      // the same choice mean two different things.
      if (attach) return;
      // The current edge point written as a fraction — the same place on the
      // sheet, so switching modes never moves the line. Note that this is the
      // box fraction, not `side`+`t`: 0.5/0.5 is the CENTRE of the shape, not
      // the middle of an edge.
      const t = end.t ?? 0.5;
      const frac = end.side === 'left' ? { fx: 0, fy: t }
        : end.side === 'right' ? { fx: 1, fy: t }
          : end.side === 'top' ? { fx: t, fy: 0 }
            : { fx: t, fy: 1 };
      commit('Привязка конца', (m) => {
        const l = findLinkT(m);
        if (l?.[endName]) l[endName].attach = { ...frac };
      });
      return;
    }
    commit('Привязка конца', (m) => {
      const l = findLinkT(m);
      // Deleted, not zeroed: an end «к стороне» has no `attach` key at all.
      if (l?.[endName]) delete l[endName].attach;
    });
  });
  host.append(field(`${title} — привязка`, mode));
  if (!attach) return;

  // One number field. A blank field removes its key; `dx`/`dy` at zero are
  // removed too, because zero is the default the file never spells out.
  const numField = (key, label, value, dropZero) => {
    const input = el('input', {
      type: 'number', step: 'any', value: value == null ? '' : String(value), 'aria-label': label,
    });
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      commit('Привязка конца', (m) => {
        const l = findLinkT(m);
        const e = l?.[endName];
        if (!e || !e.attach) return;
        const a = { ...e.attach };
        if (raw === '' || !Number.isFinite(Number(raw)) || (dropZero && Number(raw) === 0)) delete a[key];
        else a[key] = Number(raw);
        if (Object.keys(a).length) e.attach = a; else delete e.attach;
      });
    });
    return input;
  };

  host.append(
    el('div', { class: 'row' },
      el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'fx' }), numField('fx', `${title}: доля по ширине`, attach.fx)),
      el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'fy' }), numField('fy', `${title}: доля по высоте`, attach.fy))),
    el('div', { class: 'row' },
      el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'dx' }), numField('dx', `${title}: смещение по x`, attach.dx, true)),
      el('div', { class: 'field', style: 'margin:0' }, el('label', { text: 'dy' }), numField('dy', `${title}: смещение по y`, attach.dy, true))),
  );

  const project = el('input', {
    type: 'checkbox', checked: attach.project === true ? true : null,
    'aria-label': `${title}: по границе`,
  });
  project.addEventListener('change', () => commit('Привязка конца', (m) => {
    const l = findLinkT(m);
    const e = l?.[endName];
    if (!e || !e.attach) return;
    if (project.checked) e.attach.project = true;
    else delete e.attach.project;
  }));
  host.append(el('label', { class: 'checkrow' }, project, el('span', { text: 'по границе' })));
}

const endLabel = (m, e) => {
  if (!e) return '— нет (свободный конец) —';
  const s = findShape(m, e.shapeId);
  const element = elementOf(m, s);
  const where = e.attach
    ? `точка ${e.attach.fx ?? 0.5}·${e.attach.fy ?? 0.5}`
    : `${e.side}${e.t != null && Math.abs(e.t - 0.5) > 1e-9 ? ` ${(e.t * 100).toFixed(0)}%` : ''}`;
  return `${element?.name ?? '?'} · ${where}`;
};

/* ------------------------------------------------------------ profile */

/**
 * Показывать недостижимые записи профиля. Выбор человека, а не модели,
 * поэтому он живёт в панели и переживает перерисовку, но не перезагрузку:
 * по умолчанию список полный — 304 строки, как профиль, — а «показывать
 * недостижимые» снято, если человек хочет видеть только применимое.
 */
let showUnreachable = true;

/** Подпись одной строки профиля: канон виден, псевдоним и причина — в title. */
function profileRowTitle(s, reach) {
  const parts = [`Расширяет: ${s.baseTypes.join(', ') || '—'}.`];
  if (s.keywordAliases?.length) {
    // Каноническое имя остаётся в строке, псевдоним ключевого слова — здесь:
    // так `include` не приходится писать как ключевое слово, чтобы его найти.
    parts.push(`Псевдоним: ${s.keywordAliases.join(', ')}.`);
  }
  const lost = reach.unreachableBaseTypes(s);
  if (!reach.isReachable(s)) {
    // Пробел нотации (шесть метаклассов UML) называется своим именем: это не
    // чужая запись и не строка члена, а вида, которого у нас нет. Сказать
    // «недостижим» и не сказать «почему» — то же, что спрятать.
    const gap = lost.some((b) => gapFamily(b) !== '');
    parts.push(`Недостижим: ${reach.why(s).join('; ')}.${gap ? ' Это пробел нашей нотации, а не чужая запись.' : ''}`);
  } else if (lost.length) {
    parts.push(`Недостижимы расширения: ${lost.join(', ')}.`);
  }
  parts.push('Клик назначит стереотип выделенному элементу или связи');
  return parts.join(' ');
}

/** Наш пробел нотации (шесть метаклассов UML) — в отличие от чужой записи. */
const gapFamily = (baseType) => (NOTATION_GAPS.element.includes(baseType)
  ? 'UML-элемент'
  : NOTATION_GAPS.connector.includes(baseType) ? 'UML-связь' : '');

export function renderProfile() {
  const host = document.getElementById('profile');
  clear(host);
  const p = store.profile;
  const badge = document.getElementById('stcount');
  if (badge) badge.textContent = p ? String(p.count) : '!';

  if (!p) {
    host.append(el('div', { class: 'empty', text: 'Профиль profile/stereotypes.json не загружен. Файл лежит рядом с приложением.' }));
    return;
  }

  const reach = p.reachability ?? reachabilityOf(p);
  const st = reach.stereotypes;
  const defs = reach.definitions;
  // Сводка отвечает на вопрос «что из этого профиля я вообще могу применить».
  // Единиц две, и их нельзя смешивать: 304 — строки списка (стереотипы),
  // 407 — расширения (имя × baseType). Число исходных записей профиля (428)
  // приложение не знает: в профиле лежит уже сведённый результат.
  const summary = el('div', {
    class: 'pf-count',
    id: 'pf-summary',
    text: `${st.total} стереотипа · ${st.reachable} достижимы · ${st.entirelyUnreachable} недостижимы`,
    title: 'Стереотип достижим, если хоть одно его расширение (baseType) есть в таблице '
      + 'применимости «вид элемента или связи → метакласс».',
  });
  const byFamily = st.unreachableByFamily ?? {};
  const family = (names) => names.reduce((n, name) => n + (byFamily[name] ?? 0), 0);
  const foreign = family(['BMM', 'ArchiMate', 'SysML']);
  const members = family(['Attribute', 'Operation']);
  const gap = family(['UML-элемент', 'UML-связь']);
  const detail = el('div', {
    class: 'pf-count',
    id: 'pf-reachability',
    text: `расширений ${defs.total}: ${defs.reachable} достижимы, ${defs.unreachable} нет`
      + `${st.partlyReachable ? ` · ${st.partlyReachable} стереотипов достижимы частично` : ''}`,
    title: 'Расширение — пара «стереотип + baseType»; у части стереотипов применима лишь '
      + 'часть расширений. '
      + `Из ${st.entirelyUnreachable} недостижимых целиком: ${foreign} — чужая нотация `
      + `(BMM, ArchiMate, SysML), ${members} — строки членов (Attribute, Operation), `
      + `${gap} — метаклассы, которых нет в нашей нотации.`,
  });

  const toggle = el('input', {
    type: 'checkbox',
    id: 'pf-show-unreachable',
    checked: showUnreachable ? true : null,
    'aria-label': 'Показывать недостижимые стереотипы',
  });
  toggle.addEventListener('change', () => { showUnreachable = toggle.checked; rebuild(); });
  const toggleRow = el('label', {
    class: 'checkrow',
    for: 'pf-show-unreachable',
    title: 'Недостижимые — у них ни одного расширения с видом в нотации: чужая нотация '
      + '(BMM, ArchiMate, SysML), строки членов (Attribute, Operation) и метаклассы, '
      + 'которых в нотации нет.',
  }, toggle, el('span', { text: 'показывать недостижимые' }));

  const search = el('input', { type: 'text', placeholder: `Поиск по ${p.count} стереотипам…`, 'aria-label': 'Поиск по стереотипам' });
  const list = el('div');
  const count = el('div', { class: 'pf-count' });
  host.append(summary, detail, toggleRow, search, count, list);

  const rebuild = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    // Один пункт на стереотип, а не на baseType: у `entity` пять расширений,
    // и пять одинаковых строк в списке — это тот самый дефект, который
    // канонизация убрала. Группа — первый baseType записи.
    const groups = groupedByBaseType(p);
    let shown = 0;
    const used = usedStereotypes();
    for (const g of groups) {
      const items = g.items.filter((s) => {
        if (q && !(s.name.toLowerCase().includes(q)
          || s.aliases.some((a) => a.toLowerCase().includes(q))
          || (s.keywordAliases ?? []).some((a) => a.toLowerCase().includes(q))
          || s.baseTypes.some((b) => b.toLowerCase().includes(q))
          || s.documentation.toLowerCase().includes(q))) return false;
        return showUnreachable || reach.isReachable(s);
      });
      if (!items.length) continue;
      shown += items.length;
      list.append(el('div', { class: 'pf-group', text: `${g.baseType} (${items.length})` }));
      for (const s of items) {
        const reachable = reach.isReachable(s);
        list.append(el('div', {
          class: `pf-item${used(s) ? ' used' : ''}${reachable ? '' : ' unreachable'}`,
          // Серый — только цветом строки: у недостижимой записи остаются имя и
          // клик, потому что применить её всё равно можно, а
          // врёт пусть не панель, а метакласс.
          style: reachable ? null : { opacity: '0.55' },
          'data-stereotype': s.name,
          'data-stereotype-id': s.id,
          'data-base-type': s.baseTypes[0] ?? '',
          'data-reachable': reachable ? 'yes' : 'no',
          title: profileRowTitle(s, reach),
          onclick: () => {
            const target0 = selectedElement();
            if (!target0) { set({ hint: 'Сначала выделите фигуру или связь.' }); return; }
            const kind = selectionKind();
            commit('Правка стереотипа', (m) => {
              // Имя и ссылка пишутся вместе: имя рисуется на листе, ссылка
              // говорит, какая именно запись профиля имелась в виду.
              if (kind === 'shape') {
                const shape = findShape(m, target0.id);
                const element = elementOf(m, shape);
                if (element) { element.stereotype = s.name; element.stereotypeId = s.id; }
              } else {
                const link = findLink(m, target0.id);
                const rel = relOf(m, link);
                if (rel) { rel.stereotype = s.name; rel.stereotypeId = s.id; }
              }
            });
            set({ hint: `Стереотип «${s.name}» назначен.` });
          },
        },
        el('div', { class: 'pf-name', text: s.name }),
        s.baseTypes.length > 1
          ? el('div', { class: 'pf-doc', text: `расширяет: ${s.baseTypes.join(' · ')}` })
          : null,
        s.documentation ? el('div', { class: 'pf-doc', text: s.documentation }) : null));
      }
    }
    if (q) count.textContent = `Найдено: ${shown}`;
    else if (showUnreachable) count.textContent = `Все ${p.count} ${plural(p.count, 'стереотип', 'стереотипа', 'стереотипов')}, один пункт на стереотип`;
    else count.textContent = `Показано ${shown} из ${p.count}: недостижимые скрыты`;
  };
  search.addEventListener('input', rebuild);
  rebuild();
}

/**
 * Отмечен ли стереотип записи уже использованным в модели. Сравнение идёт по
 * разрешённой записи, а не по строке: у старого файла в модели лежит
 * `UseCase`, у профиля — `usecase`, и это один и тот же стереотип.
 */
function usedStereotypes() {
  const p = store.profile;
  const ids = new Set();
  const names = new Set();
  for (const item of [...store.model.elements, ...store.model.relationships]) {
    if (!item.stereotype && !item.stereotypeId) continue;
    const { record } = resolveStereotype(p, item);
    if (record) {
      ids.add(record.id);
      names.add(record.name);
    } else if (item.stereotype) {
      names.add(item.stereotype);
    }
  }
  return (s) => ids.has(s.id) || names.has(s.name);
}

/* ----------------------------------------------------------- statusbar */

const ZOOM_PRESETS = [50, 75, 100, 125, 150];

function zoomControl() {
  const wrap = el('div', { class: 'zoom-wrap' });
  const btn = el('button', {
    type: 'button', class: 'zoom-btn', id: 'sb-zoom',
    'aria-haspopup': 'menu', 'aria-label': 'Масштаб, открыть меню',
    title: 'Масштаб: 50 / 75 / 100 / 125 / 150 %, вписать (Ctrl+0)',
  },
  el('span', { id: 'sb-zoom-val', text: '100%' }),
  el('span', { 'aria-hidden': 'true' }, icon('ui-chevron-down', 10)));

  const close = () => wrap.querySelector('.zoom-pop')?.remove();

  const open = () => {
    close();
    const pop = el('div', { class: 'zoom-pop', role: 'menu', 'aria-label': 'Масштаб' });
    const now = store.ui.view.scale * 100;
    for (const p of ZOOM_PRESETS) {
      const on = Math.abs(now - p) < 0.5;
      pop.append(el('button', {
        type: 'button', role: 'menuitemradio', 'aria-checked': on ? 'true' : 'false',
        onclick: () => { setZoom(p / 100); close(); renderStatus(); },
      },
      el('span', { class: 'check', text: on ? '✓' : '' }),
      el('span', { text: `${p} %` })));
    }
    pop.append(el('hr'));
    const empty = !(currentDiagram(store.model)?.shapes.length);
    pop.append(el('button', {
      type: 'button', role: 'menuitem', disabled: empty,
      title: empty ? 'на листе нет фигур' : 'Масштаб по границам модели',
      onclick: () => { fitToWindow(); close(); renderStatus(); },
    },
    el('span', { class: 'check', text: '' }),
    el('span', { text: 'Вписать в окно' }),
    el('span', { class: 'key', text: 'Ctrl+0' })));
    wrap.append(pop);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wrap.querySelector('.zoom-pop')) close();
    else open();
  });
  document.addEventListener('click', close);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  wrap.append(btn);
  return wrap;
}

export function renderStatus() {
  const host = document.getElementById('statusbar');
  if (!host) return;
  if (!host.dataset.ready) {
    clear(host);
    host.append(
      el('span', { class: 'hint', id: 'sb-hint' }),
      el('span', { class: 'sb-item', id: 'sb-sel' }),
      zoomControl(),
      el('span', { class: 'sb-item', id: 'sb-coords', text: '—' }),
      el('span', { class: 'sb-item', id: 'sb-count' }),
      el('button', {
        type: 'button',
        class: 'sb-item sb-link',
        id: 'sb-checks',
        title: 'Проверки: UML 2.5.1 и практика моделирования — открыть панель',
        onclick: () => openChecksPanel(),
      }, 'проверки: 0 · 0'),
      el('span', { class: 'sb-item', id: 'sb-profile' }),
    );
    host.dataset.ready = '1';
  }
  const m = store.model;
  const d = currentDiagram(m);
  const hint = host.querySelector('#sb-hint');
  // Записка о восстановлении стоит выше обычного «есть несохранённые»: пока
  // документ не тронут, именно она объясняет, откуда он взялся, и не даёт
  // подсказке прыгать на первом же клике по листу.
  const hint2 = store.ui.hint || store.ui.restoreNote
    || (store.ui.dirty ? 'Есть несохранённые изменения' : '');
  hint.textContent = hint2;
  hint.title = hint2;
  const sel = store.ui.selection;
  const selIt = selectedElement();
  let selText = '';
  if (selIt) {
    if (sel[0].kind === 'shape') {
      const element = elementOf(m, selIt);
      selText = `${NOTATION.shapes[element?.kind]?.label ?? 'Фигура'}: ${element?.name || element?.stereotype || '(без имени)'}`;
    } else {
      const rel = relOf(m, selIt);
      selText = `${NOTATION.connectors[rel?.kind]?.label ?? 'Связь'}: ${rel?.name || rel?.stereotype || '(без имени)'}`;
    }
  } else if (sel.length > 1) {
    const shapes = sel.filter((s) => s.kind === 'shape').length;
    const links = sel.length - shapes;
    selText = `выделено: ${[shapes ? `фигур ${shapes}` : '', links ? `связей ${links}` : ''].filter(Boolean).join(', ')}`;
  }
  host.querySelector('#sb-sel').textContent = selText;
  const pct = `${Math.round(store.ui.view.scale * 100)}%`;
  const val = host.querySelector('#sb-zoom-val');
  if (val) val.textContent = pct;
  const zoomBtn = host.querySelector('#sb-zoom');
  if (zoomBtn) zoomBtn.setAttribute('aria-label', `Масштаб ${pct}, открыть меню`);
  host.querySelector('#sb-count').textContent =
    `элементы ${m.elements.length} · фигуры ${d?.shapes.length ?? 0} · связи ${d?.links.length ?? 0}`;
  host.querySelector('#sb-profile').textContent = store.profile
    ? `профиль: ${store.profile.count} ${plural(store.profile.count, 'стереотип', 'стереотипа', 'стереотипов')}`
    : 'профиль: не загружен';
  // Счётчик проверок считает тот же прогон, что и панель, — цифры не расходятся.
  renderChecksStatus();
}
