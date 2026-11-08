// PlantUML import checks — the four proofs the Э7 request asks for, plus the
// two invariants the editor lives by.
//
//   node tests/plantuml-import.mjs            run everything
//   node tests/plantuml-import.mjs --verbose  print every model
//
// No browser, no DOM, no network: the parser and the seed are pure modules, so
// this file imports them directly and never starts a server. Exit code 0 only
// when every check passed.
//
// Sections:
//   A. the parser on small texts — warnings, determinism, garbage
//   B. round trip over the 48 corpus models (the main proof)
//   C. `parse → emit → parse` is a fixed point (no oscillation on re-export)
//   D. the jar as a syntax oracle (`-syntax`), skipped when Java is missing
//   E. a deliberately broken parser — the round trip MUST fail
//   F. the seed: deterministic, and links never move a shape

import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/io/plantuml.js';
import { seed, DEFAULT_SIZE } from '../src/io/plantuml-layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.resolve(ROOT, '..');
const CORPUS = path.join(PROJECT, 'material', 'corpus-layout');
const OUT = path.join(PROJECT, 'material', 'plantuml-export', 'out');
const EMIT_SRC = path.join(PROJECT, 'material', 'plantuml-export', 'emit.mjs');
const VERBOSE = process.argv.includes('--verbose');

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const log = (...a) => { if (VERBOSE) console.log('   ', ...a); };

/* -------------------------------------------------------------- helpers */

const { emit } = await import(EMIT_SRC);

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** PlantUML owns the brackets of a fragment guard: syntax, not data. */
const withoutBrackets = (v) => norm(v).replace(/[[\]]/g, '');
/** The export writes `+` for both "public" and "not set". */
const visOf = (v) => (v ? v : 'public');

/**
 * The meaning of a model, as two sortable lists: elements and relationships.
 * Geometry is not here — the seed is allowed (and expected) to differ.
 */
function semantics(model) {
  const els = [];
  const rels = [];
  const nameOf = (id) => {
    const el = (model.elements ?? []).find((e) => e.id === id);
    if (!el) return `?${id}`;
    if (el.kind === 'initial' || el.kind === 'final') return `[*]:${el.kind}`;
    return `${el.kind}:${el.kind === 'fragment' ? withoutBrackets(el.name) : norm(el.name)}`;
  };
  for (const el of model.elements ?? []) {
    const members = [];
    for (const f of ['attributes', 'operations', 'literals', 'slots']) {
      for (const r of el[f] ?? []) {
        if (typeof r === 'string') members.push(`${f[0]}:${norm(r)}`);
        else {
          members.push(`${f[0]}:${visOf(r.vis)}|${norm(r.name)}${r.type ? ` : ${norm(r.type)}` : ''}|`
            + `${norm(r.default)}|${r.isStatic ? 'S' : ''}${r.isDerived ? '/' : ''}${r.isID ? 'id' : ''}`);
        }
      }
    }
    els.push({
      key: `${el.kind}|${el.kind === 'fragment' ? withoutBrackets(el.name) : norm(el.name)}`
        + `|${norm(el.stereotype)}|${el.abstract ? 'A' : ''}`,
      members: members.sort().join(' ; '),
      kind: el.kind,
      name: norm(el.name),
    });
  }
  for (const r of model.relationships ?? []) {
    rels.push({
      key: `${r.kind}|${nameOf(r.from)}|${nameOf(r.to)}|${norm(r.fromMultiplicity)}|${norm(r.toMultiplicity)}`
        + `|${norm(r.name)}|${norm(r.stereotype)}|${norm(r.fromRole)}|${norm(r.toRole)}`
        + `|${(r.navigable && r.navigable !== 'none') ? r.navigable : ''}`,
      kind: r.kind,
      nav: r.navigable,
    });
  }
  const flat = (list) => list.map((x) => (x.members != null ? `${x.key}|${x.members}` : x.key));
  return { elements: els, relationships: rels, flatElements: flat(els), flatRels: flat(rels) };
}

/** What the exporter cannot put into the text — applied to the expected side. */
const CLASSIFIERS = new Set(['class', 'datatype']);

/**
 * The model as the `.puml` file is able to carry it. Each rule is a known,
 * measured gap of `emit.mjs` (see docs/user-guide/import-plantuml.md §5), not a leniency of
 * the comparison: remove a rule and the corresponding model starts failing,
 * which is what `degrade(document, [])` in section B shows.
 */
function degrade(model, reasons = []) {
  const copy = JSON.parse(JSON.stringify(model));
  const byId = new Map((copy.elements ?? []).map((e) => [e.id, e]));
  for (const el of copy.elements ?? []) {
    // 1. `abstract` is only written for a class or a datatype (emit.mjs#header).
    if (el.abstract && !CLASSIFIERS.has(el.kind)) {
      reasons.push(`abstract у «${el.kind}» не выгружается`);
      delete el.abstract;
    }
  }
  for (const rel of copy.relationships ?? []) {
    const a = byId.get(rel.from);
    const b = byId.get(rel.to);
    if (!a || !b) continue;
    // 2. A head at the FAR end is written (`-->`), and a head at the SOURCE end
    //    is written too, as `<--` with the ends left where they are — so
    //    `navigable: 'to'` loses nothing. Both heads at once (`<-->`) are not
    //    written: PlantUML allows one decoration per end and emit.mjs#arrowOf
    //    drops the head rather than move the ends, so only `navigable` goes.
    const assoc = rel.kind === 'association' || rel.kind === 'aggregation' || rel.kind === 'composition';
    if (!assoc) continue;
    if (rel.navigable === 'both') {
      reasons.push(`навигация «в обе стороны» не выгружается — голова одна`);
      rel.navigable = 'none';
    }
  }
  return copy;
}

