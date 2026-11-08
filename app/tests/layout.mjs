// Итерация 23 — авто-раскладка как ДОБРОВОЛЬНАЯ команда.
//
// Набор проверяет три вещи и все три — числами:
//
//   1. чистый алгоритм (src/model/layout.js): ранги, порядок, зазоры,
//      отсутствие пересечений рамок на десяти фигурах, отказ на
//      последовательности;
//   2. путь команды без диалога: счёт ручных точек по модели, применение
//      через `commit` и «снимок до == снимок после отмены» (сравнение JSON);
//   3. настоящий интерфейс в headless-Chromium: пункт меню, пункт палитры,
//      текст диалога с числом точек, кнопка «Разложить и потерять изгибы»,
//      отмена и отказ на диаграмме последовательности.
//
//   node tests/layout.mjs
//
// Зависимостей нет: сервер на node:http, браузер — по CDP через встроенный
// WebSocket, как в остальных наборах.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPackage } from '../src/model/notation.js';
import { store, commit, undo } from '../src/state/store.js';
import {
  createModel, createDiagram, currentDiagram, createRelationship, createLink, placeElement,
  elementOf,
} from '../src/model/model.js';
import { layoutOf } from '../src/model/geometry.js';
import {
  layeredLayout, directedEdges, planLayout, applyLayoutPlan, layoutSupport,
  parentsOf, DEFAULT_GAP,
} from '../src/model/layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

applyPackage(JSON.parse(await readFile(new URL('../notation/uml.json', import.meta.url), 'utf8')));

/* ==================================================== 1. чистый алгоритм */

const nodes = (n, w = 190, h = 170) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, w, h }));

check('последовательность: команда отказывает',
  layoutSupport('sequence').ok === false, layoutSupport('sequence').reason.slice(0, 48));
check('отказ объясняет причину: порядок сообщений',
  /порядок сообщений/.test(layoutSupport('sequence').reason));
check('синхронизация: команда отказывает и говорит про время',
  layoutSupport('timing').ok === false && /время/.test(layoutSupport('timing').reason));
for (const kind of ['class', 'object', 'package', 'component', 'deployment', 'usecase', 'state', 'activity']) {
  check(`лист «${kind}» раскладывается`, layoutSupport(kind).ok === true);
}

