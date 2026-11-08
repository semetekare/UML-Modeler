// Перепривязка связей после автоматической раскладки — проверки без браузера.
//
// Раскладка двигает фигуры, но связь помнит СТОРОНУ и долю на ней. Пока этого
// никто не пересчитывал, после раскладки связь могла уходить из 'left' в
// пустоту, а её `waypoints` оставались в старой системе координат. Здесь
// доказывается, что происходит теперь:
//
//   * стороны переприкрепляются к тем кромкам, что смотрят друг на друга;
//   * связь, чья дефолтная ломаная резала чужую рамку, получает обход и
//     полилиния (`linkPoints`) эту рамку больше не пересекает;
//   * `noEdgeStyle` не трогается вообще — это не наш маршрут;
//   * связь, не касающаяся разложенных фигур, сохраняет свои ручные точки;
//   * два прогона дают одинаковый JSON (детерминизм), а сам план ничего не
//     меняет — модель меняется только в `applyLayoutPlan`;
//   * на настоящей модели (material/demo-errors.json, девять листов) прогон не
//     падает, все стороны из `SIDES`, все доли в [0,1], а каждая записанная
//     waypoint-ломаная обходит чужие рамки.
//
//   node tests/auto-route.mjs
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

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

const load = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { applyPackage } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8')));
const { deserialize } = await load('src/io/umljson.js');
const M = await load('src/model/model.js');
const G = await load('src/model/geometry.js');
const { routeOfLink } = await load('src/model/connector-style.js');
const { layoutSupport, planLayout, applyLayoutPlan } = await load('src/model/layout.js');
const { SIDES, facingPairs } = await load('src/model/auto-route.js');

const clone = (m) => JSON.parse(JSON.stringify(m));

/* ------------------------------------------------------------ пересечения */

/**
 * Отрезок задевает рамку? Своя копия проверки, а не импорт из `auto-route.js`:
 * тест обязан ловить ошибку модуля, а не повторять её. Допуск 0.5 px — линия,
 * идущая ровно по кромке, это удвоенная граница, а не обход.
 */
function segHitsRect(a, b, rect, pad = 0.5) {
  const x1 = rect.x - pad;
  const x2 = rect.x + rect.width + pad;
  const y1 = rect.y - pad;
  const y2 = rect.y + rect.height + pad;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return false;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - x1, x2 - a[0], a[1] - y1, y2 - a[1]];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

const polylineHits = (points, rect) => {
  for (let i = 1; i < points.length; i += 1) {
    if (segHitsRect(points[i - 1], points[i], rect)) return true;
  }
  return false;
};

const covers = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
  && outer.x + outer.width >= inner.x + inner.width
  && outer.y + outer.height >= inner.y + inner.height;

/** Чужие рамки листа для этой связи: без концов и без их контейнеров. */
function foreignFrames(m, d, link) {
  const shapes = d.shapes ?? [];
  const boxOf = (s) => {
    const b = G.layoutOf(s, M.elementOf(m, s));
    return { x: s.x, y: s.y, width: b.w, height: b.h };
  };
  const from = shapes.find((s) => s.id === link.from?.shapeId);
  const to = shapes.find((s) => s.id === link.to?.shapeId);
  if (!from || !to) return [];
  const fb = boxOf(from);
  const tb = boxOf(to);
  return shapes
    .filter((s) => s.id !== from.id && s.id !== to.id)
    .map(boxOf)
    .filter((r) => !covers(r, fb) && !covers(r, tb));
}

/** Полилиния связи так, как её рисует холст: концы + маршрут + изгибы. */
function drawn(m, d, link) {
  const shapes = d.shapes ?? [];
  const from = shapes.find((s) => s.id === link.from?.shapeId);
  const to = shapes.find((s) => s.id === link.to?.shapeId);
  if (!from || !to) return null;
  const lf = G.layoutOf(from, M.elementOf(m, from));
  const lt = G.layoutOf(to, M.elementOf(m, to));
  const p1 = G.endPoint(from, lf, link.from, link.entryPerimeter === true);
  const p2 = G.endPoint(to, lt, link.to, link.entryPerimeter === true);
  return G.linkPoints(p1, p2, routeOfLink(link), link.waypoints, link.noEdgeStyle === true);
}

/** Наружная нормаль стороны. */
const NORMAL = {
  top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0],
};

/* ----------------------------------------------------------- малая модель */

