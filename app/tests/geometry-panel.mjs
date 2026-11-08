// Четвёртый слой проверок — «Геометрия листа» — в настоящем интерфейсе.
//
// Набор доказывает в headless-Chromium, что панель «Проверки» показывает
// замечания к раскладке листа так, как обещает контракт:
//
//   1. раздел #checks-geometry есть, заголовок называет слой;
//   2. число строк равно числу замечаний basis='geometry' из checkResult();
//   3. у каждой строки чип «раскладка» и метка уровня «вид»;
//   4. счётчик статусбара и бейдж вкладки считают те же N (формула из
//      checkResult, без хардкода);
//   5. клик по строке выделяет на листе фигуру-цель и пишет замечание в
//      подсказку;
//   6. клик по чипу открывает диалог «Геометрия листа» с правилом
//      geometry-shapes-overlap и оговоркой «это не нарушение стандарта UML»;
//   7. фильтр «только ошибки» прячет строки, но оставляет раздел с
//      объяснением; снятие фильтра возвращает строки;
//   8. на модели без геометрии раздела нет вовсе;
//   9. консольных ошибок и исключений нет.
//
// Снимок панели кладётся в shots/geometry-panel.png (общая папка снимков проекта).
//
//   cd app && node tests/geometry-panel.mjs
//
// Зависимостей нет: сервер на node:http, браузер — по CDP через встроенный
// WebSocket. Стенд скопирован из tests/layout.mjs — так принято в проекте:
// каждый набор самодостаточен. Порт отладки не фиксирован (0 → файл
// DevToolsActivePort в своём профиле), поэтому набор не конфликтует с другими.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = path.resolve(ROOT, '..', 'shots', 'geometry-panel.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });

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

/* ------------------------------------------------------------ сценарий A */

