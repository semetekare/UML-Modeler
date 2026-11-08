#!/usr/bin/env node
// The proof: does PlantUML understand what the exporter claims it understands —
// and does the text carry what the model holds?
//
// Three phases against the real `plantuml.jar` (1.2021.00, Java 17) and one
// without it:
//
//   1. MAPPING — every entry of `mapping.json` is checked twice:
//      * its example lines are matched against the regular expressions
//        extracted from the jar (`docs/plantuml-grammar.json`), which is what
//        §7.3 of the plan asks for;
//      * the entry's own `.puml` example is accepted by `-syntax` and rendered
//        by `-tsvg -pipe`, which is the oracle §7.4 asks for.
//   2. CORPUS — all 48 models of `material/corpus-layout/` are exported,
//      parsed and rendered, and the number of entities PlantUML reports is
//      compared with the number the plan says the diagram holds. Every
//      element name must also survive into the SVG, so a construct that is
//      parsed but silently dropped does not pass.
//   3. FIXTURES — the six diagram types the teaching corpus does not have.
//   4. CARRIED — the model fields the text cannot hold are NAMED in the file,
//      and every link keeps its operands in model order. This is the phase
//      that a silently dropped field fails; it needs no java.
//
// Usage:
//   node check.mjs                all phases
//   node check.mjs --corpus       only the 48 models
//   node check.mjs --mapping      only the mapping
//   node check.mjs --carried      only phase 4 (no java)
//   node check.mjs --verbose      print every generated file
//
// Exit code 0 only when every check passes. Nothing is installed; the only
// dependency is a working `java` and the jar.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { aliasOf, emit, expectedCount, plan } from './emit.mjs';
import { FIXTURES } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CORPUS = path.join(ROOT, 'material', 'corpus-layout');
const GRAMMAR = path.join(ROOT, 'docs', 'plantuml-grammar.json');
const MAPPING = path.join(HERE, 'mapping.json');
const OUT = path.join(HERE, 'out');

const JAR = process.env.PLANTUML_JAR
  || path.join(process.env.HOME ?? '', '.vscode-oss/extensions/jebbs.plantuml-2.18.1-universal/plantuml.jar');

const argv = process.argv.slice(2);
const ONLY_CORPUS = argv.includes('--corpus');
const ONLY_MAPPING = argv.includes('--mapping');
const ONLY_CARRIED = argv.includes('--carried');
const VERBOSE = argv.includes('--verbose');

/* ------------------------------------------------------------------ java */