// Ранги — самый длинный путь: короткий обход не должен «поднимать» узел.
{
  const L = layeredLayout(nodes(4), [
    { from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' },
    { from: 'n0', to: 'n2' }, { from: 'n2', to: 'n3' },
  ], { gap: DEFAULT_GAP });
  const ranks = [0, 1, 2, 3].map((i) => L.ranks[`n${i}`]);
  check('ранги: цепочка даёт 0,1,2,3 (самый длинный путь)',
    JSON.stringify(ranks) === '[0,1,2,3]', ranks.join(','));
}

// Цикл не должен вешать раскладку: обратное ребро отбрасывается.
{
  const t0 = Date.now();
  const L = layeredLayout(nodes(3), [
    { from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n0' },
  ], { gap: DEFAULT_GAP });
  check('цикл: раскладка завершается и все фигуры на местах',
    Object.keys(L.positions).length === 3 && Date.now() - t0 < 1000,
    `${Object.keys(L.positions).length} позиции, ${Date.now() - t0} мс`);
}

// Обобщение в файле идёт от потомка к предку; ранг должен расти от предка.
{
  const e = directedEdges(
    [{ from: { shapeId: 'child' }, to: { shapeId: 'parent' }, relId: 'r' }],
    (l) => ({ r: 'generalization' }[l.relId]),
  );
  check('обобщение разворачивается: предок получает меньший ранг',
    e.length === 1 && e[0].from === 'parent' && e[0].to === 'child',
    JSON.stringify(e));
  const d = directedEdges(
    [{ from: { shapeId: 'a' }, to: { shapeId: 'b' }, relId: 'r' }],
    (l) => ({ r: 'dependency' }[l.relId]),
  );
  check('зависимость читается как есть: источник выше цели',
    d.length === 1 && d[0].from === 'a' && d[0].to === 'b');
  const none = directedEdges(
    [{ from: { shapeId: 'a' }, to: { shapeId: 'b' }, relId: 'r' }],
    (l) => ({ r: 'association' }[l.relId]),
  );
  check('ассоциация рангов не задаёт', none.length === 0);
}

// Порядок внутри ранга: дети одного родителя должны встать рядом, даже если
// во входе они перемешаны. Без прохода по барицентру строка осталась бы
// c10,c00,c11,c01 — и проверка покраснеет.
{
  const list = [
    { id: 'p0', w: 100, h: 60 }, { id: 'p1', w: 100, h: 60 },
    { id: 'c10', w: 100, h: 60 }, { id: 'c00', w: 100, h: 60 },
    { id: 'c11', w: 100, h: 60 }, { id: 'c01', w: 100, h: 60 },
  ];
  const L = layeredLayout(list, [
    { from: 'p0', to: 'c00' }, { from: 'p0', to: 'c01' },
    { from: 'p1', to: 'c10' }, { from: 'p1', to: 'c11' },
  ], { gap: DEFAULT_GAP });
  const row = L.rows[1] ?? [];
  const ok = row.length === 4
    && Math.abs(row.indexOf('c00') - row.indexOf('c01')) === 1
    && Math.abs(row.indexOf('c10') - row.indexOf('c11')) === 1;
  check('порядок по барицентру: дети одного родителя стоят рядом', ok, row.join(','));
}

// Десять фигур: пересечений рамок быть не должно, и зазор — не меньше 30.
{
  const ten = nodes(10);
  const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 7], [4, 8], [5, 9]]
    .map(([a, b]) => ({ from: `n${a}`, to: `n${b}` }));
  const L = layeredLayout(ten, edges, { gap: DEFAULT_GAP });
  const boxes = ten.map((n) => ({ ...n, ...L.positions[n.id] }));
  let overlaps = 0;
  let tight = 0;
  let pairs = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      pairs += 1;
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (hit) overlaps += 1;
      const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
      const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
      if (Math.max(dx, dy) < DEFAULT_GAP) tight += 1;
    }
  }
  check('10 фигур: пересечений рамок 0', overlaps === 0, `пересечений ${overlaps} из ${pairs} пар`);
  check('10 фигур: у каждой пары зазор не меньше 30 px', tight === 0, `тесных пар ${tight}`);
  check('10 фигур: все десять получили координаты',
    Object.keys(L.positions).length === 10, `${Object.keys(L.positions).length}`);
  const again = layeredLayout(ten, edges, { gap: DEFAULT_GAP });
  check('раскладка детерминирована', JSON.stringify(again.positions) === JSON.stringify(L.positions));
}

// Зазор настраивается: 60 px даёт шаг больше, чем 30 px.
{
  const two = nodes(2);
  const a = layeredLayout(two, [{ from: 'n0', to: 'n1' }], { gap: 30 });
  const b = layeredLayout(two, [{ from: 'n0', to: 'n1' }], { gap: 60 });
  const dxa = a.positions.n1.x - (a.positions.n0.x + 190);
  const dxb = b.positions.n1.x - (b.positions.n0.x + 190);
  check('зазор настраивается: 30 → 30, 60 → 60',
    dxa === 30 && dxb === 60, `${dxa} и ${dxb}`);
}

