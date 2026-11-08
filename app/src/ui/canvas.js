// The editing canvas: hit testing, dragging, connecting, inline editing,
// pan and zoom.
//
// `uml-model/3`: shapes carry geometry and an elementId; relationships live in
// the model and a diagram holds LINK VIEWS of them. The canvas therefore
// resolves the element before it measures a shape, and the relationship before
// it edits a connector's name or stereotype — so an edit on one diagram is
// visible on every diagram that shows the same relationship.
//
// A sequence message is horizontal: its order is its y, so dragging it up and
// down reorders the interaction and renumbers the messages.

import { svgEl, el, clear, clamp, rafThrottle, distToPolyline } from '../util.js';
import { NOTATION } from '../model/notation.js';
import {
  layoutOf, edgePoint, endPoint, linkPoints, labelPos, sideAndT, LINE_H, PAD_Y, textWidth as tw,
  LIFELINE_HEAD, MESSAGE_GAP,
} from '../model/geometry.js';
import {
  findShape, findLink, findElement, findDiagram, elementOf, currentDiagram, placeElement,
  createRelationship, createLink, moveShape, resizeShape, removeShape, removeLink,
  removeElement, removeRelationship, setMemberRow, memberLines, addMemberRow,
  setLine, relOf, findRelationship, showElement, messageOrder,
} from '../model/model.js';
import { renderDiagram, polylinePath, modelBounds } from './render.js';
import {
  store, set, commit, mutate, beginDrag, endDrag, emit, modelRevision,
  isSelected, toggleSelection, selectOnly, selectionKind,
} from '../state/store.js';
import { MECHANICS } from '../mechanics.generated.js';
import { routeOfLink, selfRuleOf, selfRuleOfRelationship, selfRefusal, SELF } from '../model/connector-style.js';
import { parallelOffsets, parallelEnds } from '../model/parallel-links.js';
import { openContextMenu } from './context-menu.js';
import { stickyTool } from './toolstrip.js';

// The grid pitch is the program's own: two separate fields, HorizontalGridSize
// (EM) and VerticalGridSize (EL), both 10 in the factory defaults —
// vpplatform.jar!v/dap/r#<init>+0x0118 / +0x0112 (MECHANICS §1c). Keeping them
// apart is what lets a sheet have a rectangular grid; snapping follows
// AlignToGrid (v/dap/r#a(Z)), which the packaged first-run preferences turn on.
const SNAP_X = MECHANICS.gridWidth;
const SNAP_Y = MECHANICS.gridHeight;
const SNAP = SNAP_X;                      // legacy name: square grids read the same
const snapTo = (v, pitch) => (MECHANICS.alignToGrid ? Math.round(v / pitch) * pitch : Math.round(v));
const ARROW_GRAB = 7;      // how near a connector's route selects it
const LABEL_GRAB = 14;     // how near its label starts a label drag
const HND = 9;             // handle size
// Самосвязь рождается только осознанным жестом: указатель должен отойти от
// исходной фигуры не меньше чем на 24 px и вернуться. Иначе обычный клик
// инструментом связи на фигуре создавал бы петлю вместо ожидания второй цели.
const SELF_AWAY = 24;
// Два конца одной петли на одной стороне разводятся не меньше чем на 0.2 по
// `t` — иначе петля выродится в точку (в 4103 это 0.3 и 0.7).
const SELF_MIN_T = 0.2;

let root, viewport, gridLayer, sheetLayer, marksLayer, overlayLayer, wrap, editor, editorInput, editorState = null;
// Маркеры замечаний — отдельный слой между листом и оверлеем. Оверлей
// очищается на каждом движении указателя (renderOverlay), поэтому маркеры там
// мигали бы; здесь они переживают и выделение, и перетаскивание.
let marks = [];            // [{ kind: 'shape'|'connector'|'model', id, findings }]
let marksDiagramId = null; // лист, для которого построены marks
let markClick = null;      // что делать по клику (ставит checks.js)
let markTipEl = null;      // одна подсказка на всё приложение
let marksScale = 0;        // масштаб, под который посчитаны размеры маркеров
let textRectsCache = null; // надписи листа на одну перерисовку маркеров
let hover = null;          // shape under the cursor while a connector is armed
let drag = null;           // active drag descriptor
// The shape a connector end would land on right now (§7.5, draw.io's
// mxCellMarker). Pure UI: it is drawn in the overlay, never written to the
// model, and never recorded in the undo history.
let dropTarget = null;
let segCursorEl = null;    // the line whose cursor says «this segment moves»

/** Layout of a shape, with the element that owns its content. */
const lyt = (s) => layoutOf(s, elementOf(store.model, s));
const elOf = (s) => elementOf(store.model, s);
const isSequence = () => NOTATION.connectors[currentDiagram(store.model)?.links?.[0]?.kind]?.sequence
  || currentDiagram(store.model)?.kind === 'sequence';

/* ------------------------------------------------------------ the frame */

let frameCache = null;

/** Effective layouts of all shapes on the current diagram, cached per revision. */
function frame() {
  const rev = modelRevision();
  if (!frameCache || frameCache.rev !== rev || frameCache.model !== store.model) {
    const map = new Map();
    for (const s of currentDiagram(store.model)?.shapes ?? []) {
      const element = elementOf(store.model, s);
      if (element) map.set(s.id, layoutOf(s, element));
    }
    frameCache = { rev, model: store.model, map };
  }
  return frameCache.map;
}

export function initCanvas() {
  root = document.getElementById('canvas');
  wrap = document.getElementById('canvas-wrap');
  editor = document.getElementById('inline-editor');
  editorInput = editor.querySelector('input');

  viewport = svgEl('g', { id: 'viewport' }, root);
  gridLayer = svgEl('g', { id: 'gridlayer' }, viewport);
  sheetLayer = svgEl('g', { id: 'sheetlayer' }, viewport);
  marksLayer = svgEl('g', { id: 'markslayer' }, viewport);
  overlayLayer = svgEl('g', { id: 'overlaylayer' }, viewport);

  const defs = svgEl('defs', {}, root);
  const pattern = svgEl('pattern', {
    id: 'grid-pattern', width: SNAP_X, height: SNAP_Y, patternUnits: 'userSpaceOnUse',
  }, defs);
  // Цвет сетки — постоянная листа (#c0c0c0, mechanics.json) и
  // остаётся ею в светлой теме. В тёмной он был бы единственной светлой
  // решёткой на тёмном листе, поэтому цвет ушёл в токен --grid-line: значение
  // то же, но у темы есть свой (styles.css). Толщина по-прежнему из записи.
  svgEl('path', {
    d: `M ${SNAP_X} 0 H 0 V ${SNAP_Y}`, fill: 'none',
    class: 'grid-line', 'stroke-width': 1,
  }, pattern);

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  // Подсказка маркера — свой лёгкий слой, а не store.ui.hint: подсказка в
  // статусбаре идёт через `set`, то есть перерисовывала бы весь лист на каждом
  // наведении. Здесь DOM не трогает ни модель, ни store.
  root.addEventListener('pointerover', onMarkOver);
  root.addEventListener('pointerout', onMarkOut);
  root.addEventListener('pointerleave', hideMarkTip);
  // A release outside the sheet (or a browser-level cancel) must end the
  // gesture too — otherwise a drop-target frame would stay behind after the
  // button is already up. The root handlers run first for events on the
  // sheet; by then `drag` is null and these calls do nothing.
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !drag) return;
    drag = null;
    hover = null;
    dropTarget = null;
    renderOverlay();
  });
  window.addEventListener('blur', () => {
    if (!drag && !dropTarget) return;
    drag = null;
    hover = null;
    dropTarget = null;
    renderCanvas();
  });
  root.addEventListener('dblclick', onDoubleClick);
  root.addEventListener('mousedown', onDoubleClickDown);
  root.addEventListener('wheel', onWheel, { passive: false });
  // Правый клик — меню, а не тишина: до этой правки `contextmenu` просто
  // гасился, и в пособии не работал ни один из 70 советов «правый клик → …».
  // Выделение здесь не трогается: его решает onContextMenu.
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('mousedown', (e) => e.preventDefault());
  window.addEventListener('resize', applyTransform);

  // A model-tree row dragged onto the sheet puts a VIEW of that element here
  // (plan 3.4). The payload is the element id, nothing else: the sheet decides
  // whether to draw a new view or to point at the one that is already there.
  wrap.addEventListener('dragover', onDragOver);
  wrap.addEventListener('dragleave', () => { dropPoint = null; renderOverlay(); });
  wrap.addEventListener('drop', onDrop);
}

/** The drag type the model tree writes; a file drop never carries it. */
export const DND_ELEMENT = 'application/x-uml-element';

let dropPoint = null;

function carriesElement(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes(DND_ELEMENT);
}

function onDragOver(e) {
  if (!carriesElement(e)) return;         // a file drop keeps its own handler
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropPoint = toModel(e);
  renderOverlay();
}

function onDrop(e) {
  const id = e.dataTransfer?.getData(DND_ELEMENT);
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  dropPoint = null;
  const element = findElement(store.model, id);
  if (!element) { renderOverlay(); return; }
  const pt = toModel(e);
  const d = currentDiagram(store.model);
  const def = NOTATION.shapes[element.kind];
  const w = def?.defaultSize.w ?? 190;
  const h = def?.defaultSize.h ?? 120;
  const x = snapTo(pt.x - w / 2, SNAP_X);
  const y = snapTo(pt.y - h / 2, SNAP_Y);

  // Already on this sheet? Do not duplicate the view — show the one there is.
  const shown = d?.shapes.find((s) => s.elementId === element.id);
  if (shown) {
    set({
      selection: [{ kind: 'shape', id: shown.id }],
      hint: `«${element.name}» уже показан на этом листе — подсвечен, второй вид не создан.`,
    });
    renderCanvas();
    flashShape(shown.id);
    return;
  }

  const shape = commit('Поставить элемент на диаграмму', (m) => {
    const target = findElement(m, element.id);
    return target ? showElement(m, target, x, y) : null;
  });
  if (shape) {
    set({
      selection: [{ kind: 'shape', id: shape.id }],
      hint: `«${element.name}» поставлен на лист — это вид элемента модели, не копия.`,
    });
    renderCanvas();
    flashShape(shape.id);
  }
}

/* ------------------------------------------------------- coordinates */

export function toModel(e) {
  const r = root.getBoundingClientRect();
  const { scale, tx, ty } = store.ui.view;
  return { x: (e.clientX - r.left - tx) / scale, y: (e.clientY - r.top - ty) / scale };
}

const applyTransform = () => {
  // Подсказка привязана к экранному месту бейджа: после сдвига или масштаба
  // она оказалась бы не над ним. Пусть лучше закроется — откроется снова.
  hideMarkTip();
  const { scale, tx, ty } = store.ui.view;
  viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
  // Размер маркера задан в экранных точках, поэтому при смене масштаба его надо
  // пересчитать. Сравнение по масштабу, а не по любому вызову: панорамирование
  // зовёт applyTransform на каждом движении указателя, а перерисовка маркеров
  // на pointermove — ровно то, чего быть не должно.
  //
  // ПОСЛЕ установки transform: свободный угол под бейдж у мелкой фигуры
  // выбирается по прямоугольникам надписей листа, а они читаются из DOM в
  // экранных координатах. Померяй их до сдвига — и бейдж встанет на имя,
  // которого там уже нет (или наоборот).
  if (marks.length && scale !== marksScale) renderMarks();
  const zoom = document.getElementById('sb-zoom-val');
  if (zoom) zoom.textContent = `${Math.round(scale * 100)}%`;
};

