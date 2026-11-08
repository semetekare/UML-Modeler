// Автоматическая раскладка — ДОБРОВОЛЬНАЯ команда (итерация 23).
//
// Здесь только чистые функции: ни DOM, ни store, ни таймеров. Модуль ничего
// не делает при импорте — он не может «разложить само», и это не соглашение,
// а следствие: единственный вход — вызов `planLayout` человеком.
//
// Раскладка слоистая (Sugiyama-подобная) и честно названа приближением:
//   * ранги — самый длинный путь по направленным связям; ранг — это СТОЛБЕЦ,
//     предок левее потомка, а внутри ранга фигуры идут сверху вниз;
//   * порядок внутри ранга — барицентр соседей, два прохода;
//   * зазоры — 30 px по умолчанию, как в оригинале (draw.io Flow: Node
//     Spacing 30, Rank Spacing 30);
//   * размеры фигур — `layoutOf` (нарисованная рамка), поэтому фигура
//     переезжает, а не растягивается.
//
// Чего здесь принципиально НЕТ: сохранения ручных изгибов. Точки
// `waypoints` заданы в мировой системе координат; после того как фигуры
// переехали, они означают уже другое место. Поэтому `planLayout` их только
// СЧИТАЕТ (для диалога), а `applyLayoutPlan` — удаляет, и диалог говорит об
// этом до применения. Обещать «сохраню изгибы» было бы враньём.
//
// Зато связь не остаётся с ПРЕЖНИМИ сторонами: после переезда 'left' может
// смотреть в пустоту. Поэтому `planLayout` заодно считает маршруты
// (auto-route.js) для той же геометрии, что получится после применения, а
// `applyLayoutPlan` их записывает — стороны, доли и, где нужно, обход чужих
// рамок. Это не «сохранение изгибов», а их честная замена: старые точки
// удалены, новые посчитаны по новым координатам.

import { currentDiagram, findDiagram, elementOf } from './model.js';
import { layoutOf } from './geometry.js';
import { autoRouteLinks, applyAutoRoutes } from './auto-route.js';

export const DEFAULT_GAP = 30;
export const MIN_GAP = 8;
export const MAX_GAP = 200;
/** Поле внутри контейнера: содержимое не липнет к рамке. */
export const CONTAINER_PAD = 12;
/** Предел вложенности, чтобы битый файл не увёл рекурсию в глубину. */
const MAX_DEPTH = 8;

/**
 * Куда смотрит связь при подсчёте рангов.
 *
 * `generalization` и `realization` в файле идут от потомка к предку (маркер
 * нарисован у `to`), а ранг должен расти сверху вниз — поэтому они
 * разворачиваются. Остальные направленные связи читаются как есть.
 * Ненаправленные (ассоциация, композиция, link, connector, assembly,
 * communicationPath) рангов не задают — они только помогают порядку.
 */
const RANK_FORWARD = new Set([
  'dependency', 'usage', 'import', 'merge', 'include', 'extend',
  'transition', 'controlFlow', 'objectFlow',
  'deployment', 'manifest', 'delegation', 'extension',
  'message', 'reply', 'createMessage', 'destroyMessage',
]);
const RANK_REVERSE = new Set(['generalization', 'realization']);

/**
 * Где раскладка имеет смысл: фигуры свободно плавают.
 *
 * Диаграмма последовательности и диаграмма синхронизации сюда не входят:
 * у них ось — время (вертикаль сообщений и горизонталь времени), и
 * перестановка дорожек переписала бы смысл, а не картинку.
 */
export const LAYOUT_KINDS = new Set([
  'class', 'object', 'package', 'component', 'composite', 'deployment',
  'usecase', 'state', 'activity', 'profile', 'communication',
  'interaction-overview',
]);

export const LAYOUT_REFUSALS = {
  sequence: 'Диаграмма последовательности не раскладывается: вертикаль на ней — '
    + 'это порядок сообщений, а не расстояние. Перестановка линий жизни переписала бы '
    + 'смысл диаграммы, поэтому команда отказывает. Расставьте линии вручную.',
  timing: 'Диаграмма синхронизации не раскладывается: горизонталь на ней — это время, '
    + 'а не место. Раскладка сдвинула бы события во времени и изменила бы смысл. '
    + 'Расставьте дорожки вручную.',
};