// Источник не должен уметь запускать себя сам: ни DOM, ни подписки, ни таймера.
{
  const src = await readFile(new URL('../src/model/layout.js', import.meta.url), 'utf8');
  const bad = /document\.|window\.|setTimeout|setInterval|subscribe\(|commit\(/.test(src);
  check('layout.js — чистые функции: без DOM, подписок и таймеров', !bad);
}

/* ============================================ 2. модель: счёт и отмена */

const addShape = (m, kind, name, x, y, w, h) => placeElement(m, kind, x, y, { name, w, h });

const join = (m, d, kind, a, b, waypoints = null) => {
  const rel = createRelationship(kind, a.element.id, b.element.id);
  m.relationships.push(rel);
  const link = createLink(rel,
    { shapeId: a.shape.id, side: 'right', t: 0.5 },
    { shapeId: b.shape.id, side: 'left', t: 0.5 });
  if (waypoints) link.waypoints = waypoints;
  d.links.push(link);
  return link;
};

const boxOf = (m, s) => {
  const el = m.elements.find((e) => e.id === s.elementId);
  const b = layoutOf(s, el);
  return { x: s.x, y: s.y, w: b.w, h: b.h };
};

// Классы + одна связь с тремя ручными точками.
const m1 = createModel('Проверка раскладки');
const d1 = currentDiagram(m1);
const kA = addShape(m1, 'class', 'Заказ', 40, 40, 190, 170);
const kB = addShape(m1, 'class', 'Клиент', 320, 40, 190, 170);
const kC = addShape(m1, 'class', 'Счёт', 40, 300, 190, 170);
join(m1, d1, 'generalization', kB, kA);
const bentLink = join(m1, d1, 'dependency', kA, kC, [[260, 120], [280, 150], [300, 180]]);
join(m1, d1, 'association', kB, kC);

const modelBeforePlan = JSON.stringify(m1);
const plan = planLayout(m1, { gap: DEFAULT_GAP });
check('план: лист целиком', plan.ok && plan.scope === 'sheet', plan.ok ? plan.scope : plan.reason);
check('план: одна связь с ручными точками и три точки',
  plan.counts.bentLinks === 1 && plan.counts.points === 3,
  `связей ${plan.counts.bentLinks}, точек ${plan.counts.points}`);
check('план ничего не меняет в модели (чистая функция)',
  JSON.stringify(m1) === modelBeforePlan);

store.model = m1;
const beforeApply = JSON.stringify(m1);
const applied = commit('Автоматическая раскладка', (model) => applyLayoutPlan(model, plan));
check('применение: фигуры переехали', applied.moved > 0, `сдвинуто ${applied.moved}`);
check('применение: удалено ровно столько точек, сколько назвал диалог',
  applied.pointsRemoved === plan.counts.points,
  `${applied.pointsRemoved} из ${plan.counts.points}`);
check('применение: у связи точек не осталось',
  !(currentDiagram(store.model).links.find((l) => l.id === bentLink.id)?.waypoints?.length));
check('применение: размеры фигур не изменились',
  currentDiagram(store.model).shapes.every((s, i) => {
    const before = JSON.parse(beforeApply).diagrams[0].shapes[i];
    return s.w === before.w && s.h === before.h;
  }));
undo();
check('одна отмена вернула снимок до байта (JSON модели)',
  JSON.stringify(store.model) === beforeApply);

// Последовательность: отказ, а не молчаливое «ничего не произошло».
{
  const m = createModel('Последовательность');
  const d = createDiagram('Сообщения', 'sequence');
  m.diagrams.push(d);
  m.currentDiagramId = d.id;
  const l1 = addShape(m, 'lifeline', ':Заказ', 100, 60, 120, 260);
  const l2 = addShape(m, 'lifeline', ':Склад', 320, 60, 120, 260);
  join(m, d, 'message', l1, l2);
  const before = JSON.stringify(m);
  const p = planLayout(m, { gap: DEFAULT_GAP });
  check('последовательность: план отказывает и объясняет',
    p.ok === false && p.refused === true && /последовательности/.test(p.reason),
    p.reason?.slice(0, 60));
  check('последовательность: модель не тронута', JSON.stringify(m) === before);
}

// Вложенность: артефакт внутри узла остаётся внутри, узел едет целиком.
{
  const m = createModel('Развёртывание');
  const d = createDiagram('Развёртывание', 'deployment');
  m.diagrams.push(d);
  m.currentDiagramId = d.id;
  const nodeA = addShape(m, 'node', 'Сервер приложений', 80, 60, 260, 200);
  const nodeB = addShape(m, 'node', 'Сервер СУБД', 480, 60, 220, 200);
  const art = addShape(m, 'artifact', 'shop.war', 120, 140, 140, 70);
  join(m, d, 'communicationPath', nodeA, nodeB);
  const p = planLayout(m, { gap: DEFAULT_GAP });
  const res = applyLayoutPlan(m, p);
  const nb = boxOf(m, nodeA.shape);
  const ab = boxOf(m, art.shape);
  check('вложенность: артефакт остался внутри узла',
    ab.x >= nb.x && ab.y >= nb.y && ab.x + ab.w <= nb.x + nb.w && ab.y + ab.h <= nb.y + nb.h,
    `узел ${nb.x},${nb.y} ${nb.w}×${nb.h}; артефакт ${ab.x},${ab.y} ${ab.w}×${ab.h}`);
  check('вложенность: узел не растянут', nodeA.shape.w === 260 && nodeA.shape.h === 200,
    `${nodeA.shape.w}×${nodeA.shape.h}`);
  check('вложенность: раскладка что-то сдвинула', res.moved > 0, `сдвинуто ${res.moved}`);
}

// Соседи не пересекаются: вложенность — рамка внутри рамки по замыслу,
// поэтому пары «контейнер ↔ его содержимое» из счёта исключены.
{
  const m = createModel('Соседи');
  const d = createDiagram('Варианты', 'usecase');
  m.diagrams.push(d);
  m.currentDiagramId = d.id;
  const box = addShape(m, 'systemBoundary', 'Система', 40, 40, 700, 500);
  const uc = [];
  for (let i = 0; i < 6; i += 1) uc.push(addShape(m, 'usecase', `Вариант ${i}`, 80 + i * 40, 90 + i * 20, 150, 60));
  const actor = addShape(m, 'actor', 'Актёр', 800, 200, 40, 70);
  for (const u of uc) join(m, d, 'association', actor, u);
  const p = planLayout(m, { gap: DEFAULT_GAP });
  const par = parentsOf(m, d);
  const boxes = p.moves.map((mv) => {
    const sh = d.shapes.find((x) => x.id === mv.id);
    const b = layoutOf(sh, elementOf(m, sh));
    return { id: mv.id, x: mv.x, y: mv.y, w: mv.w ?? b.w, h: mv.h ?? b.h, p: par.get(mv.id) };
  });
  let hits = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      if (a.p === b.id || b.p === a.id) continue;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits += 1;
    }
  }
  check('соседи не пересекаются, вложенность не в счёт', hits === 0, `пересечений ${hits}`);
  check('контейнер узнан: шесть вариантов внутри рамки',
    uc.every((u) => par.get(u.shape.id) === box.shape.id),
    uc.map((u) => par.get(u.shape.id) ?? 'нет').join(','));
}

