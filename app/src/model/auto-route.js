// Перепривязка связей после автоматической раскладки.
//
// Раскладка (layout.js) двигает фигуры, но связь помнит СТОРОНУ и долю на
// ней: после переезда `from.side: 'left'` может смотреть в пустоту, а
// `waypoints` остались в старой системе координат. Этот модуль отвечает
// ровно за две вещи:
//
//   1. выбрать пару сторон, обращённых друг к другу, и долю на стороне —
//      проекцию центра чужой рамки, зажатую в [0.12, 0.88] (поэтому линия
//      не липнет к углу и не срезает скругление);
//   2. если дефолтная ломаная режет чужую рамку — проложить обход тем же
//      ортогональным маршрутизатором, что и рендерер Archify
//      (`route-quality.mjs`), и записать его изломы в `waypoints`.
//
// Одна поправка к «score = длина», и она вынужденная. «Чистый» кандидат — это
// ломаная, которая не режет РАМОК; о чужих линиях она не знает. На настоящем
// листе (material/demo-errors.json) из-за этого восемь связей уходили одним и
// тем же коридором вдоль края колонки и рисовались ОДНОЙ чертой: 52 наложения,
// худшее — 1023 px подряд. Поэтому кандидат, ложащийся на уже принятую линию,
// тоже считается негодным и отдаётся маршрутизатору (`avoidedSegments`), а
// если тот не справился — остаётся запасным вариантом `loose`: линия поверх
// линии хуже, чем линия через рамку, только если развести нечем. После этой
// поправки на той же модели остаётся 2 наложения по 20 px.
//
// Модуль чистый: ни DOM, ни store, ни таймеров. `autoRouteLinks` ничего не
// меняет — она возвращает маршруты, и только `applyAutoRoutes` пишет их в
// связи. Пишутся ровно три поля модели — `side`, `t`, `waypoints`: формат
// файла (побайтовый эталон old-v3.json) шире не становится.
//
// Чего здесь СОЗНАТЕЛЬНО нет:
//   * связей, маршрут которых не наш (`noEdgeStyle`) и концов с авторской
//     долей+смещением (`.attach`) — их перепривязка была бы подменой чужого
//     решения своим;
//   * «оживления» самосвязей и связей с концом вне листа;
//   * разведения двух связей между одной парой фигур по разным местам кромки
//     (этим занят parallel-links.js при рисовании, здесь — одна доля на пару).

import { elementOf } from './model.js';
import { layoutOf, edgePoint, routePoints, linkPoints } from './geometry.js';
import { routeOfLink } from './connector-style.js';
import { shortestOrthogonalGridRoute } from '../vendor/archify/renderers/shared/route-quality.mjs';
import { segmentIntersectsRect } from '../vendor/archify/renderers/shared/geometry.mjs';

/** Стороны в фиксированном порядке: он же порядок перебора пар. */
export const SIDES = ['top', 'right', 'bottom', 'left'];

/** Доля на стороне не подходит ближе к углу, чем это: там скругление. */
const T_MIN = 0.12;
const T_MAX = 0.88;
/** Зазор обхода: линия не идёт по самой кромке чужой рамки. */
const CLEARANCE = 6;
/**
 * Допуск «линия идёт по кромке». Ровная линия вдоль рамки — это удвоенная
 * граница, а не обход, и пропускать её нельзя. Строгое пересечение её не
 * ловит, поэтому рамка для проверки расширяется на полпикселя.
 */
const EDGE_PAD = 0.5;
/** Цена одного излома в score: лишний крюк должен быть заметно короче. */
const BEND_PENALTY = 48;
/** Порог «число не изменилось» при записи. */
const EPS = 1e-6;
/** Предел отрезков, которые маршрутизатор считает занятыми. */
const MAX_AVOIDED = 240;
/** Короче этого наложение двух линий не считается «одной чертой». */
const MIN_SEPARATION = 8;

/* --------------------------------------------------------------- рамки */

/** Рамка из `{x, y, w, h}` или `{x, y, width, height}` — обе формы в ходу. */
function box4(box) {
  const width = Number(box?.width ?? box?.w) || 0;
  const height = Number(box?.height ?? box?.h) || 0;
  return { x: Number(box?.x) || 0, y: Number(box?.y) || 0, width, height };
}

