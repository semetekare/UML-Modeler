// Сборка раскладки корпуса: `tests/corpus/<номер>.json` → `<номер>.uml.json`.
//
// Скрипт только раскладывает. Семантику он не трогает: элементы и связи
// берутся из корпуса как есть, добавляются `shapes` и `links` диаграммы.
// Правила раскладки — по типу диаграммы, одни на все листы типа; они описаны
// в docs/research/CORPUS-LAYOUT.md, а проверяются check.mjs.
//
// Запуск: node material/corpus-layout/build.mjs [номера…]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadNotation, readCorpus, corpusFiles, NOTATION, layoutOf, serialize, sizeFor, boxOf,
  footprintOf, gridPlace, routeLink, snap, ceilTo, MARGIN, GAP, OUT,
  LIFELINE_HEAD, ACTOR_LIFELINE_HEAD, MESSAGE_GAP, round3, MIN_SHEET,
} from './lib.mjs';

loadNotation();

/** Виды фигур, которые держат другие внутри: связь через их рамку — норма. */
const CONTAINER_STYLES = new Set(['boundary', 'swimlane', 'activity', 'frame', 'package',
  'node', 'component', 'part', 'port']);
export const isContainer = (kind) => CONTAINER_STYLES.has(NOTATION.shapes[kind]?.style);
export const isSequenceKind = (kind) => NOTATION.connectors[kind]?.sequence === true;
const isLifeline = (kind) => kind === 'lifeline' || kind === 'actorLifeline';
const isFrameKind = (kind) => NOTATION.shapes[kind]?.style === 'frame';
/** Наименьший зазор между соседними фигурами — правило серии в `check.mjs`. */
const MIN_GAP = 40;

const indexOf = (src) => new Map(src.elements.map((e, i) => [e.id, i]));
const showable = (src) => src.relationships.filter((r) => r.from != null && r.to != null);

/* ------------------------------------------------------------ укладки */

/**
 * Сетка: классы, пакеты, составная структура, размещение.
 *
 * `fill: 'centre'` заполняет ячейки от середины: узел со многими связями
 * оказывается в центре, а не в углу, и соседние фигуры не перекрывают маршрут
 * к нему. `degreeOrder` ставит такие узлы первыми — им и достаётся центр.
 */
function layoutGrid(src, order, { fill = 'row', degreeOrder = false } = {}) {
  const deg = new Map(src.elements.map((e) => [e.id, 0]));
  for (const r of showable(src)) {
    deg.set(r.from, (deg.get(r.from) ?? 0) + 1);
    deg.set(r.to, (deg.get(r.to) ?? 0) + 1);
  }
  const idx = indexOf(src);
  const items = degreeOrder
    ? [...order].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || idx.get(a.id) - idx.get(b.id))
    : order;
  const sized = items.map((e) => ({ element: e, ...sizeFor(e) }));
  const { placed } = gridPlace(sized, { gap: GAP, fill });
  const shapes = placed.map((p) => ({ element: p.element, x: MARGIN + p.x, y: MARGIN + p.y, w: p.w, h: p.h }));
  return { shapes: improveRoutes(src, shapes), links: [] };
}

/**
 * Развязка маршрутов перестановкой мест.
 *
 * Сетка ставит фигуру в ячейку по её размеру и связности, а маршрут связи может
 * пройти сквозь третью фигуру: у рис. 5.2.23 две параллельные ассоциации
 * Schedule—CourseOffering идут из нижней полосы в верхнюю через
 * RegistrationController, который сетка поставила посередине (он самый
 * связный). Правила раскладки при этом верны — неверна конкретная расстановка.
 *
 * Поэтому после сетки перебираются пары фигур: если обмен местами (x, y —
 * размеры остаются своими) уменьшает число грязных маршрутов и не создаёт
 * пересечений и выхода за лист, обмен принимается. Перебор детерминирован:
 * пары идут в порядке объявления, при равном счёте остаётся первый вариант.
 */