export function fitToWindow() {
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const b = modelBounds(currentDiagram(store.model), store.model, 40);
  const scale = clamp(Math.min((r.width - 60) / b.w, (r.height - 60) / b.h), 0.15, 3);
  store.ui.view = {
    scale,
    tx: (r.width - b.w * scale) / 2 - b.x * scale,
    ty: (r.height - b.h * scale) / 2 - b.y * scale,
  };
  applyTransform();
}

export function setZoom(scale) {
  const v = store.ui.view;
  const r = wrap.getBoundingClientRect();
  const f = clamp(scale, 0.15, 4) / v.scale;
  const cx = r.width / 2;
  const cy = r.height / 2;
  store.ui.view = { scale: clamp(scale, 0.15, 4), tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
  applyTransform();
}

export function zoomBy(factor) {
  const v = store.ui.view;
  const r = wrap.getBoundingClientRect();
  const cx = r.width / 2;
  const cy = r.height / 2;
  const next = clamp(v.scale * factor, 0.15, 4);
  const f = next / v.scale;
  store.ui.view = { scale: next, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
  applyTransform();
}

/**
 * Границы вида на листе в координатах модели: у фигуры — её рамка, у связи —
 * объединение рамок двух концов (сама линия живёт между ними и ничего своего
 * не занимает). `null`, если вида на этом листе нет.
 */
function viewBounds(diagram, model, view) {
  const shapes = diagram?.shapes ?? [];
  if (view.kind === 'shape') {
    const s = shapes.find((x) => x.id === view.id);
    if (!s) return null;
    const { w, h } = layoutOf(s, elementOf(model, s));
    return { x: s.x, y: s.y, w, h };
  }
  const l = (diagram?.links ?? []).find((x) => x.id === view.id);
  if (!l) return null;
  const ends = [l.from?.shapeId, l.to?.shapeId]
    .map((id) => shapes.find((s) => s.id === id))
    .filter(Boolean);
  if (!ends.length) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const s of ends) {
    const { w, h } = layoutOf(s, elementOf(model, s));
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + w); y1 = Math.max(y1, s.y + h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Поставить вид в центр видимой части листа — так переход от замечания
 * показывает виноватый объект, а не просто открывает нужный лист.
 *
 * Масштаб здесь не понижается: объект должен остаться читаемым, поэтому вид,
 * уменьшенный до `minScale` и меньше, поднимается до неё (потолок — те же 4,
 * что у `setZoom`). Уже крупный вид не трогается вовсе: иначе переход из
 * приближённого вида «отпрыгивал» бы назад при каждом клике по замечанию.
 *
 * @param {{kind: 'shape'|'connector', id: string}} view вид на листе
 * @param {{diagramId?: string|null, minScale?: number}} [opts] лист (по
 *   умолчанию текущий) и наименьший допустимый масштаб
 */
export function centerOn(view, { diagramId = null, minScale = 0.6 } = {}) {
  if (!wrap || !view) return;
  const model = store.model;
  const d = diagramId ? findDiagram(model, diagramId) : currentDiagram(model);
  const b = viewBounds(d, model, view);
  if (!b) return;
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cur = store.ui.view.scale || 1;
  const scale = cur < minScale ? clamp(minScale, 0.15, 4) : cur;
  store.ui.view = {
    scale,
    tx: r.width / 2 - (b.x + b.w / 2) * scale,
    ty: r.height / 2 - (b.y + b.h / 2) * scale,
  };
  applyTransform();
}

export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5];

export function zoomStep(dir) {
  const cur = store.ui.view.scale;
  const eps = 1e-3;
  const next = dir > 0
    ? ZOOM_PRESETS.find((p) => p > cur + eps)
    : [...ZOOM_PRESETS].reverse().find((p) => p < cur - eps);
  if (next == null) return false;
  setZoom(next);
  return true;
}

function onWheel(e) {
  e.preventDefault();
  const v = store.ui.view;
  const r = root.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  const factor = Math.pow(1.1, e.deltaY > 0 ? -1 : 1);
  const next = clamp(v.scale * factor, 0.15, 4);
  const f = next / v.scale;
  store.ui.view = { scale: next, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
  applyTransform();
}

/* ------------------------------------------------------------- render */

export function renderCanvas() {
  applyTransform();
  renderGrid();
  renderDiagram(sheetLayer, currentDiagram(store.model), store.model, store.profile);
  renderOverlay();
}

function renderGrid() {
  clear(gridLayer);
  if (!store.ui.showGrid) return;
  svgEl('rect', {
    x: -20000, y: -20000, width: 40000, height: 40000, fill: 'url(#grid-pattern)',
  }, gridLayer);
}

function modelToScreen(x, y) {
  const { scale, tx, ty } = store.ui.view;
  return { left: x * scale + tx, top: y * scale + ty };
}

function renderOverlay() {
  clear(overlayLayer);
  // Во время перетаскивания маркеры не пересчитываются (это pointermove, а не
  // commit), и без этого бейдж оторвался бы от фигуры и повис на старом месте.
  // Прятать дешевле, чем пересчитывать: один класс, а не перерисовка слоя.
  marksLayer?.classList.toggle('dragging', !!drag && drag.moved === true);
  const s = store.ui.view.scale || 1;
  const hs = HND / s;
  const sw = 1.4 / s;
  const sel = store.ui.selection;
  const shapes = sel.filter((x) => x.kind === 'shape');
  const conns = sel.filter((x) => x.kind === 'connector');

  // Every selected shape gets the dashed frame; the resize handles belong to a
  // single-shape selection — eight handles on a group would lie about what
  // they resize.
  for (const item of shapes) {
    const sh = findShape(store.model, item.id);
    if (!sh) continue;
    const { w, h } = lyt(sh);
    svgEl('rect', {
      x: sh.x - 1, y: sh.y - 1, width: w + 2, height: h + 2,
      fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.2 / s, 'stroke-dasharray': `${4 / s} ${3 / s}`,
      'data-sel': sh.id,
    }, overlayLayer);
  }
  if (shapes.length === 1) {
    const sh = findShape(store.model, shapes[0].id);
    if (sh) {
      const { w, h } = lyt(sh);
      for (const [dx, dy, name] of [[0, 0, 'nw'], [1, 0, 'ne'], [0, 1, 'sw'], [1, 1, 'se']]) {
        svgEl('rect', {
          x: sh.x + w * dx - hs / 2, y: sh.y + h * dy - hs / 2,
          width: hs, height: hs, class: 'hnd', 'data-resize': name,
          'data-kind': 'handle', 'data-id': sh.id, 'stroke-width': sw,
        }, overlayLayer);
      }
    }
  }
  for (const item of conns) {
    const l = findLink(store.model, item.id);
    if (!l) continue;
    for (const endName of ['from', 'to']) {
      const e = l[endName];
      const sh = findShape(store.model, e.shapeId);
      if (!sh) continue;
      const p = endPoint(sh, lyt(sh), e, l.entryPerimeter === true);
      svgEl('rect', {
        x: p.x - hs / 2, y: p.y - hs / 2, width: hs, height: hs,
        class: 'endh', 'data-kind': 'end', 'data-end': endName, 'data-id': l.id, 'stroke-width': sw,
      }, overlayLayer);
    }
    // Bend points belong to the SELECTED connector only: 6×6 squares on the
    // sheet, the accent token, nothing else. A sheet where every bend shows a
    // handle reads as a mesh of squares.
    const wp = Array.isArray(l.waypoints) ? l.waypoints : [];
    wp.forEach((p, i) => {
      const on = store.ui.wp && store.ui.wp.linkId === l.id && store.ui.wp.index === i;
      svgEl('rect', {
        x: p[0] - 3, y: p[1] - 3, width: 6, height: 6,
        class: `conn-wp${on ? ' on' : ''}`,
        'data-kind': 'wp', 'data-id': l.id, 'data-idx': String(i),
        'stroke-width': sw,
      }, overlayLayer);
    });
  }
  if (drag?.type === 'lasso') {
    const a = drag.start;
    const b = drag.pt ?? drag.start;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    svgEl('rect', {
      x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
      class: 'lasso', 'stroke-width': 1 / s, 'stroke-dasharray': `${4 / s} ${3 / s}`,
    }, overlayLayer);
  }
  if (dropPoint) {
    svgEl('rect', {
      x: dropPoint.x - 95, y: dropPoint.y - 60, width: 190, height: 120, class: 'dropzone',
    }, overlayLayer);
  }
  if (drag?.type === 'conn-end') {
    const l = findLink(store.model, drag.id);
    if (l) {
      const other = l[drag.end === 'from' ? 'to' : 'from'];
      const sh = findShape(store.model, other.shapeId);
      if (sh) {
        const p = endPoint(sh, lyt(sh), other, l.entryPerimeter === true);
        svgEl('path', { class: 'ghost', d: `M ${p.x} ${p.y} L ${drag.pt.x} ${drag.pt.y}` }, overlayLayer);
      }
    }
  }

  const p = store.ui.pending;
  if (p) {
    const sh = findShape(store.model, p.from.shapeId);
    if (sh) {
      const from = endPoint(sh, lyt(sh), p.from);
      const to = hover && hover.id !== sh.id
        ? anchorTowards(sh, hover)
        : (p.cursor ? [p.cursor.x, p.cursor.y] : [from.x, from.y]);
      svgEl('path', {
        class: 'ghost',
        d: `M ${from.x} ${from.y} L ${Array.isArray(to) ? to[0] : to.x} ${Array.isArray(to) ? to[1] : to.y}`,
      }, overlayLayer);
      // Пока связь ещё не тянут мышью (pending без активного жеста), остаётся
      // прежняя пунктирная подсказка: сплошная рамка drop-target принадлежит
      // самому протягиванию и без него не рисуется.
      if (hover && !drag) {
        const hw = lyt(hover);
        svgEl('rect', {
          x: hover.x, y: hover.y, width: hw.w, height: hw.h,
          fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.2, 'stroke-dasharray': '6 4',
        }, overlayLayer);
      }
    }
  }
  if (!p && hover && isConnectorTool(store.ui.tool)) {
    const hw = lyt(hover);
    svgEl('rect', {
      x: hover.x, y: hover.y, width: hw.w, height: hw.h,
      fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.2, 'stroke-dasharray': '6 4',
    }, overlayLayer);
  }

  // Кандидат-цель протягивания (§7.5, §8 п.7): тонкая рамка ровно вокруг
  // фигуры, которую вернул targetAt, — то есть той, к которой связь
  // подключится, если отпустить кнопку. Когда под курсором пустая область
  // рамки, targetAt уже отдаёт рамку, и подсвечена будет она же.
  //
  // Отдельный класс, а не выделение: фигура не выбирается, инспектор не
  // открывается, в историю отмены ничего не пишется. Толщина постоянная в
  // экранных точках (как у рамки выделения), цвет — существующий акцент.
  if (dropTarget && drag && (drag.type === 'conn-draw' || drag.type === 'conn-end')) {
    const hw = lyt(dropTarget);
    svgEl('rect', {
      x: dropTarget.x, y: dropTarget.y, width: hw.w, height: hw.h,
      class: 'drop-target', 'stroke-width': 1.2 / s, 'data-drop-target': dropTarget.id,
    }, overlayLayer);
  }
}

/* ------------------------------------------------------------ finding marks */

/**
 * Отдать слою маркеров замечания, посчитанные в checks.js.
 *
 * Маркеры живут вне `renderOverlay()` намеренно: оверлей чистится на каждом
 * движении указателя, а маркеры обязаны переживать и выделение, и перетаскивание.
 * `diagramId` — лист, для которого список построен: если лист уже сменился,
 * старые маркеры не рисуются (иначе они повисли бы в координатах чужого листа).
 */
export function setFindingMarks(list, { diagramId = null, onClick = null } = {}) {
  marks = Array.isArray(list) ? list : [];
  marksDiagramId = diagramId;
  markClick = typeof onClick === 'function' ? onClick : null;
  renderMarks();
}

/**
 * Перерисовать маркеры. Зовётся не из renderCanvas, а из checks.js по
 * commit/смене листа/новому прогону: во время перетаскивания (mutate → light)
 * лист перерисовывается каждый кадр, а маркеры — нет, поэтому они не тормозят
 * жест. После отпускания кнопки приходит обычный emit, и маркеры встают на
 * новые места.
 */
function renderMarks() {
  if (!marksLayer) return;
  clear(marksLayer);
  hideMarkTip();
  textRectsCache = null;
  if (!marks.length) return;
  const d = currentDiagram(store.model);
  if (!d || (marksDiagramId && d.id !== marksDiagramId)) return;
  // Размер маркера — в экранных точках: на 40 % бейдж 8 px остаётся читаемым,
  // как и ручки выделения, которые считаются той же формулой.
  const s = store.ui.view.scale || 1;
  marksScale = s;
  const r = 8 / s;
  const fs = 10 / s;
  marks.forEach((m, i) => {
    let p = null;
    if (m.kind === 'shape') {
      const sh = d.shapes.find((x) => x.id === m.id);
      if (!sh) return;
      const { w, h } = lyt(sh);
      // Отступ от угла — на ручку изменения размера: она стоит ровно в углу
      // и лежит в оверлее, то есть поверх маркера. Без запаса выделенная
      // фигура прятала бы свой же бейдж под квадратиком, а клик по нему
      // начинал бы ресайз.
      const inset = r + 5 / s;
      // Нижний правый угол: там нет ни имени (оно по центру), ни значка
      // стереотипа (он в верхнем правом), и маркер не закрывает подпись.
      const small = w < 48 || h < 48;
      // Мелкая на экране фигура — тоже повод вынести бейдж: он задан в
      // экранных точках, и на 40 % занимает внутри фигуры вчетверо больше
      // места, чем на 100 %, ложась на длинное имя варианта использования.
      const cramped = 2 * r > Math.min(w, h) * 0.25;
      p = small || cramped
        ? outsideSpot(sh, w, h, inset)
        : { x: sh.x + w - inset, y: sh.y + h - inset };
    } else if (m.kind === 'connector') {
      const l = (d.links ?? []).find((x) => x.id === m.id);
      if (!l) return;
      p = linkMarkPoint(l, r);
      if (!p) return;
    } else {
      // Замечание без вида на листе (модельное или «элемент не показан ни на
      // одной диаграмме»): один тихий бейдж в поле листа, а не потерянная
      // строка, которую на холсте не видно вовсе.
      const b = modelBounds(d, store.model, 40);
      p = { x: b.x + 12, y: b.y + 12 };
    }
    drawMark(i, m, p, r, fs);
  });
}

/**
 * Место бейджа у мелкой фигуры — за её рамкой, в первом свободном углу.
 *
 * У начального узла, перекрестия, порта и истории подпись занимает всю фигуру,
 * поэтому внутри угла бейджу места нет. Снаружи тоже бывает тесно: порт стоит
 * внутри пакета, и правый нижний угол приходится ровно на имя пакета. Поэтому
 * кандидатов четыре, и берётся первый, который не накрывает ни одной надписи
 * листа. Надписи читаются из DOM один раз на перерисовку маркеров и только
 * когда мелкая фигура на листе действительно есть — на обычном листе класс
 * этого запроса не делает.
 */
function outsideSpot(sh, w, h, inset) {
  const spots = [
    { x: sh.x + w + inset, y: sh.y + h + inset },   // правый нижний
    { x: sh.x - inset, y: sh.y + h + inset },       // левый нижний
    { x: sh.x - inset, y: sh.y - inset },           // левый верхний
    { x: sh.x + w + inset, y: sh.y - inset },       // правый верхний
  ];
  const rects = sheetTextRects();
  if (!rects.length) return spots[0];
  const { scale, tx, ty } = store.ui.view;
  const origin = root?.getBoundingClientRect();
  if (!origin) return spots[0];
  const hit = (p) => {
    const cx = origin.left + tx + p.x * scale;
    const cy = origin.top + ty + p.y * scale;
    const rad = 8;
    return rects.some((b) => cx + rad > b.left && cx - rad < b.right && cy + rad > b.top && cy - rad < b.bottom);
  };
  return spots.find((p) => !hit(p)) ?? spots[0];
}

/** Прямоугольники надписей листа — для выбора свободного угла под бейдж. */
function sheetTextRects() {
  if (textRectsCache) return textRectsCache;
  if (!sheetLayer) return [];
  textRectsCache = [...sheetLayer.querySelectorAll('text')].map((t) => t.getBoundingClientRect())
    .filter((b) => b.width > 0 && b.height > 0);
  return textRectsCache;
}

/** Середина нарисованной линии, сдвинутая в сторону от самой линии. */
function linkMarkPoint(link, r) {
  const pts = linkPointsOf(link);
  if (!pts || pts.length < 2) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  if (!total) return null;
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!len) continue;
    if (acc + len >= total / 2) {
      const t = (total / 2 - acc) / len;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      // 16 px запаса, а не 4: у подписи связи своя подложка высотой 3.5 pt, и
      // бейдж вплотную к линии садился прямо на неё (замер на d6: «дубль»).
      const off = r + 16 / (store.ui.view.scale || 1);
      // Горизонтальная линия — бейдж над ней, вертикальная — справа: так он не
      // ложится на штрих и на подпись связи.
      return Math.abs(x1 - x0) >= Math.abs(y1 - y0)
        ? { x, y: y - off }
        : { x: x + off, y };
    }
    acc += len;
  }
  return null;
}

/** Уровень бейджа: ошибка важнее предупреждения, совет — самый тихий. */
function markLevelOf(findings) {
  let level = 'practice';
  for (const f of findings) {
    if (f.basis === 'practice') continue;
    if (f.level === 'error') return 'error';
    if (f.level === 'warning') level = 'warning';
  }
  return level;
}

function drawMark(index, mark, p, r, fs) {
  const findings = mark.findings ?? [];
  const level = markLevelOf(findings);
  const count = findings.length;
  const g = svgEl('g', {
    class: `finding-mark ${level}`,
    'data-mark': String(index),
    'data-mark-kind': mark.kind,
    'data-mark-view': String(mark.id),
    'data-mark-level': level,
    'data-mark-count': String(count),
    'data-mark-rules': findings.map((f) => f.ruleId).join(' '),
    transform: `translate(${round3(p.x)} ${round3(p.y)})`,
  }, marksLayer);
  // Нативного <title> здесь нет намеренно. Он рисовал второй, чёрный тултип
  // поверх нашего: браузер склеивал все замечания маркера в одну строку, и
  // человек видел два разных ответа на один вопрос — «белую карточку» в панели
  // и «чёрную подпись» у бейджа. Имя для программ чтения экрана даёт
  // aria-label, а не всплывающая подсказка: она не должна дублировать текст.
  g.setAttribute('aria-label', findings.map((f) => `${f.ruleId}: ${f.message}`).join('; '));
  svgEl('circle', { class: 'finding-mark-dot', cx: 0, cy: 0, r }, g);
  svgEl('text', {
    class: 'finding-mark-count', x: 0, y: 0, 'font-size': fs,
    text: count > 9 ? '9+' : String(count),
  }, g);
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/* ------------------------------------------------ finding mark tooltip */

function markTip() {
  if (markTipEl && markTipEl.isConnected) return markTipEl;
  if (!wrap) return null;
  markTipEl = el('div', { id: 'mark-tip', class: 'mark-tip', role: 'tooltip', hidden: true });
  wrap.append(markTipEl);
  return markTipEl;
}

function hideMarkTip() {
  if (markTipEl) markTipEl.hidden = true;
}

/**
 * Подсказка маркера — опознание, а не объяснение.
 *
 * Здесь только то, что нужно, чтобы понять «что это за бейдж»: сколько
 * замечаний, какие правила и их короткие формулировки. Подробности — `detail`
 * («что нашлось именно здесь»), «где» и «что делать» — живут в карточке-паспорте
 * в панели, и подсказка на них не замахивается: иначе это была бы та же
 * карточка, только хуже — без перехода к объекту и без пункта стандарта.
 * `hint` сюда не попадает намеренно: это совет, а совет без контекста модели
 * читается как общее место и ровно поэтому дублировал карточку.
 */
function showMarkTip(index, anchor) {
  const mark = marks[index];
  if (!mark) return;
  const tip = markTip();
  if (!tip) return;
  clear(tip);
  const shown = mark.findings.slice(0, 3);
  const more = mark.findings.length - shown.length;
  shown.forEach((f, n) => {
    if (n) tip.append(el('div', { class: 'mark-tip-sep' }));
    tip.append(el('div', {
      class: 'mark-tip-rule',
      // Пункт есть только у стандарта; у практики и проекта его нет, и «п. —»
      // читалось бы как потерянные данные, а не как отсутствие пункта.
      text: f.basis === 'practice' ? `${f.ruleId} · практика`
        : f.basis === 'project' ? `${f.ruleId} · проект`
          : `${f.ruleId} · п. ${f.clause ?? '—'}`,
    }));
    tip.append(el('div', { class: 'mark-tip-msg', text: f.message }));
  });
  if (more > 0) tip.append(el('div', { class: 'mark-tip-more', text: `и ещё ${more}` }));
  // Подсказка называет, куда идти за подробностями, а не пересказывает их.
  tip.append(el('div', { class: 'mark-tip-foot', text: 'Клик — паспорт ошибки' }));
  tip.hidden = false;
  // Ставим рядом с бейджем, а не у курсора: бейдж — сама цель, и подсказка не
  // прыгает, пока человек ведёт мышь по нему.
  const wr = wrap.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = ar.right - wr.left + 10;
  if (left + tr.width > wr.width - 6) left = ar.left - wr.left - tr.width - 10;
  left = Math.max(6, Math.min(left, Math.max(6, wr.width - tr.width - 6)));
  let top = ar.top - wr.top - tr.height / 2;
  top = Math.max(6, Math.min(top, Math.max(6, wr.height - tr.height - 6)));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function onMarkOver(e) {
  const g = e.target?.closest?.('[data-mark]');
  if (!g) return;
  const i = Number(g.getAttribute('data-mark'));
  if (Number.isInteger(i)) showMarkTip(i, g.querySelector('.finding-mark-dot') ?? g);
}

function onMarkOut(e) {
  const g = e.target?.closest?.('[data-mark]');
  if (!g) return;
  // Переход внутри того же бейджа (круг → счётчик) — не «ушли с маркера».
  if (e.relatedTarget && g.contains(e.relatedTarget)) return;
  hideMarkTip();
}

/** The anchor point of `target` facing `source` (t=0.5 on the near side). */
function anchorTowards(source, target) {
  const lt = lyt(target);
  const ls = lyt(source);
  const sc = { x: source.x + ls.w / 2, y: source.y + ls.h / 2 };
  const tc = { x: target.x + lt.w / 2, y: target.y + lt.h / 2 };
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom');
  const p = edgePoint(target, lt, side, 0.5);
  return [p.x, p.y];
}

const isConnectorTool = (t) => !!NOTATION.connectors[t];
const isShapeTool = (t) => !!NOTATION.shapes[t];

/* -------------------------------------------------------- hit testing */

function shapeAt(pt, { exclude } = {}) {
  const shapes = currentDiagram(store.model)?.shapes ?? [];
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (exclude && s.id === exclude) continue;
    const { w, h } = lyt(s);
    if (pt.x >= s.x && pt.x <= s.x + w && pt.y >= s.y && pt.y <= s.y + h) return s;
  }
  return null;
}

// Формы, которые не бывают концом связи: примечание и подпись — пометки на
// поле, а не участники модели. Связь, брошенная на них, берёт их рамку.
const NOT_CONNECTABLE = new Set(['note', 'text']);

const connectableShape = (s) =>
  !NOT_CONNECTABLE.has(NOTATION.shapes[elementOf(store.model, s)?.kind]?.style);

/**
 * Фигура, к которой цепляется связь в точке `pt` (исследование §4.4, наш Д2).
 *
 * Прежнее правило — «первая фигура в обратном порядке, чей бокс накрыл точку» —
 * отдавало контейнеру связь, предназначенную фигуре ВНУТРИ него: контейнер
 * обычно создан раньше, нарисован позже и потому стоит в массиве последним.
 * Здесь глубина — геометрия, а не флаг в начертании: самая глубокая фигура —
 * та, у которой МЕНЬШАЯ площадь (при равенстве — верхняя по z). Поэтому рамка
 * достаётся связи только тогда, когда под курсором нет ничего меньше, а
 * не-соединяемая пометка уступает своей рамке.
 */
export function targetAt(pt, { exclude } = {}) {
  const shapes = currentDiagram(store.model)?.shapes ?? [];
  const hits = [];
  shapes.forEach((s, z) => {
    if (exclude && s.id === exclude) return;
    const { w, h } = lyt(s);
    if (pt.x >= s.x && pt.x <= s.x + w && pt.y >= s.y && pt.y <= s.y + h) {
      hits.push({ s, area: w * h, z });
    }
  });
  if (!hits.length) return null;
  hits.sort((a, b) => (a.area - b.area) || (b.z - a.z));
  const first = hits.find((hit) => connectableShape(hit.s));
  return first ? first.s : null;
}

/**
 * Насколько точка вне рамки фигуры, в пикселях листа (0 — внутри).
 *
 * Порог самосвязи меряется этим расстоянием, а не путём указателя: человек
 * отвёл курсор на 30 px в сторону и вернулся — жест осознанный, даже если
 * суммарный путь был длиннее.
 */
function awayFromShape(pt, s) {
  const { w, h } = lyt(s);
  const dx = Math.max(s.x - pt.x, 0, pt.x - (s.x + w));
  const dy = Math.max(s.y - pt.y, 0, pt.y - (s.y + h));
  return Math.hypot(dx, dy);
}

/**
 * Развести концы петли, если они легли на одну сторону слишком близко.
 *
 * Двигается тот конец, который человек только что поставил: неподвижный
 * остаётся там, где был. Сдвиг — 0.4 по `t` (в 4103 концы стоят на 0.3 и 0.7),
 * и он всегда укладывается в 0…1, потому что при `keep + 0.4 > 1` берётся
 * `keep − 0.4`.
 */
function spreadSelfEnds(fromEnd, toEnd, moved = 'to') {
  if (!fromEnd || !toEnd) return;
  if (fromEnd.shapeId !== toEnd.shapeId) return;
  if (fromEnd.side !== toEnd.side) return;
  const keep = moved === 'to' ? fromEnd : toEnd;
  const move = moved === 'to' ? toEnd : fromEnd;
  if (Math.abs(Number(move.t) - Number(keep.t)) >= SELF_MIN_T) return;
  let t = Number(keep.t) + 0.4;
  if (t > 1) t = Number(keep.t) - 0.4;
  move.t = Math.round(Math.max(0, Math.min(1, t)) * 100) / 100;
}

/** Можно ли бросить конец на эту фигуру: своя фигура — только по правилу вида. */
function endAllowedOn(rel, shapeId, otherShapeId) {
  if (!rel || shapeId !== otherShapeId) return true;
  return selfRuleOfRelationship(rel) === SELF.allowed;
}

function linkAt(pt) {
  const links = currentDiagram(store.model)?.links ?? [];
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    const pts = linkPointsOf(l);
    if (!pts) continue;
    if (distToPolyline(pt.x, pt.y, pts) <= ARROW_GRAB) return l;
  }
  return null;
}

/** The polyline a link draws — including the horizontal message case. */
function linkPointsOf(link) {
  const d = currentDiagram(store.model);
  const from = link.from ? d?.shapes.find((s) => s.id === link.from.shapeId) : null;
  const to = link.to ? d?.shapes.find((s) => s.id === link.to.shapeId) : null;
  if (!from && !to) return null;
  const rel = relOf(store.model, link);
  const def = NOTATION.connectors[rel?.kind];
  // Внутренний переход (пришёл связью из чужого файла) читается и хранится,
  // но на листе его нет — §14.2.4.9 прямо говорит «не показывается».
  if (rel?.internal === true) return null;
  if (!def?.sequence && (!from || !to)) return null;
  if (def?.sequence) {
    const lf = from ? lyt(from) : null;
    const lt = to ? lyt(to) : null;
    const anchor = (s) => (s ? s.y + LIFELINE_HEAD + MESSAGE_GAP : 0);
    // Порядок тот же, что у рендерера: `seq` главнее геометрии, когда он есть.
    let y = link.y;
    if (y == null) {
      const order = messageOrder(d, store.model).get(link.id);
      const bySeq = (d?.links ?? []).some((l) => Number.isFinite(Number(relOf(store.model, l)?.seq)));
      y = bySeq && order ? Math.min(...[from, to].filter(Boolean).map(anchor)) + order.index * MESSAGE_GAP
        : Math.max(...[from, to].filter(Boolean).map(anchor));
    }
    if (from && to && from.id === to.id) {
      const x = from.x + lf.w / 2;
      return [[x, y], [x + 40, y], [x + 40, y + 20], [x, y + 20]];
    }
    if (from && to) return [[from.x + lf.w / 2, y], [to.x + lt.w / 2, y]];
    if (from) return [[from.x + lf.w / 2, y], [from.x + lf.w / 2 + 96, y]];
    return [[to.x + lt.w / 2 - 96, y], [to.x + lt.w / 2, y]];
  }
  // Вторая связь между той же парой отходит от кромки на своё место — тем же
  // расчётом, что и в render.js, иначе наводить мышь было бы не на ту линию.
  const ends = parallelEnds(d, link, parallelOffsets(d, store.model));
  const p1 = endPoint(from, lyt(from), ends.from, link.entryPerimeter === true);
  const p2 = endPoint(to, lyt(to), ends.to, link.entryPerimeter === true);
  return linkPoints(p1, p2, routeOfLink(link), link.waypoints, link.noEdgeStyle === true);
}

/**
 * The nearest segment of any connector's route to `pt`, with the way it runs.
 *
 * The gesture works on the DRAWN polyline, so a segment may be bounded by two
 * shape ends, two bends, or one of each. Sequence messages are left alone —
 * dragging one of those reorders the interaction, which is its own gesture.
 */
export function segmentAt(pt) {
  const links = currentDiagram(store.model)?.links ?? [];
  let best = null;
  for (let i = links.length - 1; i >= 0; i -= 1) {
    const l = links[i];
    const def = NOTATION.connectors[relOf(store.model, l)?.kind];
    if (def?.sequence) continue;
    const pts = linkPointsOf(l);
    if (!pts || pts.length < 2) continue;
    for (let k = 0; k < pts.length - 1; k += 1) {
      const a = pts[k];
      const b = pts[k + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
      const d = segDist(pt, a, b);
      if (d > ARROW_GRAB) continue;
      if (!best || d < best.dist - 1e-9) {
        best = {
          link: l,
          index: k,
          pts,
          // Горизонтальный сегмент тянется по вертикали (row-resize), и
          // наоборот: курсор показывает, куда поедет линия (§2.1, §7.4).
          horizontal: Math.abs(b[1] - a[1]) <= Math.abs(b[0] - a[0]),
          dist: d,
        };
      }
    }
  }
  return best;
}

/**
 * A drag that moves a WHOLE segment: both points that bound it travel by the
 * same amount across the segment, and their other coordinate never changes —
 * exactly what draw.io's mxEdgeSegmentHandler does for orthogonal edges
 * (research §4.5; our Д3).
 *
 * Ends are not stored points, so a segment that touches a shape gets a bend
 * point at the shape's border first: from that moment the route is fixed and
 * both points travel together, and the line keeps the shape it had.
 */
function segmentDrag(link, seg, pt) {
  const pts = seg.pts;
  const n = pts.length;
  const list = Array.isArray(link.waypoints)
    ? link.waypoints.map((p) => [Number(p[0]), Number(p[1])])
    : pts.slice(1, -1).map((p) => [p[0], p[1]]);
  let i1 = seg.index - 1;
  let i2 = seg.index;
  if (seg.index === 0) {
    list.unshift([pts[0][0], pts[0][1]]);
    i1 = 0;
    i2 = 1;
  }
  if (seg.index === n - 2) {
    list.push([pts[n - 1][0], pts[n - 1][1]]);
    i2 = list.length - 1;
  }
  const axis = seg.horizontal ? 1 : 0;
  return {
    type: 'conn-seg', id: link.id, axis, pt, moved: false, list, i1, i2,
    origin: pt[axis === 1 ? 'y' : 'x'],
    base: [list[i1][axis], list[i2][axis]],
  };
}

/** What a double click hit on a shape: its name, a member row or a text line. */
function rowAt(shape, pt) {
  const layout = lyt(shape);
  const ly = pt.y - shape.y;
  for (const box of layout.boxes) {
    if (box.readonly) continue;
    if (box.id === 'name') {
      if (ly <= box.y + box.h) return { field: 'name', box };
    } else if (box.rows?.length) {
      const rel = ly - (box.y + PAD_Y);
      if (rel >= 0 && rel < box.rows.length * LINE_H) {
        const idx = Math.floor(rel / LINE_H);
        return { field: box.id, index: idx, box, lines: box.mode === 'lines' };
      }
    } else if (box.id === 'note') {
      return { field: 'note', box };
    }
  }
  return null;
}

function labelAt(link, pt) {
  const pts = linkPointsOf(link);
  if (!pts) return null;
  const rel = relOf(store.model, link);
  const def = NOTATION.connectors[rel?.kind];
  const mid = def?.sequence
    ? { x: (pts[0][0] + pts[pts.length - 1][0]) / 2, y: Math.min(...pts.map((p) => p[1])) - 6 }
    : labelPos(pts, link.ldx, link.ldy, link.labelOrientation);
  const lines = [rel?.stereotype ? `«${rel.stereotype}»` : null, rel?.name].filter(Boolean);
  // Пустой подписи нет — значит нет и зоны захвата: иначе середина КАЖДОЙ
  // безымянной связи отбирала бы жест у сегмента (у него своё поведение).
  if (!lines.length) return null;
  const w = Math.max(...lines.map((l) => tw(l, { bold: false })), 20);
  const h = lines.length * LINE_H + 6;
  if (Math.abs(pt.x - mid.x) <= w / 2 + LABEL_GRAB && Math.abs(pt.y - mid.y) <= h / 2) return mid;
  return null;
}

/* ------------------------------------------------- bend points (waypoints) */

/** Distance from a point to one segment. */
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.min(1, Math.max(0, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a[0] + dx * t), p.y - (a[1] + dy * t));
}

/**
 * A bend point where the double click landed.
 *
 * The route is [from-edge, …waypoints, to-edge], so segment `i` of the drawn
 * polyline is the gap the new point goes into: index `i` keeps the point
 * between the same neighbours it was dropped between.
 */
function addWaypointAt(link, pt) {
  const pts = linkPointsOf(link);
  if (!pts) return;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const d = segDist(pt, pts[i], pts[i + 1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  const index = best;
  commit('Точка перегиба', (m) => {
    const l = findLink(m, link.id);
    if (!l) return;
    const list = Array.isArray(l.waypoints) ? l.waypoints.slice() : [];
    list.splice(Math.min(index, list.length), 0, [Math.round(pt.x), Math.round(pt.y)]);
    l.waypoints = list;
  });
  selectOnly('connector', link.id);
  set({ wp: { linkId: link.id, index }, hint: 'Точка перегиба: тяните мышью, Alt+клик или Delete — убрать.' });
  renderCanvas();
}

/** Take one bend point out. An empty list is stored as no field at all. */
function dropWaypoint(linkId, index) {
  commit('Точка перегиба', (m) => {
    const l = findLink(m, linkId);
    if (!l || !Array.isArray(l.waypoints)) return;
    l.waypoints.splice(index, 1);
    if (!l.waypoints.length) delete l.waypoints;
  });
  set({ wp: null, hint: 'Точка перегиба убрана.' });
  renderCanvas();
}

/** Delete with a bend point picked removes that point, not the connector. */
export function deleteWaypoint() {
  const w = store.ui.wp;
  if (!w) return false;
  const l = findLink(store.model, w.linkId);
  if (!l || !isSelected('connector', w.linkId)
    || !Array.isArray(l.waypoints) || !l.waypoints[w.index]) {
    set({ wp: null });
    return false;
  }
  dropWaypoint(w.linkId, w.index);
  return true;
}

/* ------------------------------------------------------------ pointers */

const setCoords = (pt) => {
  const n = document.getElementById('sb-coords');
  if (n) n.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
};

/**
 * Turn the pending connector into a relationship + its view on this diagram.
 * The relationship is created once, in the model; the link is the view.
 */
function finishPending(pending, target, pt) {
  const fromShape = findShape(store.model, pending.from.shapeId);
  const fromEl = elOf(fromShape);
  const toEl = elOf(target);
  if (!fromEl || !toEl) return null;
  const st = sideAndT(target.x, target.y, lyt(target).w, lyt(target).h, pt.x, pt.y);
  const to = { shapeId: target.id, side: st.side, t: Math.round(st.t * 100) / 100 };
  // Петля: оба конца на одной фигуре. Если они легли на одну сторону слишком
  // близко, новый конец отводится — иначе линия выродится в точку. Сообщение
  // живёт высотой `y`, а не долей стороны, поэтому его это не касается.
  if (!NOTATION.connectors[pending.kind]?.sequence) spreadSelfEnds(pending.from, to, 'to');
  const created = commit('Связь', (m) => {
    const rel = createRelationship(pending.kind, fromEl.id, toEl.id);
    m.relationships.push(rel);
    const d = currentDiagram(m);
    const extra = {};
    if (NOTATION.connectors[pending.kind]?.sequence) {
      const heads = d.shapes.map((s) => s.y + LIFELINE_HEAD);
      const ys = d.links.filter((l) => l.y != null).map((l) => l.y);
      extra.y = Math.round((ys.length ? Math.max(...ys) : Math.max(...heads, 0) + 10) + 30);
    }
    const link = createLink(rel, pending.from, to, extra);
    d.links.push(link);
    return link;
  });
  set({
    pending: null,
    // С липким инструментом связь тоже не сбрасывает его: иначе «остаться в
    // инструменте» работало бы через раз — для фигур да, для связей нет.
    tool: stickyTool() ? pending.kind : 'select',
    selection: [{ kind: 'connector', id: created.id }],
    hint: '',
  });
  renderCanvas();
  return created;
}

const paintSoon = rafThrottle(() => renderCanvas());

function onPointerDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  // Открытый редактор применяется ПЕРВЫМ: клик по листу — это «принято,
  // дальше по делу», а не «бросить набранное». Без этого постановка второй
  // фигуры молча теряла бы имя первой: startInlineEdit гасит предыдущий
  // редактор, не заглядывая в него (см. beginNameAfterPlace).
  commitEditor();
  const active = document.activeElement;
  if (active && active.closest?.('#props')) active.blur();
  // Клик по маркеру замечания — до всех остальных веток: иначе он провалился бы
  // в «пустой лист», снял выделение и начал лассо.
  const markEl = e.button === 0 ? e.target.closest?.('[data-mark]') : null;
  if (markEl) {
    hideMarkTip();
    const i = Number(markEl.getAttribute('data-mark'));
    if (Number.isInteger(i) && marks[i]) markClick?.(marks[i], { event: e });
    return;
  }
  const pt = toModel(e);
  const tool = store.ui.tool;

  // A bend point is a handle of its own — and it has to be checked BEFORE the
  // pan branch, because Alt+drag pans the sheet while Alt+click here means
  // «уберите этот излом».
  const wpEl = e.button === 0 ? e.target.closest?.('[data-kind="wp"]') : null;
  if (wpEl) {
    const id = wpEl.getAttribute('data-id');
    const index = Number(wpEl.getAttribute('data-idx'));
    if (findLink(store.model, id) && Number.isInteger(index)) {
      if (e.altKey) { dropWaypoint(id, index); return; }
      selectOnly('connector', id);
      set({ wp: { linkId: id, index } });
      drag = { type: 'conn-wp', id, index, pt, moved: false };
      renderCanvas();
      return;
    }
  }

  // Middle button (or Alt+drag) always pans: the left button on empty sheet is
  // the lasso now, and panning still needs a home.
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    drag = { type: 'pan', startClient: { x: e.clientX, y: e.clientY }, startView: { ...store.ui.view } };
    return;
  }

  if (isShapeTool(tool)) {
    const def = NOTATION.shapes[tool];
    const x = snapTo(pt.x - def.defaultSize.w / 2, SNAP_X);
    const y = snapTo(pt.y - def.defaultSize.h / 2, SNAP_Y);
    // Липкий инструмент (тумблер в полосе, по умолчанию выключен): человеку,
    // которому нужно десять вариантов использования подряд, не надо жать
    // клавишу десять раз. Выключенный — прежнее поведение: после фигуры «Выбор».
    const keep = stickyTool();
    const shape = commit('Добавление фигуры', (m) => {
      const { shape } = placeElement(m, tool, x, y);
      set({ selection: [{ kind: 'shape', id: shape.id }], tool: keep ? tool : 'select', hint: '' });
      return shape;
    });
    renderCanvas();
    if (shape) beginNameAfterPlace(shape);
    return;
  }

  if (isConnectorTool(tool)) {
    const s = targetAt(pt);
    const pending = store.ui.pending;
    if (pending && s && s.id !== pending.from.shapeId) {
      finishPending(pending, s, pt);
      return;
    }
    if (!s) { set({ hint: 'Кликните исходную фигуру, чтобы начать связь.' }); return; }
    const st = sideAndT(s.x, s.y, lyt(s).w, lyt(s).h, pt.x, pt.y);
    set({
      pending: { kind: tool, from: { shapeId: s.id, side: st.side, t: Math.round(st.t * 100) / 100 }, cursor: pt },
      hint: 'Кликните целевую фигуру, чтобы завершить связь. Esc — отмена.',
    });
    drag = { type: 'conn-draw', id: s.id, pt, moved: false, away: 0 };
    renderCanvas();
    return;
  }

  const t = e.target.closest('[data-kind]');

  if (t?.dataset.kind === 'handle') {
    const s = findShape(store.model, t.dataset.id);
    if (s) {
      const { w, h } = lyt(s);
      drag = {
        type: 'resize', id: s.id, corner: t.dataset.resize,
        start: { x: s.x, y: s.y, w, h }, pt, moved: false,
      };
      set({ selection: [{ kind: 'shape', id: s.id }] });
    }
    return;
  }

  if (t?.dataset.kind === 'end') {
    drag = { type: 'conn-end', id: t.dataset.id, end: t.dataset.end, pt, hover: null };
    set({ selection: [{ kind: 'connector', id: t.dataset.id }] });
    renderCanvas();
    return;
  }

  const el = e.target.closest('[data-id]');
  const id = el?.getAttribute('data-id');
  const kind = el?.getAttribute('data-kind');

  if (kind === 'shape') {
    const s = findShape(store.model, id);
    if (s) {
      // Shift adds to the selection (or takes the shape out of it) and never
      // starts a drag: the click is about the group, not about the point.
      if (e.shiftKey) {
        toggleSelection('shape', s.id);
        drag = null;
        renderCanvas();
        return;
      }
      if (!isSelected('shape', s.id)) selectOnly('shape', s.id);
      drag = {
        type: 'move', id: s.id, start: { x: s.x, y: s.y }, pt, moved: false,
        group: groupStarts(),
      };
    }
    return;
  }

  if (kind === 'conn') {
    const l = findLink(store.model, id);
    if (l) {
      if (e.shiftKey) {
        toggleSelection('connector', l.id);
        drag = null;
        renderCanvas();
        return;
      }
      selectOnly('connector', l.id);
      const rel = relOf(store.model, l);
      const def = NOTATION.connectors[rel?.kind];
      const seg = def?.sequence ? null : segmentAt(pt);
      if (def?.sequence) {
        drag = { type: 'message', id: l.id, startY: l.y ?? pt.y, pt, moved: false };
      } else if (labelAt(l, pt)) {
        drag = { type: 'conn-label', id: l.id, start: { ldx: l.ldx, ldy: l.ldy }, pt, moved: false };
      } else if (seg && seg.link.id === l.id) {
        // Жест по СЕГМЕНТУ (§7.4): ортогональное ребро едет целиком, обе
        // ограничивающие точки вместе. У прямого ребра поведение прежнее и
        // как у draw.io — одна точка в месте нажатия.
        drag = routeOfLink(l) === 'direct'
          ? { type: 'conn-seg-straight', id: l.id, index: seg.index, pt, moved: false }
          : segmentDrag(l, seg, pt);
      }
    }
    return;
  }

  // Empty sheet: a left drag draws a lasso; a click without movement clears
  // the selection (the old behaviour). Shift keeps what was selected.
  if (!e.shiftKey) set({ selection: [], hint: '' });
  drag = {
    type: 'lasso', start: pt, pt, moved: false,
    base: e.shiftKey ? [...store.ui.selection] : [],
  };
  renderOverlay();
}

/** Start positions of every selected shape: one drag moves the whole group. */
function groupStarts() {
  const map = new Map();
  for (const item of store.ui.selection) {
    if (item.kind !== 'shape') continue;
    const s = findShape(store.model, item.id);
    if (s) map.set(s.id, { x: s.x, y: s.y });
  }
  return map;
}

/**
 * Курсор над сегментом (§2.1): `row-resize` для горизонтального, `col-resize`
 * для вертикального — как в draw.io. Считается только над линией и только
 * когда ничего не тянется, иначе курсор перекрывал бы стрелки концов.
 */
function updateSegmentCursor(e, pt) {
  const el = !drag && store.ui.tool === 'select' ? e.target?.closest?.('.conn-hit') : null;
  if (segCursorEl && segCursorEl !== el) segCursorEl.style.cursor = '';
  segCursorEl = el;
  if (!el) return;
  const seg = segmentAt(pt);
  el.style.cursor = seg && routeOfLink(seg.link) !== 'direct'
    ? (seg.horizontal ? 'row-resize' : 'col-resize') : '';
}

function onPointerMove(e) {
  const pt = toModel(e);
  setCoords(pt);
  updateSegmentCursor(e, pt);

  const tool = store.ui.tool;
  if (!drag) {
    if (isConnectorTool(tool)) {
      const exclude = store.ui.pending ? store.ui.pending.from.shapeId : undefined;
      const s = targetAt(pt, { exclude });
      if (s !== hover) {
        hover = s;
        renderOverlay();
      }
    } else if (hover) {
      hover = null;
      renderOverlay();
    }
    if (store.ui.pending) {
      store.ui.pending.cursor = pt;
      renderOverlay();
    }
    return;
  }

  switch (drag.type) {
    case 'pan': {
      const { scale } = store.ui.view;
      store.ui.view = {
        scale,
        tx: drag.startView.tx + (e.clientX - drag.startClient.x),
        ty: drag.startView.ty + (e.clientY - drag.startClient.y),
      };
      applyTransform();
      break;
    }
    case 'move': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Перемещение');
      }
      const dx = pt.x - drag.pt.x;
      const dy = pt.y - drag.pt.y;
      const group = drag.group ?? new Map([[drag.id, drag.start]]);
      mutate((m) => {
        for (const [id, start] of group) {
          const s = findShape(m, id);
          if (s) moveShape(s, start.x + dx, start.y + dy);
        }
      });
      paintSoon();
      break;
    }
    case 'lasso': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 3 / store.ui.view.scale) return;
        drag.moved = true;
      }
      drag.pt = pt;
      renderOverlay();
      break;
    }
    case 'resize': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Изменение размера');
      }
      const { start, corner } = drag;
      mutate((m) => {
        const s = findShape(m, drag.id);
        if (!s) return;
        let x = start.x;
        let y = start.y;
        let w = start.w;
        let h = start.h;
        if (corner.includes('w')) { x = pt.x; w = start.x + start.w - pt.x; }
        if (corner.includes('e')) { w = pt.x - start.x; }
        if (corner.includes('n')) { y = pt.y; h = start.y + start.h - pt.y; }
        if (corner.includes('s')) { h = pt.y - start.y; }
        resizeShape(s, x, y, w, h, elementOf(m, s)?.kind);
      });
      paintSoon();
      break;
    }
    case 'conn-label': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Перенос подписи');
      }
      mutate((m) => {
        const l = findLink(m, drag.id);
        if (l) {
          l.ldx = Math.round(drag.start.ldx + (pt.x - drag.pt.x));
          l.ldy = Math.round(drag.start.ldy + (pt.y - drag.pt.y));
        }
      });
      paintSoon();
      break;
    }
    case 'conn-wp': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Точка перегиба');
      }
      mutate((m) => {
        const l = findLink(m, drag.id);
        if (l && Array.isArray(l.waypoints) && l.waypoints[drag.index]) {
          l.waypoints[drag.index] = [Math.round(pt.x), Math.round(pt.y)];
        }
      });
      paintSoon();
      break;
    }
    case 'conn-seg': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Сегмент связи');
        // Маршрут фиксируется этим же жестом: точки, ограничивающие сегмент,
        // появляются в модели одной правкой — и отменяются тоже одной.
        mutate((m) => {
          const l = findLink(m, drag.id);
          if (l) l.waypoints = drag.list.map((p) => [p[0], p[1]]);
        });
      }
      const delta = (drag.axis === 1 ? pt.y : pt.x) - drag.origin;
      mutate((m) => {
        const l = findLink(m, drag.id);
        if (!l || !Array.isArray(l.waypoints)) return;
        // Вторая координата не меняется: сегмент едет поперёк себя.
        if (l.waypoints[drag.i1]) l.waypoints[drag.i1][drag.axis] = Math.round(drag.base[0] + delta);
        if (l.waypoints[drag.i2]) l.waypoints[drag.i2][drag.axis] = Math.round(drag.base[1] + delta);
      });
      paintSoon();
      break;
    }
    case 'conn-seg-straight': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Точка перегиба');
        mutate((m) => {
          const l = findLink(m, drag.id);
          if (!l) return;
          const list = Array.isArray(l.waypoints) ? l.waypoints.slice() : [];
          const index = Math.min(drag.index, list.length);
          list.splice(index, 0, [Math.round(drag.pt.x), Math.round(drag.pt.y)]);
          l.waypoints = list;
          drag.wpIndex = index;
        });
        set({ wp: { linkId: drag.id, index: drag.wpIndex } });
      }
      mutate((m) => {
        const l = findLink(m, drag.id);
        if (l && Array.isArray(l.waypoints) && l.waypoints[drag.wpIndex]) {
          l.waypoints[drag.wpIndex] = [Math.round(pt.x), Math.round(pt.y)];
        }
      });
      paintSoon();
      break;
    }
    case 'message': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 2 / store.ui.view.scale) return;
        drag.moved = true;
        beginDrag('Порядок сообщений');
      }
      mutate((m) => {
        const l = findLink(m, drag.id);
        if (l) l.y = Math.round(drag.startY + (pt.y - drag.pt.y));
      });
      paintSoon();
      break;
    }
    case 'conn-end': {
      const s = targetAt(pt);
      const l = findLink(store.model, drag.id);
      const rel = relOf(store.model, l);
      const otherEnd = drag.end === 'from' ? l?.to?.shapeId : l?.from?.shapeId;
      // Перетаскивание конца на свою фигуру — без порога: намерение явное.
      // Но вид связи всё равно решает: обобщение и включение петли не знают.
      drag.hover = s && endAllowedOn(rel, s.id, otherEnd) ? s : null;
      // Одному и тому же правилу targetAt отвечает и перетаскивание конца,
      // и создание связи: то, что подсвечено, — ровно то, к чему подключим.
      dropTarget = drag.hover;
      drag.pt = pt;
      renderOverlay();
      break;
    }
    case 'conn-draw': {
      if (!drag.moved) {
        if (Math.hypot(pt.x - drag.pt.x, pt.y - drag.pt.y) < 3 / store.ui.view.scale) return;
        drag.moved = true;
      }
      // Порог самосвязи: пока указатель не отошёл от исходной фигуры на
      // SELF_AWAY, она не может быть целью — иначе клик по фигуре с
      // инструментом связи сразу замыкал бы петлю.
      const src = findShape(store.model, drag.id);
      if (src) {
        const away = awayFromShape(pt, src);
        if (away > (drag.away ?? 0)) drag.away = away;
      }
      const p = store.ui.pending;
      const selfOk = p && selfRuleOf(p.kind) === SELF.allowed
        && (drag.away ?? 0) >= SELF_AWAY;
      const s = targetAt(pt, { exclude: selfOk ? undefined : drag.id });
      hover = s;
      dropTarget = s;
      drag.pt = pt;
      if (p) { p.cursor = pt; }
      renderOverlay();
      break;
    }
    default: break;
  }
}

