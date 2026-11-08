// Проверка раскладки корпуса. Читает `material/corpus-layout/<номер>.uml.json`,
// сверяет его с `tests/corpus/<номер>.json` и считает геометрию теми же
// функциями, которыми рисует редактор (`app/src/model/geometry.js`).
//
// Что проверяется (постановка, §2):
//   1. схема: `deserialize` проходит без замечаний, `serialize` даёт байт в байт;
//   2. состав: все элементы и связи корпуса на месте по `id` — ничего не
//      потеряно, ничего не выдумано;
//   3. геометрия: фигуры внутри листа, не пересекаются, связь не проходит сквозь
//      чужую фигуру;
//   4. связи: оба конца указывают на существующие фигуры.
//
// Сверх постановки проверяется «серия»: координаты кратны шагу сетки, зазор
// между соседями не меньше 40 px, лист равен содержимому плюс поля, а рамки
// последовательности не накрывают шапки линий жизни.
//
// Запуск: node material/corpus-layout/check.mjs [номера…]
// Код выхода 0 — только если замечаний нет.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyPackage, NOTATION } from '../../app/src/model/notation.js';
import {
  layoutOf, edgePoint, endPoint, routePoints, linkPoints, labelPos, multiPos, textWidth, LINE_H,
  LIFELINE_HEAD, ACTOR_LIFELINE_HEAD,
} from '../../app/src/model/geometry.js';
import { routeOfLink } from '../../app/src/model/connector-style.js';
import { parallelOffsets, parallelEnds } from '../../app/src/model/parallel-links.js';
import { MECHANICS } from '../../app/src/mechanics.generated.js';
import { deserialize, serialize } from '../../app/src/io/umljson.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'tests/corpus');
const LAYOUT = HERE;

const GRID = 10;
const MARGIN = 60;
const MIN_GAP = 40;
const EPS = 1;

applyPackage(JSON.parse(fs.readFileSync(path.join(ROOT, 'app/notation/uml.json'), 'utf8')));

/** Виды, которые держат содержимое: связь входит в них и выходит из них. */
const CONTAINER_STYLES = new Set(['boundary', 'swimlane', 'activity', 'frame', 'package', 'node']);
const isContainer = (kind) => CONTAINER_STYLES.has(NOTATION.shapes[kind]?.style);
const isFrame = (kind) => NOTATION.shapes[kind]?.style === 'frame';

/* ------------------------------------------------------------- геометрия */

const inside = (p, box) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

/** Пересечение внутренностей: касание сторон пересечением не считается. */
function overlaps(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0;
}

