#!/usr/bin/env node
// Пересборка `clause-pages.json` — страница печатного издания для каждого
// констрейнта. Единственный шаг аудита, которому нужен `pdftotext`: сам
// `build.mjs` читает уже готовый JSON и остаётся на stdlib Node.
//
//   pdftotext -layout reference/spec/uml-2.5.1.pdf /tmp/uml.txt
//   node material/rules-coverage/pages.mjs /tmp/uml.txt
//
// Номер страницы берётся из колонтитула той страницы, на которой стоит
// маркер пункта (`- **имя**` в PDF — глиф маркера, затем имя). Порядок
// констрейнтов в PDF совпадает с порядком в переводе, поэтому сопоставление
// идёт монотонно: следующее имя ищется не раньше предыдущей страницы.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const textPath = process.argv[2];
if (!textPath) {
  console.error('usage: pages.mjs <pdftotext-output.txt>');
  process.exit(2);
}

const raw = fs.readFileSync(textPath, 'utf8');
const pages = raw.split('\f');

/** «232   Unified Modeling Language 2.5.1» → 232 */
function printedPage(lines) {
  for (const line of lines) {
    const m = line.trim().match(/^(\d{1,3})\s+Unified Modeling Language 2\.5\.1$|^Unified Modeling Language 2\.5\.1\s+(\d{1,3})$/);
    if (m) return Number(m[1] ?? m[2]);
  }
  return null;
}

// Все строки PDF с их печатной страницей; имя констрейнта — строка, которая
// после снятия глифа маркера целиком равна имени.
const lines = [];
for (const page of pages) {
  const pageLines = page.split('\n');
  const page_no = printedPage(pageLines);
  if (page_no == null) continue;
  for (const line of pageLines) {
    const text = line.replace(/^[^\p{L}\p{N}_]+/u, '').trim();
    if (text) lines.push({ text, page: page_no });
  }
}

// Имена и порядок — из перевода, тем же разбором, что в build.mjs.
const specDir = path.join(root, 'material/spec-ru/ru');
const keys = [];
for (const file of fs.readdirSync(specDir).filter((f) => f.endsWith('.md')).sort()) {
  const src = fs.readFileSync(path.join(specDir, file), 'utf8').split('\n');
  let metaclass = null;
  let inConstraints = false;
  for (const line of src) {
    const heading = line.match(/^### \d+(?:\.\d+)+ ([^(\[]+?)\s*(?:\(.*?\))?\s*\[[^\]]+\]\s*$/);
    if (heading) { metaclass = heading[1].trim(); inConstraints = false; continue; }
    if (/^#### \d+(?:\.\d+)+ .+$/.test(line)) {
      inConstraints = /^#### \d+(?:\.\d+)+ Ограничения$/.test(line);
      continue;
    }
    if (/^#{1,3} /.test(line)) { metaclass = null; inConstraints = false; continue; }
    const m = inConstraints ? line.match(/^- \*\*(.+?)\*\*\s*$/) : null;
    if (m) keys.push({ metaclass, name: m[1] });
  }
}

const known = new Set(keys.map((k) => k.name));
const markers = lines.filter((l) => known.has(l.text));
const out = {};
let cursor = 0;
let previous = 0;
for (const { metaclass, name } of keys) {
  for (let i = cursor; i < markers.length; i += 1) {
    if (markers[i].page < previous) continue;
    if (markers[i].text === name) {
      out[`${metaclass}::${name}`] = markers[i].page;
      cursor = i + 1;
      previous = markers[i].page;
      break;
    }
  }
}

const missing = keys.filter((k) => out[`${k.metaclass}::${k.name}`] == null).map((k) => `${k.metaclass}::${k.name}`);
if (missing.length) {
  console.error(`не найдено страниц: ${missing.length} (${missing.slice(0, 5).join(', ')})`);
  process.exit(1);
}
const target = path.join(root, 'material/rules-coverage/clause-pages.json');
fs.writeFileSync(target, `${JSON.stringify({ about: 'Печатная страница каждого констрейнта; собрано pages.mjs из pdftotext.', pages: out }, null, 2)}\n`);
console.log(`clause-pages.json: ${Object.keys(out).length} записей`);