function improveRoutes(src, shapes) {
  const rels = showable(src);
  if (!rels.length) return shapes;
  const kindOf = new Map(src.elements.map((e) => [e.id, e.kind]));
  const boxes = () => new Map(shapes.map((s) => [s.element.id, boxOf({ x: s.x, y: s.y, w: s.w, h: s.h }, s.element)]));

  const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
    && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
  const inside = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

  /** Сколько связей идёт сквозь чужую фигуру. */
  const dirty = () => {
    const box = boxes();
    const list = [...box.entries()];
    let bad = 0;
    for (const r of rels) {
      const obstacles = list
        .filter(([id]) => id !== r.from && id !== r.to && !isContainer(kindOf.get(id)))
        .map(([, b]) => b);
      const route = routeLink(
        { shapeId: r.from, box: box.get(r.from) },
        { shapeId: r.to, box: box.get(r.to) },
        obstacles,
      );
      if (!route.clean) bad += 1;
    }
    return bad;
  };

  /**
   * Перестановка допустима, если выполняются три правила листа: фигуры не
   * наезжают друг на друга, зазор между соседями не меньше MIN_GAP и фигуры не
   * выходят за левый и верхний край. Вложенность разрешена только контейнеру
   * (пакет, узел, дорожка) — два класса один в другом стоять не могут, даже
   * если меньший целиком помещается в больший.
   *
   * Зазор проверяется отдельно от пересечения: фигуры разной ширины после
   * обмена местами могут встать вплотную, не пересекаясь.
   */
  const legal = () => {
    const box = boxes();
    const list = [...box.entries()];
    for (let i = 0; i < list.length; i += 1) {
      const [idA, a] = list[i];
      if (a.x < 0 || a.y < 0) return false;
      for (let k = i + 1; k < list.length; k += 1) {
        const [idB, b] = list[k];
        if (overlaps(a, b)) {
          const aHoldsB = isContainer(kindOf.get(idA)) && inside(a, b);
          const bHoldsA = isContainer(kindOf.get(idB)) && inside(b, a);
          if (!aHoldsB && !bHoldsA) return false;
          continue;
        }
        const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
        const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
        if (Math.max(gapX, gapY) < MIN_GAP) return false;
      }
    }
    return true;
  };

  let best = dirty();
  for (let pass = 0; pass < 4 && best > 0; pass += 1) {
    let changed = false;
    for (let i = 0; i < shapes.length && best > 0; i += 1) {
      for (let k = i + 1; k < shapes.length && best > 0; k += 1) {
        const a = shapes[i];
        const b = shapes[k];
        const ax = a.x;
        const ay = a.y;
        const bx = b.x;
        const by = b.y;
        a.x = bx;
        a.y = by;
        b.x = ax;
        b.y = ay;
        const after = legal() ? dirty() : best;
        if (after < best) { best = after; changed = true; } else { a.x = ax; a.y = ay; b.x = bx; b.y = by; }
      }
    }
    if (!changed) break;
  }
  return shapes;
}

/** Глубина обобщений: предок выше потомка. */
function generalDepth(src) {
  const depth = new Map(src.elements.map((e) => [e.id, 0]));
  const gens = src.relationships.filter((r) => r.kind === 'generalization' && r.from != null && r.to != null);
  for (let k = 0; k < src.elements.length; k += 1) {
    let changed = false;
    for (const r of gens) {
      const v = (depth.get(r.to) ?? 0) + 1;
      if ((depth.get(r.from) ?? 0) < v) { depth.set(r.from, v); changed = true; }
    }
    if (!changed) break;
  }
  return depth;
}

/**
 * Полоса вида фигуры на диаграмме размещения: сверху узлы и устройства,
 * снизу — развёрнутое на них.
 *
 * Узлы и устройства стоят в одной полосе намеренно: рисунок 5.1.6 ставит
 * «Компьютер студента» рядом с «Кампусным принтером», а «Коммутатор» — рядом с
 * «Сервером системы регистрации». Разнеси их по полосам — и путь
 * «Коммутатор — Сервер регистрации» пойдёт из нижней полосы в верхнюю через
 * чужой узел, а рисунок такого не показывает.
 */
const DEPLOYMENT_BAND = {
  executionEnvironment: 0, device: 0, node: 0, object: 0, component: 1, artifact: 2, deploymentSpec: 2,
};

