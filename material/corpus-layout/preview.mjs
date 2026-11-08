// Просмотр раскладки: рисует лист схематичным SVG — рамки фигур, имена и
// ломаные связей. Это не рендерер редактора (он живёт в app/ и сюда не
// переносится), а смотровое окно: по нему видно, читается ли серия.
//
// Запуск: node material/corpus-layout/preview.mjs [номера…]
// Результат: material/corpus-layout/preview/<номер>.svg

import fs from 'node:fs';
import path from 'node:path';

import {
  loadNotation, corpusFiles, NOTATION, boxOf, OUT, LIFELINE_HEAD, routePoints,
} from './lib.mjs';

loadNotation();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const polyline = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');

function edgePointOf(box, end) {
  const t = end.t ?? 0.5;
  if (end.side === 'top') return { x: box.x + box.w * t, y: box.y, side: 'top', t };
  if (end.side === 'bottom') return { x: box.x + box.w * t, y: box.y + box.h, side: 'bottom', t };
  if (end.side === 'left') return { x: box.x, y: box.y + box.h * t, side: 'left', t };
  return { x: box.x + box.w, y: box.y + box.h * t, side: 'right', t };
}

function renderFigure(model) {
  const d = model.diagrams[0];
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const box = new Map(d.shapes.map((s) => [s.id, boxOf(s, el.get(s.elementId))]));
  const relOf = new Map(model.relationships.map((r) => [r.id, r]));
  const parts = [];

  for (const s of d.shapes) {
    const e = el.get(s.elementId);
    const b = box.get(s.id);
    const style = NOTATION.shapes[e.kind]?.style;
    const dashed = style === 'boundary' || style === 'swimlane' || style === 'frame' || style === 'activity';
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff" stroke="#000" stroke-width="1"${dashed ? ' stroke-dasharray="6 4"' : ''}/>`);
    const head = (style === 'lifeline' || style === 'actorLifeline') ? LIFELINE_HEAD : 0;
    if (head) {
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${head}" fill="#fff" stroke="#000"/>`);
      parts.push(`<line x1="${b.x + b.w / 2}" y1="${b.y + head}" x2="${b.x + b.w / 2}" y2="${b.y + b.h}" stroke="#000" stroke-dasharray="6 4"/>`);
    }
    if (style === 'ellipse') {
      parts.push(`<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}" fill="none" stroke="#000"/>`);
    }
    const lines = [];
    if (e.stereotype) lines.push(`«${e.stereotype}»`);
    if (e.name && e.name !== 'не названо в тексте') lines.push(e.name);
    const cy = head ? b.y + head / 2 : b.y + 14;
    lines.forEach((t, i) => parts.push(
      `<text x="${b.x + b.w / 2}" y="${cy + i * 13}" font-size="11" text-anchor="middle" font-family="Arial">${esc(t)}</text>`,
    ));
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
    parts.push(`<path d="${polyline(pts)}" fill="none" stroke="#000" stroke-width="1"/>`);
    if (rel.name && rel.name !== 'не названо в тексте') {
      const mid = pts[Math.floor(pts.length / 2)];
      parts.push(`<text x="${mid[0]}" y="${mid[1] - 3}" font-size="9" text-anchor="middle" font-family="Arial">${esc(rel.name)}</text>`);
    }
  }

  const { w, h } = model.sheet;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="#fff"/>${parts.join('')}</svg>\n`;
}

const only = process.argv.slice(2);
const dir = path.join(OUT, 'preview');
fs.mkdirSync(dir, { recursive: true });
const files = corpusFiles().filter((f) => !only.length || only.includes(f.replace(/\.json$/, '')));
for (const file of files) {
  const figure = file.replace(/\.json$/, '');
  const model = JSON.parse(fs.readFileSync(path.join(OUT, `${figure}.uml.json`), 'utf8'));
  fs.writeFileSync(path.join(dir, `${figure}.svg`), renderFigure(model));
}
console.log(`просмотров записано: ${files.length} → ${path.relative(process.cwd(), dir)}/`);
