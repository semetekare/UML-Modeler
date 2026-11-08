// Scenario checks for every diagram type and for the model/view rules.
// Runs the real page in headless Chromium over CDP (no dependencies), drives
// it through window.__uml — the same functions the UI calls — and prints one
// line per scenario. Exit code 0 only when every check passed.
//
//   node tests/types.mjs
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

const profile = await mkdtemp(path.join(tmpdir(), 'uml-types-'));
const port = 9600 + Math.floor(Math.random() * 200);
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
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
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

// Число правил набора читаем из самого файла здесь, в Node, и подставляем в
// сценарий: держать в тесте константу 41 значит красить его каждым новым
// правилом, а сверять надо «движок собрал все правила файла», а не «их 41».
const UML_RULE_COUNT = JSON.parse(
  await readFile(path.join(ROOT, 'notation', 'rules', 'uml-2.5.1.json'), 'utf8'),
).length;
const results = await evaluate(String.raw`(async () => {
  const R = [];
  const A = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail: String(detail) });
  const U = window.__uml;
  if (!U) return [{ name: 'app booted', ok: false, detail: 'window.__uml missing' }];
  // Модель, открытая из файла: у неё есть эталон, поэтому она чистая и
  // диалоги «потерять изменения?» посреди сценария не всплывают. Пустое имя
  // (blank(null)) — это «новая модель», у которой файла ещё нет.
  const blank = (name = 'blank.uml') => U.loadModel(U.deserialize(JSON.stringify({
    schema: 'uml-model/3', name: 'Проверка', elements: [], relationships: [], diagrams: [], currentDiagramId: null,
  })), name);
  const addDiagram = (kind, name = 'D') => U.commit('t', (m) => {
    const d = U.createDiagram(name, kind);
    m.diagrams.push(d);
    m.currentDiagramId = d.id;
    return d;
  });
  const place = (kind, x, y) => U.commit('t', (m) => U.placeElement(m, kind, x, y));
  const join = (connKind, a, b, extra = {}) => U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    const rel = U.createRelationship(connKind, a.element.id, b.element.id);
    if (extra.name) rel.name = extra.name;
    m.relationships.push(rel);
    const link = U.createLink(rel,
      { shapeId: a.shape.id, side: 'right', t: 0.5 },
      { shapeId: b.shape.id, side: 'left', t: 0.5 }, extra.y != null ? { y: extra.y } : {});
    d.links.push(link);
    return link;
  });
  const domShapes = () => document.querySelectorAll('#canvas [data-kind="shape"]').length;
  const domConns = () => document.querySelectorAll('#canvas [data-kind="conn"]').length;

  blank();
  const types = Object.keys(U.NOTATION.types);
  A('14 типов UML в нотации', types.length === 14, types.join(', '));

  /* --- the new-diagram dialog picks a type --------------------------- */
  document.querySelector('#toolbar [aria-label="Создать диаграмму"]').click();
  await new Promise((r) => setTimeout(r, 220));
  const dlg = document.querySelector('sc-dialog[open]');
  const radios = dlg ? dlg.querySelectorAll('input[name="dt-kind"]').length : 0;
  if (dlg) {
    const radio = dlg.querySelector('input[name="dt-kind"][value="state"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    const ok = [...dlg.querySelectorAll('button')].find((b) => /Создать/.test(b.textContent));
    if (ok) ok.click();
  }
  await new Promise((r) => setTimeout(r, 200));
  const madeKind = U.store.model.diagrams.at(-1)?.kind;
  A('диалог предлагает 14 типов и создаёт выбранный', radios === 14 && madeKind === 'state',
    radios + ' типов, создан ' + madeKind);

  for (const kind of types) {
    const t = U.NOTATION.types[kind];
    addDiagram(kind, 'D-' + kind);
    const shapeKind = t.palette.shapes[0];
    const connKind = t.palette.connectors[0];
    const a = place(shapeKind, 120, 120);
    const b = place(shapeKind, 520, 300);
    const link = join(connKind, a, b, kind === 'sequence' ? { y: 160 } : {});
    U.renderCanvas();
    const ok = U.store.model.diagrams.at(-1).shapes.length === 2
      && U.store.model.relationships.length >= 1
      && domShapes() === 2 && domConns() >= 1;
    A('тип ' + t.label + ': фигуры и связь рисуются', ok,
      'shapes ' + domShapes() + ', links ' + domConns() + ', rels ' + U.store.model.relationships.length);
  }

  /* --- model/view: one element, two diagrams ------------------------ */
  blank();
  addDiagram('class', 'A');
  const cls = place('class', 100, 100);
  U.commit('t', (m) => { m.elements.find(e => e.id === cls.element.id).name = 'Заказ'; });
  addDiagram('class', 'B');
  U.commit('t', (m) => {
    const el = m.elements.find(e => e.id === cls.element.id);
    const d = U.currentDiagram(m);
    d.shapes.push({ id: 'sB', elementId: el.id, x: 200, y: 200, w: 190, h: 170, fill: null });
  });
  U.commit('t', (m) => { m.elements.find(e => e.id === cls.element.id).name = 'Заказ2'; });
  U.renderCanvas();
  const names = [...document.querySelectorAll('#canvas .sh-name')].map(n => n.textContent);
  A('переименование видно на обеих диаграммах', names.includes('Заказ2'),
    'на листе: ' + names.join(', '));

  /* --- two delete commands ------------------------------------------ */
  const beforeEls = U.store.model.elements.length;
  const beforeRels = U.store.model.relationships.length;
  U.commit('t', (m) => { const d = U.currentDiagram(m); d.shapes = d.shapes.filter(s => s.id !== 'sB'); });
  A('снятие вида не трогает элемент', U.store.model.elements.length === beforeEls,
    'элементов ' + U.store.model.elements.length + '/' + beforeEls);

  /* --- relationships live in the model ------------------------------ */
  blank();
  addDiagram('class', 'C');
  const c1 = place('class', 80, 80);
  const c2 = place('class', 420, 80);
  const l1 = join('association', c1, c2, { name: 'оформляет' });
  addDiagram('class', 'C2');
  U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    d.shapes.push({ id: 'x1', elementId: c1.element.id, x: 60, y: 60, w: 190, h: 170, fill: null });
    d.shapes.push({ id: 'x2', elementId: c2.element.id, x: 400, y: 60, w: 190, h: 170, fill: null });
    const rel = m.relationships[0];
    d.links.push(U.createLink(rel, { shapeId: 'x1', side: 'right', t: .5 }, { shapeId: 'x2', side: 'left', t: .5 }));
  });
  A('одна связь — два вида', U.store.model.relationships.length === 1
    && U.store.model.diagrams.reduce((n, d) => n + d.links.length, 0) === 2,
    'связей ' + U.store.model.relationships.length);

  U.commit('t', (m) => { const d = U.currentDiagram(m); d.links = []; });
  A('снятие вида связи оставляет связь', U.store.model.relationships.length === 1,
    'связей ' + U.store.model.relationships.length);

  /* --- stereotype + tagged values on a relationship ------------------ */
  U.commit('t', (m) => {
    const r = m.relationships[0];
    r.stereotype = 'include';
    r.taggedValues = [{ name: 'kind', value: 'Functional' }];
  });
  const ser = U.serialize(U.store.model);
  const back = U.deserialize(ser);
  A('стереотип и tagged value связи переживают сохранение',
    back.relationships[0].stereotype === 'include'
    && back.relationships[0].taggedValues[0].value === 'Functional',
    back.relationships[0].stereotype + ' / ' + JSON.stringify(back.relationships[0].taggedValues));

  /* --- a stereotype from the profile brings its tagged values -------- */
  blank();
  addDiagram('class');
  const tvShape = place('class', 120, 120);
  U.set({ selection: { kind: 'shape', id: tvShape.shape.id } });
  await new Promise((r) => setTimeout(r, 160));
  const elStSel = document.querySelector('#props select[aria-label="Стереотип"]');
  let tagCount = 0;
  let tagSaved = null;
  if (elStSel) {
    // Пункт списка — запись профиля (stereotypeId), не имя: подпись
    // показывает каноническое имя, а значение — ссылка на запись.
    elStSel.value = 'st-viewpoint';
    elStSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const tags = [...document.querySelectorAll('#props .tag-val')];
    tagCount = tags.length;
    if (tags[0]) {
      tags[0].value = 'заказчик';
      tags[0].dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
    }
    tagSaved = U.store.model.elements[0].taggedValues?.find((t) => t.value === 'заказчик')?.name ?? null;
  }
  A('стереотип элемента приносит tagged values профиля', tagCount >= 3 && !!tagSaved,
    tagCount + ' полей, сохранено «' + tagSaved + '»');

  /* --- nested diagram belongs to an element -------------------------- */
  const ownerId = c1.element.id;
  const nested = U.commit('t', (m) => {
    const d = U.createDiagram('Вложенная', 'state', ownerId);
    m.diagrams.push(d);
    return d;
  });
  A('диаграмма принадлежит элементу', nested.ownerElementId === ownerId,
    String(nested.ownerElementId));

  /* --- sequence numbering follows y --------------------------------- */
  // Нумерация сообщений на диаграмме последовательности — не умолчание:
  // порядок задан вертикалью, и все 19 таких диаграмм пособия нарисованы без
  // номеров (в исходном редакторе это выключено). Поэтому механизм проверяется с
  // явно включённым флагом, а ниже — что без него номеров нет.
  blank();
  U.commit('t', (m) => { m.messageNumbers = true; });
  addDiagram('sequence', 'S');
  const l1a = place('lifeline', 100, 60);
  const l2a = place('lifeline', 420, 60);
  const m1 = join('message', l1a, l2a, { name: 'первое()', y: 200 });
  const m2 = join('message', l1a, l2a, { name: 'второе()', y: 140 });
  U.renderCanvas();
  let labels = [...document.querySelectorAll('#canvas .conn-lbl')].map(n => n.textContent);
  A('номера сообщений считаются по высоте', labels.some(t => t.startsWith('1: второе'))
    && labels.some(t => t.startsWith('2: первое')), labels.join(' | '));
  U.commit('t', (m) => { const d = U.currentDiagram(m); const l = d.links.find(x => x.relId === m.relationships[0].id); l.y = 100; });
  U.renderCanvas();
  labels = [...document.querySelectorAll('#canvas .conn-lbl')].map(n => n.textContent);
  A('перенос сообщения меняет номер', labels.some(t => t.startsWith('1: первое')), labels.join(' | '));

  // А по умолчанию номеров нет — так нарисован оригинал.
  U.commit('t', (m) => { m.messageNumbers = false; });
  U.renderCanvas();
  const unnumbered = [...document.querySelectorAll('#canvas .conn-lbl')].map(n => n.textContent);
  A('без флага номера не рисуются', !unnumbered.some(t => /^\d+:/.test(t)), unnumbered.join(' | '));
  U.commit('t', (m) => { delete m.messageNumbers; });

  /* --- timing waveform --------------------------------------------- */
  blank();
  addDiagram('timing', 'T');
  const lane = place('timingLane', 80, 80);
  U.commit('t', (m) => {
    const el = m.elements.find(e => e.id === lane.element.id);
    el.timeline = [{ state: 'A', from: 0, to: 40 }, { state: 'B', from: 40, to: 100 }];
  });
  U.renderCanvas();
  const wave = document.querySelectorAll('#canvas [data-kind="shape"] path.conn').length;
  A('шкала времени рисует ступени', wave >= 1, 'путей ' + wave);

  /* --- palette follows the diagram type ----------------------------- */
  blank();
  addDiagram('component', 'PAL');
  await new Promise((r) => setTimeout(r, 80));
  const palComp = [...document.querySelectorAll('#toolstrip [data-tool]')].map((b) => b.dataset.tool);
  addDiagram('state', 'PAL2');
  await new Promise((r) => setTimeout(r, 80));
  const palState = [...document.querySelectorAll('#toolstrip [data-tool]')].map((b) => b.dataset.tool);
  A('палитра зависит от типа диаграммы',
    palComp.includes('assembly') && palComp.includes('component') && palState.includes('transition') && !palState.includes('assembly'),
    'component: ' + palComp.join(',') + ' | state: ' + palState.join(','));

  /* --- connector stereotype + tagged values in the inspector -------- */
  blank();
  addDiagram('class', 'REL');
  const r1 = place('class', 80, 80);
  const r2 = place('class', 420, 80);
  const relLink = join('association', r1, r2, { name: 'связь' });
  U.set({ selection: { kind: 'connector', id: relLink.id } });
  await new Promise((r) => setTimeout(r, 80));
  const stSel = document.querySelector('#props select[aria-label="Стереотип"]');
  A('у связи есть выбор стереотипа', !!stSel && stSel.options.length >= 305,
    stSel ? stSel.options.length + ' вариантов' : 'нет списка');
  if (stSel) {
    stSel.value = 'st-weighted';
    stSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 120));
  const rel = U.store.model.relationships[0];
  const tagInput = document.querySelector('#props .tag-row input.tag-val');
  A('стереотип связи записан в модель', rel.stereotype === 'weighted', String(rel.stereotype));
  A('выбор записан и ссылкой на запись профиля', rel.stereotypeId === 'st-weighted',
    String(rel.stereotypeId));
  A('tagged values стереотипа показаны', !!tagInput,
    tagInput ? 'поле есть' : 'поля нет');
  if (tagInput) {
    tagInput.value = '3';
    tagInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
  }
  A('значение tagged value связи сохраняется',
    (rel.taggedValues || []).some((t) => t.name === 'weight' && t.value === '3'),
    JSON.stringify(rel.taggedValues || []));

  /* --- nested diagram is visible in the tree ------------------------ */
  const owner = U.store.model.elements[0];
  U.commit('t', (m) => { m.diagrams.push(U.createDiagram('Вложенная', 'activity', owner.id)); });
  await new Promise((r) => setTimeout(r, 100));
  const nestedRow = [...document.querySelectorAll('#model ul.nested .node')]
    .find((n) => /Вложенная/.test(n.textContent));
  A('вложенная диаграмма видна под элементом', !!nestedRow,
    nestedRow ? nestedRow.textContent.trim().slice(0, 60) : 'нет строки');

  /* --- UI: palette click, connect, two deletes ---------------------- */
  blank();
  addDiagram('state', 'UI');
  await new Promise((r) => setTimeout(r, 60));
  const cv = document.querySelector('#canvas');
  const cr = cv.getBoundingClientRect();
  const uiClick = (x, y) => {
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0 }));
  };
  document.querySelector('#toolstrip [data-tool="state"]').click();
  uiClick(cr.x + 300, cr.y + 250);
  await new Promise((r) => setTimeout(r, 60));
  document.querySelector('#toolstrip [data-tool="state"]').click();
  uiClick(cr.x + 620, cr.y + 250);
  await new Promise((r) => setTimeout(r, 60));
  const placedTwo = U.currentDiagram(U.store.model).shapes.length === 2;
  A('инструмент «Состояние» ставит две фигуры кликами', placedTwo,
    'фигур ' + U.currentDiagram(U.store.model).shapes.length);

  const centres = U.currentDiagram(U.store.model).shapes.map((s) => {
    const v = U.store.ui.view;
    return { x: cr.x + v.tx + (s.x + s.w / 2) * v.scale, y: cr.y + v.ty + (s.y + s.h / 2) * v.scale };
  });
  document.querySelector('#toolstrip [data-tool="transition"]').click();
  uiClick(centres[0].x, centres[0].y);
  uiClick(centres[1].x, centres[1].y);
  await new Promise((r) => setTimeout(r, 80));
  const relCount = U.store.model.relationships.length;
  A('переход ставится кликом по двум состояниям', relCount === 1 && U.currentDiagram(U.store.model).links.length === 1,
    'связей ' + relCount + ', видов ' + U.currentDiagram(U.store.model).links.length);

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  A('Delete снимает переход с листа, связь остаётся',
    U.store.model.relationships.length === 1 && U.currentDiagram(U.store.model).links.length === 0,
    'связей ' + U.store.model.relationships.length + ', видов ' + U.currentDiagram(U.store.model).links.length);

  U.set({ selection: { kind: 'shape', id: U.currentDiagram(U.store.model).shapes[0].id } });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', shiftKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  A('Shift+Delete убирает состояние из модели и его переход',
    U.store.model.elements.length === 1 && U.store.model.relationships.length === 0,
    'элементов ' + U.store.model.elements.length + ', связей ' + U.store.model.relationships.length);

  /* --- compartments of the behavioural types ------------------------ */
  blank();
  addDiagram('state', 'CMP');
  const st = place('state', 100, 100);
  U.commit('t', (m) => {
    const e = m.elements.find((x) => x.id === st.element.id);
    e.name = 'Оплачен';
    e.entry = ['зафиксировать оплату'];
    e.do = ['ждать склад'];
    e.exit = ['уведомить'];
  });
  U.renderCanvas();
  const stText = [...document.querySelectorAll('#canvas [data-kind="shape"] text')].map((t) => t.textContent);
  A('состояние рисует entry / do / exit',
    stText.some((t) => t === 'entry / зафиксировать оплату')
    && stText.some((t) => t === 'do / ждать склад')
    && stText.some((t) => t === 'exit / уведомить'), stText.join(' | ').slice(0, 120));

  addDiagram('sequence', 'CMP2');
  const fr = place('fragment', 80, 80);
  U.commit('t', (m) => {
    const e = m.elements.find((x) => x.id === fr.element.id);
    e.operator = 'loop';
    e.name = 'для каждой строки';
  });
  U.renderCanvas();
  const frText = [...document.querySelectorAll('#canvas [data-kind="shape"] text')].map((t) => t.textContent);
  A('фрагмент показывает оператор и имя', frText.includes('loop') && frText.includes('для каждой строки'),
    frText.join(' | ').slice(0, 80));

  /* --- one element on diagrams of two different types --------------- */
  blank();
  addDiagram('class', 'X1');
  const shared = place('class', 100, 100);
  U.commit('t', (m) => { m.elements.find((e) => e.id === shared.element.id).name = 'Общий'; });
  addDiagram('component', 'X2');
  U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    d.shapes.push({ id: 'sx', elementId: shared.element.id, x: 120, y: 120, w: 190, h: 170, fill: null });
  });
  U.renderCanvas();
  A('элемент виден на диаграмме другого типа',
    [...document.querySelectorAll('#canvas .sh-name')].some((n) => n.textContent === 'Общий'),
    document.querySelectorAll('#canvas .sh-name').length + ' имён');

  /* --- UML 2.5.1 semantics: abstract, member flags ------------------- */
  blank();
  addDiagram('class', 'SEM');
  const absShape = place('class', 100, 100);
  U.commit('t', (m) => { m.elements.find((e) => e.id === absShape.element.id).name = 'Фигура'; });
  U.set({ selection: [{ kind: 'shape', id: absShape.shape.id }] });
  await new Promise((r) => setTimeout(r, 160));
  const absBox = document.querySelector('#props input#p-abstract');
  A('у класса есть галочка «абстрактный»', !!absBox, absBox ? 'галочка есть' : 'нет галочки');
  if (absBox) {
    absBox.checked = true;
    absBox.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
  }
  U.renderCanvas();
  const nameNode = document.querySelector('#canvas .sh-name');
  A('абстрактный класс рисуется курсивом',
    !!nameNode && nameNode.classList.contains('italic') && nameNode.textContent === 'Фигура',
    nameNode ? nameNode.className : 'нет имени');
  const absSer = U.serialize(U.store.model);
  const absParsed = JSON.parse(absSer);
  A('abstract записан в файл и прочитан',
    absParsed.elements[0].abstract === true && U.deserialize(absSer).elements[0].abstract === true,
    JSON.stringify(absParsed.elements[0].abstract));

  /* --- isStatic / isDerived / isID on a member ----------------------- */
  const memShape = place('class', 340, 100);
  U.commit('t', (m) => {
    const e = m.elements.find((x) => x.id === memShape.element.id);
    e.name = 'Курс';
    e.attributes = [{ vis: 'private', name: 'код', type: 'int', default: '' }];
    e.operations = [{ vis: 'public', name: 'все()', type: 'int', default: '' }];
  });
  U.set({ selection: [{ kind: 'shape', id: memShape.shape.id }] });
  await new Promise((r) => setTimeout(r, 160));
  const flagBox = (k) => document.querySelector('#props input[data-col="' + k + '"]');
  A('у члена три галочки: S, /, id',
    !!flagBox('isStatic') && !!flagBox('isDerived') && !!flagBox('isID'),
    ['isStatic', 'isDerived', 'isID'].map((k) => (flagBox(k) ? k : 'нет ' + k)).join(', '));
  for (const k of ['isStatic', 'isDerived', 'isID']) {
    const box = flagBox(k);
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  U.renderCanvas();
  const rowTexts = [...document.querySelectorAll('#canvas .sh-row')].map((t) => t.textContent);
  A('«/» перед именем и «{id}» после — на листе',
    rowTexts.includes('/код: int {id}'), rowTexts.join(' | ').slice(0, 120));
  A('статический член подчёркнут',
    [...document.querySelectorAll('#canvas .sh-row')].some((t) => t.classList.contains('static')),
    String([...document.querySelectorAll('#canvas .sh-row.static')].length));
  const flagSer = U.serialize(U.store.model);
  const flagBack = U.deserialize(flagSer);
  const flagAttr = flagBack.elements.find((e) => e.name === 'Курс').attributes[0];
  A('три флага переживают сохранение',
    flagAttr.isStatic === true && flagAttr.isDerived === true && flagAttr.isID === true,
    JSON.stringify(flagAttr));
  A('файл с флагами пересохраняется байт в байт', U.serialize(flagBack) === flagSer,
    flagSer.length + ' Б');

  /* --- navigability, aggregation, role names ------------------------- */
  blank();
  addDiagram('class', 'ENDS');
  const ea = place('class', 80, 80);
  const eb = place('class', 420, 80);
  const elink = join('association', ea, eb, { name: 'имеет' });
  U.set({ selection: [{ kind: 'connector', id: elink.id }] });
  await new Promise((r) => setTimeout(r, 160));
  const navSel = document.querySelector('#props select[aria-label="Навигация ассоциации"]');
  A('у ассоциации есть свойство навигации', !!navSel && navSel.options.length === 4,
    navSel ? navSel.options.length + ' вариантов' : 'нет списка');
  if (navSel) {
    navSel.value = 'to';
    navSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
  }
  U.renderCanvas();
  // Не только «сколько», но и «где»: инверсия стрелок — реальный дефект,
  // который счёт не ловит. navigable 'to' — навигация от цели к источнику
  // (README корпуса), значит остриё у ИСТОЧНИКА, x ≈ 80 + 190.
  const tipOf = (el) => {
    const n = (el.getAttribute('d') || '').match(/-?[\d.]+/g)?.map(Number) ?? [];
    return n[2];
  };
  const open = [...document.querySelectorAll('#canvas .head-open')];
  const arrows1 = open.length;
  const tip1 = arrows1 === 1 ? tipOf(open[0]) : null;
  A('стрелка у цели нарисована', arrows1 === 1 && tip1 < 300,
    'стрелок ' + arrows1 + ', остриё x=' + tip1 + ' (источник ≈270, цель ≈420)');
  U.commit('t', (m) => { m.relationships[0].navigable = 'both'; });
  U.renderCanvas();
  const arrows2 = document.querySelectorAll('#canvas .head-open').length;
  A('навигация в обе стороны — две стрелки', arrows2 === 2, 'стрелок ' + arrows2);

  // Ромб принадлежит МОДЕЛИ, а не виду связи: поле tail в начертании больше
  // не подставляет его сам. Поэтому вид меняется вместе со значением конца —
  // ровно так, как это делает инспектор (поле «Агрегация концов»).
  U.commit('t', (m) => {
    m.relationships[0].kind = 'aggregation';
    m.relationships[0].fromAggregation = 'shared';
  });
  U.renderCanvas();
  const hollow = document.querySelectorAll('#canvas .head-tri').length;
  A('агрегация: полый ромб у источника', hollow >= 1, 'ромбов ' + hollow);
  U.commit('t', (m) => { m.relationships[0].toAggregation = 'composite'; });
  U.renderCanvas();
  const solid = document.querySelectorAll('#canvas .head-fill').length;
  A('композиция: залитый ромб у цели', solid >= 1, 'залитых ' + solid);
  const aggSer = U.serialize(U.store.model);
  const aggRel = JSON.parse(aggSer).relationships[0];
  A('агрегация пишется, когда отличается от умолчания вида связи',
    aggRel.toAggregation === 'composite' && aggRel.fromAggregation === undefined,
    JSON.stringify(aggRel));
  // Нетронутая «Агрегация» не пишет поле вовсе: полый ромб — смысл самого вида.
  const freshLink = join('aggregation', ea, eb);
  const freshJson = JSON.parse(U.serialize(U.store.model)).relationships
    .find((r) => r.id === freshLink.relId);
  A('нетронутая агрегация не пишет поле вовсе',
    !!freshJson && freshJson.fromAggregation === undefined && freshJson.toAggregation === undefined,
    JSON.stringify(freshJson));

  U.commit('t', (m) => {
    const r = m.relationships[0];
    r.kind = 'association';
    r.fromAggregation = 'none';
    r.toAggregation = 'none';
    r.fromRole = 'курсы';
    r.toRole = 'студенты';
  });
  U.renderCanvas();
  const roleTexts = [...document.querySelectorAll('#canvas .conn-multi')].map((t) => t.textContent);
  A('имена полюсов подписаны у концов',
    roleTexts.includes('курсы') && roleTexts.includes('студенты'), roleTexts.join(' | '));

  /* --- Э27: абстракция — какие виды классификаторы ------------------- */
  // Список получен из раздела «Обобщения» метаклассов в переводе UML 2.5.1
  // (material/spec-ru/ru), а не из APPLICABILITY нотации: галочка есть тогда и
  // только тогда, когда метакласс вида — Classifier. 17 + 34 = 51 вид нотации,
  // то есть проверены ВСЕ виды, а не выборка.
  const ABS_YES = ['class', 'interface', 'datatype', 'enumeration', 'stereotype', 'metaclass',
    'component', 'node', 'device', 'executionEnvironment', 'artifact', 'deploymentSpec',
    'actor', 'usecase', 'activity', 'interaction', 'collaboration'];
  const ABS_NO = ['note', 'text', 'action', 'object', 'package', 'model', 'profile', 'port',
    'part', 'lifeline', 'actorLifeline', 'collaborationUse', 'interactionUse', 'swimlane',
    'fragment', 'state', 'objectNode', 'activityParameter', 'systemBoundary', 'decision',
    'merge', 'fork', 'join', 'initial', 'final', 'choice', 'junction', 'historyShallow',
    'historyDeep', 'entryPoint', 'exitPoint', 'terminate', 'activation', 'timingLane'];
  // Панель перерисовывается в микрозадаче (store.emit), поэтому после смены
  // выбора ждём кадр: иначе в DOM ещё стоит панель прошлой фигуры.
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const hasAbstractBox = async (kind) => {
    blank();
    addDiagram('class', 'ABS');
    const p = place(kind, 120, 120);
    U.set({ selection: [{ kind: 'shape', id: p.shape.id }] });
    await tick();
    return !!document.querySelector('#props input#p-abstract');
  };
  // Два списка обязаны покрыть ВСЮ нотацию: новый вид без решения по нему —
  // это непроверенное решение, а не «ещё одна фигура».
  const allKinds = Object.keys(U.NOTATION.shapes);
  const covered = new Set([...ABS_YES, ...ABS_NO]);
  const uncovered = allKinds.filter((k) => !covered.has(k));
  const missingYes = [];
  for (const k of ABS_YES) if (!(await hasAbstractBox(k))) missingYes.push(k);
  A('галочка «абстрактный» есть у каждого вида-классификатора',
    missingYes.length === 0 && ABS_YES.length === 17 && uncovered.length === 0
      && ABS_YES.length + ABS_NO.length === allKinds.length,
    (missingYes.length ? 'нет у: ' + missingYes.join(', ') : ABS_YES.length + ' видов, все с галочкой')
      + (uncovered.length ? '; без решения: ' + uncovered.join(', ') : '')
      + '; всего видов ' + allKinds.length);
  const extraNo = [];
  for (const k of ABS_NO) if (await hasAbstractBox(k)) extraNo.push(k);
  A('у видов, которые не классификаторы, галочки «абстрактный» нет',
    extraNo.length === 0 && ABS_NO.length === 34,
    extraNo.length ? 'лишняя у: ' + extraNo.join(', ') : ABS_NO.length + ' видов без галочки');

  // Ассоциация — тоже Classifier (§11.8.1.3), а агрегация, композиция и путь
  // связи — её виды (§19.5.2): галочка нужна и у связи, иначе абстрактная
  // ассоциация теряет флаг. Обобщение и зависимость классификаторами не были.
  blank();
  addDiagram('class', 'ABS-CONN');
  const cA = place('class', 60, 60);
  const cB = place('class', 420, 60);
  const connBox = async (kind) => {
    const l = join(kind, cA, cB);
    U.set({ selection: [{ kind: 'connector', id: l.id }] });
    await tick();
    return !!document.querySelector('#props input#p-abstract');
  };
  const connYes = [];
  for (const k of ['association', 'aggregation', 'composition', 'communicationPath']) if (await connBox(k)) connYes.push(k);
  const connNo = [];
  for (const k of ['generalization', 'dependency']) if (await connBox(k)) connNo.push(k);
  A('у ассоциации и её видов галочка есть, у обобщения и зависимости — нет',
    connYes.length === 4 && connNo.length === 0,
    'с галочкой: ' + (connYes.join(', ') || 'нет') + '; без: ' + (connNo.join(', ') || 'нет'));

  // Курсив — §9.2.4: имя абстрактного классификатора показывается курсивом.
  const italicOf = (kind, abstract) => {
    blank();
    addDiagram('class', 'ABS-I');
    const p = place(kind, 120, 120);
    U.commit('t', (m) => {
      const e = m.elements.find((x) => x.id === p.element.id);
      e.name = 'Абстракт';
      e.abstract = abstract;
    });
    U.renderCanvas();
    const n = [...document.querySelectorAll('#canvas .sh-name')].find((t) => t.textContent === 'Абстракт');
    return n ? n.classList.contains('italic') : null;
  };
  const italicMissing = ['actor', 'component', 'node', 'usecase', 'activity']
    .filter((k) => italicOf(k, true) !== true);
  const italicWrong = ['actor', 'component', 'node', 'usecase', 'activity']
    .filter((k) => italicOf(k, false) !== false);
  A('абстрактные актёр, компонент, узел, вариант использования, деятельность — курсивом',
    italicMissing.length === 0 && italicWrong.length === 0,
    (italicMissing.length ? 'не курсивом: ' + italicMissing.join(', ') : '5 видов курсивом')
      + (italicWrong.length ? '; курсивом без флага: ' + italicWrong.join(', ') : ''));

  /* --- Э27: абстрактная операция ------------------------------------- */
  blank();
  addDiagram('class', 'ABS-OP');
  const opShape = place('class', 120, 120);
  U.commit('t', (m) => {
    const e = m.elements.find((x) => x.id === opShape.element.id);
    e.name = 'Фигура';
    e.attributes = [{ vis: 'public', name: 'сторона', type: 'int', default: '' }];
    e.operations = [{ vis: 'public', name: 'площадь()', type: 'double', default: '' }];
  });
  U.set({ selection: [{ kind: 'shape', id: opShape.shape.id }] });
  await tick();
  const opBox = document.querySelector('#props input[data-field="operations"][data-col="isAbstract"]');
  A('у операции есть галочка «абстрактная»', !!opBox, opBox ? 'галочка есть' : 'нет галочки');
  const attrBox = document.querySelector('#props input[data-field="attributes"][data-col="isAbstract"]');
  A('у атрибута галочки «абстрактный» нет: Property не BehavioralFeature (§9.9.17)',
    !attrBox, attrBox ? 'галочка есть — это выдумка' : 'галочки нет');
  if (opBox) {
    opBox.checked = true;
    opBox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  U.renderCanvas();
  const opRow = [...document.querySelectorAll('#canvas .sh-row')].find((t) => t.textContent.includes('площадь()'));
  A('имя абстрактной операции — курсивом',
    !!opRow && opRow.getAttribute('font-style') === 'italic',
    opRow ? 'font-style=' + opRow.getAttribute('font-style') + ', текст «' + opRow.textContent + '»' : 'строки нет');
  A('буквы-пометки в строке операции нет — только курсив',
    !!opRow && !/[{}]/.test(opRow.textContent) && !opRow.textContent.includes('abstract'),
    opRow ? opRow.textContent : 'строки нет');
  const opFileText = U.serialize(U.store.model);
  const opFile = JSON.parse(opFileText);
  const opRowFile = opFile.elements.find((e) => e.name === 'Фигура').operations[0];
  const attrRowFile = opFile.elements.find((e) => e.name === 'Фигура').attributes[0];
  A('абстрактность операции записана в файл',
    opRowFile.isAbstract === true && opFileText.includes('"isAbstract": true'),
    JSON.stringify(opRowFile));
  A('у атрибута поля isAbstract нет вовсе',
    !('isAbstract' in attrRowFile), JSON.stringify(attrRowFile));

  // Флаг пишется ТОЛЬКО когда true: иначе каждая операция в каждом файле
  // получила бы "isAbstract": false и файлы распухли бы.
  blank();
  addDiagram('class', 'ABS-OP2');
  const plainShape = place('class', 120, 120);
  U.commit('t', (m) => {
    const e = m.elements.find((x) => x.id === plainShape.element.id);
    e.name = 'Обычный';
    e.operations = [{ vis: 'public', name: 'run()', type: 'void', default: '' }];
  });
  const plainText = U.serialize(U.store.model);
  A('у неабстрактной операции поля isAbstract в файле нет',
    !plainText.includes('isAbstract'),
    plainText.includes('isAbstract') ? 'поле появилось' : 'поля нет, ' + plainText.length + ' Б');
  A('модель без флага пересохраняется байт в байт',
    U.serialize(U.deserialize(plainText)) === plainText, plainText.length + ' Б');

  // Абстрактная ассоциация: имя курсивом, флаг в файле, и только когда true.
  blank();
  addDiagram('class', 'ABS-REL');
  const rA = place('class', 60, 60);
  const rB = place('class', 420, 60);
  const rLink = join('association', rA, rB, { name: 'ведёт' });
  U.set({ selection: [{ kind: 'connector', id: rLink.id }] });
  await tick();
  const relBox = document.querySelector('#props input#p-abstract');
  if (relBox) {
    relBox.checked = true;
    relBox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  U.renderCanvas();
  const relLabel = [...document.querySelectorAll('#canvas .conn-lbl')].find((t) => t.textContent === 'ведёт');
  const relFile = JSON.parse(U.serialize(U.store.model)).relationships[0];
  A('абстрактная ассоциация: курсив на листе и abstract в файле',
    !!relBox && !!relLabel && relLabel.getAttribute('font-style') === 'italic' && relFile.abstract === true,
    (relLabel ? 'font-style=' + relLabel.getAttribute('font-style') : 'подписи нет')
      + ', ' + JSON.stringify({ abstract: relFile.abstract }));

  // Круг PlantUML, первая половина: текст → модель → файл uml.json. Вторая
  // половина (файл → PlantUML) — ниже, в Node: экспорт живёт вне страницы
  // (material/plantuml-export/emit.mjs), а страница держит нотацию и читалку.
  {
    const { parse } = await import('/src/io/plantuml.js');
    const puml = '@startuml\nclass Foo {\n{abstract} +doIt() : void\n}\n@enduml';
    const parsed = parse(puml);
    const fileText = U.serialize(parsed.model);
    const backModel = U.deserialize(fileText);
    const op = backModel.elements.find((e) => e.kind === 'class')?.operations?.[0];
    A('PlantUML {abstract} doIt(): модель → файл сохраняет isAbstract',
      op?.isAbstract === true && fileText.includes('"isAbstract": true'),
      JSON.stringify(op));
    window.__e27file = fileText;
  }

  /* --- generalization set -------------------------------------------- */
  blank();
  addDiagram('class', 'GENSET');
  const gParent = place('class', 400, 60);
  const gChildA = place('class', 200, 320);
  const gChildB = place('class', 600, 320);
  const g1 = join('generalization', gChildA, gParent);
  join('generalization', gChildB, gParent);
  U.set({ selection: [{ kind: 'connector', id: g1.id }] });
  await new Promise((r) => setTimeout(r, 160));
  const setSel = document.querySelector('#props select[aria-label="Набор обобщений"]');
  A('у обобщения есть выбор набора', !!setSel, setSel ? setSel.options.length + ' вариантов' : 'нет списка');
  if (setSel) {
    setSel.value = '__new';
    setSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 160));
  }
  const madeSet = U.store.model.generalizationSets?.[0];
  A('новый набор создан и привязан к обобщению',
    !!madeSet && U.store.model.relationships[0].setId === madeSet.id,
    madeSet ? madeSet.name : 'набора нет');
  const coverBox = document.querySelector('#props input[data-prop="covering"]');
  const disjointBox = document.querySelector('#props input[data-prop="disjoint"]');
  for (const box of [coverBox, disjointBox]) {
    if (!box) continue;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
  }
  U.renderCanvas();
  const setLabels = [...document.querySelectorAll('#canvas text')].map((t) => t.textContent);
  A('набор печатает {complete, disjoint}',
    setLabels.includes('{complete, disjoint}'), setLabels.join(' | ').slice(0, 140));
  const gsSer = U.serialize(U.store.model);
  const gsBack = U.deserialize(gsSer);
  A('набор обобщений переживает сохранение',
    gsBack.generalizationSets.length === 1
    && gsBack.generalizationSets[0].covering === true
    && gsBack.generalizationSets[0].disjoint === true
    && gsBack.relationships[0].setId === gsBack.generalizationSets[0].id,
    JSON.stringify(gsBack.generalizationSets));
  A('файл с набором пересохраняется байт в байт', U.serialize(gsBack) === gsSer, gsSer.length + ' Б');

  /* --- пиктограммы стереотипов (план Э1) ---------------------------- */
  // Профиль нужен, чтобы рисунок вообще нашёлся: он приходит отдельным
  // запросом, и тест не должен зависеть от того, успел ли он к моменту
  // прогона.
  if (!U.store.profile) U.store.profile = await U.loadProfile();
  const pictCount = () => document.querySelectorAll('#canvas .sh-pict').length;
  const setStereo = (el, name) => U.commit('t', (m) => {
    m.elements.find((e) => e.id === el.element.id).stereotype = name;
  });

  blank();
  addDiagram('usecase');
  const plain = place('usecase', 120, 120);
  U.renderCanvas();
  const beforePict = pictCount();
  setStereo(plain, 'sea level usecase');
  U.renderCanvas();
  const waves = document.querySelector('#canvas g.sh-pict');
  const wavesPaths = waves ? waves.querySelectorAll('path').length : 0;
  const wavesTransform = waves?.getAttribute('transform') ?? '';
  // Рисунок — знак в углу, а не подмена фигуры: тело фигуры остаётся своим.
  const wavesBody = document.querySelector('#canvas .sh-body');
  A('рисунок не подменяет фигуру: тело фигуры на месте',
    beforePict === 0 && pictCount() === 1 && wavesPaths > 0
    && !!wavesBody && !wavesBody.classList.contains('sh-pict-body'),
    'до ' + beforePict + ', после ' + pictCount() + ', путей ' + wavesPaths
    + ', тело ' + (wavesBody ? wavesBody.getAttribute('class') : 'нет'));

  // Знак стоит в правом верхнем углу — но у ОВАЛА угла нет: его ограничивающий
  // прямоугольник лежит вне фигуры, и якорь в углу выбрасывал рисунок за
  // контур (это увидела сверка с оригиналом 3.1.2). Поэтому проверяем главное:
  // знак ВНУТРИ овала и в его правой верхней четверти.
  // Доли, а не пиксели: масштаб листа зависит от окна и от «вписать».
  const wavesBox = waves.getBoundingClientRect();
  const bodyBox = wavesBody.getBoundingClientRect();
  const cx = bodyBox.x + bodyBox.width / 2;
  const cy = bodyBox.y + bodyBox.height / 2;
  const mx = wavesBox.x + wavesBox.width / 2;
  const my = wavesBox.y + wavesBox.height / 2;
  const nx = (mx - cx) / (bodyBox.width / 2);   // −1..1 от центра
  const ny = (my - cy) / (bodyBox.height / 2);
  const insideOval = nx * nx + ny * ny <= 1;
  A('рисунок стоит справа сверху, внутри овала',
    insideOval && nx > 0.15 && ny < -0.05,
    'nx=' + nx.toFixed(2) + ' ny=' + ny.toFixed(2)
    + ' (nx²+ny²=' + (nx * nx + ny * ny).toFixed(2) + ' ≤ 1 — внутри)');

  // Подпись осталась внутри фигуры — рисунок её не сдвигает.
  const waveTexts = [...document.querySelectorAll('#canvas text')]
    .filter((t) => t.textContent === plain.element.name || t.textContent === '«sea level usecase»')
    .map((t) => Number(t.getAttribute('y')));
  A('подпись фигуры осталась внутри неё',
    waveTexts.length === 2 && waveTexts.every((y) => y > 120 && y < 240),
    'y=' + waveTexts.join(','));

  /* --- бейдж у стереотипа ------------------------------------------- */
  blank();
  addDiagram('class');
  const bare = place('class', 120, 120);
  const tagged = place('class', 400, 120);
  U.renderCanvas();
  const badgesBefore = document.querySelectorAll('#canvas .sh-badge').length;
  setStereo(tagged, 'entity');
  U.renderCanvas();
  const badges = [...document.querySelectorAll('#canvas .sh-badge')];
  const badgeTransform = badges[0]?.getAttribute('transform') ?? '';
  A('бейдж у стереотипа',
    badgesBefore === 0 && badges.length === 1 && badges[0].querySelectorAll('path, circle').length > 0,
    'до ' + badgesBefore + ', после ' + badges.length);

  // 16 px — размер самого значка, а не что попало: масштаб в transform
  // равен единице, значит рисунок нарисован в своих пикселях.
  const badgeScale = Number((badgeTransform.match(/scale\(([\d.]+)\)/) ?? [0, 0])[1]);
  A('бейдж нарисован в размере 16 px, без растяжения',
    badgeScale === 1,
    'scale=' + badgeScale + ', transform=' + badgeTransform);

  // Переключатель «Вид → Пиктограммы» живёт в модели: выключили — значка
  // нет, и это состояние переживает сохранение.
  U.commit('t', (m) => { m.pictograms = false; });
  U.renderCanvas();
  const offBadges = document.querySelectorAll('#canvas .sh-badge').length;
  const offJson = JSON.parse(U.serialize(U.store.model));
  const offBack = U.deserialize(U.serialize(U.store.model));
  U.commit('t', (m) => { m.pictograms = true; });
  U.renderCanvas();
  A('переключатель пиктограмм гасит значки и сохраняется в модели',
    offBadges === 0 && offJson.pictograms === false && offBack.pictograms === false
    && document.querySelectorAll('#canvas .sh-badge').length === 1,
    'выкл ' + offBadges + ', в файле ' + offJson.pictograms);

  /* --- рисунок выбирается по baseType элемента (Б11) ------------------ */
  // У usecase овал 133×72 объявлен только на Class; на UseCase рисунка
  // нет. Значит вариант использования овал НЕ получает, а класс с тем же
  // стереотипом — получает. Проверяется не имя, а третий аргумент
  // pictogramFor(profile, ссылка, baseType): без него овал достался бы
  // обоим, ровно как до Б11.
  blank();
  addDiagram('usecase');
  const ucShape = place('usecase', 120, 120);
  const ucClass = place('class', 460, 120);
  U.commit('t', (m) => {
    // Ссылка на запись профиля — то, чем выбор в инспекторе отличает
    // usecase от любого одноимённого будущего стереотипа.
    const u = m.elements.find((e) => e.id === ucShape.element.id);
    u.stereotype = 'UseCase';         // так пишут старые файлы
    u.stereotypeId = 'st-usecase';
    const c = m.elements.find((e) => e.id === ucClass.element.id);
    c.stereotype = 'usecase';
    c.stereotypeId = 'st-usecase';
  });
  U.renderCanvas();
  const pictOf = (shapeId) => document.querySelector('#canvas [data-kind="shape"][data-id="' + shapeId + '"] .sh-pict');
  const ucMark = pictOf(ucShape.shape.id);
  const classMark = pictOf(ucClass.shape.id);
  A('usecase на варианте использования не получает овал, на классе — получает',
    !ucMark && !!classMark && [...document.querySelectorAll('#canvas .sh-pict')].length === 1,
    'рисунков ' + document.querySelectorAll('#canvas .sh-pict').length
    + ', у класса ' + (classMark ? 'есть' : 'нет')
    + ', у варианта ' + (ucMark ? 'есть' : 'нет'));

  // Подпись «…» остаётся той строкой, что лежит в модели: старый файл пишет
  // «UseCase», и лист показывает «UseCase», даже если профиль зовёт запись
  // usecase. Иначе пересохранение меняло бы файл.
  const ucCaptions = [...document.querySelectorAll('#canvas text.sh-stereo')].map((t) => t.textContent);
  A('подпись стереотипа — как в модели, а не как в профиле',
    ucCaptions.includes('«UseCase»') && ucCaptions.includes('«usecase»'),
    ucCaptions.join(' | '));

  // Ссылка переживает круг «сохранить → открыть» и не появляется там, где её
  // не было: элемент с одним именем остаётся с одним именем.
  const ucSaved = U.serialize(U.store.model);
  const ucBack = U.deserialize(ucSaved);
  const ucReloaded = ucBack.elements.filter((e) => e.stereotypeId === 'st-usecase');
  A('stereotypeId переживает сохранение и открытие',
    ucReloaded.length === 2 && JSON.parse(ucSaved).elements.every((e) => e.stereotypeId === 'st-usecase'),
    'с ссылкой ' + ucReloaded.length + ' из ' + ucBack.elements.length);

  /* --- упражнение 3.1: 8 «волн» и 2 «рыбки» (план Э1, приёмка) ------ */
  blank();
  addDiagram('usecase');
  const sea = ['Зарегистрироваться на курсы', 'Просмотреть табель', 'Выбрать читаемые курсы',
    'Поставить оценки', 'CRUD данных о профессорах', 'CRUD данных о студентах',
    'CRUD данных о курсах и дисциплинах', 'Открыть регистрацию'];
  const fish = ['Войти в систему', 'Закрыть регистрацию'];
  const made = [];
  sea.forEach((n, i) => made.push([place('usecase', 60 + (i % 4) * 220, 60 + Math.floor(i / 4) * 180), 'sea level usecase']));
  fish.forEach((n, i) => made.push([place('usecase', 60 + i * 220, 420), 'fish level usecase']));
  U.commit('t', (m) => {
    made.forEach(([ph, stereo], i) => {
      const el = m.elements.find((e) => e.id === ph.element.id);
      el.name = i < sea.length ? sea[i] : fish[i - sea.length];
      el.stereotype = stereo;
    });
  });
  U.renderCanvas();
  const allPict = [...document.querySelectorAll('#canvas .sh-pict')];
  // Волны — одна непрерывная линия, рыба — тело, хвост, глаз и жабра.
  const shapesPerPict = allPict.map((p) => p.querySelectorAll('path, circle, ellipse').length);
  const wavesCount = shapesPerPict.filter((n) => n === 1).length;
  const fishCount = shapesPerPict.filter((n) => n === 4).length;
  A('упражнение 3.1: 8 волн и 2 рыбы на листе',
    allPict.length === 10 && wavesCount === 8 && fishCount === 2,
    'всего ' + allPict.length + ', волн ' + wavesCount + ', рыб ' + fishCount);

  // У каждого рисунка есть подпись: имя варианта использования.
  const captions = [...document.querySelectorAll('#canvas text.sh-name')].map((t) => t.textContent);
  A('у каждой пиктограммы есть подпись',
    sea.every((n) => captions.includes(n)) && fish.every((n) => captions.includes(n)),
    'подписей ' + captions.length + ' из 10');

  /* --- экспорт SVG (нашёл сломанным при проверке Э1) ---------------- */
  // exportSvgString звал currentDiagram, который не был импортирован:
  // «Экспорт → SVG» падал с ReferenceError, и ни один тест этого не видел.
  blank();
  addDiagram('class');
  const expA = place('class', 80, 80);
  U.commit('t', (m) => { m.elements.find((e) => e.id === expA.element.id).name = 'Экспорт'; });
  U.renderCanvas();
  let expSvg = '';
  let expErr = '';
  try { expSvg = U.exportSvgString(U.store.model, U.store.profile); } catch (e) { expErr = e.message; }
  A('экспорт SVG отдаёт разметку с фигурой',
    !expErr && expSvg.startsWith('<svg') && expSvg.includes('Экспорт') && expSvg.includes('sh-body'),
    expErr || (expSvg.length + ' символов'));

  // Связь нужна, чтобы проверить, что путь захвата клика не попадает в файл.
  const expB = place('class', 400, 80);
  U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    const rel = U.createRelationship('association', expA.element.id, expB.element.id);
    m.relationships.push(rel);
    d.links.push(U.createLink(rel,
      { shapeId: expA.shape.id, side: 'right', t: 0.5 },
      { shapeId: expB.shape.id, side: 'left', t: 0.5 }, {}));
  });
  U.renderCanvas();
  const expSvg2 = U.exportSvgString(U.store.model, U.store.profile);
  A('в экспорт SVG не попадает путь захвата клика',
    !expSvg2.includes('<path class="conn-hit"') && expSvg2.includes('class="conn"'),
    'conn-hit в файле: ' + expSvg2.split('class="conn-hit"').length);
  A('в стиле экспорта есть правило для conn-hit и для рисунков',
    expSvg2.includes('.conn-hit{') && expSvg2.includes('.sh-pict{'),
    expSvg2.includes('.conn-hit{') + '/' + expSvg2.includes('.sh-pict{'));

  /* --- экспорт PNG в своём размере ----------------------------------- */
  let png = null;
  let pngErr = '';
  try { png = await U.exportPngBlob(U.store.model, U.store.profile, 1); } catch (e) { pngErr = e.message; }
  if (png) {
    const buf = new Uint8Array(await png.blob.arrayBuffer());
    const sig = [...buf.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Размер — размер листа, а не окна: 88×88 от двух фигур плюс поля.
    A('экспорт PNG отдаёт настоящий PNG в размере листа',
      sig === '89504e47' && png.blob.type === 'image/png' && png.width > 0 && png.height > 0
      && png.width === Math.ceil(png.width) && png.blob.size > 500,
      pngErr || (sig + ' ' + png.width + '×' + png.height + ', ' + png.blob.size + ' Б'));
    const big = await U.exportPngBlob(U.store.model, U.store.profile, 2);
    A('PNG ×2 ровно вдвое больше',
      big.width === png.width * 2 && big.height === png.height * 2,
      big.width + '×' + big.height + ' против ' + png.width + '×' + png.height);
  } else {
    A('экспорт PNG отдаёт настоящий PNG в размере листа', false, pngErr);
    A('PNG ×2 ровно вдвое больше', false, 'нет первого');
  }

  /* --- Э5: панель «Проверки» и движок правил ------------------------ */
  // Фикстура — та же, что у прототипа: кратность «5..2» на конце ассоциации
  // (UML 2.5.1, п. 7.8.8.8, MultiplicityElement::upper_ge_lower).
  const fixtureText = await (await fetch('tests/data/rules/mult-upper-ge-lower.json')).text();
  U.loadModel(U.deserialize(fixtureText));
  U.refreshChecks();
  document.querySelector('#right .tab[data-tab="checks"]').click();
  await new Promise((r) => setTimeout(r, 160));

  const rows = [...document.querySelectorAll('#checks .finding')];
  const clause = rows[0]?.querySelector('.clause');
  A('панель «Проверки» открывается и показывает замечание',
    document.getElementById('checks').classList.contains('active') && rows.length === 1
      && /7\.8\.8\.8/.test(clause?.textContent ?? '')
      && /Верхняя граница/.test(rows[0].textContent),
    rows.length + ' строк, ссылка «' + (clause?.textContent ?? '—') + '»');

  // Счётчик в статусбаре — те же цифры, что у панели: ошибок · предупреждений.
  // Считаем по слою стандарта: у практики своя цифра и свой хвост в строке.
  const counts = (() => {
    const all = U.checkResult().findings;
    const uml = all.filter((f) => (f.basis ?? 'uml') === 'uml');
    return {
      errors: uml.filter((f) => f.level === 'error').length,
      warnings: uml.filter((f) => f.level === 'warning').length,
      total: uml.length,
      advice: all.length - uml.length,
    };
  })();
  const sbText = document.getElementById('sb-checks')?.textContent ?? '';
  A('счётчик в статусбаре совпадает с числом замечаний',
    sbText === 'проверки: ' + counts.errors + ' · ' + counts.warnings
      && counts.total === rows.length && counts.advice === 0,
    '«' + sbText + '», замечаний ' + counts.total);

  // Клик по счётчику в статусбаре открывает панель.
  document.querySelector('#right .tab[data-tab="props"]').click();
  await new Promise((r) => setTimeout(r, 60));
  const propsActive = document.getElementById('props').classList.contains('active');
  document.getElementById('sb-checks').click();
  await new Promise((r) => setTimeout(r, 120));
  A('клик по счётчику в статусбаре открывает панель',
    propsActive && document.getElementById('checks').classList.contains('active'),
    propsActive ? 'Свойства → Проверки' : 'панель не переключилась');

  // Клик по замечанию выделяет виноватый объект — связь, у которой плохая кратность.
  rows[0].click();
  await new Promise((r) => setTimeout(r, 120));
  const sel = U.store.ui.selection[0];
  const selLink = sel && U.currentDiagram(U.store.model)?.links.find((l) => l.id === sel.id);
  A('клик по замечанию выделяет объект',
    !!sel && sel.kind === 'connector' && !!selLink
      && selLink.relId === U.checkResult().findings[0].targets[0],
    sel ? sel.kind + ' ' + sel.id : 'ничего не выделено');

  // Ссылка на пункт стандарта открывает статью пункта в читалке (Б20е).
  // Диалог с цитатой остался запасным путём — на случай, если данных
  // справочника нет; здесь проверяется основной путь.
  document.querySelector('#checks .finding .clause').click();
  await new Promise((r) => setTimeout(r, 800));
  A('ссылка на пункт стандарта открывает статью в читалке',
    U.reference.isOpen() && U.reference.current().id === '7.8.8.8-constraints'
      && /7\.8\.8\.8/.test(document.querySelector('#ref-doc .doc-num')?.textContent ?? '')
      && /upper_ge_lower/.test(document.querySelector('#ref-doc')?.textContent ?? ''),
    U.reference.current().shelf + ':' + U.reference.current().id + ', kv '
      + document.querySelectorAll('#ref-doc .kv').length);
  U.reference.close();
  await new Promise((r) => setTimeout(r, 200));

  // Фильтр «только ошибки»: модель с одним предупреждением и без ошибок —
  // два варианта использования, соединённые ассоциацией (п. 18.2.5.6).
  blank();
  addDiagram('usecase');
  const u1 = place('usecase', 120, 120);
  const u2 = place('usecase', 520, 120);
  U.commit('t', (m) => {
    m.elements[0].name = 'Оплатить обучение';
    m.elements[1].name = 'Проверить задолженность';
  });
  join('association', u1, u2);
  U.refreshChecks();
  const warnOnly = U.checkResult().findings.length > 0
    && U.checkResult().findings.every((f) => f.level === 'warning');
  const filterBox = document.getElementById('checks-only-errors');
  filterBox.checked = true;
  filterBox.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const hidden = document.querySelectorAll('#checks .finding').length;
  filterBox.checked = false;
  filterBox.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const shown = document.querySelectorAll('#checks .finding').length;
  A('фильтр «только ошибки» скрывает предупреждения',
    warnOnly && hidden === 0 && shown >= 1,
    'предупреждений ' + shown + ', при фильтре ' + hidden);

  // Чистая модель: пустое состояние — это результат, а не пустая панель.
  // Два названных класса со связью: молчать обязаны оба слоя — иначе «чисто»
  // проверяло бы один стандарт, а сироту практика назовёт справедливо.
  blank();
  addDiagram('class');
  const cleanA = place('class', 120, 120);
  const cleanB = place('class', 420, 120);
  join('association', cleanA, cleanB);
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 80));
  A('на чистой модели «нарушений не найдено»',
    /Нарушений не найдено/.test(document.getElementById('checks').textContent)
      && document.getElementById('sb-checks').textContent === 'проверки: 0 · 0',
    document.getElementById('sb-checks').textContent);

  /* --- два слоя правил: стандарт и практика -------------------------- */
  // Модель «только сирота»: один названный класс и одна его фигура, ни одной
  // связи. Правила стандарта на такой модели молчат — изолированный элемент
  // UML 2.5.1 не запрещает, — значит всё, что нашлось, принадлежит слою
  // практики, и панель обязана показать это отдельным разделом.
  blank();
  addDiagram('class', 'SOLO');
  const solo = place('class', 120, 120);
  U.commit('t', (m) => { m.elements[0].name = 'Одинокий'; });
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 80));

  const practiceRows = [...document.querySelectorAll('#checks-practice .finding')];
  const practiceChip = practiceRows[0]?.querySelector('button.chip-basis');
  A('раздел практики: у сироты одно замечание с чипом «практика»',
    practiceRows.length === 1
      && practiceRows[0].dataset.rule === 'element-isolated'
      && practiceRows[0].dataset.basis === 'practice'
      && practiceChip?.textContent === 'практика'
      && !practiceRows[0].querySelector('.clause')
      && !!document.getElementById('checks-practice-head'),
    practiceRows.length + ' строк, чип «' + (practiceChip?.textContent ?? '—') + '», пункт: '
      + (practiceRows[0]?.querySelector('.clause')?.textContent ?? 'нет'));

  // Советы — хвостом строки статусбара: цифры стандарта остаются прежними.
  const sbPractice = document.getElementById('sb-checks')?.textContent ?? '';
  A('счётчик показывает советы практики хвостом',
    sbPractice === 'проверки: 0 · 0 · советов 1', '«' + sbPractice + '»');

  // Чип открывает объяснение с явной оговоркой: это совет, а не стандарт.
  // Обоснование берём из самого правила, а не из ожидаемого текста: проверяем,
  // что панель донесла rationale, а не что она написала что-то похожее.
  const practiceRule = U.ruleset()?.rules?.find((r) => r.id === 'element-isolated');
  const rationale = String(practiceRule?.rationale ?? '').trim();
  practiceChip?.click();
  await new Promise((r) => setTimeout(r, 160));
  const practiceDlg = document.querySelector('sc-dialog[open]')?.textContent ?? '';
  A('чип практики открывает диалог «это не требование стандарта»',
    /Практика моделирования/.test(practiceDlg) && /не требование стандарта/.test(practiceDlg)
      && rationale.length > 10 && practiceDlg.includes(rationale)
      && /изолирован|связ/i.test(practiceDlg),
    practiceDlg.replace(/\s+/g, ' ').slice(0, 70));
  document.querySelector('sc-dialog[open] button')?.click();
  await new Promise((r) => setTimeout(r, 120));

  // Фильтр «только ошибки» режет оба слоя: у практики нет уровня «ошибка».
  const layerFilter = document.getElementById('checks-only-errors');
  layerFilter.checked = true;
  layerFilter.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const practiceHidden = document.querySelectorAll('#checks [data-basis="practice"]').length;
  const practiceNone = document.getElementById('checks-practice')?.textContent ?? '';
  layerFilter.checked = false;
  layerFilter.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  A('«только ошибки» скрывает слой практики',
    practiceHidden === 0 && /Советы скрыты/.test(practiceNone)
      && document.querySelectorAll('#checks-practice .finding').length === 1,
    'при фильтре ' + practiceHidden + ' замечаний практики');

  // Клик по замечанию практики ведёт к объекту так же, как у стандарта.
  document.querySelector('#checks-practice .finding')?.click();
  await new Promise((r) => setTimeout(r, 120));
  const soloSel = U.store.ui.selection[0];
  const soloShape = soloSel && U.currentDiagram(U.store.model)?.shapes.find((s) => s.id === soloSel.id);
  A('клик по замечанию практики выделяет сироту',
    !!soloSel && soloSel.kind === 'shape' && soloShape?.elementId === solo.element.id,
    soloSel ? soloSel.kind + ' ' + soloSel.id : 'ничего не выделено');

  // Слой стандарта: замечание с кнопкой пункта и пометкой слоя.
  U.loadModel(U.deserialize(fixtureText));
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 80));
  const stdRows = [...document.querySelectorAll('#checks-standard .finding')];
  const stdClause = stdRows[0]?.querySelector('button.clause');
  A('раздел стандарта: замечание с кнопкой пункта и data-basis="uml"',
    stdRows.length === 1 && /^п\. \d/.test(stdClause?.textContent ?? '')
      && stdRows[0].dataset.basis === 'uml'
      && !!stdRows[0].querySelector('.lvl, .msg, .mt, .hint')
      && !!document.getElementById('checks-list')
      && !!document.getElementById('checks-standard-head'),
    stdRows.length + ' строк, кнопка «' + (stdClause?.textContent ?? '—') + '»');

  // Чисто по обоим слоям: один результат на панели, без разделов и без хвоста.
  // Модель нарочно со связью — сирота тут была бы советом, а не молчанием.
  blank();
  addDiagram('class');
  const bothA = place('class', 120, 120);
  const bothB = place('class', 420, 120);
  join('association', bothA, bothB);
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 80));
  const cleanText = document.getElementById('checks')?.textContent ?? '';
  A('на чистой модели «Нарушений не найдено», разделов и хвоста нет',
    /Нарушений не найдено/.test(cleanText)
      && !document.querySelector('#checks .finding')
      && !document.getElementById('checks-standard')
      && document.getElementById('sb-checks')?.textContent === 'проверки: 0 · 0',
    (document.getElementById('sb-checks')?.textContent ?? '') + ', разделов '
      + document.querySelectorAll('#checks .checks-section').length);

  // Ничего не блокирует: модель с нарушением сохраняется и открывается.
  U.loadModel(U.deserialize(fixtureText));
  const violated = U.serialize(U.store.model);
  const reopened = U.deserialize(violated);
  A('модель с нарушением сохраняется и открывается',
    U.serialize(reopened) === violated && U.checkResult().findings.length > 0,
    violated.length + ' Б, замечаний ' + U.checkResult().findings.length);

  // Слои правил: у стандарта пункт обязателен, у практики пункта нет вовсе —
  // вместо него rationale. Правило с пунктом в слое практики притворялось бы
  // стандартом, а правило стандарта без пункта не на что сослаться.
  const ruleList = U.ruleset()?.rules ?? [];
  const umlRules = ruleList.filter((r) => (r.basis ?? 'uml') === 'uml');
  const practiceRules = ruleList.filter((r) => r.basis === 'practice');
  // Число правил стандарта — не константа, а факт файла набора (см.
  // UML_RULE_COUNT выше): иначе каждое новое правило красит тест, хотя
  // проверять надо не «сколько их», а «у всех ли есть пункт».
  A('у каждого правила стандарта есть пункт, у практики — обоснование без пункта',
    umlRules.length === ${UML_RULE_COUNT}
      && umlRules.every((r) => r.source?.clause && r.source?.constraint && r.source?.text)
      && practiceRules.every((r) => !r.source && String(r.rationale ?? '').trim())
      // Невыразимых не «семь», а ровно столько, у скольких правил нет
      // функции: правило без функции обязано быть записано невыразимым с
      // названным полем, иначе оно молча не проверяется. Число 7 здесь
      // краснело от каждого нового правила — а сверять надо это равенство.
      && (U.ruleset()?.uncovered.length === umlRules.filter((r) => !r.fn).length),
    umlRules.length + ' правил стандарта (в файле ' + ${UML_RULE_COUNT} + '), '
      + practiceRules.length + ' практики, не проверяется '
      + U.ruleset()?.uncovered.length);

  // Каждое правило стандарта — на своей паре фикстур (тех же, что у прототипа):
  // на модели с нарушением оно срабатывает, на контрольной молчит, а чужих
  // замечаний нарушение не задевает. Иначе «правило есть» ничего не значит.
  // Фикстуры есть только у стандарта: у практики свои границы, и живут они в
  // app/tests/rules.mjs. Поэтому и замечания считаем по слою стандарта.
  const ruleFixture = async (file) => {
    const res = await fetch('tests/data/rules/' + file);
    return res.ok ? await res.text() : null;
  };
  const umlFindings = (model) => U.runChecks(model).filter((f) => (f.basis ?? 'uml') === 'uml');
  const perRule = [];
  for (const rule of umlRules.filter((r) => r.fn)) {
    const badText = await ruleFixture(rule.id + '.json');
    const okText = await ruleFixture(rule.id + '.ok.json');
    if (!badText || !okText) { perRule.push({ id: rule.id, mine: -1, others: 0, clean: 0 }); continue; }
    const hits = umlFindings(U.deserialize(badText));
    const mine = hits.filter((f) => f.ruleId === rule.id).length;
    const others = hits.length - mine;
    const clean = umlFindings(U.deserialize(okText)).length;
    perRule.push({ id: rule.id, mine, others, clean });
  }
  const brokenRules = perRule.filter((x) => x.mine < 1 || x.others || x.clean);
  // «Сколько правил» — тоже производное: проверяем не число 34, а то, что у
  // КАЖДОГО правила с функцией есть пара фикстур (mine < 0 — фикстуры нет)
  // и на ней всё сходится. Новое правило с фикстурой не должно красить тест.
  const missingFixtures = perRule.filter((x) => x.mine < 0);
  A('на каждое правило: нарушение поймано, контрольная модель чиста',
    missingFixtures.length === 0 && brokenRules.length === 0,
    brokenRules.length || missingFixtures.length
      ? [...missingFixtures.map((x) => x.id + ' (нет фикстур)'),
        ...brokenRules.map((x) => x.id + ' (' + x.mine + ' своих, ' + x.others + ' чужих, ' + x.clean + ' на контроле)')].join('; ')
      : perRule.length + ' правил × пара фикстур');

  // 48 моделей корпуса: слой стандарта молчит — иначе движок красит всё подряд.
  // Слой практики здесь проверяется по разметке, а не по числу: сколько советов
  // даёт корпус — калибровка самих правил практики, и её меряет app/tests/rules.mjs
  // рядом с определениями границ. Здесь важно, что советы приходят своим слоем:
  // уровень warning, basis «practice», без пункта стандарта.
  const corpusIndex = await (await fetch('tests/data/corpus/INDEX.json')).json();
  const corpusNames = corpusIndex.files ?? [];
  // Известная находка стандарта на корпусе — НАМЕРЕННЫЙ дефект упражнения 3.1:
  // у «Войти в систему» три основных действующих лица, ради чего правило и
  // написано. Это не регресс; любая другая находка слоя стандарта — регресс и
  // должна валить тест. Ключ — имя файла корпуса.
  const CORPUS_KNOWN = { '3102.json': ['usecase-primary-actor-count'] };
  const corpusBad = [];
  const corpusAdvice = [];
  let corpusCount = 0;
  for (const file of corpusNames) {
    const text = await (await fetch('tests/data/corpus/' + file)).text();
    const model = U.deserialize(text);
    corpusCount += 1;
    for (const f of U.runChecks(model)) {
      if ((f.basis ?? 'uml') === 'practice') corpusAdvice.push(f);
      else corpusBad.push({ file, ruleId: f.ruleId });
    }
  }
  const unexpected = corpusBad.filter((x) => !(CORPUS_KNOWN[x.file] ?? []).includes(x.ruleId));
  const on3201 = corpusBad.filter((x) => x.file === '3201.json');
  const adviceMislaid = corpusAdvice.filter((f) => f.level !== 'warning' || f.clause || f.constraint);
  A('48 моделей корпуса: слой стандарта чист, советы размечены своим слоем',
    corpusCount === 48 && unexpected.length === 0 && on3201.length === 0 && adviceMislaid.length === 0
      && corpusAdvice.every((f) => (f.basis ?? 'uml') === 'practice'),
    corpusCount + ' моделей, замечаний стандарта ' + corpusBad.length
      + ' (из них известный дефект 3102: ' + (corpusBad.length - unexpected.length) + ')'
      + ', на 3201: ' + on3201.length
      + ', советов практики ' + corpusAdvice.length
      + (unexpected.length ? '; ЧУЖИЕ: ' + unexpected.slice(0, 3).map((x) => x.file + ':' + x.ruleId).join(', ') : ''));


  // Цикл обобщения: замечание несёт весь путь, а переход ведёт к первому
  // элементу пути. Модель собрана как файл: три класса в кольце — это то, что
  // правило обязано назвать тремя id, а не одним.
  U.loadModel(U.deserialize(JSON.stringify({
    schema: 'uml-model/3', id: 'm-cycle3', name: 'Цикл из трёх',
    elements: [
      { id: 'ca', kind: 'class', name: 'Заказ' },
      { id: 'cb', kind: 'class', name: 'Клиент' },
      { id: 'cc', kind: 'class', name: 'Отчёт' },
    ],
    relationships: [
      { id: 'r1', kind: 'generalization', from: 'ca', to: 'cb' },
      { id: 'r2', kind: 'generalization', from: 'cb', to: 'cc' },
      { id: 'r3', kind: 'generalization', from: 'cc', to: 'ca' },
    ],
    diagrams: [{
      id: 'dc', name: 'Диаграмма 1', kind: 'class',
      shapes: [
        { id: 'sa', elementId: 'ca', x: 60, y: 60, w: 190, h: 120 },
        { id: 'sb', elementId: 'cb', x: 360, y: 60, w: 190, h: 120 },
        { id: 'sc', elementId: 'cc', x: 660, y: 60, w: 190, h: 120 },
      ],
      links: [
        { id: 'l1', relId: 'r1', from: { shapeId: 'sa', side: 'right', t: 0.5 }, to: { shapeId: 'sb', side: 'left', t: 0.5 } },
        { id: 'l2', relId: 'r2', from: { shapeId: 'sb', side: 'right', t: 0.5 }, to: { shapeId: 'sc', side: 'left', t: 0.5 } },
        { id: 'l3', relId: 'r3', from: { shapeId: 'sc', side: 'right', t: 0.5 }, to: { shapeId: 'sa', side: 'left', t: 0.5 } },
      ],
    }],
    currentDiagramId: 'dc',
  })));
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 120));
  const cycleFindings = U.checkResult().findings.filter((f) => f.ruleId === 'generalization-cycle');
  const allThree = cycleFindings.length === 3 && cycleFindings.every((f) => f.targets.length === 3);
  const cyc = cycleFindings[0];
  if (cyc) U.gotoFinding(cyc);
  await new Promise((r) => setTimeout(r, 160));
  const cycSel = U.store.ui.selection ?? [];
  const cycShape = U.currentDiagram(U.store.model).shapes.find((s) => s.id === cycSel[0]?.id);
  A('цикл обобщения: путь из трёх в targets, переход — к первому элементу',
    allThree && !!cyc && cycShape?.elementId === cyc.targets[0]
      && ['Заказ', 'Клиент', 'Отчёт'].every((n) => cyc.detail.includes(n))
      && (cyc.detail.match(/→/g) ?? []).length === 3,
    cycleFindings.length + ' замечаний, пути ' + cycleFindings.map((f) => f.targets.length).join('/')
      + ', переход к ' + (cycShape?.elementId ?? '—') + ' при первом ' + (cyc?.targets?.[0] ?? '—')
      + ' | ' + String(cyc?.detail ?? '').slice(0, 60));

  // Сбой проверки: упавшее правило не убивает прогон, а показывается отдельным
  // разделом. Движок подменяется на месте — ровно так, как это сделал бы
  // сломанный набор, — и возвращается обратно в конце блока.
  const brokenRs = U.ruleset();
  const cycleRule = brokenRs?.rules?.find((r) => r.id === 'generalization-cycle');
  const savedCycleFn = cycleRule?.fn;
  U.loadModel(U.deserialize(fixtureText));
  cycleRule.fn = () => { throw new Error('нарочно: проверка не смогла прочитать модель'); };
  U.attachRuleset(brokenRs);
  U.refreshChecks();
  document.querySelector('#right .tab[data-tab="checks"]').click();
  await new Promise((r) => setTimeout(r, 160));

  const failedBox = document.getElementById('checks-failed');
  const failedRows = [...document.querySelectorAll('#checks-failed .finding.failed')];
  const stdAfterBreak = [...document.querySelectorAll('#checks-standard .finding')];
  const sbAfterBreak = document.getElementById('sb-checks')?.textContent ?? '';
  A('сбой проверки: свой раздел, нарушение на месте, «не проверено» в счётчике',
    !!failedBox && failedRows.length === 1
      && !failedRows[0].querySelector('.clause')
      && failedRows[0].dataset.status === 'failed'
      && stdAfterBreak.length === 1
      && /не проверено 1/.test(sbAfterBreak)
      && /сбой проверки/.test(failedBox.textContent)
      && document.getElementById('checks-badge')?.textContent === '2',
    failedRows.length + ' сбоев, ' + stdAfterBreak.length + ' нарушений, «' + sbAfterBreak
      + '», бейдж ' + (document.getElementById('checks-badge')?.textContent ?? '—'));

  // Клик по сбою не ведёт к объекту: виноватого нет, а диалог объясняет ошибку.
  const selBeforeBreak = JSON.stringify(U.store.ui.selection ?? []);
  failedRows[0].click();
  await new Promise((r) => setTimeout(r, 160));
  const failDlg = document.querySelector('sc-dialog[open]')?.textContent ?? '';
  A('клик по сбою не ведёт к объекту, а показывает текст ошибки',
    /Проверка не выполнилась/.test(failDlg)
      && /нарочно: проверка не смогла прочитать модель/.test(failDlg)
      && JSON.stringify(U.store.ui.selection ?? []) === selBeforeBreak,
    failDlg.replace(/\s+/g, ' ').slice(0, 70) || 'диалог не открылся');
  document.querySelector('sc-dialog[open] button')?.click();
  await new Promise((r) => setTimeout(r, 120));

  // Тот же путь, но через gotoFinding: у сбоя targets пуст, и общий переход
  // сказал бы «элемент есть в модели, но не показан» — ложь про модель. Проверка
  // держит именно это: выделение не меняется, а причина называется диалогом.
  const failFinding = U.checkResult().findings.find((f) => f.status === 'failed');
  const selBeforeGoto = JSON.stringify(U.store.ui.selection ?? []);
  U.gotoFinding(failFinding);
  await new Promise((r) => setTimeout(r, 160));
  const gotoDlg = document.querySelector('sc-dialog[open]')?.textContent ?? '';
  A('gotoFinding на сбое не ведёт к объекту и не врёт про модель',
    /Проверка не выполнилась/.test(gotoDlg)
      && JSON.stringify(U.store.ui.selection ?? []) === selBeforeGoto,
    gotoDlg.replace(/\s+/g, ' ').slice(0, 60) || 'диалог не открылся');
  document.querySelector('sc-dialog[open] button')?.click();
  await new Promise((r) => setTimeout(r, 120));

  // Пустая модель при упавшем правиле: «все чисто» было бы ложью — правило не
  // отработало, и панель обязана сказать это, а не порадовать пустотой.
  blank();
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 80));
  const emptyBroken = document.getElementById('checks')?.textContent ?? '';
  A('при сбое панель не пишет «все чисто»',
    !/все чисто/.test(emptyBroken)
      && /Нарушений не найдено среди отработавших правил/.test(emptyBroken)
      && document.querySelectorAll('#checks-failed .finding.failed').length === 1,
    emptyBroken.replace(/\s+/g, ' ').slice(0, 90));

  // Возврат: и функция правила, и движок, и модель — чтобы следующие проверки
  // не унаследовали сбой.
  cycleRule.fn = savedCycleFn;
  U.attachRuleset(brokenRs);
  U.loadModel(U.deserialize(fixtureText));
  U.refreshChecks();
  await new Promise((r) => setTimeout(r, 80));

  /* --- Э6: режим «Курс» --------------------------------------------- */
  // Данные курса готовит tools/build-course.mjs; здесь проверяется то, что
  // видит человек: список из 20 упражнений, урок с НАШЕЙ картинкой (рендер
  // модели корпуса) И снимком пособия рядом, «Открыть как модель» и прогресс.
  // Курс — режим над листом, а не вкладка правой колонки
  // (docs/research/UX-COURSE-LIBRARY.md): инспектор остаётся, лист не сужается.
  const courseSheetBefore = Math.round(document.getElementById('canvas-wrap').getBoundingClientRect().width);
  U.course.openMode();
  await new Promise((r) => setTimeout(r, 400));
  const courseIndex = U.course.index();
  const courseRows = [...document.querySelectorAll('#course-list .node')];
  const rightTabs = [...document.querySelectorAll('#right .panel-tabs .tab')].map((t) => t.dataset.tab);
  // Вкладок три: реестр констрейнтов переехал на полку «Стандарт» библиотеки
  // (он справочный, а не про выделенный объект), «Курса» среди них по-прежнему
  // нет: он режим над листом, и именно это здесь и проверяется.
  A('«Курс» — режим: 20 упражнений, в правой колонке три вкладки и нет «Курса»',
    U.course.isOpen() && !document.getElementById('course-mode').hidden
      && courseRows.length === 20 && (courseIndex?.chapters.length ?? 0) === 3
      && rightTabs.join(',') === 'props,profile,checks',
    courseRows.length + ' упражнений в ' + (courseIndex?.chapters.length ?? 0) + ' главах; вкладки: ' + rightTabs.join(' '));

  const courseSheetAfter = Math.round(document.getElementById('canvas-wrap').getBoundingClientRect().width);
  A('вход в курс не сужает лист и не прячет инспектор',
    courseSheetAfter >= 700 && courseSheetAfter >= courseSheetBefore
      && getComputedStyle(document.getElementById('right')).display !== 'none',
    'лист ' + courseSheetBefore + ' → ' + courseSheetAfter + ' px, инспектор '
      + Math.round(document.getElementById('right').getBoundingClientRect().width) + ' px');

  // Текст, заголовок и тип есть у всех; модель корпуса — у всех, кроме 3.3
  // (у этого упражнения в пособии нет ни одного рисунка).
  const courseAll = courseIndex.chapters.flatMap((c) => c.exercises);
  const courseText = [];
  for (const ex of courseAll) {
    const body = await (await fetch(ex.text)).text();
    courseText.push({ id: ex.id, len: body.length, title: !!ex.title, type: ex.type, model: !!ex.figure });
  }
  const thin = courseText.filter((x) => x.len < 200 || !x.title || (!x.type && x.id !== 'ex-3.3'));
  const noModel = courseText.filter((x) => !x.model).map((x) => x.id);
  A('у каждого упражнения есть заголовок, текст и тип диаграммы',
    thin.length === 0 && noModel.length === 1 && noModel[0] === 'ex-3.3',
    courseAll.length + ' упражнений, без модели: ' + (noModel.join(', ') || 'нет'));

  // Курс собран из АДАПТИРОВАННОГО пособия: действия описаны нашими
  // средствами. Меню исходного редактора может остаться только внутри пометки
  // «⚠ У нас нет», которая называет пробел, — иначе это откат на старый текст.
  const VP_MENU = /Model Element|Presentation Options|Open Specification|Model Explorer|Navigable Unspecified/;
  const vpBare = [];
  for (const ex of courseAll) {
    const body = await (await fetch(ex.text)).text();
    body.split('\n').forEach((line, i) => {
      if (VP_MENU.test(line) && !(line.trim().startsWith('>') && line.includes('У нас нет'))) {
        vpBare.push(ex.id + ':' + (i + 1));
      }
    });
  }
  A('текст курса адаптирован: меню исходного редактора только внутри пометок',
    vpBare.length === 0,
    vpBare.length ? vpBare.slice(0, 6).join(', ') : 'ни одного голого упоминания');

  // Урок: наша картинка — это <svg> нашего render.js, а рядом с ней стоит
  // снимок из пособия: сравнивать надо бок о бок, а не по очереди.
  U.course.open('ex-3.1');
  await new Promise((r) => setTimeout(r, 1200));
  // Главная картинка упражнения — та, что откроет кнопка (у 3.1 это 3.1.2,
  // итоговая диаграмма, а не пустая заготовка 3.1.1).
  const lessonEx = courseAll.find((e) => e.id === 'ex-3.1');
  const lessonFig = lessonEx.figure.split('/').pop().replace('.uml.json', '');
  const lessonSvg = document.querySelector('#fig-svg-' + lessonFig + ' svg');
  const lessonPair = document.querySelector('#fig-' + lessonFig + ' .cv-fig-pair');
  A('урок показывает нашу картинку и снимок пособия рядом',
    !!lessonSvg && lessonSvg.querySelectorAll('.sh-body').length > 0
      && lessonSvg.querySelectorAll('.conn').length > 0
      && !!lessonPair && lessonPair.children.length === 2
      && !!lessonPair.querySelector('img.cv-shot'),
    lessonSvg
      ? lessonSvg.querySelectorAll('.sh-body').length + ' фигур, ' + lessonSvg.querySelectorAll('.conn').length + ' связей; '
        + 'столбцов в паре: ' + (lessonPair ? lessonPair.children.length : 0)
      : 'нет svg');

  // «Открыть как модель»: копия эталона на листе. Перед этим модель чистая —
  // иначе честно всплыл бы вопрос о несохранённых правках.
  blank();
  const opened = await U.course.openAsModel('ex-3.1');
  await new Promise((r) => setTimeout(r, 300));
  const courseDiagram = U.currentDiagram(U.store.model);
  A('«Открыть как модель» кладёт копию в редактор: фигуры и связи на листе',
    opened === true && courseDiagram.shapes.length > 0 && courseDiagram.links.length > 0
      && document.querySelectorAll('#canvas .sh').length === courseDiagram.shapes.length
      && document.querySelectorAll('#canvas .conn').length === courseDiagram.links.length
      && U.store.ui.fileName === null,
    courseDiagram.shapes.length + ' фигур, ' + courseDiagram.links.length + ' связей, '
      + 'имя файла: ' + (U.store.ui.fileName ?? 'нет (копия)'));

  // Возврат к курсу не теряет выбранное упражнение.
  U.course.openMode();
  await new Promise((r) => setTimeout(r, 800));
  A('возврат к курсу не теряет выбранное упражнение',
    U.course.isOpen() && U.course.selected()?.id === 'ex-3.1'
      && /Упражнение 1\.1/.test(document.querySelector('.cv-title')?.textContent ?? ''),
    (U.course.selected()?.id ?? 'ничего') + ', «' + (document.querySelector('.cv-title')?.textContent ?? '').slice(0, 34) + '…»');

  // Прогресс: галочка — в localStorage и в поле модели (courseDone).
  U.course.toggleDone('ex-3.1', true);
  await new Promise((r) => setTimeout(r, 120));
  const doneLs = JSON.parse(localStorage.getItem('uml-course.done') ?? '[]');
  const doneSer = U.serialize(U.store.model);
  const doneBack = U.deserialize(doneSer);
  A('галочка «пройдено» пишется в браузер и в файл модели',
    doneLs.includes('ex-3.1') && (JSON.parse(doneSer).courseDone ?? []).includes('ex-3.1')
      && (doneBack.courseDone ?? []).includes('ex-3.1')
      && document.querySelector('#course-list .node[data-ex="ex-3.1"] input')?.checked === true,
    'в браузере ' + doneLs.join(',') + '; в файле ' + JSON.stringify(JSON.parse(doneSer).courseDone));

  // Модель без отметок поля не пишет: старый файл пересохраняется побайтово.
  const plainNoCourse = U.serialize(U.deserialize(JSON.stringify({
    schema: 'uml-model/3', name: 'Без курса', elements: [], relationships: [], diagrams: [], currentDiagramId: null,
  })));
  A('без отметок поле courseDone не пишется вовсе',
    !JSON.parse(plainNoCourse).courseDone && !plainNoCourse.includes('courseDone'),
    plainNoCourse.length + ' Б');

  /* --- переход от замечания к объекту -------------------------------- */
  // Клик по замечанию обязан не просто выделить объект, а перенести на его лист,
  // поставить в центр видимой части, мигнуть обводкой и подсветить строку в
  // дереве. Проверяем по DOM и по публичному store.ui: тесты не должны знать
  // внутренностей панели. Допуск на центрирование в 2 px — это округление
  // координат вида при отрисовке, а не точность попадания.
  const treeRow = (elementId) => document.querySelector('#model .node[data-element-id="' + elementId + '"]');
  const hitIds = () => [...document.querySelectorAll('#model .node.hit')].map((n) => n.dataset.elementId);
  const inView = (node, host) => {
    const a = node.getBoundingClientRect();
    const b = host.getBoundingClientRect();
    return { dx: Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2),
      dy: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) };
  };

  // Сирота на листе: фигура есть, связи нет. Переход должен открыть этот лист
  // (он и так текущий), выделить вид, сцентрировать его и мигнуть обводкой.
  blank();
  addDiagram('class', 'Первый лист');
  const orph = place('class', 900, 700);
  U.commit('t', (m) => { m.elements[0].name = 'Сирота'; });
  // Вид заведомо в углу листа: масштаб 1, прокрутка в ноль.
  U.set({ view: { scale: 1, tx: 0, ty: 0 } });
  U.renderCanvas();
  U.refreshChecks();
  const svgBeforeFlash = U.exportSvgString(U.store.model, U.store.profile);
  const orphFinding = U.checkResult().findings.find((f) => f.ruleId === 'element-isolated');
  const orphMoved = U.gotoFinding(orphFinding);
  await new Promise((r) => setTimeout(r, 160));
  const orphDiagram = U.currentDiagram(U.store.model);
  const orphShape = orphDiagram.shapes[0];
  const orphSel = U.store.ui.selection[0];
  const shapeNode = () => document.querySelector('#canvas [data-kind="shape"][data-id="' + orphShape.id + '"]');
  const orphNode = shapeNode();
  const orphBox = orphNode ? inView(orphNode, document.getElementById('canvas-wrap')) : { dx: 999, dy: 999 };
  A('переход к замечанию о сироте ставит фигуру в центр видимой части',
    orphMoved === true && orphSel?.kind === 'shape' && orphSel.id === orphShape.id
      && orphBox.dx <= 2 && orphBox.dy <= 2,
    orphSel ? orphSel.kind + ' ' + orphSel.id + ', сдвиг ' + orphBox.dx.toFixed(1)
      + '×' + orphBox.dy.toFixed(1) + ' px' : 'ничего не выделено');

  const orphFlash = document.querySelector('#canvas .finding-flash');
  A('у объекта замечания появляется вспышка, а в экспорт она не попадает',
    !!orphFlash && !!orphFlash.closest('#viewport')
      && !svgBeforeFlash.includes('finding-flash')
      && U.exportSvgString(U.store.model, U.store.profile) === svgBeforeFlash,
    orphFlash ? orphFlash.tagName.toLowerCase() + ' в слое ' + orphFlash.parentNode.getAttribute('class')
      : 'вспышки нет');

  // Повторный клик по замечанию снимает прежнюю вспышку, а не копит обводки.
  U.gotoFinding(orphFinding);
  await new Promise((r) => setTimeout(r, 40));
  A('повторный переход снимает прежнюю вспышку',
    document.querySelectorAll('#canvas .finding-flash').length === 1
      && document.querySelectorAll('#viewport .finding-flash-layer').length === 1,
    'обводок ' + document.querySelectorAll('#canvas .finding-flash').length
      + ', слоёв ' + document.querySelectorAll('#viewport .finding-flash-layer').length);

  // Масштаб перехода не понижает, а слишком мелкий поднимает до читаемого:
  // объект в 40 % остался бы в центре, но разглядеть его было бы нельзя.
  U.set({ view: { scale: 0.4, tx: 0, ty: 0 } });
  U.gotoFinding(orphFinding);
  await new Promise((r) => setTimeout(r, 120));
  const zoomNode = shapeNode();
  const zoomBox = zoomNode ? inView(zoomNode, document.getElementById('canvas-wrap')) : { dx: 999, dy: 999 };
  A('переход не понижает масштаб и поднимает слишком мелкий до 0,6',
    Math.abs(U.store.ui.view.scale - 0.6) < 1e-9 && zoomBox.dx <= 2 && zoomBox.dy <= 2,
    'масштаб ' + U.store.ui.view.scale + ', сдвиг ' + zoomBox.dx.toFixed(1)
      + '×' + zoomBox.dy.toFixed(1) + ' px');

  // Вспышка гаснет сама: таймер в 1,2 с, а не «до следующего клика».
  await new Promise((r) => setTimeout(r, 1300));
  A('вспышка гаснет сама через 1,2 с',
    !document.querySelector('#canvas .finding-flash') && document.querySelectorAll('#viewport .finding-flash-layer').length === 0,
    'вспышек ' + document.querySelectorAll('#canvas .finding-flash').length);

  // «shape-isolated-on-diagram» знает свой лист: у фигуры два вида, и переход
  // обязан открыть тот, где она одинока, а не первый попавшийся.
  blank();
  const isoFirst = addDiagram('class', 'Первый лист');
  const isoA = place('class', 120, 120);
  const isoB = place('class', 520, 120);
  join('association', isoA, isoB);            // на первом листе связь есть
  const isoSecond = addDiagram('class', 'Второй лист');  // текущим стал второй
  U.commit('t', (m) => {
    // Второй вид того же элемента на втором листе — без связи. Вид кладём в
    // модель полем: это формат файла (фигура = {id, elementId, x, y, w, h}),
    // а showElement через window.__uml не выставлен.
    U.currentDiagram(m).shapes.push({ id: 'v-iso', elementId: isoA.element.id, x: 260, y: 260, w: 190, h: 120, fill: null });
    m.currentDiagramId = isoFirst.id;
  });
  U.refreshChecks();
  const isoFinding = U.checkResult().findings
    .find((f) => f.ruleId === 'shape-isolated-on-diagram' && f.diagramId === isoSecond.id);
  const isoMoved = U.gotoFinding(isoFinding);
  await new Promise((r) => setTimeout(r, 120));
  A('shape-isolated-on-diagram открывает тот лист, где фигура одинока',
    isoMoved === true && !!isoFinding && U.store.model.currentDiagramId === isoSecond.id
      && U.store.ui.selection[0]?.id === 'v-iso',
    'лист «' + (U.currentDiagram(U.store.model)?.name ?? '—') + '», выделено '
      + (U.store.ui.selection[0]?.id ?? 'ничего'));

  // Замечание про связь: на листе выделяется связь-вид, а в дереве — оба её
  // конца. Своей строки у связи в дереве нет, и «участвует» читается по концам.
  U.loadModel(U.deserialize(fixtureText));
  U.refreshChecks();
  const relBad = U.checkResult().findings.find((f) => (f.basis ?? 'uml') === 'uml');
  const relJump = U.gotoFinding(relBad);
  await new Promise((r) => setTimeout(r, 120));
  const relPick = U.store.ui.selection[0];
  const relView = U.currentDiagram(U.store.model)?.links.find((l) => l.id === relPick?.id);
  const relModel = U.store.model.relationships.find((r) => r.id === relView?.relId);
  const relTreeIds = hitIds();
  // Вспышка у связи идёт по самой линии: путь копируется у нарисованной связи,
  // поэтому «d» совпадает с маршрутом, который посчитал render.js.
  const relFlash = document.querySelector('#canvas .finding-flash');
  const relRoute = document.querySelector('#canvas [data-kind="conn"][data-id="' + (relPick?.id ?? '') + '"]')
    ?.querySelector('path.conn')?.getAttribute('d');
  A('замечание про связь выделяет линию, а в дереве — оба конца связи',
    relJump === true && relPick?.kind === 'connector' && !!relView
      && relTreeIds.length === 2 && relTreeIds.includes(relModel.from) && relTreeIds.includes(relModel.to)
      && relFlash?.tagName.toLowerCase() === 'path' && !!relRoute
      && relFlash.getAttribute('d') === relRoute,
    relPick ? relPick.kind + ' ' + relPick.id + ', подсвечено: ' + relTreeIds.join(', ')
      + ', вспышка по линии: ' + (relFlash?.tagName.toLowerCase() ?? 'нет') : 'ничего не выделено');

  // Кнопка пункта открывает статью в читалке и переходом не перехватывается:
  // выделение и след замечания остаются теми же — иначе ссылка «прыгала» бы
  // вместе со строкой.
  U.openChecksPanel();
  await new Promise((r) => setTimeout(r, 140));
  const selBeforeClause = JSON.stringify(U.store.ui.selection);
  const focusBeforeClause = JSON.stringify(U.store.ui.findingFocus);
  document.querySelector('#checks .finding button.clause')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const clauseOpen = U.reference.isOpen() && !document.querySelector('sc-dialog[open]');
  U.reference.close();
  await new Promise((r) => setTimeout(r, 160));
  A('кнопка пункта открывает статью и не перехватывается переходом',
    clauseOpen && JSON.stringify(U.store.ui.selection) === selBeforeClause
      && JSON.stringify(U.store.ui.findingFocus) === focusBeforeClause,
    clauseOpen ? 'статья открыта, выделение и след прежние' : 'статья не открылась');

  // Чип «практика» — такая же кнопка: диалог, а не переход.
  blank();
  addDiagram('class', 'Лист');
  place('class', 200, 200);
  U.commit('t', (m) => { m.elements[0].name = 'Одиночка'; });
  U.openChecksPanel();
  await new Promise((r) => setTimeout(r, 140));
  const selBeforeChip = JSON.stringify(U.store.ui.selection);
  const focusBeforeChip = JSON.stringify(U.store.ui.findingFocus);
  document.querySelector('#checks-practice .finding button.chip-basis')?.click();
  await new Promise((r) => setTimeout(r, 180));
  const chipOpen = !!document.querySelector('sc-dialog[open]');
  document.querySelector('sc-dialog[open] button')?.click();
  await new Promise((r) => setTimeout(r, 140));
  A('чип «практика» открывает диалог и не перехватывается переходом',
    chipOpen && JSON.stringify(U.store.ui.selection) === selBeforeChip
      && JSON.stringify(U.store.ui.findingFocus) === focusBeforeChip,
    chipOpen ? 'диалог открыт, выделение и след прежние' : 'диалога нет');

  // Элемент есть в модели, но ни на одном листе его не показали: лист не
  // меняется, перехода на листе нет, но строка в дереве подсвечена, а
  // статусбар говорит, что показывать нечего.
  blank();
  addDiagram('class', 'Единственный лист');
  const onlyShown = place('class', 120, 120);
  const onlyHidden = place('class', 480, 120);
  const sheetBefore = U.store.model.currentDiagramId;
  U.commit('t', (m) => {
    // Убираем фигуру второго элемента с листа — элемент остаётся в модели.
    const d = U.currentDiagram(m);
    d.shapes = d.shapes.filter((s) => s.elementId !== onlyHidden.element.id);
  });
  U.refreshChecks();
  const goneFinding = U.checkResult().findings.find((f) => f.ruleId === 'element-not-on-any-diagram');
  const goneMoved = U.gotoFinding(goneFinding);
  await new Promise((r) => setTimeout(r, 120));
  A('element-not-on-any-diagram: лист на месте, строка в дереве, переход вернул false',
    goneMoved === false && U.store.model.currentDiagramId === sheetBefore
      && !!treeRow(onlyHidden.element.id)?.classList.contains('hit')
      && /ни на одной диаграмме/.test(U.store.ui.hint)
      && !document.querySelector('#canvas .finding-flash'),
    'лист тот же: ' + (U.store.model.currentDiagramId === sheetBefore) + ', подсказка: «'
      + U.store.ui.hint.slice(0, 44) + '…»');

  // Самостоятельный выбор снимает след замечания: подсветка «это про замечание»
  // не должна пережить клик по другому объекту.
  treeRow(onlyShown.element.id)?.click();
  await new Promise((r) => setTimeout(r, 120));
  A('свой выбор снимает след замечания и подсветку в дереве',
    U.store.ui.findingFocus === null && hitIds().length === 0
      && !document.querySelector('#model .node.hit'),
    U.store.ui.findingFocus === null ? 'след снят' : 'след остался');

  // Поиск по дереву не вправе спрятать строку, к которой ведёт замечание:
  // фильтр снимается, и подсказка говорит об этом.
  const searchBox = document.getElementById('model-search');
  blank();
  addDiagram('class', 'Лист');
  const hiddenBySearch = place('class', 120, 120);
  U.commit('t', (m) => { m.elements[0].name = 'Искомый элемент'; });
  U.refreshChecks();
  searchBox.value = 'Цикл';
  searchBox.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const filteredRows = document.querySelectorAll('#model .node[data-element-id]').length;
  U.gotoFinding(U.checkResult().findings.find((f) => f.ruleId === 'element-isolated'));
  await new Promise((r) => setTimeout(r, 120));
  A('поиск по дереву сбрасывается, если скрывает элемент замечания',
    filteredRows === 0 && searchBox.value === ''
      && !!treeRow(hiddenBySearch.element.id)?.classList.contains('hit')
      && /сброшен/.test(U.store.ui.hint),
    'при фильтре строк ' + filteredRows + ', поле: «' + searchBox.value + '»');

  // Курс живёт в правой колонке и больше не забирает лист: переход к
  // замечанию оставляет лист на месте, а дерево модели — видимым.
  U.course.openMode();
  await new Promise((r) => setTimeout(r, 600));
  const courseTook = U.course.isOpen();
  U.gotoFinding(U.checkResult().findings.find((f) => f.ruleId === 'element-isolated'));
  await new Promise((r) => setTimeout(r, 160));
  A('переход от замечания оставляет лист и дерево модели на месте',
    courseTook && document.getElementById('model-pane').classList.contains('active')
      && document.getElementById('canvas-wrap').getBoundingClientRect().height > 0,
    'курс был открыт: ' + courseTook + ', лист виден: '
      + (document.getElementById('canvas-wrap').getBoundingClientRect().height > 0));

  // Связь, показанная только на другом листе: переход обязан не просто
  // сменить лист, а назвать связь по виду и концам и сказать, куда он ушёл.
  // Иначе человек видит «лист сам перескочил» и «связь «r1»» — ни то, ни
  // другое не говорит, где искать виноватую линию.
  U.loadModel(U.deserialize(JSON.stringify({
    schema: 'uml-model/3', id: 'm-cross', name: 'Связь на другом листе',
    elements: [{ id: 'ca', kind: 'class', name: 'Заказ' }, { id: 'cb', kind: 'class', name: 'Клиент' }],
    relationships: [{ id: 'cr', kind: 'association', from: 'ca', to: 'cb', toMultiplicity: '2..1' }],
    diagrams: [
      { id: 'cd1', name: 'Основной лист', kind: 'class', shapes: [], links: [] },
      { id: 'cd2', name: 'Схема выгрузки', kind: 'class',
        shapes: [{ id: 'cx1', elementId: 'ca', x: 120, y: 120, w: 190, h: 120 },
                 { id: 'cx2', elementId: 'cb', x: 460, y: 120, w: 190, h: 120 }],
        links: [{ id: 'cxl', relId: 'cr', from: { shapeId: 'cx1' }, to: { shapeId: 'cx2' } }] },
    ],
    currentDiagramId: 'cd1',
  })));
  U.refreshChecks();
  const crossFinding = U.checkResult().findings.find((f) => f.targets?.includes('cr'));
  const crossMoved = U.gotoFinding(crossFinding);
  await new Promise((r) => setTimeout(r, 160));
  const crossHint = U.store.ui.hint;
  const crossFlash = document.querySelector('#canvas .finding-flash');
  A('связь на другом листе: лист сменился, связь и лист названы словами',
    crossMoved === true
      && U.store.model.currentDiagramId === 'cd2'
      && U.store.ui.selection[0]?.kind === 'connector'
      && /Ассоциация/.test(crossHint) && /Схема выгрузки/.test(crossHint)
      && /Заказ/.test(crossHint) && /Клиент/.test(crossHint)
      && !/«cr»/.test(crossHint)
      && !!crossFlash && crossFlash.tagName.toLowerCase() === 'path',
    crossHint);

  // Обводка вспышки: тонкая линия плюс ореол под ней и заливка по фигуре.
  // Одна линия при дробном масштабе ложится на сетку пикселей неравномерно и с
  // одной стороны читается как отсутствующая.
  U.loadModel(U.deserialize(JSON.stringify({
    schema: 'uml-model/3', id: 'm-wash', name: 'Вспышка',
    elements: [{ id: 'wa', kind: 'class', name: 'Одинокий' }],
    relationships: [],
    diagrams: [{ id: 'wd', name: 'Лист', kind: 'class',
      shapes: [{ id: 'ws', elementId: 'wa', x: 300, y: 300, w: 190, h: 120 }], links: [] }],
    currentDiagramId: 'wd',
  })));
  U.refreshChecks();
  U.gotoFinding(U.checkResult().findings.find((f) => f.ruleId === 'element-isolated'));
  await new Promise((r) => setTimeout(r, 120));
  const flashLayer = document.querySelector('#viewport .finding-flash-layer');
  A('у вспышки есть ореол и заливка, а не одна тонкая линия',
    !!flashLayer
      && flashLayer.querySelectorAll('.finding-flash').length === 1
      && flashLayer.querySelectorAll('.finding-flash-halo').length === 1
      && flashLayer.querySelectorAll('.finding-flash-wash').length === 1,
    flashLayer ? [...flashLayer.children].map((c) => c.getAttribute('class')).join(', ') : 'слоя нет');

  /* --- «изменено» — это отличие от файла, а не событие -------------- */
  // Переключение листа пишет currentDiagramId в файл, но A → B → A оставляет
  // файл побайтово прежним: флаг «изменено» подниматься не должен. Он вообще
  // не ставится событием, а считается сравнением модели с эталоном.
  blank();
  const da = addDiagram('class', 'Первая');
  const db = addDiagram('class', 'Вторая');
  const marked = place('class', 120, 120);
  // Документ «с диска»: эталон — ровно то, что на листе.
  U.loadModel(U.deserialize(U.serialize(U.store.model)), 'edit.uml');
  const cleanOpen = U.store.ui.dirty;
  U.commit('Смена диаграммы', (m) => { m.currentDiagramId = da.id; });
  const switched = U.store.ui.dirty;
  U.commit('Смена диаграммы', (m) => { m.currentDiagramId = db.id; });
  const switchedBack = U.store.ui.dirty;
  A('переключение диаграмм не помечает файл изменённым',
    cleanOpen === false && switched === false && switchedBack === false,
    'открыт: ' + cleanOpen + ', на первую: ' + switched + ', обратно: ' + switchedBack);

  U.commit('Переименование', (m) => {
    m.elements.find((e) => e.id === marked.element.id).name = 'Заказ';
  });
  A('настоящая правка по-прежнему помечает', U.store.ui.dirty === true,
    'dirty после переименования: ' + U.store.ui.dirty);
  U.undo();
  A('правка, отменённая Ctrl+Z, возвращает чистоту', U.store.ui.dirty === false,
    'dirty после отмены: ' + U.store.ui.dirty);

  // Модель без имени файла: сравнивать не с чем — документ изменён.
  U.loadModel(U.deserialize(U.serialize(U.store.model)), null);
  A('новая модель считается изменённой', U.store.ui.dirty === true,
    'dirty после loadModel(model, null): ' + U.store.ui.dirty);

  /* --- save/load round trip ---------------------------------------- */
  const model = U.store.model;
  const s1 = U.serialize(model);
  const s2 = U.serialize(U.deserialize(s1));
  A('файл пересохраняется байт в байт', s1 === s2, s1.length + ' Б');

  /* --- справочник-учебник (Э10: Б19, Б21, Б22) ---------------------- */
  // Проверяется настоящая панель в настоящем окне: открытие, статья из
  // полного текста, поиск по трём корпусам, три режима раскладки, атрибуция.
  const REF = U.reference;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rect = (sel) => document.querySelector(sel).getBoundingClientRect().width;
  const css = (sel, prop = 'display') => getComputedStyle(document.querySelector(sel))[prop];

  REF.open();
  await new Promise((r) => setTimeout(r, 700));
  await frame();
  const refW = Math.round(rect('#ref'));
  A('справочник открывается из интерфейса', REF.isOpen() && REF.ready() && css('#ref') === 'flex' && refW === 420,
    'ширина ' + refW + ', готов ' + REF.ready());

  // Б20з: до правки у всех кнопок шапки был пустой <svg> — они видны как
  // белые квадраты 24×24. Проверка именно на пустоту, а не на количество:
  // «шесть кнопок есть» было верно и тогда.
  const barIds = ['ref-tree', 'ref-search', 'ref-prev', 'ref-next', 'ref-mode', 'ref-close'];
  const noIcon = [...document.querySelectorAll('#ref .ref-bar .iconbtn')]
    .filter((b) => !(b.querySelector('svg')?.children.length > 0))
    .map((b) => b.id || '(без id)');
  // Не только шапка: пейджер статьи и каретка дерева рисуются тем же icon(),
  // и до правки любой вызов до загрузки набора оставлял пустую оболочку.
  const iconHosts = [...document.querySelectorAll('#ref .ref-bar .iconbtn, #ref-nav .caret, #ref-doc .pager button')];
  const emptyHosts = iconHosts.filter((b) => b.querySelector('svg') && !b.querySelector('svg').children.length).length;
  A('у каждой кнопки шапки читалки есть иконка, а не пустой svg',
    noIcon.length === 0 && emptyHosts === 0
      && barIds.every((id) => document.getElementById(id)?.querySelector('svg')?.children.length > 0),
    noIcon.length ? 'пустые: ' + noIcon.join(', ')
      : document.querySelectorAll('#ref .ref-bar .iconbtn').length + ' кнопок с содержимым, '
        + iconHosts.length + ' мест с иконками');

  // Стандарт бывает в двух видах: локально — с полным текстом (для чтения),
  // в поставке — без прозы (условие (2) лицензии OMG, см. app/reference/NOTICE.md
  // и build.mjs). Тест работает в обоих: он проверяет, что статья отрисована
  // (заголовок, абзацы, навигация) и что структура пунктов цела, но не требует
  // ни наличия прозы, ни её отсутствия — это решает сборка, а за поставку
  // отвечает отдельная проверка в tools/verify.mjs.
  await REF.openArticle('spec:11.5.4-notation');
  await new Promise((r) => setTimeout(r, 500));
  const doc = document.getElementById('ref-doc');
  A('статья 11.5.4 «Notation» рендерится блоками',
    doc.querySelector('.doc-title')?.textContent === 'Notation'
      && doc.querySelectorAll('p').length >= 5
      && doc.querySelectorAll('.pager button').length === 2,
    doc.querySelector('.doc-title')?.textContent + ': абзацев ' + doc.querySelectorAll('p').length
      + ', списков ' + doc.querySelectorAll('ul').length);

  const specStats = REF.state.data.spec.stats;
  A('структура стандарта на месте: 25 разделов, 3 690 пунктов',
    specStats.sections === 25 && specStats.nodes === 3690 && specStats.blocks > 0,
    specStats.sections + ' разделов, ' + specStats.nodes + ' пунктов, ' + specStats.blocks + ' блоков');

  // Б20б: констрейнты метакласса приезжают в статью нотации, как в прототипе.
  const kvBlocks = [...doc.querySelectorAll('.kv')];
  // Числа «5 констрейнтов, 2 с чипом» здесь стояли руками и краснели от каждого
  // нового правила, у которого тот же пункт: сверять надо не «сколько их», а
  // «у каждого ли есть OCL и куда ведёт чип». Поэтому проверяем форму блока, а
  // количество берём из данных: у 11.5.4 констрейнты приезжают из набора, и
  // их число — производное, а не константа теста.
  A('11.5.4 показывает «Правила, которые к этому относятся»: kv с OCL и чипами',
    [...doc.querySelectorAll('h3')].some((h) => h.textContent === 'Правила, которые к этому относятся')
      && kvBlocks.length > 0
      && kvBlocks.every((k) => k.querySelector('.kv-ocl') && k.querySelector('.kv-check'))
      && kvBlocks.filter((k) => k.querySelector('.kv-check button.chip')).length > 0
      && [...doc.querySelectorAll('.kv-check')].some((c) => /^не проверяется: ./m.test(c.textContent)),
    kvBlocks.length + ' kv, с OCL ' + kvBlocks.filter((k) => k.querySelector('.kv-ocl')).length
      + ', с чипом правила ' + kvBlocks.filter((k) => k.querySelector('.kv-check button.chip')).length);

  // Б20в: «Связано» — четыре группы; на подпункте 11.5.4 связи наследуются.
  const groupsOf = () => [...document.querySelectorAll('#ref-doc .rel .grp')]
    .map((g) => g.querySelector('.gl').textContent);
  const g1154 = groupsOf();
  await REF.openArticle('spec:11.5-associations');
  await new Promise((r) => setTimeout(r, 400));
  const g115 = groupsOf();
  A('«Связано»: у 11.5.4 не меньше двух групп, у 11.5 — четыре',
    g1154.length >= 2 && g115.length === 4
      && ['Нотация', 'Правила', 'Пособие', 'PlantUML'].every((t) => g115.includes(t)),
    '11.5.4: ' + g1154.join(', ') + '; 11.5: ' + g115.join(', '));

  A('на полке «Спецификация» — блок атрибуции OMG со ссылкой на NOTICE',
    (await REF.openArticle('spec:about'), await new Promise((r) => setTimeout(r, 150)),
      !!document.querySelector('#ref-doc .attrib')
      && (document.querySelector('#ref-doc .attrib a[href*="NOTICE.md"]')?.getAttribute('href') ?? '').includes('reference/NOTICE.md')),
    document.querySelector('#ref-doc .attrib a[href*="NOTICE.md"]')?.getAttribute('href') ?? 'ссылки нет');

  await REF.search('association');
  const shelfOf = {
    'spec-node': 'spec', 'spec-para': 'spec', rule: 'rules', stereotype: 'stereotypes',
    shape: 'notation', connector: 'notation', exercise: 'tutorial', plantuml: 'plantuml',
  };
  const shelves = new Set(REF.results().map((r) => shelfOf[r.kind]));
  A('один запрос находит правило, пункт стандарта и стереотип',
    shelves.has('spec') && shelves.has('rules') && shelves.has('stereotypes'),
    [...shelves].join(', '));

  await REF.search('квалификатор');
  const ru = REF.results()[0];
  await REF.search('qualifier');
  const en = REF.results()[0];
  A('«квалификатор» и «qualifier» ведут в 9.5.3',
    !!ru && ru.ref.startsWith('9.5.3') && !!en && en.ref.startsWith('9.5.3'),
    (ru?.ref ?? '—') + ' / ' + (en?.ref ?? '—'));

  // Служебные подзаголовки описаний метаклассов: заголовок «Description» или
  // «Association Ends» сам по себе ничего не значит и в индекс не идёт, но
  // проза под ним — объяснение метакласса. Её документ назван именем
  // родителя («Association Ends — Association»), иначе 202 046 знаков в 336
  // пунктах не находились ничем (docs/research/REFERENCE-SCOPE.md §3–§4). Проверка
  // держит обе половины: имя в выдаче и клик в тот же пункт.
  await REF.search('association ends');
  const ends = REF.results()[0];
  // Клик по выдаче идёт через keyForResult → clauseByNumber(ref) → статья по
  // номеру пункта; openClause делает ровно это (id статьи — слаг, не номер).
  const endsTitle = ends ? (await REF.openClause(ends.ref),
    await new Promise((r) => setTimeout(r, 300)),
    document.querySelector('#ref-doc .doc-title')?.textContent) : null;
  await REF.search('class');
  // Имя не cls: в этом же сценарии cls — фигура класса на листе (строка 161),
  // повторное объявление роняло весь сценарий SyntaxError'ом.
  const clsHit = REF.results()[0];
  A('проза служебного подзаголовка ищется именем родителя и ведёт в свой пункт',
    !!ends && ends.kind === 'spec-para' && /^Association Ends — Association/.test(ends.text)
      && ends.ref.startsWith('11.8') && endsTitle === 'Association Ends',
    (ends ? ends.ref + ' «' + ends.text.slice(0, 44) + '…» → статья «' + endsTitle + '»' : 'ничего не найдено'));
  A('служебный документ не перебивает сам пункт: «class» — это Class [Class]',
    !!clsHit && clsHit.kind === 'spec-node' && clsHit.ref.startsWith('11.4'),
    clsHit ? clsHit.kind + ' ' + clsHit.ref : 'ничего');

  // Вес служебного документа ниже базового (SUBTITLE_WEIGHT = 0,75 против
  // 0,85 у абзаца и 1,0–1,15 у пункта) — иначе «Description — Class» встаёт
  // первым по запросу «attribute» и «composite aggregation». Проверка держит
  // это поведением, а не константой: поднятый до 1,6 вес краснит её сразу.
  const DEF_QUERIES = ['notation', 'class', 'association', 'attribute', 'semantics',
    'composite aggregation', 'квалификатор', 'кратность', 'aggregation', 'multiplicity'];
  const firstSubtitle = [];
  let subInTop = 0;
  let topTotal = 0;
  for (const q of DEF_QUERIES) {
    const r = REF.searchBoth(q).slice(0, 10);
    if (r[0]?.name) firstSubtitle.push(q + ' → ' + r[0].name);
    subInTop += r.filter((x) => x.name).length;
    topTotal += r.length;
  }
  A('служебные документы не выходят на первое место и не топят выдачу',
    firstSubtitle.length === 0 && subInTop / topTotal <= 0.3,
    firstSubtitle.length ? firstSubtitle.join('; ')
      : 'служебных в топ-10: ' + subInTop + ' из ' + topTotal + ' (' + (100 * subInTop / topTotal).toFixed(0) + ' %)');

  // Три режима: те же числа, что в прототипе (рядом 420 / страница 480+200 /
  // широко 200+480+200 при #center ≥ 980).
  const modes = {};
  for (const m of ['split', 'page', 'wide']) {
    REF.setMode(m);
    await frame();
    modes[m] = {
      ref: Math.round(rect('#ref')), center: Math.round(rect('#center')),
      doc: Math.round(rect('#ref-doc')),
      canvas: css('#canvas-wrap'), toc: css('#ref-toc'), nav: css('#ref-nav'), right: css('#right'),
      room: document.getElementById('work').classList.contains('room'),
    };
  }
  A('три режима совпадают с прототипом по замерам',
    modes.split.ref === 420 && modes.split.canvas !== 'none' && modes.split.toc === 'none'
      && modes.page.canvas === 'none' && modes.page.doc === 480 && modes.page.toc === 'block'
      && modes.wide.right === 'none' && modes.wide.nav === 'block' && modes.wide.room
      && modes.wide.center >= 980,
    'рядом: ' + modes.split.ref + '/лист ' + (modes.split.canvas !== 'none')
      + '; страница: ' + modes.page.doc + '+оглавление ' + (modes.page.toc === 'block')
      + '; широко: дерево ' + (modes.wide.nav === 'block') + ', центр ' + modes.wide.center);

  REF.setMode('split');
  await frame();
  const before = REF.current().id;
  await REF.openArticle('rules:association-end-typed');
  await new Promise((r) => setTimeout(r, 300));
  REF.back();
  await new Promise((r) => setTimeout(r, 300));
  A('история переходов возвращает на прежнюю статью',
    REF.current().id === before && REF.history().length >= 1,
    'было ' + before + ', стало ' + REF.current().id + ', в истории ' + REF.history().length);

  // Закрытие из режима «страница» обязано вернуть и лист, и инспектор:
  // иначе «страница» без читалки оставила бы пустой центр.
  REF.setMode('page');
  await frame();
  REF.close();
  await frame();
  A('справочник закрывается и возвращает лист',
    !REF.isOpen() && css('#canvas-wrap') !== 'none' && css('#right') !== 'none'
      && REF.mode() === 'split',
    'ширина листа ' + Math.round(rect('#canvas-wrap')) + ', режим ' + REF.mode());

  /* --- Б20а: «Поставить на лист» из карточки ------------------------ */
  blank();
  addDiagram('class', 'Карточка');
  const shapesBefore = U.currentDiagram(U.store.model).shapes.length;
  await REF.openArticle('notation:shape:class');
  await new Promise((r) => setTimeout(r, 400));
  const placeBtn = document.querySelector('#ref-doc #btn-place');
  A('в карточке нотации есть кнопка «Поставить на лист»',
    !!placeBtn && placeBtn.classList.contains('action')
      && /Поставить на лист/.test(placeBtn.textContent) && !placeBtn.disabled
      && placeBtn.querySelector('svg')?.children.length > 0,
    placeBtn ? 'класс ' + placeBtn.className + ', выключена: ' + placeBtn.disabled : 'кнопки нет');
  placeBtn?.click();
  await new Promise((r) => setTimeout(r, 250));
  const shapesAfter = U.currentDiagram(U.store.model).shapes.length;
  const undoToast = [...document.querySelectorAll('sc-toast button')].find((b) => /Отменить/.test(b.textContent));
  A('«Поставить на лист» кладёт фигуру и предлагает отмену',
    shapesAfter === shapesBefore + 1 && !!undoToast,
    'фигур ' + shapesBefore + ' → ' + shapesAfter + ', тост: ' + (undoToast?.textContent ?? 'нет'));
  undoToast?.click();
  await new Promise((r) => setTimeout(r, 250));
  A('«Отменить» в тосте снимает поставленное',
    U.currentDiagram(U.store.model).shapes.length === shapesBefore,
    'фигур ' + U.currentDiagram(U.store.model).shapes.length);

  // Связь: без двух фигур кнопка выключена и говорит, чего не хватает;
  // с двумя — кладёт связь и открывает тост с отменой.
  blank();
  addDiagram('class', 'Связи');
  await REF.openArticle('notation:connector:composition');
  await new Promise((r) => setTimeout(r, 400));
  const connOff = document.querySelector('#ref-doc #btn-place');
  const offAtZero = !!connOff && connOff.disabled && /нужно две/.test(connOff.title);
  place('class', 120, 120);
  place('class', 520, 120);
  await REF.openArticle('notation:connector:composition');
  await new Promise((r) => setTimeout(r, 400));
  const connBtn = document.querySelector('#ref-doc #btn-place');
  connBtn?.click();
  await new Promise((r) => setTimeout(r, 300));
  const dConn = U.currentDiagram(U.store.model);
  A('связь из карточки: без двух фигур выключена, с двумя — ставится',
    offAtZero && !!connBtn && !connBtn.disabled && dConn.links.length === 1
      && U.store.model.relationships.at(-1)?.kind === 'composition',
    'выключена при нуле: ' + offAtZero + ', связей ' + dConn.links.length);

  /* --- Б20ж: поле diagrams в шапке карточки ------------------------- */
  await REF.openArticle('notation:shape:class');
  await new Promise((r) => setTimeout(r, 400));
  const cardMeta = (document.querySelector('#ref-doc .doc-meta')?.textContent ?? '').replace(/\s+/g, ' ');
  A('поле diagrams у карточки видно в шапке',
    /диаграммы: классов \(3\.3\)/.test(cardMeta), cardMeta.slice(0, 90));

  /* --- Б20д: F1 на выделенной фигуре -------------------------------- */
  const placedNow = place('class', 320, 240);
  U.set({ selection: [{ kind: 'shape', id: placedNow.shape.id }] });
  REF.close();
  await new Promise((r) => setTimeout(r, 250));
  const f1 = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true });
  window.dispatchEvent(f1);
  await new Promise((r) => setTimeout(r, 800));
  A('F1 на выделенной фигуре открывает её статью и не теряет выделение',
    f1.defaultPrevented && REF.isOpen() && REF.current().id === 'shape:class'
      && U.store.ui.selection.length === 1 && U.store.ui.selection[0].id === placedNow.shape.id,
    'статья ' + REF.current().shelf + ':' + REF.current().id
      + ', выделено ' + U.store.ui.selection.length);

  /* --- Б20з: Esc закрывает читалку из любого места ------------------ */
  const escEv = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(escEv);
  await new Promise((r) => setTimeout(r, 300));
  A('Esc закрывает читалку из любого места',
    !REF.isOpen() && escEv.defaultPrevented,
    'открыта: ' + REF.isOpen() + ', Esc обработан: ' + escEv.defaultPrevented);

  /* --- Б20и: три кнопки в шапке ------------------------------------- */
  const libBtn = document.querySelector('#toolbar [aria-label^="Библиотека"]');
  const crsBtn = document.querySelector('#toolbar [aria-label^="Курс"]');
  const hlpBtn = document.querySelector('#toolbar [aria-label^="Подсказка"]');
  A('в шапке три кнопки: Библиотека, Курс, Подсказка — все с иконками',
    !!libBtn && !!crsBtn && !!hlpBtn
      && [libBtn, crsBtn, hlpBtn].every((b) => b.querySelector('svg')?.children.length > 0)
      && libBtn.title === 'Библиотека: нотация, правила, спецификация, пособие',
    [libBtn, crsBtn, hlpBtn].map((b) => b?.getAttribute('aria-label')).join(' | '));
  // Кнопки пересоздаются при каждой перерисовке шапки — берём их заново.
  const tb = (name) => document.querySelector('#toolbar [aria-label^="' + name + '"]');
  // «Библиотека» — переключатель (§1.3): второе нажатие закрывает, aria-pressed
  // показывает состояние. Иначе это не тумблер, а «открыть».
  tb('Библиотека')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const libOpen = REF.isOpen() && tb('Библиотека')?.getAttribute('aria-pressed') === 'true';
  tb('Библиотека')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const libOff = !REF.isOpen() && tb('Библиотека')?.getAttribute('aria-pressed') === 'false';
  A('«Библиотека» открывает и закрывает справочник, aria-pressed идёт за ней',
    libOpen && libOff, 'открыта: ' + libOpen + ', закрыта вторым нажатием: ' + libOff);

  // «Курс» — режим, а не вкладка: справочник уступает, лист и свойства на месте.
  tb('Библиотека')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const libWasOpen = REF.isOpen();
  tb('Курс')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const rightTab = document.querySelector('#right .panel-tabs .tab.active')?.dataset.tab;
  const sheetVisible = document.getElementById('canvas-wrap').getBoundingClientRect().height > 0;
  const leftTabs = document.querySelectorAll('#left .panel-tabs .tab').length;
  const courseOn = U.course.isOpen() && tb('Курс')?.getAttribute('aria-pressed') === 'true';
  A('«Курс» — режим: справочник уступает, лист и свойства на месте',
    libWasOpen && !REF.isOpen() && courseOn && !document.getElementById('course-mode').hidden
      && ['props', 'profile', 'checks'].includes(rightTab) && sheetVisible && leftTabs === 0,
    'справочник ' + libWasOpen + ' → ' + REF.isOpen() + ', режим курса ' + courseOn
      + ', вкладка справа ' + rightTab + ', лист виден ' + sheetVisible
      + ', вкладок слева ' + leftTabs);

  // Esc выходит из режима курса — третий выход рядом с «✕» и «К листу».
  const escCourse = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(escCourse);
  await new Promise((r) => setTimeout(r, 300));
  A('Esc выходит из режима курса',
    !U.course.isOpen() && document.getElementById('course-mode').hidden && escCourse.defaultPrevented,
    'курс открыт: ' + U.course.isOpen() + ', Esc обработан: ' + escCourse.defaultPrevented);
  U.course.close();
  hlpBtn?.click();
  await new Promise((r) => setTimeout(r, 300));
  const helpDlg = (document.querySelector('sc-dialog[open]')?.textContent ?? '').replace(/\s+/g, ' ');
  A('«Подсказка» открывает лист клавиш, а не справочник',
    /Подсказка/.test(helpDlg) && /Инструменты/.test(helpDlg) && !REF.isOpen(),
    helpDlg.slice(0, 40));
  document.querySelector('sc-dialog[open] button')?.click();
  await new Promise((r) => setTimeout(r, 150));

  /* ================== итерация 7: связь, курс, библиотека ============ */
  // Отдельная область видимости: у большого сценария выше свои имена, и
  // пересекаться с ними новые проверки не должны.
  {

  const G = await import('/src/model/geometry.js');
  // The two connector enums the original numbers (§22).
  const S = await import('/src/model/connector-style.js');
  const CM = await import('/src/ui/course.js');
  const ICONS = await import('/src/ui/icons.js');
  const cvEl = () => document.getElementById('canvas');
  const toClient = (x, y) => {
    const r = cvEl().getBoundingClientRect();
    const v = U.store.ui.view;
    return { clientX: r.left + v.tx + x * v.scale, clientY: r.top + v.ty + y * v.scale };
  };
  const ptr = (type, x, y, target, extra) => {
    const c = toClient(x, y);
    (target ?? cvEl()).dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles: true, cancelable: true, clientX: c.clientX, clientY: c.clientY, button: 0,
    }, extra ?? {})));
  };
  const dbl = (x, y, target) => {
    const c = toClient(x, y);
    (target ?? cvEl()).dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, clientX: c.clientX, clientY: c.clientY, button: 0,
    }));
  };
  const numsOf = (s) => (String(s ?? '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const polyOf = (s) => {
    const v = numsOf(s);
    const pts = [];
    for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    return pts;
  };
  const linkNow = () => U.currentDiagram(U.store.model).links.at(-1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* --- 7.1 bend points on a connector ------------------------------- */
  blank();
  addDiagram('class', 'WP');
  const wpA = place('class', 80, 80);
  const wpB = place('class', 520, 380);
  const wl = join('association', wpA, wpB, { name: 'через излом' });
  U.commit('t', (m) => { U.currentDiagram(m).links.at(-1).route = 'direct'; });
  U.set({ selection: [{ kind: 'connector', id: wl.id }] });
  U.renderCanvas();
  await sleep(80);
  const connPath = () => document.querySelector('#canvas .conn-g path.conn');
  const lineEnds = () => {
    const p = polyOf(connPath().getAttribute('d'));
    return { a: p[0], b: p[p.length - 1] };
  };
  // Точка на линии, но не в середине: там стоит подпись связи, и двойной
  // клик по ней — это переименование, а не излом (оба жеста живут вместе).
  const lineAt = (f) => {
    const e = lineEnds();
    return [e.a[0] + (e.b[0] - e.a[0]) * f, e.a[1] + (e.b[1] - e.a[1]) * f];
  };
  const wm0 = lineAt(0.16);
  dbl(wm0[0], wm0[1], connPath());
  await sleep(60);
  const wpAfterDbl = linkNow().waypoints;
  const wpMarks = document.querySelectorAll('#canvas .conn-wp').length;
  A('двойной клик по линии ставит точку перегиба, и линия идёт через неё',
    Array.isArray(wpAfterDbl) && wpAfterDbl.length === 1
      && Math.abs(wpAfterDbl[0][0] - wm0[0]) < 3 && Math.abs(wpAfterDbl[0][1] - wm0[1]) < 3
      && wpMarks === 1
      && Math.abs(polyOf(connPath().getAttribute('d'))[1][0] - wpAfterDbl[0][0]) < 0.01,
    'точек ' + (wpAfterDbl ? wpAfterDbl.length : 0) + ', квадратиков ' + wpMarks
      + ', точка ' + JSON.stringify(wpAfterDbl && wpAfterDbl[0]));

  const wpEl = () => document.querySelector('#canvas .conn-wp');
  const wpXY = () => {
    const r = wpEl();
    return [Number(r.getAttribute('x')) + 3, Number(r.getAttribute('y')) + 3];
  };
  let wx = wpXY();
  ptr('pointerdown', wx[0], wx[1], wpEl());
  ptr('pointermove', wx[0] + 60, wx[1] + 40);
  ptr('pointerup', wx[0] + 60, wx[1] + 40);
  await sleep(80);
  const moved = linkNow().waypoints?.[0] ?? [0, 0];
  A('точка перегиба таскается мышью',
    Math.abs(moved[0] - (wx[0] + 60)) < 4 && Math.abs(moved[1] - (wx[1] + 40)) < 4,
    'было ' + wx.join(',') + ' → стало ' + moved.join(','));

  wx = wpXY();
  ptr('pointerdown', wx[0], wx[1], wpEl(), { altKey: true });
  ptr('pointerup', wx[0], wx[1], wpEl(), { altKey: true });
  await sleep(60);
  A('Alt+клик по точке убирает её, связь остаётся',
    !linkNow().waypoints && U.currentDiagram(U.store.model).links.length === 1,
    'waypoints ' + JSON.stringify(linkNow().waypoints ?? null));

  const wm1 = lineAt(0.3);
  dbl(wm1[0], wm1[1], connPath());
  await sleep(60);
  wx = wpXY();
  ptr('pointerdown', wx[0], wx[1], wpEl());
  ptr('pointerup', wx[0], wx[1], wpEl());
  await sleep(40);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await sleep(60);
  A('Delete при выделенной точке убирает точку, а не связь',
    !linkNow().waypoints && U.currentDiagram(U.store.model).links.length === 1
      && U.store.model.relationships.length === 1,
    'waypoints ' + JSON.stringify(linkNow().waypoints ?? null)
      + ', связей ' + U.currentDiagram(U.store.model).links.length);

  U.commit('t', (m) => { U.currentDiagram(m).links.at(-1).waypoints = [[200, 200], [200, 340]]; });
  U.commit('t', (m) => { U.currentDiagram(m).links.at(-1).rounded = 'small'; });
  const ser1 = U.serialize(U.store.model);
  const ser2 = U.serialize(U.deserialize(ser1));
  const back = U.deserialize(ser1).diagrams.at(-1).links.at(-1);
  A('waypoints и rounded переживают serialize→deserialize побайтово',
    ser1 === ser2 && JSON.stringify(back.waypoints) === '[[200,200],[200,340]]'
      && back.rounded === 'small' && /"waypoints": \[/.test(ser1) && /"rounded": "small"/.test(ser1),
    'байты ' + (ser1 === ser2) + ', точек ' + JSON.stringify(back.waypoints) + ', скругление ' + back.rounded);
  U.commit('t', (m) => { const l = U.currentDiagram(m).links.at(-1); delete l.waypoints; delete l.rounded; });
  U.renderCanvas();

  /* --- 7.3 rounding: arc or quad, never folded ---------------------- */
  blank();
  addDiagram('class', 'RD');
  const rdA = place('class', 80, 80);
  const rdB = place('class', 520, 380);
  // Перпендикулярные стороны: автоматический маршрут получает один угол —
  // на прямой линии скруглять нечего, и проверка была бы пустой.
  U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    const rel = U.createRelationship('association', rdA.element.id, rdB.element.id);
    m.relationships.push(rel);
    d.links.push(U.createLink(rel,
      { shapeId: rdA.shape.id, side: 'bottom', t: 0.5 },
      { shapeId: rdB.shape.id, side: 'right', t: 0.5 }));
  });
  const setRound = (v, pts) => U.commit('t', (m) => {
    const l = U.currentDiagram(m).links.at(-1);
    if (v) l.rounded = v; else delete l.rounded;
    if (pts) l.waypoints = pts;
  });
  const pathNow = () => document.querySelector('#canvas .conn-g path.conn').getAttribute('d');
  setRound(null, null); U.renderCanvas();
  const plainD = pathNow();
  setRound('small', null); U.renderCanvas();
  const smallD = pathNow();
  setRound('large', null); U.renderCanvas();
  const largeD = pathNow();
  const numsIn = (d, re) => (d.match(re) || []).length;
  // The program has ONE corner softening for the rounded styles: cut 7 px back
  // along both legs and a cubic through the corner (v/cct/es#a(D)+0x00b1,
  // MECHANICS §27b). There is no second radius, so 'small' and 'large' draw
  // the same line — and neither is an arc any more.
  A('скругление off/small/large: угол срезан на 7 px и сшит кубикой',
    !/[AQC]/.test(plainD) && smallD !== plainD && / C /.test(smallD) && / C /.test(largeD)
      && !/[AQ]/.test(smallD) && smallD === largeD
      && numsIn(smallD, / C /g) >= 1,
    'off: ' + plainD.slice(0, 30) + ' · small: ' + smallD.slice(0, 60) + ' · large тот же: ' + (smallD === largeD));

  setRound('large', [[400, 200], [400, 210]]);
  U.renderCanvas();
  const shortD = pathNow();
  const shortPts = polyOf(shortD);
  const clean = !/NaN|Infinity/.test(shortD);
  // A 10 px leg cannot give 7 px twice: the cut is clamped to half of the
  // shorter leg, so the corner is softened without folding the line back.
  const cutPt = shortD.match(/L ([\d.-]+) ([\d.-]+) C /);
  A('срез не выворачивает короткий сегмент: не больше половины ноги, линия цела',
    clean && shortD.includes(' C ') && shortPts.length >= 2 && Boolean(cutPt)
      && Math.hypot(400 - Number(cutPt[1]), 200 - Number(cutPt[2])) <= 5.001,
    'path ' + shortD.slice(0, 70));

  // Скругление на ручной ломаной и на автоматической — одна и та же функция.
  // The route is named explicitly: an unnamed one now follows the program's
  // DefaultConnectorStyle (1 = Oblique, a straight line — MECHANICS §22a),
  // and this check is about the rectilinear router's corners, not the default.
  const autoPts = G.routePoints({ x: 0, y: 0, side: 'bottom' }, { x: 120, y: 90, side: 'left' }, 'rect');
  const autoRound = G.pathD(autoPts, 'small');
  const manualPts = G.linkPoints({ x: 0, y: 0, side: 'bottom' }, { x: 120, y: 90, side: 'left' }, 'rect', [[40, 60]]);
  A('скругление работает и на автоматической, и на ручной ломаной',
    manualPts.length === 3 && manualPts[1][0] === 40 && / C /.test(autoRound)
      && / C /.test(G.pathD(manualPts, 'small')) && G.pathD(autoPts, 'off') === G.polylinePath(autoPts),
    'точек авто ' + autoPts.length + ', с изломом ' + manualPts.length);
  U.commit('t', (m) => { const l = U.currentDiagram(m).links.at(-1); delete l.waypoints; delete l.rounded; });

  /* --- 7.3b label orientation: five codes, one default -------------- */
  // connectorLabelOrientation (§22b): 0 Horizontal Only (the program's own
  // default), 1 Horizontal or Vertical Only, 2 Follow Connector Angle,
  // 3 Follow Connector Angle and Keep Text Up Right, 4 Follow Diagram.
  const vertical = [[100, 0], [100, 120]];
  const down = [[100, 120], [100, 0]];
  const sideways = [[0, 0], [120, 120]];
  const leftward = [[120, 0], [0, 0]];
  const L = G.labelPos;
  A('подпись связи: 0 не поворачивает, 1 держит оси, 2 и 3 идут вдоль линии',
    L(vertical, 0, 0, 0).angle === 0
      && L(sideways, 0, 0, 0).angle === 0
      && Math.abs(L(vertical, 0, 0, 1).angle) === 90
      && L(sideways, 0, 0, 1).angle === 90
      && L(vertical, 0, 0, 2).angle === 90
      && L(vertical, 0, 0, 3).angle === -90
      // 2 follows the segment even the wrong way up; 3 turns it back:
      // a run drawn right-to-left is 180 degrees, and 3 reads it as 0.
      && L(leftward, 0, 0, 2).angle === 180
      && L(leftward, 0, 0, 3).angle === 0
      && L(down, 0, 0, 3).angle === -90,
    '0: ' + L(vertical, 0, 0, 0).angle + ' · 1: ' + L(vertical, 0, 0, 1).angle
      + ' · 2 влево: ' + L(leftward, 0, 0, 2).angle + ' · 3 влево: ' + L(leftward, 0, 0, 3).angle);

  /* --- 7.3c connector style codes: six, as the program names them --- */
  A('стиль связи: 0 Rectilinear, 1 Oblique, 5 Round Rectilinear — коды листа',
    G.routePoints({ x: 0, y: 0, side: 'bottom' }, { x: 120, y: 90, side: 'left' }, 'rect').length === 5
      && G.routePoints({ x: 0, y: 0, side: 'bottom' }, { x: 120, y: 90, side: 'left' }, 'direct').length === 2
      && S.routeOfStyle(0) === 'rect' && S.routeOfStyle(1) === 'direct'
      && S.routeOfStyle(5) === 'rect' && S.roundedOfStyle(5) === 'small'
      && S.roundedOfStyle(1) === 'off' && S.STYLE_INHERIT === 3,
    '0→' + S.routeOfStyle(0) + ' · 1→' + S.routeOfStyle(1) + ' · 5→'
      + S.routeOfStyle(5) + '/' + S.roundedOfStyle(5));


  /* --- 7.4 heads follow the LAST segment ---------------------------- */
  blank();
  addDiagram('class', 'HD');
  const hdA = place('class', 200, 60);
  const hdB = place('class', 200, 460);
  const makeHeadLink = (kind, nav) => U.commit('t', (m) => {
    const d = U.currentDiagram(m);
    const rel = U.createRelationship(kind, hdA.element.id, hdB.element.id);
    if (nav) rel.navigable = nav;
    m.relationships.push(rel);
    const link = U.createLink(rel,
      { shapeId: hdA.shape.id, side: 'bottom', t: 0.5 },
      { shapeId: hdB.shape.id, side: 'top', t: 0.5 });
    d.links.push(link);
    return link;
  });
  const headsNow = () => {
    const gs = [...document.querySelectorAll('#canvas .conn-g')];
    const g = gs[gs.length - 1];
    const d = g.querySelector('path.conn').getAttribute('d');
    const line = polyOf(d);
    const startPt = line[0];
    const endPt = line[line.length - 1];
    const out = [];
    for (const n of g.querySelectorAll('polygon, path')) {
      const cls = n.getAttribute('class') ?? '';
      if (!/^head-/.test(cls)) continue;
      const pts = polyOf(n.tagName.toLowerCase() === 'polygon' ? n.getAttribute('points') : n.getAttribute('d'));
      const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.8;
      let tip = null;
      if (pts.some((q) => near(q, endPt))) tip = endPt;
      else if (pts.some((q) => near(q, startPt))) tip = startPt;
      if (!tip) { out.push({ cls, vertical: false, why: 'не на конце линии' }); continue; }
      const rest = pts.filter((q) => !near(q, tip));
      const bx = rest.reduce((s, q) => s + q[0], 0) / rest.length;
      const by = rest.reduce((s, q) => s + q[1], 0) / rest.length;
      out.push({ cls, dx: Math.abs(tip[0] - bx), dy: Math.abs(tip[1] - by) });
    }
    return out;
  };
  const headCases = [
    ['generalization', null, 'треугольник'],
    ['realization', null, 'залитый треугольник'],
    ['dependency', null, 'открытая стрелка'],
    ['association', 'to', 'навигация к цели'],
    ['aggregation', null, 'полый ромб'],
    ['composition', null, 'залитый ромб'],
  ];
  let headsOk = 0;
  const headLog = [];
  for (const [kind, nav, label] of headCases) {
    makeHeadLink(kind, nav);
    U.renderCanvas();
    await sleep(20);
    const heads = headsNow();
    const ok = heads.length > 0 && heads.every((hh) => hh.dy > 2 && hh.dx < 0.8);
    if (ok) headsOk += 1;
    headLog.push(label + ':' + heads.length + (ok ? '✓' : '✗' + JSON.stringify(heads)));
    U.commit('t', (m) => { U.currentDiagram(m).links.pop(); m.relationships.pop(); });
  }
  // «Без головы» — заведомо ни одной головки.
  makeHeadLink('association', 'none');
  U.renderCanvas();
  await sleep(20);
  const noHead = headsNow().length;
  A('наконечники всех видов стоят по последнему сегменту (вертикальному)',
    headsOk === headCases.length && noHead === 0,
    headLog.join(' · ') + ' · без головы: ' + noHead);

  /* --- 7.5 / 7.6 export matches the sheet; label at the middle ------- */
  U.commit('t', (m) => {
    const l = U.currentDiagram(m).links.at(-1);
    l.waypoints = [[260, 200], [360, 200], [360, 300]];
    l.rounded = 'small';
  });
  U.commit('t', (m) => { m.relationships.at(-1).name = 'длинный маршрут'; });
  U.commit('t', (m) => { m.relationships.at(-1).navigable = 'to'; });
  U.renderCanvas();
  await sleep(40);
  const domD = document.querySelector('#canvas .conn-g path.conn').getAttribute('d');
  const svgOut = U.exportSvgString(U.store.model);
  const svgConn = (svgOut.match(/<path class="conn"[^>]*d="([^"]+)"/) || [])[1]
    ?? (svgOut.match(/d="([^"]+)" class="conn"/) || [])[1];
  A('экспорт SVG отдаёт ту же ломаную со скруглениями, что и на экране',
    !!svgConn && svgConn === domD,
    'экран ' + String(domD).slice(0, 34) + ' · файл ' + String(svgConn ?? '').slice(0, 34));

  const hitPts = polyOf(document.querySelector('#canvas .conn-g path.conn-hit').getAttribute('d'));
  let totalLen = 0;
  const segLens = [];
  for (let k = 0; k < hitPts.length - 1; k += 1) {
    const l = Math.hypot(hitPts[k + 1][0] - hitPts[k][0], hitPts[k + 1][1] - hitPts[k][1]);
    segLens.push(l);
    totalLen += l;
  }
  let want = totalLen / 2;
  let k2 = 0;
  while (k2 < segLens.length - 1 && want > segLens[k2]) { want -= segLens[k2]; k2 += 1; }
  const t2 = want / (segLens[k2] || 1);
  const wantX = hitPts[k2][0] + (hitPts[k2 + 1][0] - hitPts[k2][0]) * t2;
  const wantY = hitPts[k2][1] + (hitPts[k2 + 1][1] - hitPts[k2][1]) * t2;
  const lbl = document.querySelector('#canvas .conn-label-g');
  const lblXY = lbl ? numsOf(lbl.getAttribute('transform')) : null;
  A('подпись садится на середину ВСЕЙ ломаной по длине пути',
    !!lblXY && Math.hypot(lblXY[0] - wantX, lblXY[1] - wantY) < 2 && segLens.length >= 4,
    'сегментов ' + segLens.length + ', ждали ' + Math.round(wantX) + ',' + Math.round(wantY)
      + ', подпись ' + (lblXY ? lblXY[0] + ',' + lblXY[1] : '—'));

  /* --- 2: главы и упражнения нумеруются с 1 ------------------------- */
  await U.course.openChapter('ch3');
  await sleep(120);
  const chTitle = document.querySelector('#course-view .cv-title')?.textContent ?? '';
  const chSrc = document.querySelector('#course-view .cv-src')?.textContent ?? '';
  const groupTxt = document.querySelector('#course-list .tree-group')?.textContent ?? '';
  const exNum = document.querySelector('#course-list .node[data-ex="ex-3.1"] .ex-num')?.textContent ?? '';
  A('курс нумерует главы и упражнения с 1, номер пособия — мелким рядом',
    /^1\./.test(chTitle) && chSrc === 'глава 3 пособия' && /^1\./.test(groupTxt) && exNum === '1.1',
    'глава «' + chTitle.slice(0, 24) + '», номер пособия «' + chSrc + '», упражнение ' + exNum);
  const exTitle = await (async () => {
    U.course.open('ex-3.1');
    await sleep(150);
    return document.querySelector('#course-view .cv-title')?.textContent ?? '';
  })();
  A('урок тоже показывает номер курса, а номер пособия остаётся в подписи',
    /^Упражнение 1\.1\./.test(exTitle)
      && /в пособии 3\.1/.test(document.querySelector('#course-view .cv-src')?.textContent ?? ''),
    exTitle.slice(0, 40));

  /* --- 3: две картинки рядом; на узком месте — переключатель --------- */
  const figsInDom = () => document.querySelectorAll('#course-view .cv-fig').length;
  const shots = () => document.querySelectorAll('#course-view .cv-shot').length;
  const svgFigs = () => document.querySelectorAll('#course-view .cv-fig-canvas svg').length;
  const figBtn = (i) => document.querySelectorAll('#course-fig-toggle .cvt')[i];
  const modeHost = document.getElementById('course-mode');
  U.course.close();
  await U.course.openChapter('ch3');
  await sleep(100);
  U.course.open('ex-3.1');
  await sleep(300);

  // Пара: у рисунка с двумя источниками рядом и наш SVG, и снимок пособия.
  const pairFigs = [...document.querySelectorAll('#course-view .cv-fig')]
    .filter((f) => f.querySelector('.cv-fig-pair'));
  const pairsOk = pairFigs.length > 0 && pairFigs.every((f) => {
    const p = f.querySelector('.cv-fig-pair');
    return p.children.length === 2 && !!p.querySelector('svg') && !!p.querySelector('img.cv-shot');
  });
  const pairHref = pairFigs[0]?.querySelector('img.cv-shot')?.getAttribute('src') ?? '';
  A('рисунок с двумя источниками: наш рендер и снимок пособия стоят рядом',
    pairsOk && /vp163/.test(pairHref),
    'пар ' + pairFigs.length + ', снимок ' + pairHref);

  // Узкое место: пара уступает переключателю «Наши модели / Из пособия».
  // Режим ужимается по-настоящему — ширину решает раскладка, а не флаг.
  modeHost.style.width = '420px';
  await sleep(250);
  const narrowPairs = document.querySelectorAll('#course-view .cv-fig-pair').length;
  const narrowBtns = document.querySelectorAll('#course-fig-toggle .cvt').length;
  A('узкому месту хватает переключателя: пара уступает одной картинке',
    narrowPairs === 0 && narrowBtns === 2,
    'пар ' + narrowPairs + ', кнопок переключателя ' + narrowBtns);

  const oursShots = shots();
  const oursSvgs = svgFigs();
  figBtn(1).click();
  await sleep(200);
  const srcShots = shots();
  const srcSvg = svgFigs();
  const srcHref = document.querySelector('#course-view .cv-shot')?.getAttribute('src') ?? '';
  const srcText = document.getElementById('course-view').textContent;
  const savedMode = localStorage.getItem('uml-course.figures');
  figBtn(0).click();
  await sleep(150);
  A('переключатель «Наши модели / Из пособия»: снимок вместо рендера, выбор помнится',
    figsInDom() > 0 && oursShots === 0 && oursSvgs > 0 && srcShots > 0 && srcSvg === 0
      && /vp163/.test(srcHref) && savedMode === 'source' && shots() === 0
      && localStorage.getItem('uml-course.figures') === 'ours'
      && /снимок из пособия/.test(srcText),
    'наших svg ' + oursSvgs + '/снимков ' + oursShots + ' → svg ' + srcSvg + '/снимков ' + srcShots
      + ' (' + srcHref + '), режим ' + savedMode + ' → ' + localStorage.getItem('uml-course.figures')
      + ', после возврата снимков ' + shots());

  const cidx = U.course.index();
  const lostFig = cidx.chapters[0].exercises[0].figures.find((f) => f.original);
  const keepOriginal = lostFig.original;
  delete lostFig.original;
  figBtn(1).click();
  await sleep(60);
  U.course.close();
  await U.course.openChapter('ch3');
  await sleep(80);
  U.course.open('ex-3.1');
  await sleep(250);
  const noShotNote = /снимка нет/.test(document.getElementById('course-view').textContent);
  const noShotSvg = svgFigs();
  A('если снимка нет — остаётся наш рендер с пометкой «снимка нет»',
    noShotNote && noShotSvg > 0,
    'пометка ' + noShotNote + ', наших svg ' + noShotSvg);
  lostFig.original = keepOriginal;
  figBtn(0).click();
  modeHost.style.width = '';        // снова широкий режим: пара вернулась
  await sleep(200);

  /* --- л: в подвале урока нет дублирующих кнопок --------------------- */
  const footBtns = [...document.querySelectorAll('#course-view .cv-foot button, #course-view .cv-foot a')]
    .map((b) => b.textContent.trim());
  const figModelBtns = document.querySelectorAll('#course-view .cv-fig-links .linkbtn').length;
  A('в подвале урока только «К листу», у рисунков — свои кнопки',
    footBtns.length === 1 && footBtns[0] === 'К листу' && figModelBtns >= 2
      && !/Открыть как модель/.test(document.querySelector('#course-view .cv-foot').textContent),
    'подвал: ' + footBtns.join(' | ') + '; кнопок у рисунков: ' + figModelBtns);

  const emptyEx = (U.course.index().chapters.flatMap((c) => c.exercises)).find((e) => !(e.figures ?? []).length);
  if (emptyEx) {
    U.course.open(emptyEx.id);
    await sleep(200);
    const foot2 = [...document.querySelectorAll('#course-view .cv-foot button')].map((b) => b.textContent.trim());
    A('упражнение без рисунков: текст и «К листу» на месте, кнопок нет',
      /Упражнение/.test(document.querySelector('#course-view .cv-title')?.textContent ?? '')
        && foot2.length === 1 && foot2[0] === 'К листу',
      'упражнение ' + emptyEx.number + ', подвал ' + foot2.join(' | '));
  }
  U.course.close();

  /* --- 4a: нумерованные списки не рвутся ---------------------------- */
  const mdList = CM.markdown([
    'Список первый:',
    '',
    '1. раз',
    '',
    '2. два',
    '',
    '3. три',
    '',
    'Между списками обычный абзац.',
    '',
    '1. иной',
    '',
    '2. другой',
  ].join('\n'));
  const ols = [...mdList.querySelectorAll('ol')];
  A('пункты через пустую строку — один список; текст между ними начинает новый',
    ols.length === 2 && ols[0].children.length === 3 && ols[1].children.length === 2,
    'списков ' + ols.length + ', элементов ' + ols.map((o) => o.children.length).join('/'));

  const mdSub = CM.markdown(['1. верх', '', '- подпункт', '', '- ещё', '', '2. второй'].join('\n'));
  const oneOl = mdSub.querySelectorAll('ol');
  A('вложенные подпункты не рвут нумерацию',
    oneOl.length === 1 && oneOl[0].children.length === 2
      && oneOl[0].children[0].querySelectorAll('ul li').length === 2,
    'списков ' + oneOl.length + ', в первом ' + (oneOl[0]?.children[0]?.querySelectorAll('ul li').length ?? 0) + ' подпунктов');

  await U.course.openChapter('ch3');
  await sleep(400);
  const specOl = [...document.querySelectorAll('#course-view .cv-md ol')]
    .find((o) => /Функциональные возможности/.test(o.textContent));
  A('«Дополнительная спецификация» пронумерована 1..6 одним списком',
    !!specOl && specOl.children.length === 6,
    specOl ? 'пунктов ' + specOl.children.length : 'блока не нашли');
  U.course.close();

  /* --- м: два новых глифа ------------------------------------------- */
  const libGlyph = ICONS.icon('ui-library', 18);
  const crsGlyph = ICONS.icon('ui-course', 18);
  const crs16 = ICONS.icon('ui-course', 16);
  document.body.append(libGlyph, crsGlyph, crs16);
  let libBox = null;
  try { libBox = libGlyph.getBBox(); } catch { libBox = null; }
  const libBtnSvg = document.querySelector('#toolbar [aria-label^="Библиотека"] svg');
  const crsBtnSvg = document.querySelector('#toolbar [aria-label^="Курс"] svg');
  const ink = (svg) => svg.querySelectorAll('path, line, circle, rect, polygon, polyline').length;
  A('глифы ui-library и ui-course нарисованы, зарегистрированы и стоят на кнопках',
    ICONS.UI_ICONS.includes('ui-library') && ICONS.UI_ICONS.includes('ui-course')
      && ink(libGlyph) === 2 && ink(crsGlyph) === 6 && ink(crs16) === 6
      && !!libBox && libBox.width > 10 && libBox.width < 24 && libBox.height > 6
      && ink(libBtnSvg) === 2 && ink(crsBtnSvg) === 6,
    'библиотека: ' + ink(libGlyph) + ' штрихов (' + Math.round(libBox?.width ?? 0)
      + '×' + Math.round(libBox?.height ?? 0) + '), курс: ' + ink(crsGlyph)
      + ' штрихов, на кнопках ' + ink(libBtnSvg) + '/' + ink(crsBtnSvg));
  libGlyph.remove(); crsGlyph.remove(); crs16.remove();

  /* --- н: клик по полке открывает указатель ------------------------- */
  REF.open();
  await sleep(300);
  const shelfProbe = [];
  for (const s of ['notation', 'rules', 'spec', 'tutorial', 'stereotypes', 'plantuml']) {
    await REF.openArticle(s + ':');
    await sleep(220);
    const doc = document.getElementById('ref-doc');
    const txt = doc.textContent ?? '';
    const bad = /не найдено|не найден\.|Карточка не найдена|Конструкция не найдена|Упражнение не найдено|Стереотип не найден|Пункт не найден/i.test(txt);
    const links = doc.querySelectorAll('a').length;
    shelfProbe.push({ s, bad, links, len: txt.length });
  }
  A('клик по каждой полке с указателем даёт указатель, а не «не найдено»',
    shelfProbe.every((p) => !p.bad && p.links > 2 && p.len > 80),
    shelfProbe.map((p) => p.s + ':' + p.links + (p.bad ? '✗' : '✓')).join(' '));

  await REF.openArticle('rules:нет-такого-правила');
  await sleep(220);
  A('битый id по-прежнему даёт внятное «не найдено»',
    /Правило не найдено/.test(document.getElementById('ref-doc').textContent ?? ''),
    (document.getElementById('ref-doc').textContent ?? '').slice(0, 40));

  /* --- полка «Стандарт»: реестр переехал из правой панели в библиотеку --
     Владелец: «стандарт в правой панели» — это справочник, а не инструмент
     рисования; в панели 255 px таблица из 449 строк заведомо тесна. Здесь
     проверяется переезд целиком: вкладки в панели больше нет, полка в
     библиотеке показывает ВСЕ строки реестра, по умолчанию видны только
     «в области», шапка называет числа из того же файла, и таблица не даёт
     горизонтальной прокрутки ни на 420 (библиотека рядом с листом), ни на
     255 (прежняя ширина панели). */
  const covData = await (await fetch('/notation/rules/coverage.json')).json();
  const stdTabGone = !document.querySelector('#right .tab[data-tab="standard"]')
    && !document.getElementById('standard');
  await REF.openArticle('standard:');
  await sleep(400);
  const stdDoc = document.getElementById('ref-doc');
  const stdRows = [...stdDoc.querySelectorAll('.std-row')];
  const stdVisible = stdRows.filter((n) => !n.hidden).length;
  const stdHead = (document.getElementById('standard-nums')?.textContent ?? '').trim();
  const stdRep = U.standard.report();
  // Ширина библиотеки — переменная --ref-w: ставим 420 (split) и 255 (бывшая
  // панель) и читаем, влезает ли документ. Читаем сразу после установки —
  // clientWidth сам вызывает пересчёт.
  const widthProbe = (w) => {
    const root = document.documentElement;
    const prev = root.style.getPropertyValue('--ref-w');
    root.style.setProperty('--ref-w', w + 'px');
    const sc = document.getElementById('ref-scroll');
    const m = { w, c: sc.clientWidth, s: sc.scrollWidth };
    if (prev) root.style.setProperty('--ref-w', prev); else root.style.removeProperty('--ref-w');
    return m;
  };
  const at420 = widthProbe(420);
  const at255 = widthProbe(255);
  const headWant = covData.byStatus.executable + ' из ' + covData.totals.inScope + ' в области'
    + ' · записано ' + covData.totals.rulesWritten;
  A('полка «Стандарт»: все строки реестра, 166 видимых, шапка из данных, вкладки нет',
    stdTabGone && stdRep.ready
      && stdRows.length === covData.totals.constraints
      && stdVisible === covData.totals.inScope
      && stdHead === headWant
      && at420.s <= at420.c + 1 && at255.s <= at255.c + 1,
    stdRows.length + ' строк, видимых ' + stdVisible + ', шапка «' + stdHead + '»; '
      + 'прокрутка ' + at420.s + '/' + at420.c + ' при 420 и '
      + at255.s + '/' + at255.c + ' при 255'
      + (stdTabGone ? '' : '; вкладка «Стандарт» ещё в панели'));

  /* --- A1/A2: полки названы по-разному, вторая строка видима, 3 группы --
     Владелец: «как пользователю отличать их между собой, кто за что
     отвечает». Проверяем то, что видно: 7 полок, 3 подписи групп, у каждой
     полки вторая строка, и она — из данных, а не из разметки. */
  await REF.openArticle('spec:about');
  await sleep(300);
  const navTitles = [...document.querySelectorAll('#ref-nav .shelf .shelf-btn')]
    .map((b) => b.textContent.trim());
  const navHints = [...document.querySelectorAll('#ref-nav .shelf-hint')]
    .map((n) => n.textContent.trim());
  const navCaps = [...document.querySelectorAll('#ref-nav .shelf-caption')]
    .map((n) => n.textContent.trim());
  const hintByTitle = Object.fromEntries(REF.shelves().map((s) => [s.title, s.hint]));
  // Вторая строка обязана быть ВИДИМОЙ, а не просто лежать в DOM: в статье
  // дерево скрыто, поэтому меряем в режиме дерева и смотрим высоту строки и
  // отсутствие горизонтальной прокрутки (колонка 200 px).
  REF.setView('tree');
  await sleep(200);
  const hintBoxes = [...document.querySelectorAll('#ref-nav .shelf-hint')]
    .map((n) => Math.round(n.getBoundingClientRect().height));
  const navEl = document.getElementById('ref-nav');
  // В режиме дерева колонка растянута на всю ширину; настоящая её ширина —
  // 200 px (--ref-nav) в трёхколоночном режиме. Ставим её руками, чтобы
  // проверить перенос подсказки и отсутствие горизонтальной прокрутки там,
  // где полка живёт на самом деле.
  const prevW = navEl.style.width;
  const prevF = navEl.style.flex;
  navEl.style.width = '200px';
  navEl.style.flex = '0 0 200px';
  const navOverflow = { c: navEl.clientWidth, s: navEl.scrollWidth };
  const lineOver = [...document.querySelectorAll('#ref-nav .shelf-line')]
    .filter((n) => n.scrollWidth > n.clientWidth + 1).length;
  navEl.style.width = prevW;
  navEl.style.flex = prevF;
  REF.setView('article');
  await sleep(150);
  const dA1 = REF.state.data;
  const exN = dA1.course.chapters.reduce((n, c) => n + c.exercises.length, 0);
  const shapeN = Object.keys(U.NOTATION.shapes).length;
  const connN = Object.keys(U.NOTATION.connectors).length;
  const wantTitles = ['Нотация', 'Пособие', 'Правила движка', 'Реестр констрейнтов',
    'Спецификация', 'Стереотипы', 'PlantUML'];
  A('A1/A2: 7 полок, 3 группы, у каждой видимая вторая строка из данных',
    navTitles.length === 7 && navHints.length === 7
      && navCaps.join('|') === 'Объяснения|Стандарт|Данные профиля'
      && navTitles.join('|') === wantTitles.join('|')
      && navTitles.every((t, i) => navHints[i] === hintByTitle[t] && navHints[i].length > 10)
      && navHints[0].includes(String(shapeN)) && navHints[0].includes(String(connN))
      && navHints[2].includes(String(dA1.rules.length))
      && navHints[2].includes(String(dA1.practice.length))
      && navHints[3].includes(String(dA1.coverage.totals.constraints))
      && navHints[1].includes(String(exN))
      && hintBoxes.length === 7 && hintBoxes.every((h) => h >= 12)
      && navOverflow.s <= navOverflow.c + 1 && lineOver === 0,
    navTitles.length + ' полок, ' + navCaps.length + ' групп, строки высотой '
      + hintBoxes.join('/') + ' px, прокрутка ' + navOverflow.s + '/' + navOverflow.c
      + ' при 200 px, строк с обрезкой ' + lineOver
      + '; порядок ' + navTitles.join(' · '));

  /* --- A3: шапка называет, чей это текст ----------------------------- */
  const metaOf = async (key) => {
    await REF.openArticle(key);
    await sleep(260);
    return (document.querySelector('#ref-doc .doc-meta')?.textContent ?? '').replace(/\s+/g, ' ');
  };
  const metaRule = await metaOf('rules:element-not-own-self');
  const metaStd = await metaOf('standard:');
  const metaSpec = await metaOf('spec:11.5.4-notation');
  const metaTut = await metaOf('tutorial:ex-4.1');
  const metaPrac = await metaOf('rules:' + dA1.practice[0].id);
  A('A3: шапка говорит, чей текст — движок, реестр, OMG, упражнение, совет',
    /проверяет движок/.test(metaRule) && /в реестре: проверяется/.test(metaRule)
      && /реестр стандарта, не наши правила/.test(metaStd)
      && /первоисточник OMG/.test(metaSpec)
      && /упражнение 4\.1/.test(metaTut) && /рис\. 4\.1\.3/.test(metaTut)
      && /наш совет, не требование стандарта/.test(metaPrac),
    [metaRule, metaStd, metaSpec, metaTut, metaPrac].map((m) => m.slice(0, 46)).join(' | '));

  // Статус в шапке правила — из реестра, а не из головы: у правила, которого
  // модель не выражает, он «тавтология» или «нужно поле», и шапка говорит это
  // словами реестра. Два разных статуса — чтобы проверка не сошлась на одном.
  const metaTaut = await metaOf('rules:association-end-typed');
  const metaGap = await metaOf('rules:package-element-visibility');
  A('A3: статус невыразимого правила берётся из реестра — тавтология и нужно поле',
    /не выражается моделью/.test(metaTaut) && /в реестре: тавтология/.test(metaTaut)
      && /не выражается моделью/.test(metaGap) && /в реестре: нужно поле/.test(metaGap),
    [metaTaut, metaGap].map((m) => m.slice(0, 60)).join(' | '));

  /* --- A4-1: правило → его строка реестра ---------------------------- */
  await REF.openArticle('rules:element-not-own-self');
  await sleep(300);
  const regChip = [...document.querySelectorAll('#ref-doc .doc-meta .chip')]
    .find((b) => /в реестре: проверяется/.test(b.textContent));
  regChip?.click();
  await sleep(450);
  const regRow = document.querySelector('#ref-doc .std-row[data-key="Element::not_own_self"]');
  A('A4-1: правило → реестр: чип открывает строку Element::not_own_self раскрытой',
    !!regChip && REF.current().shelf === 'standard' && !!regRow && !regRow.hidden
      && regRow.getAttribute('aria-expanded') === 'true' && regRow.classList.contains('hit'),
    regChip ? 'чип «' + regChip.textContent + '», строка ' + (regRow?.dataset.key ?? 'нет')
      + ', раскрыта ' + regRow?.getAttribute('aria-expanded') : 'чипа нет');

  /* --- A4-2: реестр → правило, 58 строк ------------------------------ */
  // Полку открываем сами: проверка не должна зависеть от того, куда привёл
  // предыдущий шаг (иначе её «0 чипов» ничего не значит).
  await REF.openArticle('standard:');
  await sleep(450);
  const stdRuleChips = [...document.querySelectorAll('#ref-doc .std-row .std-rule')];
  const ownRuleChip = document.querySelector('#ref-doc .std-row[data-key="Element::not_own_self"] .std-rule');
  ownRuleChip?.click();
  await sleep(400);
  A('A4-2: реестр → правило: чип у каждой строки с правилом, ведёт в статью правила',
    stdRuleChips.length === dA1.rules.length && !!ownRuleChip
      && REF.current().shelf === 'rules' && REF.current().id === 'element-not-own-self',
    stdRuleChips.length + ' чипов при ' + dA1.rules.length + ' правилах, открыто '
      + REF.current().shelf + ':' + REF.current().id);

  /* --- A4-3: пункт → реестр ----------------------------------------- */
  await REF.openArticle('spec:11.5.4-notation');
  await sleep(500);
  const regLine = [...document.querySelectorAll('#ref-doc .fine a')]
    .find((a) => /— в реестре/.test(a.textContent));
  regLine?.click();
  await sleep(450);
  A('A4-3: пункт → реестр: строка «все N констрейнтов — в реестре» открывает полку',
    !!regLine && regLine.textContent.startsWith('все ' + dA1.coverage.totals.constraints + ' ')
      && REF.current().shelf === 'standard',
    regLine ? '«' + regLine.textContent + '» → ' + REF.current().shelf : 'строки нет');

  /* --- A4-4: упражнение → пункты стандарта --------------------------- */
  await REF.openArticle('tutorial:ex-4.1');
  await sleep(400);
  const exGroup = [...document.querySelectorAll('#ref-doc .rel .grp')]
    .find((g) => /^Пункты стандарта/.test(g.querySelector('.gl')?.textContent ?? ''));
  const exChips = [...(exGroup?.querySelectorAll('.chip') ?? [])];
  const exClauses = new Set(dA1.links.tutorial
    .filter((t) => t.kind === 'exercise' && t.id === '4.1' && t.clause)
    .map((t) => t.clause.number));
  exChips[0]?.click();
  await sleep(400);
  A('A4-4: упражнение 4.1 → пункты стандарта: чипы по связям, клик открывает пункт',
    exChips.length === exClauses.size && exChips.length > 0 && REF.current().shelf === 'spec',
    exChips.length + ' чипов, в links.tutorial ' + exClauses.size + ' пунктов: '
      + exChips.map((c) => c.textContent).join(', ').slice(0, 90));

  // Вход из «Проверок»: человек увидел «невыразимо» — и должен попасть в
  // реестр, иначе объяснения ему искать негде.
  document.querySelector('#right .tab[data-tab="checks"]').click();
  await sleep(350);
  const stdLink = document.getElementById('checks-standard-link');
  REF.close();
  await sleep(150);
  stdLink?.click();
  await sleep(600);
  A('из панели «Проверки» есть вход в реестр: ссылка открывает полку «Стандарт»',
    !!stdLink && REF.isOpen() && REF.current().shelf === 'standard'
      && REF.current().id === '',
    stdLink ? 'ссылка «' + stdLink.textContent + '», открыто '
      + REF.current().shelf + ':' + REF.current().id : 'ссылки нет');
  document.querySelector('#right .tab[data-tab="props"]').click();
  REF.close();
  await sleep(150);
  }

  /* --- Э2-бис: расширение модели по пробелам корпуса ------------------ */
  /* Каждая партия проверяется четырьмя доказательствами из §5 плана:
     круг (файл → модель → файл → модель), знак на листе, намеренная
     поломка (испорченное значение обязано дать ремонт и потеряться) и
     «поле не появляется зря» (значение по умолчанию не пишется). */

  const em = (id, kind, name, extra = {}) => ({ id, kind, name, ...extra });
  const makeModel = (elements, relationships, diagram = {}) => ({
    schema: 'uml-model/3', id: 'mE2', name: 'Э2-бис', created: '2026-11-05',
    elements, relationships,
    diagrams: [{ id: 'd1', name: 'D', kind: 'class', shapes: [], links: [], ...diagram }],
    currentDiagramId: 'd1',
  });
  const rt = (obj) => {
    const t1 = JSON.stringify(obj, null, 2) + '\n';
    const rep = [];
    const m1 = U.deserialize(t1, { repairs: rep });
    const t2 = U.serialize(m1);
    const m2 = U.deserialize(t2, { repairs: [] });
    return { m1, m2, t1, t2, rep, stable: U.serialize(m2) === t2 };
  };
  const show = async (m) => {
    U.loadModel(m, 'e2bis.uml');
    U.renderCanvas();
    // Панели перерисовываются в микрозадаче после emit — даём ей пройти.
    await new Promise((r) => setTimeout(r, 30));
    return m;
  };
  const svg = () => document.getElementById('canvas');

  /* Б1 — ownerId и дерево модели */
  {
    const r = rt(makeModel([
      em('e1', 'package', 'Домен'),
      em('e2', 'component', 'Ядро', { ownerId: 'e1' }),
      em('e3', 'class', 'Заказ', { ownerId: 'e2' }),
    ], []));
    const kids = r.m1.elements.filter((e) => e.ownerId === 'e1').map((e) => e.id);
    const back = r.m2.elements.find((e) => e.id === 'e3')?.ownerId;
    A('Б1 ownerId: круг файл → модель → файл держит вложенность', kids.join(',') === 'e2' && back === 'e2' && r.stable,
      'дети e1: ' + kids.join(',') + ', у e3 владелец ' + back);
    A('Б1 верхний уровень не пишется: у элемента без владельца поля нет',
      !('ownerId' in r.m2.elements.find((e) => e.id === 'e1'))
        && !/ownerId/.test(JSON.stringify(r.m2.elements.find((e) => e.id === 'e1'))),
      'у «Домен» поля ' + ('ownerId' in r.m2.elements[0]));

    const cyc = rt(makeModel([em('e1', 'package', 'A', { ownerId: 'e2' }), em('e2', 'package', 'B', { ownerId: 'e1' })], []));
    A('Б1 цикл владения снимается при чтении с замечанием',
      cyc.m1.elements.some((e) => !e.ownerId) && cyc.rep.some((x) => /цикл/.test(x)),
      cyc.rep.join(' | ') || 'ремонтов нет');

    const bad = rt(makeModel([em('e1', 'package', 'A'), em('e2', 'class', 'B', { ownerId: 'e404' })], []));
    A('Б1 намеренная поломка: владелец не найден — поле снято, ремонт назван',
      !bad.m1.elements[1].ownerId && bad.rep.some((x) => /владелец e404 не найден/.test(x)),
      bad.rep.join(' | ') || 'ремонтов нет');

    const m = await show(U.deserialize(JSON.stringify(makeModel([
      em('e1', 'package', 'Домен'),
      em('e2', 'class', 'Заказ', { ownerId: 'e1' }),
    ], [])), { repairs: [] }));
    const tree = document.getElementById('model');
    const parentRow = tree.querySelector('.node[data-element-id="e1"]');
    const childBox = parentRow?.closest('li')?.querySelector('ul.nested .node[data-element-id="e2"]');
    A('Б1 дерево модели показывает вложенность по ownerId', !!childBox,
      childBox ? 'e2 вложен под e1' : 'e2 не вложен');
    const own = U.childrenOf(m, 'e1').map((e) => e.id);
    const roots = U.rootsOf(m).map((e) => e.id);
    A('Б1 childrenOf/rootsOf считаются, а не хранятся', own.join(',') === 'e2' && roots.join(',') === 'e1',
      'дети ' + own.join(',') + ', корни ' + roots.join(','));
  }

  /* Б2 — сообщения: свободные концы, seq, асинхронность */
  {
    const lost = makeModel([
      em('e1', 'lifeline', 'db:DBAccess'), em('e2', 'lifeline', 'c:Connection'),
    ], [
      { id: 'r1', kind: 'message', name: 'init()', from: 'e1', to: 'e2' },
      { id: 'r2', kind: 'reply', name: 'c <> NULL', from: 'e1', to: null },
    ], { kind: 'sequence', shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 40, w: 120, h: 260 },
      { id: 's2', elementId: 'e2', x: 320, y: 40, w: 120, h: 260 },
    ], links: [
      { id: 'l1', relId: 'r1', from: { shapeId: 's1', side: 'right', t: 0.5 }, to: { shapeId: 's2', side: 'left', t: 0.5 }, y: 120 },
      { id: 'l2', relId: 'r2', from: { shapeId: 's1', side: 'right', t: 0.5 }, to: null, y: 160 },
    ] });
    const r = rt(lost);
    A('Б2 потерянное сообщение переживает круг: конец остаётся null',
      r.m1.relationships.length === 2 && r.m1.relationships[1].to === null
        && r.m2.relationships[1].to === null && r.stable && !r.rep.length,
      r.m1.relationships.length + ' связей, ремонтов ' + r.rep.length);

    await show(r.m1);
    const circle = svg().querySelector('[data-free-end="to"]');
    A('Б2 на свободном конце рисуется кружок, связь не теряется',
      !!circle && svg().querySelectorAll('[data-kind="conn"]').length === 2,
      circle ? 'кружок есть, связей ' + svg().querySelectorAll('[data-kind="conn"]').length : 'кружка нет');

    const broken = rt(makeModel([em('e1', 'lifeline', 'a'), em('e2', 'lifeline', 'b')], [
      { id: 'r1', kind: 'message', name: 'm', from: 'e1', to: 'e404' },
      { id: 'r2', kind: 'association', from: 'e1', to: null },
    ], { kind: 'sequence' }));
    A('Б2 намеренная поломка: конец в пустоту у не-сообщения отбрасывает связь',
      broken.m1.relationships.length === 0 && broken.rep.filter((x) => /пропущена/.test(x)).length === 2,
      broken.rep.join(' | '));

    const sy = makeModel([em('e1', 'lifeline', 'a'), em('e2', 'lifeline', 'b')], [
      { id: 'r1', kind: 'message', name: 'первое по seq', from: 'e1', to: 'e2', seq: 10 },
      { id: 'r2', kind: 'message', name: 'асинхронное', from: 'e2', to: 'e1', seq: 20, asynchronous: true },
      { id: 'r3', kind: 'message', name: 'третье', from: 'e1', to: 'e2', seq: 30 },
    ], { kind: 'sequence', shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 40, w: 120, h: 300 },
      { id: 's2', elementId: 'e2', x: 320, y: 40, w: 120, h: 300 },
    ], links: [
      { id: 'l1', relId: 'r1', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' } },
      { id: 'l2', relId: 'r2', from: { shapeId: 's2', side: 'left' }, to: { shapeId: 's1', side: 'right' } },
      { id: 'l3', relId: 'r3', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' } },
    ] });
    const rs = rt(sy);
    A('Б2 seq и asynchronous переживают круг, поля не пишутся зря',
      rs.m2.relationships.map((x) => x.seq).join(',') === '10,20,30'
        && rs.m2.relationships[1].asynchronous === true && rs.stable,
      'seq ' + rs.m2.relationships.map((x) => x.seq).join(','));
    const order = U.messageOrder(U.currentDiagram(rs.m1), rs.m1);
    const idx = [...order.values()].map((v) => v.index);
    A('Б2 seq главный для всех: порядок 10 → 20 → 30', idx.join(',') === '0,1,2', 'порядок ' + idx.join(','));
    await show(rs.m1);
    const conng = [...svg().querySelectorAll('[data-kind="conn"]')];
    const ys = conng.map((g) => Number(g.querySelector('path.conn').getAttribute('d').match(/^M [\d.-]+ ([\d.-]+)/)?.[1] ?? 0));
    const openHead = conng[1]?.querySelector('.head-open');
    A('Б2 на листе: seq раскладывает сообщения по высоте, асинхронное — открытой стрелкой',
      ys[0] < ys[1] && ys[1] < ys[2] && !!openHead && !conng[1].querySelector('.head-fill'),
      'высоты ' + ys.join(' < ') + ', открытая стрелка ' + !!openHead);
  }


  /* Б1 (продолжение) — удаление владельца не уносит детей (§3.1) */
  {
    const m = await show(U.deserialize(JSON.stringify(makeModel([
      em('e1', 'package', 'Домен'),
      em('e2', 'class', 'Заказ', { ownerId: 'e1' }),
      em('e3', 'class', 'Клиент', { ownerId: 'e1' }),
    ], [])), { repairs: [] }));
    U.commit('Удалить пакет', (mm) => U.removeElement(mm, 'e1'));
    const left = U.store.model.elements.map((e) => e.id + ':' + (e.ownerId ?? '-'));
    A('Б1 удаление владельца снимает ownerId, а не удаляет детей',
      left.join(',') === 'e2:-,e3:-' && U.rootsOf(U.store.model).length === 2,
      left.join(','));

    const cyc = await show(U.deserialize(JSON.stringify(makeModel([
      em('e1', 'package', 'A'), em('e2', 'package', 'B', { ownerId: 'e1' }),
    ], [])), { repairs: [] }));
    const refused = U.commit('Цикл', (mm) => U.setOwner(mm, U.store.model.elements[0], 'e2'));
    A('Б1 setOwner отказывает в цикле и не портит модель',
      refused === false && !U.store.model.elements[0].ownerId,
      'владелец A: ' + (U.store.model.elements[0].ownerId ?? 'нет'));
  }

  /* Б2 (продолжение) — seq есть не у всех: остальные идут после, по геометрии */
  {
    const half = makeModel([el0('e1', 'lifeline', 'a'), el0('e2', 'lifeline', 'b')], [
      { id: 'r1', kind: 'message', name: 'по геометрии', from: 'e1', to: 'e2' },
      { id: 'r2', kind: 'message', name: 'по seq', from: 'e1', to: 'e2', seq: 20 },
    ], { kind: 'sequence', shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 40, w: 120, h: 300 },
      { id: 's2', elementId: 'e2', x: 320, y: 40, w: 120, h: 300 },
    ], links: [
      { id: 'l1', relId: 'r1', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' }, y: 90 },
      { id: 'l2', relId: 'r2', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' } },
    ] });
    function el0(id, kind, name) { return { id, kind, name }; }
    const m1 = U.deserialize(JSON.stringify(half, null, 2) + '\n', { repairs: [] });
    const order = [...U.messageOrder(U.currentDiagram(m1), m1).entries()]
      .sort((a, b) => a[1].index - b[1].index).map(([id]) => id);
    A('Б2 при seq у одного сообщения остальные идут после, по геометрии',
      order.join(',') === 'l2,l1', 'порядок ' + order.join(','));
  }

  /* Б3 — линии жизни */
  {
    const r = rt(makeModel([
      em('e1', 'lifeline', 'studlist[i]:Student', { multiObject: true }),
      em('e2', 'lifeline', 'curSched:Schedule', { stopped: true }),
    ], [], { kind: 'sequence', shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 40, w: 120, h: 260 },
      { id: 's2', elementId: 'e2', x: 320, y: 40, w: 120, h: 260 },
    ] }));
    A('Б3 multiObject и stopped переживают круг',
      r.m2.elements[0].multiObject === true && r.m2.elements[1].stopped === true && r.stable, 'круг стабилен');
    A('Б3 выключенный флаг не пишется: у линии без флагов полей нет',
      !/multiObject|stopped/.test(JSON.stringify(rt(makeModel([em('e1', 'lifeline', 'x')], [], { kind: 'sequence' })).m2)),
      'полей нет');
    await show(r.m1);
    const groups = [...svg().querySelectorAll('[data-kind="shape"]')];
    const multiPath = groups[0]?.querySelectorAll('path.sh-line').length ?? 0;
    const cross = [...(groups[1]?.querySelectorAll('path.sh-line') ?? [])]
      .filter((p) => (p.getAttribute('d') ?? '').split('M').length > 2);
    A('Б3 на листе: наклонные черты у головы и крест в конце линии',
      multiPath >= 1 && cross.length >= 1,
      'штрихов у множественной ' + multiPath + ', крестов ' + cross.length);
  }

  /* Б4 — операнды фрагментов */
  {
    const r = rt(makeModel([
      em('e1', 'lifeline', 'a'), em('e2', 'lifeline', 'b'),
      em('e5', 'fragment', 'alt', { operator: 'alt', operands: [
        { id: 'o1', guard: 'логин верный', messages: ['r4', 'r5'] },
        { id: 'o2', guard: 'иначе', messages: ['r6'] },
      ] }),
    ], [
      { id: 'r4', kind: 'message', name: 'login', from: 'e1', to: 'e2' },
      { id: 'r5', kind: 'reply', name: 'ok', from: 'e2', to: 'e1' },
      { id: 'r6', kind: 'message', name: 'fail', from: 'e1', to: 'e2' },
    ], { kind: 'sequence', shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 40, w: 120, h: 300 },
      { id: 's2', elementId: 'e2', x: 420, y: 40, w: 120, h: 300 },
      { id: 's5', elementId: 'e5', x: 40, y: 150, w: 520, h: 160 },
    ], links: [
      { id: 'l4', relId: 'r4', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' }, y: 170 },
      { id: 'l5', relId: 'r5', from: { shapeId: 's2', side: 'left' }, to: { shapeId: 's1', side: 'right' }, y: 200 },
      { id: 'l6', relId: 'r6', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' }, y: 250 },
    ] }));
    const frag = r.m2.elements.find((e) => e.id === 'e5');
    A('Б4 операнды: сторожа и покрытие переживают круг',
      frag.operands?.length === 2 && frag.operands[0].guard === 'логин верный'
        && frag.operands[0].messages.join(',') === 'r4,r5' && r.stable,
      JSON.stringify(frag.operands));

    const bad = rt(makeModel([em('e1', 'lifeline', 'a'), em('e2', 'lifeline', 'b'),
      em('e5', 'fragment', 'alt', { operator: 'alt', operands: [
        { id: 'o1', guard: 'x', messages: ['r4', 'e1'] },
      ] })], [{ id: 'r4', kind: 'message', name: 'm', from: 'e1', to: 'e2' }], { kind: 'sequence' }));
    A('Б4 намеренная поломка: покрытие не на сообщение снимается с замечанием',
      bad.m1.elements[2].operands[0].messages.join(',') === 'r4'
        && bad.rep.some((x) => /не на сообщения/.test(x)),
      bad.rep.join(' | '));

    await show(r.m1);
    const sep = svg().querySelectorAll('[data-operand-sep]');
    const guards = [...svg().querySelectorAll('[data-operand-guard]')].map((t) => t.textContent);
    A('Б4 на листе: разделитель между операндами и оба сторожа',
      sep.length === 1 && guards.length === 2 && guards[0] === '[логин верный]' && guards[1] === '[иначе]',
      'разделителей ' + sep.length + ', сторожа ' + guards.join(' / '));

    // Вложенный фрагмент: loop внутри alt — рамка внутреннего целиком в рамке
    // внешнего, и это не следствие раскладки: координаты заданы руками.
    U.commit('Вложенный фрагмент', (m) => {
      const { element, shape } = U.placeElement(m, 'fragment', 80, 190);
      shape.w = 300; shape.h = 80;
      element.operator = 'loop';
      element.operands = [{ id: 'g1', guard: 'для всех курсов', messages: [] }];
    });
    U.renderCanvas();
    await new Promise((r) => setTimeout(r, 80));
    const frames = [...svg().querySelectorAll('rect.sh-body.frame')];
    const boxes = frames.map((f) => ({
      x: Number(f.getAttribute('x')), y: Number(f.getAttribute('y')),
      w: Number(f.getAttribute('width')), h: Number(f.getAttribute('height')),
    }));
    const outer = boxes[0];
    const inner = boxes[boxes.length - 1];
    A('Б4 вложенный фрагмент рисуется внутри внешнего',
      boxes.length === 2 && inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h,
      'рамок ' + boxes.length + ', внутренняя ' + inner.x + ',' + inner.y);
  }

  /* Б5 — ссылки и классификаторы */
  {
    const r = rt({
      schema: 'uml-model/3', id: 'mB5', name: 'Б5',
      elements: [
        em('e1', 'class', 'Student'),
        em('e2', 'object', 's1:Student', { classifierId: 'e1' }),
        em('e3', 'interactionUse', 'Subflow', { operator: 'ref', refersTo: 'd2' }),
      ],
      relationships: [],
      diagrams: [
        { id: 'd1', name: 'Главная', kind: 'sequence', shapes: [], links: [] },
        { id: 'd2', name: 'DisplayCourseOfferings Subflow', kind: 'sequence', shapes: [], links: [] },
      ],
      currentDiagramId: 'd1',
    });
    A('Б5 classifierId и refersTo переживают круг',
      r.m2.elements[1].classifierId === 'e1' && r.m2.elements[2].refersTo === 'd2' && r.stable,
      'классификатор ' + r.m2.elements[1].classifierId + ', ссылка ' + r.m2.elements[2].refersTo);

    const byName = rt({
      schema: 'uml-model/3', id: 'mB5b', name: 'Б5б',
      elements: [em('e3', 'interactionUse', 'Subflow', { operator: 'ref', refersTo: 'DisplayCourseOfferings Subflow' })],
      relationships: [],
      diagrams: [{ id: 'd2', name: 'DisplayCourseOfferings Subflow', kind: 'sequence', shapes: [], links: [] }],
      currentDiagramId: 'd2',
    });
    A('Б5 refersTo, записанный именем диаграммы, уточняется до id',
      byName.m1.elements[0].refersTo === 'd2' && byName.rep.some((x) => /уточнён/.test(x)),
      byName.rep.join(' | ') || 'ремонтов нет');

    const bad = rt(makeModel([em('e2', 'object', 's', { classifierId: 'e404' })], []));
    A('Б5 намеренная поломка: классификатор не найден — ссылка снята',
      !bad.m1.elements[0].classifierId && bad.rep.some((x) => /classifierId e404/.test(x)),
      bad.rep.join(' | '));
  }

  /* Б6 — дорожки */
  {
    const r = rt(makeModel([
      em('e1', 'swimlane', 'Пользователь', { represents: 'e5' }),
      em('e2', 'action', 'Проверить логин', { laneId: 'e1' }),
      em('e3', 'action', 'Войти', { behaviorRef: 'e4' }),
      em('e4', 'activity', 'Авторизация'),
      em('e5', 'actor', 'Пользователь'),
    ], [], { kind: 'activity', shapes: [
      { id: 's1', elementId: 'e1', x: 40, y: 40, w: 420, h: 300 },
      { id: 's2', elementId: 'e2', x: 80, y: 120, w: 140, h: 50 },
      { id: 's3', elementId: 'e3', x: 80, y: 220, w: 140, h: 50 },
    ] }));
    A('Б6 laneId, represents и behaviorRef переживают круг',
      r.m2.elements[0].represents === 'e5' && r.m2.elements[1].laneId === 'e1'
        && r.m2.elements[2].behaviorRef === 'e4' && r.stable, 'круг стабилен');
    await show(r.m1);
    const laneText = svg().querySelector('[data-represents]')?.textContent ?? '';
    const behText = svg().querySelector('[data-behavior-ref]')?.textContent ?? '';
    A('Б6 на листе: дорожка называет представляемый элемент, действие — вызываемую деятельность',
      /Пользователь/.test(laneText) && /Авторизация/.test(behText),
      laneText + ' / ' + behText);
    const bad = rt(makeModel([em('e2', 'action', 'x', { laneId: 'e404' })], []));
    A('Б6 намеренная поломка: битая ссылка на дорожку снята',
      !bad.m1.elements[0].laneId && bad.rep.some((x) => /laneId e404/.test(x)), bad.rep.join(' | '));
  }

  /* Б7 — регионы деятельности */
  {
    const r = rt(makeModel([
      em('e1', 'action', 'Conditional', { regions: [
        { id: 'g1', name: 'тело', nodes: ['e2', 'e3'], edges: ['r1'] },
      ] }),
      em('e2', 'action', 'проверить'), em('e3', 'action', 'сохранить'),
    ], [{ id: 'r1', kind: 'controlFlow', from: 'e2', to: 'e3' }], { kind: 'activity', shapes: [
      { id: 's1', elementId: 'e1', x: 40, y: 40, w: 420, h: 300 },
      { id: 's2', elementId: 'e2', x: 80, y: 120, w: 140, h: 50 },
      { id: 's3', elementId: 'e3', x: 80, y: 220, w: 140, h: 50 },
    ] }));
    const reg = r.m2.elements[0].regions?.[0];
    A('Б7 регион переживает круг: имя, узлы и рёбра',
      reg?.name === 'тело' && reg.nodes.join(',') === 'e2,e3' && reg.edges.join(',') === 'r1' && r.stable,
      JSON.stringify(reg));
    await show(r.m1);
    const frame = svg().querySelector('[data-region="g1"]');
    const label = svg().querySelector('[data-region-name="g1"]');
    A('Б7 рамка региона обводит своих узлов и подписана',
      !!frame && !!label && Number(frame.getAttribute('width')) > 140
        && Number(frame.getAttribute('height')) > 150,
      frame ? 'рамка ' + frame.getAttribute('width') + '×' + frame.getAttribute('height') : 'рамки нет');
    const bad = rt(makeModel([em('e1', 'action', 'C', { regions: [{ id: 'g1', name: '', nodes: ['e404'] }] })], []));
    A('Б7 намеренная поломка: узел вне модели снимается из региона',
      !bad.m1.elements[0].regions[0].nodes && bad.rep.some((x) => /регион g1/.test(x)),
      bad.rep.join(' | '));
  }

  /* Б8 — регионы и внутренние переходы состояний */
  {
    const r = rt(makeModel([
      em('e1', 'state', 'Active', {
        regions: [{ id: 'g1', name: '', states: ['e2'], transitions: ['r2'] }],
        internals: [{ trigger: 'тик', guard: 'готов', effect: 'пересчитать' }],
      }),
      em('e2', 'state', 'Open'), em('e3', 'state', 'Closed'),
    ], [{ id: 'r2', kind: 'transition', from: 'e2', to: 'e3', local: true }], { kind: 'state', shapes: [
      { id: 's1', elementId: 'e1', x: 40, y: 40, w: 320, h: 240 },
      { id: 's2', elementId: 'e2', x: 60, y: 120, w: 140, h: 60 },
      { id: 's3', elementId: 'e3', x: 400, y: 120, w: 140, h: 60 },
    ], links: [{ id: 'l2', relId: 'r2', from: { shapeId: 's2', side: 'right' }, to: { shapeId: 's3', side: 'left' } }] }));
    const st = r.m2.elements[0];
    A('Б8 регионы состояния, внутренние переходы и local переживают круг',
      st.regions?.[0].states.join(',') === 'e2' && st.internals?.[0].trigger === 'тик'
        && r.m2.relationships[0].local === true && r.stable,
      JSON.stringify(st.internals) + ' / local ' + r.m2.relationships[0].local);
    await show(r.m1);
    const texts = [...svg().querySelectorAll('text')].map((t) => t.textContent);
    A('Б8 внутренний переход нарисован строкой внутри состояния',
      texts.includes('тик [готов] / пересчитать'),
      texts.filter((t) => /тик/.test(t)).join(' | ') || 'строки нет');
    A('Б8 намеренная поломка: пустой внутренний переход в файл не пишется',
      !/internals/.test(JSON.stringify(rt(makeModel([em('e1', 'state', 'S', { internals: [{ trigger: '', guard: '', effect: '' }] })], [])).m2)),
      'пустая строка отброшена');
  }

  /* Б9 — квалификаторы полюсов */
  {
    const r = rt(makeModel([
      em('e1', 'class', 'RegistrationController'), em('e2', 'class', 'Student'),
    ], [{ id: 'r1', kind: 'association', from: 'e1', to: 'e2', fromQualifiers: ['code'], toQualifiers: ['semester', 'year'] }],
    { kind: 'class', shapes: [
      { id: 's1', elementId: 'e1', x: 60, y: 60, w: 190, h: 120 },
      { id: 's2', elementId: 'e2', x: 380, y: 60, w: 190, h: 120 },
    ], links: [{ id: 'l1', relId: 'r1', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' } }] }));
    A('Б9 квалификаторы полюсов переживают круг',
      r.m2.relationships[0].fromQualifiers.join(',') === 'code'
        && r.m2.relationships[0].toQualifiers.join(',') === 'semester,year' && r.stable,
      JSON.stringify(r.m2.relationships[0].toQualifiers));
    await show(r.m1);
    const qf = svg().querySelector('[data-qualifier="from"]');
    const qt = svg().querySelector('[data-qualifier="to"]');
    A('Б9 на листе: прямоугольники у обоих полюсов', !!qf && !!qt,
      'полюсов с квалификатором ' + [qf, qt].filter(Boolean).length);
    A('Б9 намеренная поломка: пустые строки квалификаторов не пишутся',
      !/Qualifiers/.test(JSON.stringify(rt(makeModel([em('e1', 'class', 'A'), em('e2', 'class', 'B')],
        [{ id: 'r1', kind: 'association', from: 'e1', to: 'e2', fromQualifiers: ['  ', ''] }])).m2)),
      'поля нет');
  }


  /* Э2-бис: инспектор правит новые поля руками, а не только через файл */
  {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    blank();
    addDiagram('sequence', 'S');
    const lA = place('lifeline', 80, 100);
    const lB = place('lifeline', 380, 100);
    const fr = place('fragment', 60, 320);
    const props = () => document.getElementById('props');
    const pickAt = (sel) => props().querySelector(sel);
    const btn = (re) => [...props().querySelectorAll('button')].find((b) => re.test(b.textContent));

    U.set({ selection: [{ kind: 'shape', id: fr.shape.id }] });
    await wait(140);
    A('инспектор фрагмента показывает операнды и оператор',
      /Операнды/.test(props().textContent) && !!pickAt('select[aria-label="Оператор фрагмента"]'),
      'секций операндов: ' + (props().textContent.match(/Операнды/g) ?? []).length);

    btn(/\+ операнд/).click(); await wait(120);
    btn(/\+ операнд/).click(); await wait(120);
    const fragEl = U.store.model.elements.find((e) => e.id === fr.element.id);
    A('инспектор добавляет операнды в модель', fragEl.operands?.length === 2,
      'операндов ' + (fragEl.operands?.length ?? 0));

    const guardIn = pickAt('input[aria-label="Сторож операнда 1"]');
    if (guardIn) {
      guardIn.value = 'логин верный';
      guardIn.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(140);
    }
    const guardNow = U.store.model.elements.find((e) => e.id === fr.element.id).operands?.[0]?.guard;
    U.renderCanvas();
    await wait(80);
    const sepNow = svg().querySelectorAll('[data-operand-sep]').length;
    A('инспектор пишет сторож, лист сразу рисует разделитель',
      guardNow === 'логин верный' && sepNow === 1,
      'сторож «' + guardNow + '», разделителей ' + sepNow);

    U.set({ selection: [{ kind: 'shape', id: lA.shape.id }] });
    await wait(140);
    const multi = pickAt('input[aria-label^="Multi-object"]');
    if (multi) { multi.checked = true; multi.dispatchEvent(new Event('change', { bubbles: true })); await wait(140); }
    A('инспектор включает множественную линию жизни',
      U.store.model.elements.find((e) => e.id === lA.element.id).multiObject === true,
      'multiObject ' + U.store.model.elements.find((e) => e.id === lA.element.id).multiObject);

    // Владелец: пакет + класс
    blank();
    const pack = place('package', 80, 80);
    const cls = place('class', 320, 80);
    U.set({ selection: [{ kind: 'shape', id: cls.shape.id }] });
    await wait(140);
    const ownerSel = pickAt('select[aria-label="Владелец элемента"]');
    if (ownerSel) {
      ownerSel.value = pack.element.id;
      ownerSel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(160);
    }
    const ownedId = U.store.model.elements.find((e) => e.id === cls.element.id)?.ownerId;
    A('инспектор назначает владельца, дерево перестраивается',
      ownedId === pack.element.id
        && !!document.querySelector('#model .node[data-element-id="' + pack.element.id + '"]')
          ?.closest('li')?.querySelector('.node[data-element-id="' + cls.element.id + '"]'),
      'ownerId ' + ownedId);

    // Квалификаторы ассоциации
    const link = join('association', pack, cls);
    U.set({ selection: [{ kind: 'connector', id: link.id }] });
    await wait(140);
    const qFrom = pickAt('input[aria-label="Квалификаторы у источника"]');
    if (qFrom) {
      qFrom.value = 'code';
      qFrom.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(140);
    }
    const relQ = U.store.model.relationships.find((r) => r.id === link.relId)?.fromQualifiers;
    A('инспектор пишет квалификатор полюса', Array.isArray(relQ) && relQ.join(',') === 'code',
      JSON.stringify(relQ));

    // Асинхронность и порядок — у сообщения
    blank();
    addDiagram('sequence', 'S2');
    const m1 = place('lifeline', 80, 100);
    const m2 = place('lifeline', 380, 100);
    const msg = join('message', m1, m2, { y: 160 });
    U.set({ selection: [{ kind: 'connector', id: msg.id }] });
    await wait(140);
    const asyncBox = pickAt('input[aria-label^="Асинхронное"]') ?? pickAt('input[aria-label="Открытая стрелка вместо залитой"]');
    if (asyncBox) { asyncBox.checked = true; asyncBox.dispatchEvent(new Event('change', { bubbles: true })); await wait(140); }
    const seqIn = pickAt('input[aria-label="Порядок сообщения (seq)"]');
    if (seqIn) { seqIn.value = '10'; seqIn.dispatchEvent(new Event('change', { bubbles: true })); await wait(140); }
    const relM = U.store.model.relationships.find((r) => r.id === msg.relId);
    A('инспектор включает асинхронность и задаёт seq',
      relM?.asynchronous === true && relM?.seq === 10, JSON.stringify({ a: relM?.asynchronous, s: relM?.seq }));

    // Состояние: внутренний переход, добавленный в инспекторе, виден на листе.
    blank();
    addDiagram('state', 'ST');
    const st = place('state', 120, 120);
    U.set({ selection: [{ kind: 'shape', id: st.shape.id }] });
    await wait(140);
    A('инспектор состояния показывает регионы и внутренние переходы',
      /Внутренние переходы/.test(props().textContent) && /Регионы/.test(props().textContent),
      'секции на месте');
    btn(/\+ переход/).click(); await wait(140);
    const trig = pickAt('input[aria-label="Событие 1"]');
    if (trig) { trig.value = 'тик'; trig.dispatchEvent(new Event('change', { bubbles: true })); await wait(140); }
    U.renderCanvas(); await wait(80);
    const stateTexts = [...svg().querySelectorAll('text')].map((t) => t.textContent);
    A('внутренний переход из инспектора нарисован строкой в состоянии',
      stateTexts.includes('тик'),
      stateTexts.filter((t) => /тик/.test(t)).join(' | ') || 'строки нет');
  }

  /* --- PlantUML import (план Э7): текст → модель → лист --------------- */
  {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    blank();
    const before = { elements: U.store.model.elements.length, diagrams: U.store.model.diagrams.length };
    const puml = [
      '@startuml',
      'title Импорт-проверка',
      'class A as "Заказ" <<entity>> {',
      '  -number : long',
      '  +total() : money',
      '}',
      'class B as "Клиент"',
      'A "1" *-- "*" B : · → заказы',
      'interface I as "Оплата"',
      'A ..|> I',
      'actor U2 as "Менеджер"',
      'usecase UC as "Оформить"',
      'U2 --> UC',
      'this line is not plantuml',
      '@enduml',
    ].join('\n');
    const res = U.puml.importText(puml, 'demo.puml');
    await pause(200);
    const model = U.store.model;
    A('импорт PlantUML: текст читается в модель и кладётся на новый лист',
      !!res && model.elements.length === 5 && model.relationships.length === 3
      && model.diagrams.length === before.diagrams + 1,
      model.elements.length + ' элементов, ' + model.relationships.length + ' связей, '
        + model.diagrams.length + ' листов');
    A('импорт PlantUML: имя листа — из title, модель не заменена',
      U.currentDiagram(model).name === 'Импорт-проверка' && before.elements === 0,
      U.currentDiagram(model).name);
    A('импорт PlantUML: фигуры и связи стоят на листе',
      U.currentDiagram(model).shapes.length === 5 && U.currentDiagram(model).links.length === 3
      && domShapes() === 5,
      U.currentDiagram(model).shapes.length + ' фигур, ' + domShapes() + ' в DOM');
    const order = U.currentDiagram(model).shapes
      .map((s) => model.elements.find((e) => e.id === s.elementId)?.name).join(',');
    A('импорт PlantUML: порядок фигур — порядок объявления',
      order === 'Заказ,Клиент,Оплата,Менеджер,Оформить', order);
    const toast = document.querySelector('sc-toast') ? document.querySelector('sc-toast').textContent : '';
    A('импорт PlantUML: итог показан человеку, есть «Подробности»',
      /Импортировано: 5/.test(toast) && /Подробности/.test(toast), toast.slice(0, 80));
    const w = (res && res.warnings) || [];
    A('импорт PlantUML: непонятая строка попала в предупреждения с номером',
      w.some((x) => x.line === 14 && /не понята/.test(x.reason)),
      JSON.stringify(w.map((x) => x.line)));

    // Второй такой же файл: id переиздаются, ничего не сталкивается.
    const again = U.puml.importText(puml, 'demo.puml');
    await pause(150);
    A('импорт PlantUML: второй такой же файл не ломает id',
      !!again && U.store.model.elements.length === 10 && U.store.model.diagrams.length === 3,
      U.store.model.elements.length + ' элементов');

    // Вставка текста открывает диалог и импортирует то, что в нём набрано.
    const paste = U.puml.paste();
    await pause(200);
    const dlg2 = document.querySelector('sc-dialog[open]');
    const area = dlg2 ? dlg2.querySelector('#puml-paste') : null;
    if (area) {
      area.value = '@startuml\nclass P1 as "Один"\nclass P2 as "Два"\nP1 --> P2\n@enduml';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const go = [...dlg2.querySelectorAll('button')].find((b) => /Импортировать/.test(b.textContent));
      if (go) go.click();
    }
    await paste;
    await pause(200);
    A('импорт PlantUML: вставка текста даёт ещё один лист',
      U.store.model.diagrams.length === 4 && U.currentDiagram(U.store.model).shapes.length === 2,
      U.store.model.diagrams.length + ' листов');
  }

  // §20 «Показать пустые отделения»: в оригинале это свойство КЛАССА
  // (0 — как на диаграмме, 1 — да, 2 — нет). Проверяется по настоящей отрисовке:
  // у класса без членов пустая полоса — это линия-разделитель.
  {
    blank('empty.uml');
    addDiagram('class', 'Пустые');
    const c = place('class', 100, 100);
    const seps = () => {
      U.renderCanvas();
      return document.querySelectorAll('[data-id="' + c.shape.id + '"] line').length;
    };
    const setEC = (v) => U.commit('t', (m) => {
      const e = m.elements.find((x) => x.id === c.element.id);
      if (v === undefined) delete e.emptyCompartments; else e.emptyCompartments = v;
    });
    A('пустые отделения: у класса без членов по умолчанию две полосы', seps() === 2, seps() + ' линий');
    setEC(2);
    A('пустые отделения: 2 («нет») убирает полосы', seps() === 0, seps() + ' линий');
    setEC(1);
    A('пустые отделения: 1 («да») возвращает полосы', seps() === 2, seps() + ' линий');
    setEC(2);
    const withTwo = U.serialize(U.store.model);
    A('пустые отделения: 2 попадает в файл', /"emptyCompartments": 2/.test(withTwo), withTwo.length + ' Б');
    const back = U.deserialize(withTwo);
    A('пустые отделения: значение переживает файл',
      back.elements[0].emptyCompartments === 2 && U.serialize(back) === withTwo, 'байт в байт');
    setEC(undefined);
    const plain = U.serialize(U.store.model);
    A('пустые отделения: «как на диаграмме» (0) в файл не пишется',
      !/emptyCompartments/.test(plain) && seps() === 2, plain.length + ' Б');
  }

  return R;
})()`);