// Модель «Классы»: три класса образуют две перекрывающиеся пары
// (Заказ↔Клиент, Клиент↔Счёт), четвёртый — «Отчёт» — стоит далеко, чтобы
// лист не считался нечитаемым. Имена короткие: проверка «имя шире рамки» не
// должна добавлять шум, интересны именно пересечения рамок.
const RUN_MAIN = String.raw`(async () => {
  const R = [];
  const A = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail: String(detail) });
  const U = window.__uml;
  if (!U) return [{ name: 'приложение загрузилось', ok: false, detail: 'window.__uml нет' }];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); }
    return null;
  };

  const model = {
    schema: 'uml-model/3',
    id: 'm-geometry-panel',
    name: 'Проверка геометрии листа',
    elements: [
      { id: 'c1', kind: 'class', name: 'Заказ' },
      { id: 'c2', kind: 'class', name: 'Клиент' },
      { id: 'c3', kind: 'class', name: 'Счёт' },
      { id: 'c4', kind: 'class', name: 'Отчёт' },
    ],
    relationships: [],
    diagrams: [{
      id: 'd1',
      name: 'Классы',
      kind: 'class',
      shapes: [
        { id: 's1', elementId: 'c1', x: 40, y: 40, w: 190, h: 170 },
        { id: 's2', elementId: 'c2', x: 120, y: 110, w: 190, h: 170 },
        { id: 's3', elementId: 'c3', x: 240, y: 200, w: 190, h: 170 },
        { id: 's4', elementId: 'c4', x: 900, y: 40, w: 190, h: 170 },
      ],
      links: [],
    }],
    currentDiagramId: 'd1',
  };

  try {
    U.loadModel(U.deserialize(JSON.stringify(model)), 'geometry-panel-test.uml.json');
    U.openChecksPanel();

    const sec = await until(() => document.getElementById('checks-geometry'), 6000);
    await sleep(200);

    /* --- 1. раздел и заголовок --- */
    A('раздел #checks-geometry существует', !!sec);
    const head = document.getElementById('checks-geometry-head');
    A('заголовок раздела — «Геометрия листа»',
      !!head && head.textContent.includes('Геометрия листа'),
      head ? head.textContent.trim() : 'нет заголовка');

    /* --- 2. число строк = числу замечаний слоя --- */
    const all = U.checkResult({ force: true }).findings;
    const geom = all.filter((f) => f.basis === 'geometry' && f.status !== 'failed');
    const overlaps = geom.filter((f) => f.ruleId === 'geometry-shapes-overlap');
    const rowSel = '#checks-geometry li.finding[data-basis="geometry"]';
    const rowsOf = () => [...document.querySelectorAll(rowSel)];
    let rows = rowsOf();
    A('замечаний geometry-shapes-overlap не меньше двух', overlaps.length >= 2,
      overlaps.length + ' шт: ' + overlaps.map((f) => f.ruleId + ' ' + (f.targets || []).join('+')).join('; '));
    A('строк в разделе столько же, сколько замечаний geometry',
      rows.length === geom.length,
      'строк ' + rows.length + ', замечаний ' + geom.length);

    /* --- 3. чип и метка уровня --- */
    const badChip = rows.find((r) => {
      const chip = r.querySelector('.chip-geometry');
      return !chip || chip.textContent.trim() !== 'раскладка';
    });
    A('у каждой строки чип .chip-geometry с текстом «раскладка»', !badChip,
      badChip ? badChip.textContent.slice(0, 80) : 'все ' + rows.length);
    const badLvl = rows.find((r) => (r.querySelector('.lvl')?.textContent || '').trim() !== 'вид');
    A('метка уровня у каждой строки — «вид»', !badLvl,
      badLvl ? badLvl.querySelector('.lvl')?.textContent : 'все ' + rows.length);

    /* --- 4. статусбар и бейдж: те же N, посчитанные из checkResult --- */
    let errors = 0; let warnings = 0; let project = 0; let layout = 0; let failed = 0;
    for (const f of all) {
      if (f.status === 'failed') { failed += 1; continue; }
      if (f.basis === 'practice') continue;
      if (f.basis === 'project') { project += 1; continue; }
      if (f.basis === 'geometry') { layout += 1; continue; }
      if (f.level === 'error') errors += 1;
      else if (f.level === 'warning') warnings += 1;
    }
    A('раскладка в счётчике: layout > 0', layout > 0, 'layout=' + layout);
    const sb = document.getElementById('sb-checks');
    A('#sb-checks содержит «раскладка N» с тем же N',
      !!sb && sb.textContent.includes('раскладка ' + layout),
      sb ? sb.textContent.trim() : 'нет статусбара');
    A('подсказка #sb-checks называет число замечаний слоя',
      !!sb && (sb.title || '').includes('Проверки геометрии листа: ' + layout),
      sb ? sb.title.slice(0, 140) : 'нет');
    const badge = document.getElementById('checks-badge');
    const expectedBadge = errors + warnings + project + layout + failed;
    A('бейдж вкладки равен errors+warnings+project+layout+failed',
      !!badge && badge.textContent.trim() === String(expectedBadge),
      'бейдж «' + (badge ? badge.textContent.trim() : '') + '», ждали ' + expectedBadge
        + ' (errors ' + errors + ', warnings ' + warnings + ', project ' + project
        + ', layout ' + layout + ', failed ' + failed + ')');

    /* --- 5. клик по строке ведёт к фигуре-цели --- */
    const first = geom[0];
    const firstTargets = (first.targets || []).map(String);
    rows = rowsOf();
    const row = rows[0];
    A('первая строка геометрии на месте', !!row,
      row ? row.getAttribute('data-rule') : 'нет строк');
    let clickOk = false;
    let selText = '';
    if (row) {
      row.click();
      await sleep(250);
      const sel = U.store.ui.selection || [];
      const shapeIds = sel.filter((s) => s.kind === 'shape').map((s) => s.id);
      const diag = U.currentDiagram(U.store.model);
      const hit = (diag.shapes || []).find((s) => shapeIds.includes(s.id));
      clickOk = !!hit && firstTargets.includes(String(hit.elementId));
      selText = JSON.stringify(sel) + '; цели ' + firstTargets.join(',')
        + '; фигура ' + (hit ? hit.id + '→' + hit.elementId : 'нет');
    }
    A('клик по строке выделяет на листе фигуру из targets', clickOk, selText);
    const hintStore = U.store.ui.hint || '';
    const hintBar = document.getElementById('sb-hint')?.textContent || '';
    A('текст замечания попал в подсказку',
      hintStore.includes(first.message) && hintBar.includes(first.message),
      'store «' + hintStore.slice(0, 90) + '»; статусбар «' + hintBar.slice(0, 90) + '»');

    /* --- 6. чип открывает диалог с оговоркой --- */
    rows = rowsOf();
    const chip = rows[0]?.querySelector('.chip-geometry');
    chip?.click();
    const dlg = await until(() => document.querySelector('sc-dialog[open]'), 5000);
    const dtext = (dlg?.textContent || '').replace(/\s+/g, ' ');
    A('клик по чипу открывает диалог «Геометрия листа»',
      !!dlg && dlg.getAttribute('heading') === 'Геометрия листа',
      dlg ? 'heading=' + dlg.getAttribute('heading') : 'диалога нет');
    A('в диалоге названо правило geometry-shapes-overlap',
      dtext.includes('geometry-shapes-overlap'), dtext.slice(0, 160));
    A('в диалоге есть оговорка «не нарушение стандарта UML»',
      /не нарушение стандарта UML/.test(dtext), dtext.slice(0, 200));
    dlg?.querySelector('.sc-button--primary')?.click();
    await until(() => !document.querySelector('sc-dialog[open]'), 4000);
    await sleep(150);

    /* --- 7. фильтр «только ошибки» --- */
    document.getElementById('checks-only-errors')?.click();
    await sleep(250);
    const filteredRows = rowsOf().length;
    const secFiltered = document.getElementById('checks-geometry');
    const none = secFiltered?.querySelector('.checks-none');
    A('фильтр «только ошибки» скрывает geometry-строки', filteredRows === 0,
      'строк ' + filteredRows);
    A('раздел остаётся с пустой строкой-объяснением',
      !!secFiltered && !!none && /только ошибки/.test(none.textContent),
      none ? none.textContent.trim().slice(0, 120) : 'нет .checks-none');
    document.getElementById('checks-only-errors')?.click();
    await sleep(250);
    A('снятие фильтра возвращает строки', rowsOf().length === geom.length,
      'строк ' + rowsOf().length + ', ждали ' + geom.length);

    /* --- готовим кадр: раздел на виду --- */
    const shot = (() => {
      const s = document.getElementById('checks-geometry');
      if (s) s.scrollIntoView({ block: 'start' });
      const r = document.getElementById('right')?.getBoundingClientRect();
      const b = s?.getBoundingClientRect();
      return {
        right: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        section: b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
        scrollY: window.scrollY,
      };
    })();
    A('панель «Проверки» видна и раздел в кадре',
      !!shot.right && shot.right.width > 100 && !!shot.section && shot.section.height > 20,
      JSON.stringify(shot));

    return R;
  } catch (err) {
    R.push({ name: 'сценарий прерван', ok: false, detail: String(err && err.stack || err).slice(0, 500) });
    return R;
  }
})()`;

