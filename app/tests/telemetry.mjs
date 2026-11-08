// Счётчик событий и режим сборки --stand.
//
// ЗАЧЕМ. Счётчик — единственная часть приложения, которая говорит с сетью, и
// поэтому единственная, где ошибка стоит дороже всего: лишний запрос в обычной
// сборке, адрес приёма в публичном репозитории, событие без согласия человека.
// Набор проверяет ровно это, числами и в настоящем браузере:
//
//   (а) обычная сборка: в src нет `enabled: true`, нет пути `/a/` и слова
//       `kunni-course`; при загрузке страницы — ни одного POST и ни одного
//       запроса на чужой хост;
//   (б) stand-сборка с ВРЕМЕННЫМ `.build.env` (путь передаётся через
//       UML_BUILD_ENV, значения фиктивные): в конфиге ровно один `/a/`,
//       build.json говорит mode stand, в index.html есть meta uml-build и
//       canonical/OG из STAND_URL, а сам адрес приёма в консоль не попал;
//   (в) `--stand` без файла — код 1 и понятное сообщение (и каталога не
//       появляется: «счётчик в никуда» не собирается);
//   (г) в браузере на stand-сборке: по умолчанию (без отказа) — один POST; после
//       перезагрузки — ровно один POST с массивом событий, все имена из
//       белого списка, в теле нет ни одного имени элемента модели; после
//       «нет» — снова ноль.
//
// РАБОЧИЙ dist/ НЕ ТРОГАЕТСЯ: обе сборки идут во временные каталоги
// (`--out=`), а в конце набор ВСЕГДА возвращает app/dist обычной сборкой
// (`node build.mjs`) — даже если упал по дороге.
//
// Стенд тот же, что у остальных наборов: локальный `node:http` сервер и
// headless-Chromium по CDP через встроенный WebSocket Node, без пакетов.
//
//   node tests/telemetry.mjs             прогнать всё
//   node tests/telemetry.mjs --verbose   печатать каждый шаг
//
// Код возврата 0 — все проверки прошли; 1 — есть падения (они перечислены).

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { existsSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
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

/** Фиктивные значения стенда: настоящие берутся только из `.build.env`. */
const FAKE_STAND_URL = 'https://stand.invalid';
const FAKE_TELEMETRY = '/a/00000000000000000000000000000000';

/** Белый список имён событий — тот же, что в src/telemetry.js (§6.3). */
const EVENT_NAMES = new Set([
  'app.open', 'perf.firstPaint', 'command', 'commit', 'diagram.create',
  'validation.run', 'validation.fix', 'export', 'import.plantuml',
  'course.open', 'course.step', 'reference.open', 'theme.change',
  'brand.change', 'error',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (VERBOSE) console.log('   ', ...a); };

/* ------------------------------------------------------------ сервер */

/**
 * Сервер стенда. Отдаёт каталог сборки и ЗАПОМИНАЕТ POST-ы: счётчик шлёт
 * ровно один `sendBeacon` на `/a/…`, поэтому «сколько раз пришло» — это
 * длина `posts`. Все запросы тоже записываются: по ним видно, ходила ли
 * страница куда-то, кроме своего же origin.
 */
function serve(rootDir) {
  const state = { root: rootDir, posts: [], requests: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    state.requests.push({ method: req.method, path: url.pathname });
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      state.posts.push({ path: url.pathname, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(204).end();
      return;
    }
    const wanted = path.resolve(state.root, `.${decodeURIComponent(url.pathname)}`);
    const file = url.pathname.endsWith('/') ? path.join(wanted, 'index.html') : wanted;
    if (file !== state.root && !file.startsWith(`${state.root}${path.sep}`)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, port: server.address().port });
    });
  });
}

/* ------------------------------------------------------------ браузер */

