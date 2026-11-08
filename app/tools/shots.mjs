// Снимки интерфейса для README: настоящие кадры приложения, не макеты.
//
// ЗАЧЕМ. README открытого проекта показывает интерфейс, а картинка в README
// стареет быстрее кода: поменяли подпись кнопки — и на витрине уже неправда.
// Поэтому снимки не «сделаны руками один раз», а снимаются заново одной
// командой. Правка интерфейса → прогнали инструмент → в README свежие кадры.
//
//   cd app && node tools/shots.mjs                 # все пять сценариев
//   cd app && node tools/shots.mjs --only=validation   # только один
//
// Куда кладутся файлы: ../assets/screenshots/ (рядом с логотипом и баннерами,
// это общая папка витрины, а не внутренняя папка тестов).
//
// ПОЧЕМУ СВОЙ СТЕНД, А НЕ PUPPETEER. В проекте нет ни одной npm-зависимости,
// и завести её ради пяти PNG значило бы сломать правило «клон → node app.js».
// Node сам умеет всё нужное: статический сервер — node:http, браузер —
// headless-Chromium по протоколу CDP, WebSocket и fetch — встроенные с Node 22.
// Стенд ниже повторяет tests/geometry-panel.mjs (сервер, MIME, поиск браузера,
// порт 0, settle()); он вынесен в функции, потому что здесь сценариев пять,
// а не один, и копировать запуск браузера пять раз незачем.
//
// ПОЧЕМУ 1440×900 И deviceScaleFactor 2. 1440×900 — эталонный кадр проекта:
// при нём пример укладывается на 75 % (app/Build/uml-modeler, комментарий у
// screenshot()), а 75 % — масштаб контрольных снимков. Второй множитель — для
// README: на экране с Retina кадр 1× выглядит мылом, а 2× даёт 2880×1800.
//
// ПОЧЕМУ ТЕМ ДВЕ И ОБЕ ЗАФИКСИРОВАНЫ. Вид «Авто» следует системной настройке
// машины: на одном ноутбуке кадр светлый, на другом тёмный, и PNG в README
// перестаёт быть воспроизводимым. Поэтому тема — параметр прогона, а не
// случайность: эмуляция prefers-color-scheme выставляется ДО навигации, и один
// запуск снимает оба набора — светлый (`main-canvas.png`) и тёмный
// (`main-canvas-dark.png`). В README они стоят в <picture> и переключаются
// вместе с темой GitHub, как баннер.
//
//   node tools/shots.mjs                оба набора
//   node tools/shots.mjs --theme=dark   только тёмный
//   node tools/shots.mjs --only=validation --theme=light
//
// ПОЧЕМУ КЛИКИ ЧЕРЕЗ DOM, А НЕ window.__uml. Снимок доказывает, что путь
// человека работает: пункт меню, строка дерева. Вызвать loadDemoErrors()
// напрямую было бы короче, но тогда снимок показывал бы не интерфейс, а
// удачный вызов функции — сломанное меню осталось бы незамеченным. window.__uml
// используется только на чтение (числа для отчёта), не для действий.
//
// ЧТО СЧИТАЕТСЯ УСПЕХОМ СЦЕНАРИЯ. 1) приложение загрузилось и отрисовало
// ожидаемое (селектор дождались, а не «проспали»); 2) PNG больше 50 КБ и
// ровно 2880×1800; 3) в консоли нет исключений и console.error. Пустой белый
// кадр 1440×900 весит около 12 КБ, поэтому порог по размеру ловит именно
// «приложение не нарисовалось», а не «картинка некрасивая».
//
// КОДЫ ВОЗВРАТА. 0 — все сценарии сняты; 1 — хотя бы один не дал снимок
// (причина печатается: какой селектор не дождались и что было в панели);
// 2 — ошибка вызова (неизвестное имя в --only, нет браузера).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');            // корень приложения (index.html)
const OUT = path.resolve(APP, '..', 'assets', 'screenshots');