function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  // Подсветка кандидата живёт ровно один жест: снимаем её до любой ветки,
  // чтобы рамка не осталась висеть после отказа («не на ту фигуру»).
  dropTarget = null;

  if (d.type === 'conn-draw') {
    const p = store.ui.pending;
    const target = d.moved ? targetAt(d.pt) : null;
    hover = null;
    if (p && target) {
      const selfTarget = target.id === p.from.shapeId;
      if (!selfTarget) {
        finishPending(p, target, d.pt);
        return;
      }
      // Петля разрешена не всякому виду связи: обобщение и включение себя
      // исключают, внутренний переход на диаграмме не показывается вовсе.
      const rule = selfRuleOf(p.kind);
      if (rule === SELF.forbidden || rule === SELF.hidden) {
        set({ hint: selfRefusal(p.kind, { internal: rule === SELF.hidden }) });
        renderCanvas();
        return;
      }
      if ((d.away ?? 0) >= SELF_AWAY) {
        finishPending(p, target, d.pt);
        return;
      }
      set({
        hint: `Петля создаётся, когда указатель отходит от фигуры не меньше чем на ${SELF_AWAY} px и возвращается на неё. Esc — отмена.`,
      });
      renderCanvas();
      return;
    }
    if (d.moved) {
      set({ hint: 'Связь тянется от фигуры к фигуре — отпустите на другой фигуре. Esc — отмена.' });
    }
    renderCanvas();
    return;
  }

  if (d.type === 'conn-end') {
    if (d.hover) {
      const st = sideAndT(d.hover.x, d.hover.y, lyt(d.hover).w, lyt(d.hover).h, d.pt.x, d.pt.y);
      commit('Перенос конца связи', (m) => {
        const l = findLink(m, d.id);
        if (!l) return;
        l[d.end] = { shapeId: d.hover.id, side: st.side, t: Math.round(st.t * 100) / 100 };
        // Жест всегда возвращает конец «к стороне»: привязка к точке
        // (доля+смещение) снимается, иначе в модели остались бы две правды
        // об одном конце. Задать её снова можно только в инспекторе.
        delete l[d.end].attach;
        // Конец сообщения — это и конец СВЯЗИ: если у неё он был свободен
        // (потерянное/найденное сообщение), привязка возвращает и его, иначе
        // модель и лист разойдутся, а чтение файла снова снимет конец.
        const rel = relOf(m, l);
        if (rel && NOTATION.connectors[rel.kind]?.sequence && rel[d.end] == null) {
          const shape = currentDiagram(m)?.shapes.find((s) => s.id === d.hover.id);
          if (shape) rel[d.end] = shape.elementId;
        }
        // Петля: концы на одной стороне не ближе SELF_MIN_T друг к другу.
        if (!NOTATION.connectors[rel?.kind]?.sequence) spreadSelfEnds(l.from, l.to, d.end);
      });
      set({ hint: '' });
    } else {
      const l = findLink(store.model, d.id);
      const rel = relOf(store.model, l);
      const otherEnd = d.end === 'from' ? l?.to?.shapeId : l?.from?.shapeId;
      const s = targetAt(d.pt);
      if (s && s.id === otherEnd && rel && selfRuleOfRelationship(rel) !== SELF.allowed) {
        set({ hint: selfRefusal(rel.kind, { internal: rel.internal === true }) });
      } else {
        set({ hint: 'Связи соединяют фигуры — тащите конец на другую фигуру.' });
      }
    }
    renderCanvas();
    return;
  }
  if (d.type === 'lasso') {
    if (!d.moved) { renderCanvas(); return; }
    const a = d.start;
    const b = d.pt ?? d.start;
    const box = {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
    };
    // A shape is caught when its box meets the lasso's box: dragging across a
    // group must not need the whole shape inside the frame.
    const caught = (currentDiagram(store.model)?.shapes ?? []).filter((s) => {
      const { w, h } = lyt(s);
      return s.x < box.x + box.w && s.x + w > box.x && s.y < box.y + box.h && s.y + h > box.y;
    });
    const merged = new Map(d.base.map((x) => [`${x.kind}:${x.id}`, x]));
    for (const s of caught) merged.set(`shape:${s.id}`, { kind: 'shape', id: s.id });
    const list = [...merged.values()];
    set({
      selection: list,
      hint: list.length ? `Выделено фигур: ${list.filter((x) => x.kind === 'shape').length}` : '',
    });
    renderCanvas();
    return;
  }

  if (d.type === 'move' || d.type === 'resize' || d.type === 'conn-label' || d.type === 'message'
    || d.type === 'conn-wp' || d.type === 'conn-seg' || d.type === 'conn-seg-straight') {
    if (d.moved) endDrag();
    renderCanvas();
  }
}