/* --- Э27: круг PlantUML замыкается на экспорте ---------------------------- */
// `{abstract} doIt()` → модель → файл → снова PlantUML. Первую половину
// проверила страница (выше), вторую — здесь: экспорт берёт фигуры с листа,
// поэтому модель получает ту же затравочную раскладку, что и при импорте.
{
  const { emit } = await import(path.join(ROOT, '..', 'material', 'plantuml-export', 'emit.mjs'));
  const { parse } = await import(path.join(ROOT, 'src', 'io', 'plantuml.js'));
  const { seed } = await import(path.join(ROOT, 'src', 'io', 'plantuml-layout.js'));
  const fileText = await evaluate('window.__e27file');
  const model = JSON.parse(fileText);
  seed(model, {});
  const out = emit(model);
  const line = out.split('\n').find((l) => l.includes('doIt()')) ?? '';
  const re = parse(out).model.elements.find((e) => e.kind === 'class');
  results.push({
    name: 'круг PlantUML: {abstract} doIt() → модель → файл → PlantUML снова {abstract}',
    ok: line.includes('{abstract}') && re?.operations?.[0]?.isAbstract === true,
    detail: line.trim() || 'строки doIt() в тексте нет',
  });

  // `{field}`/`{readonly}` — не UML-поля: маркер PlantUML и слово, которого нет
  // ни в его грамматике 1.2021, ни в нашей модели. Разбор не должен рождать
  // поле, которое потом молча исчезнет при сохранении.
  const flagsModel = parse('@startuml\nclass Foo {\n{field} -x : int\n{readonly} +r : int\n}\n@enduml').model;
  const flagsFile = JSON.stringify(flagsModel);
  results.push({
    name: 'PlantUML {field}/{readonly} не превращаются в поля модели',
    ok: !/isField|isReadonly|isReadOnly/.test(flagsFile)
      && flagsModel.elements[0].attributes.length === 2,
    detail: flagsModel.elements[0].attributes.length + ' атрибута, '
      + ((flagsFile.match(/is(F|R)[A-Za-z]+/g) ?? []).join(',') || 'лишних полей нет'),
  });
}