const VIEW = { width: 1440, height: 900, scale: 2 }; // эталонный кадр проекта

/** Два набора кадров: светлый и тёмный. Оба зафиксированы, см. шапку. */
const THEMES = ['light', 'dark'];
/** Имя файла кадра: тёмный набор лежит рядом со светлым, с суффиксом -dark. */
const fileFor = (sc, theme) => (theme === 'dark' ? sc.file.replace(/\.png$/i, '-dark.png') : sc.file);
const MIN_BYTES = 50 * 1024;                         // «не пустая картинка»
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ сервер */

// MIME тот же, что в tests/geometry-panel.mjs: без charset у .js Chromium
// ругается на «не UTF-8» в консоли, и проверка «консоль чиста» стала бы
// проверкой кодировки сервера, а не приложения.
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
  '.md': 'text/markdown; charset=utf-8',
};

async function serveApp() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.join(APP, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        // Снимок обязан показывать текущий код, а не кеш прошлого прогона:
        // иначе после правки интерфейса в README уехал бы старый кадр.
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

/* ----------------------------------------------------------------- браузер */

// Список кандидатов — из tests/geometry-panel.mjs плюс системные имена: на
// другой машине Playwright может быть не установлен, а chromium — быть.
function findChrome() {
  const home = process.env.HOME ?? '';
  const tried = [
    process.env.CHROME_PATH,
    `${home}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
    `${home}/.hermes/tools/chromium-1208/chrome-linux64/chrome`,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  return { bin: tried.find((p) => existsSync(p)) ?? null, tried };
}

/* ---------------------------------------------------------------- CDP-сессия */

/** Ошибка сценария: печатается человеку, а не в стек. */
class ShotError extends Error {}

/**
 * Обёртка над одним page-таргетом. Всё общение — через Runtime.evaluate:
 * сценарии пользуются настоящим DOM, поэтому у инструмента нет отдельного
 * языка шагов, а причина отказа — это текст исключения из страницы.
 */
function openSession(ws) {
  let id = 0;
  const pending = new Map();
  // Ошибки копятся между переходами: сценарий начинается с resetErrors(),
  // иначе ошибка одного сценария валила бы все следующие.
  let errors = [];

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      errors.push('console: ' + text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('exception: ' + (d.exception?.description?.slice(0, 240) ?? d.text));
    }
    // Log.entryAdded ловит не исключения, а провалившиеся запросы: без него
    // исчезнувший material/demo-errors.json выглядел бы как «пустая панель».
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const en = msg.params.entry;
      errors.push('log: ' + `${en.text} ${en.url ?? ''}`.trim());
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.error) throw new ShotError(r.error.message);
    const ex = r.result?.exceptionDetails;
    if (ex) throw new ShotError(ex.exception?.description ?? ex.text);
    return r.result?.result?.value;
  };

  return {
    send,
    evaluate,
    errors: () => errors,
    resetErrors: () => { errors = []; },

    /** Переход и ожидание готовности документа; ошибки старта тоже попадут в отчёт. */
    async navigate(url) {
      await send('Page.navigate', { url });
      await this.waitFor(
        'document.readyState === "complete"',
        15000,
        'document.readyState === complete после перехода на ' + url,
      );
    },

    /**
     * Опрос выражения вместо фиксированной паузы: «проспали 500 мс» на
     * медленной машине даёт пустой кадр, а на быстрой — лишнюю секунду.
     * probeExpr нужен, чтобы при отказе напечатать состояние панели.
     */
    async waitFor(expr, ms, what, probeExpr) {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < ms) {
        let v;
        try { v = await this.evaluate(expr); } catch (e) { last = e.message; v = false; }
        if (v) return v;
        await sleep(80);
      }
      let probe = '';
      if (probeExpr) {
        try {
          const p = await this.evaluate(probeExpr);
          probe = String(p ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        } catch { /* панели уже нет — причина и так известна */ }
      }
      throw new ShotError('не дождались: ' + what
        + ' (за ' + ms + ' мс)'
        + (probe ? '; в панели: «' + probe + '»' : '')
        + (last ? '; последняя ошибка страницы: ' + last : ''));
    },

    /**
     * settle(): два кадра + короткая пауза. Первый кадр — применение DOM,
     * второй — отрисовка; пауза — переходы (меню, подсветка выделения,
     * появление тоста), которые иначе попадут в кадр полупрозрачными.
     */
    async settle(ms = 220) {
      await this.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ${ms}))))`);
    },
  };
}