/** Можно ли раскладывать лист этого типа. Отказ всегда с объяснением. */
export function layoutSupport(kind) {
  if (!kind) return { ok: false, reason: 'Нет открытого листа — раскладывать нечего.' };
  if (LAYOUT_REFUSALS[kind]) return { ok: false, reason: LAYOUT_REFUSALS[kind] };
  if (!LAYOUT_KINDS.has(kind)) {
    return { ok: false, reason: `Лист типа «${kind}» не входит в список раскладываемых.` };
  }
  return { ok: true, reason: '' };
}

export const clampGap = (g) => {
  const n = Number(g);
  if (!Number.isFinite(n)) return DEFAULT_GAP;
  return Math.min(MAX_GAP, Math.max(MIN_GAP, Math.round(n)));
};

/**
 * Связи, задающие направление, в виде `{from, to}` «сверху вниз».
 * `kindOf(link)` возвращает вид связи (association, generalization, …).
 */
export function directedEdges(links, kindOf) {
  const out = [];
  for (const l of links ?? []) {
    const from = l?.from?.shapeId;
    const to = l?.to?.shapeId;
    if (!from || !to || from === to) continue;
    const kind = kindOf ? kindOf(l) : '';
    if (RANK_FORWARD.has(kind)) out.push({ from, to, kind });
    else if (RANK_REVERSE.has(kind)) out.push({ from: to, to: from, kind });
  }
  return out;
}

/* ------------------------------------------------------------ алгоритм */

/**
 * Слоистая раскладка. Чистая: `nodes` не меняются, возвращаются координаты.
 *
 *   nodes: [{ id, w, h }]      размеры — уже посчитанные (layoutOf)
 *   edges: [{ from, to }]      направление «предок → потомок»
 *   opts:  { gap, originX, originY, adjacency }
 *
 * `adjacency` — ненаправленные пары `[a, b]` (ассоциации, компоновка): они не
 * задают ранг, но когда направленных связей на уровне нет вовсе, именно они
 * ставят фигуры в столбцы обходом в ширину. Без них диаграмма вариантов
 * использования встала бы одной колонкой.
 *
 * Возвращает `{ positions, ranks, rows, size, gap }`; `positions[id]` —
 * левый верхний угол, `rows[rank]` — фигуры этого ранга сверху вниз.
 * Рамки не пересекаются по построению: столбцы разнесены на `gap`, внутри
 * столбца фигуры стоят через `gap`.
 */
