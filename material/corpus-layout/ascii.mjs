// Текстовый просмотр листа: рамки фигур подписями и ломаные связей точками.
// Нужен, чтобы читать раскладку глазами в терминале (и вставлять в документ).
//
// Запуск: node material/corpus-layout/ascii.mjs <номер> [ширина]

import fs from 'node:fs';
import path from 'node:path';

import { loadNotation, NOTATION, boxOf, OUT, LIFELINE_HEAD, routePoints } from './lib.mjs';

loadNotation();

const edgePointOf = (box, end) => {
  const t = end.t ?? 0.5;
  if (end.side === 'top') return { x: box.x + box.w * t, y: box.y, side: 'top', t };
  if (end.side === 'bottom') return { x: box.x + box.w * t, y: box.y + box.h, side: 'bottom', t };
  if (end.side === 'left') return { x: box.x, y: box.y + box.h * t, side: 'left', t };
  return { x: box.x + box.w, y: box.y + box.h * t, side: 'right', t };
};

export function asciiSheet(model, { cols = 100 } = {}) {
  const d = model.diagrams[0];
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const box = new Map(d.shapes.map((s) => [s.id, boxOf(s, el.get(s.elementId))]));
  const relOf = new Map(model.relationships.map((r) => [r.id, r]));
  const W = model.sheet.w;
  const H = model.sheet.h;
  const kx = cols / W;
  const ky = kx * 2; // знакоместо вдвое выше, чем шире
  const rows = Math.ceil(H / (1 / ky));
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const put = (x, y, ch) => {
    const c = Math.round(x * kx);
    const r = Math.round(y / (1 / ky));
    if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = ch;
  };
  const text = (x, y, s) => {
    const c = Math.round(x * kx);
    const r = Math.round(y / (1 / ky));
    for (let i = 0; i < s.length; i += 1) {
      if (r >= 0 && r < rows && c + i >= 0 && c + i < cols) grid[r][c + i] = s[i];
    }
  };

  for (const s of d.shapes) {
    const e = el.get(s.elementId);
    const b = box.get(s.id);
    const x0 = Math.round(b.x * kx);
    const x1 = Math.round((b.x + b.w) * kx);
    const y0 = Math.round(b.y / (1 / ky));
    const y1 = Math.round((b.y + b.h) / (1 / ky));
    for (let c = x0; c <= x1; c += 1) { put(c / kx, b.y, '-'); put(c / kx, b.y + b.h, '-'); }
    for (let r = y0; r <= y1; r += 1) { put(b.x, r / ky, '|'); put(b.x + b.w, r / ky, '|'); }
    put(b.x, b.y, '+'); put(b.x + b.w, b.y, '+'); put(b.x, b.y + b.h, '+'); put(b.x + b.w, b.y + b.h, '+');
    const label = `${s.id}:${e.name}`.slice(0, Math.max(2, x1 - x0 - 1));
    text(b.x + 6, b.y + Math.min(b.h / 2, 20), label);
  }

  for (const l of d.links) {
    const rel = relOf.get(l.relId);
    if (!rel) continue;
    const a = box.get(l.from.shapeId);
    const b = box.get(l.to.shapeId);
    if (!a || !b) continue;
    let pts;
    if (NOTATION.connectors[rel.kind]?.sequence) {
      if (l.from.shapeId === l.to.shapeId) {
        const x = a.x + a.w;
        pts = [[x, l.y], [x + 40, l.y], [x + 40, l.y + 20], [x, l.y + 20]];
      } else {
        pts = [[a.x + a.w / 2, l.y], [b.x + b.w / 2, l.y]];
      }
    } else {
      pts = routePoints(edgePointOf(a, l.from), edgePointOf(b, l.to));
    }
    for (let i = 0; i < pts.length - 1; i += 1) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 4));
      for (let t = 0; t <= n; t += 1) {
        put(x1 + ((x2 - x1) * t) / n, y1 + ((y2 - y1) * t) / n, '*');
      }
    }
  }

  // Подписи фигур поверх связей: имя важнее линии.
  for (const s of d.shapes) {
    const e = el.get(s.elementId);
    const b = box.get(s.id);
    const x0 = Math.round(b.x * kx);
    const x1 = Math.round((b.x + b.w) * kx);
    const label = `${s.id}:${e.name}`.slice(0, Math.max(2, x1 - x0 - 1));
    text(b.x + 6, b.y + Math.min(b.h / 2, 20), label);
  }

  return grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const figure = process.argv[2];
  const cols = Number(process.argv[3] ?? 110);
  const model = JSON.parse(fs.readFileSync(path.join(OUT, `${figure}.uml.json`), 'utf8'));
  console.log(asciiSheet(model, { cols }));
}