/** Запуск браузера и подключение к единственной вкладке. */
async function launch(bin, base) {
  const profile = await mkdtemp(path.join(tmpdir(), 'uml-shots-'));
  // Порт 0: Chromium сам выбирает свободный и пишет его в DevToolsActivePort.
  // Фиксированный порт мог бы совпасть с другим набором проекта — они ходят
  // параллельно, и это уже случалось.
  const child = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--window-size=${VIEW.width},${VIEW.height}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let port = null;
  for (let i = 0; i < 120 && !port; i += 1) {
    await sleep(100);
    try {
      const t = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      const line = t.split('\n')[0]?.trim();
      if (line) port = Number(line);
    } catch { /* профиль ещё не готов */ }
  }
  if (!port) {
    child.kill('SIGKILL');
    try { await rm(profile, { recursive: true, force: true }); } catch { /* уже нет */ }
    throw new ShotError('браузер не поднял порт отладки (нет DevToolsActivePort в ' + profile + ')');
  }

  let ws = null;
  for (let i = 0; i < 80 && !ws; i += 1) {
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
    child.kill('SIGKILL');
    try { await rm(profile, { recursive: true, force: true }); } catch { /* уже нет */ }
    throw new ShotError('нет devtools-цели: браузер поднялся, но вкладки не отдал');
  }

  const s = openSession(ws);
  await s.send('Runtime.enable');
  await s.send('Log.enable');
  await s.send('Page.enable');
  // Вид фиксируем ДО навигации: вёрстка приложения зависит от ширины окна
  // (панели, перенос строк), и кадр, снятый при другом viewport, — это уже
  // другая картинка, а не тот же интерфейс.
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale,
    mobile: false, screenWidth: VIEW.width, screenHeight: VIEW.height,
  });
  // Стартовое значение; конкретную тему ставит setTheme() перед каждым
  // сценарием — так один прогон снимает и светлый набор, и тёмный.
  await s.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  return { child, profile, ws, session: s, base };
}

/** Переключить тему ДО следующей навигации: сценарий сам грузит страницу,
 *  поэтому кадр снимается уже в нужной теме, без вспышки чужой. */
async function setTheme(session, theme) {
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme }],
  });
}

/* --------------------------------------------------------------- снимок PNG */

/** Размер картинки из IHDR: нужен, чтобы поймать «сняли в 1×» без зависимостей. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function capture(session, file) {
  const r = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    // Кадр — ровно окно: captureBeyondViewport снял бы «всю страницу»,
    // а README нужен экран приложения, а не его прокрутка.
    captureBeyondViewport: false,
  });
  if (!r.result?.data) throw new ShotError('CDP не вернул PNG: ' + JSON.stringify(r.error ?? null));
  const png = Buffer.from(r.result.data, 'base64');
  const size = pngSize(png);
  if (!size) throw new ShotError('CDP вернул не PNG (нет сигнатуры IHDR)');
  if (png.length < MIN_BYTES) {
    throw new ShotError('снимок пустой: ' + png.length + ' байт < ' + MIN_BYTES
      + ' — приложение не нарисовало интерфейс');
  }
  const want = { width: VIEW.width * VIEW.scale, height: VIEW.height * VIEW.scale };
  if (size.width !== want.width || size.height !== want.height) {
    throw new ShotError('снимок ' + size.width + '×' + size.height + ', а ждали '
      + want.width + '×' + want.height + ' (deviceScaleFactor ' + VIEW.scale + ' не применился)');
  }
  await mkdir(OUT, { recursive: true });
  const dest = path.join(OUT, file);
  await writeFile(dest, png);
  return { dest, bytes: png.length, ...size };
}

/* ------------------------------------------------------ куски кода страницы */