export function layeredLayout(nodes, edges = [], opts = {}) {
  const gap = clampGap(opts.gap ?? DEFAULT_GAP);
  const list = (nodes ?? []).map((n) => ({
    id: n.id, w: Number(n.w) || 0, h: Number(n.h) || 0,
  }));
  const ids = list.map((n) => n.id);
  const known = new Set(ids);
  const succ = new Map(ids.map((id) => [id, []]));
  const pred = new Map(ids.map((id) => [id, []]));
  const undir = new Map(ids.map((id) => [id, []]));
  const seen = new Set();
  for (const e of edges ?? []) {
    const a = e?.from;
    const b = e?.to;
    if (!known.has(a) || !known.has(b) || a === b) continue;
    const key = `${a}\u0000${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    succ.get(a).push(b);
    pred.get(b).push(a);
    undir.get(a).push(b);
    undir.get(b).push(a);
  }

  // Ненаправленные пары — только для уровней без направленных связей.
  const adj = new Map(ids.map((id) => [id, []]));
  if (!seen.size) {
    for (const pair of opts.adjacency ?? []) {
      const a = Array.isArray(pair) ? pair[0] : pair?.from;
      const b = Array.isArray(pair) ? pair[1] : pair?.to;
      if (!known.has(a) || !known.has(b) || a === b) continue;
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
  }

  const rank = longestPath(ids, succ);
  // Компоненты без единой направленной связи (например, одни ассоциации на
  // диаграмме классов или актёр и варианты использования) получают ранги
  // обходом в ширину: иначе все встали бы в один столбец.
  assignFreeRanks(ids, rank, seen.size ? undir : adj, succ, pred);
  const rows = groupRows(ids, rank);
  orderRows(rows, pred, succ);
  return place(rows, list, gap, opts);
}

/** Самый длинный путь по DAG. Цикл рвётся на обратном ребре, а не падает. */
function longestPath(ids, succ) {
  const state = new Map();  // 1 — в стеке, 2 — готово
  const dag = new Map(ids.map((id) => [id, []]));
  for (const start of ids) {
    if (state.get(start)) continue;
    state.set(start, 1);
    const stack = [{ v: start, i: 0 }];
    while (stack.length) {
      const f = stack[stack.length - 1];
      const outs = succ.get(f.v) ?? [];
      if (f.i < outs.length) {
        const w = outs[f.i];
        f.i += 1;
        const st = state.get(w) ?? 0;
        if (st === 1) continue;          // обратное ребро: цикл разорван здесь
        dag.get(f.v).push(w);
        if (!st) { state.set(w, 1); stack.push({ v: w, i: 0 }); }
      } else {
        state.set(f.v, 2);
        stack.pop();
      }
    }
  }

  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const w of dag.get(id)) indeg.set(w, indeg.get(w) + 1);
  const rank = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (const w of dag.get(v)) {
      if (rank.get(v) + 1 > rank.get(w)) rank.set(w, rank.get(v) + 1);
      indeg.set(w, indeg.get(w) - 1);
      if (!indeg.get(w)) queue.push(w);
    }
  }
  return rank;
}

function assignFreeRanks(ids, rank, undir, succ, pred) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const w of undir.get(v)) if (!seen.has(w)) { seen.add(w); stack.push(w); }
    }
    if (comp.length < 2) continue;
    if (comp.some((v) => succ.get(v).length || pred.get(v).length)) continue;
    // Семя — самая связанная фигура: у диаграммы вариантов использования
    // это актёр, и варианты встают справа от него.
    let seed = comp[0];
    let best = -1;
    for (const v of comp) {
      const deg = undir.get(v).length;
      if (deg > best) { best = deg; seed = v; }
    }
    const depth = new Map([[seed, 0]]);
    const q = [seed];
    for (let i = 0; i < q.length; i++) {
      const v = q[i];
      for (const w of undir.get(v)) {
        if (depth.has(w)) continue;
        depth.set(w, depth.get(v) + 1);
        q.push(w);
      }
    }
    for (const v of comp) rank.set(v, depth.get(v) ?? 0);
  }
}

function groupRows(ids, rank) {
  const max = ids.reduce((m, id) => Math.max(m, rank.get(id) ?? 0), 0);
  const rows = Array.from({ length: max + 1 }, () => []);
  for (const id of ids) rows[rank.get(id) ?? 0].push(id);
  return rows;
}

/**
 * Порядок внутри ранга по барицентру соседей: проход вниз (смотрим на
 * предыдущий ранг), затем вверх (на следующий). Два прохода — как в
 * требовании; больше не значит лучше на десяти фигурах.
 */
function orderRows(rows, pred, succ) {
  const positions = (r) => new Map(rows[r].map((id, i) => [id, i]));
  const pass = (r, neigh, near) => {
    const pos = positions(near);
    const row = rows[r];
    const scored = row.map((id, i) => {
      const at = (neigh.get(id) ?? []).map((n) => pos.get(n)).filter((v) => v !== undefined);
      const b = at.length ? at.reduce((a, c) => a + c, 0) / at.length : i;
      return { id, b, i };
    });
    scored.sort((a, c) => a.b - c.b || a.i - c.i);
    rows[r] = scored.map((s) => s.id);
  };
  for (let r = 1; r < rows.length; r++) pass(r, pred, r - 1);
  for (let r = rows.length - 2; r >= 0; r--) pass(r, succ, r + 1);
  return rows;
}

function place(rows, list, gap, opts) {
  const byId = new Map(list.map((n) => [n.id, n]));
  const colW = rows.map((row) => row.reduce((m, id) => Math.max(m, byId.get(id).w), 0));
  const colH = rows.map((row) => row.reduce((s, id, i) => s + byId.get(id).h + (i ? gap : 0), 0));
  const sizeW = colW.reduce((s, w, i) => s + w + (i ? gap : 0), 0);
  const sizeH = colH.reduce((m, h) => Math.max(m, h), 0);
  const x0 = Number.isFinite(opts.originX) ? opts.originX : 0;
  const y0 = Number.isFinite(opts.originY) ? opts.originY : 0;

  const positions = {};
  const ranks = {};
  let x = 0;
  rows.forEach((row, r) => {
    let y = 0;
    for (const id of row) {
      const n = byId.get(id);
      positions[id] = {
        x: Math.round(x0 + x + (colW[r] - n.w) / 2),
        y: Math.round(y0 + y),
      };
      ranks[id] = r;
      y += n.h + gap;
    }
    x += colW[r] + gap;
  });
  return { positions, ranks, rows: rows.map((row) => [...row]), size: { w: sizeW, h: sizeH }, gap };
}

/* -------------------------------------------------- модель → раскладка */

/** Виды фигур, внутри которых живут другие фигуры. */
const CONTAINER_KINDS = new Set([
  'package', 'model', 'profile', 'node', 'device', 'executionEnvironment',
  'component', 'systemBoundary', 'swimlane', 'frame', 'activity',
  'class', 'interface', 'collaboration',
]);

/**
 * Родитель каждой фигуры на листе.
 *
 * Два источника, в этом порядке: владение в модели (`element.ownerId` — то,
 * что показывает дерево) и геометрия (фигура целиком лежит в рамке
 * контейнера). Второе нужно потому, что нарисованное «артефакт внутри узла»
 * в модели владельцем не записано.
 *
 * Экспортируется для проверок: «пересечение» считается только между
 * соседями, а вложенность — это рамка внутри рамки по замыслу.
 */
export function parentsOf(m, d) {
  const parent = new Map();
  const shapes = d.shapes ?? [];
  const boxOf = new Map(shapes.map((s) => {
    const b = layoutOf(s, elementOf(m, s));
    return [s.id, { w: b.w, h: b.h }];
  }));

  for (const s of shapes) {
    const own = boxOf.get(s.id);
    // 1. Владение в модели: ближайший предок, у которого есть вид на листе.
    const el = elementOf(m, s);
    let cur = el?.ownerId ?? null;
    let found = null;
    let guard = 0;
    while (cur && guard++ < MAX_DEPTH * 4) {
      const ownerEl = (m.elements ?? []).find((e) => e.id === cur);
      if (!ownerEl) break;
      const ownerShape = shapes.find((o) => o.id !== s.id && o.elementId === ownerEl.id);
      if (ownerShape) { found = ownerShape; break; }
      cur = ownerEl.ownerId ?? null;
    }
    if (found) { parent.set(s.id, found.id); continue; }

    // 2. Геометрия: самая маленькая рамка-контейнер, накрывающая фигуру.
    let best = null;
    let bestArea = Infinity;
    for (const o of shapes) {
      if (o.id === s.id) continue;
      const def = elementOf(m, o);
      if (!CONTAINER_KINDS.has(def?.kind ?? '')) continue;
      const ob = boxOf.get(o.id);
      const area = ob.w * ob.h;
      if (area >= bestArea || area <= own.w * own.h) continue;
      const inside = o.x <= s.x && o.y <= s.y
        && o.x + ob.w >= s.x + own.w && o.y + ob.h >= s.y + own.h;
      if (inside) { best = o; bestArea = area; }
    }
    if (best) parent.set(s.id, best.id);
  }
  return parent;
}

/**
 * Ненаправленные пары для уровня: каждая связь сводится к двум фигурам ЭТОГО
 * уровня. Связь «актёр — вариант использования» на уровне корней становится
 * парой «актёр — рамка системы»: иначе актёр оказался бы один в своей
 * компоненте, а рамка — в своей, и обе встали бы в один столбец.
 */
function adjacencyAt(links, levelSet, parent) {
  const top = (id) => {
    let cur = id;
    let guard = 0;
    while (guard++ < MAX_DEPTH * 4) {
      const p = parent.get(cur);
      if (!p || !levelSet.has(p)) break;
      cur = p;
    }
    return cur;
  };
  const pairs = [];
  for (const l of links ?? []) {
    const a = l?.from?.shapeId;
    const b = l?.to?.shapeId;
    if (!a || !b || a === b) continue;
    const ta = top(a);
    const tb = top(b);
    if (ta === tb || !levelSet.has(ta) || !levelSet.has(tb)) continue;
    pairs.push([ta, tb]);
  }
  return pairs;
}

/**
 * План раскладки. Ничего не меняет: считает координаты и потери.
 *
 * `shapeIds` — выделение; пусто/`null` — весь лист. Набор замыкается по
 * вложенности: контейнер выделенной фигуры входит в набор (иначе фигуру
 * пришлось бы вытащить из рамки), а содержимое выделенного контейнера —
 * тоже (раскладывать контейнер, оставив его содержимое на месте, нельзя).
 */
export function planLayout(m, { shapeIds = null, gap = DEFAULT_GAP, diagram = null } = {}) {
  const d = diagram ?? currentDiagram(m);
  if (!d) return { ok: false, reason: 'Нет открытого листа — раскладывать нечего.' };
  const support = layoutSupport(d.kind);
  if (!support.ok) return { ok: false, refused: true, reason: support.reason };

  const g = clampGap(gap);
  const byId = new Map((d.shapes ?? []).map((s) => [s.id, s]));
  const asked = Array.isArray(shapeIds) ? shapeIds.filter((id) => byId.has(id)) : [];
  const scope = asked.length ? 'selection' : 'sheet';
  const wanted = asked.length ? new Set(asked) : new Set(byId.keys());

  const parent = parentsOf(m, d);
  const children = new Map();
  for (const [child, par] of parent) {
    if (!children.has(par)) children.set(par, []);
    children.get(par).push(child);
  }

  // Замыкание: вверх по контейнерам, затем вниз по содержимому.
  const set = new Set(wanted);
  for (const id of [...set]) {
    let cur = parent.get(id);
    let guard = 0;
    while (cur && guard++ < MAX_DEPTH) { set.add(cur); cur = parent.get(cur); }
  }
  const queue = [...set];
  for (let qi = 0; qi < queue.length; qi++) {
    for (const kid of children.get(queue[qi]) ?? []) {
      if (!set.has(kid)) { set.add(kid); queue.push(kid); }
    }
  }

  if (set.size < 2) {
    return {
      ok: false,
      reason: set.size
        ? 'Раскладывать нечего: на листе одна фигура. Нужно две или больше.'
        : 'Раскладывать нечего: на листе нет фигур.',
    };
  }

  const kindOf = (link) => (m.relationships ?? []).find((r) => r.id === link.relId)?.kind ?? '';
  const edges = directedEdges(d.links ?? [], kindOf)
    .filter((e) => set.has(e.from) && set.has(e.to));

  // Размеры — из layoutOf: раскладка двигает, а не растягивает.
  const box = new Map();
  for (const id of set) {
    const s = byId.get(id);
    const b = layoutOf(s, elementOf(m, s));
    box.set(id, { w: b.w, h: b.h });
  }

  const local = new Map();   // id → {x, y} относительно контейнера
  const eff = new Map();     // id → {w, h} с учётом выросших контейнеров
  const grown = [];

  const sizeOf = (id) => {
    if (eff.has(id)) return eff.get(id);
    const own = box.get(id);
    const kids = (children.get(id) ?? []).filter((k) => set.has(k));
    if (!kids.length) { eff.set(id, { ...own }); return eff.get(id); }
    const kidNodes = kids.map((k) => ({ id: k, ...sizeOf(k) }));
    const kidSet = new Set(kids);
    const kidEdges = edges.filter((e) => kidSet.has(e.from) && kidSet.has(e.to));
    const inner = layeredLayout(kidNodes, kidEdges, {
      gap: g, originX: 0, originY: 0,
      adjacency: adjacencyAt(d.links ?? [], kidSet, parent),
    });
    const w = Math.max(own.w, inner.size.w + 2 * CONTAINER_PAD);
    const h = Math.max(own.h, inner.size.h + 2 * CONTAINER_PAD);
    const ox = (w - inner.size.w) / 2;
    const oy = (h - inner.size.h) / 2;
    for (const kid of kids) {
      const p = inner.positions[kid] ?? { x: 0, y: 0 };
      local.set(kid, { x: p.x + ox, y: p.y + oy });
    }
    if (w > own.w || h > own.h) grown.push(id);
    eff.set(id, { w, h });
    return eff.get(id);
  };

  const roots = [...set].filter((id) => !parent.has(id) || !set.has(parent.get(id)));
  const rootSet = new Set(roots);
  const rootNodes = roots.map((id) => ({ id, ...sizeOf(id) }));
  const rootEdges = edges.filter((e) => rootSet.has(e.from) && rootSet.has(e.to));

  // Начало координат листа сохраняется: левый верхний угол набора остаётся
  // там, где стоял.
  let minX = Infinity;
  let minY = Infinity;
  for (const id of set) {
    const s = byId.get(id);
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
  }
  const top = layeredLayout(rootNodes, rootEdges, {
    gap: g,
    originX: Number.isFinite(minX) ? minX : 0,
    originY: Number.isFinite(minY) ? minY : 0,
    adjacency: adjacencyAt(d.links ?? [], rootSet, parent),
  });

  const abs = new Map();
  for (const id of roots) abs.set(id, { ...(top.positions[id] ?? { x: 0, y: 0 }) });
  const placeKids = (id, depth = 0) => {
    if (depth > MAX_DEPTH) return;
    const a = abs.get(id);
    if (!a) return;
    for (const kid of children.get(id) ?? []) {
      if (!set.has(kid)) continue;
      const l = local.get(kid) ?? { x: 0, y: 0 };
      abs.set(kid, { x: Math.round(a.x + l.x), y: Math.round(a.y + l.y) });
      placeKids(kid, depth + 1);
    }
  };
  for (const id of roots) placeKids(id);

  const moves = [];
  for (const id of set) {
    const s = byId.get(id);
    const at = abs.get(id);
    if (!at) continue;
    const size = eff.get(id) ?? box.get(id);
    const move = { id, x: at.x, y: at.y };
    if (size.w > box.get(id).w || size.h > box.get(id).h) {
      move.w = Math.round(size.w);
      move.h = Math.round(size.h);
    }
    if (move.x !== s.x || move.y !== s.y || move.w != null) moves.push(move);
  }

  // Изгибы: у связей, которые касаются разложенных фигур, точки записаны в
  // мировой системе координат и после переезда врут. Поэтому раскладка удаляет
  // их у ВСЕХ таких связей (`waypointLinks` ниже), а какие из них потеряны
  // по-настоящему — считает `lostBends` после расчёта маршрутов.
  const touching = (d.links ?? []).filter((l) => set.has(l.from?.shapeId) || set.has(l.to?.shapeId));
  const bent = touching.filter((l) => Array.isArray(l.waypoints) && l.waypoints.length);

  // Маршруты считаются для геометрии ПОСЛЕ переезда, а модель ещё не тронута:
  // поэтому лист подменяется копией с планируемыми координатами. Иначе пара
  // сторон выбиралась бы по старым местам, а записалась бы в новые — ровно та
  // ошибка, ради которой всё это делается.
  const moved = new Map(moves.map((mv) => [mv.id, mv]));
  const planned = {
    ...d,
    shapes: (d.shapes ?? []).map((s) => {
      const mv = moved.get(s.id);
      if (!mv) return s;
      const next = { ...s, x: mv.x, y: mv.y };
      if (mv.w != null && mv.h != null) { next.w = mv.w; next.h = mv.h; }
      return next;
    }),
  };
  const routed = autoRouteLinks(m, planned, { shapeIds: [...set] });

  // Потерянные изгибы — НЕ все точки касающихся связей, а только те, которые
  // раскладка не воспроизведёт: у уже разложенной связи изгибы поставлены ею
  // же, и второй прогон обязан сказать «терять нечего», а не «18 точек —
  // будут потеряны». Иначе диалог пугает тем, чего не произойдёт.
  const plannedRouted = new Map(routed.routes.map((r) => [r.id, r]));
  const lost = bent.filter((l) => {
    const r = plannedRouted.get(l.id);
    if (!r || !r.waypoints) return true;
    return !sameWaypoints(l.waypoints, r.waypoints);
  });
  const points = lost.reduce((n, l) => n + l.waypoints.length, 0);

  return {
    ok: true,
    diagramId: d.id,
    diagramKind: d.kind,
    scope,
    gap: g,
    counts: {
      shapes: set.size,
      selected: asked.length,
      links: touching.length,
      bentLinks: bent.length,
      // Сколько точек человек действительно теряет: без тех, что раскладка
      // поставит на том же месте сама.
      lostLinks: lost.length,
      points,
      grown: grown.length,
      // Связи, которым раскладка не только дала новые пути, но и новые концы.
      // Это счётчики диалога/статуса, а не потерянные точки: `points` выше
      // остаётся ровно тем, что обещает диалог.
      reattached: routed.stats.reattached,
      rerouted: routed.stats.rerouted,
      routedLinks: routed.routes.length,
    },
    moves,
    grown,
    // Удаляются точки у ВСЕХ связей, которых коснулась раскладка, даже у тех,
    // что `auto-route` не берёт (noEdgeStyle, авторский `.attach`, сообщения):
    // их точки записаны в старой системе координат и после переезда фигуры
    // врут. Диалог об этом предупреждает до применения — «точки будут удалены,
    // а связи проложатся заново»; молчаливой потери нет.
    waypointLinks: bent.map((l) => l.id),
    routes: routed.routes,
    rows: top.rows,
    ranks: top.ranks,
  };
}

/**
 * Совпадают ли изгибы с точностью, с какой их пишет `applyAutoRoutes`
 * (десятая доля пикселя): сравнение «как в файле», а не «как в памяти».
 */
function sameWaypoints(have, next) {
  if (!Array.isArray(have) || have.length !== next.length) return false;
  return have.every((p, i) => Array.isArray(p)
    && Math.abs(Number(p[0]) - Number(next[i][0])) <= 0.051
    && Math.abs(Number(p[1]) - Number(next[i][1])) <= 0.051);
}

/**
 * Применить план. Единственная мутирующая функция — и её зовёт только
 * команда внутри `commit`, поэтому одна отмена возвращает и координаты, и
 * удалённые точки.
 */
export function applyLayoutPlan(m, plan) {
  const d = (plan?.diagramId ? findDiagram(m, plan.diagramId) : null) ?? currentDiagram(m);
  if (!d) return { moved: 0, resized: 0, pointsRemoved: 0, links: 0, reattached: 0, rerouted: 0 };
  const byId = new Map((d.shapes ?? []).map((s) => [s.id, s]));
  let moved = 0;
  let resized = 0;
  for (const mv of plan.moves ?? []) {
    const s = byId.get(mv.id);
    if (!s) continue;
    if (s.x !== mv.x || s.y !== mv.y) moved += 1;
    s.x = mv.x;
    s.y = mv.y;
    if (mv.w != null && mv.h != null && (s.w !== mv.w || s.h !== mv.h)) {
      s.w = mv.w;
      s.h = mv.h;
      resized += 1;
    }
  }
  let pointsRemoved = 0;
  let links = 0;
  const wanted = new Set(plan.waypointLinks ?? []);
  for (const l of d.links ?? []) {
    if (!wanted.has(l.id) || !Array.isArray(l.waypoints) || !l.waypoints.length) continue;
    pointsRemoved += l.waypoints.length;
    links += 1;
    delete l.waypoints;
  }
  // Стороны и обход считались по планируемым координатам, а фигуры теперь
  // стоят именно там — запись идёт после перемещений и удаления старых точек:
  // иначе старые точки попали бы в проверку «ломаная не режет рамку».
  const routed = applyAutoRoutes(d, plan.routes);
  return {
    moved,
    resized,
    pointsRemoved,
    links,
    reattached: routed.reattached,
    rerouted: routed.rerouted,
  };
}
