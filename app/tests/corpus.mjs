// Корпус против панели «Проверки» — набор, которого не было.
//
// Почему он нужен. `material/corpus-layout/check.mjs` — единственная проверка
// того, что 48 моделей пособия читаются схемой без потерь и раскладываются по
// правилам серии. До этой итерации на него ссылался только `selftest.mjs`,
// который проверяет сам `check.mjs` на выдуманных поломках; сам корпус в
// наборах не прогонялся. Поэтому регрессия Э2-бис (схема стала ждать id и
// массивы, а корпус хранил имена и числа) прожила незамеченной: `check.mjs`
// давал 7 замечаний, а все наборы оставались зелёными.
//
// Что здесь проверяется:
//   1. все 48 листов проходят `checkSheet` без единого замечания — это и есть
//      защита от повтора: любая правка схемы, ломающая корпус, падает здесь;
//   2. проверка не пустая: подложенная поломка (имя вместо id, потерянный
//      операнд) обязана дать замечание — иначе «0 замечаний» ничего не значит;
//   3. обе копии корпуса (`material/corpus-layout` с геометрией и
//      `tests/corpus` без неё) держат одни и те же `represents`,
//      `behaviorRef`, `regions`, `operands`;
//   4. `element-unnamed` на 48 моделях молчит, `element-isolated` на 5106
//      молчит, а настоящие сироты (5204, пустой ромб 3402) по-прежнему
//      называются — правило не ослепло, оно научилось видеть развёртывание;
//      отдельно доказывается, ЧТО спасает компоненты: тот же компонент,
//      вынесенный за пределы узла, обязан быть назван — иначе «0 находок»
//      ничего не значит, правило могло просто замолчать на виде;
//   5. `relationship-duplicate` различает связи по ролям и кратностям: опыт с
//      копией 4103, три варианта, три числа;
//   6. две законные связи между одной парой дают два разных пути `d`, и у
//      слипшихся пар корпуса пути тоже разошлись — иначе вторая линия
//      полностью скрыта под первой (то, что когда-то выглядело «дублем связи»).
//      Сам лист проверяется отдельно: `tests/connectors.mjs`, раздел 11.
//
//   node tests/corpus.mjs            прогон
//   node tests/corpus.mjs --verbose  с номерами листов
//
// Код возврата 0 — только если всё сошлось.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROJECT = path.resolve(ROOT, '..');
const LAYOUT = path.join(PROJECT, 'material', 'corpus-layout');
const CORPUS = path.join(PROJECT, 'tests', 'corpus');
const VERBOSE = process.argv.includes('--verbose');

const load = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { applyPackage } = await load('src/model/notation.js');
applyPackage(JSON.parse(fs.readFileSync(path.join(ROOT, 'notation/uml.json'), 'utf8')));
const { deserialize } = await load('src/io/umljson.js');
const { layoutOf, endPoint, linkPoints, pathD, labelPos, textWidth } = await load('src/model/geometry.js');
const { routeOfLink } = await load('src/model/connector-style.js');
const { parallelOffsets, parallelEnds } = await load('src/model/parallel-links.js');
const { createRuleset } = await load('src/rules/engine.js');
const { checkSheet } = await import(pathToFileURL(path.join(LAYOUT, 'check.mjs')).href);

const PRACTICE = JSON.parse(fs.readFileSync(path.join(ROOT, 'notation/rules/practice.json'), 'utf8'));
const STANDARD = JSON.parse(fs.readFileSync(path.join(ROOT, 'notation/rules/uml-2.5.1.json'), 'utf8'));
const both = createRuleset(STANDARD, { practice: PRACTICE });

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const figures = fs.readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json')
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

const layoutText = (figure) => fs.readFileSync(path.join(LAYOUT, `${figure}.uml.json`), 'utf8');
const layoutModel = (figure) => deserialize(layoutText(figure), { repairs: [] });
const corpusOf = (figure) => JSON.parse(fs.readFileSync(path.join(CORPUS, `${figure}.json`), 'utf8'));
const deep = (v) => JSON.stringify(v ?? null);
const norm = (v) => (v === null || v === undefined || v === '' ? null : v);