// Общий прелюд для сценариев: те же имена, что в браузерных наборах проекта.
const PRELUDE = String.raw`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel, root = document) => root.querySelector(sel);
`;

// Числа для отчёта берём из модели на чтение: печатать «5 фигур» по счётчику
// DOM значило бы проверять вёрстку, а нам нужен факт «на листе то, что ждали».
const SHEET_INFO = `(() => {
  const U = window.__uml;
  const m = U.store.model;
  const d = U.currentDiagram(m);
  const kindOf = (id) => (m.elements.find((e) => e.id === id) || {}).kind || '';
  const kinds = d ? d.shapes.map((s) => kindOf(s.elementId)) : [];
  return {
    name: d ? d.name : null,
    kind: d ? d.kind : null,
    shapes: kinds.length,
    links: d ? (d.links || []).length : 0,
    figures: [...new Set(kinds)],
    swimlanes: kinds.filter((k) => k === 'swimlane').length,
    rendered: document.querySelectorAll('#sheetlayer [data-kind="shape"]').length,
    // Приглашение лежит ПОВЕРХ листа и гаснет по числу диаграмм: если модель не
    // доехала, кадр покажет «Начало работы» вместо диаграммы, и это надо ловить
    // явно, а не считать «на листе что-то есть».
    welcome: !!document.getElementById('welcome') && !document.getElementById('welcome').hidden,
  };
})()`;

/**
 * Клик по строке диаграммы и по строке элемента в дереве модели.
 *
 * Строки несут data-diagram-id и data-element-id (app/src/ui/panels.js:749,847)
 * именно для того, чтобы к ним можно было прийти не по имени, а по id:
 * имена в примерах меняются, id — нет. Связи не трогаем: инспектор связи
 * открывается тем же кликом по data-rel-id, но для кадра «поля справа»
 * достаточно элемента.
 */
const OPEN_INSPECTOR = String.raw`(async () => {
  ${PRELUDE}
  const tree = document.getElementById('model');
  if (!tree) throw new Error('нет #model: дерево модели не отрисовано');
  const sheets = [...tree.querySelectorAll('.node.diagram[data-diagram-id]')];
  if (!sheets.length) throw new Error('в дереве нет строк диаграмм (.node.diagram[data-diagram-id]) — модель не загрузилась');
  // Текущий лист помечен aria-selected="true": это тот лист, который открыт
  // по ?diagram=..., и клик по нему не зависит от порядка сортировки дерева.
  const sheet = sheets.find((n) => n.getAttribute('aria-selected') === 'true') || sheets[0];
  const diagramId = sheet.dataset.diagramId;
  const diagramName = (sheet.querySelector('.nm')?.textContent || '').trim();
  sheet.click();
  await sleep(260);
  const again = tree.querySelector('.node.diagram[data-diagram-id="' + diagramId + '"]');
  if (!again) throw new Error('после клика строка диаграммы ' + diagramId + ' пропала из дерева');
  // Элементы листа лежат в ul.tr-kids того же li (panels.js#sheetRow):
  // искать их по всему дереву значило бы попасть в соседний лист.
  const li = again.closest('li');
  const rows = [...(li ? li.querySelectorAll('.node[data-element-id]') : [])];
  if (!rows.length) throw new Error('под строкой диаграммы нет строк элементов (.node[data-element-id]) — лист не раскрыт');
  const skipped = [];
  for (const row of rows.slice(0, 6)) {
    row.click();
    await sleep(240);
    const props = document.getElementById('props');
    const fields = props ? props.querySelectorAll('.field').length : 0;
    if (!fields) {
      skipped.push((row.querySelector('.nm')?.textContent || row.dataset.elementId) + ': полей в #props нет');
      continue;
    }
    const head = props.querySelector('h3.sect');
    const nameIn = props.querySelector('.field input[type=text]');
    const pane = document.querySelector('#right .panel-body');
    if (pane) pane.scrollTop = 0; // кадр с заголовка инспектора, а не с середины
    // У h3.sect второй ребёнок — подпись «элемент модели» (panels.js#section):
    // в отчёт берём только вид («Класс»), иначе получается «Классэлемент модели».
    const section = head ? (head.firstChild?.textContent || head.textContent) : '';
    return {
      // Имя листа в дереве — «Диаграмма «Классы заказа»»: обёртка нужна
      // человеку в списке, но в отчёте она даёт двойные кавычки.
      diagramName: (diagramName.match(/«(.+)»/)?.[1] ?? diagramName),
      diagramId,
      elementId: row.dataset.elementId,
      elementName: nameIn ? nameIn.value : (row.querySelector('.nm')?.textContent || ''),
      section: section.trim(),
      fields,
      rows: rows.length,
    };
  }
  throw new Error('#props остался без полей после кликов по строкам элементов: ' + skipped.join('; '));
})()`;

