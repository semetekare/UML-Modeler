// Раскладка корпуса: общая геометрия для сборщика (build.mjs) и проверки
// (check.mjs).
//
// Числа не выдуманы: размеры фигур берутся из `app/notation/uml.json`
// (`defaultSize`), а всё, что зависит от текста, — из `app/src/model/geometry.js`,
// то есть из тех же функций, которыми рисует рендерер. Поэтому «фигура
// помещается» здесь значит то же, что на листе.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPackage, NOTATION } from '../../app/src/model/notation.js';
import {
  layoutOf, routePoints, edgePoint, textWidth,
  LIFELINE_HEAD, ACTOR_LIFELINE_HEAD, MESSAGE_GAP,
} from '../../app/src/model/geometry.js';
import { serialize, deserialize } from '../../app/src/io/umljson.js';

export { NOTATION, layoutOf, routePoints, edgePoint, textWidth, serialize, deserialize };
export { LIFELINE_HEAD, ACTOR_LIFELINE_HEAD, MESSAGE_GAP };

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const CORPUS = path.join(ROOT, 'tests/corpus');
export const OUT = HERE;

/** Сетка листа и поля. `gridSize` — app/mechanics.json, значение «grid size». */
export const GRID = 10;
export const MARGIN = 60;
/** Промежуток между соседними фигурами: 40–60 px по постановке. */
export const GAP = 60;
export const MIN_SHEET = { w: 600, h: 400 };

export const snap = (v) => Math.round(v / GRID) * GRID;
export const ceilTo = (v) => Math.ceil(v / GRID) * GRID;
export const round3 = (v) => Math.round(v * 1000) / 1000;

/** Загрузить пакет нотации: без него `deserialize` не знает ни одного вида. */
export function loadNotation() {
  applyPackage(JSON.parse(fs.readFileSync(path.join(ROOT, 'app/notation/uml.json'), 'utf8')));
}

export const corpusFiles = () => fs.readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json')
  .sort();

export const readCorpus = (figure) =>
  JSON.parse(fs.readFileSync(path.join(CORPUS, `${figure}.json`), 'utf8'));

/**
 * Модель корпуса в терминах `uml-model/3`: корпус пишет `diagrams[].type` и
 * `connectors`, редактор читает `kind` и `links` (README корпуса §4).
 */
export function canonicalSource(src) {
  const renamed = {
    ...src,
    diagrams: (src.diagrams ?? []).map((d) => ({
      ...d, kind: d.type, links: d.connectors, type: undefined, connectors: undefined,
    })),
  };
  const repairs = [];
  const model = deserialize(JSON.stringify(renamed), { repairs });
  return { model, repairs, canonical: JSON.parse(serialize(model)) };
}

/* ------------------------------------------------------------- размеры */

/**
 * Размер фигуры: `defaultSize` из нотации как нижняя граница, дальше — столько,
 * сколько просит содержимое (`layoutOf` считает по имени, стереотипу и членам).
 * Увеличиваем до устойчивого состояния: ширина влияет на перенос строк.
 */
export function sizeFor(element, { minW, minH } = {}) {
  const def = NOTATION.shapes[element.kind]?.defaultSize ?? { w: 120, h: 80 };
  let w = Math.max(minW ?? 0, def.w);
  let h = Math.max(minH ?? 0, def.h);
  const shape = { x: 0, y: 0, w, h };
  for (let i = 0; i < 6; i += 1) {
    const L = layoutOf(shape, element);
    const nw = Math.max(w, Math.ceil(L.w));
    const nh = Math.max(h, Math.ceil(L.h));
    if (nw === w && nh === h) break;
    w = nw;
    h = nh;
    shape.w = w;
    shape.h = h;
  }
  return { w: ceilTo(w), h: ceilTo(h) };
}

/** Действительный прямоугольник фигуры на листе — тот, что рисует рендерер. */
export function boxOf(shape, element) {
  const L = layoutOf(shape, element);
  return { x: shape.x, y: shape.y, w: L.w, h: L.h };
}

/**
 * Габарит для раскладки: у актёра имя нарисовано под фигурой и шире её, поэтому
 * соседа надо отодвигать по имени, а не по узкому боксу.
 */
export function footprintOf(shape, element) {
  const box = boxOf(shape, element);
  if (NOTATION.shapes[element.kind]?.style === 'actor') {
    const nameW = Math.max(textWidth(element.name, { bold: true }),
      textWidth(element.stereotype ? `«${element.stereotype}»` : '')) + 24;
    return { x: box.x - Math.max(0, (nameW - box.w) / 2), y: box.y, w: Math.max(box.w, nameW), h: box.h };
  }
  return box;
}