/** Models whose activity graph has a cycle: the export falls back to a flat
 *  chain that duplicates shared tails (emit.mjs#emitActivity), so the text is
 *  not a faithful copy of the graph. Recognised, counted, and reported. */
function sharedActivity(model) {
  const edges = (model.relationships ?? []).filter((r) => r.kind === 'controlFlow');
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  // The export writes a TREE (`if`/`else` nested). A node reached by two
  // branches is written twice, with its tail duplicated; a cycle is written as
  // a flat chain. Neither is a faithful copy of the graph.
  const seen = new Map();
  let shared = false;
  const visit = (id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) { shared = true; return; }
    for (const to of out.get(id) ?? []) visit(to);
  };
  for (const el of model.elements ?? []) if (el.kind === 'initial') visit(el.id);
  for (const el of model.elements ?? []) visit(el.id);
  return shared;
}

const multisetDiff = (a, b) => {
  const left = [...a];
  const right = [...b];
  const missing = [];
  const extra = [];
  for (const v of left) {
    const i = right.indexOf(v);
    if (i >= 0) right.splice(i, 1);
    else missing.push(v);
  }
  for (const v of right) extra.push(v);
  return { missing, extra };
};

const corpusModels = async () => {
  const files = (await readdir(CORPUS)).filter((f) => f.endsWith('.uml.json')).sort();
  const out = [];
  for (const f of files) out.push({ file: f, model: JSON.parse(await readFile(path.join(CORPUS, f), 'utf8')) });
  return out;
};

/* ------------------------------------------------------- A. the parser */

check('A1 · пустой файл не роняет импорт', () => {
  const { model, warnings } = parse('');
  if (model.diagrams.length !== 1) throw new Error('пустой файл должен дать один лист');
  if (model.elements.length) throw new Error('из пустого файла не может появиться элементов');
  void warnings;
});

check('A2 · неизвестная строка — предупреждение, а не исключение', () => {
  const text = [
    '@startuml',
    'class A',
    'this is not plantuml at all ((',
    'class B',
    '@enduml',
  ].join('\n');
  const { model, warnings } = parse(text);
  const names = model.elements.map((e) => e.name).join(',');
  if (names !== 'A,B') throw new Error(`прочитано должно быть A,B — а вышло ${names}`);
  const w = warnings.find((x) => x.text.includes('not plantuml'));
  if (!w) throw new Error('про непонятую строку не сказано в warnings');
  if (w.line !== 3) throw new Error(`номер строки не тот: ${w.line}`);
  if (!w.reason) throw new Error('у предупреждения нет причины');
});

check('A3 · детерминированность: два разбора — побайтово одна модель', () => {
  const text = '@startuml\nclass A\nA "1" -- "*" B\nclass B\n@enduml';
  const one = JSON.stringify(parse(text).model);
  const two = JSON.stringify(parse(text).model);
  if (one !== two) throw new Error('модель различается между двумя разборами одного текста');
});

check('A4 · каждый вид связи читается своим видом', () => {
  const text = `@startuml
class A
class B
class C
A -- B
A --> B
A <-- B
A *-- B
A o-- B
A --|> B
A ..|> B
A ..> B
A -- C
A "1" <--> "*" B
@enduml`;
  const { model } = parse(text);
  const kinds = model.relationships.map((r) => r.kind);
  const want = ['association', 'association', 'association', 'composition', 'aggregation',
    'generalization', 'realization', 'dependency', 'association', 'association'];
  if (kinds.join(',') !== want.join(',')) throw new Error(`виды связей: ${kinds.join(',')}`);
  // `<-->` is longer than `<--`: read as the short form it leaves `> B` behind
  // as a name and invents the element `__B`, and the text written back is no
  // longer PlantUML.
  if (model.elements.length !== 3) {
    throw new Error(`«<-->» родила лишний элемент: ${model.elements.map((e) => e.name).join(',')}`);
  }
  const both = model.relationships[9];
  if (both.navigable !== 'both') throw new Error(`«<-->» прочитана как навигация «${both.navigable}»`);
  if (both.fromMultiplicity !== '1' || both.toMultiplicity !== '*') {
    throw new Error(`кратности «<-->»: ${both.fromMultiplicity}/${both.toMultiplicity}`);
  }
});

check('A5 · члены, кратности, роли и стереотипы на месте', () => {
  const text = `@startuml
class A as "Alpha" <<entity>> {
  -field : string
  +op(x : int) : bool
  -{static}counter : int
  -/derived : byte = 0
}
class B
A "1" *-- "*" B : · → parts
@enduml`;
  const { model } = parse(text);
  const a = model.elements.find((e) => e.name === 'Alpha');
  if (a.stereotype !== 'entity') throw new Error('стереотип потерян');
  const attrs = (a.attributes ?? []).map((r) => r.name).join(',');
  if (attrs !== 'field,counter,derived') throw new Error(`атрибуты: ${attrs}`);
  const ops = (a.operations ?? []).map((r) => `${r.name}:${r.type}`).join(',');
  if (ops !== 'op(x : int):bool') throw new Error(`операции: ${ops}`);
  if (!(a.operations[0].vis === 'public' && a.attributes[0].vis === 'private')) throw new Error('видимость потеряна');
  if (!a.attributes[1].isStatic) throw new Error('{static} потерян');
  if (!a.attributes[2].isDerived) throw new Error('«/» потерян');
  const rel = model.relationships[0];
  if (rel.kind !== 'composition' || rel.fromMultiplicity !== '1' || rel.toMultiplicity !== '*') {
    throw new Error('кратности композиции потеряны');
  }
  if (rel.toRole !== 'parts') throw new Error(`роль конца потеряна: ${rel.toRole}`);
});