/**
 * Открытие примера с ошибками через меню.
 *
 * Пункт живёт в меню «Примеры» (src/ui/toolbar.js:468), а не в «Файле»:
 * пример — не работа с файлом. Ищем по тексту, а не по индексу кнопки:
 * меню переставляли, и жёсткий «третья кнопка, шестой пункт» ломался бы
 * при каждой правке шапки. Заодно это доказывает, что путь человека цел.
 */
const OPEN_DEMO_ERRORS = String.raw`(async () => {
  ${PRELUDE}
  const buttons = [...document.querySelectorAll('#toolbar .menu > button')];
  if (!buttons.length) throw new Error('в #toolbar нет кнопок меню (.menu > button)');
  for (const b of buttons) {
    b.click();
    await sleep(160);
    const pop = document.querySelector('.menu-pop');
    const item = pop
      ? [...pop.querySelectorAll('button')].find((n) => (n.textContent || '').includes('Пример с ошибками'))
      : null;
    if (item) {
      const label = (item.textContent || '').trim();
      item.click(); // обработчик сам снимает .menu-pop (toolbar.js#menu)
      return label;
    }
    // Не то меню — закрыть, иначе следующая кнопка откроет popover поверх.
    if (pop) { b.click(); await sleep(80); }
  }
  throw new Error('пункт «Пример с ошибками (проверки)…» не найден ни в одном меню; меню: '
    + buttons.map((b) => (b.textContent || '').trim()).join(', '));
})()`;

// Число замечаний читаем из разделов панели, а не из checkResult(): кадр
// показывает именно то, что видит человек, и отчёт должен считать то же.
const CHECKS_INFO = `(() => {
  const rows = (sel) => [...document.querySelectorAll(sel)];
  const std = rows('#checks-standard li.finding');
  return {
    standard: std.length,
    practice: rows('#checks-practice li.finding').length,
    project: rows('#checks-project li.finding').length,
    first: (std[0]?.querySelector('.mt')?.textContent || '').trim().slice(0, 80),
    empty: (document.getElementById('checks-empty')?.textContent || '').trim().slice(0, 160),
    tab: !!document.querySelector('#right .tab[data-tab="checks"].active'),
  };
})()`;

/* ----------------------------------------------------------------- сценарии */