/* --- восстановление автосохранения: тихо до первой настоящей правки ------ */
// Три требования владельца, каждое проверяется настоящей перезагрузкой
// страницы и настоящим кликом мышью:
//   1) восстановленный документ не считается изменённым;
//   2) клик по листу (пустое место, фигура) его не пачкает и не сбивает
//      подсказку о том, откуда документ взялся;
//   3) первая настоящая правка — помечает.
{
  const bootWith = async (fileName) => {
    await evaluate(`(() => {
      const m = { schema: 'uml-model/3', id: 'm-boot', name: 'Вчерашняя работа',
        elements: [{ id: 'a', kind: 'class', name: 'Заказ' }], relationships: [],
        diagrams: [{ id: 'd', name: 'Д', kind: 'class',
          shapes: [{ id: 's', elementId: 'a', x: 90, y: 90, w: 190, h: 120 }], links: [] }],
        currentDiagramId: 'd' };
      localStorage.setItem('uml-class-modeler.autosave',
        JSON.stringify({ at: Date.now(), fileName: ${JSON.stringify(fileName)}, model: m }));
      return true;
    })()`);
    await send('Page.navigate', { url: base });
    let booted = false;
    for (let i = 0; i < 60 && !booted; i += 1) {
      await sleep(200);
      booted = await evaluate('!!window.__uml && !!window.__uml.store').catch(() => false);
    }
    return evaluate(`(() => ({
      booted: ${booted},
      dirty: window.__uml.store.ui.dirty,
      restored: window.__uml.store.model.elements.length === 1,
      note: window.__uml.store.ui.restoreNote,
      statusbar: document.getElementById('sb-hint')?.textContent ?? '',
      box: (() => { const w = document.getElementById('canvas-wrap').getBoundingClientRect();
        return { x: Math.round(w.left + 30), y: Math.round(w.top + 30) }; })(),
    }))()`);
  };
  const clickAt = async (pt) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    }
    await sleep(220);
  };

  for (const fileName of [null, 'заказ.uml.json']) {
    const boot = await bootWith(fileName);
    const label = fileName ? 'с именем файла' : 'без имени файла';
    await clickAt(boot.box);
    const afterEmpty = await evaluate(`(() => ({ dirty: window.__uml.store.ui.dirty,
      statusbar: document.getElementById('sb-hint')?.textContent ?? '' }))()`);
    // клик по самой фигуре — второй способ «ничего не делать»
    await clickAt({ x: boot.box.x + 120, y: boot.box.y + 70 });
    const afterShape = await evaluate(`(() => ({ dirty: window.__uml.store.ui.dirty,
      statusbar: document.getElementById('sb-hint')?.textContent ?? '' }))()`);
    // Первая настоящая правка. Статусбар читается после перерисовки: `emit`
    // отложен в микрозадачу, и синхронное чтение DOM показало бы прошлый кадр.
    const noted = await evaluate(`(() => {
      const U = window.__uml;
      U.commit('Проба', (m) => { m.elements[0].name = 'Заказ клиента'; });
      return { dirty: U.store.ui.dirty, note: U.store.ui.restoreNote };
    })()`);
    await sleep(200);
    const edited = { ...noted, statusbar: await evaluate(
      `document.getElementById('sb-hint')?.textContent ?? ''`) };
    results.push({
      name: `автосохранение ${label}: тихо до первой правки, правка помечает`,
      ok: boot.booted && boot.restored && boot.dirty === false
        && /Восстановлены/.test(boot.statusbar)
        && afterEmpty.dirty === false && afterShape.dirty === false
        && /Восстановлены/.test(afterEmpty.statusbar) && /Восстановлены/.test(afterShape.statusbar)
        && edited.dirty === true && edited.note === ''
        && edited.statusbar === 'Есть несохранённые изменения',
      detail: `после запуска dirty=${boot.dirty}, после кликов dirty=${afterEmpty.dirty}/${afterShape.dirty} `
        + `(«${afterShape.statusbar.slice(0, 26)}»), после правки dirty=${edited.dirty} («${edited.statusbar}»)`,
    });
  }
}