/** Отрезок внутри прямоугольника: интервал параметра [t0,t1] или null. */
function segInside(p, q, box) {
  const x0 = box.x + EPS;
  const x1 = box.x + box.w - EPS;
  const y0 = box.y + EPS;
  const y1 = box.y + box.h - EPS;
  if (x0 >= x1 || y0 >= y1) return null;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  for (const [pDen, qNum] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]]) {
    if (Math.abs(pDen) < 1e-12) {
      if (qNum < 0) return null;
      continue;
    }
    const t = qNum / pDen;
    if (pDen < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** Сколько отдельных отрезков пути лежит внутри фигуры. */
function passages(pts, box) {
  const spans = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const hit = segInside(pts[i], pts[i + 1], box);
    if (!hit) continue;
    const [a, b] = hit;
    const prev = spans[spans.length - 1];
    if (prev && prev.seg === i - 1 && prev.b > 1 - 1e-9 && a < 1e-9) {
      prev.seg = i;
      prev.b = b;
    } else {
      spans.push({ seg: i, a, b });
    }
  }
  return spans.length;
}

const edgePointOf = (box, end) => edgePoint(
  { x: box.x, y: box.y, w: box.w, h: box.h }, box, end.side, end.t ?? 0.5,
);

/**
 * Конец связи так, как его ставит редактор: `attach` (доля + смещение) главнее
 * стороны и доли. Раньше здесь был только `edgePoint`, и связь с `attach`
 * проверялась не там, где рисуется.
 */
const endPointOf = (box, end) => endPoint(
  { x: box.x, y: box.y, w: box.w, h: box.h }, box, end, false,
);

/** Ломаная связи — как в render.js: сообщение горизонтально, прочее по сторонам. */
function linkPath(link, a, b, kind, ends = null) {
  if (NOTATION.connectors[kind]?.sequence) {
    const y = link.y;
    if (link.from.shapeId === link.to.shapeId) {
      const x = a.x + a.w;
      return [[x, y], [x + 40, y], [x + 40, y + 20], [x, y + 20]];
    }
    return [[a.x + a.w / 2, y], [b.x + b.w / 2, y]];
  }
  return linkPoints(
    endPointOf(a, ends?.from ?? link.from),
    endPointOf(b, ends?.to ?? link.to),
    routeOfLink(link), link.waypoints, link.noEdgeStyle === true,
  );
}

/* --------------------------------------------------------------- состав */

const member = (r) => ({
  vis: r.vis ?? 'public',
  name: r.name ?? '',
  type: r.type ?? '',
  default: r.default ?? '',
  isStatic: r.isStatic === true,
  isDerived: r.isDerived === true,
  isID: r.isID === true,
});
const members = (list) => (Array.isArray(list) ? list.map(member) : []);
const j = (v) => JSON.stringify(v);

/** Различия двух JSON по путям: { path, from, to }. */
function deepDiff(a, b, path = '', out = []) {
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(a) || !isObj(b)) {
    if (j(a) !== j(b)) out.push({ path, from: a, to: b });
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = Array.isArray(a) ? `${path}[${k}]` : (path ? `${path}.${k}` : k);
    deepDiff(a[k], b[k], p, out);
  }
  return out;
}

/**
 * Элемент корпуса против элемента листа. Единственное разрешённое
 * переименование: `note` корпуса — пояснение к элементу — становится его
 * `documentation` (поле `note` формата есть только у фигур-заметок).
 */
function compareElement(src, got) {
  const bad = [];
  if (!got) return ['элемента нет на листе'];
  for (const [k, v] of Object.entries(src)) {
    if (k === 'note') {
      if (got.documentation !== v) bad.push(`note: «${v}» → documentation «${got.documentation ?? ''}»`);
      continue;
    }
    if (['attributes', 'operations', 'literals', 'slots'].includes(k)) {
      if (j(members(v)) !== j(members(got[k]))) bad.push(`${k}: ${j(v)} → ${j(got[k])}`);
      continue;
    }
    if (k === 'abstract') {
      if ((v === true) !== (got.abstract === true)) bad.push(`abstract: ${v} → ${got.abstract}`);
      continue;
    }
    const gv = got[k];
    const norm = (x) => (x === null || x === undefined || x === '' ? null : x);
    if (j(norm(v)) !== j(norm(gv))) bad.push(`${k}: ${j(v)} → ${j(gv)}`);
  }
  return bad;
}

function compareRelationship(src, got) {
  const bad = [];
  if (!got) return ['связи нет на листе'];
  const norm = (x) => (x === null || x === undefined || x === '' ? null : x);
  for (const [k, v] of Object.entries(src)) {
    const gv = got[k];
    if (j(norm(v)) === j(norm(gv))) continue;
    // Известный дефект формата: `deserialize` подставляет кратность «1» на
    // источник, если её нет в файле, а `serialize` пустую не пишет. Семантика
    // корпуса («кратность не показана») в файле сохраняется, но чтение её
    // теряет — это правится в app/src/io/umljson.js, не здесь.
    if (k === 'fromMultiplicity' && norm(v) === null && gv === '1') continue;
    bad.push(`${k}: ${j(v)} → ${j(gv)}`);
  }
  return bad;
}