function layoutClass(src) {
  const idx = indexOf(src);
  const depth = generalDepth(src);
  const order = [...src.elements].sort((a, b) => depth.get(a.id) - depth.get(b.id) || idx.get(a.id) - idx.get(b.id));
  return layoutGrid(src, order, { fill: 'centre', degreeOrder: true });
}

/**
 * Полосы по виду фигуры: каждая полоса — своя сетка, полосы стоят друг под
 * другом. Нужно размещению, где узел и развёрнутое на нём — разные полосы:
 * общая сетка перемешала бы их по рядам.
 */
function layoutBands(src, bandOf, rankOf = () => 0) {
  const idx = indexOf(src);
  const groups = new Map();
  for (const e of src.elements) {
    const b = bandOf(e);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(e);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const maxCols = Math.max(1, Math.ceil(Math.sqrt(src.elements.length)));
  const shapes = [];
  let y = 0;
  for (const k of keys) {
    const list = [...groups.get(k)].sort((a, b) => rankOf(a) - rankOf(b) || idx.get(a.id) - idx.get(b.id));
    const { placed } = gridPlace(list.map((e) => ({ element: e, ...sizeFor(e) })), {
      // Полоса заполняется от середины и по общему числу колонок листа, а не
      // от левого края по своему размеру: иначе полоса из двух фигур встаёт под
      // левым краем и вертикальная связь между полосами идёт сквозь соседа
      // (рис. 5.1.6 — путь «Коммутатор — Сервер системы регистрации» проходил
      // через «Компьютер работника учебного отдела»).
      gap: GAP, exactCols: maxCols, fill: 'centre',
    });
    const bandH = Math.max(...placed.map((p) => p.y + p.h));
    for (const p of placed) {
      shapes.push({ element: p.element, x: MARGIN + p.x, y: MARGIN + y + p.y, w: p.w, h: p.h });
    }
    y += bandH + GAP;
  }
  shapes.sort((a, b) => idx.get(a.element.id) - idx.get(b.element.id));
  return { shapes: improveRoutes(src, shapes), links: [] };
}

function layoutDeployment(src) {
  return layoutBands(src, (e) => DEPLOYMENT_BAND[e.kind] ?? 0);
}

/**
 * Составная структура: кооперации сверху, варианты использования снизу.
 *
 * Две полосы по виду фигуры; нижняя полоса упорядочена по партнёру из верхней,
 * чтобы связь реализации шла вниз, а не наискось через весь лист.
 */
function layoutComposite(src) {
  const idx = indexOf(src);
  const first = src.elements[0]?.kind;
  const top = src.elements.filter((e) => e.kind === first);
  const bottom = src.elements.filter((e) => e.kind !== first);
  if (!bottom.length) return layoutGrid(src, src.elements);
  const partner = new Map();
  for (const r of showable(src)) {
    if (top.some((e) => e.id === r.from) && bottom.some((e) => e.id === r.to)) partner.set(r.to, idx.get(r.from));
  }
  return layoutBands(src, (e) => (e.kind === first ? 0 : 1), (e) => partner.get(e.id) ?? Infinity);
}

/** Состояния — сверху вниз, порядок объявления. */
function layoutColumn(src) {
  let y = MARGIN;
  const shapes = src.elements.map((element) => {
    const { w, h } = sizeFor(element);
    const shape = { element, x: MARGIN, y: snap(y), w, h };
    y = shape.y + h + GAP;
    return shape;
  });
  return { shapes: improveRoutes(src, shapes), links: [] };
}

/** Деятельность: дорожки — колонки, узлы — по рангу потока сверху вниз. */
function layoutActivity(src) {
  const lanes = src.elements.filter((e) => e.kind === 'swimlane');
  const laneIdx = new Map(lanes.map((l, i) => [l.id, i]));
  const nodes = src.elements.filter((e) => e.kind !== 'swimlane');
  const flows = showable(src).filter((r) => r.kind === 'controlFlow' || r.kind === 'objectFlow');

  const preds = new Map(nodes.map((n) => [n.id, []]));
  const succs = new Map(nodes.map((n) => [n.id, []]));
  for (const f of flows) {
    if (!preds.has(f.to) || !succs.has(f.from)) continue;
    preds.get(f.to).push(f.from);
    succs.get(f.from).push(f.to);
  }

  // Дорожка узла: своя (`lane`), иначе — дорожка соседа по потоку.
  const laneOf = new Map();
  const resolve = (id, seen = new Set()) => {
    if (laneOf.has(id)) return laneOf.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = nodes.find((x) => x.id === id);
    if (n?.lane && laneIdx.has(n.lane)) { laneOf.set(id, laneIdx.get(n.lane)); return laneIdx.get(n.lane); }
    for (const p of preds.get(id) ?? []) {
      if (preds.get(p)?.length || succs.get(p)?.length) {
        const l = resolve(p, seen);
        laneOf.set(id, l);
        return l;
      }
    }
    for (const s of succs.get(id) ?? []) {
      if (preds.get(s)?.length || succs.get(s)?.length) {
        const l = resolve(s, seen);
        laneOf.set(id, l);
        return l;
      }
    }
    laneOf.set(id, 0);
    return 0;
  };
  nodes.forEach((n) => resolve(n.id));

  // Ранг узла — самый длинный путь по потоку; узел вне потока встаёт после всех.
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (let k = 0; k < nodes.length; k += 1) {
    let changed = false;
    for (const f of flows) {
      if (!rank.has(f.from) || !rank.has(f.to)) continue;
      const v = rank.get(f.from) + 1;
      if (rank.get(f.to) < v) { rank.set(f.to, v); changed = true; }
    }
    if (!changed) break;
  }
  const connected = nodes.filter((n) => preds.get(n.id).length || succs.get(n.id).length);
  const maxRank = connected.length ? Math.max(...connected.map((n) => rank.get(n.id))) : -1;
  let extra = 0;
  for (const n of nodes) {
    if (!preds.get(n.id).length && !succs.get(n.id).length) {
      rank.set(n.id, maxRank + 1 + extra);
      extra += 1;
    }
  }

  const sized = nodes.map((e) => ({ element: e, ...sizeFor(e), lane: laneOf.get(e.id), rank: rank.get(e.id) }));
  const laneCount = Math.max(1, lanes.length);
  const perLane = Array.from({ length: laneCount }, () => new Map());
  for (const it of sized) {
    const m = perLane[it.lane] ?? perLane[0];
    if (!m.has(it.rank)) m.set(it.rank, []);
    m.get(it.rank).push(it);
  }
  const ranks = [...new Set(sized.map((s) => s.rank))].sort((a, b) => a - b);
  const rowH = new Map();
  for (const it of sized) rowH.set(it.rank, Math.max(rowH.get(it.rank) ?? 0, it.h));

  const laneDefW = NOTATION.shapes.swimlane?.defaultSize.w ?? 420;
  const PAD = 30;
  const laneW = perLane.map((m) => {
    let w = 0;
    for (const list of m.values()) {
      const sum = list.reduce((a, b) => a + b.w, 0) + GAP * (list.length - 1);
      w = Math.max(w, sum);
    }
    return Math.max(lanes.length ? laneDefW : 0, ceilTo(w + 2 * PAD), 240);
  });

  const tabH = 28;
  const contentTop = MARGIN + tabH + 20;
  const rowY = new Map();
  let y = contentTop;
  for (const r of ranks) { rowY.set(r, y); y += rowH.get(r) + GAP; }
  const laneH = Math.max(NOTATION.shapes.swimlane?.defaultSize.h ?? 300, ceilTo((y - GAP) - MARGIN + PAD));

  const shapes = [];
  const laneBox = [];
  let laneX = MARGIN;
  for (let i = 0; i < laneCount; i += 1) {
    laneBox.push({ x: laneX, y: MARGIN, w: laneW[i], h: laneH });
    laneX += laneW[i];
  }
  lanes.forEach((element, i) => shapes.push({ element, ...laneBox[i] }));

  for (const it of sized) {
    const m = perLane[it.lane] ?? perLane[0];
    const list = m.get(it.rank);
    const rowW = list.reduce((a, b) => a + b.w, 0) + GAP * (list.length - 1);
    let x = laneBox[it.lane].x + (laneW[it.lane] - rowW) / 2;
    for (const other of list) {
      if (other === it) break;
      x += other.w + GAP;
    }
    shapes.push({
      element: it.element,
      x: snap(x),
      y: snap(rowY.get(it.rank) + (rowH.get(it.rank) - it.h) / 2),
      w: it.w,
      h: it.h,
    });
  }
  const order = indexOf(src);
  shapes.sort((a, b) => order.get(a.element.id) - order.get(b.element.id));
  return { shapes: improveRoutes(src, shapes), links: [] };
}

/** Варианты использования: актёры по сторонам рамки, варианты внутри неё. */
function layoutUsecase(src) {
  const idx = indexOf(src);
  const frameEl = src.elements.find((e) => e.kind === 'systemBoundary') ?? null;
  const usecases = src.elements.filter((e) => e.kind === 'usecase');
  const actors = src.elements.filter((e) => e.kind === 'actor');
  const rels = showable(src);

  const ucSized = usecases.map((e) => ({ element: e, ...sizeFor(e) }));
  const grid = gridPlace(ucSized, { gap: GAP, aspect: 4 / 3 });

  const PAD = 30;
  let frame = null;
  if (frameEl) {
    const def = NOTATION.shapes.systemBoundary?.defaultSize ?? { w: 320, h: 220 };
    const headH = layoutOf({ x: 0, y: 0, w: def.w, h: def.h }, frameEl).boxes[0]?.h ?? 36;
    frame = {
      element: frameEl,
      w: ceilTo(Math.max(def.w, grid.w + 2 * PAD)),
      h: ceilTo(Math.max(def.h, headH + grid.h + 2 * PAD)),
      headH,
    };
  }

  // Второстепенный актёр — участник ассоциации, у которой навигация «to»:
  // корпус читает `navigable: 'to'` как «второстепенное действующее лицо».
  const secondary = new Set();
  for (const r of rels) {
    if (r.kind !== 'association' || r.navigable !== 'to') continue;
    for (const end of [r.from, r.to]) {
      if (actors.some((a) => a.id === end)) secondary.add(end);
    }
  }
  let left = actors.filter((a) => !secondary.has(a.id));
  let right = actors.filter((a) => secondary.has(a.id));
  // Если связей нет вовсе, сторона ниоткуда не следует — делим список пополам.
  if (!rels.length && left.length > 1) {
    const half = Math.ceil(left.length / 2);
    right = left.slice(half);
    left = left.slice(0, half);
  }

  const actorSized = (list) => list.map((e) => {
    const size = sizeFor(e);
    const fp = footprintOf({ x: 0, y: 0, w: size.w, h: size.h }, e);
    return { element: e, w: size.w, h: size.h, fpW: fp.w };
  });
  const L = actorSized(left);
  const R = actorSized(right);
  const colW = (list) => (list.length ? Math.max(...list.map((a) => a.fpW)) : 0);

  const leftW = colW(L);
  const rightW = colW(R);
  const frameX = snap(MARGIN + (L.length ? leftW + GAP : 0));
  const frameY = MARGIN;
  const frameW = frame?.w ?? Math.max(320, grid.w + 2 * PAD);
  const frameH = frame?.h ?? Math.max(220, grid.h + 2 * PAD);

  // Порядок актёров — по среднему положению связанных вариантов: меньше пересечений.
  const ucPos = new Map();
  grid.placed.forEach((p) => ucPos.set(p.element.id, {
    cy: frameY + (frame?.headH ?? 36) + PAD + p.y + p.h / 2,
  }));
  const barycenter = (actor) => {
    const ys = rels.filter((r) => r.from === actor.id || r.to === actor.id)
      .map((r) => ucPos.get(r.from === actor.id ? r.to : r.from))
      .filter(Boolean).map((p) => p.cy);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : frameY + frameH / 2;
  };
  const placeColumn = (list, axisX) => {
    const sorted = [...list].sort((a, b) => barycenter(a.element) - barycenter(b.element)
      || idx.get(a.element.id) - idx.get(b.element.id));
    const pitch = 64 + GAP;
    const totalH = sorted.length * pitch - GAP;
    let startY = frameY + (frameH - totalH) / 2;
    if (startY < MARGIN) startY = MARGIN;
    return sorted.map((a, i) => ({
      element: a.element,
      x: snap(axisX - a.w / 2),
      y: snap(startY + i * pitch),
      w: a.w,
      h: a.h,
    }));
  };

  const shapes = [];
  if (frame) shapes.push({ element: frameEl, x: frameX, y: frameY, w: frameW, h: frameH });
  grid.placed.forEach((p) => shapes.push({
    element: p.element,
    x: snap(frameX + PAD + p.x),
    y: snap(frameY + (frame?.headH ?? 36) + PAD + p.y),
    w: p.w,
    h: p.h,
  }));
  // Ось колонки одна на всех: имена актёров шире фигур и должны стоять столбцом.
  shapes.push(...placeColumn(L, MARGIN + leftW / 2));
  if (R.length) shapes.push(...placeColumn(R, frameX + frameW + GAP + rightW / 2));
  shapes.sort((a, b) => idx.get(a.element.id) - idx.get(b.element.id));
  return { shapes: improveRoutes(src, shapes), links: [] };
}

/** Последовательность: линии жизни в ряд, сообщения сверху вниз, рамки — полосами. */
function layoutSequence(src) {
  const idx = indexOf(src);
  const lifelines = src.elements.filter((e) => isLifeline(e.kind));
  const frames = src.elements.filter((e) => isFrameKind(e.kind));
  const msgs = showable(src).filter((r) => isSequenceKind(r.kind));

  const sized = lifelines.map((e) => ({ element: e, ...sizeFor(e) }));
  const headW = sized.length ? Math.max(...sized.map((s) => s.w)) : 0;
  const pitch = headW + GAP;
  const heads = sized.map((s, i) => ({
    ...s,
    x: MARGIN + i * pitch,
    y: MARGIN,
    w: headW,
    headH: s.element.kind === 'actorLifeline' ? ACTOR_LIFELINE_HEAD : LIFELINE_HEAD,
  }));
  const maxHead = heads.length ? Math.max(...heads.map((h) => h.headH)) : LIFELINE_HEAD;
  const rowW = heads.length ? heads.length * pitch - GAP : 0;

  // Рамки — полосы поверх линий жизни, одна под другой, в порядке объявления.
  // Какую именно группу сообщений покрывает рамка, корпус не говорит
  // (`model.fragmentCoverage`), поэтому сообщения делятся между полосами
  // поровну, а сообщение ставится внутрь своей полосы — так оно никогда не
  // ложится на границу рамки.
  const FRAME_GAP = 40;
  const frameH = frames.length
    ? Math.max(...frames.map((f) => (f.kind === 'interactionUse' ? 80 : 90)))
    : 0;
  const msgTop = MARGIN + maxHead + 40;

  const perBand = Array.from({ length: frames.length }, () => []);
  if (frames.length) {
    msgs.forEach((_, i) => {
      const band = Math.min(frames.length - 1, Math.floor((i * frames.length) / Math.max(1, msgs.length)));
      perBand[band].push(i);
    });
  }
  const bandH = perBand.map((list) => Math.max(frameH, list.length * MESSAGE_GAP + 50));

  const frameTop = frames.length ? msgTop - 25 : msgTop;
  const frameBoxes = [];
  const msgY = [];
  let cursor = frameTop;
  for (let j = 0; j < frames.length; j += 1) {
    const element = frames[j];
    const top = snap(cursor);
    frameBoxes.push({
      element,
      x: heads.length ? heads[0].x : MARGIN,
      y: top,
      w: Math.max(NOTATION.shapes[element.kind]?.defaultSize.w ?? 320, rowW || 0),
      h: bandH[j],
    });
    // Первое сообщение полосы — ниже заголовка рамки (`fragmentCaption` = 18).
    perBand[j].forEach((i, k) => { msgY[i] = top + 30 + k * MESSAGE_GAP; });
    cursor = top + bandH[j] + FRAME_GAP;
  }
  if (!frames.length) msgs.forEach((_, i) => { msgY[i] = snap(msgTop + i * MESSAGE_GAP); });

  const framesBottom = frameBoxes.length ? frameBoxes[frameBoxes.length - 1].y + bandH[bandH.length - 1] : frameTop;
  const lastY = msgY.length ? msgY[msgY.length - 1] : 0;
  const tailEnd = Math.max(lastY + 40, framesBottom + 40, MARGIN + maxHead + 120);

  const shapes = heads.map((h) => ({
    element: h.element,
    x: snap(h.x),
    y: snap(h.y),
    w: h.w,
    h: Math.max(tailEnd - h.y, h.headH + 120),
  }));
  shapes.push(...frameBoxes);
  shapes.sort((a, b) => idx.get(a.element.id) - idx.get(b.element.id));

  // Сообщение живёт на вертикали: y задаёт порядок, концы — для стрелок.
  const byElement = new Map(shapes.map((s) => [s.element.id, s]));
  const links = msgs.map((r, i) => {
    const y = msgY[i];
    const a = byElement.get(r.from);
    const b = byElement.get(r.to);
    const t = (s) => round3(Math.min(0.95, Math.max(0.05, (y - s.y) / s.h)));
    if (a === b) {
      // Сообщение самому себе — петля справа от линии жизни.
      return {
        relId: r.id,
        y,
        from: { side: 'right', t: t(a) },
        to: { side: 'right', t: round3(Math.min(0.95, t(a) + 20 / a.h)) },
      };
    }
    const rightwards = b.x > a.x;
    return {
      relId: r.id,
      y,
      from: { side: rightwards ? 'right' : 'left', t: t(a) },
      to: { side: rightwards ? 'left' : 'right', t: t(b) },
    };
  });
  return { shapes, links };
}

const LAYOUTS = {
  class: layoutClass,
  package: (src) => layoutGrid(src, src.elements, { fill: 'centre', degreeOrder: true }),
  composite: layoutComposite,
  deployment: layoutDeployment,
  state: layoutColumn,
  activity: layoutActivity,
  usecase: layoutUsecase,
  sequence: layoutSequence,
};

/* ------------------------------------------------------------- модель */

/**
 * Собрать `uml-model/3`: элементы и связи корпуса плюс геометрия листа.
 * Заметка элемента (`note` корпуса) — это его документация: поле `note` формата
 * есть только у фигур-заметок, а `documentation` есть у любого элемента.
 */
function buildModel(figure, src, laid, report) {
  // Члены приводятся к канонической форме сразу: `serialize` пишет
  // `vis: "public"` только если строка пришла без него, а опускает — если он
  // есть. Без этой нормализации файл не читается обратно байт в байт.
  const elements = src.elements.map((e) => {
    const { note, ...rest } = e;
    const out = note ? { ...rest, documentation: note } : { ...rest };
    for (const field of ['attributes', 'operations', 'literals', 'slots']) {
      if (!Array.isArray(out[field])) continue;
      out[field] = out[field].map((r) => ({ ...r, vis: r.vis ?? 'public' }));
    }
    return out;
  });
  const relationships = showable(src);
  for (const r of src.relationships) {
    if (r.from == null || r.to == null) {
      report.unplaceable.push(`${figure}: ${r.id} (${r.kind}) ${r.from ?? '—'}→${r.to ?? '—'} — нет получателя`);
    }
  }

  const shapes = laid.shapes;
  const shapeId = new Map(shapes.map((s, i) => [s.element.id, `s${i + 1}`]));
  const outShapes = shapes.map((s, i) => ({ id: `s${i + 1}`, elementId: s.element.id, x: s.x, y: s.y, w: s.w, h: s.h }));
  const boxOfElement = new Map(shapes.map((s) => [s.element.id, boxOf({ x: s.x, y: s.y, w: s.w, h: s.h }, s.element)]));
  const kindOf = new Map(src.elements.map((e) => [e.id, e.kind]));
  const obstaclesFor = (fromId, toId) => [...boxOfElement.entries()]
    .filter(([id]) => id !== fromId && id !== toId && !isContainer(kindOf.get(id)))
    .map(([, box]) => box);

  const preset = new Map(laid.links.map((l) => [l.relId, l]));
  const links = [];
  for (const r of relationships) {
    const from = shapeId.get(r.from);
    const to = shapeId.get(r.to);
    if (!from || !to) continue;
    const fixed = preset.get(r.id);
    if (fixed) {
      links.push({ id: `l${links.length + 1}`, relId: r.id, y: fixed.y, from: { shapeId: from, ...fixed.from }, to: { shapeId: to, ...fixed.to } });
      continue;
    }
    const route = routeLink(
      { shapeId: from, box: boxOfElement.get(r.from) },
      { shapeId: to, box: boxOfElement.get(r.to) },
      obstaclesFor(r.from, r.to),
    );
    if (!route.clean) report.dirty.push(`${figure}: ${r.id} (${r.kind}) ${r.from}→${r.to}`);
    links.push({ id: `l${links.length + 1}`, relId: r.id, from: route.from, to: route.to });
  }

  let right = 0;
  let bottom = 0;
  for (const box of boxOfElement.values()) {
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  const sheet = {
    w: Math.max(MIN_SHEET.w, ceilTo(right + MARGIN)),
    h: Math.max(MIN_SHEET.h, ceilTo(bottom + MARGIN)),
  };

  const model = {
    schema: 'uml-model/3',
    id: `m-corpus-${figure}`,
    name: src.source.altText || `Рис. ${src.source.figureNo}`,
    elements,
    relationships,
    generalizationSets: src.generalizationSets ?? [],
    diagrams: [{
      id: 'd1',
      name: src.diagrams?.[0]?.name ?? 'Main',
      kind: src.source.type,
      shapes: outShapes,
      links,
    }],
    currentDiagramId: 'd1',
    // Связь без получателя форматом не выражается (`model.lostMessage`):
    // перечисляем её явно, чтобы она не пропала молча.
    unrepresented: src.relationships
      .filter((r) => r.from == null || r.to == null)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        from: r.from ?? null,
        to: r.to ?? null,
        name: r.name ?? '',
        why: 'нет получателя: конец связи не указывает на элемент, а uml-model/3 требует оба конца',
      })),
    source: src.source,
    expect: src.expect,
    sheet,
  };
  return model;
}