// Контейнер, в который содержимое не влезает, растёт — и об этом говорит план.
{
  const m = createModel('Тесный контейнер');
  const d = createDiagram('Развёртывание', 'deployment');
  m.diagrams.push(d);
  m.currentDiagramId = d.id;
  // Все три сначала лежат внутри узла (иначе они бы и не были его
  // содержимым), но в 200×250 после раскладки не помещаются.
  const node = addShape(m, 'node', 'Узел', 40, 40, 200, 250);
  const a1 = addShape(m, 'artifact', 'a.jar', 60, 60, 140, 70);
  const a2 = addShape(m, 'artifact', 'b.jar', 60, 60, 140, 70);
  const a3 = addShape(m, 'artifact', 'c.jar', 60, 60, 140, 70);
  join(m, d, 'manifest', a1, a2);
  join(m, d, 'manifest', a2, a3);
  const p = planLayout(m, { gap: DEFAULT_GAP });
  const grownMove = p.moves.find((mv) => mv.id === node.shape.id && mv.w);
  check('тесный контейнер: план говорит, что контейнер вырастет',
    p.counts.grown === 1 && !!grownMove, `выросло ${p.counts.grown}`);
  applyLayoutPlan(m, p);
  const nb = boxOf(m, node.shape);
  const inside = [a1, a2, a3].every((a) => {
    const ab = boxOf(m, a.shape);
    return ab.x >= nb.x && ab.y >= nb.y && ab.x + ab.w <= nb.x + nb.w && ab.y + ab.h <= nb.y + nb.h;
  });
  check('тесный контейнер: всё содержимое внутри после роста', inside,
    `узел ${nb.w}×${nb.h}`);
}