/* ------------------------------------------------------- аудит (--audit) */
//
// Проверки ниже отвечают на вопросы, которых нет в постановке §2, но которые
// всплыли при независимом аудите корпуса: совпадают ли две связи на листе,
// читается ли подпись связи, стоит ли контрольный узел один, есть ли у
// композитного состояния содержимое и лежат ли компоненты внутри узлов.
//
// Они выключены в обычном прогоне намеренно: на сегодняшнем корпусе они дают
// замечания — это и есть их смысл, — а обычный прогон должен оставаться
// сигналом «серия не поехала», а не списком известных дефектов. Включаются
// флагом `--audit`.

/** Контрольные узлы: имени у них нет, а фигура без единого ребра — ошибка. */
const CONTROL_NODES = new Set([
  'initial', 'final', 'choice', 'junction', 'historyShallow', 'historyDeep',
  'entryPoint', 'exitPoint', 'terminate', 'decision', 'merge', 'fork', 'join',
]);

/**
 * Виды, поверх которых подпись связи читается: контейнер (подпись лежит внутри
 * него по смыслу) и полотно последовательности (линии жизни и рамки — не
 * фигуры, а сетка листа). Поверх остальных подпись — нечитаемый текст.
 */
const LABEL_BACKGROUND = new Set([
  'lifeline', 'actorLifeline', 'fragment', 'interactionUse', 'activation',
  'swimlane', 'package', 'systemBoundary', 'boundary', 'frame', 'activity',
  'node', 'executionEnvironment', 'device', 'text', 'note',
]);

/** Узлы развёртывания, внутри которых живут компоненты (вложенность геометрическая). */
const DEPLOY_NODES = new Set(['node', 'device', 'executionEnvironment']);

/** Прямоугольники подписей связи — те же, что ставит `render.js`. */
function labelBoxes(link, rel, pts, def) {
  const out = [];
  const lines = [];
  if (rel.stereotype) lines.push(`«${rel.stereotype}»`);
  if (rel.name) lines.push(rel.name);
  if (lines.length) {
    const mid = def.sequence
      ? {
        x: (pts[0][0] + pts[pts.length - 1][0]) / 2,
        y: Math.min(...pts.map((p) => p[1])) - (MECHANICS.messageCaption / 2 + 2),
      }
      : labelPos(pts, link.ldx, link.ldy, link.labelOrientation);
    const n = lines.length;
    const w = Math.max(...lines.map((t) => textWidth(t)));
    const h = (n - 1) * LINE_H + 11;   // 11 px Arial, строки через LINE_H
    // `dominant-baseline: middle`: центр строки — её `y`; первая строка сдвинута
    // на −(n−1)/2·LINE_H, вся подпись — на 12 px выше линии.
    out.push({
      kind: 'имя',
      text: lines.join(' / '),
      box: { x: mid.x - w / 2, y: mid.y - ((n - 1) / 2) * LINE_H - 12 - h / 2, w, h },
    });
  }
  if (def.multiplicity) {
    for (const [end, value] of [['from', rel.fromMultiplicity], ['to', rel.toMultiplicity]]) {
      if (!value) continue;
      const p = multiPos(pts, end, 0.2);
      // У кратности нет `text-anchor: middle` — `x` это левый край текста.
      out.push({ kind: 'кратность', text: value, box: { x: p.x, y: p.y - 5.5, w: textWidth(value), h: 11 } });
    }
  }
  return out;
}