/* --------------------------------------------------------------- сетка */

/**
 * Сетка: колонки и ряды, ширина колонки — максимум по её фигурам, высота ряда —
 * максимум по его фигурам, фигура центрируется в своей ячейке. Число колонок
 * выбирается по отношению сторон листа (4:3), а не вручную.
 *
 * `fill: 'centre'` заполняет ячейки от середины сетки к краям: так фигура со
 * многими связями оказывается в центре, а её соседи — вокруг, и маршрут с одним
 * изломом не упирается в чужую фигуру.
 *
 * `exactCols` фиксирует число колонок: нужно полосе внутри листа, где ширину
 * задаёт не отношение сторон, а соседняя полоса.
 */
export function gridPlace(items, { gap = GAP, aspect = 4 / 3, cols, exactCols, fill = 'row' } = {}) {
  const n = items.length;
  if (!n) return { placed: [], w: 0, h: 0 };
  const from = exactCols ?? 1;
  const to = exactCols ?? cols ?? n;
  let best = null;
  for (let c = from; c <= to; c += 1) {
    const rows = Math.ceil(n / c);
    const cells = (fill === 'centre' ? centreOutCells(c, rows) : rowCells(c, rows)).slice(0, n);
    const colW = Array(c).fill(0);
    const rowH = Array(rows).fill(0);
    cells.forEach((cell, i) => {
      colW[cell.c] = Math.max(colW[cell.c], items[i].w);
      rowH[cell.r] = Math.max(rowH[cell.r], items[i].h);
    });
    const W = colW.reduce((a, b) => a + b, 0) + gap * (c - 1);
    const H = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1);
    const score = Math.abs(Math.log((W / H) / aspect));
    if (!best || score < best.score - 1e-9) best = { c, rows, colW, rowH, W, H, score, cells };
  }
  const colX = [];
  let x = 0;
  for (let k = 0; k < best.c; k += 1) { colX.push(x); x += best.colW[k] + gap; }
  const rowY = [];
  let y = 0;
  for (let r = 0; r < best.rows; r += 1) { rowY.push(y); y += best.rowH[r] + gap; }
  const placed = items.map((it, i) => {
    const { r, c } = best.cells[i];
    return {
      ...it,
      x: snap(colX[c] + (best.colW[c] - it.w) / 2),
      y: snap(rowY[r] + (best.rowH[r] - it.h) / 2),
    };
  });
  return { placed, w: best.W, h: best.H };
}

/** Ячейки сетки построчно. */
function rowCells(cols, rows) {
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) cells.push({ r, c });
  }
  return cells;
}

/** Ячейки сетки от середины к краям: сначала центр, дальше кольцами. */
function centreOutCells(cols, rows) {
  const cr = (rows - 1) / 2;
  const cc = (cols - 1) / 2;
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({ r, c, d: (r - cr) ** 2 + (c - cc) ** 2 });
    }
  }
  cells.sort((p, q) => p.d - q.d
    || Math.abs(p.r - cr) - Math.abs(q.r - cr)
    || Math.abs(p.c - cc) - Math.abs(q.c - cc)
    || p.r - q.r || p.c - q.c);
  return cells;
}

/* ------------------------------------------------------------- маршруты */

const EPS = 1;

/** Пересекает ли отрезок внутренность прямоугольника (по Лиан-Барски). */
export function segmentHitsBox(p, q, box) {
  const x0 = box.x + EPS;
  const x1 = box.x + box.w - EPS;
  const y0 = box.y + EPS;
  const y1 = box.y + box.h - EPS;
  if (x0 >= x1 || y0 >= y1) return false;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  const edges = [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]];
  for (const [pDen, qNum] of edges) {
    if (Math.abs(pDen) < 1e-12) {
      if (qNum < 0) return false;
      continue;
    }
    const t = qNum / pDen;
    if (pDen < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

export function pathHitsBox(pts, box) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (segmentHitsBox(pts[i], pts[i + 1], box)) return true;
  }
  return false;
}

const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const SIDES = ['right', 'left', 'top', 'bottom'];

/**
 * Точки крепления пары сторон. Для обращённых друг к другу сторон t выбирается
 * так, чтобы отрезок был строго горизонтальным (вертикальным): общая высота
 * берётся из пересечения вертикальных промежутков фигур.
 */
