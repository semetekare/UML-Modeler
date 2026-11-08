// Тема оформления: светлая, тёмная и «как в системе».
//
// ЗАЧЕМ. Тёмная тема — не «инвертировать светлую»: у неё свои поверхности,
// чернила и акцент, а WCAG-пороги считаются, а не подбираются на глаз. Этот
// набор проверяет ровно то, что видит человек и что уходит в файл:
//
//   * выбор темы живёт в localStorage['ui-kit.appearance'] и читается ДО первой
//     отрисовки, поэтому reload не мигает чужой темой;
//   * системная тема учитывается (prefers-color-scheme эмулируется через CDP);
//   * меню «Оформление» из трёх пунктов переключает тему и держит aria-pressed;
//   * в тёмной теме панели, меню и статусбар действительно тёмные, лист тёмный,
//     подписи светлые, а акцент меняет оттенок поверхностей;
//   * контраст всех шести акцентов в обеих темах проходит WCAG 2.1 AA;
//   * экспорт SVG остаётся белым на чёрном независимо от темы экрана.
//
// Тот же стенд, что у остальных наборов: локальный сервер на node:http,
// headless-Chromium по CDP через встроенный WebSocket Node, без пакетов.
//
//   node tests/theme.mjs             прогнать всё
//   node tests/theme.mjs --verbose   печатать каждый шаг
//
// Код возврата 0 — все проверки прошли; 1 — есть падения (они перечислены).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (VERBOSE) console.log('   ', ...a); };

/* ------------------------------------------------------------ сервер */

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
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
    server.listen(0, '127.0.0.1', () => resolve(server));
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
    // collected»): контекст успевает собрать его раньше, чем ответ уходит
    // назад. Это гонка проверяющего, а не приложения, — повторяем один раз,
    // чтобы судить продукт, а не транспорт.
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

  /** Событие CDP, пришедшее не раньше индекса `from` (старые не в счёт). */
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
}

async function launch(url) {
  const bin = chromeCandidates()[0];
  if (!bin) throw new Error('headless Chrome not found');
  const profile = await mkdtemp(path.join(tmpdir(), 'uml-theme-'));
  const port = 9000 + Math.floor(Math.random() * 300);
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
  return { child, profile, session };
}

/** Ждёт выполнения условия в странице; исключения навигации — просто «ещё нет». */
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

async function setSystemTheme(session, value) {
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }],
  });
}

async function reload(session) {
  const from = session.events.length;
  await session.send('Page.reload', { ignoreCache: true });
  await session.waitFor('Page.loadEventFired', 20000, from).catch(() => {});
  const ready = await until(async () => session.evaluate(
    "document.readyState === 'complete' && !!window.__th",
  ), 15000);
  if (!ready) throw new Error('после reload страница не загрузилась');
  // Подложка листа нужна проверкам 5/9; если модели нет, это увидят они сами.
  await until(async () => session.evaluate("!!document.querySelector('#canvas .sh')"), 6000);
  // addScriptToEvaluateOnNewDocument должен был поставить __th сам; повтор на
  // случай, если вкладка успела сменить документ раньше регистрации скрипта.
  await session.evaluate(HELPERS);
  return true;
}

/* --------------------------------------------------------- страница */