const centerOf = (box) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** Чужая рамка целиком накрывает эту — значит, это её контейнер, не стена. */
const covers = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
  && outer.x + outer.width >= inner.x + inner.width
  && outer.y + outer.height >= inner.y + inner.height;

/* -------------------------------------------------------------- стороны */

/**
 * Пары сторон «откуда → куда» для двух рамок, в порядке предпочтения.
 *
 * Сначала пара по доминирующей оси (|dx| ≥ |dy| — горизонталь, иначе
 * вертикаль): именно она даёт самую короткую и самую ожидаемую линию. Затем
 * пара по второй оси — короткий уголок, когда фигуры стоят по диагонали.
 * Затем остальные 14 сочетаний в фиксированном порядке SIDES×SIDES: они нужны
 * только чтобы обойти препятствие, и порядок у них один и тот же на любой
 * машине — от него зависит выбор при равном score.
 */
export function facingPairs(fromBox, toBox) {
  const a = box4(fromBox);
  const b = box4(toBox);
  const dx = centerOf(b).x - centerOf(a).x;
  const dy = centerOf(b).y - centerOf(a).y;
  const out = [];
  const push = (from, to) => {
    if (out.some(([f, t]) => f === from && t === to)) return;
    out.push([from, to]);
  };
  const horizontal = dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  const vertical = dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  if (Math.abs(dx) >= Math.abs(dy)) {
    push(horizontal[0], horizontal[1]);
    push(vertical[0], vertical[1]);
  } else {
    push(vertical[0], vertical[1]);
    push(horizontal[0], horizontal[1]);
  }
  for (const from of SIDES) for (const to of SIDES) push(from, to);
  return out;
}

/**
 * Доля на стороне `side` фигуры: проекция точки `toward` (центра чужой
 * рамки) на эту сторону, зажатая в [T_MIN, T_MAX].
 *
 * Проекция, а не середина: линия приходит в ту часть кромки, что смотрит на
 * собеседника, и две связи из разных мест не сливаются в одну.
 */
function shareOn(shape, layout, side, toward) {
  const vertical = side === 'left' || side === 'right';
  const size = vertical ? layout.h : layout.w;
  const origin = vertical ? shape.y : shape.x;
  const at = vertical ? toward.y : toward.x;
  const raw = size > 0 ? (at - origin) / size : 0.5;
  const t = Number.isFinite(raw) ? raw : 0.5;
  return Math.min(T_MAX, Math.max(T_MIN, t));
}

/* ------------------------------------------------------------ геометрия */

/** Длина ломаной — score «чистого» кандидата. */
function polylineLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.abs(points[i][0] - points[i - 1][0]) + Math.abs(points[i][1] - points[i - 1][1]);
  }
  return sum;
}

/** Манхэттенское расстояние: нижняя граница любой ортогональной ломаной. */
const manhattan = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);

/**
 * Наложение двух отрезков друг на друга (0, если они не на одной прямой).
 *
 * Зачем это здесь: `avoidedSegments` у маршрутизатора заведены ровно затем,
 * чтобы вторая линия не легла на первую. Но «чистый» кандидат — это ломаная,
 * которая не режет РАМОК; о чужих линиях она ничего не знает. На настоящем
 * листе из-за этого восемь связей уходили одним и тем же коридором вдоль
 * правого края колонки и рисовались одной чертой (замер: 39 наложений до
 * 1023 px). Поэтому занятость считается и для дефолтных ломаных.
 */
function collinearOverlap(a1, a2, b1, b2) {
  if (a1[0] === a2[0] && b1[0] === b2[0] && a1[0] === b1[0]) {
    return Math.max(0, Math.min(Math.max(a1[1], a2[1]), Math.max(b1[1], b2[1]))
      - Math.max(Math.min(a1[1], a2[1]), Math.min(b1[1], b2[1])));
  }
  if (a1[1] === a2[1] && b1[1] === b2[1] && a1[1] === b1[1]) {
    return Math.max(0, Math.min(Math.max(a1[0], a2[0]), Math.max(b1[0], b2[0]))
      - Math.max(Math.min(a1[0], a2[0]), Math.min(b1[0], b2[0])));
  }
  return 0;
}

/** Ломаная ложится на уже принятую линию? */
function overlapsAccepted(points, avoided) {
  if (!avoided.length) return false;
  for (let i = 1; i < points.length; i += 1) {
    for (const segment of avoided) {
      if (collinearOverlap(points[i - 1], points[i], segment.start, segment.end) >= MIN_SEPARATION) {
        return true;
      }
    }
  }
  return false;
}