function chromeCandidates() {
  const home = process.env.HOME ?? '';
  return [
    `${home}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${home}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
    `${home}/.hermes/tools/chromium-1208/chrome-linux64/chrome`,
  ].filter((p) => existsSync(p) && (accessSync(p, constants.X_OK), true));
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
      } else if (msg.method) {
        this.events.push(msg);
        // Перезагрузка страницы с несохранённой правкой спрашивает
        // «уходить?» (main.js: beforeunload). Человек ответил бы «уйти» —
        // отвечаем так же, иначе навигация ждёт диалога и страница «висит».
        if (msg.method === 'Page.javascriptDialogOpening') {
          this.ws.send(JSON.stringify({
            id: ++this.id,
            method: 'Page.handleJavaScriptDialog',
            params: { accept: true },
          }));
        }
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method}: no answer in 20s`));
        }
      }, 20000);
    });
  }

  async evaluate(expression) {
    // CDP иногда теряет промис асинхронного выражения («Promise was
    // collected») — это гонка проверяющего, а не приложения: повторяем раз.
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true, userGesture: true,
      });
      if (res.error && /Promise was collected/.test(res.error.message ?? '') && attempt === 0) continue;
      const details = res.result?.exceptionDetails;
      if (details) throw new Error(`eval: ${details.exception?.description ?? details.text}`.slice(0, 400));
      if (res.error) throw new Error(`eval: ${res.error.message}`);
      return res.result?.result?.value;
    }
  }

  waitFor(method, ms = 20000, from = this.events.length) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        for (let i = from; i < this.events.length; i += 1) {
          if (this.events[i].method === method) {
            const [event] = this.events.splice(i, 1);
            resolve(event);
            return;
          }
        }
        if (Date.now() - started > ms) {
          reject(new Error(`${method}: no event in ${ms}ms`));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  /** Запросы, которые страница сделала по сети (для «ноль внешних»). */
  requests() {
    return this.events
      .filter((e) => e.method === 'Network.requestWillBeSent')
      .map((e) => ({ url: e.params?.request?.url ?? '', method: e.params?.request?.method ?? '' }));
  }
}