function auditSheet({ model, diagram, sheet, boxOf, kindOf, fail }) {
  const relById = new Map(model.relationships.map((r) => [r.id, r]));
  const shapeById = new Map(diagram.shapes.map((s) => [s.id, s]));
  const elById = new Map(model.elements.map((e) => [e.id, e]));
  const drawnIds = [...shapeById.keys()];
  const paths = new Map();
  const linksOf = new Map(drawnIds.map((id) => [id, 0]));
  // Сдвиг параллельных связей — тот же, что в редакторе: проверка должна
  // мерить НАРИСОВАННОЕ, иначе она ругается на линии, которых человек не видит
  // (они уже разведены) и молчит о тех, что действительно слиплись.
  const offsets = parallelOffsets(diagram, model);

  for (const l of diagram.links) {
    if (l.from?.shapeId) linksOf.set(l.from.shapeId, (linksOf.get(l.from.shapeId) ?? 0) + 1);
    if (l.to?.shapeId) linksOf.set(l.to.shapeId, (linksOf.get(l.to.shapeId) ?? 0) + 1);
    const rel = relById.get(l.relId);
    const a = boxOf(l.from?.shapeId);
    const b = boxOf(l.to?.shapeId);
    if (!rel || !a || !b) continue;
    const def = NOTATION.connectors[rel.kind] ?? {};
    let pts;
    if (def.sequence) {
      const y = l.y;
      pts = l.from.shapeId === l.to.shapeId
        ? [[a.x + a.w, y], [a.x + a.w + 40, y], [a.x + a.w + 40, y + 20], [a.x + a.w, y + 20]]
        : [[a.x + a.w / 2, y], [b.x + b.w / 2, y]];
    } else {
      const ends = parallelEnds(diagram, l, offsets);
      pts = linkPoints(
        endPointOf(a, ends.from),
        endPointOf(b, ends.to),
        routeOfLink(l), l.waypoints, l.noEdgeStyle === true,
      );
    }

    // 1. Две разные связи, нарисованные одной ломаной: вторая линия невидима.
    const key = pts.map(([x, y]) => `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2}`).join(' ');
    if (!paths.has(key)) paths.set(key, []);
    paths.get(key).push({ id: l.id, kind: rel.kind, rel: rel.id });

    // 2. Подпись связи вне листа или поверх чужой сплошной фигуры.
    for (const { kind, text, box } of labelBoxes(l, rel, pts, def)) {
      const at = j({
        x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h),
      });
      const where = `${l.id} (${rel.kind}): подпись ${kind} «${text}» ${at}`;
      if (box.x < 0 || box.y < 0 || box.x + box.w > sheet.w || box.y + box.h > sheet.h) {
        fail('подпись', `${where} вне листа при ${sheet.w}×${sheet.h}`);
      }
      for (const otherId of drawnIds) {
        if (otherId === l.from?.shapeId || otherId === l.to?.shapeId) continue;
        const kindOther = kindOf.get(otherId);
        if (LABEL_BACKGROUND.has(kindOther)) continue;
        const B = boxOf(otherId);
        if (B && overlaps(box, B)) {
          fail('подпись', `${where} лежит поверх ${otherId} (${kindOther}) @${B.x},${B.y},${B.w},${B.h}`);
        }
      }
    }
  }

  for (const [key, list] of paths) {
    if (list.length < 2) continue;
    const names = list.map((x) => `${x.id} (${x.kind} ${x.rel})`).join(' и ');
    fail('совпадение', `${names}: одна и та же ломаная ${key}`);
  }

  // 3. Контрольный узел без единого ребра — пустая фигура на листе.
  for (const s of diagram.shapes) {
    const el = elById.get(s.elementId);
    if (!el || !CONTROL_NODES.has(el.kind)) continue;
    if (linksOf.get(s.id)) continue;
    fail('пустой', `${s.id} (${el.kind}): ни одного ребра — пустая фигура @${s.x},${s.y}`);
  }

  // 4. Композитное состояние без содержимого: объявлено композитом, а внутри пусто.
  for (const s of diagram.shapes) {
    const el = elById.get(s.elementId);
    if (el?.composite !== true) continue;
    const outer = boxOf(s.id);
    const inside = diagram.shapes.filter((o) => o.id !== s.id && boxOf(o.id)
      && boxOf(o.id).x >= outer.x && boxOf(o.id).y >= outer.y
      && boxOf(o.id).x + boxOf(o.id).w <= outer.x + outer.w
      && boxOf(o.id).y + boxOf(o.id).h <= outer.y + outer.h);
    if (!inside.length) {
      fail('композит', `${s.id} (${el.kind} «${el.name}») объявлен композитным, но внутри пусто: ${j(outer)}`);
    }
  }

  // 5. Диаграмма развёртывания: компонент лежит вне узла, то есть развёрнут нигде.
  if (diagram.kind === 'deployment') {
    const nodes = diagram.shapes.filter((s) => DEPLOY_NODES.has(kindOf.get(s.id))).map((s) => boxOf(s.id));
    for (const s of diagram.shapes) {
      const el = elById.get(s.elementId);
      if (!['component', 'artifact'].includes(el?.kind)) continue;
      const box = boxOf(s.id);
      const host = nodes.find((n) => box.x >= n.x && box.y >= n.y
        && box.x + box.w <= n.x + n.w && box.y + box.h <= n.y + n.h);
      if (!host) {
        fail('вложение', `${s.id} (${el.kind} «${el.name}») стоит вне узла: ${j(box)}`);
      }
    }
  }
}