export { buildModel, LAYOUTS };

/* --------------------------------------------------------------- CLI */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `--force` — единственный способ перезаписать лист, который разошёлся с
  // генератором. Причина: 26 листов из 48 расходятся с тем, что даёт текущий
  // генератор (вложенность компонентов 5106 на узлах, развод подписей двух
  // связей одной пары 5301, зазоры 5208/5223), и прогон без флага их не трогает.
  // Иначе один прогон молча стирает правку, а `check.mjs` этого не замечает:
  // лист всё ещё валиден, просто другой.
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.filter((a) => !a.startsWith('--'));
  const report = { unplaceable: [], dirty: [] };
  const files = corpusFiles().filter((f) => !only.length || only.includes(f.replace(/\.json$/, '')));
  const kept = [];
  for (const file of files) {
    const figure = file.replace(/\.json$/, '');
    const src = readCorpus(figure);
    const layout = LAYOUTS[src.source.type];
    if (!layout) throw new Error(`${figure}: неизвестный тип «${src.source.type}»`);
    const model = buildModel(figure, src, layout(src), report);
    const target = path.join(OUT, `${figure}.uml.json`);
    const next = serialize(model);
    if (!force && fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== next) {
      kept.push(figure);
      continue;
    }
    fs.writeFileSync(target, next);
  }
  if (kept.length) {
    console.log(`листов с ручной правкой не тронуто: ${kept.length} (${kept.join(', ')})`);
    console.log('  перезаписать: node material/corpus-layout/build.mjs --force');
  }
  if (report.unplaceable.length) {
    console.log(`связей без получателя: ${report.unplaceable.length}`);
    for (const line of report.unplaceable) console.log(`  ${line}`);
  }
  if (report.dirty.length) {
    console.log(`связей без чистого маршрута: ${report.dirty.length}`);
    for (const line of report.dirty) console.log(`  ${line}`);
  }
  console.log(`листов записано: ${files.length - kept.length} из ${files.length}`);
}