/* --------------------------------------- сценарий B: модель без геометрии */

const RUN_CLEAN = String.raw`(async () => {
  const R = [];
  const A = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail: String(detail) });
  const U = window.__uml;
  if (!U) return [{ name: 'приложение загрузилось', ok: false, detail: 'window.__uml нет' }];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); }
    return null;
  };
  const model = {
    schema: 'uml-model/3',
    id: 'm-geometry-clean',
    name: 'Без геометрии',
    elements: [
      { id: 'e1', kind: 'class', name: 'А' },
      { id: 'e2', kind: 'class', name: 'Б' },
    ],
    relationships: [],
    diagrams: [{
      id: 'd2', name: 'Классы', kind: 'class',
      shapes: [
        { id: 'v1', elementId: 'e1', x: 40, y: 40, w: 190, h: 170 },
        { id: 'v2', elementId: 'e2', x: 500, y: 40, w: 190, h: 170 },
      ],
      links: [],
    }],
    currentDiagramId: 'd2',
  };
  try {
    U.loadModel(U.deserialize(JSON.stringify(model)), 'geometry-panel-clean.uml.json');
    U.openChecksPanel();
    await until(() => !document.getElementById('checks-geometry')
      && document.querySelector('#checks .checks-head'), 6000);
    await sleep(250);
    const all = U.checkResult({ force: true }).findings;
    const geom = all.filter((f) => f.basis === 'geometry' && f.status !== 'failed');
    A('на чистой модели замечаний geometry нет', geom.length === 0,
      'замечаний ' + geom.length + ': ' + geom.map((f) => f.ruleId).join(','));
    A('раздела #checks-geometry нет вовсе', document.getElementById('checks-geometry') === null,
      document.getElementById('checks-geometry') ? 'раздел есть' : 'раздела нет');
    A('панель «Проверки» при этом открыта и отрисована',
      !!document.querySelector('#checks .checks-head') && !!document.querySelector('#right .tab[data-tab="checks"].active'),
      'панель ' + (document.querySelector('#checks .checks-head') ? 'есть' : 'нет'));
    return R;
  } catch (err) {
    R.push({ name: 'сценарий прерван', ok: false, detail: String(err && err.stack || err).slice(0, 500) });
    return R;
  }
})()`;