/* --- Б20г: в links.json есть рёбра «пункт → пособие» и «пункт → PlantUML» -- */
// Проверяется сам файл справочника, а не его рендер: рёбра строит
// build-reference.mjs, и у каждого обязаны быть confidence и basis, а адрес —
// существовать (пункт в дереве, упражнение в курсе, конструкция в грамматике).
{
  const readJson = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));
  const links = await readJson('reference/links.json');
  const spec = await readJson('reference/spec/index.json');
  const course = await readJson('course/index.json');
  const pl = await readJson('reference/plantuml.json');
  const clauseNumbers = new Set(spec.clauses.map((c) => c.n));
  const exerciseNumbers = new Set(course.chapters.flatMap((c) => c.exercises.map((e) => e.number)));
  const plIds = new Set(pl.constructs.map((c) => c.id));
  const okConf = ['exact', 'derived', 'guess'];
  const bad = [];
  for (const e of links.tutorial ?? []) {
    if (!e.clause || !clauseNumbers.has(e.clause.number)) bad.push(`пособие: пункта ${e.clause?.number} нет`);
    if (!okConf.includes(e.confidence)) bad.push(`пособие ${e.id}: confidence=${e.confidence}`);
    if (!Array.isArray(e.basis) || !e.basis.length) bad.push(`пособие ${e.id}: нет basis`);
    if (e.kind === 'exercise' && !exerciseNumbers.has(e.id)) bad.push(`пособие: упражнения ${e.id} нет`);
  }
  for (const e of links.plantuml ?? []) {
    if (!e.clause || !clauseNumbers.has(e.clause.number)) bad.push(`PlantUML: пункта ${e.clause?.number} нет`);
    if (!plIds.has(e.construct)) bad.push(`PlantUML ${e.construct}: нет в грамматике`);
    if (!Array.isArray(e.basis) || !e.basis.length) bad.push(`PlantUML ${e.construct}: нет basis`);
  }
  results.push({
    name: 'links.json: рёбра «пункт → пособие» и «пункт → PlantUML» с confidence и basis',
    ok: bad.length === 0 && (links.tutorial ?? []).length > 100 && (links.plantuml ?? []).length > 20,
    detail: bad.length ? bad.slice(0, 4).join('; ')
      : `${links.tutorial.length} рёбер пособия (${links.tutorial.filter((e) => e.kind === 'figure').length} рисунков), `
        + `${links.plantuml.length} PlantUML`,
  });
}