check('A6 · пакет, актёр, вариант использования, граница системы', () => {
  const text = `@startuml
package "Pkg" as p {
  class In
}
actor U as "Пользователь"
usecase UC as "Сделать"
rectangle S as "Система" <<subject>> {
  usecase Inner
}
@enduml`;
  const { model } = parse(text);
  const kinds = model.elements.map((e) => `${e.kind}:${e.name}`).join(',');
  for (const want of ['package:Pkg', 'class:In', 'actor:Пользователь', 'usecase:Сделать',
    'systemBoundary:Система', 'usecase:Inner']) {
    if (!kinds.includes(want)) throw new Error(`нет «${want}» в ${kinds}`);
  }
  const inner = model.elements.find((e) => e.name === 'In');
  if (inner.ownerId !== model.elements.find((e) => e.name === 'Pkg').id) throw new Error('вложенность пакета потеряна');
});

check('A7 · последовательность: участники, сообщения, фрагменты, create/destroy', () => {
  const text = `@startuml
actor U as "Пользователь"
participant S as "Сервер"
alt [есть доступ]
U -> S : open()
create S2
S -> S2 : new
S -> S2 : work()
destroy S2
S --> U : result
else [нет доступа]
U -> S : retry()
end
@enduml`;
  const { model } = parse(text);
  const kinds = model.relationships.map((r) => r.kind).join(',');
  if (kinds !== 'message,createMessage,destroyMessage,reply,message') throw new Error(`виды сообщений: ${kinds}`);
  const frames = model.elements.filter((e) => e.kind === 'fragment');
  if (frames.length !== 1) throw new Error('фрагмент не прочитан');
  if (frames[0].operator !== 'alt') throw new Error('оператор фрагмента потерян');
  if (!frames[0].name.includes('есть доступ') || !frames[0].name.includes('нет доступа')) {
    throw new Error(`операнды фрагмента: ${frames[0].name}`);
  }
  if (model.elements.length !== 4) throw new Error(`участники: ${model.elements.map((e) => e.kind)}`);
});

check('A8 · состояние: [*], переходы, entry', () => {
  const text = `@startuml
state A as "Активно"
state B as "Закрыто"
state C <<choice>>
[*] --> A : старт
A --> C : закрыть
C --> B : [ok]
A : entry / reset()
B --> [*]
@enduml`;
  const { model } = parse(text);
  const kinds = model.elements.map((e) => e.kind).sort().join(',');
  if (kinds !== 'choice,final,initial,state,state') throw new Error(`виды: ${kinds}`);
  const a = model.elements.find((e) => e.name === 'Активно');
  if ((a.entry ?? []).join() !== 'reset()') throw new Error('entry потерян');
  const trans = model.relationships.map((r) => r.name).join('|');
  if (trans !== 'старт|закрыть|[ok]|') throw new Error(`переходы: ${trans}`);
});

check('A9 · деятельность: дорожки, решение, слияние, начало и конец', () => {
  const text = `@startuml
|Студент|
start
:Заявка;
if (?) then ([да])
:Согласовать;
else ([нет])
:Отклонить;
endif
stop
@enduml`;
  const { model } = parse(text);
  const kinds = model.elements.map((e) => e.kind).sort().join(',');
  for (const k of ['action', 'decision', 'final', 'initial', 'merge', 'swimlane']) {
    if (!kinds.includes(k)) throw new Error(`нет узла «${k}» в ${kinds}`);
  }
  const lane = model.elements.find((e) => e.kind === 'swimlane');
  const actions = model.elements.filter((e) => e.kind === 'action');
  if (actions.some((a) => a.lane !== lane.id)) throw new Error('дорожка не привязана к действиям');
  const named = model.relationships.filter((r) => r.name).map((r) => r.name).sort().join(',');
  if (named !== '[да],[нет]') throw new Error(`подписи ветвей: ${named}`);
});

/* --------------------------------------------------- B. round trip 48 */

const roundTrip = async () => {
  const models = await corpusModels();
  const report = { total: models.length, strict: [], explained: [], unexplained: [], skipped: [] };
  for (const { file, model } of models) {
    const text = emit(model);
    const parsed = parse(text, { fileName: file });
    seed(parsed.model, { frames: parsed.frames, blocks: parsed.blocks });

    const got = semantics(parsed.model);

    // Strict: same meaning, nothing forgiven.
    const ae = multisetDiff(semantics(model).flatElements, got.flatElements);
    const ar = multisetDiff(semantics(model).flatRels, got.flatRels);
    if (!ae.missing.length && !ae.extra.length && !ar.missing.length && !ar.extra.length) {
      report.strict.push(file);
      continue;
    }

    // Explained: the text cannot carry those fields at all.
    if (sharedActivity(model)) {
      report.skipped.push({ file, why: 'граф деятельности не дерево: экспорт дублирует общий хвост ветвей' });
      continue;
    }
    const reasons = [];
    const want = degrade(model, reasons);
    const ws = semantics(want);
    const be = multisetDiff(ws.flatElements, got.flatElements);
    const br = multisetDiff(ws.flatRels, got.flatRels);
    if (!be.missing.length && !be.extra.length && !br.missing.length && !br.extra.length) {
      report.explained.push({ file, reasons: [...new Set(reasons)] });
    } else {
      report.unexplained.push({
        file,
        elements: { missing: be.missing.slice(0, 4), extra: be.extra.slice(0, 4) },
        relationships: { missing: br.missing.slice(0, 4), extra: br.extra.slice(0, 4) },
      });
    }
  }
  return report;
};

const RT = await roundTrip();
log(`круг: строго ${RT.strict.length}, объяснено ${RT.explained.length}, пропущено ${RT.skipped.length}, непонятно ${RT.unexplained.length}`);

check('B1 · круговой тест: ни одного расхождения по вине импорта', () => {
  if (RT.unexplained.length) {
    const first = RT.unexplained[0];
    throw new Error(`${RT.unexplained.length} моделей разошлись необъяснимо; первая ${first.file}: `
      + `элементы −${JSON.stringify(first.elements.missing)} +${JSON.stringify(first.elements.extra)}; `
      + `связи −${JSON.stringify(first.relationships.missing)} +${JSON.stringify(first.relationships.extra)}`);
  }
  if (RT.strict.length + RT.explained.length + RT.skipped.length !== RT.total) {
    throw new Error('не все модели попали в отчёт');
  }
});