/* ------------------------------------------------------------------ стенд */

async function browserChecks() {
  const bin = findChrome();
  if (!bin) {
    check('браузер: панель «Геометрия листа»', true, 'skipped: headless Chrome не найден');
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

  const profile = await mkdtemp(path.join(tmpdir(), 'uml-geometry-panel-'));
  // Порт 0: Chromium сам выбирает свободный и пишет его в DevToolsActivePort
  // профиля. Фиксированный диапазон мог бы совпасть с параллельным набором.
  const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=0', '--window-size=1440,900', `--user-data-dir=${profile}`,
    'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });

  let serverClosed = false;
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i += 1) {
      await sleep(100);
      try {
        const t = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
        const line = t.split('\n')[0]?.trim();
        if (line) port = Number(line);
      } catch { /* профиль ещё не готов */ }
    }
    if (!port) {
      check('браузер запустился', false, 'нет файла DevToolsActivePort');
      return;
    }

    let ws = null;
    for (let i = 0; i < 60 && !ws; i += 1) {
      await sleep(150);
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
      check('браузер запустился', false, 'нет devtools-цели');
      return;
    }

    const errors = [];
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        errors.push('console: ' + text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push('exception: ' + (d.exception?.description?.slice(0, 220) ?? d.text));
      }
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
      if (r.error) throw new Error(r.error.message);
      if (r.result?.exceptionDetails) {
        throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      }
      return r.result?.result?.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    // Навигация после подписки на события — тогда консольные ошибки старта
    // приложения тоже попадают в отчёт, а не теряются до подключения.
    await send('Page.navigate', { url: base });
    let ready = false;
    for (let i = 0; i < 120 && !ready; i += 1) {
      await sleep(100);
      try { ready = await evaluate('typeof window.__uml === "object" && document.readyState === "complete"'); } catch { /* грузится */ }
    }
    check('приложение загрузилось в headless-Chromium', ready, ready ? base : 'window.__uml нет');
    if (!ready) return;
    await sleep(500);

    /* --- сценарий A + снимок --- */
    const outA = await evaluate(RUN_MAIN);
    for (const r of outA ?? []) check(`браузер: ${r.name}`, r.ok, r.detail);

    const shot = await evaluate(`(() => {
      const s = document.getElementById('checks-geometry');
      if (s) s.scrollIntoView({ block: 'start' });
      const r = document.getElementById('right')?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    })()`);
    await sleep(300);
    if (!shot) {
      check('снимок панели сделан', false, 'нет #right');
    } else {
      const cap = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: shot.x, y: shot.y, width: shot.width, height: shot.height, scale: 2 },
        captureBeyondViewport: false,
      });
      const png = Buffer.from(cap.result?.data ?? '', 'base64');
      await mkdir(path.dirname(SHOT), { recursive: true });
      await writeFile(SHOT, png);
      check('снимок панели сделан', png.length > 2000, `${SHOT} (${png.length} байт, ${Math.round(shot.width)}×${Math.round(shot.height)} pt)`);
    }

    /* --- сценарий B: модель без геометрии --- */
    const outB = await evaluate(RUN_CLEAN);
    for (const r of outB ?? []) check(`браузер: ${r.name}`, r.ok, r.detail);

    await sleep(200);
    check('консольных ошибок и исключений нет', errors.length === 0,
      errors.length ? errors.slice(0, 3).join(' | ') : 'чисто');

    ws.close();
  } finally {
    child.kill('SIGKILL');
    try { await rm(profile, { recursive: true, force: true }); } catch { /* уже нет */ }
    if (!serverClosed) { server.close(); serverClosed = true; }
  }
}

await browserChecks();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\nПроверок пройдено: ${results.length - failed} из ${results.length}`);
process.exit(failed ? 1 : 0);