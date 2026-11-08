// Пересечения связей — «скачки» на линии (line jumps).
//
// Приложение хранит у связи одно число `connectorLineJumps` и одно у диаграммы
// (`DefaultLineJumps` в настройках). Пять кодов названы его собственной
// таблицей значений `lib01.jar!v/cni/b#a(String,String,int)V` — той же, что
// печатает подписи в диалоге свойств:
//
//   +0x043a "connectorLineJumps.0" → Off
//   +0x0447 "connectorLineJumps.1" → Arc
//   +0x0453 "connectorLineJumps.2" → Gap
//   +0x0460 "connectorLineJumps.3" → Square
//   +0x046d "connectorLineJumps.4" → Follow Diagram
//
// Реестр свойств (`lib01.jar!v/cni/a#<clinit>+0x0e2e`) ставит связи 4 —
// «как на диаграмме», а настройка `vpplatform.jar!v/dap/r#<init>+0x003f`
// держит `Eb = 0`: по умолчанию скачков нет.
//
// Формы и размеры скачка взяты из собственных значков панели (18×18,
// lib02.jar!icons/VPUML/toolbar/LineJumps*.png) — там 1 px линия пересекает
// другую, и видно ровно то, что рисует программа: дуга 6×3, разрыв по 2.5 px
// от центра пересечения, квадрат 5×4. Три кода размера (0…2) существуют, но
// ни радиуса, ни множителя в 19 банках нет — поэтому «шаг роста» помечен в
// листе как decision, а не выдан за адрес.

import { MECHANICS } from '../mechanics.generated.js';

/** Коды `connectorLineJumps` — те же числа, что у оригинала (§26b). */
export const LINE_JUMPS = {
  off: MECHANICS.lineJumpsOff,                       // 0
  arc: MECHANICS.lineJumpsArc,                       // 1
  gap: MECHANICS.lineJumpsGap,                       // 2
  square: MECHANICS.lineJumpsSquare,                 // 3
  followDiagram: MECHANICS.lineJumpsFollowDiagram,   // 4
};

/** Значение связи, которое значит «спроси диаграмму». */
export const JUMP_INHERIT = MECHANICS.lineJumpsInherit;      // 4

/** Пять пунктов списка в инспекторе — в порядке оригинала. */
export const JUMP_OPTIONS = [
  [LINE_JUMPS.off, 'нет'],
  [LINE_JUMPS.arc, 'дуга'],
  [LINE_JUMPS.gap, 'разрыв'],
  [LINE_JUMPS.square, 'квадрат'],
  [LINE_JUMPS.followDiagram, 'как на диаграмме'],
];

/** Есть ли такой код. */
export const isLineJumps = (code) => Number.isInteger(code)
  && code >= LINE_JUMPS.off && code <= LINE_JUMPS.followDiagram;

/**
 * Код связи → что рисовать. `4` («как на диаграмме») и отсутствие значения
 * упираются в значение самой диаграммы — оригинал хранит его в строке
 * `DIAGRAM` (`connectorLineJumps=0…3`), — а если и там ничего нет, в
 * настройку программы `DefaultLineJumps`, чьё умолчание 0: у сеттера
 * `v/dap/r#e(B)V` диапазон 0…3, четвёрки там нет вовсе.
 */
export function resolveJumps(code, diagramCode = null) {
  if (isLineJumps(code) && code !== LINE_JUMPS.followDiagram) return code;
  const d = Number(diagramCode);
  if (Number.isInteger(d) && d >= LINE_JUMPS.off && d <= LINE_JUMPS.square) return d;
  return MECHANICS.defaultLineJumps;
}

/** Код размера 0…2, обрезанный по диапазону сеттера `v/dap/r#bR(B)V`. */
export function jumpSize(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return MECHANICS.lineJumpSizeDefault;
  return Math.max(0, Math.min(MECHANICS.lineJumpSizeMax, Math.round(n)));
}

/**
 * Геометрия скачка для кода размера. Нулевой код — это рисунок значка
 * (6×3 / 2.5 / 5×4); каждый следующий расширяет его на `lineJumpSizeStep`.
 */