async function launch(url) {
  const bin = chromeCandidates()[0];
  if (!bin) throw new Error('headless Chrome not found');
  const profile = await mkdtemp(path.join(tmpdir(), 'uml-telemetry-prof-'));
  const port = 9600 + Math.floor(Math.random() * 300);
  const child = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-features=Translate',
    `--remote-debugging-port=${port}`, '--window-size=1440,900',
    `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let ws = null;
  for (let i = 0; i < 80 && !ws; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      }
    } catch { /* браузер ещё поднимается */ }
  }
  if (!ws) { child.kill('SIGKILL'); throw new Error('no devtools target'); }

  const session = new Session(ws);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  await session.send('Network.enable');
  return { child, profile, session };
}

/** Ждёт выполнения условия в странице; исключения навигации — «ещё нет». */
async function until(fn, ms = 8000, step = 100) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    try {
      const value = await fn();
      if (value) return value;
    } catch { /* контекст страницы мог исчезнуть при reload */ }
    await sleep(step);
  }
  return null;
}

async function reload(session) {
  const from = session.events.length;
  await session.send('Page.reload', { ignoreCache: true });
  await session.waitFor('Page.loadEventFired', 20000, from).catch(() => {});
  const ready = await until(async () => session.evaluate(
    "document.readyState === 'complete' && !!window.__uml",
  ), 20000);
  if (!ready) throw new Error('после reload страница не загрузилась');
  await until(async () => session.evaluate("!!document.querySelector('#canvas .sh, #welcome')"), 8000);
  return true;
}

/* ------------------------------------------------------------ сборка */

/** `node build.mjs …` в app/; вывод склеен: код и текст проверяем вместе. */
function runBuild(args, env = {}) {
  const res = spawnSync(process.execPath, ['build.mjs', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 300000,
  });
  return {
    code: res.status,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    stdout: res.stdout ?? '',
  };
}

/** Есть ли строка в каком-нибудь текстовом файле каталога (рекурсивно). */
async function grepTree(dir, needle) {
  const hits = [];
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.(js|mjs|json|html|css|svg|xml|md|txt)$/i.test(entry.name)) continue;
      const text = await readFile(full, 'utf8').catch(() => '');
      if (text.includes(needle)) hits.push(path.relative(dir, full) || entry.name);
    }
  };
  await walk(dir);
  return hits;
}

/* ------------------------------------------------------------ проверки */

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ------------------------------------------------------------ сценарий */

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'uml-telemetry-'));
  const productOut = path.join(tmp, 'product');
  const standOut = path.join(tmp, 'stand');
  const envFile = path.join(tmp, 'build.env');

  let site = null;
  let launched = null;

  const stopSite = async () => {
    if (!site) return;
    const { server } = site;
    site = null;
    await new Promise((resolve) => server.close(resolve));
  };
  const stopBrowser = async () => {
    if (!launched) return;
    try { launched.child.kill('SIGKILL'); } catch { /* уже закрыт */ }
    try { await rm(launched.profile, { recursive: true, force: true }); } catch { /* профиль не наш */ }
    launched = null;
  };
  const startSite = async (dir) => {
    await stopSite();
    await stopBrowser();
    site = await serve(dir);
    return site;
  };
  const startBrowser = async (base) => {
    await stopBrowser();
    launched = await launch(base);
    const ready = await until(async () => launched.session.evaluate(
      "document.readyState === 'complete' && !!window.__uml",
    ), 25000);
    if (!ready) throw new Error('приложение не поднялось: window.__uml нет');
    await until(async () => launched.session.evaluate("!!document.querySelector('#canvas .sh, #welcome')"), 8000);
    return launched.session;
  };

  try {
    /* ------------------------------------------------------ (а) обычная */

    await check('обычная сборка собирается', async () => {
      const r = runBuild([`--out=${productOut}`]);
      assert(r.code === 0, `node build.mjs вышел с кодом ${r.code}: ${r.out.slice(-600)}`);
      const cfg = await readFile(path.join(productOut, 'src', 'telemetry.config.js'), 'utf8');
      return `exit 0, конфиг: ${cfg.trim()}`;
    });

    await check('обычная сборка: нет enabled: true, нет /a/ и kunni-course', async () => {
      const cfg = await readFile(path.join(productOut, 'src', 'telemetry.config.js'), 'utf8');
      assert(!/enabled\s*:\s*true/.test(cfg), `в src/telemetry.config.js есть enabled: true: ${cfg.trim()}`);
      assert(!cfg.includes('/a/'), 'в src/telemetry.config.js есть путь приёма «/a/»');
      const hits = await grepTree(path.join(productOut, 'src'), '/a/');
      assert(hits.length === 0, `«/a/» нашлось в src: ${hits.join(', ')}`);
      const domain = await grepTree(path.join(productOut, 'src'), 'kunni-course');
      assert(domain.length === 0, `«kunni-course» нашлось в src: ${domain.join(', ')}`);
      const build = JSON.parse(await readFile(path.join(productOut, 'build.json'), 'utf8'));
      assert(build.mode === 'product', `build.json: mode = ${JSON.stringify(build.mode)}, ждали "product"`);
      assert(build.telemetry === false, `build.json: telemetry = ${JSON.stringify(build.telemetry)}, ждали false`);
      const html = await readFile(path.join(productOut, 'index.html'), 'utf8');
      assert(!html.includes('uml-build'), 'в index.html обычной сборки есть meta uml-build');
      assert(!html.includes('canonical'), 'в index.html обычной сборки есть canonical');
      return 'src чист, build.json product, метаданных стенда нет';
    });

    await check('обычная сборка: при загрузке страницы ни одного POST и ни одного чужого запроса', async () => {
      const started = await startSite(productOut);
      const session = await startBrowser(`http://127.0.0.1:${started.port}/?model=sample`);
      await until(async () => session.evaluate("!!document.querySelector('#canvas .sh')"), 8000);
      await sleep(1500);
      const posts = started.state.posts.length;
      assert(posts === 0, `страница сделала ${posts} POST(ов), ждали 0`);
      const toA = started.state.requests.filter((r) => r.path.startsWith('/a/'));
      assert(toA.length === 0, `запросы к /a/: ${toA.length}`);
      const instate = started.state.requests.filter((r) => r.method !== 'GET' && r.method !== 'POST');
      assert(instate.length === 0, `неожиданные запросы: ${instate.map((r) => r.method).join(', ')}`);
      const external = session.requests()
        .map((r) => { try { return new URL(r.url); } catch { return null; } })
        .filter((u) => u && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.protocol.startsWith('http'));
      assert(external.length === 0, `запросы на чужой хост: ${external.map((u) => u.href).slice(0, 3).join(', ')}`);
      const consent = await session.evaluate("!!document.querySelector('#uml-consent')");
      assert(consent === false, 'в обычной сборке появился узел согласия — его не должно быть');
      return `POST 0, запросов к /a/ 0, чужих хостов 0; узла согласия нет`;
    });

    /* --------------------------------------------------- (б/в) сборки */

    await writeFile(envFile, `# временный файл теста — фиктивные значения\n`
      + `STAND_URL=${FAKE_STAND_URL}\n`
      + `TELEMETRY_PATH=${FAKE_TELEMETRY}\n`, 'utf8');

    await check('stand-сборка с временным .build.env: один /a/, build.json и meta', async () => {
      const r = runBuild(['--stand', `--out=${standOut}`], { UML_BUILD_ENV: envFile });
      assert(r.code === 0, `node build.mjs --stand вышел с кодом ${r.code}: ${r.out.slice(-600)}`);
      assert(r.out.includes('stand build: telemetry on (endpoint hidden)'),
        `в консоли нет строки «stand build: telemetry on (endpoint hidden)»: ${r.out.slice(-400)}`);
      const token = FAKE_TELEMETRY.split('/').pop();
      assert(!r.out.includes(token), 'адрес приёма попал в консоль сборки');
      assert(!r.out.includes('00000000000000000000000000000000'), 'токен приёма попал в консоль сборки');

      const cfg = await readFile(path.join(standOut, 'src', 'telemetry.config.js'), 'utf8');
      const paths = cfg.match(/\/a\//g) ?? [];
      assert(paths.length === 1, `в конфиге ${paths.length} вхождений «/a/», ждали ровно одно`);
      assert(!JSON.stringify(cfg).includes('"enabled":false'), 'в stand-конфиге enabled: false');
      assert(/enabled"\s*:\s*true/.test(cfg), `в stand-конфиге нет enabled: true: ${cfg.trim()}`);
      assert(cfg.includes(FAKE_TELEMETRY), 'в stand-конфиге нет endpoint из .build.env');

      const build = JSON.parse(await readFile(path.join(standOut, 'build.json'), 'utf8'));
      assert(build.mode === 'stand', `build.json: mode = ${JSON.stringify(build.mode)}, ждали "stand"`);
      assert(build.telemetry === true, `build.json: telemetry = ${JSON.stringify(build.telemetry)}, ждали true`);
      assert(typeof build.builtAt === 'string' && build.builtAt.length > 10, 'build.json: нет builtAt');
      assert('commit' in build, 'build.json: нет поля commit');

      const html = await readFile(path.join(standOut, 'index.html'), 'utf8');
      assert(html.includes('<meta name="uml-build" content="stand">'), 'в index.html нет meta uml-build=stand');
      assert(html.includes(`<link rel="canonical" href="${FAKE_STAND_URL}/">`),
        'в index.html нет canonical из STAND_URL');
      assert(html.includes(`<meta property="og:url" content="${FAKE_STAND_URL}/">`), 'в index.html нет og:url');
      assert(html.includes(`<meta property="og:image" content="${FAKE_STAND_URL}/assets/og.png">`),
        'в index.html нет og:image = STAND_URL/assets/og.png');
      assert(html.includes('name="twitter:card"'), 'в index.html нет twitter:card');
      assert(!html.includes(FAKE_TELEMETRY), 'путь приёма попал в index.html');
      return `${paths.length} × «/a/», build.json stand, meta и canonical на месте`;
    });

    await check('--stand без .build.env: код 1 и понятное сообщение', async () => {
      const missing = path.join(tmp, 'нет-такого-файла.env');
      const outDir = path.join(tmp, 'fail-missing');
      const r = runBuild(['--stand', `--out=${outDir}`], { UML_BUILD_ENV: missing });
      assert(r.code === 1, `код ${r.code}, ждали 1; вывод: ${r.out.slice(-400)}`);
      assert(/build\.env/i.test(r.out), `сообщение не называет .build.env: ${r.out.slice(-400)}`);
      assert(/STAND_URL|TELEMETRY_PATH/.test(r.out), `сообщение не называет обязательные ключи: ${r.out.slice(-400)}`);
      const made = await stat(outDir).catch(() => null);
      assert(!made, `при падении создался каталог сборки ${path.basename(outDir)}`);
      return 'exit 1, сообщение про .build.env и ключи, каталог не создан';
    });

    await check('--stand без TELEMETRY_PATH: тоже падает с кодом 1', async () => {
      const bare = path.join(tmp, 'bare.env');
      await writeFile(bare, `STAND_URL=${FAKE_STAND_URL}\n`, 'utf8');
      const r = runBuild(['--stand', `--out=${path.join(tmp, 'fail-bare')}`], { UML_BUILD_ENV: bare });
      assert(r.code === 1, `код ${r.code}, ждали 1; вывод: ${r.out.slice(-300)}`);
      assert(r.out.includes('TELEMETRY_PATH'), `сообщение не называет TELEMETRY_PATH: ${r.out.slice(-300)}`);
      return 'exit 1, сообщение называет TELEMETRY_PATH';
    });

    /* ---------------------------------------------- (г) браузер, стенд */

    await check('стенд в браузере: по умолчанию включено — один POST, отказ кнопкой', async () => {
      const started = await startSite(standOut);
      const session = await startBrowser(`http://127.0.0.1:${started.port}/?model=sample`);
      await until(async () => session.evaluate("!!document.querySelector('#canvas .sh')"), 8000);

      const shown = await until(async () => session.evaluate(`(() => {
        const n = document.querySelector('#uml-consent');
        return !!n && !n.hidden;
      })()`), 6000);
      assert(shown, 'строка про счётчик не появилась при наличии диаграммы (cfg.enabled = true)');
      const stored = await session.evaluate("(() => { try { return localStorage.getItem('uml.telemetry'); } catch (e) { return 'blocked'; } })()");
      assert(stored === null, `до выбора localStorage['uml.telemetry'] = ${JSON.stringify(stored)}, ждали null (по умолчанию)`);

      await clickAround(session);
      const arrived = await until(async () => started.state.posts.length > 0, 12000, 200);
      assert(arrived, 'по умолчанию (без отказа) не пришло ни одного POST на /a/');
      await sleep(1500);
      const posts = started.state.posts.filter((p) => p.path.startsWith('/a/'));
      assert(posts.length === 1, `по умолчанию пришло ${posts.length} POST(ов), ждали ровно один`);
      return `строка показана, ключа нет, событий одним POST: пришёл 1`;
    });

    await check('стенд: «Оставить» → ровно один POST, имена из белого списка, текста модели нет', async () => {
      const started = site;
      const session = launched.session;

      const clicked = await session.evaluate(`(() => {
        const yes = document.querySelector('#uml-consent .cs-yes');
        if (!yes) return false;
        yes.click();
        return true;
      })()`);
      assert(clicked, 'в строке про счётчик нет кнопки «Оставить» (.cs-yes)');
      const stored = await session.evaluate("(() => { try { return localStorage.getItem('uml.telemetry'); } catch (e) { return null; } })()");
      assert(stored === 'on', `после «Оставить» localStorage['uml.telemetry'] = ${JSON.stringify(stored)}, ждали "on"`);
      const gone = await session.evaluate("!document.querySelector('#uml-consent')");
      assert(gone, 'строка согласия осталась на экране после ответа');

      // События, поставленные до перезагрузки, не считаем: нас интересует
      // одна чистая загрузка с согласием и один POST по таймеру 5 с.
      started.state.posts.length = 0;
      await reload(session);
      await until(async () => session.evaluate("!!document.querySelector('#canvas .sh')"), 8000);
      await clickAround(session);

      const arrived = await until(async () => started.state.posts.length > 0, 12000, 200);
      assert(arrived, 'за 12 с после согласия не пришло ни одного POST на /a/');
      // Дать таймеру доиграть: второй POST означал бы утечку события мимо очереди.
      await sleep(1500);
      const posts = started.state.posts.filter((p) => p.path.startsWith('/a/'));
      assert(posts.length === 1, `пришло ${posts.length} POST(ов), ждали ровно один`);

      let batch;
      try { batch = JSON.parse(posts[0].body); } catch { throw new Error(`тело POST — не JSON: ${posts[0].body.slice(0, 200)}`); }
      assert(Array.isArray(batch), `тело POST — не массив событий: ${posts[0].body.slice(0, 120)}`);
      assert(batch.length > 0, 'массив событий пуст');
      for (const ev of batch) {
        assert(typeof ev?.e === 'string', `событие без имени: ${JSON.stringify(ev).slice(0, 120)}`);
        assert(EVENT_NAMES.has(ev.e), `событие «${ev.e}» не из белого списка`);
        assert(ev.v === 1, `версия события ${JSON.stringify(ev.v)} вместо 1`);
        assert(typeof ev.s === 'string' && ev.s.length > 8, `у события «${ev.e}» нет номера сессии`);
        assert(ev.k && typeof ev.k === 'object' && !Array.isArray(ev.k), `у события «${ev.e}» нет объекта k`);
      }

      // Ни одного имени элемента модели в теле: счётчик говорит о нажатиях, а
      // не о том, что человек нарисовал.
      const names = await session.evaluate(`(window.__uml?.store?.model?.elements ?? [])
        .map((e) => e.name).filter((n) => typeof n === 'string' && n.length > 2)`);
      const leaked = names.filter((n) => posts[0].body.includes(n));
      assert(leaked.length === 0, `в теле POST есть имена элементов модели: ${leaked.slice(0, 3).join(', ')}`);
      assert(!posts[0].body.includes('.uml.json'), 'в теле POST есть имя файла модели');
      const kinds = [...new Set(batch.map((e) => e.e))].sort().join(', ');
      return `${batch.length} событий одним POST на ${posts[0].path}; имена: ${kinds}; имён модели ${names.length}, просочилось 0`;
    });

    await check('стенд: «Не отправлять» → снова ни одного POST', async () => {
      const started = site;
      const session = launched.session;
      const before = started.state.posts.length;

      await session.evaluate("(() => { try { localStorage.setItem('uml.telemetry', 'off'); } catch (e) { /* окно без хранилища */ } })()");
      await reload(session);
      await until(async () => session.evaluate("!!document.querySelector('#canvas .sh')"), 8000);
      await clickAround(session);
      await sleep(6500);
      const posts = started.state.posts.filter((p) => p.path.startsWith('/a/'));
      assert(posts.length === before,
        `с отказом пришло ${posts.length} POST(ов) вместо ${before}: счётчик не выключился`);
      const consent = await session.evaluate("!!document.querySelector('#uml-consent')");
      assert(consent === false, 'строка про счётчик вернулась после отказа');
      return `POST на /a/ не прибавилось (${posts.length}), строка не вернулась`;
    });
  } finally {
    await stopSite();
    await stopBrowser();
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    // Рабочий dist/ обязан остаться обычной сборкой — даже если набор упал:
    // иначе следующий прогон (tools/verify.mjs у лида) увидит stand-артефакт.
    const restored = runBuild([]);
    if (restored.code !== 0) {
      console.error(`telemetry: не удалось вернуть app/dist обычной сборкой: ${restored.out.slice(-400)}`);
    } else {
      log('app/dist возвращён обычной сборкой');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
  if (failed.length) {
    console.log('упали:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

/* ---------------------------------------------------------- клики */

/**
 * «Покликать по интерфейсу» — так, как это делает человек, но без надежды на
 * конкретную разметку: инструмент с полосы, место на листе, вкладка
 * «Проверки», кнопка «Проверить» и одна команда через настоящий диспетчер
 * палитры (тот же `run()` в src/ui/commands.js, что и по Ctrl+K).
 *
 * Ничего не проверяет и ничего не ждёт: важно только, что после этих
 * действий счётчик либо молчит, либо ставит события в очередь.
 */
async function clickAround(session) {
  const tool = await session.evaluate(`(() => {
    const n = document.querySelector('#toolstrip [data-tool="class"]') || document.querySelector('#toolstrip .tool');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (tool) {
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tool.x, y: tool.y, button: 'left', clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tool.x, y: tool.y, button: 'left', clickCount: 1 });
  }
  const spot = await session.evaluate(`(() => {
    const n = document.querySelector('#canvas-wrap');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (spot) {
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
  }
  await session.evaluate(`(() => {
    document.querySelector('[data-tab="checks"]')?.click();
    return true;
  })()`);
  await session.evaluate(`(() => {
    document.querySelector('#checks-run')?.click();
    return true;
  })()`);
  // Одна команда через настоящий диспетчер палитры: событие `command id`.
  await session.evaluate(`(() => {
    const pal = document.getElementById('cmdpal');
    if (!pal) return false;
    pal.dispatchEvent(new CustomEvent('sc-command', { detail: { id: 'view-fit' }, bubbles: true }));
    return true;
  })()`);
}

main().catch((e) => {
  console.error('telemetry: ', e.message);
  process.exit(1);
});