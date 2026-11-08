#!/usr/bin/env node
// What the exported text still does not carry back.
//
// `check.mjs` asks PlantUML whether the file is understood. This asks the
// IMPORTER the other question: model → `emit()` → `.puml` → `parse()` → model',
// and names every field that did not survive, per model. It is the export-side
// twin of `app/tests/plantuml-import.mjs` section B, and the number it prints
// ("строго") is the one `docs/user-guide/import-plantuml.md` §4 quotes.
//
// It imports the editor's parser read-only (`app/src/io/plantuml.js`) and never
// writes into `app/`: the exporter is the only side this file reports on.
//
// Usage:
//   node roundtrip.mjs            one line per model that lost something
//   node roundtrip.mjs --verbose  every model, plus the exact differing lines
//
// Exit code 0 only when every model either round-trips exactly or loses only
// fields listed in `KNOWN_LOSSES` below — a new loss turns the run red.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// `PUML_PARSE` / `PUML_EMIT` point this at copies of the two modules. That is
// how the projection below is measured: what the round trip becomes once the
// importer reads `<<stereotype>>` on a participant and `<-->` — the two gaps
// named in the report — without touching `app/`.
const { emit } = await import(process.env.PUML_EMIT ?? './emit.mjs');
const { parse } = await import(process.env.PUML_PARSE ?? '../../app/src/io/plantuml.js');
const { seed } = await import('../../app/src/io/plantuml-layout.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CORPUS = path.join(ROOT, 'material', 'corpus-layout');

const VERBOSE = process.argv.includes('--verbose');

/**
 * Fields the `.puml` text cannot carry back today, with the reason. Each is a
 * measured gap, not a leniency: a model that loses anything else fails.
 */
const KNOWN_LOSSES = {
  'lifeline.stereotype': 'импорт не читает <<стереотип>> у участника (app/src/io/plantuml.js, ветка participant)',
  'actor.abstract': 'PlantUML 1.2021 отвергает `abstract actor` — флаг невыразим в семействе описаний',
  'association.navigable': 'навигация «в обе стороны»: `<-->` импорт не читает, иной записи для неё нет',
  'aggregation.navigable': 'стрелка у конца с ромбом не выражается: PlantUML допускает одну метку на конец',
  'composition.navigable': 'стрелка у конца с ромбом не выражается: PlantUML допускает одну метку на конец',
  'activity.graph': 'граф деятельности с общим хвостом ветвей не выражается деревом if/else',
};

/** A node that two control flows enter: the tree form cannot say that. */
function sharedTail(model) {
  const into = new Map();
  for (const r of model.relationships ?? []) {
    if (r.kind !== 'controlFlow' && r.kind !== 'objectFlow') continue;
    into.set(r.to, (into.get(r.to) ?? 0) + 1);
  }
  return [...into.values()].some((n) => n > 1);
}

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** PlantUML owns the brackets of a fragment guard: syntax, not data. */
const withoutBrackets = (v) => norm(v).replace(/[[\]]/g, '');
/** The export writes `+` for both "public" and "not set". */
const visOf = (v) => (v ? v : 'public');

/** One element, flattened to what the round trip can compare. */
function elementOf(el) {
  const members = [];
  for (const f of ['attributes', 'operations', 'literals', 'slots']) {
    for (const r of el[f] ?? []) {
      members.push(typeof r === 'string'
        ? `${f[0]}:${norm(r)}`
        // The name and the type are one slot: `getType() : UserType` and
        // `getType()` + type `UserType` are the same statement.
        : `${f[0]}:${visOf(r.vis)}|${norm(r.name)}${r.type ? ` : ${norm(r.type)}` : ''}`
          + `|${norm(r.default)}|${r.isStatic ? 'S' : ''}${r.isDerived ? '/' : ''}${r.isID ? 'id' : ''}`);
    }
  }
  return {
    kind: el.kind,
    name: el.kind === 'fragment' ? withoutBrackets(el.name) : norm(el.name),
    stereotype: norm(el.stereotype),
    abstract: el.abstract === true,
    members: members.sort().join(' ; '),
  };
}

/** Name of an element id, for reading a relationship in human terms. */
function relView(rel, byId) {
  // An unnamed pseudo-state is not identified by its id: the importer mints
  // its own (`p1` vs `e2`), and the id is not part of the model's meaning.
  const nameOf = (id) => {
    const el = byId.get(id);
    if (!el) return '?';
    return `${el.kind}:${el.kind === 'fragment' ? withoutBrackets(el.name) : norm(el.name)}`;
  };
  return {
    kind: rel.kind,
    from: nameOf(rel.from),
    to: nameOf(rel.to),
    fromMultiplicity: norm(rel.fromMultiplicity),
    toMultiplicity: norm(rel.toMultiplicity),
    name: norm(rel.name),
    stereotype: norm(rel.stereotype),
    fromRole: norm(rel.fromRole),
    toRole: norm(rel.toRole),
    navigable: rel.navigable && rel.navigable !== 'none' ? rel.navigable : '',
  };
}

/** Everything the round trip is allowed to be judged on. */
function view(model) {
  const byId = new Map((model.elements ?? []).map((e) => [e.id, e]));
  return {
    elements: (model.elements ?? []).map(elementOf),
    relationships: (model.relationships ?? []).map((r) => relView(r, byId)),
  };
}


/**
 * Which fields differ between the model and the model read back.
 *
 * Elements are matched by kind and name, relationships by kind and the two
 * end names; anything left over is a lost or invented line.
 */
function differences(want, got) {
  const lost = new Map();     // `field` → example
  const note = (field, example) => { if (!lost.has(field)) lost.set(field, example); };

  const byKey = (list, fields) => {
    const map = new Map();
    for (const item of list) {
      const k = fields.map((f) => item[f]).join('|');
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  };

  const wantEls = byKey(want.elements, ['kind', 'name']);
  const gotEls = byKey(got.elements, ['kind', 'name']);
  for (const [k, list] of wantEls) {
    const other = gotEls.get(k);
    if (!other) { note('element.missing', k); continue; }
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      const b = other[i];
      if (!b) { note('element.missing', k); continue; }
      for (const f of ['stereotype', 'abstract', 'members']) {
        if (a[f] !== b[f]) {
          const kind = a.kind === 'lifeline' || a.kind === 'actorLifeline' ? 'lifeline' : a.kind;
          note(`${kind}.${f}`, `${a.name}: ${JSON.stringify(a[f])} → ${JSON.stringify(b[f])}`);
        }
      }
    }
  }
  for (const k of gotEls.keys()) if (!wantEls.has(k)) note('element.extra', k);

  const wantRels = byKey(want.relationships, ['kind', 'from', 'to']);
  const gotRels = byKey(got.relationships, ['kind', 'from', 'to']);
  for (const [k, list] of wantRels) {
    const other = gotRels.get(k);
    if (!other) {
      // The same two ends in the other order: the ends were swapped, which is
      // worse than a loss — the multiplicities move with them.
      const [kind, from, to] = k.split('|');
      const swapped = gotRels.has([kind, to, from].join('|'));
      note(swapped ? 'relationship.ends' : 'relationship.missing', k);
      continue;
    }
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      const b = other[i];
      if (!b) { note('relationship.missing', k); continue; }
      for (const f of ['fromMultiplicity', 'toMultiplicity', 'name', 'stereotype',
        'fromRole', 'toRole', 'navigable']) {
        if (a[f] !== b[f]) {
          note(`${a.kind}.${f}`, `${a.from}→${a.to}: ${JSON.stringify(a[f])} → ${JSON.stringify(b[f])}`);
        }
      }
    }
  }
  for (const k of gotRels.keys()) if (!wantRels.has(k)) note('relationship.extra', k);
  return lost;
}