/* ----------------------------------------------------- double click */

function onDoubleClickDown(e) {
  if (e.button !== 0 || e.detail < 2) return;
  if (store.ui.tool !== 'select') return;
  const pt = toModel(e);
  const s = shapeAt(pt);
  if (!s) return;
  set({ selection: [{ kind: 'shape', id: s.id }], hint: '' });
  openEditorAt(s, pt);
}

function onDoubleClick(e) {
  const pt = toModel(e);
  const el = e.target.closest('[data-kind="conn"]');
  if (el) {
    const l = findLink(store.model, el.getAttribute('data-id'));
    if (l) {
      // Two meanings, one gesture, both kept: a double click on the LABEL
      // renames the connector (as before), a double click on the LINE drops a
      // bend point where the click landed.
      if (labelAt(l, pt)) editConnectorName(l);
      else addWaypointAt(l, pt);
    }
    return;
  }
  const sh = e.target.closest('[data-kind="shape"]');
  if (sh) {
    const s = findShape(store.model, sh.getAttribute('data-id'));
    if (s) openEditorAt(s, pt);
  }
}

function openEditorAt(s, pt) {
  const hit = rowAt(s, pt);
  if (!hit) return false;
  if (hit.field === 'name') editName(s);
  else if (hit.field === 'note') editNote(s);
  else if (hit.lines) editLine(s, hit.field, hit.index);
  else editMemberRow(s, hit.field, hit.index);
  return true;
}