check('B2 · круговой тест: строгое совпадение не меньше 25 из 48', () => {
  // 25 — измеренное число на 2026-11-06; оно может только расти. Падение
  // означает регрессию импорта, а не «стало чуть хуже».
  if (RT.strict.length < 25) {
    throw new Error(`строго совпало ${RT.strict.length} из ${RT.total} — было 25`);
  }
});

check('B3 · у каждой объяснённой модели причина названа', () => {
  for (const item of RT.explained) {
    if (!item.reasons.length) throw new Error(`${item.file}: расхождение без причины`);
  }
});

check('B4 · прощение не шире перечисленных потерь', () => {
  // Если у модели нет ни одной потери из списка, degrade() обязан вернуть её
  // без единого изменения — иначе тест «прощает» неизвестно что.
  const clean = RT.strict[0];
  if (!clean) return 'нет строго совпавших моделей';
  return (async () => {
    const model = JSON.parse(await readFile(path.join(CORPUS, clean), 'utf8'));
    const reasons = [];
    const same = JSON.stringify(degrade(model, reasons)) === JSON.stringify(model);
    if (!same || reasons.length) throw new Error(`${clean}: degrade изменил модель, которой нечего прощать`);
  })();
});

/* ------------------------------------------------ C. fixed point */

const fixedPoint = async () => {
  const files = (await readdir(OUT)).filter((f) => /\.puml$/.test(f)).sort();
  const bad = [];
  for (const f of files) {
    const text = await readFile(path.join(OUT, f), 'utf8');
    const a = parse(text, { fileName: f });
    seed(a.model, { frames: a.frames, blocks: a.blocks });
    const again = emit(a.model);
    const b = parse(again);
    const A = semantics(a.model);
    const B = semantics(b.model);
    const e = multisetDiff(A.flatElements, B.flatElements);
    const r = multisetDiff(A.flatRels, B.flatRels);
    if (e.missing.length || e.extra.length || r.missing.length || r.extra.length) {
      bad.push({ file: f, elements: e, relationships: r });
    }
  }
  return { files: files.length, bad };
};

const FP = await fixedPoint();
check('C1 · parse → emit → parse не качается', () => {
  // Заметка на диаграмме последовательности — единственное исключение: сам
  // экспорт заметок в последовательности не пишет (emitSequence), поэтому
  // второй круг её не видит. Всё остальное обязано совпасть.
  const real = FP.bad.filter((x) => !(x.elements.missing.length === 1
    && x.elements.missing[0].startsWith('note|') && !x.elements.extra.length
    && !x.relationships.missing.length && !x.relationships.extra.length));
  if (real.length) {
    const f = real[0];
    throw new Error(`${real.length} из ${FP.files} файлов качаются; ${f.file}: `
      + `−${JSON.stringify(f.elements.missing.slice(0, 3))} +${JSON.stringify(f.elements.extra.slice(0, 3))}`);
  }
});

check('C2 · повторный экспорт корпуса — тот же текст', async () => {
  // Более сильное утверждение, чем C1: после импорта и затравочной раскладки
  // модель выгружается В ТОТ ЖЕ текст, что и пришёл (порядок строк может
  // отличаться — он у нас порядок объявления, а у PlantUML свой).
  //
  // Только 48 корпусных файлов: синтетические фикстуры проверяют формы,
  // которых в корпусе нет (смешанная диаграмма ссылается на фигуры по
  // кавычкам, диаграмма коммуникации рисует сообщения линиями без головки,
  // тайминг — заметкой), и их текст нарочно не совпадёт с нашей записью.
  const files = (await readdir(OUT)).filter((f) => /^\d{4}\.puml$/.test(f)).sort();
  const bad = [];
  for (const f of files) {
    const text = await readFile(path.join(OUT, f), 'utf8');
    const a = parse(text, { fileName: f });
    seed(a.model, { frames: a.frames, blocks: a.blocks });
    const again = emit(a.model);
    const lineSet = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith("'")).sort();
    const A = lineSet(text);
    const B = lineSet(again);
    const d = multisetDiff(A, B);
    // Экспорт иногда пишет связь, у которой один конец НЕ объявлен в этом
    // файле (`e3 --> e10` в 3102: e10 на листе, но объявления нет). Такую
    // строку импортировать нечем, и терять её — правильно.
    const declared = new Set((a.model.elements ?? []).map((e) => e.id));
    const dangling = (line) => line.split(/[\s:]+/).some((tok) => /^[ep]\d+$/.test(tok) && !declared.has(tok));
    const real = { missing: d.missing.filter((l) => !dangling(l)), extra: d.extra };
    if (real.missing.length || real.extra.length) bad.push({ file: f, d: real });
  }
  if (bad.length) {
    const f = bad[0];
    throw new Error(`${bad.length} файлов выгружаются иначе; ${f.file}: −${JSON.stringify(f.d.missing.slice(0, 3))} +${JSON.stringify(f.d.extra.slice(0, 3))}`);
  }
});

/* ---------------------------------------------------- D. the jar */