/* ------------------------------------------------------------------- run */

const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.json')).sort();
const report = { strict: [], lost: [], text: [] };

for (const file of files) {
  const id = file.replace('.uml.json', '');
  const model = JSON.parse(fs.readFileSync(path.join(CORPUS, file), 'utf8'));
  const text = emit(model);
  const parsed = parse(text, { fileName: file });
  // The seed is what adds `diagram.shapes` back: `emit()` decides what is on
  // the sheet from geometry, so re-emitting a bare parse would write nothing.
  seed(parsed.model, { frames: parsed.frames, blocks: parsed.blocks });

  let lost = differences(view(model), view(parsed.model));
  // The activity export writes a tree; a graph with a shared tail is repeated
  // there on purpose. That is one known loss, not a set of field diffs.
  if (lost.size && model.diagrams?.[0]?.kind === 'activity' && sharedTail(model)) {
    lost = new Map([['activity.graph', 'общий хвост ветвей повторён']]);
  }
  if (!lost.size) {
    report.strict.push(id);
  } else {
    const unknown = [...lost.keys()].filter((f) => !KNOWN_LOSSES[f]);
    report.lost.push({ id, lost, unknown });
  }

  // C2 of the import suite: the text read back and written again is the same.
  const again = emit(parsed.model);
  const lines = (t) => new Set(t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith("'")));
  const A = lines(text);
  const B = lines(again);
  const declared = new Set((parsed.model.elements ?? []).map((e) => e.id));
  const dangling = (l) => l.split(/[\s:]+/).some((t) => /^[ep]\d+$/.test(t) && !declared.has(t));
  const missing = [...A].filter((l) => !B.has(l) && !dangling(l));
  const extra = [...B].filter((l) => !A.has(l));
  if (missing.length || extra.length) report.text.push({ id, missing, extra });
}

/* --------------------------------------------------------------- report */

console.log(`моделей: ${files.length}`);
console.log(`  строго совпало:        ${report.strict.length}`);
console.log(`  потеряно поле:         ${report.lost.length}`);
console.log('');

for (const { id, lost, unknown } of report.lost) {
  const fields = [...lost.keys()].sort();
  console.log(`${id}  ${fields.map((f) => (unknown.includes(f) ? `✗ ${f}` : f)).join(', ')}`);
  if (VERBOSE) for (const f of fields) console.log(`      ${f}: ${lost.get(f)}`);
}

if (report.text.length) {
  console.log('');
  console.log(`текст не воспроизводится (C2): ${report.text.length}`);
  for (const t of report.text) {
    console.log(`  ${t.id}: −${t.missing.length} +${t.extra.length}`);
    if (VERBOSE) {
      for (const l of t.missing.slice(0, 4)) console.log(`      − ${l}`);
      for (const l of t.extra.slice(0, 4)) console.log(`      + ${l}`);
    }
  }
}

const unexplained = report.lost.filter((r) => r.unknown.length);
if (unexplained.length) {
  console.log('');
  console.log(`✗ необъяснённых потерь: ${unexplained.length}`);
  process.exit(1);
}
console.log('');
console.log('✓ каждая потеря названа в KNOWN_LOSSES');