/** Ломаная задевает хоть одну рамку? Рамки — `{x, y, width, height}`. */
function hitsAny(points, obstacles) {
  if (!obstacles.length) return false;
  for (let i = 1; i < points.length; i += 1) {
    const segment = { start: points[i - 1], end: points[i] };
    // Отрезок нулевой длины (совпавшие точки) ничего не режет.
    if (segment.start[0] === segment.end[0] && segment.start[1] === segment.end[1]) continue;
    for (const rect of obstacles) {
      if (segmentIntersectsRect(segment, rect, EDGE_PAD)) return true;
    }
  }
  return false;
}

/**
 * Рамки, которые связи этого листа обязаны обходить.
 *
 * Кроме двух концов вычитаются контейнеры: рамка, целиком накрывающая рамку
 * конца, — это его родитель, и линия обязана иметь право выйти наружу.
 */
function obstaclesFor(layouts, shapes, fromId, toId) {
  const fromRect = layouts.get(fromId).rect;
  const toRect = layouts.get(toId).rect;
  const out = [];
  for (const s of shapes) {
    if (s.id === fromId || s.id === toId) continue;
    const rect = layouts.get(s.id).rect;
    if (covers(rect, fromRect) || covers(rect, toRect)) continue;
    out.push(rect);
  }
  return out;
}

/* ---------------------------------------------------------- маршрутизатор */

/**
 * Обход препятствий для пары сторон. `null` — маршрутизатор не нашёл чистого
 * пути (или нашёл, но он всё равно режет рамку): кандидат отбрасывается, и
 * вызывающий попробует другую пару. Выдумывать обход нельзя — лучше честный
 * прямой отрезок.
 */
function detour({ start, end, fromSide, toSide, obstacles, route, avoided }) {
  // Маршрутизатор работает с точками вида [x, y] и НЕ понимает объекты
  // {x, y}: `moveOutward` читает `point[0]`, и объект дал бы NaN.
  const a = [start.x, start.y];
  const b = [end.x, end.y];
  const searched = shortestOrthogonalGridRoute({
    start: a,
    end: b,
    points: [a, b],
    obstacles,
    fromSide,
    toSide,
    clearance: CLEARANCE,
    maximumObstacleCount: 80,
    endpointStubPx: 20,
    maximumGridNodes: 4096,
    avoidedSegments: avoided,
    allowAvoidedCrossings: true,
    minimumSegmentPx: 8,
    bendPenaltyPx: BEND_PENALTY,
  });
  if (!searched || !Array.isArray(searched.points)) return null;
  const points = searched.points;
  // Маршрутизатор мог выйти за пределы своей же карты: путь, который всё
  // равно режет рамку, — не решение.
  if (hitsAny(points, obstacles)) return null;
  const waypoints = points.slice(1, -1);
  if (!waypoints.length) {
    // Путь без изломов — это и есть дефолтная ломаная; кандидат не нужен.
    return null;
  }
  const drawn = linkPoints(start, end, route, waypoints);
  if (drawn.length < 2 || hitsAny(drawn, obstacles)) return null;
  return { waypoints, length: polylineLength(points) };
}

/* ------------------------------------------------------- публичный вход */

/**
 * Маршруты для связей, задетых раскладкой. Ничего не меняет.
 *
 *   autoRouteLinks(model, diagram, { shapeIds })
 *
 * `shapeIds` — набор фигур раскладки (уже замкнутый по вложенности), `null` —
 * все связи листа. Связь попадает в работу, если хотя бы один её конец в
 * наборе: ровно тот же набор, у которого `planLayout` удаляет ручные точки, —
 * иначе диалог обещал бы одно, а линии менялись бы другие.
 *
 * `diagram` может быть КОПИЕЙ листа с планируемыми координатами: функция
 * читает только `shapes`/`links`, поэтому `planLayout` считает маршруты для
 * геометрии после переезда, ещё не двигая модель.
 *
 * Возвращает `{ routes, stats }`, где routes — `[{ id, from, to, waypoints,
 * routed }]` в порядке связей листа (порядок важен: он же порядок обхода
 * занятых отрезков, а значит и детерминизм).
 */