// Всё, что считает цвета, живёт В САМОЙ СТРАНИЦЕ: так значения берутся из
// getComputedStyle в том виде, в каком их посчитал браузер (color-mix нынче
// отдаётся как oklab(...), а не rgb(...)). Canvas размером 1×1 переводит любой
// CSS-цвет в настоящие байты sRGB; дальше — формула WCAG 2.1 из задания.
const HELPERS = String.raw`(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const SENTINEL = '#010203';

  function viaCanvas(text) {
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = SENTINEL;
    ctx.fillStyle = text;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const c = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    if (c.r === 1 && c.g === 2 && c.b === 3 && c.a === 1 && text.trim().toLowerCase() !== SENTINEL) {
      return null;
    }
    return c;
  }

  function parse(text) {
    if (text == null) return null;
    const t = String(text).trim();
    if (!t || t.toLowerCase() === 'none') return null;
    if (t.toLowerCase() === SENTINEL) return { r: 1, g: 2, b: 3, a: 1 };
    const m = /^#([0-9a-f]{3,8})$/i.exec(t);
    if (m) {
      const h = m[1];
      const n = h.length <= 4 ? h.split('').map((ch) => ch + ch).join('') : h;
      if (n.length !== 6 && n.length !== 8) return null;
      return {
        r: parseInt(n.slice(0, 2), 16),
        g: parseInt(n.slice(2, 4), 16),
        b: parseInt(n.slice(4, 6), 16),
        a: n.length === 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1,
      };
    }
    return viaCanvas(t);
  }

  // sRGB -> линейный канал -> относительная яркость (WCAG 2.1).
  function lumOf(c) {
    if (!c) return null;
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  function contrast(a, b) {
    const la = lumOf(a);
    const lb = lumOf(b);
    if (la == null || lb == null) return NaN;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function css(c) {
    if (!c) return 'нет';
    const base = 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
    return c.a >= 0.999 ? base : base.replace('rgb(', 'rgba(').replace(')', ', ' + c.a + ')');
  }

  function over(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
      g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
      b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
      a: a,
    };
  }

  // Эффективный фон узла: собственный background-color, скомпонованный с
  // предками (иначе прозрачная панель «тёмная» просто потому, что альфа 0).
  function bgOf(el) {
    let node = el;
    let acc = { r: 0, g: 0, b: 0, a: 0 };
    while (node && node.nodeType === 1) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        acc = over(acc, c);
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    return over(acc, { r: 255, g: 255, b: 255, a: 1 });
  }

  // Значение токена из :root. getPropertyValue отдаёт объявление как есть
  // (color-mix, #hex, var(...)) — незарегистрированные custom properties
  // браузер в цвет не вычисляет. Поэтому цвет доводим пробным узлом до
  // фактического computed-значения (оно бывает и rgb(...), и oklab(...)), а
  // css-строку отдаём уже нормализованной в sRGB — по ней и сравниваем.
  function resolved(name) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    let value = raw;
    if (raw) {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;visibility:hidden';
      probe.style.color = 'var(' + name + ')';
      (document.body || document.documentElement).appendChild(probe);
      value = getComputedStyle(probe).color;
      probe.remove();
    }
    const rgba = parse(value) || parse(raw);
    return { name: name, raw: raw, computed: value, css: css(rgba), rgba: rgba, lum: lumOf(rgba) };
  }

  function fillOf(el) {
    const value = getComputedStyle(el).fill;
    const rgba = parse(value);
    return { css: value, rgba: rgba, lum: lumOf(rgba) };
  }

  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function appearance() {
    let m;
    try {
      m = await import('/src/ui/appearance.js');
    } catch (e) {
      throw new Error('нет модуля src/ui/appearance.js: ' + (e && e.message ? e.message : e));
    }
    if (typeof m.applyMode !== 'function') {
      throw new Error('src/ui/appearance.js не экспортирует applyMode');
    }
    return m;
  }

  async function brand(id) {
    let t;
    try {
      t = await import('/src/ui/toolbar.js');
    } catch (e) {
      throw new Error('нет модуля src/ui/toolbar.js: ' + (e && e.message ? e.message : e));
    }
    if (typeof t.applyBrand !== 'function') {
      throw new Error('src/ui/toolbar.js не экспортирует applyBrand');
    }
    t.applyBrand(id);
    await frames();
    return document.documentElement.dataset.brand || 'flame';
  }

  function state() {
    return {
      race: document.documentElement.dataset.race || null,
      stored: localStorage.getItem('ui-kit.appearance'),
      brand: document.documentElement.dataset.brand || 'flame',
    };
  }

  async function apply(mode) {
    const m = await appearance();
    m.applyMode(mode);
    await frames();
    return state();
  }

  window.__th = {
    parse: parse,
    css: css,
    lumOf: lumOf,
    contrast: contrast,
    bgOf: bgOf,
    resolved: resolved,
    fillOf: fillOf,
    frames: frames,
    appearance: appearance,
    brand: brand,
    state: state,
    apply: apply,
  };
})();`;

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
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/?model=sample`;
  let launched = null;

  try {
    launched = await launch(base);
    const s = launched.session;

    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });
    await s.evaluate(HELPERS);

    const ready = await until(async () => s.evaluate(
      "document.readyState === 'complete' && !!window.__uml",
    ), 20000);
    if (ready) {
      await until(async () => s.evaluate("!!document.querySelector('#canvas .sh')"), 8000);
    } else {
      log('приложение не поднялось: window.__uml нет — проверки скажут об этом сами');
    }

    // 1. Старт: по умолчанию «как в системе», тема следует prefers-color-scheme.
    await check('старт: по умолчанию system и следование системной теме', async () => {
      await setSystemTheme(s, 'dark');
      await s.evaluate("localStorage.removeItem('ui-kit.appearance')");
      await reload(s);
      const dark = await s.evaluate(`({
        race: document.documentElement.dataset.race || null,
        stored: localStorage.getItem('ui-kit.appearance'),
      })`);
      assert(
        dark.stored === null || dark.stored === 'system',
        `localStorage['ui-kit.appearance'] = ${JSON.stringify(dark.stored)}, ждали отсутствие или "system"`,
      );
      assert(
        dark.race === 'dark',
        `при системной тёмной теме data-race = ${JSON.stringify(dark.race)}, ждали "dark"`,
      );

      await setSystemTheme(s, 'light');
      await reload(s);
      const light = await s.evaluate(`({
        race: document.documentElement.dataset.race || null,
        stored: localStorage.getItem('ui-kit.appearance'),
      })`);
      assert(
        light.race === 'light',
        `при системной светлой теме data-race = ${JSON.stringify(light.race)}, ждали "light"`,
      );
      return `storage: ${dark.stored ?? 'нет'}; dark → ${dark.race}, light → ${light.race}`;
    });

    // 2. Ручной выбор пишет и localStorage, и data-race; «Авто» снова слушает систему.
    await check('ручной выбор: applyMode пишет localStorage и data-race', async () => {
      const manual = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        m.applyMode('dark');
        await __th.frames();
        const dark = __th.state();
        m.applyMode('light');
        await __th.frames();
        const light = __th.state();
        return { dark: dark, light: light, modes: m.MODES || null };
      })()`);
      assert(manual.dark.race === 'dark', `applyMode('dark') дал data-race = ${JSON.stringify(manual.dark.race)}`);
      assert(manual.dark.stored === 'dark', `applyMode('dark') дал localStorage = ${JSON.stringify(manual.dark.stored)}`);
      assert(manual.light.race === 'light', `applyMode('light') дал data-race = ${JSON.stringify(manual.light.race)}`);
      assert(manual.light.stored === 'light', `applyMode('light') дал localStorage = ${JSON.stringify(manual.light.stored)}`);

      await setSystemTheme(s, 'dark');
      const systemDark = await s.evaluate(String.raw`(async () => { await __th.apply('system'); return __th.state(); })()`);
      assert(systemDark.race === 'dark', `при системной тёмной теме applyMode('system') дал ${JSON.stringify(systemDark.race)}`);
      assert(systemDark.stored === 'system', `applyMode('system') дал localStorage = ${JSON.stringify(systemDark.stored)}`);

      await setSystemTheme(s, 'light');
      const systemLight = await s.evaluate(String.raw`(async () => { await __th.apply('system'); return __th.state(); })()`);
      assert(systemLight.race === 'light', `при системной светлой теме applyMode('system') дал ${JSON.stringify(systemLight.race)}`);

      const modes = Array.isArray(manual.modes) ? manual.modes.join('/') : 'нет MODES';
      return `dark → ${manual.dark.race}, light → ${manual.light.race}, system → ${systemDark.race}/${systemLight.race}; MODES: ${modes}`;
    });

    // 3. reload: сохранённый выбор читается в <head>, до первой отрисовки, — при
    //    системной СВЕТЛОЙ теме страница всё равно должна встать тёмной.
    await check('перезагрузка: сохранённая тёмная тема читается до отрисовки', async () => {
      await setSystemTheme(s, 'light');
      const before = await s.evaluate(String.raw`(async () => { await __th.apply('dark'); return __th.state(); })()`);
      assert(before.race === 'dark' && before.stored === 'dark', `перед reload: ${JSON.stringify(before)}`);
      await reload(s);
      const after = await s.evaluate(`({
        race: document.documentElement.dataset.race || null,
        stored: localStorage.getItem('ui-kit.appearance'),
        body: !!document.body,
      })`);
      assert(after.stored === 'dark', `после reload localStorage = ${JSON.stringify(after.stored)}, ждали "dark"`);
      assert(
        after.race === 'dark',
        `после reload data-race = ${JSON.stringify(after.race)}, ждали "dark" (системная тема светлая — значит сохранённый выбор не прочитан до отрисовки)`,
      );
      // Атрибут после загрузки ещё не доказывает, что он стоял ДО первой
      // отрисовки. Контракт говорит, как это сделано: обычный (не module)
      // скрипт перед таблицами стилей. Проверяем и это.
      const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
      const headEnd = html.toLowerCase().indexOf('</head>');
      const head = html.slice(0, headEnd < 0 ? html.length : headEnd);
      const styleAt = head.search(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
      const early = [...head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .find((m) => !/\btype\s*=\s*["']?module/i.test(m[1]) && /data-race|dataset\.race/.test(m[2]));
      assert(
        styleAt > 0 && early && early.index < styleAt,
        'в index.html нет обычного <script> с data-race до первого <link rel="stylesheet"> — тёмная тема может мигнуть светлой до отрисовки',
      );
      return `light-система + сохранённый dark → data-race ${after.race}; ранний скрипт до стилей есть`;
    });

    // 4. Меню «Оформление»: последняя кнопка-меню, три пункта, aria-pressed.
    await check('меню «Оформление»: три пункта, aria-pressed и «Авто»', async () => {
      await setSystemTheme(s, 'dark');
      const menu = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        m.applyMode('light');
        await __th.frames();
        const btn = () => document.querySelector('#toolbar .menu > button[aria-label="Оформление"]');
        const menuButtons = [...document.querySelectorAll('#toolbar .menu > button')];
        const last = menuButtons.length ? menuButtons[menuButtons.length - 1].getAttribute('aria-label') : null;
        if (!btn()) return { fail: 'в тулбаре нет кнопки #toolbar .menu > button[aria-label="Оформление"]', last: last };
        const pop = () => btn().parentElement.querySelector('.menu-pop');
        const open = () => { if (!pop()) btn().click(); return pop(); };
        const pressed = (label) => {
          const p = open();
          const item = p && p.querySelector('button[aria-label="' + label + '"]');
          return item ? item.getAttribute('aria-pressed') : null;
        };
        let p = open();
        if (!p) return { fail: 'меню «Оформление» не открылось кликом', last: last };
        const labels = [...p.querySelectorAll('button')]
          .map((b) => b.getAttribute('aria-label') || '')
          .filter((l) => l.indexOf('Оформление:') === 0);
        const darkItem = p.querySelector('button[aria-label="Оформление: Тёмная"]');
        if (!darkItem) return { fail: 'в меню нет пункта «Оформление: Тёмная»', labels: labels, last: last };
        darkItem.click();
        await __th.frames();
        const afterDark = __th.state();
        const darkPressed = pressed('Оформление: Тёмная');
        const autoPressedAfterDark = pressed('Оформление: Авто');
        const autoItem = pop() && pop().querySelector('button[aria-label="Оформление: Авто"]');
        if (!autoItem) return { fail: 'в меню нет пункта «Оформление: Авто»', labels: labels, last: last, afterDark: afterDark };
        autoItem.click();
        await __th.frames();
        const afterAuto = __th.state();
        const autoPressed = pressed('Оформление: Авто');
        const darkPressedAfterAuto = pressed('Оформление: Тёмная');
        if (pop()) btn().click();
        return {
          labels: labels, last: last, afterDark: afterDark, afterAuto: afterAuto,
          darkPressed: darkPressed, autoPressedAfterDark: autoPressedAfterDark,
          autoPressed: autoPressed, darkPressedAfterAuto: darkPressedAfterAuto,
        };
      })()`);
      assert(!menu.fail, menu.fail || 'меню «Оформление» сломано');
      assert(menu.last === 'Оформление', `последняя кнопка-меню — ${JSON.stringify(menu.last)}, ждали "Оформление"`);
      const wanted = ['Оформление: Авто', 'Оформление: Светлая', 'Оформление: Тёмная'];
      const missing = wanted.filter((w) => !menu.labels.includes(w));
      assert(missing.length === 0, `в меню нет пунктов: ${missing.join(', ')} (есть: ${menu.labels.join(', ')})`);
      assert(menu.labels.length === 3, `пунктов «Оформление: …» — ${menu.labels.length}, ждали 3`);
      assert(menu.afterDark.race === 'dark', `клик «Тёмная» дал data-race = ${JSON.stringify(menu.afterDark.race)}`);
      assert(menu.afterDark.stored === 'dark', `клик «Тёмная» дал localStorage = ${JSON.stringify(menu.afterDark.stored)}`);
      assert(menu.darkPressed === 'true', `у «Тёмная» aria-pressed = ${JSON.stringify(menu.darkPressed)}, ждали "true"`);
      assert(menu.afterAuto.race === 'dark', `после «Авто» при системной тёмной теме data-race = ${JSON.stringify(menu.afterAuto.race)}`);
      assert(menu.afterAuto.stored === 'system', `после «Авто» localStorage = ${JSON.stringify(menu.afterAuto.stored)}, ждали "system"`);
      assert(menu.autoPressed === 'true', `у «Авто» aria-pressed = ${JSON.stringify(menu.autoPressed)}, ждали "true"`);
      return `пункты: ${menu.labels.join(' / ')}; Тёмная → ${menu.afterDark.race}, Авто → ${menu.afterAuto.race}`;
    });

    // 5. Тёмная тема тёмная: панели, статусбар, лист и чернила.
    await check('тёмная тема: панели тёмные, лист не белый, чернила светлые', async () => {
      const tones = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        const snap = () => {
          const out = { bars: {}, body: null, sheet: null, sheetInk: null };
          for (const sel of ['#toolbar', '#left', '#right', '#statusbar']) {
            const el = document.querySelector(sel);
            const c = el ? __th.bgOf(el) : null;
            out.bars[sel] = { found: !!el, css: __th.css(c), lum: __th.lumOf(c), rgba: c };
          }
          const bodyColor = __th.parse(getComputedStyle(document.body).color);
          out.body = { css: __th.css(bodyColor), lum: __th.lumOf(bodyColor), rgba: bodyColor };
          out.sheet = __th.resolved('--sheet');
          out.sheetInk = __th.resolved('--sheet-ink');
          return out;
        };
        m.applyMode('dark');
        await __th.frames();
        const dark = snap();
        m.applyMode('light');
        await __th.frames();
        const light = snap();
        return { dark: dark, light: light };
      })()`);

      for (const [sel, c] of Object.entries(tones.dark.bars)) {
        assert(c.found, `в тёмной теме нет узла ${sel}`);
        assert(c.lum != null, `не удалось прочитать фон ${sel} (${c.css})`);
        assert(c.lum < 0.2, `${sel} в тёмной теме: ${c.css}, относительная яркость ${c.lum.toFixed(3)} — ждали < 0.2`);
      }
      assert(tones.dark.body.lum != null, `не удалось прочитать цвет текста body (${tones.dark.body.css})`);
      assert(tones.dark.body.lum > 0.5, `цвет текста body в тёмной теме: ${tones.dark.body.css}, яркость ${tones.dark.body.lum.toFixed(3)} — ждали > 0.5`);

      const darkSheet = tones.dark.sheet.rgba;
      assert(tones.dark.sheet.raw, 'в тёмной теме не задан токен --sheet');
      assert(darkSheet, `--sheet в тёмной теме не разобран: ${JSON.stringify(tones.dark.sheet.raw)}`);
      const white = darkSheet.r === 255 && darkSheet.g === 255 && darkSheet.b === 255;
      assert(!white, `--sheet в тёмной теме = ${tones.dark.sheet.css} (белый)`);
      assert(
        tones.dark.sheet.lum < 0.5,
        `--sheet в тёмной теме = ${tones.dark.sheet.css}, яркость ${tones.dark.sheet.lum.toFixed(3)} — лист должен быть тёмным (ждали < 0.5)`,
      );
      assert(tones.dark.sheetInk.rgba, `--sheet-ink в тёмной теме не разобран: ${JSON.stringify(tones.dark.sheetInk.raw)}`);
      assert(tones.dark.sheetInk.lum > 0.5, `--sheet-ink в тёмной теме = ${tones.dark.sheetInk.css}, яркость ${tones.dark.sheetInk.lum.toFixed(3)} — ждали светлый (> 0.5)`);

      const lightSheet = tones.light.sheet.rgba;
      assert(lightSheet, `--sheet в светлой теме не разобран: ${JSON.stringify(tones.light.sheet.raw)}`);
      assert(
        lightSheet.r === 255 && lightSheet.g === 255 && lightSheet.b === 255,
        `--sheet в светлой теме = ${tones.light.sheet.css}, ждали rgb(255, 255, 255)`,
      );
      return `dark: toolbar/left/right/statusbar < 0.2, body ${tones.dark.body.css}; sheet ${tones.dark.sheet.css}, sheet-ink ${tones.dark.sheetInk.css}; light sheet ${tones.light.sheet.css}`;
    });

    // 6. WCAG 2.1 AA: 2 темы × 6 акцентов × 7 порогов.
    await check('контраст WCAG: шесть акцентов в обеих темах', async () => {
      const audit = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        const brands = ['flame', 'moss', 'teal', 'violet', 'plum', 'graphite'];
        const races = ['light', 'dark'];
        const names = ['--surface-paper', '--surface-panel', '--ink', '--ink-soft', '--ink-faint',
          '--accent', '--border-control', '--on-strong', '--brand-strong'];
        const pairs = [
          ['ink/paper', '--ink', '--surface-paper', 4.5],
          ['ink-soft/paper', '--ink-soft', '--surface-paper', 4.5],
          ['ink-faint/paper', '--ink-faint', '--surface-paper', 4.5],
          ['accent/paper', '--accent', '--surface-paper', 4.5],
          ['accent/panel', '--accent', '--surface-panel', 4.5],
          ['border-control/paper', '--border-control', '--surface-paper', 3],
          ['on-strong/brand-strong', '--on-strong', '--brand-strong', 4.5],
        ];
        const bad = [];
        let worst = { ratio: Infinity, label: '' };
        let combos = 0;
        let total = 0;
        for (const race of races) {
          m.applyMode(race);
          await __th.frames();
          for (const brand of brands) {
            await __th.brand(brand);
            const tokens = {};
            for (const name of names) tokens[name] = __th.resolved(name);
            combos += 1;
            for (const pair of pairs) {
              total += 1;
              const ratio = __th.contrast(tokens[pair[1]].rgba, tokens[pair[2]].rgba);
              const label = race + '/' + brand + ' ' + pair[0];
              if (!(ratio >= pair[3])) {
                bad.push(label + ' = ' + (Number.isFinite(ratio) ? ratio.toFixed(2) : 'нет цвета') + ' < ' + pair[3]);
              }
              if (Number.isFinite(ratio) && ratio < worst.ratio) worst = { ratio: ratio, label: label };
            }
          }
        }
        await __th.brand('flame');
        m.applyMode('light');
        await __th.frames();
        return { bad: bad, combos: combos, total: total, worst: worst };
      })()`);
      assert(audit.combos === 12, `сочетаний темы и акцента — ${audit.combos}, ждали 12`);
      assert(audit.total === 84, `порогов проверено — ${audit.total}, ждали 84`);
      if (audit.bad.length) {
        const shown = audit.bad.slice(0, 6).join('; ');
        const more = audit.bad.length > 6 ? `; ещё ${audit.bad.length - 6}` : '';
        throw new Error(`контраст ниже порога: ${shown}${more}`);
      }
      const worst = Number.isFinite(audit.worst.ratio)
        ? `${audit.worst.label} = ${audit.worst.ratio.toFixed(2)}`
        : '—';
      return `12 сочетаний × 7 порогов; худший: ${worst}`;
    });

    // 7. Акцент меняет поверхности тёмной темы, и они остаются тёмными.
    await check('акцент меняет тёмные поверхности (flame ≠ teal)', async () => {
      const accents = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        m.applyMode('dark');
        await __th.frames();
        await __th.brand('flame');
        const flame = {
          panel: __th.resolved('--surface-panel'),
          paper: __th.resolved('--surface-paper'),
          attr: document.documentElement.dataset.brand || null,
        };
        await __th.brand('teal');
        const teal = {
          panel: __th.resolved('--surface-panel'),
          paper: __th.resolved('--surface-paper'),
          attr: document.documentElement.dataset.brand || null,
        };
        await __th.brand('flame');
        return { flame: flame, teal: teal };
      })()`);

      assert(accents.flame.panel.rgba && accents.teal.panel.rgba,
        'не удалось прочитать --surface-panel в тёмной теме');
      assert(accents.flame.paper.rgba && accents.teal.paper.rgba,
        'не удалось прочитать --surface-paper в тёмной теме');
      assert(
        accents.flame.panel.css !== accents.teal.panel.css,
        `--surface-panel в тёмной теме одинаков при flame и teal: ${accents.flame.panel.css}`,
      );
      assert(
        accents.flame.paper.css !== accents.teal.paper.css,
        `--surface-paper в тёмной теме одинаков при flame и teal: ${accents.flame.paper.css}`,
      );
      assert(accents.flame.panel.lum < 0.2,
        `--surface-panel (flame) = ${accents.flame.panel.css}, яркость ${accents.flame.panel.lum.toFixed(3)} — ждали < 0.2`);
      assert(accents.teal.panel.lum < 0.2,
        `--surface-panel (teal) = ${accents.teal.panel.css}, яркость ${accents.teal.panel.lum.toFixed(3)} — ждали < 0.2`);
      assert(accents.flame.paper.lum < 0.2,
        `--surface-paper (flame) = ${accents.flame.paper.css}, яркость ${accents.flame.paper.lum.toFixed(3)} — ждали < 0.2`);
      assert(accents.teal.paper.lum < 0.2,
        `--surface-paper (teal) = ${accents.teal.paper.css}, яркость ${accents.teal.paper.lum.toFixed(3)} — ждали < 0.2`);
      return `panel: flame ${accents.flame.panel.css} ≠ teal ${accents.teal.panel.css}; paper: flame ${accents.flame.paper.css} ≠ teal ${accents.teal.paper.css}`;
    });

    // 8. В тёмной теме не осталось светлых полос: шапка, панели, меню, статусбар.
    await check('в тёмной теме не осталось светлых поверхностей', async () => {
      const surfaces = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        m.applyMode('dark');
        await __th.frames();
        const fileBtn = document.querySelector('#toolbar .menu > button[aria-label="Файл"]');
        if (!fileBtn) return { fail: 'в тулбаре нет кнопки #toolbar .menu > button[aria-label="Файл"]' };
        if (!fileBtn.parentElement.querySelector('.menu-pop')) fileBtn.click();
        await __th.frames();
        const pop = fileBtn.parentElement.querySelector('.menu-pop');
        if (!pop) return { fail: 'меню «Файл» не открылось кликом' };
        const nodes = [
          ['#toolbar', document.querySelector('#toolbar')],
          ['.panel-head', document.querySelector('.panel-head')],
          ['.panel-tabs', document.querySelector('.panel-tabs')],
          ['.menu-pop', pop],
          ['#statusbar', document.querySelector('#statusbar')],
        ];
        const rows = [];
        for (const pair of nodes) {
          const el = pair[1];
          if (!el) { rows.push({ name: pair[0], missing: true }); continue; }
          const c = __th.bgOf(el);
          rows.push({ name: pair[0], missing: false, css: __th.css(c), lum: __th.lumOf(c) });
        }
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
        }));
        await __th.frames();
        const closed = !fileBtn.parentElement.querySelector('.menu-pop');
        if (!closed) fileBtn.click();
        return {
          rows: rows,
          closed: closed,
          panels: !!document.querySelector('.panel-tabs') || !!document.querySelector('.panel-head'),
          found: rows.filter((r) => !r.missing).length,
        };
      })()`);
      assert(!surfaces.fail, surfaces.fail || 'не удалось измерить поверхности');
      assert(surfaces.panels, 'нет ни .panel-tabs, ни .panel-head — проверять нечего');
      assert(surfaces.found >= 3, `найдено ${surfaces.found} узлов из 5`);
      for (const row of surfaces.rows) {
        if (row.missing) continue;
        assert(row.lum != null, `не удалось прочитать фон ${row.name} (${row.css})`);
        assert(row.lum < 0.25, `${row.name} в тёмной теме: ${row.css}, яркость ${row.lum.toFixed(3)} — ждали < 0.25`);
      }
      const measured = surfaces.rows.filter((r) => !r.missing)
        .map((r) => `${r.name} ${r.lum.toFixed(3)}`).join(', ');
      return `${measured}; Escape ${surfaces.closed ? 'закрыл' : 'не закрыл'} меню`;
    });

    // 9. Лист и решётка: холст, бумага фигур, подписи и сетка.
    await check('лист и решётка: тёмный холст, светлые подписи, белая бумага в светлой', async () => {
      const canvas = await s.evaluate(String.raw`(async () => {
        const m = await __th.appearance();
        const snap = () => {
          const wrap = document.querySelector('#canvas-wrap');
          const shape = document.querySelector('#canvas .sh-body');
          const grid = document.querySelector('#canvas .grid-line');
          const texts = [...document.querySelectorAll('#canvas text')];
          const wrapBg = wrap ? __th.bgOf(wrap) : null;
          const gridStroke = grid ? getComputedStyle(grid).stroke : null;
          const gridRgba = gridStroke ? __th.parse(gridStroke) : null;
          const fills = texts.map((t) => __th.fillOf(t));
          return {
            wrapFound: !!wrap,
            wrap: wrapBg ? { css: __th.css(wrapBg), rgba: wrapBg, lum: __th.lumOf(wrapBg) } : null,
            shapeFound: !!shape,
            shape: shape ? __th.fillOf(shape) : null,
            gridFound: !!grid,
            grid: grid ? { css: gridStroke, rgba: gridRgba, lum: __th.lumOf(gridRgba) } : null,
            textCount: fills.length,
            textFills: fills,
          };
        };
        m.applyMode('dark');
        await __th.frames();
        const dark = snap();
        m.applyMode('light');
        await __th.frames();
        const light = snap();
        return { dark: dark, light: light };
      })()`);

      // Одна проверка на весь лист: собираем расхождения, а не обрываемся на
      // первом, — иначе одна сломанная поверхность скрывает остальные.
      const problems = [];
      const notes = [];
      const note = (msg) => { if (problems.length < 8) problems.push(msg); };

      if (!canvas.dark.wrapFound) {
        note('в тёмной теме нет #canvas-wrap');
      } else if (!canvas.dark.wrap || !canvas.dark.wrap.rgba || canvas.dark.wrap.lum == null) {
        note('не удалось прочитать background-color #canvas-wrap в тёмной теме');
      } else if (!(canvas.dark.wrap.lum < 0.2)) {
        note(`фон #canvas-wrap в тёмной теме: ${canvas.dark.wrap.css}, яркость ${canvas.dark.wrap.lum.toFixed(3)} — ждали < 0.2`);
      }

      if (!canvas.dark.shapeFound) {
        note('в тёмной теме нет #canvas .sh-body');
      } else if (!canvas.dark.shape || !canvas.dark.shape.rgba || canvas.dark.shape.lum == null) {
        note('не удалось прочитать fill #canvas .sh-body в тёмной теме');
      } else {
        if (!(canvas.dark.shape.lum < 0.2)) {
          note(`бумага #canvas .sh-body в тёмной теме: ${canvas.dark.shape.css}, яркость ${canvas.dark.shape.lum.toFixed(3)} — ждали < 0.2`);
        }
        if (canvas.dark.wrap && canvas.dark.wrap.lum != null && !(canvas.dark.shape.lum > canvas.dark.wrap.lum)) {
          note(`бумага #canvas .sh-body (${canvas.dark.shape.css}) не светлее холста (${canvas.dark.wrap.css})`);
        }
      }

      if (canvas.dark.textCount === 0) {
        note('в тёмной теме на листе нет ни одного #canvas text');
      } else {
        canvas.dark.textFills.forEach((f, i) => {
          if (!f.rgba || f.lum == null) note(`подпись #${i} в тёмной теме: fill ${JSON.stringify(f.css)} не разобран`);
          else if (!(f.lum > 0.5)) note(`подпись #${i} в тёмной теме: fill ${f.css}, яркость ${f.lum.toFixed(3)} — ждали светлый (> 0.5)`);
        });
      }

      if (!canvas.dark.gridFound) {
        notes.push('решётка не нарисована (нет #canvas .grid-line)');
      } else if (!canvas.dark.grid || !canvas.dark.grid.rgba || canvas.dark.grid.lum == null) {
        note('не удалось прочитать stroke #canvas .grid-line в тёмной теме');
      } else if (!(canvas.dark.grid.lum < 0.3)) {
        note(`решётка в тёмной теме: ${canvas.dark.grid.css}, яркость ${canvas.dark.grid.lum.toFixed(3)} — ждали < 0.3`);
      }

      if (!canvas.light.shapeFound) {
        note('в светлой теме нет #canvas .sh-body');
      } else if (!canvas.light.shape || !canvas.light.shape.rgba) {
        note('не удалось прочитать fill #canvas .sh-body в светлой теме');
      } else {
        const c = canvas.light.shape.rgba;
        if (!(c.r === 255 && c.g === 255 && c.b === 255)) {
          note(`бумага #canvas .sh-body в светлой теме = ${canvas.light.shape.css}, ждали белый`);
        }
      }

      if (canvas.light.textCount === 0) {
        note('в светлой теме на листе нет ни одного #canvas text');
      } else {
        canvas.light.textFills.forEach((f, i) => {
          if (!f.rgba || f.lum == null) note(`подпись #${i} в светлой теме: fill ${JSON.stringify(f.css)} не разобран`);
          else if (!(f.lum < 0.05)) note(`подпись #${i} в светлой теме: fill ${f.css}, яркость ${f.lum.toFixed(3)} — ждали чёрный (< 0.05)`);
        });
      }

      if (!canvas.light.gridFound) {
        notes.push('решётка не нарисована (нет #canvas .grid-line)');
      } else if (!canvas.light.grid || !canvas.light.grid.rgba || canvas.light.grid.lum == null) {
        note('не удалось прочитать stroke #canvas .grid-line в светлой теме');
      } else if (!(canvas.light.grid.lum > 0.4)) {
        note(`решётка в светлой теме: ${canvas.light.grid.css}, яркость ${canvas.light.grid.lum.toFixed(3)} — ждали > 0.4`);
      }

      if (problems.length) throw new Error(problems.concat(notes).join('; '));
      const darkWrapCss = canvas.dark.wrap ? canvas.dark.wrap.css : 'нет';
      const darkShapeCss = canvas.dark.shape ? canvas.dark.shape.css : 'нет';
      const lightShapeCss = canvas.light.shape ? canvas.light.shape.css : 'нет';
      const gridTail = notes.length ? `; ${notes.join('; ')}` : '';
      return `dark: холст ${darkWrapCss}, бумага ${darkShapeCss}, подписей ${canvas.dark.textCount} (светлые); light: бумага ${lightShapeCss}, подписи чёрные${gridTail}`;
    });

    // 10. Тёмная тема экрана не протекает в файл: экспорт всегда белый на чёрном.
    await check('экспорт SVG не зависит от темы: белый фон и чёрные линии', async () => {
      const exported = await s.evaluate(String.raw`(async () => {
        await __th.apply('dark');
        let render;
        try {
          render = await import('/src/ui/render.js');
        } catch (e) {
          throw new Error('нет модуля src/ui/render.js: ' + (e && e.message ? e.message : e));
        }
        if (typeof render.exportSvgString !== 'function') {
          throw new Error('src/ui/render.js не экспортирует exportSvgString');
        }
        const store = window.__uml && window.__uml.store;
        if (!store) throw new Error('нет window.__uml.store');
        const svg = render.exportSvgString(store.model, store.profile);
        return {
          race: document.documentElement.dataset.race || null,
          length: svg.length,
          fillLong: /fill="#ffffff"/i.test(svg),
          fillShort: /fill="#fff"/i.test(svg),
          // Чернила листа в файле — это CSS внутри <style> (stroke:#000000), а
          // не атрибут: атрибутами красятся только подложка и наконечники.
          stroke: /stroke:#000000/i.test(svg) || /var\(--conn-ink,\s*#000000\)/i.test(svg),
          // Ни одного цвета тёмной темы в файле: лист #1f1d1e, бумага фигур,
          // светлые чернила — если хоть один протёк, экспорт не тот.
          leaked: /#1f1d1e|#ecebe9|#171719/i.test(svg),
          head: svg.slice(0, 160),
        };
      })()`);
      assert(exported.race === 'dark', `экспорт снимали при data-race = ${JSON.stringify(exported.race)}, ждали "dark"`);
      assert(exported.length > 100, `exportSvgString вернул ${exported.length} байт — это не SVG`);
      assert(exported.fillLong || exported.fillShort, `в экспорте нет белой подложки (fill="#ffffff" / "#fff"); начало: ${exported.head}`);
      assert(exported.stroke, `в экспорте нет чёрных линий (stroke:#000000); начало: ${exported.head}`);
      assert(!exported.leaked, `в экспорт протекли цвета тёмной темы (#1f1d1e / #ecebe9); начало: ${exported.head}`);
      return `${exported.length} байт; fill=${exported.fillLong ? '#ffffff' : '#fff'}, stroke=#000000`;
    });
  } finally {
    if (launched) {
      try { launched.child.kill('SIGKILL'); } catch { /* уже закрыт */ }
      try { await rm(launched.profile, { recursive: true, force: true }); } catch { /* профиль не наш */ }
    }
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
  if (failed.length) {
    console.log('упали:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('theme: ', e.message);
  process.exit(1);
});