console.log('корпус и панель «Проверки»');

/* 1. Круг: все 48 листов без замечаний ------------------------------- */

await check('48 листов корпуса: ни одного замечания check.mjs', async () => {
  assert(figures.length === 48, `листов ${figures.length}, а не 48`);
  const bad = [];
  for (const figure of figures) {
    const { fails } = checkSheet(figure);
    if (fails.length) {
      bad.push(`${figure}: ${fails.map((f) => `[${f.code}] ${f.text}`).join('; ')}`);
    } else if (VERBOSE) {
      console.log(`       · ${figure} ok`);
    }
  }
  assert(!bad.length, `замечания есть у ${bad.length}: ${bad.slice(0, 3).join(' | ')}`);
  return `${figures.length} листов, 0 замечаний`;
});

/* 2. Проверка не пустая: подложенные поломки ------------------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-suite-'));
const put = (figure, model) => {
  fs.writeFileSync(path.join(tmp, `${figure}.uml.json`), `${JSON.stringify(model, null, 2)}\n`);
  return tmp;
};
const codesOf = (figure) => checkSheet(figure, { layoutDir: tmp }).fails.map((f) => f.code);

await check('поломка «имя вместо id» названа — та самая регрессия Э2-бис', async () => {
  // Именно так корпус и врал: `represents` строкой с именем элемента.
  const model = JSON.parse(layoutText('3401'));
  const lane = model.elements.find((e) => e.id === 'e1');
  delete lane.documentation;
  lane.represents = 'Пользователь (действующее лицо)';
  put('3401', model);
  const codes = codesOf('3401');
  assert(codes.includes('схема') || codes.includes('состав'),
    `ждали [схема] или [состав], получили [${[...new Set(codes)].join(', ') || '—'}]`);
  return `[${[...new Set(codes)].join(', ')}] — ссылка не переживает чтение, и это видно`;
});

await check('поломка «операнд потерян» названа', async () => {
  const model = JSON.parse(layoutText('4202'));
  const frag = model.elements.find((e) => e.id === 'e8');
  delete frag.operands;
  put('4202', model);
  const codes = codesOf('4202');
  assert(codes.includes('состав'),
    `ждали [состав], получили [${[...new Set(codes)].join(', ') || '—'}]`);
  return 'состав операндов сверяется с корпусом, потеря не проходит молча';
});

/* 3. Обе копии корпуса в синхроне ------------------------------------ */

const SYNCED = ['represents', 'behaviorRef', 'regions', 'operands'];

await check('обе копии корпуса: represents/behaviorRef/regions/operands совпадают', async () => {
  const bad = [];
  let compared = 0;
  for (const figure of figures) {
    const model = layoutModel(figure);
    const src = corpusOf(figure);
    const byId = new Map(model.elements.map((e) => [e.id, e]));
    for (const el of src.elements ?? []) {
      const got = byId.get(el.id);
      if (!got) { bad.push(`${figure} ${el.id}: элемента нет на листе`); continue; }
      for (const field of SYNCED) {
        compared += 1;
        if (deep(norm(el[field])) !== deep(norm(got[field]))) {
          bad.push(`${figure} ${el.id}.${field}: корпус ${deep(el[field])} ≠ лист ${deep(got[field])}`);
        }
      }
    }
  }
  assert(!bad.length, `${bad.length} расхождений: ${bad.slice(0, 3).join(' | ')}`);
  return `${compared} полей на ${figures.length} моделях`;
});

/* 4. Ложные срабатывания ушли, настоящие остались -------------------- */

const findingsOf = (figure) => both.run(layoutModel(figure));

await check('element-unnamed: на 48 моделях ни одной находки', async () => {
  const hits = [];
  for (const figure of figures) {
    for (const f of findingsOf(figure)) if (f.ruleId === 'element-unnamed') hits.push(`${figure}/${f.targets.join('+')}`);
  }
  assert(!hits.length, `находок ${hits.length}: ${hits.slice(0, 5).join(', ')}`);
  return 'было 5 (решения и слияния 3401/3402) — ромб в UML имени не носит';
});