export function autoRouteLinks(model, diagram, { shapeIds = null } = {}) {
  const routes = [];
  const stats = { links: 0, reattached: 0, rerouted: 0 };
  const d = diagram;
  if (!d) return { routes, stats };

  const shapes = d.shapes ?? [];
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const set = Array.isArray(shapeIds) ? new Set(shapeIds) : null;

  // Размеры считаются один раз: `layoutOf` — не бесплатная функция, а
  // вызывается она на каждую пару сторон каждого кандидата.
  const layouts = new Map();
  for (const s of shapes) {
    const layout = layoutOf(s, elementOf(model, s));
    layouts.set(s.id, {
      layout,
      rect: { x: s.x, y: s.y, width: layout.w, height: layout.h },
    });
  }

  // Занятые отрезки уже принятых маршрутов: вторая линия не должна лечь на
  // первую. Порядок — порядок массива связей, он же порядок в файле.
  const avoided = [];

  for (const l of d.links ?? []) {
    const fromId = l?.from?.shapeId;
    const toId = l?.to?.shapeId;
    if (!fromId || !toId || fromId === toId) continue;
    if (set && !set.has(fromId) && !set.has(toId)) continue;
    // Маршрут не наш: `noEdgeStyle` — прямая через авторские точки.
    if (l.noEdgeStyle === true) continue;
    // Концы с авторской долей+смещением не трогаем: это решение человека в
    // долях рамки, и сторона у него не хранится вовсе.
    if (l.from?.attach || l.to?.attach) continue;
    // Сообщение на диаграмме последовательности живёт осью времени (`y`), а
    // не стороной фигуры; раскладка такие листы и так отказывается брать.
    if (Number.isFinite(l.y)) continue;
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) continue;

    stats.links += 1;
    const lf = layouts.get(fromId);
    const lt = layouts.get(toId);
    const options = obstaclesFor(layouts, shapes, fromId, toId);
    const route = routeOfLink(l);

    let best = null;   // чистая ломаная, не ложащаяся на чужую линию
    let loose = null;  // чистая по рамкам, но на чужой линии — только если строгого нет
    for (const [fromSide, toSide] of facingPairs(lf.rect, lt.rect)) {
      const tFrom = shareOn(from, lf.layout, fromSide, centerOf(lt.rect));
      const tTo = shareOn(to, lt.layout, toSide, centerOf(lf.rect));
      const p1 = edgePoint(from, lf.layout, fromSide, tFrom);
      const p2 = edgePoint(to, lt.layout, toSide, tTo);
      // Нижняя граница любого обхода — манхэттенское расстояние между
      // концами. Если лучший найденный score уже не больше — эта пара и её
      // обход проиграют заведомо, и маршрутизатор можно не звать.
      if (best && best.score <= manhattan([p1.x, p1.y], [p2.x, p2.y])) continue;

      const straight = routePoints(p1, p2, route);
      if (!hitsAny(straight, options)) {
        const score = polylineLength(straight);
        if (!overlapsAccepted(straight, avoided)) {
          if (!best || score < best.score - EPS) {
            best = {
              score,
              from: { side: fromSide, t: tFrom },
              to: { side: toSide, t: tTo },
              waypoints: null,
              routed: false,
              drawn: straight,
            };
          }
          continue;
        }
        // По рамкам чисто, но ложится на уже принятую линию. Такой кандидат
        // не выбрасывается (пусть будет, если развести нечем), но сначала
        // маршрутизатор попробует отвести его в сторону.
        if (!loose || score < loose.score - EPS) {
          loose = {
            score,
            from: { side: fromSide, t: tFrom },
            to: { side: toSide, t: tTo },
            waypoints: null,
            routed: false,
            drawn: straight,
          };
        }
      }
      if (best && best.score <= manhattan([p1.x, p1.y], [p2.x, p2.y])) continue;
      const found = detour({ start: p1, end: p2, fromSide, toSide, obstacles: options, route, avoided });
      if (!found) continue;
      const score = found.length + BEND_PENALTY * found.waypoints.length;
      if (!best || score < best.score - EPS) {
        best = {
          score,
          from: { side: fromSide, t: tFrom },
          to: { side: toSide, t: tTo },
          waypoints: found.waypoints,
          routed: true,
          drawn: [[p1.x, p1.y], ...found.waypoints, [p2.x, p2.y]],
        };
      }
    }
    // Строгий кандидат важнее короткого: линия поверх другой линии читается
    // как одна связь. `loose` — честный откат, когда развести нечем.
    if (!best) best = loose;

    // Ни одна пара не дала чистого пути — честный откат: основная (facing)
    // пара без изгибов. Это может дать линию через рамку, но это правда о
    // геометрии, а не выдуманный крюк.
    if (!best) {
      const [fromSide, toSide] = facingPairs(lf.rect, lt.rect)[0];
      best = {
        score: 0,
        from: { side: fromSide, t: shareOn(from, lf.layout, fromSide, centerOf(lt.rect)) },
        to: { side: toSide, t: shareOn(to, lt.layout, toSide, centerOf(lf.rect)) },
        waypoints: null,
        routed: false,
        drawn: null,
      };
    }

    for (let i = 1; best.drawn && i < best.drawn.length; i += 1) {
      if (avoided.length >= MAX_AVOIDED) break;
      avoided.push({
        start: [best.drawn[i - 1][0], best.drawn[i - 1][1]],
        end: [best.drawn[i][0], best.drawn[i][1]],
      });
    }

    const moved = !sameEnd(l.from, best.from) || !sameEnd(l.to, best.to);
    if (moved) stats.reattached += 1;
    if (best.waypoints) stats.rerouted += 1;
    routes.push({
      id: l.id,
      from: best.from,
      to: best.to,
      waypoints: best.waypoints,
      routed: best.routed,
    });
  }

  return { routes, stats };
}