/**
 * Сцена: A, M, B стоят в ряд и раскладываются; между A и B — высокая M,
 * сверху — широкая «шапка». Поэтому прямая A—B режет M, обход сверху режет
 * шапку, и остаётся настоящий обход. C и D в раскладку не входят: у их связи
 * ручные точки, которые обязаны уцелеть.
 *
 * Стороны у связей заданы ЗАВЕДОМО НЕВЕРНО ('top'/'bottom' при цели справа) —
 * ровно та беда, ради которой модуль и написан.
 */
function scene() {
  const m = M.createModel('Проверка авто-маршрутов');
  const d = m.diagrams[0];
  m.currentDiagramId = d.id;

  const place = (name, x, y, w, h) => {
    const made = M.placeElement(m, 'class', x, y, { name });
    const s = d.shapes.find((z) => z.id === made.shape.id) ?? made.shape;
    s.x = x; s.y = y; s.w = w; s.h = h;
    return made;
  };
  const A = place('Заказ', 40, 40, 190, 170);
  const Mid = place('Счёт', 300, 40, 190, 300);
  const B = place('Клиент', 560, 40, 190, 170);
  const Top = place('Шапка', 240, -120, 280, 160);
  const C = place('Склад', 40, 500, 190, 170);
  const D = place('Курьер', 300, 500, 190, 170);

  const rel = (kind, a, b) => {
    const r = M.createRelationship(kind, a.element.id, b.element.id);
    m.relationships.push(r);
    return r;
  };
  const link = (r, a, b, from, to, extra = {}) => {
    const l = M.createLink(r, { shapeId: a.shape.id, ...from }, { shapeId: b.shape.id, ...to }, extra);
    d.links.push(l);
    return l;
  };

  const wrong = [{ side: 'top', t: 0.5 }, { side: 'top', t: 0.5 }];
  const adjacent = link(rel('dependency', A, Mid), A, Mid, ...wrong);
  const next = link(rel('dependency', Mid, B), Mid, B, ...wrong);
  // Эта связь обязана получить обход: между A и B стоит M.
  const around = link(rel('association', A, B), A, B, ...wrong);
  const outside = link(rel('association', C, D), C, D,
    { side: 'right', t: 0.5 }, { side: 'left', t: 0.5 });
  outside.waypoints = [[230, 560], [250, 570]];
  const locked = link(rel('association', A, Mid), A, Mid, ...wrong);
  locked.noEdgeStyle = true;

  return {
    m,
    d,
    shapes: { A, Mid, B, Top, C, D },
    links: { adjacent, next, around, outside, locked },
    selection: [A.shape.id, Mid.shape.id, B.shape.id],
  };
}

/* ------------------------------------------------------- стороны и пары */

await check('facingPairs: 16 пар без повторов, первая — по доминирующей оси', async () => {
  const horizontal = facingPairs({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 10, w: 100, h: 50 });
  assert(horizontal.length === 16, `пар ${horizontal.length}, а не 16`);
  const keys = new Set(horizontal.map(([a, b]) => `${a}/${b}`));
  assert(keys.size === 16, `уникальных пар ${keys.size}`);
  assert(horizontal[0].join('/') === 'right/left', `первая пара ${horizontal[0].join('/')}`);
  assert(horizontal[1].join('/') === 'bottom/top', `вторая пара ${horizontal[1].join('/')}`);

  const vertical = facingPairs({ x: 0, y: 0, w: 100, h: 50 }, { x: 10, y: 300, w: 100, h: 50 });
  assert(vertical[0].join('/') === 'bottom/top', `вертикаль: ${vertical[0].join('/')}`);
  assert(vertical[1].join('/') === 'right/left', `вертикаль вторая: ${vertical[1].join('/')}`);

  // Пара «правее-левее» выбирается по знаку, а не по «всегда right/left».
  const backward = facingPairs({ x: 300, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 50 });
  assert(backward[0].join('/') === 'left/right', `обратная: ${backward[0].join('/')}`);
  const again = facingPairs({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 10, w: 100, h: 50 });
  assert(JSON.stringify(again) === JSON.stringify(horizontal), 'два вызова дали разный порядок');
  return '16 пар, порядок один и тот же';
});

/* -------------------------------------------------------------- план */

const base = scene();
const before = JSON.stringify(base.m);
const plan = planLayout(base.m, { diagram: base.d, shapeIds: base.selection });
assert(plan.ok, `план не построился: ${plan.reason}`);

await check('план ничего не меняет в модели', async () => {
  assert(JSON.stringify(base.m) === before, 'planLayout изменил модель');
  return 'модель до применения та же, байт в байт';
});

