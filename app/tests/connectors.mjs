// Итерация 15 — три дефекта связей: Д1 (два независимых маркера на конце),
// Д2 (цель — самая глубокая фигура под курсором), Д3 (перетаскивание сегмента
// двумя точками), плюс концы как доля+смещение и три новых поля файла.
//
// Тот же стенд, что у остальных наборов: локальный сервер + headless-Chromium
// по CDP, без зависимостей. Проверки идут через window.__uml — те же функции,
// что зовёт интерфейс, — а жест связывания и перетаскивание сегмента
// проигрываются настоящими событиями указателя на настоящем листе.
//
//   node tests/connectors.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `.mjs` обязателен: в `src/vendor/` лежат сторонние ES-модули (archify), и
// без него сервер отдаёт их как `application/octet-stream` — браузер отказывается
// исполнять модуль по строгой проверке MIME, приложение не поднимается, и набор
// падает с «window.__uml missing» вместо настоящей причины.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/?model=sample`;

const home = process.env.HOME ?? '';
const bin = [
  `${home}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`,
  `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  `${home}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`,
  `${home}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
  `${home}/.hermes/tools/chromium-1208/chrome-linux64/chrome`,
].find((p) => existsSync(p));
if (!bin) { console.error('headless Chrome not found'); process.exit(1); }

const profile = await mkdtemp(path.join(tmpdir(), 'uml-connectors-'));
const port = 9800 + Math.floor(Math.random() * 150);
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, '--window-size=1440,900', `--user-data-dir=${profile}`, base],
{ stdio: ['ignore', 'ignore', 'pipe'] });

let ws = null;
for (let i = 0; i < 80 && !ws; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); }
  } catch { /* starting */ }
}
if (!ws) { child.kill('SIGKILL'); console.error('no devtools target'); process.exit(1); }

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  }
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Log.enable');
await sleep(2200);