const SCENARIOS = [
  {
    id: 'main-canvas',
    file: 'main-canvas.png',
    what: 'стартовый экран',
    async run(s, base) {
      await s.navigate(base.replace(/\/$/, '/'));
      await s.waitFor('typeof window.__uml === "object" && document.readyState === "complete"',
        15000, 'приложение (window.__uml)', 'document.title');
      await s.settle(400); // приглашение появляется с переходом, а не мгновенно
      // Стартовый экран — приглашение #welcome поверх пустого листа
      // (src/ui/welcome.js). Если модель вдруг пришла не пустой (у кого-то
      // остался «последний файл»), это не ошибка кадра — просто другой вид;
      // поэтому принимаем и непустой лист, но говорим об этом в отчёте.
      const seen = await s.waitFor(`(() => {
        const w = document.getElementById('welcome');
        const shapes = document.querySelectorAll('#sheetlayer [data-kind="shape"]').length;
        if (w && !w.hidden) return 'welcome';
        return shapes ? 'shapes:' + shapes : '';
      })()`, 8000, '#welcome (приглашение) или фигуры на листе', 'document.body.innerText');
      if (seen === 'welcome') {
        const title = await s.evaluate(`(document.querySelector('#welcome .wl-title')?.textContent || '').trim()`);
        return { detail: 'приглашение «Начало работы»' + (title ? ' (' + title + ')' : '') };
      }
      return { detail: 'лист не пуст: ' + seen.replace('shapes:', '') + ' фигур' };
    },
  },

  {
    id: 'class-diagram',
    file: 'class-diagram.png',
    what: 'диаграмма классов',
    async run(s, base) {
      await s.navigate(base + '?model=all&diagram=class');
      await s.waitFor('typeof window.__uml === "object" && document.readyState === "complete"',
        15000, 'приложение (window.__uml)', 'document.title');
      await s.waitFor('document.querySelectorAll("#sheetlayer [data-kind=\\"shape\\"]").length > 0',
        12000, 'фигуры на листе (#sheetlayer [data-kind=shape])', 'document.getElementById("statusbar")?.innerText');
      await s.settle(300);
      const info = await s.evaluate(SHEET_INFO);
      if (!info || info.kind !== 'class') {
        throw new ShotError('открылся лист «' + (info?.name ?? '?') + '» вида ' + (info?.kind ?? '?')
          + ', а ждали вид class (?model=all&diagram=class)');
      }
      if (!info.rendered) throw new ShotError('на листе ноль фигур: #sheetlayer пуст');
      if (info.welcome) throw new ShotError('поверх листа осталось приглашение #welcome — кадр не про диаграмму классов');
      return {
        detail: 'лист «' + info.name + '»: фигур ' + info.shapes + ', связей ' + info.links
          + ' (' + info.figures.join(', ') + ')',
      };
    },
  },

  {
    id: 'activity-partitions',
    file: 'activity-partitions.png',
    what: 'диаграмма деятельности с дорожками',
    async run(s, base) {
      await s.navigate(base + '?model=all&diagram=activity');
      await s.waitFor('typeof window.__uml === "object" && document.readyState === "complete"',
        15000, 'приложение (window.__uml)', 'document.title');
      await s.waitFor('document.querySelectorAll("#sheetlayer [data-kind=\\"shape\\"]").length > 0',
        12000, 'фигуры на листе (#sheetlayer [data-kind=shape])', 'document.getElementById("statusbar")?.innerText');
      await s.settle(300);
      const info = await s.evaluate(SHEET_INFO);
      if (!info || info.kind !== 'activity') {
        throw new ShotError('открылся лист «' + (info?.name ?? '?') + '» вида ' + (info?.kind ?? '?')
          + ', а ждали вид activity (?model=all&diagram=activity)');
      }
      // Дорожка — swimlane: имя сценария обещает разделы, а не просто activity.
      if (!info.swimlanes) {
        throw new ShotError('на листе деятельности нет ни одной дорожки (swimlane): фигуры — '
          + info.figures.join(', '));
      }
      if (info.welcome) throw new ShotError('поверх листа осталось приглашение #welcome — кадр не про деятельность');
      return {
        detail: 'лист «' + info.name + '»: фигур ' + info.shapes + ', связей ' + info.links
          + ', дорожек ' + info.swimlanes,
      };
    },
  },

  {
    id: 'inspector-tree',
    file: 'inspector-tree.png',
    what: 'дерево модели и инспектор',
    async run(s, base) {
      await s.navigate(base + '?model=all&diagram=class');
      await s.waitFor('typeof window.__uml === "object" && document.readyState === "complete"',
        15000, 'приложение (window.__uml)', 'document.title');
      await s.waitFor('!!document.querySelector("#model .node.diagram[data-diagram-id]")',
        12000, 'строка диаграммы в дереве (#model .node.diagram[data-diagram-id])',
        'document.getElementById("model")?.innerText');
      await s.settle(200);
      const picked = await s.evaluate(OPEN_INSPECTOR);
      await s.settle(260);
      // Инспектор должен остаться на вкладке «Свойства»: если кто-то переключил
      // вкладку, кадр покажет пустоту справа, и это надо назвать, а не гадать.
      const active = await s.evaluate(`!!document.querySelector('#right .tab[data-tab="props"].active')`);
      if (!active) throw new ShotError('вкладка «Свойства» не активна после выбора элемента — инспектор не виден');
      return {
        detail: 'выбран «' + picked.elementName + '» (' + picked.elementId + ') в листе «'
          + picked.diagramName + '», раздел «' + picked.section + '», полей: ' + picked.fields
          + ', строк элементов: ' + picked.rows,
      };
    },
  },

  {
    id: 'validation',
    file: 'validation.png',
    what: 'проверки: пример с ошибками',
    async run(s, base) {
      // Модель для этого кадра не важна: меню грузит своё демо. class берём
      // как «обычный открытый проект», чтобы до клика экран был осмысленным.
      await s.navigate(base + '?model=all&diagram=class');
      await s.waitFor('typeof window.__uml === "object" && document.readyState === "complete"',
        15000, 'приложение (window.__uml)', 'document.title');
      await s.settle(250);
      const label = await s.evaluate(OPEN_DEMO_ERRORS);
      // Демо читается fetch'ем (77 КБ) и прогоняется проверками — на слабой
      // машине это секунды, поэтому ждём строки, а не «три секунды».
      await s.waitFor('!!document.querySelector("#checks-standard")',
        20000, 'раздел «По спецификации UML 2.5.1» (#checks-standard)',
        'document.getElementById("checks")?.innerText');
      await s.waitFor('document.querySelectorAll("#checks-standard li.finding").length > 0',
        20000, 'строки замечаний в разделе стандарта (#checks-standard li.finding)',
        'document.getElementById("checks")?.innerText');
      await s.settle(400);
      const info = await s.evaluate(CHECKS_INFO);
      if (!info.tab) throw new ShotError('вкладка «Проверки» не активна — панель не открылась');
      if (info.empty) throw new ShotError('панель «Проверки» вместо списка показала: «' + info.empty + '»');
      if (!info.standard) throw new ShotError('в разделе стандарта ноль строк (#checks-standard li.finding)');
      // Кадр — весь экран: панель замечаний без листа и дерева не объясняет,
      // что за модель проверяли.
      return {
        detail: 'пункт меню «' + label + '»: строк стандарта ' + info.standard
          + ', практики ' + info.practice
          + (info.project ? ', правил проекта ' + info.project : '')
          + '; первая: «' + info.first + '»',
      };
    },
  },
];