await check('план считает переприкрепления и обход', async () => {
  const c = plan.counts;
  assert(c.reattached === 3, `переприкреплено ${c.reattached}, ожидалось 3`);
  assert(c.rerouted === 1, `перемаршрутизировано ${c.rerouted}, ожидалось 1`);
  assert(Array.isArray(plan.routes) && plan.routes.length === 3,
    `маршрутов ${plan.routes?.length}, ожидалось 3`);
  // Связи «наружу» (C—D) и noEdgeStyle в работу не попали.
  const ids = plan.routes.map((r) => r.id);
  assert(!ids.includes(base.links.outside.id), 'связь вне раскладки попала в маршруты');
  assert(!ids.includes(base.links.locked.id), 'связь noEdgeStyle попала в маршруты');
  // Число теряемых ручных точек — прежнее обещание диалога, его трогать нельзя.
  assert(c.points === 0, `точек ${c.points}`);
  return `связей ${c.links}, переприкреплено ${c.reattached}, с обходом ${c.rerouted}`;
});

const applied = applyLayoutPlan(base.m, plan);

await check('стороны переприкреплены и смотрят на собеседника', async () => {
  const { adjacent, next, around } = base.links;
  assert(adjacent.from.side === 'right' && adjacent.to.side === 'left',
    `A—M: ${adjacent.from.side}/${adjacent.to.side}`);
  assert(next.from.side === 'right' && next.to.side === 'left',
    `M—B: ${next.from.side}/${next.to.side}`);
  const shapes = new Map(base.d.shapes.map((s) => [s.id, s]));
  for (const l of [adjacent, next, around]) {
    for (const end of ['from', 'to']) {
      const own = shapes.get(l[end].shapeId);
      const other = shapes.get(l[end === 'from' ? 'to' : 'from'].shapeId);
      assert(SIDES.includes(l[end].side), `${end}.side = ${l[end].side}`);
      assert(l[end].t >= 0 && l[end].t <= 1, `${end}.t = ${l[end].t}`);
      const ownBox = G.layoutOf(own, M.elementOf(base.m, own));
      const otherBox = G.layoutOf(other, M.elementOf(base.m, other));
      const vx = (other.x + otherBox.w / 2) - (own.x + ownBox.w / 2);
      const vy = (other.y + otherBox.h / 2) - (own.y + ownBox.h / 2);
      const [nx, ny] = NORMAL[l[end].side];
      assert(nx * vx + ny * vy >= -1e-9,
        `${end}.side = ${l[end].side} смотрит ОТ собеседника`);
    }
  }
  return `${around.from.side}/${around.to.side} у связи вокруг препятствия`;
});

await check('связь через препятствие получила обход и не режет рамку', async () => {
  const l = base.links.around;
  assert(Array.isArray(l.waypoints) && l.waypoints.length >= 2,
    `waypoints: ${JSON.stringify(l.waypoints)}`);
  const pts = drawn(base.m, base.d, l);
  assert(pts && pts.length > 2, 'полилиния не построилась');
  // Фигура-препятствие — та самая M из сцены; имя живёт на элементе, а не
  // на фигуре, поэтому ссылка берётся из сцены, а не поиском по листу.
  const mid = base.shapes.Mid.shape;
  const midBox = G.layoutOf(mid, M.elementOf(base.m, mid));
  const rect = { x: mid.x, y: mid.y, width: midBox.w, height: midBox.h };
  assert(!polylineHits(pts, rect), 'полилиния всё ещё пересекает рамку препятствия');
  for (const r of foreignFrames(base.m, base.d, l)) {
    assert(!polylineHits(pts, r), 'полилиния пересекает чужую рамку');
  }
  return `точек обхода ${l.waypoints.length}, рамка ${midBox.w}×${midBox.h} обойдена`;
});

await check('связь noEdgeStyle не тронута ни в чём', async () => {
  const l = base.links.locked;
  assert(l.from.side === 'top' && l.from.t === 0.5, `from: ${JSON.stringify(l.from)}`);
  assert(l.to.side === 'top' && l.to.t === 0.5, `to: ${JSON.stringify(l.to)}`);
  assert(!('waypoints' in l), 'у noEdgeStyle появились точки');
  return 'стороны и точки как были';
});

await check('связь вне раскладки сохранила ручные точки', async () => {
  const l = base.links.outside;
  assert(JSON.stringify(l.waypoints) === JSON.stringify([[230, 560], [250, 570]]),
    `точки: ${JSON.stringify(l.waypoints)}`);
  assert(l.from.side === 'right' && l.to.side === 'left', 'стороны связи вне раскладки уехали');
  return 'две точки на месте';
});