await check('element-isolated: на 5106 ни одной находки', async () => {
  const hits = findingsOf('5106').filter((f) => f.ruleId === 'element-isolated');
  assert(!hits.length, `находок ${hits.length}: ${hits.map((f) => f.targets.join('+')).join(', ')}`);
  return 'было 6 — компоненты развёрнуты на узлах, и это видно по листу';
});

await check('element-isolated не ослепло: настоящие сироты названы', async () => {
  const isolated = (figure) => findingsOf(figure)
    .filter((f) => f.ruleId === 'element-isolated')
    .map((f) => f.targets.join('+'));
  const at5204 = isolated('5204');
  const at3402 = isolated('3402');
  const total = figures.reduce((n, f) => n + isolated(f).length, 0);
  assert(at5204.includes('e1'), `5204: ждали лишнюю линию жизни e1, получили [${at5204.join(', ') || '—'}]`);
  // `e2` — ромб `s11` @250,1150 без единого ребра: он лежит ВНУТРИ дорожки
  // «Студент», и именно поэтому правило не имеет права считать дорожку
  // контейнером — иначе этот настоящий дефект исчез бы вместе с ложными.
  assert(at3402.includes('e2'),
    `3402: ждали пустой ромб e2 (s11 внутри дорожки), получили [${at3402.join(', ') || '—'}]`);
  return `5204 e1 и пустой узел 3402 на месте, всего советов «сирота» ${total} — правило смотрит на связи, а не на вложенность дорожки`;
});

await check('element-isolated: на развёртывании спасает вложенность, а не вид фигуры', async () => {
  // Проверка выше говорит «на 5106 находок 0». Здесь доказывается, ЧТО именно
  // спасает компоненты: та же фигура, вынесенная за пределы узла, обязана быть
  // названа. Без этого «0 находок» ничего не значит: правило могло просто
  // ослепнуть на виде «component», и никто бы не заметил — ровно так и
  // выглядела бы починка ложных срабатываний, сделанная запретом.
  const base = layoutModel('5106');
  const comp = (base.elements ?? []).find((e) => e.kind === 'component');
  assert(comp, 'в 5106 нет компонента — сценарий не о том');
  const named = (model) => both.run(model)
    .filter((f) => f.ruleId === 'element-isolated' && f.targets.includes(comp.id)).length;
  assert(named(base) === 0, `вложенный ${comp.id} назван сиротой`);
  const moved = JSON.parse(JSON.stringify(base));
  const shape = moved.diagrams[0].shapes.find((s) => s.elementId === comp.id);
  shape.x = 1600; shape.y = 1000;            // вне всех узлов листа
  assert(named(moved) === 1, `вынесенный из узла ${comp.id} не назван (находок ${named(moved)})`);
  return `${comp.id} на узле молчит, он же вне узла назван — вложенность читается с листа, а не по виду`;
});

/* 5. relationship-duplicate: роли и кратности различают связи -------- */