/* ---------------------------------------------------------------- лист */

export function checkSheet(figure, { layoutDir = LAYOUT, audit = false } = {}) {
  const fails = [];
  const notes = [];
  const fail = (code, text) => fails.push({ code, text });

  const layoutPath = path.join(layoutDir, `${figure}.uml.json`);
  const corpusPath = path.join(CORPUS, `${figure}.json`);
  if (!fs.existsSync(layoutPath)) { fail('файл', 'листа нет'); return { fails, notes }; }
  if (!fs.existsSync(corpusPath)) { fail('файл', 'модели корпуса нет'); return { fails, notes }; }

  const text = fs.readFileSync(layoutPath, 'utf8');
  const src = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

  /* 1. схема */
  let model;
  const repairs = [];
  try {
    model = deserialize(text, { repairs });
  } catch (e) {
    fail('схема', `deserialize упал: ${e.message}`);
    return { fails, notes };
  }
  if (repairs.length) fail('схема', `deserialize починил: ${repairs.join('; ')}`);
  const once = serialize(model);
  const twice = serialize(deserialize(once, { repairs: [] }));
  if (once !== twice) fail('схема', 'каноническая форма нестабильна: serialize(deserialize(x)) ≠ x');
  if (once !== text) {
    const diff = deepDiff(JSON.parse(text), JSON.parse(once));
    const filled = diff.every((d) => /^relationships\[\d+\]\.fromMultiplicity$/.test(d.path)
      && d.from === undefined && d.to === '1');
    if (filled) notes.push(`чтение подставляет кратность источника «1» (${diff.length}): serialize(deserialize(x)) ≠ x`);
    else fail('схема', `serialize не воспроизводит файл байт в байт: ${diff.slice(0, 3).map((d) => d.path).join(', ')}`);
  }

  const diagram = model.diagrams[0];
  if (model.diagrams.length !== 1) fail('схема', `диаграмм ${model.diagrams.length}, ожидалась одна`);
  if (diagram.kind !== src.source.type) fail('схема', `вид диаграммы ${diagram.kind} ≠ ${src.source.type}`);

  /* 2. состав */
  const gotEl = new Map(model.elements.map((e) => [e.id, e]));
  const srcEl = new Map(src.elements.map((e) => [e.id, e]));
  for (const [id, e] of srcEl) {
    for (const m of compareElement(e, gotEl.get(id))) fail('состав', `${id} (${e.kind}): ${m}`);
  }
  for (const id of gotEl.keys()) if (!srcEl.has(id)) fail('состав', `лишний элемент ${id}`);

  const unrepresented = new Map((model.unrepresented ?? []).map((u) => [u.id, u]));
  const gotRel = new Map(model.relationships.map((r) => [r.id, r]));
  const srcRel = new Map(src.relationships.map((r) => [r.id, r]));
  for (const [id, r] of srcRel) {
    if (gotRel.has(id)) {
      for (const m of compareRelationship(r, gotRel.get(id))) fail('состав', `${id} (${r.kind}): ${m}`);
      continue;
    }
    // Связь без конца не выражается форматом (model.lostMessage) — она должна
    // быть перечислена в `unrepresented`, а не пропасть молча.
    const lost = unrepresented.get(id);
    if (!lost) { fail('состав', `связь ${id} (${r.kind}) пропала без объяснения`); continue; }
    if (lost.kind !== r.kind || lost.from !== r.from || lost.to !== r.to) {
      fail('состав', `связь ${id}: unrepresented расходится с корпусом`);
    }
    if (r.from == null || r.to == null) notes.push(`не выражается форматом: ${id} (${r.kind})`);
    else fail('состав', `связь ${id} (${r.kind}) вынесена в unrepresented без причины`);
  }
  for (const id of gotRel.keys()) if (!srcRel.has(id)) fail('состав', `лишняя связь ${id}`);
  for (const id of unrepresented.keys()) if (!srcRel.has(id)) fail('состав', `unrepresented: лишняя ${id}`);

  /* 3–4. геометрия и связи */
  const sheet = model.sheet;
  if (!sheet || !Number.isFinite(sheet.w) || !Number.isFinite(sheet.h)) {
    fail('лист', 'нет размера листа');
    return { fails, notes };
  }
  const drawn = new Map();
  const kindOf = new Map();
  for (const s of diagram.shapes) {
    const el = gotEl.get(s.elementId);
    if (!el) { fail('фигура', `${s.id}: нет элемента`); continue; }
    drawn.set(s.id, layoutOf(s, el));
    kindOf.set(s.id, el.kind);
    if (s.x % GRID !== 0 || s.y % GRID !== 0) fail('сетка', `${s.id} @${s.x},${s.y} не кратен ${GRID}`);
  }
  const byElement = new Map(diagram.shapes.map((s) => [s.elementId, s.id]));
  for (const id of srcEl.keys()) if (!byElement.has(id)) fail('фигура', `у элемента ${id} нет фигуры`);

  const boxOf = (shapeId) => {
    const s = diagram.shapes.find((x) => x.id === shapeId);
    const d = drawn.get(shapeId);
    return d ? { x: s.x, y: s.y, w: d.w, h: d.h } : null;
  };

  for (const [id, box] of [...drawn.keys()].map((k) => [k, boxOf(k)])) {
    if (box.x < 0 || box.y < 0 || box.x + box.w > sheet.w || box.y + box.h > sheet.h) {
      fail('лист', `${id} выходит за лист: ${j(box)} при ${sheet.w}×${sheet.h}`);
    }
  }

  const ids = [...drawn.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let k = i + 1; k < ids.length; k += 1) {
      const A = boxOf(ids[i]);
      const B = boxOf(ids[k]);
      if (!overlaps(A, B)) continue;
      const ka = kindOf.get(ids[i]);
      const kb = kindOf.get(ids[k]);
      const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
      if (isFrame(ka) || isFrame(kb)) {
        // Рамка последовательности лежит поверх линий жизни — это её смысл и
        // единственное исключение из правила «фигуры не пересекаются».
        // Непозволительно ей только накрывать шапку линии жизни или задевать
        // любую другую фигуру, включая соседнюю рамку.
        const frame = isFrame(ka) ? A : B;
        const other = isFrame(ka) ? B : A;
        const otherKind = isFrame(ka) ? kb : ka;
        if (otherKind === 'lifeline' || otherKind === 'actorLifeline') {
          const head = {
            x: other.x,
            y: other.y,
            w: other.w,
            h: otherKind === 'actorLifeline' ? ACTOR_LIFELINE_HEAD : LIFELINE_HEAD,
          };
          if (overlaps(frame, head)) fail('пересечение', `${ids[i]} / ${ids[k]}: рамка накрывает шапку линии жизни`);
        } else {
          fail('пересечение', `${ids[i]} / ${ids[k]}: рамка задевает фигуру (${otherKind})`);
        }
        continue;
      }
      if ((isContainer(ka) && contains(A, B)) || (isContainer(kb) && contains(B, A))) continue;
      fail('пересечение', `${ids[i]} (${ka}) / ${ids[k]} (${kb})`);
    }
  }

  // Зазор между соседями: 40 px — правило серии.
  for (let i = 0; i < ids.length; i += 1) {
    for (let k = i + 1; k < ids.length; k += 1) {
      const A = boxOf(ids[i]);
      const B = boxOf(ids[k]);
      const ka = kindOf.get(ids[i]);
      const kb = kindOf.get(ids[k]);
      // Рамки и дорожки стоят вплотную по своему устройству: рамка лежит поверх
      // линий жизни, дорожки — общая полоса без зазора.
      if (isContainer(ka) || isContainer(kb)) continue;
      const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
      if (contains(A, B) || contains(B, A)) continue;
      const xGap = Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w);
      const yGap = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
      if (xGap > 0 && yGap > 0) continue; // по диагонали — не соседи
      const gap = Math.max(xGap, yGap);
      if (gap >= 0 && gap < MIN_GAP) fail('зазор', `${ids[i]} / ${ids[k]}: ${gap} px < ${MIN_GAP}`);
    }
  }

  const relById = new Map(model.relationships.map((r) => [r.id, r]));
  const offsets = parallelOffsets(diagram, model);
  const linkByRel = new Map();
  for (const l of diagram.links) {
    const rel = relById.get(l.relId);
    if (!rel) { fail('связь', `${l.id}: нет связи ${l.relId}`); continue; }
    linkByRel.set(l.relId, l);
    const a = boxOf(l.from.shapeId);
    const b = boxOf(l.to.shapeId);
    if (!a) { fail('связь', `${l.id}: начало указывает на несуществующую фигуру`); continue; }
    if (!b) { fail('связь', `${l.id}: конец указывает на несуществующую фигуру`); continue; }
    const elFrom = diagram.shapes.find((s) => s.id === l.from.shapeId).elementId;
    const elTo = diagram.shapes.find((s) => s.id === l.to.shapeId).elementId;
    if (elFrom !== rel.from || elTo !== rel.to) fail('связь', `${l.id}: концы не совпадают со связью ${rel.id}`);
    if (l.from.shapeId !== l.to.shapeId
      && (inside({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, b) || inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, a))) {
      fail('связь', `${l.id}: фигуры наложены, конец внутри фигуры`);
    }

    const pts = linkPath(l, a, b, rel.kind, parallelEnds(diagram, l, offsets));
    if (NOTATION.connectors[rel.kind]?.sequence) {
      const y = l.y;
      const tail = (box) => box.y + box.h;
      for (const [box, name] of [[a, 'начала'], [b, 'конца']]) {
        if (y <= box.y + LIFELINE_HEAD || y >= tail(box)) {
          fail('связь', `${l.id}: сообщение вне линии жизни (${name}) y=${y}`);
        }
      }
    }
    for (const otherId of ids) {
      if (otherId === l.from.shapeId || otherId === l.to.shapeId) continue;
      const kind = kindOf.get(otherId);
      if (isFrame(kind)) continue; // рамка прозрачна для сообщений
      // Сообщение идёт поверх промежуточных линий жизни — так рисует стандарт.
      if (NOTATION.connectors[rel.kind]?.sequence && (kind === 'lifeline' || kind === 'actorLifeline')) continue;
      const box = boxOf(otherId);
      const n = passages(pts, box);
      if (!n) continue;
      const inA = inside({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, box);
      const inB = inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, box);
      if (!isContainer(kind)) { fail('сквозь', `${l.id} (${rel.kind}) проходит сквозь ${otherId} (${kind})`); continue; }
      if (!inA && !inB) fail('сквозь', `${l.id} (${rel.kind}) заходит в ${otherId} (${kind}) без конца внутри`);
      else if (n > 1) fail('сквозь', `${l.id} (${rel.kind}) пересекает границу ${otherId} ${n} раза`);
    }
  }
  for (const [id, r] of srcRel) {
    if (r.from == null || r.to == null) continue;
    if (!linkByRel.has(id)) fail('связь', `у связи ${id} (${r.kind}) нет вида на листе`);
  }
  if (diagram.links.length !== [...srcRel.values()].filter((r) => r.from != null && r.to != null).length) {
    fail('связь', `видов связей ${diagram.links.length}, ожидалось ${[...srcRel.values()].filter((r) => r.from != null && r.to != null).length}`);
  }

  /* лист: размер равен содержимому плюс поля */
  let right = 0;
  let bottom = 0;
  for (const id of ids) {
    const b = boxOf(id);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  const wantW = Math.max(600, Math.ceil((right + MARGIN) / GRID) * GRID);
  const wantH = Math.max(400, Math.ceil((bottom + MARGIN) / GRID) * GRID);
  if (sheet.w !== wantW || sheet.h !== wantH) {
    fail('лист', `размер ${sheet.w}×${sheet.h}, по содержимому ${wantW}×${wantH}`);
  }
  if (sheet.w > 2400 || sheet.h > 1800) fail('лист', `лист великоват: ${sheet.w}×${sheet.h}`);

  if (audit) auditSheet({ model, diagram, sheet, boxOf, kindOf, fail });

  return { fails, notes };
}