/* ---------------------------------------------------------------- запись */

const round3 = (v) => Math.round(v * 1000) / 1000;
const round1 = (v) => Math.round(v * 10) / 10;

function sameEnd(current, next) {
  if (!current) return false;
  if (current.side !== next.side) return false;
  // Сравнение по ТОЙ ЖЕ точности, с какой значение пишется: иначе план назвал
  // бы «переприкреплено» связь, у которой запись ничего не изменила.
  return Math.abs((Number(current.t ?? 0.5)) - round3(next.t)) <= EPS;
}

/**
 * Записать маршруты в связи листа. Единственная мутирующая функция модуля.
 *
 * Пишутся только `from.side`, `from.t`, `to.side`, `to.t` и `waypoints`;
 * ничего другого модель не получает. `side`/`t` меняются, только если
 * действительно отличаются (иначе лишний проход оставил бы в файле
 * переокруглённые числа), `t` округляется до 3 знаков, точки — до 0.1:
 * больше точности у размера листа нет смысла, а побайтовый эталон требует
 * стабильного текста.
 */
export function applyAutoRoutes(diagram, routes) {
  const byId = new Map((diagram?.links ?? []).map((l) => [l.id, l]));
  let reattached = 0;
  let rerouted = 0;
  for (const r of routes ?? []) {
    const l = byId.get(r.id);
    if (!l || !r.from || !r.to) continue;
    let changed = false;
    changed = writeEnd(l, 'from', r.from) || changed;
    changed = writeEnd(l, 'to', r.to) || changed;
    if (changed) reattached += 1;

    const wp = Array.isArray(r.waypoints) && r.waypoints.length
      ? r.waypoints.map((p) => [round1(p[0]), round1(p[1])])
      : null;
    if (wp) {
      const same = Array.isArray(l.waypoints) && l.waypoints.length === wp.length
        && l.waypoints.every((p, i) => Array.isArray(p)
          && Math.abs(Number(p[0]) - wp[i][0]) <= EPS
          && Math.abs(Number(p[1]) - wp[i][1]) <= EPS);
      if (!same) { l.waypoints = wp; rerouted += 1; }
    } else if (l.waypoints) {
      // Точек нет и быть не должно: пустой массив формату не нужен.
      delete l.waypoints;
    }
  }
  return { reattached, rerouted };
}

function writeEnd(link, key, end) {
  // Конца нет вовсе (битая связь): создать — это изменение, а не «уже так».
  if (!link[key]) {
    link[key] = { side: end.side, t: round3(end.t) };
    return true;
  }
  const current = link[key];
  const t = round3(end.t);
  const changed = current.side !== end.side || Math.abs((Number(current.t ?? 0.5)) - t) > EPS;
  if (!changed) return false;
  current.side = end.side;
  current.t = t;
  return true;
}