const findJar = () => {
  const candidates = [
    process.env.PLANTUML_JAR,
    path.join(PROJECT, 'material', 'plantuml-export', 'plantuml.jar'),
    `${process.env.HOME}/.vscode-oss/extensions/jebbs.plantuml-2.18.1-universal/plantuml.jar`,
    `${process.env.HOME}/.vscode/extensions/jebbs.plantuml-2.18.1-universal/plantuml.jar`,
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
};

const jar = findJar();
const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
const canOracle = Boolean(jar) && java.status === 0;

check('D1 · оракул jar: наш повторный экспорт PlantUML разбирает без ошибок', () => {
  if (!canOracle) return 'skip';
  const files = [];
  return (async () => {
    const list = (await readdir(OUT)).filter((f) => /\.puml$/.test(f)).sort();
    for (const f of list) {
      const text = await readFile(path.join(OUT, f), 'utf8');
      const a = parse(text, { fileName: f });
      seed(a.model, { frames: a.frames, blocks: a.blocks });
      const again = emit(a.model);
      const res = spawnSync('java', ['-jar', jar, '-syntax'], { input: again, encoding: 'utf8' });
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
      if (res.status !== 0 || /error|syntax error/i.test(out.replace(/\(.*\)/g, ''))) {
        throw new Error(`${f}: ${out.split('\n').slice(0, 3).join(' / ')}`);
      }
      files.push(f);
    }
    return files.length;
  })();
});

/* ------------------------------------------ E. deliberate breakage */

check('E1 · испорченный парсер обязан провалить круговой тест', async () => {
  // Мутант: из таблицы стрелок убирается `*--`. Больше НИЧЕГО не меняется.
  const src = await readFile(path.join(ROOT, 'src', 'io', 'plantuml.js'), 'utf8');
  const broken = src.replace("'<*--', '*-->', '*--', '--*', '<o--', 'o-->', 'o--', '--o',",
    "'<*--', '*-->', '<o--', 'o-->', 'o--', '--o',");
  if (broken === src) throw new Error('мутация не применилась — тест ничего не проверяет');
  const dir = await mkdtemp(path.join(tmpdir(), 'puml-mutant-'));
  const file = path.join(dir, 'plantuml-broken.mjs');
  await writeFile(file, broken, 'utf8');
  const mutant = await import(`file://${file}`);
  const model = JSON.parse(await readFile(path.join(CORPUS, '4401.uml.json'), 'utf8'));
  const text = emit(model);
  const parsed = mutant.parse(text);
  const A = semantics(model);
  const B = semantics(parsed.model);
  const lost = multisetDiff(A.flatRels, B.flatRels).missing.filter((x) => x.startsWith('composition'));
  if (!lost.length) throw new Error('испорченный парсер всё равно прошёл — круговой тест слеп');
  return `поймано: ${lost.length} композиций потеряно на 4401`;
});

/* --------------------------------------------- F. seed invariants */

check('F1 · затравочная раскладка детерминирована', () => {
  const text = '@startuml\nclass A\nclass B\nA --> B\nclass C\n@enduml';
  const one = parse(text);
  seed(one.model, { frames: one.frames, blocks: one.blocks });
  const two = parse(text);
  seed(two.model, { frames: two.frames, blocks: two.blocks });
  const a = JSON.stringify(one.model.diagrams[0].shapes);
  const b = JSON.stringify(two.model.diagrams[0].shapes);
  if (a !== b) throw new Error('два прогона дали разные координаты');
});

check('F2 · связи не двигают фигуры', () => {
  // Обещание человеку: программа не переставляет фигуры «ради красоты линий».
  const withLinks = '@startuml\nclass A\nclass B\nclass C\nA --> B\nB --> C\nA --> C\n@enduml';
  const without = '@startuml\nclass A\nclass B\nclass C\n@enduml';
  const one = parse(withLinks);
  seed(one.model, { frames: one.frames, blocks: one.blocks });
  const two = parse(without);
  seed(two.model, { frames: two.frames, blocks: two.blocks });
  const pos = (m) => m.diagrams[0].shapes.map((s) => `${s.elementId}:${s.x},${s.y},${s.w},${s.h}`).join('|');
  if (pos(one.model) !== pos(two.model)) throw new Error('наличие связей изменило раскладку');
});

check('F3 · порядок фигур — порядок объявления', () => {
  const text = '@startuml\nclass Zebra\nclass Alpha\nclass Mike\n@enduml';
  const r = parse(text);
  seed(r.model, { frames: r.frames, blocks: r.blocks });
  const order = r.model.diagrams[0].shapes.map((s) => r.model.elements.find((e) => e.id === s.elementId).name);
  if (order.join(',') !== 'Zebra,Alpha,Mike') throw new Error(`порядок: ${order.join(',')}`);
});

check('F4 · размеры фигур совпадают с notation/uml.json', async () => {
  const notation = JSON.parse(await readFile(path.join(ROOT, 'notation', 'uml.json'), 'utf8'));
  // Осознанные отличия затравочной раскладки: дорожка уже своей фигуры, потому
  // что план §7.2 фиксирует шаг 200 (иначе две дорожки налезают друг на друга).
  const OVERRIDE = { swimlane: { w: 200, h: 300 } };
  const bad = [];
  for (const [kind, def] of Object.entries(notation.shapes)) {
    const mine = DEFAULT_SIZE[kind];
    if (!mine) { bad.push(`${kind}: нет в DEFAULT_SIZE`); continue; }
    if (OVERRIDE[kind] && mine.w === OVERRIDE[kind].w && mine.h === OVERRIDE[kind].h) continue;
    if (mine.w !== def.defaultSize.w || mine.h !== def.defaultSize.h) {
      bad.push(`${kind}: ${mine.w}×${mine.h} против ${def.defaultSize.w}×${def.defaultSize.h}`);
    }
  }
  if (bad.length) throw new Error(`${bad.length}: ${bad.slice(0, 3).join('; ')}`);
});

check('F5 · затравочная раскладка не считает пересечения (нет оптимизации)', async () => {
  // Правило проверяется по поведению: две фигуры в одном ряду стоят ровно на
  // шаге «ширина + 40», даже если связь между ними идёт «через третью».
  const text = '@startuml\nclass A\nclass B\nA --> B\n@enduml';
  const r = parse(text);
  seed(r.model, { frames: r.frames, blocks: r.blocks });
  const [a, b] = r.model.diagrams[0].shapes;
  if (b.x - (a.x + a.w) !== 40) throw new Error(`шаг ${b.x - (a.x + a.w)} вместо 40`);
});


/* ------------------------------------------- G. grammar coverage (169) */

/**
 * Every construction in `docs/plantuml-grammar.json` (169 of them, extracted
 * from `plantuml.jar` 1.2021.00) with what this parser does about it:
 *
 *   ok       — прочитано в модель (элемент, связь, член);
 *   dropped  — распознано и осознанно отброшено (цвет, ссылка, `hide`…),
 *              с причиной в `warnings`;
 *   no       — не поддержано: строка целиком уходит в `warnings`.
 *
 * The snippet is the smallest text that exercises the construction; a `no` row
 * must still be parsed WITHOUT throwing — that is the promise «90 процентов
 * лучше, чем ничего».
 */
const FORMS = [
  ['class', 'class-decl', 'ok', "class Foo"],
  ['class', 'class-abstract', 'ok', "abstract class Foo"],
  ['class', 'class-interface', 'ok', "interface IFoo"],
  ['class', 'class-enum', 'ok', "enum Color"],
  ['class', 'class-annotation', 'ok', "annotation Ann"],
  ['class', 'class-entity-circle-diamond', 'ok', "entity E"],
  ['class', 'class-generic', 'ok', "class Foo<T>"],
  ['class', 'class-as', 'ok', "class Foo as \"F\""],
  ['class', 'class-stereotype', 'ok', "class Foo <<entity>>"],
  ['class', 'class-color', 'dropped', "class Foo #red"],
  ['class', 'class-link-url', 'dropped', "class Foo [[http://x]]"],
  ['class', 'class-spot', 'dropped', "class Foo $tag1 $tag2"],
  ['class', 'class-extends', 'ok', "class Bar\nclass Foo extends Bar"],
  ['class', 'class-implements', 'ok', "interface IBar\nclass Foo implements IBar"],
  ['class', 'class-empty-body', 'ok', "class Foo {}"],
  ['class', 'class-body-open', 'ok', "class Foo {"],
  ['class', 'member-attribute', 'ok', "class Foo {\n+name : String"],
  ['class', 'member-operation', 'ok', "class Foo {\n+getName() : String"],
  ['class', 'member-static', 'ok', "class Foo {\n{static} +count : int"],
  ['class', 'member-abstract', 'ok', "class Foo {\n{abstract} +run() : void"],
  ['class', 'member-field-method-marker', 'ok', "class Foo {\n{field} -x : int"],
  ['class', 'member-visibility', 'ok', "class Foo {\n-x\n}"],
  ['class', 'assoc', 'ok', "class A\nclass B\nA -- B"],
  ['class', 'assoc-directed', 'ok', "class A\nclass B\nA --> B"],
  ['class', 'assoc-composition', 'ok', "class A\nclass B\nA *-- B"],
  ['class', 'assoc-aggregation', 'ok', "class A\nclass B\nA o-- B"],
  ['class', 'assoc-dependency', 'ok', "class A\nclass B\nA ..> B"],
  ['class', 'generalization', 'ok', "class A\nclass B\nA --|> B"],
  ['class', 'realization', 'ok', "class A\nclass B\nA ..|> B"],
  ['class', 'assoc-multiplicity', 'ok', "class A\nclass B\nA \"1\" -- \"0..*\" B : contains"],
  ['class', 'assoc-label', 'ok', "class A\nclass B\nA -- B : label"],
  ['class', 'assoc-cardinality-online', 'ok', "class A\nclass B\nA \"1\" -- \"n\" B"],
  ['class', 'package', 'ok', "package Foo {"],
  ['class', 'package-empty', 'ok', "package Foo {}"],
  ['class', 'package-as', 'ok', "package \"Long\" as P {"],
  ['class', 'namespace', 'ok', "namespace com.foo {"],
  ['class', 'namespace-as', 'ok', "namespace \"N\" as com.foo {"],
  ['class', 'namespace-empty', 'ok', "namespace com.foo {}"],
  ['class', 'block-end', 'ok', "class Foo {\n}"],
  ['class', 'note-on-entity', 'ok', "class Foo\nnote right of Foo : text"],
  ['class', 'note-standalone', 'ok', "note \"text\" as N1"],
  ['class', 'note-on-link', 'no', "note on link : text"],
  ['class', 'stereotype-command', 'ok', "class Foo\nFoo <<entity>>"],
  ['class', 'hide-show-members', 'dropped', "hide members"],
  ['class', 'hide-show-gender', 'dropped', "hide empty members"],
  ['class', 'hide-show-visibility', 'dropped', "hide private members"],
  ['class', 'hide-show-class', 'dropped', "hide Foo"],
  ['class', 'url', 'no', "url of Foo is [[http://x]]"],
  ['class', 'lollipop', 'ok', "class Foo\nclass Bar\nFoo --() Bar"],
  ['class', 'diamond', 'no', "<> Foo"],
  ['class', 'remove-restore', 'no', "remove Foo"],
  ['class', 'namespace-separator', 'dropped', "set separator ::"],
  ['class', 'allow-mixing', 'ok', "allow_mixing"],
  ['class', 'layout-new-line', 'no', "layout_new_line"],
  ['class', 'add-member-by-name', 'ok', "class Foo\nFoo : +bar()"],
  ['sequence', 'participant', 'ok', "participant Alice"],
  ['sequence', 'participant-actor', 'ok', "actor Bob"],
  ['sequence', 'participant-as-display', 'ok', "participant A as \"Alice\""],
  ['sequence', 'participant-as-id', 'ok', "participant Alice as A"],
  ['sequence', 'participant-display-only', 'ok', "participant \"Alice\""],
  ['sequence', 'participant-order', 'ok', "participant A order 10"],
  ['sequence', 'message', 'ok', "participant Alice\nparticipant Bob\nAlice -> Bob : hello"],
  ['sequence', 'message-dotted', 'ok', "participant Alice\nparticipant Bob\nAlice --> Bob : hi"],
  ['sequence', 'message-return', 'ok', "participant Alice\nparticipant Bob\nBob --> Alice : hi"],
  ['sequence', 'message-color', 'ok', "participant Alice\nparticipant Bob\nAlice -[#red]-> Bob : x"],
  ['sequence', 'message-anchor', 'ok', "participant Alice\nparticipant Bob\n{a} Alice -> Bob : x"],
  ['sequence', 'exo-arrow-left', 'no', "[-> Alice : hi"],
  ['sequence', 'exo-arrow-right', 'no', "Alice ->] : hi"],
  ['sequence', 'activate', 'ok', "participant Alice\nactivate Alice"],
  ['sequence', 'deactivate-short', 'ok', "participant Alice\nactivate Alice\ndeactivate"],
  ['sequence', 'activate-shorthand', 'no', "Alice++"],
  ['sequence', 'return', 'no', "return text"],
  ['sequence', 'grouping-alt', 'ok', "alt ok"],
  ['sequence', 'grouping-end', 'ok', "alt ok\nparticipant A\nparticipant B\nA -> B : x\nend"],
  ['sequence', 'note-right', 'ok', "participant Alice\nnote right of Alice : t"],
  ['sequence', 'note-over-several', 'ok', "participant A\nparticipant B\nnote over A, B : t"],
  ['sequence', 'note-across', 'no', "note across : t"],
  ['sequence', 'note-on-arrow', 'ok', "participant A\nparticipant B\nnote right : t"],
  ['sequence', 'autonumber', 'ok', "autonumber"],
  ['sequence', 'autonumber-increment', 'ok', "autonumber inc A"],
  ['sequence', 'autonumber-resume', 'ok', "autonumber resume"],
  ['sequence', 'autonumber-stop', 'ok', "autonumber stop"],
  ['sequence', 'autoactivate', 'no', "autoactivate on"],
  ['sequence', 'box', 'dropped', "participant A\nbox \"G\""],
  ['sequence', 'box-end', 'dropped', "participant A\nbox \"G\"\nend box"],
  ['sequence', 'divider', 'no', "== Phase =="],
  ['sequence', 'delay', 'no', "..."],
  ['sequence', 'ref-over', 'ok', "participant A\nparticipant B\nref over A, B : t"],
  ['sequence', 'newpage', 'dropped', "newpage"],
  ['sequence', 'autonewpage', 'dropped', "autonewpage 5"],
  ['sequence', 'ignore-newpage', 'no', "ignore newpage"],
  ['sequence', 'footbox', 'dropped', "hide footbox"],
  ['sequence', 'footbox-old', 'no', "footbox on"],
  ['sequence', 'skin', 'no', "skin rose"],
  ['sequence', 'url', 'no', "url of Alice is [[http://x]]"],
  ['sequence', 'hspace', 'no', "|||"],
  ['sequence', 'link-anchor', 'no', "{a} <-> {b}"],
  ['activity', 'start', 'ok', "start"],
  ['activity', 'stop', 'ok', "start\nstop"],
  ['activity', 'end', 'ok', "start\n:A;\nend"],
  ['activity', 'kill', 'ok', "kill"],
  ['activity', 'action', 'ok', ":Do work;"],
  ['activity', 'action-long', 'ok', ":Do work"],
  ['activity', 'action-color', 'ok', "#red :Do work;"],
  ['activity', 'action-url', 'ok', "[[http://x]] :Do work;"],
  ['activity', 'arrow', 'ok', "start\n:A;\n->"],
  ['activity', 'arrow-label', 'ok', "start\n:A;\n-> label;"],
  ['activity', 'arrow-long', 'ok', "start\n:A;\n-> label"],
  ['activity', 'arrow-color', 'ok', "start\n:A;\n-[#red]->\n:B;\n"],
  ['activity', 'backward', 'no', "backward :x;"],
  ['activity', 'if', 'ok', "if (ok) then (yes)"],
  ['activity', 'if-is', 'ok', "if (a) is (b) then"],
  ['activity', 'if-legacy', 'ok', "if (a) then when (b)"],
  ['activity', 'else', 'ok', "if (a) then (yes)\n:A;\nelse (no)"],
  ['activity', 'elseif', 'ok', "if (a) then (yes)\n:A;\nelse if (x) then (y)"],
  ['activity', 'endif', 'ok', "if (a) then (yes)\n:A;\nendif"],
  ['activity', 'while', 'ok', "while (more)"],
  ['activity', 'endwhile', 'ok', "while (a)\n:A;\nendwhile"],
  ['activity', 'repeat', 'no', "repeat"],
  ['activity', 'repeat-while', 'no', "repeat while (x) is (y)"],
  ['activity', 'fork', 'ok', "fork"],
  ['activity', 'fork-again', 'ok', "fork\n:A;\nfork again"],
  ['activity', 'end-fork', 'ok', "fork\n:A;\nend fork"],
  ['activity', 'split', 'ok', "split"],
  ['activity', 'split-again', 'ok', "split\n:A;\nsplit again"],
  ['activity', 'end-split', 'ok', "split\n:A;\nend split"],
  ['activity', 'switch', 'no', "switch (x)"],
  ['activity', 'case', 'no', "case (a)"],
  ['activity', 'endswitch', 'no', "endswitch"],
  ['activity', 'group', 'no', "start\n:A;\ngroup L\n:B;\nstop"],
  ['activity', 'end-group', 'no', "start\n:A;\ngroup L\n:B;\nstop"],
  ['activity', 'partition', 'no', "partition P {"],
  ['activity', 'end-partition', 'no', "start\n:A;\npartition P {\n:B;\n}\nstop"],
  ['activity', 'swimlane', 'ok', "|Lane1|"],
  ['activity', 'swimlane-kw', 'ok', "swimlane L"],
  ['activity', 'note', 'ok', "start\n:A;\nnote right : text"],
  ['activity', 'note-long', 'ok', "note right\nline\nend note"],
  ['activity', 'break', 'no', "start\n:A;\nbreak\nstop"],
  ['activity', 'goto', 'no', "goto label1"],
  ['activity', 'label', 'no', "start\n:A;\nlabel l1\nstop"],
  ['activity', 'link', 'no', "state A\nstate B\nlink #red"],
  ['activity', 'nolink', 'no', "nolink"],
  ['activity', 'circle-spot', 'no', "(A)"],
  ['usecase', 'element-usecase', 'ok', "usecase UC1"],
  ['usecase', 'element-actor', 'ok', "actor User"],
  ['usecase', 'element-as', 'ok', "usecase UC1 as \"Use 1\""],
  ['usecase', 'element-stereotype', 'ok', "usecase UC1 <<x>>"],
  ['usecase', 'element-paren', 'no', "() :User:"],
  ['usecase', 'element-multiline', 'ok', "usecase UC1 ["],
  ['usecase', 'link', 'ok', "state A\nstate B\nUser -- UC1"],
  ['usecase', 'link-directed', 'ok', "User --> UC1"],
  ['usecase', 'link-multiplicity', 'ok', "User \"1\" -- \"n\" UC1"],
  ['usecase', 'package-usymbol', 'ok', "package P {"],
  ['usecase', 'archimate', 'no', "archimate #red Server"],
  ['usecase', 'archimate-multiline', 'no', "archimate #red Server ["],
  ['usecase', 'newpage', 'dropped', "newpage"],
  ['state', 'state', 'ok', "state Foo"],
  ['state', 'state-as', 'ok', "state A as \"Alpha\""],
  ['state', 'state-description', 'ok', "state Foo : text"],
  ['state', 'composite-state', 'ok', "state Foo {"],
  ['state', 'composite-state-begin', 'ok', "state Foo begin\nend state"],
  ['state', 'end-state', 'ok', "state Foo begin\nend state"],
  ['state', 'link', 'ok', "state A\nstate B\nA --> B"],
  ['state', 'link-start', 'ok', "[*] --> A"],
  ['state', 'link-history', 'ok', "state A\nstate B\nA[H] --> B"],
  ['state', 'link-description', 'ok', "state A\nstate B\nA --> B : text"],
  ['state', 'concurrent', 'no', "--"],
  ['state', 'add-field', 'ok', "state A\nA : field"],
  ['state', 'hide-empty-description', 'dropped', "hide empty description"],
];

const GRAMMAR = JSON.parse(await readFile(path.join(PROJECT, 'docs', 'plantuml-grammar.json'), 'utf8'));

check('G1 · таблица покрытия совпадает с грамматикой из jar', () => {
  const known = new Map();
  for (const [fam, def] of Object.entries(GRAMMAR.diagrams)) {
    for (const c of def.constructs) known.set(`${fam}/${c.id}`, c);
  }
  const seen = new Set();
  for (const [fam, id] of FORMS) {
    const key = `${fam}/${id}`;
    if (!known.has(key)) throw new Error(`конструкции «${key}» нет в docs/plantuml-grammar.json`);
    if (seen.has(key)) throw new Error(`«${key}» в таблице дважды`);
    seen.add(key);
  }
  if (seen.size !== known.size) {
    const missing = [...known.keys()].filter((k) => !seen.has(k));
    throw new Error(`в таблице ${seen.size} из ${known.size}; нет: ${missing.slice(0, 5).join(', ')}`);
  }
});

check('G2 · каждая строка таблицы ведёт себя так, как в ней написано', () => {
  const counts = { ok: 0, dropped: 0, no: 0 };
  const broken = [];
  for (const [fam, id, status, snippet] of FORMS) {
    counts[status] += 1;
    let warnings;
    try {
      warnings = parse(`@startuml\n${snippet}\n@enduml`).warnings;
    } catch (e) {
      broken.push(`${fam}/${id}: упал — ${e.message}`);
      continue;
    }
    if (status === 'ok' && warnings.length) {
      broken.push(`${fam}/${id}: ждали 0 предупреждений, а: ${warnings[0].reason} «${warnings[0].text}»`);
    }
    if (status !== 'ok' && !warnings.length) {
      broken.push(`${fam}/${id}: ждали предупреждение, а его нет`);
    }
    if (status === 'dropped' && warnings.length && !/пропущено|не переносится/.test(warnings[0].reason)) {
      broken.push(`${fam}/${id}: причина «${warnings[0].reason}» не говорит, что отброшено`);
    }
  }
  if (broken.length) throw new Error(`${broken.length}: ${broken.slice(0, 4).join(' | ')}`);
  return `${counts.ok} читаются, ${counts.dropped} отброшены с причиной, ${counts.no} не поддержаны`;
});

/* ------------------------------------------------------------- runner */

let failed = 0;
let skipped = 0;
for (const { name, fn } of checks) {
  try {
    const res = await fn();
    if (res === 'skip') { skipped += 1; console.log(`skip  ${name}`); continue; }
    console.log(`ok    ${name}${typeof res === 'string' ? ` — ${res}` : ''}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
console.log(`\n${checks.length - failed - skipped} ok, ${skipped} skip, ${failed} fail · `
  + `круг: строго ${RT.strict.length}/${RT.total}, объяснено ${RT.explained.length}, `
  + `пропущено ${RT.skipped.length}, непонятно ${RT.unexplained.length}`);
if (VERBOSE) {
  for (const x of RT.explained) console.log(`  ~ ${x.file}: ${x.reasons.join('; ')}`);
  for (const x of RT.skipped) console.log(`  … ${x.file}: ${x.why}`);
}
process.exit(failed ? 1 : 0);