/* --------------------------------------------------------------- отчёт */

function main() {
  const audit = process.argv.includes('--audit');
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const figures = fs.readdirSync(CORPUS)
    .filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json')
    .map((f) => f.replace(/\.json$/, ''))
    .filter((f) => !only.length || only.includes(f))
    .sort();

  const extra = fs.readdirSync(LAYOUT)
    .filter((f) => f.endsWith('.uml.json'))
    .map((f) => f.replace(/\.uml\.json$/, ''))
    .filter((f) => !figures.includes(f));

  let bad = 0;
  const rows = [];
  for (const figure of figures) {
    const src = JSON.parse(fs.readFileSync(path.join(CORPUS, `${figure}.json`), 'utf8'));
    const { fails, notes } = checkSheet(figure, { audit });
    const model = fails.length && !fs.existsSync(path.join(LAYOUT, `${figure}.uml.json`))
      ? null
      : JSON.parse(fs.readFileSync(path.join(LAYOUT, `${figure}.uml.json`), 'utf8'));
    rows.push({
      figure,
      type: src.source.type,
      shapes: model?.diagrams?.[0]?.shapes.length ?? 0,
      links: model?.diagrams?.[0]?.links.length ?? 0,
      sheet: model?.sheet ? `${model.sheet.w}×${model.sheet.h}` : '—',
      fails,
      notes,
    });
    if (fails.length) bad += 1;
  }

  const byCode = new Map();
  for (const row of rows) {
    for (const f of row.fails) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  }

  console.log('номер  тип           фигур  связей  лист        замечания');
  console.log('─'.repeat(78));
  for (const row of rows) {
    const mark = row.fails.length ? `${row.fails.length}` : 'ok';
    console.log(
      `${row.figure.padEnd(6)} ${row.type.padEnd(13)} ${String(row.shapes).padStart(5)}  ${String(row.links).padStart(6)}  `
      + `${row.sheet.padEnd(11)} ${mark}`,
    );
    for (const f of row.fails) console.log(`         · [${f.code}] ${f.text}`);
  }
  console.log('─'.repeat(78));

  const notes = rows.flatMap((r) => r.notes);
  if (notes.length) {
    console.log(`\nне выражается форматом (${notes.length}):`);
    for (const n of [...new Set(notes)]) console.log(`  · ${n}`);
  }
  if (extra.length) {
    console.log(`\nлисты без модели корпуса: ${extra.join(', ')}`);
    bad += extra.length;
  }

  console.log(`\nлистов: ${rows.length}, с замечаниями: ${bad}`);
  if (byCode.size) console.log(`по видам: ${[...byCode].map(([k, v]) => `${k} — ${v}`).join(', ')}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