await check('relationship-duplicate: опыт на копии 4103 (три варианта)', async () => {
  const base = layoutModel('4103');
  const clone = () => JSON.parse(JSON.stringify(base));
  const hits = (model) => both.run(model).filter((f) => f.ruleId === 'relationship-duplicate').length;

  // a) убрали роли И уравняли кратности — связи стали неразличимы
  const a = clone();
  const r7a = a.relationships.find((r) => r.id === 'r7');
  const r8a = a.relationships.find((r) => r.id === 'r8');
  delete r7a.fromRole; delete r8a.fromRole;
  r8a.fromMultiplicity = r7a.fromMultiplicity;
  r8a.toMultiplicity = r7a.toMultiplicity;
  const hitA = hits(a);

  // b) убрали только роли — кратности разные, правило молчит
  const b = clone();
  for (const r of b.relationships) if (r.id === 'r7' || r.id === 'r8') delete r.fromRole;
  const hitB = hits(b);

  // c) уравняли только кратности, роли на месте — тоже молчит
  const c = clone();
  const r7c = c.relationships.find((r) => r.id === 'r7');
  const r8c = c.relationships.find((r) => r.id === 'r8');
  r8c.fromMultiplicity = r7c.fromMultiplicity;
  r8c.toMultiplicity = r7c.toMultiplicity;
  const hitC = hits(c);

  assert(hitA === 1, `a) ждали 1 находку, получили ${hitA}`);
  assert(hitB === 0, `b) ждали тишину, получили ${hitB}`);
  assert(hitC === 0, `c) ждали тишину, получили ${hitC}`);
  return 'роли и кратности убраны → 1 находка; только роли → 0; только кратности → 0 (два различителя, оба настоящие)';
});

/* 6. Две связи одной пары — два различимых пути ---------------------- */

await check('параллельные связи: у слипшихся пар два разных пути d', async () => {
  const stuck = [];
  const separated = [];
  for (const figure of figures) {
    const model = layoutModel(figure);
    const d = model.diagrams?.[0];
    if (!d) continue;
    const byId = new Map(model.elements.map((e) => [e.id, e]));
    const boxOf = (id) => {
      const s = (d.shapes ?? []).find((x) => x.id === id);
      if (!s) return null;
      const laid = layoutOf(s, byId.get(s.elementId));
      return { x: s.x, y: s.y, w: laid.w, h: laid.h };
    };
    const offsets = parallelOffsets(d, model);
    const groups = new Map();
    for (const link of d.links ?? []) {
      const a = link.from?.shapeId; const b = link.to?.shapeId;
      if (!a || !b || a === b) continue;
      const rel = model.relationships.find((r) => r.id === link.relId);
      if (!rel) continue;
      const A = boxOf(a); const B = boxOf(b);
      if (!A || !B) continue;
      const key = [a, b].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      // «Как было» — маршрут без сдвига: если у двух связей он совпал, без
      // развода они рисовались одной линией.
      const raw = linkPoints(endPoint(A, A, link.from), endPoint(B, B, link.to),
        routeOfLink(link), link.waypoints, link.noEdgeStyle === true);
      const ends = parallelEnds(d, link, offsets);
      const now = linkPoints(endPoint(A, A, ends.from), endPoint(B, B, ends.to),
        routeOfLink(link), link.waypoints, link.noEdgeStyle === true);
      groups.get(key).push({ link, rel, raw: pathD(raw, 'off', 0), now: pathD(now, 'off', 0), pts: now });
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const raws = new Set(list.map((x) => x.raw));
      if (raws.size === list.length) continue;        // и так различимы
      const nows = new Set(list.map((x) => x.now));
      if (nows.size !== list.length) stuck.push(`${figure}: ${list.map((x) => x.link.id).join('+')}`);
      else separated.push(`${figure}/${list.map((x) => x.link.id).join('+')}`);
      // Подписи: у двух связей с разными маршрутами якоря подписи обязаны
      // разойтись, иначе человек видит один текст на две связи.
      const anchors = list.filter((x) => x.rel.name || x.rel.stereotype)
        .map((x) => labelPos(x.pts, x.link.ldx, x.link.ldy, x.link.labelOrientation));
      for (let i = 0; i < anchors.length; i += 1) {
        for (let k = i + 1; k < anchors.length; k += 1) {
          if (Math.hypot(anchors[i].x - anchors[k].x, anchors[i].y - anchors[k].y) < 6) {
            stuck.push(`${figure}: подписи ${list[i].link.id}/${list[k].link.id} в одной точке`);
          }
        }
      }
    }
  }
  assert(!stuck.length, `слиплись: ${stuck.join(' | ')}`);
  return `${separated.length} пар, у каждой свой путь: ${separated.join(', ')}`;
});

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(`${results.length - failed}/${results.length} проверок прошло`);
process.exit(failed ? 1 : 0);