const results = await evaluate(String.raw`(async () => {
  const R = [];
  const A = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail: String(detail) });
  const U = window.__uml;
  if (!U) return [{ name: 'app booted', ok: false, detail: 'window.__uml missing' }];
  const geo = await import('/src/model/geometry.js');
  try {

  const blank = (name = 'blank.uml') => U.loadModel(U.deserialize(JSON.stringify({
    schema: 'uml-model/3', name: 'Проверка', elements: [], relationships: [], diagrams: [], currentDiagramId: null,
  })), name);
  const addDiagram = (kind, name = 'D') => U.commit('t', (m) => {
    const d = U.createDiagram(name, kind);
    m.diagrams.push(d);
    m.currentDiagramId = d.id;
    return d;
  });
  // Фигура точного размера: placeElement ставит умолчание вида, а сценариям
  // нужны свои коробки (класс внутри рамки, перекрытие, маленькая цель).
  const placeBox = (kind, x, y, w, h) => U.commit('t', (m) => {
    const made = U.placeElement(m, kind, x, y);
    const s = U.currentDiagram(m).shapes.find((z) => z.id === made.shape.id) ?? made.shape;
    s.x = x; s.y = y; s.w = w; s.h = h;
    return made;
  });
  const join = (connKind, a, b, extra = {}) => U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    const rel = U.createRelationship(connKind, a.element.id, b.element.id);
    m.relationships.push(rel);
    const link = U.createLink(rel,
      { shapeId: a.shape.id, side: 'right', t: 0.5 },
      { shapeId: b.shape.id, side: 'left', t: 0.5 }, extra);
    d.links.push(link);
    return link;
  });
  const linkEl = (id) => document.querySelector('#canvas [data-kind="conn"][data-id="' + id + '"]');
  const shapeEl = (id) => document.querySelector('#canvas [data-kind="shape"][data-id="' + id + '"]');
  const numsOf = (n) => (n.getAttribute('points') || n.getAttribute('d') || '').match(/-?[\d.]+/g)?.map(Number) ?? [];
  // Маркеры конца: считаем каждый вид и берём X острия — по нему видно, у
  // какого конца нарисован маркер и не наложились ли они друг на друга.
  const headsOf = (id) => {
    const g = linkEl(id);
    if (!g) return null;
    // Остриё маркера: у полигона это его первая точка, у открытой стрелки —
    // вторая вершина пути (M бок → L остриё → L бок).
    const xs = (sel) => [...g.querySelectorAll(sel)].map((n) => Math.min(...numsOf(n).filter((v, i) => i % 2 === 0)));
    const tri = xs('.head-tri');
    const fill = xs('.head-fill');
    const openTips = [...g.querySelectorAll('.head-open')].map((n) => numsOf(n)[2]);
    const triBase = [...g.querySelectorAll('.head-tri')].map((n) => Math.max(...numsOf(n).filter((v, i) => i % 2 === 0)));
    return {
      tri: tri.length, fill: fill.length, open: openTips.length,
      triX: tri[0], openX: openTips[0], fillX: fill[0], triBaseX: triBase[0],
    };
  };
  const dOf = (id) => linkEl(id)?.querySelector('path.conn')?.getAttribute('d') ?? '';

  // События указателя в координатах модели: toModel() читает clientX/Y и
  // текущий вид, поэтому экран считается той же формулой, что и в canvas.
  const screenOf = (x, y) => {
    const r = document.getElementById('canvas').getBoundingClientRect();
    const { scale, tx, ty } = U.store.ui.view;
    return { clientX: r.left + tx + x * scale, clientY: r.top + ty + y * scale };
  };
  const fire = (el, type, x, y) => {
    const p = screenOf(x, y);
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: p.clientX, clientY: p.clientY,
    }));
  };
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* ======================= (1) Д1: два слота маркеров ================= */
  blank(); addDiagram('class', 'D1');
  const a1 = placeBox('class', 80, 80, 190, 170);
  const b1 = placeBox('class', 420, 80, 190, 170);
  const l1 = join('association', a1, b1);
  U.commit('t', (m) => {
    const r = m.relationships[0];
    r.navigable = 'to';            // стрелка у семантического конца «from»
    r.fromAggregation = 'shared';  // и ромб там же — UML требует оба
  });
  U.renderCanvas();
  let h = headsOf(l1.id);
  A('Д1: ромб и стрелка стоят на одном конце одновременно',
    h && h.tri === 1 && h.open === 1 && h.triX < 300 && h.openX < 300,
    h ? 'ромбов ' + h.tri + ' (x=' + h.triX + '), стрелок ' + h.open + ' (x=' + h.openX + ')' : 'нет связи');

  // Ромб занимает первые 8 px от фигуры: стрелка начинается там, где он
  // кончился, а не поверх него.
  A('Д1: стрелка сдвинута за ромб, а не лежит на нём',
    h && h.openX >= h.triBaseX - 0.5 && h.openX > h.triX + 4,
    h ? 'остриё ромба ' + h.triX + ', его основание ' + h.triBaseX + ', остриё стрелки ' + h.openX : '—');

  // Независимость концов: ромб на «to» появляется и снимается, «from» цел.
  U.commit('t', (m) => { m.relationships[0].toAggregation = 'composite'; });
  U.renderCanvas();
  const both = headsOf(l1.id);
  U.commit('t', (m) => { m.relationships[0].toAggregation = 'none'; });
  U.renderCanvas();
  const one = headsOf(l1.id);
  A('Д1: ромб снимается с одного конца, не трогая другой',
    both && both.fill === 1 && both.tri === 1 && one && one.fill === 0 && one.tri === 1,
    'было ' + JSON.stringify(both) + ', стало ' + JSON.stringify(one));

  // Концы без маркеров: связь — просто линия.
  U.commit('t', (m) => {
    const r = m.relationships[0];
    r.navigable = 'none'; r.fromAggregation = 'none';
  });
  U.renderCanvas();
  const bare = headsOf(l1.id);
  A('Д1: линия без единого маркера возможна',
    bare && bare.tri === 0 && bare.fill === 0 && bare.open === 0,
    JSON.stringify(bare));

  // Ромб на СЕМАНТИЧЕСКОМ конце: связь A→B нарисована «от B к A».
  U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    d.links = [];
    const rel = m.relationships[0];
    rel.fromAggregation = 'shared';
    rel.navigable = 'none';
    d.links.push(U.createLink(rel,
      { shapeId: b1.shape.id, side: 'left', t: 0.5 },
      { shapeId: a1.shape.id, side: 'right', t: 0.5 }));
  });
  U.renderCanvas();
  const revLink = U.currentDiagram(U.store.model).links[0];
  const rev = headsOf(revLink.id);
  A('Д1: ромб остаётся на конце, заданном моделью, хотя линию тянули обратно',
    rev && rev.tri === 1 && rev.triX < 300,
    rev ? 'ромб x=' + rev.triX + ' (A до 270, B от 420)' : '—');

  /* ================= (2) Д2: цель — самая глубокая фигура ============ */
  blank(); addDiagram('class', 'D2');
  const pkg = placeBox('package', 100, 100, 420, 320);
  const inner = placeBox('class', 160, 160, 190, 170);
  const outside = placeBox('class', 620, 120, 190, 140);
  U.renderCanvas();
  const tClass = U.targetAt({ x: 200, y: 200 });
  A('Д2: под курсором внутри рамки цель — класс, а не рамка',
    tClass && tClass.id === inner.shape.id,
    tClass ? 'цель ' + tClass.id + ' (класс ' + inner.shape.id + ', рамка ' + pkg.shape.id + ')' : 'нет цели');
  const tFrame = U.targetAt({ x: 480, y: 390 });
  A('Д2: пустая область рамки даёт рамку',
    tFrame && tFrame.id === pkg.shape.id,
    tFrame ? 'цель ' + tFrame.id : 'нет цели');
  const note = placeBox('note', 400, 140, 80, 60);
  const tNote = U.targetAt({ x: 440, y: 170 });
  A('Д2: примечание не цель — берётся его рамка',
    tNote && tNote.id === pkg.shape.id,
    tNote ? 'цель ' + tNote.id + ' (примечание ' + note.shape.id + ')' : 'нет цели');
  const over = placeBox('class', 240, 250, 190, 170);
  const tTop = U.targetAt({ x: 300, y: 280 });
  A('Д2: при перекрытии побеждает верхняя по z',
    tTop && tTop.id === over.shape.id,
    tTop ? 'цель ' + tTop.id + ' (верхняя ' + over.shape.id + ')' : 'нет цели');

  // Тот же выбор — в настоящем жесте: тянем связь от класса снаружи внутрь рамки.
  U.commit('t', (m) => { m.relationships = []; U.currentDiagram(m).links = []; });
  U.set({ tool: 'association', selection: [] });
  U.renderCanvas();
  fire(shapeEl(outside.shape.id), 'pointerdown', 700, 160);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 200, 220);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 200, 220);
  await settle();
  const drawnTo = U.currentDiagram(U.store.model).links.at(-1)?.to?.shapeId;
  A('Д2: протянутая связь подключается к классу внутри рамки',
    drawnTo === inner.shape.id,
    'конец ' + drawnTo + ' (класс ' + inner.shape.id + ')');

  /* ================= (3) концы как доля + смещение =================== */
  const pt = geo.attachPoint({ x: 300, y: 40 }, { w: 100, h: 60 }, { fx: 0.25, fy: 0.5 });
  A('концы: доля считается от рамки фигуры',
    pt.x === 325 && pt.y === 70, '(' + pt.x + ', ' + pt.y + ')');
  const outsidePt = geo.attachPoint({ x: 300, y: 40 }, { w: 100, h: 60 }, { fx: -0.2, fy: 0.5 });
  A('концы: значения вне 0…1 не обрезаются',
    outsidePt.x === 280, 'x=' + outsidePt.x);
  const proj = geo.attachPoint({ x: 300, y: 40 }, { w: 100, h: 60 }, { fx: 0.25, fy: 0.5, project: true });
  A('концы: project ставит точку на границу по лучу из центра',
    proj.x === 300 && proj.y === 70, '(' + proj.x + ', ' + proj.y + ')');
  const off = geo.attachPoint({ x: 300, y: 40 }, { w: 100, h: 60 }, { fx: 0, fy: 0.5, dy: 10 });
  A('концы: смещение в пикселях добавляется после доли',
    off.x === 300 && off.y === 80, '(' + off.x + ', ' + off.y + ')');

  blank(); addDiagram('class', 'D3');
  const a3 = placeBox('class', 80, 80, 190, 170);
  const b3 = placeBox('class', 420, 80, 190, 170);
  const l3 = join('association', a3, b3);
  const attachText = (() => {
    U.commit('t', (m) => {
      const l = U.currentDiagram(m).links[0];
      l.from.attach = { fx: -0.2, fy: 0.25, dx: 3, dy: -4 };
      l.to.attach = { fx: 0.25, fy: 0.5, project: true };
    });
    return U.serialize(U.store.model);
  })();
  const back3 = U.deserialize(attachText);
  const back3Text = U.serialize(back3);
  // Читаем ИМЕННО текущую диаграмму: у модели всегда есть хотя бы одна, а
  // рабочая может быть любой из них.
  const curOf = (m) => (m.diagrams.find((d) => d.id === m.currentDiagramId) ?? m.diagrams.at(-1));
  const backLink = curOf(back3).links[0];
  const backEnd = backLink.from.attach;
  A('концы: доля+смещение переживают круг serialize → deserialize → serialize',
    back3Text === attachText && backEnd.fx === -0.2 && backEnd.dy === -4,
    JSON.stringify(backEnd).slice(0, 400) + ' | ' + attachText.slice(0, 300));
  A('концы: отрицательная доля не превращается в 0',
    backLink.to.attach.project === true && backLink.to.attach.fx === 0.25,
    JSON.stringify(backLink.to.attach));

  /* ============ (4) entryPerimeter / noEdgeStyle / arcSize ============ */
  // Сторож на входе: сценарий работает с той моделью, которую сам собрал.
  // Два прогона из общего verify один раз дали здесь «поля не прочитались»,
  // «скругление не то» и обрыв на кривой — при том что рядом стоящая проверка
  // видела тот же лист правильным. Причина НЕ найдена: 20+ одиночных прогонов,
  // три параллельных и прогоны под нагрузкой зелены. Поэтому сторож называет
  // расхождение одной строкой («какая модель на самом деле»), а не даёт каскад
  // из бессмысленных сравнений с чужими данными.
  blank(); addDiagram('class', 'D4');
  const c1 = placeBox('class', 80, 80, 190, 170);
  const c2 = placeBox('class', 420, 300, 190, 170);
  const l4 = join('association', c1, c2);
  const own4 = U.currentDiagram(U.store.model);
  A('поля файла: раздел работает со своей моделью',
    U.store.model.elements.length === 2 && U.store.model.relationships.length === 1
      && own4?.id === U.store.model.currentDiagramId && own4.links.length === 1
      && own4.links[0].id === l4.id,
    'элементов ' + U.store.model.elements.length + ', связей ' + U.store.model.relationships.length
      + ', листов ' + U.store.model.diagrams.length + ', в листе связей ' + (own4?.links.length ?? '—'));
  U.commit('t', (m) => {
    const l = U.currentDiagram(m).links[0];
    l.rounded = 'small';
    l.entryPerimeter = true;
    l.noEdgeStyle = true;
    l.arcSize = 40;
  });
  const f4 = U.serialize(U.store.model);
  const b4 = U.deserialize(f4);
  const l4b = (b4.diagrams.find((d) => d.id === b4.currentDiagramId) ?? b4.diagrams.at(-1)).links[0];
  A('поля файла: entryPerimeter, noEdgeStyle и arcSize читаются и пишутся',
    l4b.entryPerimeter === true && l4b.noEdgeStyle === true && l4b.arcSize === 40
      && U.serialize(b4) === f4,
    'entryPerimeter=' + l4b.entryPerimeter + ', noEdgeStyle=' + l4b.noEdgeStyle + ', arcSize=' + l4b.arcSize);
  U.renderCanvas();
  A('поля файла: noEdgeStyle рисует прямую через waypoints, без локтя',
    (dOf(l4.id).match(/L/g) ?? []).length === 1,
    dOf(l4.id));

  // Радиус виден на листе: угол из одного излома, длинные ноги.
  const l4b2 = U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    const link = U.createLink(m.relationships[0],
      { shapeId: c1.shape.id, side: 'right', t: 0.5 },
      { shapeId: c2.shape.id, side: 'top', t: 0.5 });
    link.waypoints = [[515, 165]];
    link.rounded = 'small';
    d.links.push(link);
    return link;
  });
  U.renderCanvas();
  const arcC = dOf(l4b2.id);
  U.commit('t', (m) => { U.currentDiagram(m).links.at(-1).arcSize = 40; });
  U.renderCanvas();
  const arc40 = dOf(l4b2.id);
  // Rounded styles are not arcs in the original: the corner is cut 7 px back
  // along both legs and a cubic runs through the corner itself
  // (v/cct/es#a(D)+0x00b1…+0x01a6, MECHANICS §27b).
  const corner = arcC.match(/L ([\d.-]+) ([\d.-]+) C [\d.-]+ [\d.-]+ 515 165 ([\d.-]+) ([\d.-]+)/);
  A('скругление: срез 7 px и кубика через угол — числа оригинала',
    Boolean(corner) && !/\sA\s/.test(arcC)
      && Math.abs(Math.hypot(515 - Number(corner[1]), 165 - Number(corner[2])) - 7) < 0.01
      && Math.abs(Math.hypot(Number(corner[3]) - 515, Number(corner[4]) - 165) - 7) < 0.01,
    arcC.slice(0, 160));
  A('arcSize (радиус draw.io) по-прежнему даёт дугу поверх rounded',
    arc40.includes('A 40 40'),
    'с 40: ' + arc40.slice(0, 90));

  /* =============== (7) curve — сплайн оригинала, а не цепочка Q ======= */
  // Стиль связи 2 (Curve) в оригинале — не «Q через изломы»: маршрут идёт по
  // НАТУРАЛЬНОМУ кубическому сплайну через те же точки (концы + waypoints),
  // параметр — длина хорды, отсэмплировано 161 раз с шагом 1/160 и нарисовано
  // ломаной по этим точкам (v/cct/ba#l(), v/cdi/g, v/cdi/f — MECHANICS §27a).
  // Ниже — сверка с числами, снятыми с самих классов оригинала, и проверка,
  // что лист и экспорт рисуют одну и ту же строку.
  const LAY = (s) => geo.layoutOf(s, U.store.model.elements.find((e) => e.id === s.elementId));
  blank(); addDiagram('class', 'D9');
  U.set({ tool: 'select', selection: [] });
  const k1 = placeBox('class', 80, 80, 190, 170);
  const k2 = placeBox('class', 420, 260, 190, 170);
  const lc = join('association', k1, k2);
  // Читаем «d» после кадра, а не сразу: перерисовка листа идёт через
  // rafThrottle («paintSoon» в canvas.js), и под нагрузкой синхронное чтение
  // успевало взять ещё не перерисованный DOM. Два таких прогона дали пустой
  // «d» и оборвали сценарий исключением на 24-й и 26-й проверке — отсюда и
  // settle(), и повтор, если связи на листе ещё нет.
  const curveOn = async (wp) => {
    U.commit('t', (m) => {
      const l = U.currentDiagram(m).links[0];
      l.style = 2;                 // Curve
      delete l.route;
      delete l.rounded;
      delete l.arcSize;
      if (wp) l.waypoints = wp; else delete l.waypoints;
    });
    U.renderCanvas();
    if (!dOf(lc.id)) await settle();
    return dOf(lc.id);
  };
  const nums = (d) => d.split(' ').filter((t) => t !== 'M' && t !== 'L' && t !== 'C')
    .map(Number).reduce((acc, v, i, arr) => (i % 2 ? acc : [...acc, [v, arr[i + 1]]]), []);

  const dStraight = await curveOn(null);
  A('curve: две точки — прямая, без сплайна',
    !dStraight.includes('Q') && (dStraight.match(/L/g) ?? []).length === 1,
    dStraight);

  const k1s = U.currentDiagram(U.store.model).shapes.find((s) => s.id === k1.shape.id);
  const k2s = U.currentDiagram(U.store.model).shapes.find((s) => s.id === k2.shape.id);
  const cEnd = {
    from: geo.endPoint(k1s, LAY(k1s), { side: 'right', t: 0.5 }),
    to: geo.endPoint(k2s, LAY(k2s), { side: 'left', t: 0.5 }),
  };
  const d3 = await curveOn([[345, 120]]);
  const p3 = nums(d3);
  // Тот же сторож, что и в разделе полей: кривая сверяется с моделью, которую
  // собрал этот раздел (две фигуры, одна связь), а не с тем, что оказалось на
  // листе к моменту чтения.
  const own9 = U.currentDiagram(U.store.model);
  A('curve: раздел работает со своей моделью',
    U.store.model.elements.length === 2 && own9?.links.length === 1 && own9.links[0].id === lc.id,
    'элементов ' + U.store.model.elements.length + ', в листе связей ' + (own9?.links.length ?? '—'));
  A('curve: три точки — 161 отсчёт (160 L) и ни одного Q/A',
    d3.startsWith('M ') && (d3.match(/ L /g) ?? []).length === 160
      && !d3.includes(' Q ') && !/\sA\s/.test(d3),
    (d3.match(/ L /g) ?? []).length + ' L, ' + d3.slice(0, 70));
  // Пустой «d» — это не «кривая не та», а «связь не нарисована»: без этой
  // развилки p3[0] бросал исключение и обрывал весь сценарий на 24-й
  // проверке из 79 (так один раз и случилось в общем прогоне). Причина тогда
  // не нашлась, но отчёт обязан назвать её, а не «сценарий прерван».
  A('curve: связь нарисована, есть что сверять', p3.length >= 2,
    d3 ? 'точек ' + p3.length : 'd пустой: path.conn у связи ' + lc.id + ' не найден');
  A('curve: начинается и кончается в концах связи',
    p3.length >= 2
      && p3[0][0] === cEnd.from.x && p3[0][1] === cEnd.from.y
      && p3.at(-1)[0] === cEnd.to.x && p3.at(-1)[1] === cEnd.to.y,
    (p3.length >= 2 ? JSON.stringify([p3[0], p3.at(-1)]) : 'точек нет')
      + ' | концы ' + JSON.stringify(cEnd));
  // Излом — узел сплайна: он стоит на кривой в своей доле хорды. Между двумя
  // отсчётами кривая почти прямая, поэтому линейная вставка даёт узел с
  // точностью до тысячных.
  const cA = Math.hypot(345 - cEnd.from.x, 120 - cEnd.from.y);
  const cB = Math.hypot(cEnd.to.x - 345, cEnd.to.y - 120);
  const knotT = cA / (cA + cB);
  const ki = Math.floor(knotT / 0.00625);
  const kf = knotT / 0.00625 - ki;
  // Сверять узел не с чем, если кривой нет: пусть это будет красная строка с
  // причиной, а не исключение, обрывающее остальные 55 проверок набора.
  const knotPt = p3.length > ki + 1
    ? [p3[ki][0] + (p3[ki + 1][0] - p3[ki][0]) * kf,
      p3[ki][1] + (p3[ki + 1][1] - p3[ki][1]) * kf]
    : null;
  A('curve: излом маршрута лежит на кривой (t = его доля хорды)',
    !!knotPt && Math.abs(knotPt[0] - 345) < 0.02 && Math.abs(knotPt[1] - 120) < 0.02,
    knotPt ? JSON.stringify(knotPt) + ' при t=' + knotT.toFixed(4) + ' (узел ' + ki + ')'
      : 'отсчётов ' + p3.length + ', узел ' + ki + ' сверить не с чем');

  // Числа самого оригинала: v/cdi/g + v/cdi/f, прогнанные на трёх точках
  // (0,0) (60,80) (160,80). Сняты Java-прогоном; допуск — только округление.
  const jref = geo.curveSamples([[0, 0], [60, 80], [160, 80]]);
  A('curve: отсчёты совпадают с классами оригинала — 0.62502 и 1.24996',
    jref.length === 161
      && Math.abs(jref[1][0] - 0.6250195313) < 1e-9
      && Math.abs(jref[1][1] - 1.2499609375) < 1e-9
      && Math.abs(jref[80][0] - 60) < 1e-9 && Math.abs(jref[80][1] - 80) < 1e-9
      && Math.abs(jref[160][0] - 160) < 1e-9 && Math.abs(jref[160][1] - 80) < 1e-9,
    JSON.stringify([jref[1], jref[80], jref[160]]));

  const d4 = await curveOn([[345, 120], [560, 120]]);
  const p4 = nums(d4);
  // Узел k стоит на кривой при t = накопленная длина хорды / вся длина; между
  // соседними отсчётами кривая практически прямая, поэтому вставка точна.
  const knotPos = (path, routePts, k) => {
    const len = [];
    let total = 0;
    for (let i = 1; i < routePts.length; i += 1) {
      const l = Math.hypot(routePts[i][0] - routePts[i - 1][0], routePts[i][1] - routePts[i - 1][1]);
      len.push(l);
      total += l;
    }
    const t = len.slice(0, k).reduce((a, b) => a + b, 0) / total;
    const i = Math.min(Math.floor(t / 0.00625), path.length - 2);
    const f = t / 0.00625 - i;
    return [path[i][0] + (path[i + 1][0] - path[i][0]) * f,
      path[i][1] + (path[i + 1][1] - path[i][1]) * f];
  };
  const route4 = [[cEnd.from.x, cEnd.from.y], [345, 120], [560, 120], [cEnd.to.x, cEnd.to.y]];
  // Та же развилка, что и у узла выше: короткий p4 — это «кривой нет», и
  // сказать об этом надо строкой отчёта, а не исключением на полнабора.
  const w1 = p4.length >= 2 ? knotPos(p4, route4, 1) : null;
  const w2 = p4.length >= 2 ? knotPos(p4, route4, 2) : null;
  A('curve: waypoints — узлы сплайна, оба излома лежат на кривой',
    (d4.match(/ L /g) ?? []).length === 160 && !!w1 && !!w2
      && Math.abs(w1[0] - 345) < 0.02 && Math.abs(w1[1] - 120) < 0.02
      && Math.abs(w2[0] - 560) < 0.02 && Math.abs(w2[1] - 120) < 0.02,
    (w1 && w2 ? JSON.stringify([w1, w2]) : 'отсчётов ' + p4.length)
      + ' | ' + d4.slice(0, 70));

  // Скругление — про углы ломаной; у кривой углов нет, поэтому ни rounded,
  // ни arcSize не должны ни изменить строку, ни добавить C/A.
  U.commit('t', (m) => { const l = U.currentDiagram(m).links[0]; l.rounded = 'large'; l.arcSize = 40; });
  U.renderCanvas();
  const dRounded = dOf(lc.id);
  A('curve: rounded и arcSize к кривой не применяются',
    !/(^|\s)A\s/.test(dRounded) && !dRounded.includes(' C ') && dRounded === d4, dRounded.slice(0, 120));

  // Один и тот же pathD рисует лист и экспорт: строки обязаны совпасть.
  const svgOut = U.exportSvgString(U.store.model);
  const svgD = (svgOut.match(/class="conn" d="([^"]*)"/) ?? [])[1];
  A('curve: экспорт SVG даёт тот же d, что на листе',
    Boolean(svgD) && svgD === dRounded, 'лист ' + dRounded.slice(0, 60) + '… | экспорт ' + String(svgD).slice(0, 60) + '…');

  // Наконечник: остриё — в конце маршрута, ось — по последнему нарисованному
  // участку пути (для кривой это последняя хорда сплайна).
  U.commit('t', (m) => { m.relationships[0].navigable = 'both'; });
  U.renderCanvas();
  const headAtTo = [...linkEl(lc.id).querySelectorAll('.head-open')]
    .map((n) => numsOf(n))
    .map((v) => ({ tip: [v[2], v[3]], base: [(v[0] + v[4]) / 2, (v[1] + v[5]) / 2] }))
    .sort((a, b) => Math.hypot(a.tip[0] - cEnd.to.x, a.tip[1] - cEnd.to.y)
      - Math.hypot(b.tip[0] - cEnd.to.x, b.tip[1] - cEnd.to.y))[0];
  const tipH = headAtTo.tip;
  const baseMid = headAtTo.base;
  const pn = nums(dRounded);
  const tan = [pn.at(-1)[0] - pn.at(-2)[0], pn.at(-1)[1] - pn.at(-2)[1]];
  const axis = [tipH[0] - baseMid[0], tipH[1] - baseMid[1]];
  const cos = (axis[0] * tan[0] + axis[1] * tan[1])
    / (Math.hypot(...axis) * Math.hypot(...tan));
  A('curve: наконечник стоит в конце и по касательной, не оторван',
    Math.abs(tipH[0] - cEnd.to.x) < 0.01 && Math.abs(tipH[1] - cEnd.to.y) < 0.01 && cos > 0.999,
    'остриё ' + JSON.stringify(tipH) + ', конец ' + JSON.stringify(cEnd.to)
      + ', cos ' + cos.toFixed(4));

  /* ========== (8) привязка долей — из инспектора, а не из файла ====== */
  // Панель свойств строится на выделении, поэтому сценарий идёт так же, как
  // у человека: выделить связь, выбрать «к точке», вписать доли.
  blank(); addDiagram('class', 'D10');
  U.set({ tool: 'select', selection: [] });
  const m1 = placeBox('class', 80, 80, 190, 170);
  const m2 = placeBox('class', 420, 80, 190, 170);
  const lm = join('association', m1, m2);
  U.set({ selection: [{ kind: 'connector', id: lm.id }] });
  await settle();

  const modeFrom = () => document.querySelector('#props select[aria-label="источник: привязка конца"]');
  A('доли: в инспекторе есть переключатель привязки у каждого конца',
    Boolean(modeFrom()) && Boolean(document.querySelector('#props select[aria-label="цель: привязка конца"]')),
    modeFrom() ? 'значение «' + modeFrom().value + '»' : 'нет селекта');

  const sideBefore = geo.endPoint(
    U.currentDiagram(U.store.model).shapes.find((s) => s.id === m1.shape.id),
    LAY(U.currentDiagram(U.store.model).shapes.find((s) => s.id === m1.shape.id)),
    U.currentDiagram(U.store.model).links[0].from,
  );
  modeFrom().value = 'point';
  modeFrom().dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const attachA = U.currentDiagram(U.store.model).links[0].from.attach;
  const pointAfter = geo.endPoint(
    U.currentDiagram(U.store.model).shapes.find((s) => s.id === m1.shape.id),
    LAY(U.currentDiagram(U.store.model).shapes.find((s) => s.id === m1.shape.id)),
    U.currentDiagram(U.store.model).links[0].from,
  );
  A('доли: «к точке» даёт attach из текущей точки, конец не прыгает',
    attachA && attachA.fx === 1 && attachA.fy === 0.5
      && Math.abs(pointAfter.x - sideBefore.x) < 0.01 && Math.abs(pointAfter.y - sideBefore.y) < 0.01,
    JSON.stringify(attachA) + ' | было ' + JSON.stringify(sideBefore) + ', стало ' + JSON.stringify(pointAfter));

  const fxIn = document.querySelector('#props input[aria-label="источник: доля по ширине"]');
  const dyIn = document.querySelector('#props input[aria-label="источник: смещение по y"]');
  fxIn.value = '-0.2';
  fxIn.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const dyIn2 = document.querySelector('#props input[aria-label="источник: смещение по y"]');
  dyIn2.value = '5';
  dyIn2.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const projBox = document.querySelector('#props input[aria-label="источник: по границе"]');
  projBox.checked = true;
  projBox.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();

  const linkNow = U.currentDiagram(U.store.model).links[0];
  const shpNow = U.currentDiagram(U.store.model).shapes.find((s) => s.id === m1.shape.id);
  const expectEnd = geo.endPoint(shpNow, LAY(shpNow), linkNow.from);
  const handle = document.querySelector('#canvas [data-kind="end"][data-end="from"]');
  const hx = Number(handle.getAttribute('x')) + Number(handle.getAttribute('width')) / 2;
  const hy = Number(handle.getAttribute('y')) + Number(handle.getAttribute('height')) / 2;
  A('доли: заданная точка переехала на лист в ожидаемое место',
    Math.abs(hx - expectEnd.x) < 0.01 && Math.abs(hy - expectEnd.y) < 0.01
      && Math.abs(expectEnd.x - 80) < 0.01,
    'конец на листе (' + hx + ', ' + hy + '), ожидали (' + expectEnd.x + ', ' + expectEnd.y + ')'
      + ', attach ' + JSON.stringify(linkNow.from.attach));

  const bytes1 = U.serialize(U.store.model);
  const backA = U.deserialize(bytes1);
  const backLinkA = (backA.diagrams.find((d) => d.id === backA.currentDiagramId) ?? backA.diagrams.at(-1)).links[0];
  A('доли: круг serialize → deserialize → serialize байт в байт',
    U.serialize(backA) === bytes1 && backLinkA.from.attach.fx === -0.2
      && backLinkA.from.attach.dy === 5 && backLinkA.from.attach.project === true,
    JSON.stringify(backLinkA.from.attach));

  const sideSel = () => document.querySelector('#props select[aria-label="источник: привязка конца"]');
  sideSel().value = 'side';
  sideSel().dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const savedSide = JSON.parse(U.serialize(U.store.model));
  const savedLinkSide = (savedSide.diagrams.find((d) => d.id === savedSide.currentDiagramId) ?? savedSide.diagrams.at(-1)).links[0];
  A('доли: «к стороне» удаляет attach целиком, а не обнуляет',
    !('attach' in savedLinkSide.from) && savedLinkSide.from.side === 'right'
      && !('fx' in savedLinkSide.from) && !('project' in savedLinkSide.from),
    JSON.stringify(savedLinkSide.from));

  /* ================== (9) подсветка кандидата-цели =================== */
  blank(); addDiagram('class', 'D11');
  U.set({ tool: 'select', selection: [] });
  const fPkg = placeBox('package', 100, 100, 420, 320);
  const fIn = placeBox('class', 160, 160, 190, 170);
  const fOut = placeBox('class', 620, 120, 190, 140);
  U.renderCanvas();
  const dropEl = () => document.querySelector('#canvas .drop-target');

  U.set({ tool: 'association', selection: [] });
  U.renderCanvas();
  const undoBeforeDrop = U.store._undo.length;
  const fileBeforeDrop = U.serialize(U.store.model);
  fire(shapeEl(fOut.shape.id), 'pointerdown', 700, 160);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 200, 220);
  await settle();
  const tInner = U.targetAt({ x: 200, y: 220 });
  const dt = dropEl();
  A('подсветка: при протягивании обведена ровно цель targetAt',
    tInner && dt && dt.getAttribute('data-drop-target') === tInner.id
      && Number(dt.getAttribute('x')) === fIn.shape.x
      && Number(dt.getAttribute('y')) === fIn.shape.y,
    dt ? 'data-drop-target ' + dt.getAttribute('data-drop-target') + ' (targetAt ' + tInner?.id + ')'
      + ' рамка ' + dt.getAttribute('x') + ',' + dt.getAttribute('y') : 'нет .drop-target');
  A('подсветка: в модель и в файл ничего не попало',
    U.serialize(U.store.model) === fileBeforeDrop && U.store._undo.length === undoBeforeDrop,
    'undo ' + undoBeforeDrop + ' → ' + U.store._undo.length);

  fire(document.getElementById('canvas'), 'pointermove', 480, 390);
  await settle();
  const tPkg = U.targetAt({ x: 480, y: 390 });
  const dtFrame = dropEl();
  A('подсветка: пустая область рамки подсвечивает рамку',
    tPkg && dtFrame && dtFrame.getAttribute('data-drop-target') === tPkg.id
      && tPkg.id === fPkg.shape.id,
    dtFrame ? 'подсвечено ' + dtFrame.getAttribute('data-drop-target') + ', targetAt ' + tPkg?.id : 'нет подсветки');

  fire(document.getElementById('canvas'), 'pointermove', 900, 620);
  await settle();
  A('подсветка: нет цели — нет подсветки', !dropEl(), dropEl() ? 'рамка осталась' : 'чисто');

  fire(document.getElementById('canvas'), 'pointermove', 200, 220);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 200, 220);
  await settle();
  const createdDrop = U.currentDiagram(U.store.model).links.at(-1);
  A('подсветка: после pointerup рамка снята, связь подключена к цели',
    !dropEl() && createdDrop?.to?.shapeId === fIn.shape.id,
    dropEl() ? 'рамка осталась' : ('цель ' + createdDrop?.to?.shapeId));

  // Перетаскивание КОНЦА: тот же targetAt, тот же класс подсветки. Конец с
  // attach при переносе возвращается к стороне — иначе в модели остались бы
  // две правды об одном конце.
  blank(); addDiagram('class', 'D12');
  U.set({ tool: 'select', selection: [] });
  const g1 = placeBox('class', 80, 80, 190, 170);
  const g2 = placeBox('class', 620, 300, 190, 140);
  const g3 = placeBox('class', 420, 300, 190, 140);
  const gl = join('association', g1, g2);
  U.commit('t', (m) => { U.currentDiagram(m).links[0].to.attach = { fx: 0.25, fy: 0.5 }; });
  U.set({ selection: [{ kind: 'connector', id: gl.id }] });
  U.renderCanvas();
  const endHandle = () => {
    const n = document.querySelector('#canvas [data-kind="end"][data-end="to"]');
    return { x: Number(n.getAttribute('x')) + Number(n.getAttribute('width')) / 2,
      y: Number(n.getAttribute('y')) + Number(n.getAttribute('height')) / 2 };
  };
  const p0 = endHandle();
  fire(document.querySelector('#canvas [data-kind="end"][data-end="to"]'), 'pointerdown', p0.x, p0.y);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 500, 370);
  await settle();
  const dtEnd = dropEl();
  A('подсветка: перетаскивание конца тоже показывает цель',
    dtEnd && dtEnd.getAttribute('data-drop-target') === g3.shape.id,
    dtEnd ? 'подсвечено ' + dtEnd.getAttribute('data-drop-target') + ' (ожидали ' + g3.shape.id + ')' : 'нет подсветки');
  document.getElementById('canvas').dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 1,
    clientX: 0, clientY: 0,
  }));
  await settle();
  A('подсветка: pointercancel снимает рамку', !dropEl(),
    dropEl() ? 'рамка осталась' : 'рамка снята');

  // Теперь с отпусканием: привязка к точке снимается, конец получает side+t.
  U.commit('t', (m) => { U.currentDiagram(m).links[0].to.attach = { fx: 0.25, fy: 0.5 }; });
  U.set({ selection: [{ kind: 'connector', id: gl.id }] });
  U.renderCanvas();
  const p1 = endHandle();
  const undoBeforeEnd = U.store._undo.length;
  fire(document.querySelector('#canvas [data-kind="end"][data-end="to"]'), 'pointerdown', p1.x, p1.y);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 700, 370);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 700, 370);
  await settle();
  const endAfterDrag = U.currentDiagram(U.store.model).links[0].to;
  A('перетаскивание конца снимает attach и ставит side+t',
    endAfterDrag.shapeId === g2.shape.id && !('attach' in endAfterDrag)
      && typeof endAfterDrag.side === 'string' && Number.isFinite(endAfterDrag.t)
      && U.store._undo.length === undoBeforeEnd + 1,
    JSON.stringify(endAfterDrag) + ', undo ' + undoBeforeEnd + ' → ' + U.store._undo.length);

  /* ================== (5) Д3: перетаскивание сегмента ================ */
  blank(); addDiagram('class', 'D5');
  U.set({ tool: 'select', selection: [] });
  const s1 = placeBox('class', 40, 40, 80, 40);
  const s2 = placeBox('class', 520, 300, 80, 40);
  const l5 = join('association', s1, s2);
  U.commit('t', (m) => {
    U.currentDiagram(m).links[0].waypoints = [[240, 60], [240, 400], [520, 400]];
  });
  U.renderCanvas();

  const hit5 = () => linkEl(l5.id).querySelector('.conn-hit');
  const vHit = (x, y) => {
    const el = linkEl(l5.id).querySelector('.conn-hit');
    const p = screenOf(x, y);
    const ev = new PointerEvent('pointermove', { bubbles: true, clientX: p.clientX, clientY: p.clientY, pointerId: 1 });
    el.dispatchEvent(ev);
    return el.style.cursor;
  };
  const horizontalCursor = vHit(380, 400);
  const verticalCursor = vHit(240, 200);
  A('Д3: курсор над горизонтальным сегментом — row-resize',
    horizontalCursor === 'row-resize', 'получено «' + horizontalCursor + '»');
  A('Д3: курсор над вертикальным сегментом — col-resize',
    verticalCursor === 'col-resize', 'получено «' + verticalCursor + '»');

  const undoBefore = U.store._undo.length;
  fire(hit5(), 'pointerdown', 380, 400);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 380, 430);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 380, 430);
  await settle();
  const w5 = U.currentDiagram(U.store.model).links[0].waypoints;
  A('Д3: сегмент сдвигает ДВЕ точки и новых не создаёт',
    w5.length === 3 && w5[0][0] === 240 && w5[0][1] === 60
      && w5[1][0] === 240 && w5[1][1] === 430
      && w5[2][0] === 520 && w5[2][1] === 430,
    JSON.stringify(w5));
  A('Д3: один жест — одна запись отмены',
    U.store._undo.length === undoBefore + 1,
    'записей ' + undoBefore + ' → ' + U.store._undo.length);
  U.undo();
  U.renderCanvas();
  const w5back = U.currentDiagram(U.store.model).links[0].waypoints;
  A('Д3: отмена возвращает обе точки разом',
    w5back.length === 3 && w5back[1][1] === 400 && w5back[2][1] === 400,
    JSON.stringify(w5back));

  // Связь без waypoints: жест создаёт ДВЕ точки — по одной на каждом конце
  // сегмента, — и дальше двигает их вместе. Прямой сегмент между двумя
  // обращёнными сторонами: ровно две точки маршрута.
  blank(); addDiagram('class', 'D6');
  U.set({ tool: 'select', selection: [] });
  const q1 = placeBox('class', 80, 80, 190, 170);
  const q2 = placeBox('class', 420, 80, 190, 170);
  const l6 = join('association', q1, q2);
  U.renderCanvas();
  const before6 = U.currentDiagram(U.store.model).links[0].waypoints;
  fire(linkEl(l6.id).querySelector('.conn-hit'), 'pointerdown', 345, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 345, 205);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 345, 205);
  await settle();
  const w6 = U.currentDiagram(U.store.model).links[0].waypoints;
  A('Д3: на связи без waypoints появляются две точки, и обе едут',
    !before6 && Array.isArray(w6) && w6.length === 2
      && w6[0][0] === 270 && w6[1][0] === 420
      && w6[0][1] === 205 && w6[1][1] === 205,
    JSON.stringify(w6));

  // Прямая связь остаётся прежней: жест по сегменту ставит ОДНУ точку.
  blank(); addDiagram('class', 'D7');
  U.set({ tool: 'select', selection: [] });
  const r1 = placeBox('class', 80, 80, 190, 170);
  const r2 = placeBox('class', 420, 80, 190, 170);
  const l7 = join('association', r1, r2);
  U.commit('t', (m) => { U.currentDiagram(m).links[0].route = 'direct'; });
  U.renderCanvas();
  fire(linkEl(l7.id).querySelector('.conn-hit'), 'pointerdown', 345, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 345, 200);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 345, 200);
  await settle();
  const w7 = U.currentDiagram(U.store.model).links[0].waypoints;
  A('Д3: у прямой связи жест по сегменту ставит одну точку — как в draw.io',
    Array.isArray(w7) && w7.length === 1,
    JSON.stringify(w7));

  /* ============ (6) скачки на пересечениях, §26 ====================== */
  // Две связи, одна горизонтальная, вторая вертикальная: точка пересечения
  // попадает внутрь обоих сегментов, а не на их концы.
  blank(); addDiagram('class', 'D8');
  U.set({ tool: 'select', selection: [] });
  const j1 = placeBox('class', 40, 100, 80, 40);
  const j2 = placeBox('class', 400, 100, 80, 40);
  const j3 = placeBox('class', 240, 0, 80, 40);
  const j4 = placeBox('class', 240, 300, 80, 40);
  const lh = join('association', j1, j2);
  const lv = join('association', j3, j4);
  U.commit('t', (m) => {
    const ls = U.currentDiagram(m).links;
    ls[1].waypoints = [[280, 20], [280, 320]];
    ls[1].noEdgeStyle = true;
  });
  U.renderCanvas();
  const dPlain = dOf(lh.id);
  const dOther = dOf(lv.id);
  A('скачок: без кода линия остаётся прямой',
    !dPlain.includes(' Q ') && dPlain.split('M').length === 2, dPlain);
  A('скачок: вторая линия без своего кода не прыгает',
    !dOther.includes(' Q ') && !dOther.includes('M 280 20 M'), dOther);

  const setJump = (code, size) => {
    U.commit('t', (m) => {
      const l = U.currentDiagram(m).links[0];
      if (code == null) delete l.lineJumps; else l.lineJumps = code;
      if (size == null) delete l.lineJumpsSize; else l.lineJumpsSize = size;
    });
    U.renderCanvas();
    return dOf(lh.id);
  };
  const dArc = setJump(1);
  A('скачок: дуга рисуется над точкой пересечения', dArc.includes(' Q '), dArc);
  const dGap = setJump(2);
  A('скачок: разрыв делит путь на два подпути',
    (dGap.match(/M /g) || []).length === 2, dGap);
  const dSquare = setJump(3);
  // Подход к скачку, три отрезка ступеньки (вверх, вдоль, вниз) и остаток
  // сегмента — на четыре L больше, чем у прямой.
  A('скачок: квадрат — ступенька из трёх отрезков',
    (dSquare.match(/L /g) || []).length === (dPlain.match(/L /g) || []).length + 4, dSquare);
  const dBig = setJump(1, 2);
  // Вершина дуги — контрольная точка Q: у большего кода она выше (меньше y).
  const apex = (d) => Math.min(...(d.match(/Q -?[\d.]+ (-?[\d.]+)/g) || [])
    .map((q) => Number(q.split(' ')[2])));
  A('скачок: размер 2 поднимает дугу выше (код размера 0…2)',
    apex(dBig) < apex(dArc), 'вершина 0: ' + apex(dArc) + ' | 2: ' + apex(dBig));

  // Файл: код пишется только отличающимся от «как на диаграмме» (4).
  setJump(1, null);
  const saved = JSON.parse(U.serialize(U.store.model));
  const curId = U.currentDiagram(U.store.model).id;
  const savedDiag = saved.diagrams.find((d) => d.id === curId) || {};
  const savedLink = savedDiag.links?.[0];
  A('скачок: код 1 сохранён в файл', savedLink?.lineJumps === 1,
    'diagrams=' + (saved.diagrams || []).length + ' links=' + (savedDiag.links || []).length
      + ' ' + JSON.stringify(savedLink || null));
  setJump(4, null);
  const saved4 = JSON.parse(U.serialize(U.store.model));
  const curId4 = U.currentDiagram(U.store.model).id;
  const link4 = (saved4.diagrams.find((d) => d.id === curId4)?.links?.[0]) || {};
  A('скачок: «как на диаграмме» в файл не пишется',
    !('lineJumps' in link4), JSON.stringify(link4));
  setJump(1, null);

  /* ============ (10) самосвязь: вид связи решает, жест — порог ======== */
  const relCount = () => U.store.model.relationships.length;
  const hintNow = () => String(U.store.ui.hint || '');
  const resetUi = () => { U.set({ pending: null, tool: 'select', hint: '', selection: [] }); U.renderCanvas(); };

  // Короткий клик инструментом связи петлю не создаёт: иначе обычный клик по
  // фигуре замыкал бы связь на себя вместо ожидания второй цели.
  blank(); addDiagram('class', 'D13');
  const sq1 = placeBox('class', 80, 80, 190, 170);
  U.renderCanvas();
  U.set({ tool: 'association', selection: [] });
  fire(shapeEl(sq1.shape.id), 'pointerdown', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 175, 165);
  await settle();
  A('самосвязь: короткий клик петлю не создаёт',
    relCount() === 0, 'связей ' + relCount() + ', подсказка «' + hintNow() + '»');
  resetUi();

  // Отошёл на 20 px — меньше порога: петли ещё нет.
  U.set({ tool: 'association', selection: [] });
  fire(shapeEl(sq1.shape.id), 'pointerdown', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 60);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 175, 165);
  await settle();
  A('самосвязь: 20 px меньше порога 24 — петли нет',
    relCount() === 0, 'связей ' + relCount() + ', подсказка «' + hintNow() + '»');
  resetUi();

  // Отвёл 50 px от рамки и вернул — жест осознанный, петля создаётся.
  U.set({ tool: 'association', selection: [] });
  fire(shapeEl(sq1.shape.id), 'pointerdown', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 30);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 165);
  await settle();
  const selfHi = document.querySelector('#canvas .drop-target');
  A('самосвязь: после порога исходная фигура подсвечена как цель',
    selfHi && selfHi.getAttribute('data-drop-target') === sq1.shape.id,
    selfHi ? 'подсвечено ' + selfHi.getAttribute('data-drop-target') : 'нет подсветки');
  fire(document.getElementById('canvas'), 'pointerup', 175, 165);
  await settle();
  const selfLink = U.currentDiagram(U.store.model).links.at(-1);
  const selfRel = selfLink && U.store.model.relationships.find((r) => r.id === selfLink.relId);
  const selfPts = (dOf(selfLink?.id) || '').split(/[ML]/).filter((s) => s.trim()).length;
  A('самосвязь: петля ассоциации создана, from и to — одна фигура',
    selfRel && selfRel.kind === 'association'
      && selfLink.from.shapeId === sq1.shape.id && selfLink.to.shapeId === sq1.shape.id,
    selfLink ? selfLink.from.shapeId + ' → ' + selfLink.to.shapeId : 'нет связи');
  A('самосвязь: путь петли — 6 точек', selfPts === 6,
    'точек ' + selfPts + ': ' + dOf(selfLink?.id));
  A('самосвязь: концы на одной стороне разведены не меньше 0.2',
    selfLink && (selfLink.from.side !== selfLink.to.side
      || Math.abs(selfLink.from.t - selfLink.to.t) >= 0.2),
    selfLink ? 'side ' + selfLink.from.side + '/' + selfLink.to.side
      + ', t ' + selfLink.from.t + '/' + selfLink.to.t : '—');
  resetUi();

  // Запрет по виду: обобщение себя — отказ с пунктом §9.9.4.8.
  blank(); addDiagram('class', 'D14');
  const sg1 = placeBox('class', 80, 80, 190, 170);
  U.renderCanvas();
  U.set({ tool: 'generalization', selection: [] });
  fire(shapeEl(sg1.shape.id), 'pointerdown', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 30);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 175, 165);
  await settle();
  A('самосвязь: обобщение себя запрещено, отказ называет §9.9.4.8',
    relCount() === 0 && hintNow().includes('§9.9.4.8') && hintNow().includes('собственным предком'),
    'связей ' + relCount() + ', подсказка «' + hintNow() + '»');
  resetUi();

  // Запрет по виду: включение себя — отказ с пунктом §18.2.5.6.
  blank(); addDiagram('usecase', 'D15');
  const uc1 = placeBox('usecase', 120, 100, 190, 90);
  U.renderCanvas();
  U.set({ tool: 'include', selection: [] });
  fire(shapeEl(uc1.shape.id), 'pointerdown', 215, 145);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 215, 30);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 215, 145);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 215, 145);
  await settle();
  A('самосвязь: включение себя запрещено, отказ называет §18.2.5.6',
    relCount() === 0 && hintNow().includes('§18.2.5.6') && hintNow().includes('включать сам себя'),
    'связей ' + relCount() + ', подсказка «' + hintNow() + '»');
  resetUi();

  // Внутренний переход — «hidden»: связь читается, но на листе её нет.
  A('самосвязь: внутренний переход — hidden, отказ называет §14.2.4.9',
    U.selfRuleOf('association') === 'allowed'
      && U.selfRuleOf('generalization') === 'forbidden'
      && U.selfRuleOfRelationship({ kind: 'transition', internal: true }) === 'hidden'
      && U.selfRefusal('transition', { internal: true }).includes('§14.2.4.9'),
    U.selfRuleOf('association') + ' / ' + U.selfRuleOf('generalization') + ' / '
      + U.selfRuleOfRelationship({ kind: 'transition', internal: true }));

  // hidden на деле: связь с internal: true читается и сохраняется, но на листе
  // её нет — §14.2.4.9 «явно на диаграммах не показываются».
  const hiddenModel = U.deserialize(JSON.stringify({
    schema: 'uml-model/3', name: 'Внутренний переход',
    elements: [{ id: 'e1', kind: 'state', name: 'A' }, { id: 'e2', kind: 'state', name: 'B' }],
    relationships: [{ id: 'r1', kind: 'transition', from: 'e1', to: 'e2', internal: true }],
    diagrams: [{
      id: 'd1', name: 'Состояния', kind: 'state',
      shapes: [
        { id: 's1', elementId: 'e1', x: 80, y: 80, w: 160, h: 90 },
        { id: 's2', elementId: 'e2', x: 400, y: 80, w: 160, h: 90 },
      ],
      links: [{ id: 'l1', relId: 'r1', from: { shapeId: 's1', side: 'right', t: 0.5 }, to: { shapeId: 's2', side: 'left', t: 0.5 } }],
    }],
    currentDiagramId: 'd1',
  }));
  U.loadModel(hiddenModel, 'hidden.uml');
  U.renderCanvas();
  const hiddenDrawn = !!linkEl('l1');
  const hiddenSaved = JSON.parse(U.serialize(U.store.model)).relationships.find((r) => r.id === 'r1');
  A('самосвязь: внутренний переход читается и сохраняется, но не рисуется',
    !hiddenDrawn && hiddenSaved && hiddenSaved.internal === true,
    'на листе ' + (hiddenDrawn ? 'нарисован' : 'нет') + ', в файле internal=' + hiddenSaved?.internal);

  // Чтение не меняется: файл с самогенерализацией читается, правило его ловит.
  const selfGen = U.deserialize(JSON.stringify({
    schema: 'uml-model/3', name: 'Самогенерализация',
    elements: [{ id: 'e1', kind: 'class', name: 'A' }, { id: 'e2', kind: 'class', name: 'B' }],
    relationships: [
      { id: 'r1', kind: 'generalization', from: 'e1', to: 'e1' },
      { id: 'r2', kind: 'generalization', from: 'e1', to: 'e2' },
    ],
    diagrams: [], currentDiagramId: null,
  }));
  const genFound = U.runChecks(selfGen).map((f) => f.ruleId);
  A('самосвязь: файл с самогенерализацией читается, generalization-cycle срабатывает',
    genFound.includes('generalization-cycle'), 'находки: ' + genFound.join(', '));

  // Перетаскивание конца на свою фигуру — без порога: намерение явное.
  blank(); addDiagram('class', 'D16');
  const e1 = placeBox('class', 80, 80, 190, 170);
  const e2 = placeBox('class', 500, 80, 190, 170);
  const l16 = join('association', e1, e2);
  U.set({ selection: [{ kind: 'connector', id: l16.id }] });
  U.renderCanvas();
  const endNode = () => document.querySelector('#canvas [data-kind="end"][data-end="to"]');
  const endX = Number(endNode().getAttribute('x')) + Number(endNode().getAttribute('width')) / 2;
  const endY = Number(endNode().getAttribute('y')) + Number(endNode().getAttribute('height')) / 2;
  fire(endNode(), 'pointerdown', endX, endY);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 175, 165);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 175, 165);
  await settle();
  const endLink = U.currentDiagram(U.store.model).links[0];
  A('самосвязь: конец, возвращённый на свою фигуру, даёт петлю без порога',
    endLink.from.shapeId === e1.shape.id && endLink.to.shapeId === e1.shape.id,
    endLink.from.shapeId + ' → ' + endLink.to.shapeId);

  // Самосообщение: линия жизни, отведено 40 px и возвращено.
  blank(); addDiagram('sequence', 'D17');
  const life = placeBox('lifeline', 200, 60, 120, 260);
  U.renderCanvas();
  U.set({ tool: 'message', selection: [] });
  fire(shapeEl(life.shape.id), 'pointerdown', 260, 120);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 360, 120);
  await settle();
  fire(document.getElementById('canvas'), 'pointermove', 260, 120);
  await settle();
  fire(document.getElementById('canvas'), 'pointerup', 260, 120);
  await settle();
  const msgLink = U.currentDiagram(U.store.model).links.at(-1);
  const msgRel = msgLink && U.store.model.relationships.find((r) => r.id === msgLink.relId);
  A('самосвязь: сообщение от линии жизни к ней же даёт петлю',
    msgRel && msgRel.kind === 'message'
      && msgLink.from.shapeId === life.shape.id && msgLink.to.shapeId === life.shape.id,
    msgLink ? msgRel?.kind + ' ' + msgLink.from.shapeId + ' → ' + msgLink.to.shapeId : 'нет связи');

  /* ========== (18) размер наконечника: код 0…6 из оригинала (§28) ==========
   * Оригинал держит код размера на самом наконечнике (v/cco/a, поле x,
   * заводское 2) и рисует длину k[код]·a, ширину l[код]·b. Проверяем не
   * «поле сохранилось», а ЧТО НАРИСОВАНО: длину и ширину треугольника в
   * точках листа, для кодов 0, 2 и 6, и что умолчание в файл не пишется.
   */
  blank(); addDiagram('class', 'D18');
  const a18 = placeBox('class', 80, 80, 190, 170);
  const b18 = placeBox('class', 420, 80, 190, 170);
  const l18 = join('generalization', a18, b18);
  U.renderCanvas();
  const triOf = (id) => {
    const g = linkEl(id);
    const n = g && g.querySelector('.head-tri');
    if (!n) return null;
    const pts = (n.getAttribute('points') || '').trim().split(/\s+/).map((z) => z.split(',').map(Number));
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    return { len: Math.max(...xs) - Math.min(...xs), wid: Math.max(...ys) - Math.min(...ys) };
  };
  const setHead = (code) => {
    U.commit('t', (m) => {
      const l = U.currentDiagram(m).links.find((z) => z.id === l18.id);
      if (code === 2) delete l.headSizeTo; else l.headSizeTo = code;
    });
    U.renderCanvas();
  };
  const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;
  let t18 = triOf(l18.id);
  A('наконечник: без кода — базовая длина 8 и ширина 11 (код 2 = 1.0)',
    t18 && near(t18.len, 8) && near(t18.wid, 11),
    t18 ? 'длина ' + t18.len.toFixed(3) + ', ширина ' + t18.wid.toFixed(3) : 'нет треугольника');
  setHead(0);
  t18 = triOf(l18.id);
  A('наконечник: код 0 — длина 8·0.7 = 5.6, ширина 11·5/7 = 7.857',
    t18 && near(t18.len, 5.6) && near(t18.wid, 11 * 0.7142857142857143),
    t18 ? 'длина ' + t18.len.toFixed(3) + ', ширина ' + t18.wid.toFixed(3) : 'нет треугольника');
  setHead(6);
  t18 = triOf(l18.id);
  A('наконечник: код 6 — длина 8·5.1 = 40.8, ширина 11·38/7 = 59.714',
    t18 && near(t18.len, 40.8) && near(t18.wid, 11 * 5.428571428571429),
    t18 ? 'длина ' + t18.len.toFixed(3) + ', ширина ' + t18.wid.toFixed(3) : 'нет треугольника');
  setHead(0);
  const f18 = U.serialize(U.store.model);
  A('наконечник: код 0 пишется в файл как headSizeTo', f18.includes('"headSizeTo"'), 'есть поле');
  setHead(2);
  const f18b = U.serialize(U.store.model);
  A('наконечник: заводской код 2 в файл не пишется', !f18b.includes('"headSizeTo"'), 'поля нет');
  const back18 = U.deserialize(f18);
  const l18back = U.currentDiagram(back18).links.find((z) => z.id === l18.id);
  A('наконечник: код переживает круг serialize → deserialize → serialize',
    l18back && l18back.headSizeTo === 0 && U.serialize(back18) === f18,
    l18back ? 'код ' + l18back.headSizeTo : 'связи нет');
  const junk18 = U.deserialize(JSON.stringify({
    ...JSON.parse(f18b),
    diagrams: JSON.parse(f18b).diagrams.map((d) => ({
      ...d,
      links: d.links.map((l) => (l.id === l18.id ? { ...l, headSizeTo: 9 } : l)),
    })),
  }));
  const l18junk = U.currentDiagram(junk18).links.find((z) => z.id === l18.id);
  A('наконечник: код 9 из файла не принимается — остаётся умолчание',
    l18junk && l18junk.headSizeTo === undefined, l18junk ? 'поле ' + l18junk.headSizeTo : 'связи нет');

  // Инспектор — единственное место, где код задаётся руками; проверяем, что
  // поля действительно есть и что выбор доходит до модели, а не только до DOM.
  U.set({ selection: [{ kind: 'connector', id: l18.id }] });
  await settle();
  const headSelects = [...document.querySelectorAll('#props select[aria-label*="размер наконечника"]')];
  A('наконечник: в инспекторе связи два поля — источник и цель',
    headSelects.length === 2, 'полей ' + headSelects.length);
  if (headSelects.length === 2) {
    headSelects[1].value = '6';
    headSelects[1].dispatchEvent(new Event('change'));
    await settle();
    const l18set = U.currentDiagram(U.store.model).links.find((z) => z.id === l18.id);
    A('наконечник: выбор кода 6 в инспекторе пишется в модель и рисуется',
      l18set && l18set.headSizeTo === 6 && triOf(l18.id) && near(triOf(l18.id).len, 40.8),
      l18set ? 'код ' + l18set.headSizeTo + ', длина ' + triOf(l18.id).len.toFixed(1) : 'связи нет');
  }

  /* ===== (11) две связи одной пары: на листе ДВЕ линии, а не одна ===== */
  // Корпусный набор (tests/corpus.mjs) доказывает, что функция развода даёт
  // два разных пути. Он не доказывает, что лист их РИСУЕТ: если render.js
  // перестанет звать parallelOffsets, геометрия останется верной, набор
  // зелёным, а человек увидит одну линию — то самое, из-за чего на 4103
  // когда-то искали «дубль связи». Здесь проверяется сам SVG.
  blank(); addDiagram('class', 'P11');
  const pa11 = placeBox('class', 80, 80, 190, 170);
  const pb11 = placeBox('class', 520, 80, 190, 170);
  const lone = join('association', pa11, pb11);
  U.commit('t', (m) => { m.relationships[0].name = 'первая'; });
  U.renderCanvas(); await settle();
  const ptsOf = (id) => numsOf(linkEl(id)?.querySelector('path.conn'));
  const box11 = geo.layoutOf(U.currentDiagram(U.store.model).shapes.find((s) => s.id === pa11.shape.id), pa11.element);
  const edgeX = 80 + box11.w;
  const pLone = ptsOf(lone.id);
  A('параллельные связи: одна связь пары начинается ровно на кромке фигуры',
    pLone.length >= 4 && Math.abs(pLone[0] - edgeX) < 0.6,
    'x=' + pLone[0] + ', кромка ' + edgeX + ' — без второй связи линия не сдвинута');

  const twin = join('association', pa11, pb11);
  U.commit('t', (m) => { m.relationships[1].name = 'вторая'; });
  U.renderCanvas(); await settle();
  const dA = dOf(lone.id);
  const dB = dOf(twin.id);
  A('параллельные связи: две связи одной пары дают два разных пути d',
    dA && dB && dA !== dB,
    dA === dB ? 'путь один и тот же: ' + dA.slice(0, 40) : 'два пути: ' + dA.slice(0, 30) + ' | ' + dB.slice(0, 30));

  const pA = ptsOf(lone.id);
  const pB = ptsOf(twin.id);
  A('параллельные связи: концы разведены ВДОЛЬ кромки, а не сдвинуты с неё',
    Math.abs(pA[0] - pB[0]) < 0.6 && Math.abs(pA[1] - pB[1]) >= 10,
    'первые точки ' + pA.slice(0, 2).join(',') + ' / ' + pB.slice(0, 2).join(',') + ' (кромка x=' + edgeX + ')');

  const anchorOf = (id) => {
    const g = linkEl(id)?.querySelector('g.conn-label-g');
    const t = (g?.getAttribute('transform') || '').match(/-?[\d.]+/g)?.map(Number) ?? [];
    return { x: t[0], y: t[1], text: g ? [...g.querySelectorAll('text')].map((n) => n.textContent).join('') : '' };
  };
  const la = anchorOf(lone.id);
  const lb = anchorOf(twin.id);
  A('параллельные связи: обе подписи видны и стоят в разных точках',
    Number.isFinite(la.x) && Number.isFinite(lb.x) && la.text === 'первая' && lb.text === 'вторая'
      && Math.hypot(la.x - lb.x, la.y - lb.y) >= 6,
    'якоря ' + JSON.stringify(la) + ' / ' + JSON.stringify(lb));

  } catch (err) {
    R.push({ name: 'сценарий прерван', ok: false,
      detail: String(err && err.stack || err).slice(0, 600) + ' | последние: ' + R.slice(-3).map((r) => r.name).join(' / ') });
  }
  return R;
})()`);

let failed = 0;
for (const r of results) {
  if (r.ok) console.log('ok   ' + r.name + (r.detail ? ' — ' + r.detail : ''));
  else { failed += 1; console.log('FAIL ' + r.name + ' — ' + r.detail); }
}
console.log(`\n${results.length - failed}/${results.length} проверок прошло`);
ws.close();
child.kill('SIGKILL');
await rm(profile, { recursive: true, force: true });
server.close();
process.exit(failed ? 1 : 0);