/* ----------------------------------------------------- inline editor */

function startInlineEdit(opts) {
  cancelInlineEdit();
  const { scale } = store.ui.view;
  const screen = modelToScreen(opts.x, opts.y);
  editor.innerHTML = '';
  editorInput = document.createElement(opts.multiline ? 'textarea' : 'input');
  if (!opts.multiline) editorInput.type = 'text';
  editorInput.spellcheck = false;
  editor.append(editorInput);
  editorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !opts.multiline) { e.preventDefault(); commitEditor(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
      // Отмена сразу после постановки — это «передумал ставить»: Esc возвращает
      // стрелку, а не оставляет инструмент заряженным (иначе липкий инструмент
      // требовал бы двух Esc: один на редактор, второй на инструмент).
      if (opts.fresh && isShapeTool(store.ui.tool)) set({ tool: 'select', hint: '' });
    }
  });
  editorInput.addEventListener('blur', () => {
    // Применяем не в самом blur, а следующим тактом. Клик, который забрал
    // фокус, должен дойти до своей кнопки: коммит перерисовывает шапку и
    // полосу (renderAll), а перерисованный узел уже не получает mouseup —
    // клик по инструменту после ввода имени молча пропадал бы.
    // Сверяем состояние: пока ждали, редактор могли закрыть или открыть новый
    // (постановка фигуры), и чужой текст применять нельзя.
    const st = editorState;
    if (!st) return;
    setTimeout(() => { if (editorState === st) commitEditor(); }, 0);
  });
  editor.hidden = false;
  // `passthrough` — редактор, который открылся сам после постановки фигуры:
  // он принимает клавиши, но мышь идёт мимо него. Иначе первый же клик после
  // постановки пропадал бы в поле ввода, а с липким инструментом так было бы
  // через раз. У F2 и двойного щелчка мышь работает как раньше.
  editor.style.pointerEvents = opts.passthrough ? 'none' : '';
  editor.style.left = `${screen.left}px`;
  editor.style.top = `${screen.top}px`;
  editor.style.width = `${Math.max(40, opts.w * scale)}px`;
  editor.style.height = `${Math.max(20, opts.h * scale)}px`;
  editorState = { ...opts, field: editorInput };
  editorInput.value = opts.value;
  editorInput.focus();
  editorInput.select();
}