export function jumpShape(size = MECHANICS.lineJumpSizeDefault) {
  const grow = MECHANICS.lineJumpSizeStep * jumpSize(size);
  return {
    half: MECHANICS.lineJumpArcWidth / 2 + grow,          // полудлина дуги
    height: MECHANICS.lineJumpArcHeight + grow,           // высота дуги
    gapHalf: MECHANICS.lineJumpGapHalf + grow / 2,        // полразрыва
    squareHalf: MECHANICS.lineJumpSquareWidth / 2 + grow / 2,
    squareHeight: MECHANICS.lineJumpSquareHeight + grow / 2,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Точка пересечения двух отрезков или null (параллельные/вырожденные — null). */
export function segmentCrossing(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (!den) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a[0] + rx * t, y: a[1] + ry * t, t, u };
}

/**
 * Все пересечения двух ломаных: для каждой — номер сегмента первой ломаной,
 * доля вдоль него и точка. Концы в расчёт не идут: две связи, выходящие из
 * одной фигуры, встречаются в её же точке привязки, и скачок там не нужен.
 */
export function polylineCrossings(ptsA, ptsB) {
  const out = [];
  for (let i = 0; i < ptsA.length - 1; i += 1) {
    const a = ptsA[i];
    const b = ptsA[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    for (let j = 0; j < ptsB.length - 1; j += 1) {
      const hit = segmentCrossing(a, b, ptsB[j], ptsB[j + 1]);
      if (!hit) continue;
      // Доля вдоль сегмента A и отступ от обоих его концов в пикселях.
      const at = hit.t * len;
      if (at < 0.5 || len - at < 0.5) continue;
      out.push({ seg: i, t: hit.t, x: hit.x, y: hit.y, dist: at });
    }
  }
  out.sort((p, q) => p.seg - q.seg || p.t - q.t);
  return out;
}

/**
 * `d` для пути со скачками. Скачок живёт внутри одного прямого сегмента:
 * дуга — `L` до начала, `Q` через вершину, `L` дальше; разрыв — два подпути;
 * квадрат — ступенька вверх-вдоль-вниз.
 *
 * Скруглённые углы (`rounded`/`arcSize`) на такой связи не рисуются: скачок
 * и скругление — две разные правки одной геометрии, и смешивать их значит
 * получить дугу на дуге. Об этом сказано в §26d.
 */
export function jumpedPath(pts, hits, mode, size = MECHANICS.lineJumpSizeDefault) {
  const shape = jumpShape(size);
  const bySeg = new Map();
  for (const h of hits) {
    if (!bySeg.has(h.seg)) bySeg.set(h.seg, []);
    bySeg.get(h.seg).push(h);
  }
  let d = `M ${round2(pts[0][0])} ${round2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = len ? (x1 - x0) / len : 0;
    const uy = len ? (y1 - y0) / len : 0;
    // Нормаль вверх для горизонтального сегмента: у значка линия прыгает
    // вверх, а не вниз.
    const nx = uy;
    const ny = -ux;
    const list = (bySeg.get(i) ?? []).slice().sort((p, q) => p.t - q.t);
    for (const h of list) {
      const pad = mode === LINE_JUMPS.gap
        ? shape.gapHalf
        : mode === LINE_JUMPS.square ? shape.squareHalf : shape.half;
      // Скачок, которому не хватает места до конца сегмента, не рисуется:
      // лучше прямая, чем дуга, вылезшая за излом.
      if (h.dist - pad <= 0 || h.dist + pad >= len) continue;
      const bx = h.x - ux * pad;
      const by = h.y - uy * pad;
      const ex = h.x + ux * pad;
      const ey = h.y + uy * pad;
      d += ` L ${round2(bx)} ${round2(by)}`;
      if (mode === LINE_JUMPS.gap) {
        d += ` M ${round2(ex)} ${round2(ey)}`;
      } else if (mode === LINE_JUMPS.square) {
        const tx = nx * shape.squareHeight;
        const ty = ny * shape.squareHeight;
        d += ` L ${round2(bx + tx)} ${round2(by + ty)}`;
        d += ` L ${round2(ex + tx)} ${round2(ey + ty)}`;
        d += ` L ${round2(ex)} ${round2(ey)}`;
      } else {
        // Дуга: контрольная точка над серединой пересечения, на высоту
        // значка. `Q` вместо `A` — так дуга не зависит от направления
        // обхода и не может вывернуться на коротком сегменте.
        const cx = h.x + nx * shape.height * 2;
        const cy = h.y + ny * shape.height * 2;
        d += ` Q ${round2(cx)} ${round2(cy)} ${round2(ex)} ${round2(ey)}`;
      }
    }
    d += ` L ${round2(x1)} ${round2(y1)}`;
  }
  return d;
}