await check('повторное применение того же плана ничего не меняет', async () => {
  const once = JSON.stringify(base.m);
  const again = applyLayoutPlan(base.m, plan);
  assert(JSON.stringify(base.m) === once, 'второй проход изменил модель');
  assert(again.moved === 0 && again.reattached === 0 && again.rerouted === 0,
    `второй проход: ${JSON.stringify(again)}`);
  return 'идемпотентно';
});

await check('два независимых прогона дают одинаковый JSON', async () => {
  // Обе прогонки идут из ОДНОГО снимка модели: `scene()` строит новые id, и
  // сравнивать два разных построения бессмысленно.
  const run = () => {
    const mm = JSON.parse(before);
    const d = mm.diagrams[0];
    const p = planLayout(mm, { diagram: d, shapeIds: base.selection });
    applyLayoutPlan(mm, p);
    return JSON.stringify(d);
  };
  const one = run();
  const two = run();
  assert(one === two, 'два прогона дали разные листы');
  assert(one === JSON.stringify(base.d), 'прогон из снимка разошёлся с применённым');
  return `${one.length} байт, байт в байт`;
});

await check('счётчики применения совпадают с планом', async () => {
  assert(applied.moved === 2, `переехало ${applied.moved}, ожидалось 2`);
  assert(applied.reattached === 3, `переприкреплено ${applied.reattached}`);
  assert(applied.rerouted === 1, `перемаршрутизировано ${applied.rerouted}`);
  assert(applied.pointsRemoved === 0 && applied.links === 0,
    `прежние поля: ${JSON.stringify(applied)}`);
  return JSON.stringify(applied);
});

/* --------------------------------------------------------- настоящая модель */

await check('настоящая модель: инварианты после раскладки', async () => {
  const text = await readFile(path.join(ROOT, 'material/demo-errors.json'), 'utf8');
  const source = deserialize(text);
  assert(source.diagrams.length > 1, 'нужна модель с несколькими листами');
  const started = Date.now();
  let sheets = 0;
  let links = 0;
  let reattached = 0;
  let rerouted = 0;
  let dirty = 0;
  const kinds = [];
  for (const sheet of source.diagrams) {
    if (!layoutSupport(sheet.kind).ok) continue;
    // Каждый лист раскладывается на своей копии: иначе следующий план считался
    // бы по уже переставленному предыдущим листу.
    const m = clone(source);
    const d = m.diagrams.find((x) => x.id === sheet.id);
    const plan = planLayout(m, { diagram: d });
    if (!plan.ok) continue;
    const applied = applyLayoutPlan(m, plan);
    sheets += 1;
    reattached += applied.reattached;
    rerouted += applied.rerouted;
    kinds.push(`${d.kind}:${applied.reattached}/${applied.rerouted}`);
    for (const l of d.links ?? []) {
      links += 1;
      for (const end of ['from', 'to']) {
        assert(SIDES.includes(l[end]?.side), `${d.kind}: ${end}.side = ${l[end]?.side}`);
        assert(Number.isFinite(l[end]?.t) && l[end].t >= 0 && l[end].t <= 1,
          `${d.kind}: ${end}.t = ${l[end]?.t}`);
      }
      if (!Array.isArray(l.waypoints) || !l.waypoints.length) continue;
      const pts = drawn(m, d, l);
      assert(pts && pts.length > 2, `${d.kind}: полилиния не построилась`);
      for (const r of foreignFrames(m, d, l)) {
        if (polylineHits(pts, r)) {
          throw new Error(`${d.kind}: waypoint-ломаная режет рамку ${r.x},${r.y} ${r.width}×${r.height}`);
        }
      }
    }
    // Связи БЕЗ обхода могут резать рамку — это разрешённый откат, но пусть
    // число будет видно: молчаливое «всё хорошо» здесь было бы неправдой.
    for (const l of d.links ?? []) {
      if (Array.isArray(l.waypoints) && l.waypoints.length) continue;
      if (l.noEdgeStyle === true) continue;
      const pts = drawn(m, d, l);
      if (pts && foreignFrames(m, d, l).some((r) => polylineHits(pts, r))) dirty += 1;
    }
  }
  const ms = Date.now() - started;
  assert(ms < 30000, `прогон занял ${ms} мс`);
  assert(sheets >= 5, `разложено листов ${sheets}`);
  assert(links > 50, `связей ${links}`);
  return `${sheets} листов, ${links} связей, переприкреплено ${reattached}, `
    + `перемаршрутизировано ${rerouted}, без обхода режут рамку ${dirty} (${kinds.join(' ')})`;
});

/* ---------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);