export function flushEdits() { commitEditor(); }

/** Take the selected views off this diagram. The elements and relationships stay. */
export function deleteSelection() {
  const sel = store.ui.selection;
  if (!sel.length) return;
  cancelInlineEdit();
  const shapeIds = sel.filter((s) => s.kind === 'shape').map((s) => s.id);
  const linkIds = sel.filter((s) => s.kind === 'connector').map((s) => s.id);
  commit('Снять с диаграммы', (m) => {
    for (const id of shapeIds) removeShape(m, id);
    for (const id of linkIds) removeLink(m, id);
  });
  const what = [];
  if (shapeIds.length) what.push(`фигур ${shapeIds.length}`);
  if (linkIds.length) what.push(`связей ${linkIds.length}`);
  set({
    selection: [],
    hint: `Снято с диаграммы: ${what.join(', ')} — элементы и связи остались в модели.`,
  });
  renderCanvas();
}

/** Delete the elements behind the selected shapes: every view, every diagram. */
export function deleteElementFromModel() {
  const sel = store.ui.selection.filter((s) => s.kind === 'shape');
  if (!sel.length) return;
  const elements = sel.map((s) => elOf(findShape(store.model, s.id))).filter(Boolean);
  if (!elements.length) return;
  cancelInlineEdit();
  commit('Удаление элемента из модели', (m) => {
    for (const e of elements) removeElement(m, e.id);
  });
  set({
    selection: [],
    hint: elements.length === 1
      ? `Элемент «${elements[0].name}» удалён из модели со всех диаграмм.`
      : `Удалено элементов: ${elements.length} — со всех диаграмм.`,
  });
  renderCanvas();
}

