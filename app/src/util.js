// Small DOM / drawing helpers. No dependencies, plain ES module.

/** Create an element; attrs are applied to properties or attributes. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node && (k === 'disabled' || k === 'value' || k === 'hidden' || k === 'checked')) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element, optionally inside a parent. */
export function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.append(node);
  return node;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Deep clone via structured copy (models are plain JSON data). */
export const deepClone = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

let idSeq = 0;
/** Short, stable, file-friendly id. */
export const uid = (prefix) => `${prefix}${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** rAF-throttled callback (for pointermove redraws). */
export function rafThrottle(fn) {
  let queued = false;
  return (...args) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

/** Download text as a file. */
export function downloadText(text, fileName, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slugify = (s) =>
  (String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'untitled');

/**
 * Русская форма слова при числе: 1 элемент, 2 элемента, 5 элементов.
 * Нужна там, где число попадает в сообщение человеку (ремонт файла,
 * сколько диаграмм открылось) — «1 элементов» читается как ошибка.
 */
export const plural = (n, one, few, many) => {
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Distance from point to a polyline (in model units). */
export function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best) best = d;
  }
  return best;
}

/** Point on a polyline at fraction `f` of its length (and its unit normal). */
export function pointAtFraction(pts, f) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(l);
    total += l;
  }
  let target = total * f;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? target / segs[i] : 0;
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l = segs[i] || 1;
      // Unit normal pointing up-left-ish; labels sit above the line.
      return {
        x: x1 + t * dx, y: y1 + t * dy,
        nx: -dy / l, ny: dx / l,
      };
    }
    target -= segs[i];
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1], nx: 0, ny: -1 };
}