// Выделение: раскладывается только оно.
{
  const m = createModel('Выделение');
  const d = currentDiagram(m);
  const s1 = addShape(m, 'class', 'A', 40, 40, 190, 170);
  const s2 = addShape(m, 'class', 'B', 300, 40, 190, 170);
  const s3 = addShape(m, 'class', 'C', 560, 40, 190, 170);
  const s4 = addShape(m, 'class', 'D', 820, 40, 190, 170);
  join(m, d, 'dependency', s1, s2);
  join(m, d, 'dependency', s3, s4);
  const p = planLayout(m, { shapeIds: [s1.shape.id, s2.shape.id] });
  check('выделение: область — выделение, разложено две фигуры',
    p.ok && p.scope === 'selection' && p.counts.shapes === 2,
    p.ok ? `${p.scope}, ${p.counts.shapes}` : p.reason);
  const ids = p.moves.map((mv) => mv.id);
  check('выделение: невыделенные фигуры в план не попали',
    !ids.includes(s3.shape.id) && !ids.includes(s4.shape.id), ids.length);
}

/* ======================================= 3. интерфейс: меню, палитра, диалог */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

function findChrome() {
  const home = process.env.HOME ?? '';
  return [
    `${home}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
    `${home}/.hermes/tools/chromium-1208/chrome-linux64/chrome`,
  ].find((p) => existsSync(p));
}

async function browserChecks() {
  const bin = findChrome();
  if (!bin) {
    check('браузер: меню, палитра и диалог', true, 'skipped: headless Chrome не найден');
    return;
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch { res.writeHead(404).end('nope'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/?model=sample`;

  const profile = await mkdtemp(path.join(tmpdir(), 'uml-layout-'));
  const port = 9600 + Math.floor(Math.random() * 150);
  const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, '--window-size=1440,900', `--user-data-dir=${profile}`, base],
  { stdio: ['ignore', 'ignore', 'pipe'] });

  let ws = null;
  for (let i = 0; i < 80 && !ws; i += 1) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      }
    } catch { /* стартует */ }
  }
  if (!ws) {
    child.kill('SIGKILL');
    server.close();
    await rm(profile, { recursive: true, force: true });
    check('браузер запустился', false, 'нет devtools-цели');
    return;
  }

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    }
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await sleep(2400);

  const out = await evaluate(String.raw`(async () => {
    const R = [];
    const A = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail: String(detail) });
    const U = window.__uml;
    if (!U) return [{ name: 'приложение загрузилось', ok: false, detail: 'window.__uml нет' }];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn, ms = 4000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); }
      return null;
    };
    const dialogs = () => document.querySelectorAll('sc-dialog[open]');
    const oneDialog = () => document.querySelector('sc-dialog[open]');

    try {
      U.loadModel(U.deserialize(JSON.stringify({
        schema: 'uml-model/3', name: 'Проверка раскладки', elements: [],
        relationships: [], diagrams: [], currentDiagramId: null,
      })), 'layout-test.uml.json');
      const d = U.commit('t', (m) => {
        const made = U.createDiagram('Классы', 'class');
        m.diagrams.push(made);
        m.currentDiagramId = made.id;
        return made;
      });
      const place = (kind, x, y, w, h, name) => U.commit('t', (m) => {
        const made = U.placeElement(m, kind, x, y, { name });
        const s = U.currentDiagram(m).shapes.find((z) => z.id === made.shape.id) ?? made.shape;
        s.x = x; s.y = y; s.w = w; s.h = h;
        return made;
      });
      const kA = place('class', 40, 40, 190, 170, 'Заказ');
      const kB = place('class', 320, 40, 190, 170, 'Клиент');
      const kC = place('class', 40, 300, 190, 170, 'Счёт');
      U.commit('t', (m) => {
        const r = U.createRelationship('generalization', kB.element.id, kA.element.id);
        m.relationships.push(r);
        U.currentDiagram(m).links.push(U.createLink(r,
          { shapeId: kB.shape.id, side: 'left', t: 0.5 },
          { shapeId: kA.shape.id, side: 'right', t: 0.5 }));
      });
      U.commit('t', (m) => {
        const r = U.createRelationship('dependency', kA.element.id, kC.element.id);
        m.relationships.push(r);
        const l = U.createLink(r,
          { shapeId: kA.shape.id, side: 'bottom', t: 0.5 },
          { shapeId: kC.shape.id, side: 'top', t: 0.5 });
        l.waypoints = [[150, 250], [170, 265], [190, 280]];
        U.currentDiagram(m).links.push(l);
      });
      U.renderCanvas();
      // Панель перерисовывается в микрозадаче после commit: даём ей встать,
      // иначе клик по меню придётся на старый DOM.
      await sleep(300);
      const before = JSON.stringify(U.store.model);

      /* --- меню «Правка» --- */
      const editBtn = await until(() => [...document.querySelectorAll('#toolbar .menu > button')]
        .find((b) => b.textContent.trim().startsWith('Правка')), 4000);
      A('меню «Правка» на месте', !!editBtn);
      // Меню могло закрыться от перерисовки — тогда открываем его снова.
      // Три ловушки, каждая из которых уже давала ложное «пункта нет»:
      // кнопка меню — ПЕРЕКЛЮЧАТЕЛЬ (повторный клик по открытому меню его
      // закрывает); после перерисовки панели инструментов старая ссылка на
      // кнопку отсоединена и клик по ней не делает ничего; а под нагрузкой
      // попап появляется позже, чем успевал дождаться прежний цикл (700 мс ×
      // попытку). Поэтому кнопка берётся заново, попап прошлой попытки
      // снимается, а ожидание — до 2.5 с на попытку, и в отчёте при провале
      // видно, что вообще было в панели.
      let item = null;
      let tried = '';
      for (let attempt = 0; attempt < 4 && !item; attempt += 1) {
        for (const p of document.querySelectorAll('.menu-pop')) p.remove();
        const buttons = [...document.querySelectorAll('#toolbar .menu > button')];
        const btnNow = buttons.find((b) => b.textContent.trim().startsWith('Правка'));
        tried = 'попытка ' + (attempt + 1) + ': кнопок в панели ' + buttons.length
          + ' (' + buttons.map((b) => b.textContent.trim().split(' ')[0]).join(', ') + ')';
        btnNow?.click();
        item = await until(() => [...document.querySelectorAll('.menu-pop button')]
          .find((b) => b.textContent.includes('Разложить автоматически')), 2500);
      }
      A('пункт «Разложить автоматически…» есть в меню', !!item, item ? item.textContent : 'нет — ' + tried);
      A('пункт доступен, когда фигур больше одной', !!item && !item.disabled);
      item?.click();

      const dlg = await until(oneDialog, 4000);
      A('диалог раскладки открылся', !!dlg, dlg ? dlg.getAttribute('heading') : 'нет диалога');
      if (!dlg) return R;
      const text = (dlg?.textContent ?? '').replace(/\s+/g, ' ');
      A('диалог называет, что раскладывается', /весь лист/.test(text), text.slice(0, 120));
      A('диалог называет число связей и точек',
        /1 связь/.test(text) && /3 точки/.test(text), text.slice(0, 220));
      A('диалог объясняет, почему изгибы не сохранить', /нельзя/.test(text));
      A('в диалоге поле зазора со значением 30', dlg?.querySelector('#lay-gap')?.value === '30',
        dlg?.querySelector('#lay-gap')?.value ?? 'нет поля');
      // Число из текста диалога — и его же сверяем с тем, что исчезло.
      const said = Number((text.match(/(\d+)\s+точ/) ?? [])[1] ?? -1);
      A('диалог называет число точек цифрой', said === 3, String(said));
      const okBtn = dlg?.querySelector('.sc-button--primary');
      A('кнопка «Разложить и потерять изгибы»',
        !!okBtn && okBtn.textContent.includes('потерять изгибы'), okBtn ? okBtn.textContent : 'нет');
      okBtn?.click();
      await until(() => !oneDialog(), 4000);
      await sleep(200);

      const after = U.currentDiagram(U.store.model);
      const left = after.links.filter((l) => Array.isArray(l.waypoints) && l.waypoints.length);
      A('после применения ручных точек не осталось', left.length === 0, 'связей с точками ' + left.length);
      const pointsLeft = after.links.reduce((n, l) => n + (Array.isArray(l.waypoints) ? l.waypoints.length : 0), 0);
      A('исчезло ровно столько точек, сколько назвал диалог',
        pointsLeft === 3 - said, 'было 3, осталось ' + pointsLeft + ', диалог сказал ' + said);
      const beforeShapes = JSON.parse(before).diagrams[0].shapes.map((s) => [s.x, s.y]);
      const afterShapes = after.shapes.map((s) => [s.x, s.y]);
      A('фигуры переехали', JSON.stringify(beforeShapes) !== JSON.stringify(afterShapes),
        afterShapes.map((p) => p.join(',')).join(' '));
      A('пересечений рамок на листе нет', (() => {
        const boxes = after.shapes.map((s) => {
          const el = U.store.model.elements.find((e) => e.id === s.elementId);
          return { x: s.x, y: s.y, w: s.w, h: s.h, el };
        });
        let n = 0;
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i]; const b = boxes[j];
            if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n += 1;
          }
        }
        return n === 0;
      })());

      U.undo();
      U.renderCanvas();
      A('одна отмена вернула снимок до байта', JSON.stringify(U.store.model) === before);

      /* --- лист без ручных изгибов: предупреждения нет, но проверка видна --- */
      U.commit('t', (m) => {
        for (const l of U.currentDiagram(m).links) delete l.waypoints;
      });
      U.renderCanvas();
      await sleep(300);
      const before0 = JSON.stringify(U.store.model);
      document.getElementById('cmdpal').dispatchEvent(
        new CustomEvent('sc-command', { detail: { id: 'edit-layout' }, bubbles: true }),
      );
      const dlg0 = await until(oneDialog, 4000);
      const t0 = (dlg0?.textContent ?? '').replace(/\s+/g, ' ');
      A('без изгибов: строка «ручных изгибов нет» на месте', /ручных изгибов нет/.test(t0), t0.slice(0, 140));
      A('без изгибов: кнопка не обещает потерю',
        dlg0?.querySelector('.sc-button--primary')?.textContent.trim() === 'Разложить',
        dlg0?.querySelector('.sc-button--primary')?.textContent ?? 'нет');

      // Зазор из диалога доезжает до раскладки: 60 вместо 30 сдвигает
      // второй столбец на 30 px правее (190 — ширина класса, 40 — начало).
      const gapInput = dlg0?.querySelector('#lay-gap');
      if (gapInput) {
        gapInput.value = '60';
        gapInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      dlg0?.querySelector('.sc-button--primary')?.click();
      await until(() => !oneDialog(), 4000);
      await sleep(300);
      const xs = U.currentDiagram(U.store.model).shapes.map((s) => s.x).sort((a, b) => a - b);
      A('зазор из диалога применён: 40 + 190 + 60 = 290', xs.includes(290), xs.join(','));

      U.undo();
      U.renderCanvas();
      await sleep(200);
      A('после отмены зазорного прогона снимок до байта',
        JSON.stringify(U.store.model) === before0);

      /* --- палитра Ctrl+K --- */
      const pal = document.getElementById('cmdpal');
      const cmds = pal?.commands ?? [];
      const entry = cmds.find((c) => c.id === 'edit-layout');
      A('палитра Ctrl+K содержит команду', !!entry, entry ? entry.label : 'нет');
      pal?.dispatchEvent(new CustomEvent('sc-command', { detail: { id: 'edit-layout' }, bubbles: true }));
      const dlg2 = await until(oneDialog, 4000);
      A('палитра открывает тот же диалог', !!dlg2
        && dlg2.getAttribute('heading') === 'Разложить автоматически');
      if (!dlg2) return R;
      dlg2.querySelector('.sc-button--ghost')?.click();
      await until(() => !oneDialog(), 4000);
      await sleep(200);
      A('«Отмена» ничего не меняет', JSON.stringify(U.store.model) === before0);

      /* --- последовательность --- */
      const sd = U.commit('t', (m) => {
        const made = U.createDiagram('Сообщения', 'sequence');
        m.diagrams.push(made);
        m.currentDiagramId = made.id;
        return made;
      });
      const l1 = place('lifeline', 100, 60, 120, 260, ':Заказ');
      const l2 = place('lifeline', 320, 60, 120, 260, ':Склад');
      U.commit('t', (m) => {
        const r = U.createRelationship('message', l1.element.id, l2.element.id);
        m.relationships.push(r);
        const l = U.createLink(r,
          { shapeId: l1.shape.id, side: 'right', t: 0.5 },
          { shapeId: l2.shape.id, side: 'left', t: 0.5 });
        l.y = 200;
        U.currentDiagram(m).links.push(l);
      });
      U.renderCanvas();
      const seqBefore = JSON.stringify(U.store.model);
      document.getElementById('cmdpal').dispatchEvent(
        new CustomEvent('sc-command', { detail: { id: 'edit-layout' }, bubbles: true }),
      );
      const dlg3 = await until(oneDialog, 4000);
      const t3 = (dlg3?.textContent ?? '').replace(/\s+/g, ' ');
      A('последовательность: команда отказывает и объясняет',
        !!dlg3 && /не раскладывается/.test(t3) && /порядок сообщений/.test(t3), t3.slice(0, 180));
      const primary3 = dlg3?.querySelector('.sc-button--primary');
      A('у отказа нет кнопки «Разложить»',
        !primary3 || !primary3.textContent.includes('Разложить'), primary3 ? primary3.textContent : 'кнопки нет');
      primary3?.click();
      await until(() => !oneDialog(), 4000);
      await sleep(200);
      A('последовательность: модель не тронута', JSON.stringify(U.store.model) === seqBefore);
    } catch (err) {
      R.push({ name: 'сценарий прерван', ok: false, detail: String(err && err.stack || err).slice(0, 500) });
    }
    return R;
  })()`);

  for (const r of out ?? []) check(`браузер: ${r.name}`, r.ok, r.detail);

  ws.close();
  child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
  server.close();
}

await browserChecks();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} проверок прошло`);
process.exit(failed ? 1 : 0);