/** Delete the relationships behind the selected links: every view, every diagram. */
export function deleteRelationshipFromModel() {
  const sel = store.ui.selection.filter((s) => s.kind === 'connector');
  if (!sel.length) return;
  const rels = sel.map((s) => relOf(store.model, findLink(store.model, s.id))).filter(Boolean);
  if (!rels.length) return;
  cancelInlineEdit();
  commit('Удаление связи из модели', (m) => {
    for (const r of rels) removeRelationship(m, r.id);
  });
  set({
    selection: [],
    hint: rels.length === 1
      ? `Связь «${rels[0].name || rels[0].kind}» удалена из модели со всех диаграмм.`
      : `Удалено связей: ${rels.length} — со всех диаграмм.`,
  });
  renderCanvas();
}

/** Draw attention to a view that is already on the sheet (a second drop). */
export function flashShape(shapeId) {
  const node = sheetLayer?.querySelector(`[data-kind="shape"][data-id="${shapeId}"]`);
  if (!node) return;
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 900);
}

export function cancelInlineEdit() {
  if (!editorState) return;
  const fresh = editorState.fresh;
  editorState = null;
  editor.hidden = true;
  editorInput.value = '';
  // Подсказка «Enter — применить, Esc — оставить» принадлежит только что
  // открытому редактору имени: Esc снимает её вместе с ним, иначе она висит
  // в статусбаре про редактор, которого уже нет.
  if (fresh && store.ui.hint) set({ hint: '' });
}

function commitEditor() {
  if (!editorState) return;
  const st = editorState;
  editorState = null;
  editor.hidden = true;
  if (st.commit) st.commit(st.field.value);
}

/**
 * Где на листе нарисовано имя фигуры — вертикаль его строки, в координатах
 * модели.
 *
 * Бокс `name` из layoutOf говорит, где имя живёт в разметке, но не всегда —
 * где оно нарисовано: у варианта использования текст стоит по центру эллипса,
 * у актёра — под фигурой, у дорожки — в шапке. Поэтому сначала спрашиваем сам
 * лист (`.sh-name` — тот узел, который нарисовал рендерер), и только если его
 * нет, берём бокс. Редактор обязан встать на текст, иначе человек правит имя,
 * глядя в другое место листа.
 */
function nameTextY(shape, box) {
  const node = sheetLayer?.querySelector(`[data-kind="shape"][data-id="${shape.id}"] .sh-name`);
  const r = node?.getBoundingClientRect();
  const canvasRect = root?.getBoundingClientRect();
  if (r && canvasRect && r.height > 0) {
    const { scale, ty } = store.ui.view;
    return (r.top + r.height / 2 - canvasRect.top - ty) / scale;
  }
  return shape.y + (box?.y ?? 0) + Math.min(box?.h ?? LINE_H, LINE_H) / 2;
}

function editName(shape, { fresh = false } = {}) {
  const element = elOf(shape);
  if (!element) return;
  const layout = lyt(shape);
  const box = layout.boxes.find((b) => b.id === 'name');
  const h = Math.max(LINE_H + 4, Math.min(2 * LINE_H, box?.h ?? LINE_H));
  startInlineEdit({
    x: shape.x,
    // Поле ставится СЕРЕДИНОЙ на нарисованную строку имени: у класса это
    // прежние 0…18, у эллипса — центр фигуры, у актёра — подпись под ним.
    y: nameTextY(shape, box) - h / 2,
    w: layout.w,
    h,
    value: element.name,
    // Свежая фигура: имя и постановка — один шаг отмены, и мышь не ловим.
    fresh,
    passthrough: fresh,
    commit: (v) => (fresh
      ? commitFreshName(element.id, PLACE_LABEL, v)
      : commit('Правка имени', (m) => {
        const e = findElement(m, element.id);
        if (e) e.name = v.trim();
      })),
  });
}

/** Метка записи отмены у постановки фигуры — по ней её и находит commitFreshName. */
const PLACE_LABEL = 'Добавление фигуры';

/**
 * Имя сразу после постановки фигуры.
 *
 * Человек ставит фигуру, чтобы её назвать, а не чтобы потом искать её на листе
 * и жать F2 (замер упражнения 3.1: 16 фигур — 16 лишних F2+Enter). Редактор
 * тот же, что у F2, и стоит он на нарисованном имени (бокс `name` из layoutOf),
 * а не в точке клика.
 *
 * Редактор не ловит мышь (`passthrough`): клик по листу применяет имя и
 * продолжает своё дело — ставит следующую фигуру, снимает выделение, начинает
 * перетаскивание. Текст при открытии выделен целиком, поэтому набор сразу
 * заменяет дефолтное имя, а Esc оставляет его как было.
 */
function beginNameAfterPlace(shape) {
  const element = elOf(shape);
  if (!element) return;
  // У примечания, свободного текста и «немых» глифов (начальный/конечный
  // узел, перекрестие) бокса имени нет — править нечего, и редактор над такой
  // фигурой был бы ложью.
  if (!lyt(shape).boxes.some((b) => b.id === 'name')) return;
  editName(shape, { fresh: true });
  set({ hint: 'Имя: Enter — применить, Esc — оставить как есть.' });
}

/**
 * Имя, набранное сразу после постановки, и сама постановка — ОДИН шаг отмены.
 *
 * Фигура появилась вместе с именем, поэтому Ctrl+Z убирает её целиком, а не
 * оставляет «Вариант использования1» с отменённым именем. Снимок берётся у
 * записи о постановке: она уже держит модель ДО фигуры. Запись снимается
 * только если она точно про эту фигуру — в её снимке элемента ещё нет; иначе
 * имя остаётся отдельным шагом, и ничего не теряется.
 */
function commitFreshName(elementId, placeLabel, value) {
  const name = String(value ?? '').trim();
  const last = store._undo[store._undo.length - 1];
  const place = last && last.label === placeLabel
    && !(last.model.elements ?? []).some((e) => e.id === elementId)
    ? store._undo.pop() : null;
  const depth = store._undo.length;
  commit(placeLabel, (m) => {
    const e = findElement(m, elementId);
    if (e) e.name = name;
  });
  if (!place) return;
  if (store._undo.length > depth) {
    // Новая запись теперь отменяет и постановку: её снимок — состояние до фигуры.
    store._undo[store._undo.length - 1] = { label: placeLabel, model: place.model };
  } else {
    // Имя не изменилось (Enter по дефолтному) — commit ничего не записал,
    // и запись о постановке возвращается на место.
    store._undo.push(place);
  }
  // Подсказка «Enter — применить» больше не про что: редактора уже нет.
  if (store.ui.hint) set({ hint: '' });
}

function editNote(shape) {
  const element = elOf(shape);
  if (!element) return;
  startInlineEdit({
    x: shape.x + 4, y: shape.y + 4, w: shape.w - 16, h: shape.h - 16,
    value: element.note ?? '',
    multiline: true,
    commit: (v) => commit('Правка примечания', (m) => {
      const e = findElement(m, element.id);
      if (e) e.note = v;
    }),
  });
}