/* -------------------------------------------------------------------- запуск */

function parseOnly(argv) {
  const out = [];
  const themes = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--only=')) out.push(a.slice('--only='.length));
    else if (a === '--only') out.push(argv[i + 1] ?? '');
    else if (a.startsWith('--theme=')) themes.push(a.slice('--theme='.length));
    else if (a === '--theme') themes.push(argv[i + 1] ?? '');
    else if (a === '--help' || a === '-h') return { help: true };
    else return { error: 'неизвестный аргумент: ' + a };
  }
  const want = themes.flatMap((t) => (t === 'both' ? THEMES : [t])).filter(Boolean);
  const bad = want.filter((t) => !THEMES.includes(t));
  if (bad.length) return { error: 'неизвестная тема: ' + bad.join(', ') + ' (есть: light, dark, both)' };
  return { only: out.filter(Boolean), themes: want.length ? want : THEMES };
}

async function main() {
  const cli = parseOnly(process.argv.slice(2));
  if (cli.help) {
    console.log('node tools/shots.mjs [--only=<сценарий>…] [--theme=light|dark|both]\n\n'
      + 'Сценарии: ' + SCENARIOS.map((s) => s.id).join(', ') + '\n'
      + 'Темы:     ' + THEMES.join(', ') + ' (по умолчанию обе)\n'
      + 'Файлы:    ' + OUT);
    return 0;
  }
  if (cli.error) { console.error(cli.error); return 2; }

  const chosen = cli.only?.length
    ? SCENARIOS.filter((s) => cli.only.includes(s.id))
    : SCENARIOS;
  if (!chosen.length) {
    console.error('неизвестный сценарий: ' + cli.only.join(', ')
      + '\nесть: ' + SCENARIOS.map((s) => s.id).join(', '));
    return 2;
  }

  const { bin, tried } = findChrome();
  if (!bin) {
    console.error('headless-Chromium не найден. Пробовал:');
    for (const p of tried) console.error('  ' + p);
    console.error('Подсказка: укажите путь в CHROME_PATH=… и запустите снова.');
    return 2;
  }

  const { server, base } = await serveApp();
  let browser = null;
  let failed = 0;
  const lines = [];

  try {
    browser = await launch(bin, base);
    const s = browser.session;
    console.log('браузер: ' + bin);
    console.log('стенд:   ' + base + '   (окно ' + VIEW.width + '×' + VIEW.height + ' @' + VIEW.scale + '×)\n');

    for (const theme of cli.themes) {
      for (const sc of chosen) {
        s.resetErrors();
        const label = sc.id + (theme === 'dark' ? ' [dark]' : '');
        try {
          // Тему ставим ДО навигации: сценарий сам грузит страницу, и кадр
          // должен получиться уже в ней, без вспышки чужой темы.
          await setTheme(s, theme);
          const { detail } = await sc.run(s, base);
        // Консоль проверяем ДО записи файла: снимок с исключением в консоли
        // не должен попасть в README как «нормальный» — лучше оставить прошлый
        // кадр и назвать причину, чем опубликовать сломанный экран.
        const errs = s.errors();
        if (errs.length) throw new ShotError('ошибки в консоли: ' + errs.slice(0, 3).join(' | ')
          + (errs.length > 3 ? ' … ещё ' + (errs.length - 3) : ''));
        const png = await capture(s, fileFor(sc, theme));
        lines.push('ok   ' + label.padEnd(26) + ' ' + png.dest + '  ' + png.bytes + ' байт ('
          + png.width + '×' + png.height + ')  — ' + detail);
        } catch (e) {
          failed += 1;
          lines.push('FAIL ' + label.padEnd(26) + ' — ' + sc.what + ': '
            + (e instanceof ShotError ? e.message : String(e.stack || e)));
        }
      }
    }
  } catch (e) {
    // Стенд упал целиком (нет браузера, нет сервера) — это тоже «не дал снимок».
    failed = chosen.length * cli.themes.length;
    lines.push('FAIL стенд — ' + (e instanceof ShotError ? e.message : String(e.stack || e)));
  } finally {
    if (browser) {
      try { browser.ws.close(); } catch { /* уже закрыт */ }
      browser.child.kill('SIGKILL');
      try { await rm(browser.profile, { recursive: true, force: true }); } catch { /* уже нет */ }
    }
    server.close();
  }

  for (const l of lines) console.log(l);
  console.log('\nСнимков: ' + (chosen.length - failed) + ' из ' + chosen.length
    + ' · папка ' + OUT);
  return failed ? 1 : 0;
}

process.exitCode = await main();