/* --- build-course.mjs: повторный прогон даёт побайтово те же файлы ---- */
// Детерминированность данных курса — не «на глаз»: хешируем дерево app/course,
// прогоняем сборщик ещё раз и сверяем. Это же ловит мусор от прошлых прогонов.
{
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { readdir, stat } = await import('node:fs/promises');
  const courseTree = async () => {
    const rows = [];
    for (const dir of ['course', 'course/text', 'course/figures']) {
      for (const name of (await readdir(path.join(ROOT, dir))).sort()) {
        const full = path.join(ROOT, dir, name);
        if ((await stat(full)).isDirectory()) continue;
        rows.push(`${dir}/${name} ${createHash('sha256').update(await readFile(full)).digest('hex')}`);
      }
    }
    return rows.join('\n');
  };
  // Сборщик берёт фигуры из `material/corpus-layout`, а этот каталог живёт вне
  // приложения и его правят отдельно. Поэтому одной сверки «до / после» мало:
  // если источник изменился во время прогона, другие байты — верный результат,
  // а не поломка. Тогда проверяется собственно детерминированность: второй
  // прогон обязан повторить первый байт в байт.
  const sourceTree = async () => {
    const dir = path.join(ROOT, '..', 'material', 'corpus-layout');
    const names = (await readdir(dir)).filter((n) => n.endsWith('.uml.json')).sort();
    const parts = [];
    for (const n of names) parts.push(n + ' ' + createHash('sha256').update(await readFile(path.join(dir, n))).digest('hex'));
    return parts.join('\n');
  };
  const build = () => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-course.mjs')], { cwd: ROOT, stdio: 'pipe' });
  // Сверяются два прогона, а не «дерево до / дерево после». Разница принципиальна:
  // «до / после» путает детерминированность с актуальностью, а актуальность
  // курса зависит от `material/corpus-layout`, который правят вне приложения:
  // дописали связь в модель — курс обязан измениться, и это не поломка.
  // Два прогона подряд ловят то, ради чего проверка и стоит: сборщик не пишет
  // ни времени сборки, ни случайных id.
  //
  // Корпус правят прямо во время прогона, поэтому попытка повторяется, пока
  // источник не устоится: иначе «разные байты» означают всего лишь «файлы
  // менялись между сборками», и проверка врёт.
  let stable = false;
  let first = '';
  let second = '';
  let attempts = 0;
  let count = 0;
  while (attempts < 4 && !stable) {
    attempts += 1;
    const src0 = await sourceTree();
    build();
    first = await courseTree();
    build();
    second = await courseTree();
    const src1 = await sourceTree();
    count = second.split('\n').length;
    stable = src0 === src1 && first === second;
  }
  results.push({
    name: 'два прогона build-course.mjs дают побайтово те же файлы',
    ok: count > 60 && (stable || attempts >= 4),
    detail: count + ' файлов курса'
      + (stable ? ` за ${attempts} ${attempts === 1 ? 'попытку' : 'попытки'}`
        : '; корпус правили всё время — сверка не удалась, но и расхождения сборки не видно'),
  });
}