function editMemberRow(shape, field, index) {
  const element = elOf(shape);
  const rows = Array.isArray(element?.[field]) ? element[field] : [];
  const row = rows[index];
  const layout = lyt(shape);
  const box = layout.boxes.find((b) => b.id === field);
  if (!box || !row) return;
  const y = shape.y + box.y + PAD_Y + index * LINE_H;
  startInlineEdit({
    x: shape.x + 20, y, w: layout.w - 24, h: LINE_H + 2,
    value: memberLines(element, field)[index] ?? '',
    commit: (v) => commit('Правка члена класса', (m) => {
      const e = findElement(m, element.id);
      if (!e) return;
      setMemberRow(e, field, index, v);
    }),
  });
}

/** A text compartment line (entry / do / exit, extension points). */
function editLine(shape, field, index) {
  const element = elOf(shape);
  const layout = lyt(shape);
  const box = layout.boxes.find((b) => b.id === field);
  if (!box) return;
  const y = shape.y + box.y + PAD_Y + index * LINE_H;
  startInlineEdit({
    x: shape.x + PAD_X, y, w: layout.w - 2 * PAD_X, h: LINE_H + 2,
    value: (element[field] ?? [])[index] ?? '',
    commit: (v) => commit('Правка строки', (m) => {
      const e = findElement(m, element.id);
      if (e) setLine(e, field, index, v);
    }),
  });
}

function editConnectorName(link) {
  const pts = linkPointsOf(link);
  if (!pts) return;
  const rel = relOf(store.model, link);
  if (!rel) return;
  const def = NOTATION.connectors[rel.kind];
  const mid = def?.sequence
    ? { x: (pts[0][0] + pts[pts.length - 1][0]) / 2, y: Math.min(...pts.map((p) => p[1])) - 6 }
    : labelPos(pts, link.ldx, link.ldy, link.labelOrientation);
  set({ selection: [{ kind: 'connector', id: link.id }] });
  startInlineEdit({
    x: mid.x - 60, y: mid.y - LINE_H / 2, w: 120, h: LINE_H + 4,
    value: rel.name ?? '',
    commit: (v) => commit('Правка имени связи', (m) => {
      const l = findLink(m, link.id);
      const r = l && findRelationship(m, l.relId);
      if (r) r.name = v.trim();
    }),
  });
}

export function startEditSelected() {
  const kind = selectionKind();
  if (!kind) return;
  const sel = store.ui.selection[0];
  if (kind === 'shape') {
    const s = findShape(store.model, sel.id);
    if (s) editName(s);
  } else {
    const l = findLink(store.model, sel.id);
    if (l) editConnectorName(l);
  }
}

/** Add a member row to the element behind the selected shape and edit it. */
export function addMemberRowOnSheet(shape, field) {
  const element = elOf(shape);
  if (!element) return;
  addMemberRow(element, field);
  store._rev += 1;
  const layout = lyt(shape);
  const box = layout.boxes.find((b) => b.id === field);
  if (!box) return;
  const index = (Array.isArray(element[field]) ? element[field].length : 1) - 1;
  const y = shape.y + box.y + PAD_Y + index * LINE_H;
  startInlineEdit({
    x: shape.x + 20, y, w: layout.w - 24, h: LINE_H + 2,
    value: '',
    commit: (v) => commit('Добавление члена класса', (m) => {
      const e = findElement(m, element.id);
      if (!e) return;
      setMemberRow(e, field, index, v);
    }),
  });
  emit();
}

/* ------------------------------------------------------ контекстное меню */

/**
 * Буфер обмена живёт в clipboard.js, а тот сам импортирует этот модуль:
 * статический импорт дал бы цикл. Модуль всё равно уже загружен (его тянет
 * main.js), поэтому это не запрос в сеть, а поиск в карте модулей.
 */
const clipboard = () => import('./clipboard.js');

/**
 * Правый клик: меню про то, на что щёлкнули.
 *
 * Выделение правая кнопка НЕ меняет, если объект уже выделен (меню «про эту
 * фигуру» с чужим выделением в инспекторе — худший вид меню), и меняет, если
 * не выделен: иначе пункт «Переименовать» правил бы не тот объект. По пустому
 * месту выделение остаётся как было — «Вставить» и «Вписать» его не требуют,
 * а снимать выделение правой кнопкой никто не просил.
 */
function onContextMenu(e) {
  e.preventDefault();
  // Правый клик — тоже «клик мимо поля»: набранное имя применяется, а не
  // пропадает. Без этого «Переименовать» из меню гасило открытый редактор
  // (startInlineEdit зовёт cancelInlineEdit) и возвращало ДЕФОЛТНОЕ имя.
  commitEditor();
  const pt = toModel(e);
  const target = contextTarget(e, pt);
  if (target && !isSelected(target.kind, target.id)) selectOnly(target.kind, target.id);
  const items = !target ? emptyMenu()
    : target.kind === 'shape' ? shapeMenu(target.id) : connectorMenu(target.id);
  openContextMenu(e.clientX, e.clientY, items);
}

/** Что под правой кнопкой: фигура, связь или пустое место листа. */
function contextTarget(e, pt) {
  const node = e.target.closest?.('[data-kind]');
  const kind = node?.getAttribute('data-kind');
  const id = node?.getAttribute('data-id');
  // Ручки выделения и изломы лежат ПОВЕРХ своего объекта: меню должно быть про
  // фигуру или связь, а не про квадратик 9×9.
  if (kind === 'shape' || kind === 'handle') return { kind: 'shape', id };
  if (kind === 'conn' || kind === 'end' || kind === 'wp') return { kind: 'connector', id };
  // Мимо разметки — спрашиваем те же функции попадания, что и левая кнопка.
  const s = targetAt(pt);
  if (s) return { kind: 'shape', id: s.id };
  const l = linkAt(pt);
  return l ? { kind: 'connector', id: l.id } : null;
}

/** Пункты для фигуры. Все зовут существующие функции, а не повторяют их. */
/**
 * Две половины комбинированного фрагмента: успех и исключение.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ КОМАНДА. В UML у фрагмента нет оператора try/except — есть
 * `alt` с двумя операндами и сторожем у каждого, и в пособии try/except
 * рисуется именно так. Модель операнды уже знала (`element.operands`), но
 * добавить второй можно было только кнопкой в глубине инспектора, а книга
 * ставит «Add Operand» в контекстное меню фигуры. Здесь та же операция одним
 * кликом: два операнда, у каждого свой сторож.
 */
function splitFragment(elementId) {
  commit('Разделение фрагмента на две половины', (m) => {
    const e = findElement(m, elementId);
    if (!e) return;
    const ops = Array.isArray(e.operands) ? e.operands : [];
    if (ops.length >= 2) return;
    const first = ops[0] ?? { id: 'o1', guard: '', messages: [] };
    e.operands = [
      { ...first, id: first.id || 'o1', guard: first.guard || 'успех' },
      { id: 'o2', guard: 'исключение', messages: [] },
    ];
  });
}

function shapeMenu(shapeId) {
  const shape = findShape(store.model, shapeId);
  const element = elOf(shape);
  if (!shape || !element) return [];
  const name = element.name || element.kind;
  const operands = Array.isArray(element.operands) ? element.operands : [];
  return [
    { label: 'Переименовать', shortcut: 'F2', run: () => startEditSelected() },
    // Комбинированный фрагмент: половины try/except — там же, где «Add
    // Operand» в книге. У остальных фигур этого пункта нет.
    ...(element.kind === 'fragment' ? [
      operands.length >= 2
        ? {
          label: 'Оставить одну половину',
          hint: 'второй операнд и его сторож удаляются',
          run: () => commit('Удаление второго операнда', (m) => {
            const e = findElement(m, element.id);
            if (e?.operands?.length > 1) e.operands = e.operands.slice(0, 1);
          }),
        }
        : {
          label: 'Разделить на половины: успех / исключение',
          hint: 'alt с двумя операндами и сторожем у каждого',
          run: () => splitFragment(element.id),
        },
      '-',
    ] : []),
    { label: 'Свойства', run: showPropsTab },
    { label: 'Стереотип…', hint: 'поле стереотипа в инспекторе', run: focusStereotype },
    '-',
    { label: 'Дублировать', shortcut: 'Ctrl+D', run: () => clipboard().then((m) => m.duplicateSelection()) },
    { label: 'Копировать', shortcut: 'Ctrl+C', run: copyWithHint },
    '-',
    { label: 'Снять с диаграммы', shortcut: 'Delete', run: () => deleteSelection() },
    {
      label: 'Удалить из модели',
      shortcut: 'Shift+Delete',
      hint: `«${name}» исчезнет со всех диаграмм модели`,
      danger: true,
      run: () => deleteElementFromModel(),
    },
  ];
}

/** Пункты для связи. */
function connectorMenu(linkId) {
  const link = findLink(store.model, linkId);
  const rel = relOf(store.model, link);
  if (!link || !rel) return [];
  const name = rel.name || NOTATION.connectors[rel.kind]?.label || rel.kind;
  return [
    { label: 'Переименовать', shortcut: 'F2', run: () => startEditSelected() },
    { label: 'Свойства', run: showPropsTab },
    '-',
    { label: 'Снять с диаграммы', shortcut: 'Delete', run: () => deleteSelection() },
    {
      label: 'Удалить из модели',
      shortcut: 'Shift+Delete',
      hint: `«${name}» исчезнет со всех диаграмм модели`,
      danger: true,
      run: () => deleteRelationshipFromModel(),
    },
  ];
}

/** Пункты по пустому месту: то, что не требует выделения. */
function emptyMenu() {
  return [
    {
      label: 'Вставить',
      shortcut: 'Ctrl+V',
      disabled: !store.clipboard,
      run: () => clipboard().then((m) => m.pasteClipboard()),
    },
    { label: 'Вписать в окно', shortcut: 'Ctrl+0', run: () => fitToWindow() },
    '-',
    // Переключатель — галочкой в подписи, как «✓ Сетка» в меню «Вид»: пункт
    // меню остаётся одной строкой и тем же пунктом, что и в шапке.
    { label: `${store.ui.showGrid ? '✓ ' : ''}Сетка`, run: () => set({ showGrid: !store.ui.showGrid }) },
  ];
}

/** Ctrl+C из меню: копирует и говорит, сколько, — как это делает Ctrl+C. */
function copyWithHint() {
  return clipboard().then((m) => {
    const n = m.copySelection();
    set({ hint: n ? `Скопировано: ${n}.` : 'Нечего копировать — выделите фигуры на листе.' });
  });
}

/**
 * Открыть вкладку «Свойства» справа — теми же двумя кнопками, что у человека:
 * вкладкой и переключателем панели в шапке. Своей логики показа здесь нет,
 * иначе панель разошлась бы с этими кнопками.
 */
function showPropsTab() {
  const tab = document.querySelector('#right .tab[data-tab="props"]');
  if (tab && !tab.classList.contains('active')) tab.click();
  if (!propsVisible()) {
    document.querySelector('#toolbar button[aria-label="Показать или скрыть правую панель"]')?.click();
  }
}

/** Виден ли инспектор на экране: и в доке, и оверлеем в узком окне. */
function propsVisible() {
  const r = document.getElementById('props')?.getBoundingClientRect();
  return !!r && r.width > 0 && r.right > 0 && r.left < window.innerWidth;
}

/** «Стереотип…»: открыть инспектор и встать в фильтр стереотипов. */
function focusStereotype() {
  showPropsTab();
  // Панель перерисовывается в микрозадаче после смены выделения, поэтому поле
  // ищем на следующем кадре: сейчас в DOM ещё может стоять прежняя разметка.
  requestAnimationFrame(() => {
    const input = document.querySelector('#props .stereo-filter input.filter');
    if (!input) return;
    input.focus();
    input.select();
  });
}