export function anchors(a, b, s1, s2) {
  const vertical = (s1 === 'left' || s1 === 'right') && (s2 === 'left' || s2 === 'right');
  const horizontal = (s1 === 'top' || s1 === 'bottom') && (s2 === 'top' || s2 === 'bottom');
  let t1 = 0.5;
  let t2 = 0.5;
  if (vertical) {
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.h, b.y + b.h);
    const y = lo <= hi ? (lo + hi) / 2 : Math.max(a.y, Math.min(a.y + a.h, b.y + b.h / 2));
    t1 = clampT((y - a.y) / a.h);
    t2 = clampT((y - b.y) / b.h);
  } else if (horizontal) {
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    const x = lo <= hi ? (lo + hi) / 2 : Math.max(a.x, Math.min(a.x + a.w, b.x + b.w / 2));
    t1 = clampT((x - a.x) / a.w);
    t2 = clampT((x - b.x) / b.w);
  }
  return { t1: round3(t1), t2: round3(t2) };
}

/** Точки крепления: выровненная первой, дальше — сдвиги вдоль стороны. */
function tOptions(a, b, s1, s2) {
  const aligned = anchors(a, b, s1, s2);
  const out = [{ t1: aligned.t1, t2: aligned.t2, cost: 0 }];
  for (const t1 of [0.5, 0.25, 0.75]) {
    for (const t2 of [0.5, 0.25, 0.75]) {
      const same = round3(t1) === aligned.t1 && round3(t2) === aligned.t2;
      if (same) continue;
      const cost = (round3(t1) === aligned.t1 ? 0 : 1) + (round3(t2) === aligned.t2 ? 0 : 1);
      out.push({ t1, t2, cost });
    }
  }
  return out;
}

const clampT = (t) => Math.min(0.9, Math.max(0.1, t));

/** Порядок перебора пар сторон: сначала естественные для расположения. */
function sidePairs(a, b) {
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
  const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const out = horiz ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
  const inn = OPPOSITE[out];
  const list = [];
  for (const s1 of SIDES) {
    for (const s2 of SIDES) {
      let cost = 0;
      if (s1 !== out) cost += 4;
      if (s2 !== inn) cost += 4;
      if (s1 === s2) cost += 8;
      if (s2 === OPPOSITE[s1] && s1 !== out) cost += 1;
      list.push({ s1, s2, cost });
    }
  }
  list.sort((p, q) => p.cost - q.cost || SIDES.indexOf(p.s1) - SIDES.indexOf(q.s1)
    || SIDES.indexOf(p.s2) - SIDES.indexOf(q.s2));
  return list;
}

export const routeOf = (a, s1, t1, b, s2, t2, route = 'rect') => routePoints(
  edgePoint({ x: a.x, y: a.y, w: a.w, h: a.h }, a, s1, t1),
  edgePoint({ x: b.x, y: b.y, w: b.w, h: b.h }, b, s2, t2),
  route,
);

/**
 * Конец связи выбирается по взаимному расположению фигур и проверяется тем же
 * `routePoints`, что и на листе: перебираются пары сторон от естественной к
 * нейтральной, берётся первая, чей маршрут не задевает чужую фигуру.
 */
export function routeLink(a, b, obstacles) {
  const foreign = (pts) => obstacles.some((o) => pathHitsBox(pts, o));
  if (a.shapeId === b.shapeId) {
    const t1 = 0.3;
    const t2 = 0.7;
    const pts = routeOf(a.box, 'right', t1, b.box, 'right', t2);
    return { from: { shapeId: a.shapeId, side: 'right', t: t1 }, to: { shapeId: b.shapeId, side: 'right', t: t2 }, pts, clean: !foreign(pts) };
  }
  const candidates = [];
  for (const { s1, s2, cost } of sidePairs(a.box, b.box)) {
    for (const { t1, t2, cost: tcost } of tOptions(a.box, b.box, s1, s2)) {
      const pts = routeOf(a.box, s1, t1, b.box, s2, t2);
      const length = pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
      candidates.push({
        from: { shapeId: a.shapeId, side: s1, t: round3(t1) },
        to: { shapeId: b.shapeId, side: s2, t: round3(t2) },
        pts,
        cost: cost + tcost + length / 400,
        clean: !foreign(pts),
      });
    }
  }
  candidates.sort((p, q) => p.cost - q.cost);
  const best = candidates.find((c) => c.clean) ?? candidates[0];
  return { from: best.from, to: best.to, pts: best.pts, clean: best.clean };
}