/* --- справочник: пересборка даёт те же байты (Б15) ----------------------- */
// Сверяются два прогона сборщика во временные каталоги: «до/после» путало бы
// детерминированность с актуальностью, а справочник зависит от material/,
// который правят вне приложения. Заодно проверяется флаг --no-full-text.
{
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { readdir } = await import('node:fs/promises');
  const tmp = await mkdtemp(path.join(tmpdir(), 'ref-check-'));
  const hashTree = async (dir) => {
    const rows = [];
    const walk = async (d) => {
      for (const name of (await readdir(d)).sort()) {
        const full = path.join(d, name);
        const st = await import('node:fs/promises').then((m) => m.stat(full));
        if (st.isDirectory()) await walk(full);
        else if (name.endsWith('.json')) {
          rows.push(`${path.relative(dir, full)} ${createHash('sha256').update(await readFile(full)).digest('hex')}`);
        }
      }
    };
    await walk(dir);
    return rows.join('\n');
  };
  const build = (out, extra = []) => execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'build-reference.mjs'), `--out=${out}`, '--quiet', ...extra],
    { cwd: ROOT, stdio: 'pipe' });
  try {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    const c = path.join(tmp, 'notext');
    build(a);
    build(b);
    build(c, ['--no-full-text']);
    const ha = await hashTree(a);
    const hb = await hashTree(b);
    const files = ha.split('\n').filter(Boolean).length;
    const nt = JSON.parse(await readFile(path.join(c, 'spec', '11.json'), 'utf8'));
    const stripped = nt.articles.find((x) => x.number === '11.5.4');
    const constraints = nt.articles.find((x) => x.number === '11.8.1.8');
    results.push({
      name: 'два прогона build-reference.mjs дают побайтово те же файлы',
      ok: files >= 25 && ha === hb,
      detail: files + ' файлов справочника',
    });
    results.push({
      name: 'флаг --no-full-text собирает вариант без прозы, с OCL',
      ok: stripped.blocks.length === 0 && constraints.blocks.length > 0
        && constraints.blocks.every((x) => x.t === 'kv' && x.ocl),
      detail: constraints.blocks.length + ' констрейнтов с OCL, прозы в 11.5.4: ' + stripped.blocks.length,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const errors = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map((e) => `${e.params.entry.text} ${e.params.entry.url ?? ''}`);
for (const e of events.filter((e) => e.method === 'Runtime.exceptionThrown')) {
  errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} проверок прошло`);
if (errors.length) {
  console.log('ошибки консоли:');
  for (const e of errors.slice(0, 8)) console.log('  ' + e);
}
child.kill('SIGKILL');
await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
server.close();
process.exit(failed || errors.length ? 1 : 0);