/** Run the jar with `args`, feeding `input` on stdin. */
function jar(args, input) {
  return new Promise((resolve) => {
    const child = spawn('java', ['-jar', JAR, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ out: '', err: String(e), code: -1 }));
    child.on('close', (code) => resolve({ out, err, code }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Bounded parallelism: java starts slowly enough to matter. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/* --------------------------------------------------------------- syntax */

/**
 * Parse the answer of `-syntax`.
 *
 * @param {string} out stdout of the jar
 * @returns {{ok:boolean, family:string, count:number|null, line:number|null}}
 */
export function parseSyntax(out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const family = lines[0] ?? '';
  if (family === 'ERROR') {
    // The next line is the 1-based line number of the first error.
    const line = Number(lines[1]);
    return { ok: false, family, count: null, line: Number.isFinite(line) ? line : null };
  }
  const m = lines.find((l) => /^\(\d+ (entities|participants)\)$/.test(l));
  const count = m ? Number(m.replace(/\D+/g, '')) : null;
  return { ok: Boolean(family) && family !== 'ERROR', family, count, line: null };
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

/**
 * The text PlantUML actually drew, one entry per drawn text run. The runs are
 * kept apart on purpose: a name that PlantUML split into several lines must
 * not be found by gluing the lines together, or "Course" would match inside
 * "CourseOffering".
 */
export function svgRuns(svg) {
  const runs = [];
  for (const m of svg.matchAll(/<(?:text|tspan)\b[^>]*>([\s\S]*?)<\/(?:text|tspan)>/g)) {
    const text = decode(m[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (text) runs.push(text);
  }
  return runs;
}

/** Does any single drawn run contain `name` as a whole word? */
export function drawnHeads(runs, name) {
  const needle = String(name).replace(/\s+/g, ' ').trim();
  if (!needle) return true;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'u');
  return runs.some((run) => re.test(run));
}

/* -------------------------------------------------------------- grammar */

const grammar = JSON.parse(fs.readFileSync(GRAMMAR, 'utf8'));

/**
 * Construct lookup. Ids repeat across diagram families (`link` is both the
 * state and the use-case link command), so a check names either the
 * unambiguous id or `family/id`. A bare id that is ambiguous is an error, not
 * a silent pick — that would test the wrong pattern.
 */
const CONSTRUCTS = new Map();
const BY_BARE = new Map();
for (const [diagram, def] of Object.entries(grammar.diagrams)) {
  for (const c of def.constructs) {
    if (!c.pattern) continue;
    const entry = { ...c, diagram };
    CONSTRUCTS.set(`${diagram}/${c.id}`, entry);
    if (!BY_BARE.has(c.id)) BY_BARE.set(c.id, []);
    BY_BARE.get(c.id).push(entry);
  }
}

function findConstruct(id, family) {
  if (id.includes('/')) return CONSTRUCTS.get(id) ?? null;
  const list = BY_BARE.get(id) ?? [];
  if (family) return list.find((c) => c.diagram === family) ?? null;
  return list.length === 1 ? list[0] : null;
}

/**
 * Compile an extracted Java regex under Node.
 *
 * The patterns are Java dialect: `\p{L}` needs the `u` flag, but under `u`
 * JavaScript rejects identity escapes Java allows (`\<`, `\:`), and Java's
 * inline `(?i)` has no JavaScript equivalent. Both are rewritten here — the
 * only change made to the extracted text, and it is recorded in the report so
 * a reader knows the match was against a translated pattern.
 */
export function compilePattern(pattern) {
  const stripped = pattern.replace(/^\(\?i\)/, '');
  const flags = stripped === pattern ? 'u' : 'iu';
  const attempts = [stripped];
  attempts.push(stripIdentityEscapes(stripped));
  for (const candidate of attempts) {
    try { return { regex: new RegExp(candidate, flags), translated: candidate !== stripped }; }
    catch { /* try the next spelling */ }
  }
  return null;
}

const VALID_OUTSIDE = new Set([...'dDsSwWbBnrtfv0xuPp.^$*+?()[]{}|/\\']);
const VALID_INSIDE = new Set([...'dDsSwWbBnrtfv0xuPp.^$*+?(){}|/\\-]']);

function stripIdentityEscapes(src) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '[') { depth += 1; out += ch; continue; }
    if (ch === ']') { depth = Math.max(0, depth - 1); out += ch; continue; }
    if (ch === '\\' && i + 1 < src.length) {
      const nx = src[i + 1];
      const allowed = depth > 0 ? VALID_INSIDE : VALID_OUTSIDE;
      out += allowed.has(nx) ? `\\${nx}` : nx;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/* --------------------------------------------------------------- report */

const rows = [];
const failures = [];
const fail = (where, message) => { failures.push({ where, message }); };

/* ------------------------------------------------------- phase 1: map */

async function checkMapping() {
  if (!fs.existsSync(MAPPING)) { fail('mapping', 'нет mapping.json'); return; }
  const mapping = JSON.parse(fs.readFileSync(MAPPING, 'utf8'));
  const entries = [];
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj ?? {})) {
      if (!value || typeof value !== 'object') continue;
      const where = `${prefix}.${key}`;
      if (Array.isArray(value.checks) || value.example) entries.push({ where, entry: value });
      else walk(value, where);
    }
  };
  for (const section of ['diagram', 'shapes', 'connectors', 'members', 'stereotypes', 'notes',
    'multiplicity', 'navigation', 'diamonds']) {
    walk({ [section]: mapping[section] }, section);
  }

  const jobs = [];
  for (const { where, entry } of entries) {
    // (a) the example lines against the extracted regular expressions
    for (const check of entry.checks ?? []) {
      const c = findConstruct(check.construct, check.diagram);
      if (!c) {
        const list = BY_BARE.get(check.construct) ?? [];
        fail(where, list.length
          ? `конструкция «${check.construct}» есть в нескольких семействах (${list.map((x) => x.diagram).join(', ')}) — укажите diagram`
          : `неизвестная или безшаблонная конструкция «${check.construct}»`);
        continue;
      }
      const compiled = compilePattern(c.pattern);
      if (!compiled) { fail(where, `шаблон «${check.construct}» не компилируется`); continue; }
      for (const line of check.lines ?? []) {
        const hit = compiled.regex.test(line);
        if (!hit) fail(where, `строка не совпала с ${check.construct}: ${JSON.stringify(line)}`);
        jobs.push({ where, line, construct: check.construct, hit, translated: compiled.translated });
      }
      for (const line of check.not ?? []) {
        const hit = compiled.regex.test(line);
        if (hit) fail(where, `строка НЕ должна была совпасть с ${check.construct}: ${JSON.stringify(line)}`);
        jobs.push({ where, line, construct: check.construct, hit, negative: true, translated: compiled.translated });
      }
    }
    // (b) the entry's own example through the jar
    if (entry.example) {
      const text = entry.example.endsWith('\n') ? entry.example : `${entry.example}\n`;
      jobs.push({ where, example: text });
    }
  }

  const results = await pool(jobs, 6, async (job) => {
    if (!job.example) return job;
    const syntax = parseSyntax((await jar(['-syntax'], job.example)).out);
    const svg = await jar(['-tsvg', '-pipe'], job.example);
    return { ...job, syntax, svg };
  });

  let regexOk = 0;
  let regexTotal = 0;
  let negOk = 0;
  let negTotal = 0;
  let jarOk = 0;
  let jarTotal = 0;
  for (const r of results) {
    if (r.construct) {
      if (r.negative) { negTotal += 1; if (!r.hit) negOk += 1; }
      else { regexTotal += 1; if (r.hit) regexOk += 1; }
    }
    if (r.example) {
      jarTotal += 1;
      const svgOk = r.svg.out.includes('<svg') && !r.svg.out.includes('Syntax Error')
        && !r.svg.out.includes('должен был');
      if (!r.syntax.ok) fail(r.where, `jar -syntax отверг пример (строка ${r.syntax.line})`);
      else if (!svgOk) fail(r.where, 'jar -tsvg не отрисовал пример');
      else jarOk += 1;
    }
  }

  const translated = results.filter((r) => r.translated).length;
  const constructsUsed = new Set(entries.flatMap(({ entry }) => (entry.checks ?? []).map((c) => c.construct)));
  rows.push({
    what: 'записи карты',
    a: `${entries.length}`,
    b: 'фигур, связей, типов, членов, стереотипов, заметок, кратностей, стрелок',
    ok: true,
  });
  rows.push({
    what: 'пример ↔ регулярка',
    a: `${regexOk}/${regexTotal}`,
    b: 'строки совпали с шаблоном из docs/plantuml-grammar.json',
    ok: true,
  });
  rows.push({
    what: 'отрицательные контроли',
    a: `${negOk}/${negTotal}`,
    b: 'строки, которые НЕ должны совпасть, — не совпали',
    ok: true,
  });
  rows.push({
    what: 'пример ↔ jar',
    a: `${jarOk}/${jarTotal}`,
    b: 'принято -syntax и отрисовано -tsvg -pipe',
    ok: true,
  });
  rows.push({
    what: 'конструкций грамматики задействовано',
    a: `${constructsUsed.size} из ${CONSTRUCTS.size}`,
    b: 'из docs/plantuml-grammar.json',
    ok: true,
  });
  if (translated) {
    rows.push({
      what: 'шаблоны, переписанные под JS',
      a: `${translated}`,
      b: 'совпадений через \\<, \\: и (?i) — правки диалекта, не синтаксиса PlantUML',
      ok: true,
    });
  }
  return { entries: entries.length, regexOk, regexTotal, negOk, negTotal, jarOk, jarTotal, constructs: constructsUsed.size, total: CONSTRUCTS.size };
}

/* ------------------------------------------------------ phase 2: corpus */

async function checkCorpus() {
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.json')).sort();
  fs.mkdirSync(OUT, { recursive: true });

  const results = await pool(files, 6, async (file) => {
    const model = JSON.parse(fs.readFileSync(path.join(CORPUS, file), 'utf8'));
    const out = { file, id: file.replace('.uml.json', '') };
    try {
      const diagram = model.diagrams?.[0];
      if (!diagram) throw new Error('в модели нет диаграммы');
      const text = emit(model);
      const counted = expectedCount(model, diagram);
      const p = plan(model, diagram);
      out.kind = diagram.kind;
      out.family = counted.family;
      out.elements = counted.elements;
      out.containers = counted.containers;
      out.expected = counted.expected;
      out.notes = counted.notes;
      out.puml = path.join(OUT, `${out.id}.puml`);
      fs.writeFileSync(out.puml, text);
      if (VERBOSE) console.log(`--- ${file}\n${text}`);

      const syntax = parseSyntax((await jar(['-syntax'], text)).out);
      out.syntax = syntax;
      const svg = await jar(['-tsvg', '-pipe'], text);
      out.svgOk = svg.out.includes('<svg') && !svg.out.includes('Syntax Error');
      const runs = svgRuns(svg.out);
      out.missing = (p.decls ?? [])
        .map((d) => d.name)
        .filter((n) => n && !drawnHeads(runs, n));
      // Ни один элемент листа не должен исчезнуть молча — независимо от того,
      // что план о нём заявил.
      const declared = new Set((p.decls ?? []).map((d) => d.elementId));
      out.undeclared = (diagram.shapes ?? [])
        .map((s) => s.elementId)
        .filter((id) => !declared.has(id));
      return out;
    } catch (e) {
      out.error = String(e.message ?? e);
      return out;
    }
  });

  for (const r of results) {
    if (r.error) { fail(r.id, r.error); continue; }
    if (!r.syntax.ok) { fail(r.id, `jar -syntax: ошибка в строке ${r.syntax.line}`); continue; }
    if (!r.svgOk) { fail(r.id, 'jar -tsvg не отрисовал'); continue; }
    // activity3 prints no entity count at all, so there the name check in the
    // SVG is the whole comparison.
    const counted = r.family !== 'activity';
    const same = !counted || r.syntax.count === r.expected;
    if (!same) fail(r.id, `PlantUML увидел ${r.syntax.count}, ожидалось ${r.expected}`);
    if (r.undeclared?.length) fail(r.id, `элементы не выгружены: ${r.undeclared.join(', ')}`);
    if (r.missing.length) fail(r.id, `имена пропали из рисунка: ${r.missing.slice(0, 3).join(', ')}`);
    rows.push({
      what: r.id,
      a: r.kind,
      b: `${r.elements} → ${r.expected}${r.containers ? ` (–${r.containers} контейнер)` : ''}`,
      c: `${r.syntax.family} (${r.syntax.count})`,
      ok: same && r.missing.length === 0,
      notes: r.notes.join('; ') || (r.missing.length ? `пропало: ${r.missing.join(', ')}` : ''),
    });
  }
  return results;
}

/* ------------------------------------------- phase 3: types without corpus */

/**
 * Six of the fourteen diagram types have no model in the teaching corpus.
 * They are still exported, so they are at least held to the oracle: the file
 * must parse, render, and show every name. Nothing here proves the mapping is
 * the best one — only that it is PlantUML.
 */
async function checkFixtures() {
  const out = [];
  for (const [name, f] of Object.entries(FIXTURES)) {
    const model = {
      schema: 'uml-model/3', id: `m-${name}`, name,
      elements: f.elements, relationships: f.relationships,
      diagrams: [{ id: 'd1', name, kind: f.diagram, shapes: f.shapes, links: f.links ?? [] }],
      currentDiagramId: 'd1',
    };
    const text = emit(model);
    fs.writeFileSync(path.join(OUT, `fixture-${name}.puml`), text);
    const p = plan(model, model.diagrams[0]);
    const counted = expectedCount(model, model.diagrams[0]);
    const syntax = parseSyntax((await jar(['-syntax'], text)).out);
    const svg = await jar(['-tsvg', '-pipe'], text);
    const runs = svgRuns(svg.out);
    const missing = (p.decls ?? []).map((d) => d.name).filter((n) => n && !drawnHeads(runs, n));
    const hasCounter = p.family !== 'activity';
    const sameCount = !hasCounter || syntax.count === counted.expected;
    const ok = syntax.ok && svg.out.includes('<svg') && !svg.out.includes('Syntax Error')
      && !missing.length && sameCount;
    if (!ok) {
      fail(`fixture:${name}`, !syntax.ok ? `jar -syntax: строка ${syntax.line}`
        : (missing.length ? `пропали имена: ${missing.join(', ')}`
          : (!sameCount ? `PlantUML увидел ${syntax.count}, ожидалось ${counted.expected}`
            : 'jar -tsvg не отрисовал')));
    }
    out.push({ name, family: p.family, familyJar: syntax.family, ok, missing, expected: counted.expected, seen: syntax.count });
  }
  return out;
}

/* ------------------------------------------- phase 4: the text says what is there */

/** A multiplicity slot, spelled as the exporter spells it. */
const slot = (v) => (v ? ` "${String(v).replace(/"/g, '')}"` : '');

/** An alias as a literal regular expression. */
const escapeRe = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The fields the export cannot write must be NAMED in the file, and the fields
 * it can write must be written with the operands in model order.
 *
 * This is the check that a loss cannot be silent: `parse()` gives back only
 * what the text says, so a `.puml` that quietly drops the navigation of a link
 * or the stereotype of a lifeline passes every count in phase 2 and still
 * loses the model. Each rule here names the expected line and the expected
 * warning, so removing either the line or the warning turns the run red.
 *
 * No java, no app/: this compares the model with the text `emit()` produced.
 */
async function checkCarried() {
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.json')).sort();
  const problems = [];
  let rules = 0;

  for (const file of files) {
    const id = file.replace('.uml.json', '');
    const model = JSON.parse(fs.readFileSync(path.join(CORPUS, file), 'utf8'));
    const diagram = model.diagrams?.[0];
    if (!diagram) continue;
    const text = emit(model);
    const p = plan(model, diagram);
    const alias = new Map((model.elements ?? []).map((e, i) => [e.id, aliasOf(e, i)]));
    const shown = new Set((diagram.shapes ?? []).map((s) => s.elementId));
    const lineOf = new Map((p.relations ?? []).map((r) => [r.id, r.line]));
    const warned = (needle) => (p.warnings ?? []).some((w) => w.includes(needle));

    for (const el of model.elements ?? []) {
      if (!shown.has(el.id) || !el.stereotype) continue;
      // The participant line carries the stereotype (`participant A as "x"
      // <<interface>>`), and `parse()` reads it back, so nothing is lost and
      // nothing has to be reported.
      if ((el.kind === 'lifeline' || el.kind === 'actorLifeline')) {
        rules += 1;
        const head = new RegExp(`^(participant|actor|collections) ${escapeRe(alias.get(el.id))}(\\s|$)`);
        const line = text.split('\n').map((l) => l.trim()).find((l) => head.test(l));
        if (!line) {
          problems.push(`${id}: нет строки участника для «${el.name}»`);
        } else if (!line.endsWith(`<<${el.stereotype}>>`)) {
          problems.push(`${id}: стереотип «${el.stereotype}» на линии жизни не написан — «${line}»`);
        }
        if (warned('стереотип')) problems.push(`${id}: «${el.stereotype}» назван потерей, хотя выгружен`);
      }
    }

    for (const rel of model.relationships ?? []) {
      const line = lineOf.get(rel.id);
      if (!line) continue;
      const a = alias.get(rel.from);
      const b = alias.get(rel.to);
      if (!a || !b) continue;
      const nav = rel.navigable ?? 'none';
      const base = { association: '--', aggregation: 'o--', composition: '*--' }[rel.kind];
      if (!base) continue;

      // The head never moves an operand: the line always starts at `from`.
      if (rel.kind !== 'assembly') {
        rules += 1;
        if (!line.startsWith(`${a}${slot(rel.fromMultiplicity)} `)) {
          problems.push(`${id}/${rel.id}: концы не в порядке модели — «${line}» вместо «${a} … ${b}»`);
        }
      }
      if (nav === 'to' && base === '--') {
        rules += 1;
        const want = `${a}${slot(rel.fromMultiplicity)} <--${slot(rel.toMultiplicity)} ${b}`;
        if (!line.startsWith(want)) problems.push(`${id}/${rel.id}: ожидалась «${want}», написано «${line}»`);
      }
      if (nav === 'both' || (nav === 'to' && base !== '--')) {
        rules += 1;
        if (/<--/.test(line) || /-->/.test(line)) {
          problems.push(`${id}/${rel.id}: приписано направление, которого в модели нет — «${line}»`);
        }
        if (!warned('навигация')) problems.push(`${id}/${rel.id}: потеря навигации не названа в тексте`);
      }
    }

    for (const el of model.elements ?? []) {
      if (!shown.has(el.id) || el.abstract !== true) continue;
      if (el.kind === 'class' || el.kind === 'datatype') continue;
      rules += 1;
      if (!warned('abstract')) problems.push(`${id}: abstract у «${el.kind}» потерян молча`);
    }
  }

  return { problems, rules, files: files.length };
}

/* ---------------------------------------------------------------- main */

function table(header, body) {
  const width = header.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(width[i])).join('  ');
  console.log(line(header));
  console.log(width.map((w) => '─'.repeat(w)).join('  '));
  for (const r of body) console.log(line(r));
}

async function main() {
  if (!fs.existsSync(JAR)) {
    console.error(`нет plantuml.jar: ${JAR}`);
    process.exit(2);
  }
  console.log(`PlantUML ${grammar.version} · ${JAR}`);
  console.log('');

  let mapping = null;
  if (!ONLY_CORPUS && !ONLY_CARRIED) {
    console.log('=== Фаза 1: карта соответствия ===');
    mapping = await checkMapping();
    table(['что проверено', 'результат', 'как'], rows.map((r) => [r.what, r.a, r.b]));
    console.log('');
    rows.length = 0;
  }

  let corpus = [];
  if (!ONLY_MAPPING && !ONLY_CARRIED) {
    console.log('=== Фаза 2: 48 моделей корпуса ===');
    corpus = await checkCorpus();
    const body = corpus.map((r, i) => {
      if (r.error) return [i + 1, r.id, '—', '—', '—', 'ошибка', '✗', r.error];
      return [
        i + 1,
        r.id,
        r.kind,
        r.elements,
        `${r.expected}${r.containers ? ` (–${r.containers})` : ''}`,
        `${r.syntax.family} (${r.syntax.count})`,
        (r.family === 'activity' || r.syntax.count === r.expected)
          && !r.missing.length && !r.undeclared?.length ? '✓' : '✗',
        r.notes.join('; '),
      ];
    });
    table(['#', 'модель', 'тип', 'элементов', 'ожидалось', 'PlantUML', 'совпало', 'примечание'], body);
  }

  let fixtures = [];
  if (!ONLY_MAPPING && !ONLY_CARRIED) {
    console.log('');
    console.log('=== Фаза 3: типы, которых нет в корпусе (только синтаксис) ===');
    fixtures = await checkFixtures();
    table(['тип', 'семейство', 'PlantUML', 'ожидалось', 'итог'],
      fixtures.map((f) => [f.name, f.family, f.familyJar || '—',
        f.seen == null ? `${f.expected}` : `${f.expected} / ${f.seen}`,
        f.ok ? '✓ синтаксис, счёт и имена' : '✗']));
  }

  let carried = null;
  if (!ONLY_MAPPING) {
    console.log('');
    console.log('=== Фаза 4: что модель несёт и что из этого названо в тексте ===');
    carried = await checkCarried();
    table(['что проверено', 'результат', 'как'], [
      ['модели', `${carried.files}`, 'правила проверены на всех'],
      ['утверждений', `${carried.rules - carried.problems.length}/${carried.rules}`,
        'стрелка на своём конце, концы не переставлены, потеря названа'],
    ]);
    for (const m of carried.problems) fail('фаза 4', m);
  }

  console.log('');
  if (failures.length) {
    console.log(`✗ провалов: ${failures.length}`);
    for (const f of failures) console.log(`  ${f.where}: ${f.message}`);
    process.exit(1);
  }
  const good = (r) => !r.error && !r.missing.length && !r.undeclared?.length
    && (r.family === 'activity' || r.syntax?.count === r.expected);
  const n = corpus.filter(good).length;
  const byFamily = {};
  for (const r of corpus) {
    const f = r.family ?? '?';
    byFamily[f] ??= { ok: 0, total: 0 };
    byFamily[f].total += 1;
    if (good(r)) byFamily[f].ok += 1;
  }
  const familyLine = Object.entries(byFamily)
    .map(([f, v]) => `${f} ${v.ok}/${v.total}`).join(' · ');
  if (corpus.length) console.log(`  по семействам: ${familyLine}`);
  if (carried) console.log(`  потеря не молчит: ${carried.rules - carried.problems.length}/${carried.rules} утверждений`);
  console.log(OKLINE(corpus.length, n, mapping));
}

function OKLINE(total, same, mapping) {
  const parts = ['✓ всё сошлось'];
  if (mapping) {
    parts.push(`карта: ${mapping.regexOk}/${mapping.regexTotal} строк совпало с регулярками, `
      + `${mapping.negOk}/${mapping.negTotal} отрицательных контролей, `
      + `${mapping.jarOk}/${mapping.jarTotal} примеров принято jar`);
  }
  if (total) parts.push(`корпус: ${same}/${total} моделей — сущностей столько же`);
  return parts.join(' · ');
}

main().catch((e) => { console.error(e); process.exit(1); });
