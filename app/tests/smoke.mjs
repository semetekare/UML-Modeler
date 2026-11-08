// Самопроверка редактора: поднимает локальный сервер, открывает страницу в
// headless-Chromium через CDP (встроенный WebSocket Node, без зависимостей),
// проходит по инструментам и проверяет результат. Сервер и браузер живут
// только внутри этого процесса — запуск завершается сам.
//
//   node tests/smoke.mjs            прогнать всё
//   node tests/smoke.mjs --verbose  печатать каждый шаг
//
// Код возврата 0 — все проверки прошли; 1 — есть падения (они перечислены).

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inkRatio, INK_MIN } from './png.mjs';

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

  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1, ...extra,
    });
  }

  async click(x, y, { count = 1 } = {}) {
    await this.mouse('mouseMoved', x, y, { buttons: 0 });
    await this.mouse('mousePressed', x, y, { clickCount: count });
    await this.mouse('mouseReleased', x, y, { clickCount: count, buttons: 0 });
    await sleep(60);
  }

  async drag(x1, y1, x2, y2, steps = 8) {
    await this.mouse('mouseMoved', x1, y1, { buttons: 0 });
    await this.mouse('mousePressed', x1, y1);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.mouse('mouseMoved', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      await sleep(16);
    }
    await this.mouse('mouseReleased', x2, y2, { buttons: 0 });
    await sleep(80);
  }

  async key(key, { ctrl = false, shift = false } = {}) {
    const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = /^[a-zA-Z]$/.test(key) ? `Key${key.toUpperCase()}`
      : ({ Enter: 'Enter', Escape: 'Escape', Delete: 'Delete', Backspace: 'Backspace' }[key] ?? key);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined, modifiers,
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    await sleep(60);
  }

  errors() {
    const out = [];
    for (const e of this.events) {
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        out.push(`${e.params.entry.text} ${e.params.entry.url ?? ''}`.trim());
      }
      if (e.method === 'Runtime.exceptionThrown') {
        out.push(e.params.exceptionDetails.exception?.description?.slice(0, 200)
          ?? e.params.exceptionDetails.text);
      }
    }
    return out;
  }
}

async function launch(url) {
  const bin = chromeCandidates()[0];
  if (!bin) throw new Error('headless Chrome not found');
  const profile = await mkdtemp(path.join(tmpdir(), 'uml-smoke-'));
  const port = 9300 + Math.floor(Math.random() * 500);
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
  await session.send('Log.enable');
  await session.send('Network.enable');
  await session.send('Page.enable');
  return { child, profile, session };
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
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/?model=sample`;
  const { child, profile, session } = await launch(base);
  const s = session;

  try {
    // Страница и профиль: приложение стартует само, без сети.
    for (let i = 0; i < 50; i++) {
      const ready = await s.evaluate("!!document.querySelector('#canvas .sh')");
      if (ready) break;
      await sleep(200);
    }

    // Эталон для проверки снимка (Э0): тот же стартовый кадр, снятый через
    // CDP. Берём его до правок — дальше тест меняет модель.
    const cdpShot = Buffer.from(
      (await s.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64',
    );

    await check('стартует и рисует пример', async () => {
      const info = await s.evaluate(`(() => {
        const shapes = document.querySelectorAll('#sheetlayer [data-kind="shape"]').length;
        const conns = document.querySelectorAll('#sheetlayer [data-kind="conn"]').length;
        return { shapes, conns, status: document.querySelector('#statusbar').textContent.replace(/\\s+/g, ' ') };
      })()`);
      assert(info.shapes === 7, `фигур ${info.shapes}, ждали 7`);
      assert(info.conns === 4, `связей ${info.conns}, ждали 4`);
      return info.status.slice(0, 90);
    });

    // Коробка подписи — lines × 14 и ничего больше (MECHANICS §30): у класса
    // со стереотипом она ровно вдвое выше, чем у класса без него, а в
    // координатах листа — 14 px на строку. Атрибуты SVG уже в координатах
    // листа (масштаб живёт в transform), поэтому зум здесь не участвует.
    await check('подпись: 14 px на строку, стереотип добавляет строку', async () => {
      const info = await s.evaluate(`(() => {
        const rows = [];
        for (const g of document.querySelectorAll('#sheetlayer [data-kind="shape"]')) {
          const body = g.querySelector('.sh-body');
          const lines = [...g.querySelectorAll('line')];
          if (!body || !lines.length) continue;
          const top = +body.getAttribute('y');
          const first = Math.min(...lines.map((l) => +l.getAttribute('y1')));
          rows.push({ plate: Math.round(first - top), stereo: !!g.querySelector('.sh-stereo') });
        }
        return { rows, scale: 1 };
      })()`);
      const plain = info.rows.filter((r) => !r.stereo);
      const stereo = info.rows.filter((r) => r.stereo);
      assert(plain.length && stereo.length, `классов со стереотипом ${stereo.length}, без ${plain.length}`);
      assert(plain.every((r) => r.plate === 14), `без стереотипа: ${plain.map((r) => r.plate).join(',')}, ждали 14`);
      assert(stereo.every((r) => r.plate === 28), `со стереотипом: ${stereo.map((r) => r.plate).join(',')}, ждали 28`);
      return `14 × ${plain.length}, 28 × ${stereo.length}`;
    });

    // Профиль в приложении — канонический: 304 стереотипа вместо 428 записей
    // выгрузки профиля (одно имя на нескольких baseType — один пункт списка).
    await check('профиль: 304 стереотипа, по одному на имя', async () => {
      const info = await s.evaluate(`(async () => {
        document.querySelectorAll('#right .tab')[1].click();
        await new Promise(r => setTimeout(r, 300));
        const rows = [...document.querySelectorAll('#profile [data-stereotype]')];
        const ids = new Set(rows.map((r) => r.dataset.stereotypeId || ''));
        document.querySelectorAll('#right .tab')[0].click();
        return { rows: rows.length, ids: ids.size };
      })()`);
      assert(info.rows === 304, `в профиле ${info.rows} строк`);
      assert(info.ids === 304, `у ${304 - info.ids} строк нет data-stereotype-id`);
      return `${info.rows} строк, ${info.ids} ссылок на записи`;
    });

    // Инструмент «Класс»: палитра ставит фигуру на лист.
    const point = await s.evaluate(`(() => {
      const r = document.querySelector('#canvas').getBoundingClientRect();
      return { x: Math.round(r.x + r.width * 0.72), y: Math.round(r.y + r.height * 0.72) };
    })()`);

    await check('полоса инструментов ставит новую фигуру', async () => {
      const clicked = await s.evaluate(`(() => {
        const b = document.querySelector('#toolstrip [data-tool="class"]');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      assert(clicked, 'в полосе инструментов нет кнопки «Класс»');
      await s.click(point.x, point.y);
      const n = await s.evaluate("document.querySelectorAll('#sheetlayer [data-kind=\"shape\"]').length");
      assert(n === 8, `после клика фигур ${n}, ждали 8`);
      return 'фигур 8';
    });

    // Новая фигура выбрана; тянем её за тело.
    await check('фигура двигается и липнет к сетке', async () => {
      const before = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]:last-of-type');
        const r = g.getBoundingClientRect();
        return { id: g.dataset.id, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 12) };
      })()`);
      await s.drag(before.x, before.y, before.x + 47, before.y + 33);
      const after = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]:last-of-type');
        const r = g.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 12) };
      })()`);
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      assert(dx > 20 && dy > 15, `сдвиг ${dx}×${dy} слишком мал`);
      return `сдвинулась на ${dx}×${dy} px`;
    });

    await check('фигура ресайзится за уголок', async () => {
      const size = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]:last-of-type');
        const r = g.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.right), y: Math.round(r.bottom) };
      })()`);
      await s.drag(size.x - 3, size.y - 3, size.x + 27, size.y + 21);
      const after = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]:last-of-type');
        const r = g.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })()`);
      assert(after.w > size.w + 10 && after.h > size.h + 8,
        `размер ${size.w}×${size.h} → ${after.w}×${after.h}`);
      return `${size.w}×${size.h} → ${after.w}×${after.h}`;
    });

    await check('двойной щелчок правит имя на фигуре', async () => {
      const at = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]:last-of-type');
        const t = g.querySelector('.sh-name');
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`);
      await s.click(at.x, at.y, { count: 2 });
      const dbg = await s.evaluate(`(async () => {
        const { store } = await import('/src/state/store.js');
        const { currentDiagram } = await import('/src/model/model.js');
        const g = [...document.querySelectorAll('#sheetlayer [data-kind="shape"]')].pop();
        const r = g.getBoundingClientRect();
        const cv = document.querySelector('#canvas').getBoundingClientRect();
        const v = store.ui.view;
        const mx = (r.x + r.width / 2 - cv.x - v.tx) / v.scale;
        const my = (r.y + 12 - cv.y - v.ty) / v.scale;
        const shapes = currentDiagram(store.model).shapes;
        const last = shapes[shapes.length - 1];
        return { tool: store.ui.tool, sel: store.ui.selection, view: v,
                 modelPoint: [Math.round(mx), Math.round(my)],
                 lastShape: last && { x: last.x, y: last.y, w: last.w, h: last.h },
                 hitId: g.dataset.id,
                 editorHidden: document.querySelector('#inline-editor').hidden };
      })()`);
      console.log('      debug dbl:', JSON.stringify(dbg), 'at', at.x, at.y);
      const open = await s.evaluate("!document.querySelector('#inline-editor').hidden");
      assert(open, 'редактор на фигуре не открылся');
      await s.evaluate(`(() => {
        const i = document.querySelector('#inline-editor input');
        i.value = 'ТестовыйКласс';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await s.key('Enter');
      const name = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]:last-of-type');
        return g.querySelector('.sh-name')?.textContent;
      })()`);
      assert(name === 'ТестовыйКласс', `имя на фигуре «${name}»`);
      return 'имя «ТестовыйКласс»';
    });

    await check('связь ставится кликом по двум фигурам', async () => {
      // Two shapes that are provably different and far apart: after the drag
      // and resize above, the newest shape can sit on top of an older one,
      // and clicking the same shape twice is rightly not a connection.
      const pair = await s.evaluate(`(() => {
        const gs = [...document.querySelectorAll('#sheetlayer [data-kind="shape"]')];
        const cs = gs.map((g) => {
          const r = g.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        let best = null;
        for (let i = 0; i < cs.length; i += 1) {
          for (let j = i + 1; j < cs.length; j += 1) {
            const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
            if (!best || d > best.d) best = { a: cs[i], b: cs[j], d };
          }
        }
        return best;
      })()`);
      assert(pair && pair.d > 120, `не нашлось двух далёких фигур: ${JSON.stringify(pair)}`);
      await s.evaluate(`document.querySelector('#toolstrip [data-tool="association"]').click()`);
      const a = pair.a;
      await s.click(a.x, a.y);
      const b = pair.b;
      await s.click(b.x, b.y);
      const n = await s.evaluate("document.querySelectorAll('#sheetlayer [data-kind=\"conn\"]').length");
      assert(n === 5, `связей ${n}, ждали 5`);
      return 'связей 5';
    });

    await check('отмена убирает последнюю связь', async () => {
      await s.key('z', { ctrl: true });
      await sleep(150);
      const n = await s.evaluate("document.querySelectorAll('#sheetlayer [data-kind=\"conn\"]').length");
      assert(n === 4, `после отмены связей ${n}, ждали 4`);
      return 'связей 4';
    });

    await check('стереотипы в списке у элемента', async () => {
      const info = await s.evaluate(`(() => {
        const g = document.querySelector('#sheetlayer [data-kind="shape"]');
        const r = g.getBoundingClientRect();
        return { x: Math.round(r.x + 20), y: Math.round(r.y + 10) };
      })()`);
      await s.click(info.x, info.y);
      const dbg2 = await s.evaluate(`(async () => {
        const { store } = await import('/src/state/store.js');
        return { tool: store.ui.tool, sel: store.ui.selection,
                 propsHead: document.querySelector('#props').textContent.slice(0, 40) };
      })()`);
      console.log('      debug picker:', JSON.stringify(dbg2), 'at', info.x, info.y);
      const n = await s.evaluate(`(() => {
        const sel = document.querySelector('#props select');
        return sel ? sel.options.length : -1;
      })()`);
      assert(n >= 305, `в списке ${n} вариантов`);
      return `${n} вариантов`;
    });

    // (д) Выбор в инспекторе работает по записи профиля: значение пункта —
    // stereotypeId, подпись — каноническое имя, а в модель пишутся оба поля.
    // Имя остаётся тем, что рисуется на листе, ссылка — тем, что говорит,
    // какая именно запись имелась в виду.
    await check('выбор стереотипа пишет имя и stereotypeId', async () => {
      const picked = await s.evaluate(`(async () => {
        const sel = document.querySelector('#props select[aria-label="Стереотип"]');
        if (!sel) return { error: 'нет списка' };
        const value = [...sel.options].find((o) => o.value === 'st-usecase')?.value ?? null;
        sel.value = 'st-usecase';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const { store } = await import('/src/state/store.js');
        const el = store.model.elements.find((e) => e.stereotypeId === 'st-usecase');
        // Перерисовка панели откладывается, пока фокус в списке: снимаем
        // фокус и просим перерисовать, чтобы увидеть, что список сам
        // показывает выбранную запись.
        document.activeElement?.blur();
        const { set } = await import('/src/state/store.js');
        set({ hint: '' });
        await new Promise((r) => setTimeout(r, 250));
        const again = document.querySelector('#props select[aria-label="Стереотип"]');
        const chosen = again ? [...again.options].filter((o) => o.selected).map((o) => o.value) : [];
        return {
          optionId: value,
          name: el?.stereotype ?? null,
          id: el?.stereotypeId ?? null,
          shown: chosen,
        };
      })()`);
      assert(!picked.error, picked.error);
      assert(picked.optionId === 'st-usecase', 'пункт списка не ссылается на запись профиля');
      assert(picked.name === 'usecase' && picked.id === 'st-usecase',
        `в модели «${picked.name}» / ${picked.id}`);
      assert(picked.shown.includes('st-usecase'),
        `после перерисовки выбран ${JSON.stringify(picked.shown)}`);
      // Отменяем выбор: следующие проверки смотрят на ту же фигуру.
      await s.key('z', { ctrl: true });
      await sleep(150);
      const gone = await s.evaluate(`(async () => {
        const { store } = await import('/src/state/store.js');
        return !store.model.elements.some((e) => e.stereotypeId === 'st-usecase');
      })()`);
      assert(gone, 'отмена не сняла выбор');
      return `пункт ${picked.optionId}, «${picked.name}», отмена вернула модель`;
    });

    // `connectorLabelOrientation` (§22b): the program's own default is 0 =
    // "Horizontal Only" (v/dap/r#<init>+0x0712, and every record it writes
    // stores 0), so a connector's name lies flat. The turning modes are checked
    // at the geometry level in tests/types.mjs, where a route can be built
    // without moving the sample about.
    await check('подпись связи лежит горизонтально (0 = только горизонтально)', async () => {
      const rotated = await s.evaluate(`(() => {
        const groups = [...document.querySelectorAll('#sheetlayer .conn-label-g')];
        return groups.filter(g => Math.abs(Number(g.dataset.angle || 0)) >= 45).length;
      })()`);
      assert(rotated === 0, `повёрнуто ${rotated} подписей при ориентации 0`);
      return `${rotated} повёрнутых подписей`;
    });

    await check('таблица членов правит те же поля', async () => {
      const info = await s.evaluate(`(async () => {
        const { store, set } = await import('/src/state/store.js');
        const { currentDiagram, elementOf } = await import('/src/model/model.js');
        const d = currentDiagram(store.model);
        const shape = d.shapes.find((sh) => {
          const e = elementOf(store.model, sh);
          return e && e.kind === 'class' && (e.attributes || []).length > 0;
        });
        if (!shape) return null;
        set({ selection: { kind: 'shape', id: shape.id } });
        return { shapeId: shape.id, elementId: shape.elementId };
      })()`);
      assert(info, 'на листе нет класса с атрибутами');
      await sleep(150);
      const table = await s.evaluate(`(() => {
        const inp = document.querySelector('#props .mtable input[data-col="name"]');
        return inp ? { value: inp.value, rows: document.querySelectorAll('#props .mtable tbody tr').length } : null;
      })()`);
      assert(table, 'в инспекторе нет таблицы членов');
      const edited = await s.evaluate(`(async () => {
        const typeInto = (col, value) => {
          const inp = document.querySelector('#props .mtable input[data-col="' + col + '"]');
          inp.value = value;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        };
        typeInto('name', 'код');
        typeInto('type', 'long');
        await new Promise((r) => setTimeout(r, 120));
        const { store } = await import('/src/state/store.js');
        const e = store.model.elements.find((x) => x.id === '${info.elementId}');
        return {
          row: e.attributes[0],
          sheet: [...document.querySelectorAll('#sheetlayer .sh-row')].map((t) => t.textContent),
        };
      })()`);
      assert(edited.row.name === 'код' && edited.row.type === 'long', `строка ${JSON.stringify(edited.row)}`);
      assert(edited.sheet.includes('код: long'), `на листе: ${edited.sheet.join(' | ')}`);
      return 'имя и тип записаны в элемент, лист показывает «код: long»';
    });

    // §14: заливка — @type 1 сплошная, 2 градиент; 16 направлений и
    // cyclic=true (в SVG это spreadMethod="reflect").
    await check('заливка градиентом — 16 направлений, как в оригинале', async () => {
      // Первый Runtime.evaluate после пачки input/change-событий предыдущей
      // проверки иногда возвращает undefined вместо значения промиса (сам
      // прогон выражения корректен: повтор даёт объект). Один повтор — и
      // проверка судит приложение, а не гонку CDP.
      const pickClass = `(async () => {
        const { store, set } = await import('/src/state/store.js');
        const { currentDiagram, elementOf } = await import('/src/model/model.js');
        const d = currentDiagram(store.model);
        const shape = d.shapes.find((sh) => elementOf(store.model, sh)?.kind === 'class');
        if (!shape) return null;
        set({ selection: { kind: 'shape', id: shape.id } });
        return { shapeId: shape.id };
      })()`;
      let info = await s.evaluate(pickClass);
      if (info === undefined) info = await s.evaluate(pickClass);
      assert(info, 'на листе нет класса');
      await sleep(150);
      const on = await s.evaluate(`(() => {
        const b = [...document.querySelectorAll('#props button')].find((x) => /градиент/i.test(x.textContent));
        if (!b) return null;
        b.click();
        return true;
      })()`);
      assert(on, 'в инспекторе нет переключателя градиента');
      await sleep(200);
      const first = await s.evaluate(`(() => {
        const g = document.querySelector('svg defs linearGradient');
        return {
          dirs: document.querySelectorAll('#props .grad-dir').length,
          dir: g && { x1: g.getAttribute('x1'), y1: g.getAttribute('y1'), x2: g.getAttribute('x2'), y2: g.getAttribute('y2') },
          spread: g && g.getAttribute('spreadMethod'),
          stops: g ? [...g.querySelectorAll('stop')].map((x) => x.getAttribute('stop-color')) : [],
          filled: [...document.querySelectorAll('#sheetlayer .sh-body')].some((r) => (r.style.fill || '').includes('url(')),
        };
      })()`);
      assert(first.dirs === 16, `кнопок направления ${first.dirs}, ожидалось 16`);
      assert(first.dir && first.dir.y1 === '1' && first.dir.y2 === '0', `направление по умолчанию ${JSON.stringify(first.dir)}`);
      assert(first.spread === 'reflect', `spreadMethod ${first.spread}`);
      assert(first.stops.length === 2 && first.stops[0] && first.stops[1], `остановки ${JSON.stringify(first.stops)}`);
      assert(first.filled, 'ни одна фигура не залита градиентом');
      const second = await s.evaluate(`(async () => {
        document.querySelectorAll('#props .grad-dir')[2].click();
        await new Promise((r) => setTimeout(r, 150));
        const g = document.querySelector('svg defs linearGradient');
        return { x1: g.getAttribute('x1'), y1: g.getAttribute('y1'), x2: g.getAttribute('x2'), y2: g.getAttribute('y2') };
      })()`);
      assert(second.y1 === '0.5' && second.y2 === '0', `направление 3 задано как ${JSON.stringify(second)}`);
      return `16 направлений, по умолчанию (${first.dir.x1},${first.dir.y1})→(${first.dir.x2},${first.dir.y2}) с ${first.spread}, направление 3 — (${second.x1},${second.y1})→(${second.x2},${second.y2})`;
    });

    await check('переименование класса видно на двух диаграммах', async () => {
      const first = await s.evaluate(`(async () => {
        const { store } = await import('/src/state/store.js');
        return { diagramId: store.model.currentDiagramId, firstDiagram: store.model.diagrams[0].id };
      })()`);
      await s.evaluate(`document.querySelector('#toolbar [aria-label="Создать диаграмму"]').click()`);
      await sleep(300);
      // The new-diagram dialog: Class is preselected, so accept it.
      const made = await s.evaluate(`(() => {
        const dlg = document.querySelector('sc-dialog[open]');
        if (!dlg) return false;
        const ok = [...dlg.querySelectorAll('button')].find((b) => /Создать/.test(b.textContent));
        if (!ok) return false;
        ok.click();
        return true;
      })()`);
      assert(made, 'диалог новой диаграммы не открылся');
      await sleep(250);
      const created = await s.evaluate(`(async () => {
        const { store } = await import('/src/state/store.js');
        return { diagrams: store.model.diagrams.length, current: store.model.currentDiagramId };
      })()`);
      assert(created.diagrams === 2 && created.current !== first.diagramId,
        `диаграмм ${created.diagrams}, текущая ${created.current}`);

      const placed = await s.evaluate(`(async () => {
        const { store } = await import('/src/state/store.js');
        const row = document.querySelector('#model .node:not(.diagram)');
        if (!row) return null;
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const d = store.model.diagrams.find((x) => x.id === store.model.currentDiagramId);
        return {
          shapes: d.shapes.length,
          elementId: d.shapes[0]?.elementId,
          name: store.model.elements[0].name,
        };
      })()`);
      assert(placed && placed.shapes === 1, 'элемент не поставлен на вторую диаграмму');

      const renamed = await s.evaluate(`(async () => {
        const inp = document.querySelector('#props .field input[type=text]');
        if (!inp) return null;
        inp.value = 'Переименованный';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const { store } = await import('/src/state/store.js');
        return {
          modelName: store.model.elements[0].name,
          sheet: [...document.querySelectorAll('#sheetlayer .sh-name')].map((t) => t.textContent),
        };
      })()`);
      assert(renamed && renamed.modelName === 'Переименованный', 'имя не записалось в элемент');
      assert(renamed.sheet.includes('Переименованный'), 'на второй диаграмме нет нового имени');

      const back = await s.evaluate(`(async () => {
        const sel = document.querySelector('#toolbar select.diagram-pick');
        sel.value = '${first.diagramId}';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        return { sheet: [...document.querySelectorAll('#sheetlayer .sh-name')].map((t) => t.textContent) };
      })()`);
      assert(back.sheet.includes('Переименованный'), 'на первой диаграмме имя не изменилось');
      return `«${placed.name}» → «Переименованный» на двух диаграммах`;
    });

    await check('копирование, вставка и дубликат', async () => {
      const base = await s.evaluate(`(async () => {
        if (document.activeElement) document.activeElement.blur();
        const U = window.__uml;
        const { store, set } = await import('/src/state/store.js');
        const d = U.currentDiagram(store.model);
        set({ selection: [{ kind: 'shape', id: d.shapes[0].id }] });
        // A state change repaints the whole app; without this pause the CDP
        // promise can be collected before it resolves (see the note below).
        await new Promise((r) => setTimeout(r, 80));
        return { shapes: d.shapes.length, elements: store.model.elements.length,
                 x: d.shapes[0].x, y: d.shapes[0].y };
      })()`);
      await sleep(120);
      await s.key('c', { ctrl: true });
      await s.key('v', { ctrl: true });
      await sleep(260);
      const pasted = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { store } = await import('/src/state/store.js');
        const d = U.currentDiagram(store.model);
        const sel = store.ui.selection;
        const sh = sel.length ? d.shapes.find((s) => s.id === sel[0].id) : null;
        return { shapes: d.shapes.length, elements: store.model.elements.length,
                 selected: sel.length, x: sh && sh.x, y: sh && sh.y };
      })()`);
      assert(pasted.shapes === base.shapes + 1, 'после вставки фигур ' + pasted.shapes + ', ждали ' + (base.shapes + 1));
      assert(pasted.elements === base.elements + 1, 'вставка на том же листе должна создать элемент: ' + pasted.elements);
      assert(pasted.selected === 1, 'вставленное не выделено: ' + pasted.selected);
      assert(pasted.x === base.x + 10 && pasted.y === base.y + 10,
        'сдвиг вставки ' + (pasted.x - base.x) + '×' + (pasted.y - base.y) + ', ждали 10×10');
      await s.key('d', { ctrl: true });
      await sleep(260);
      const dup = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { store } = await import('/src/state/store.js');
        return { shapes: U.currentDiagram(store.model).shapes.length, elements: store.model.elements.length };
      })()`);
      assert(dup.elements === base.elements + 2, 'Ctrl+D должен создать новый элемент: ' + dup.elements);
      assert(dup.shapes === base.shapes + 2, 'после Ctrl+D фигур ' + dup.shapes);
      // Вырезать и вставить на том же листе — вернуть ТЕ ЖЕ элементы, не копию.
      await s.key('x', { ctrl: true });
      await sleep(200);
      const cut = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { store } = await import('/src/state/store.js');
        return { shapes: U.currentDiagram(store.model).shapes.length, elements: store.model.elements.length };
      })()`);
      assert(cut.shapes === base.shapes + 1 && cut.elements === base.elements + 2,
        'после вырезания фигур ' + cut.shapes + ', элементов ' + cut.elements);
      await s.key('v', { ctrl: true });
      await sleep(260);
      const back = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { store } = await import('/src/state/store.js');
        return { shapes: U.currentDiagram(store.model).shapes.length, elements: store.model.elements.length };
      })()`);
      assert(back.shapes === cut.shapes + 1, 'после вставки фигур ' + back.shapes);
      assert(back.elements === cut.elements, 'вставка после вырезания создала элемент: ' + back.elements);
      return 'вставка +1 элемент, Ctrl+D +1 элемент, вырезание/вставка возвращает те же элементы';
    });

    await check('вставка на другую диаграмму — вид существующего элемента', async () => {
      const before = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { store, commit } = await import('/src/state/store.js');
        const elements = store.model.elements.length;
        commit('t', (m) => {
          const d = U.createDiagram('Вторая', 'class');
          m.diagrams.push(d);
          m.currentDiagramId = d.id;
        });
        U.renderCanvas();
        await new Promise((r) => setTimeout(r, 80));
        return { elements, shapes: U.currentDiagram(store.model).shapes.length };
      })()`);
      await sleep(200);
      await s.key('v', { ctrl: true });
      await sleep(260);
      const after = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { store } = await import('/src/state/store.js');
        return { elements: store.model.elements.length, shapes: U.currentDiagram(store.model).shapes.length };
      })()`);
      assert(after.elements === before.elements, 'вставка на другой лист создала элемент: ' + after.elements);
      assert(after.shapes === before.shapes + 1, 'на втором листе фигур ' + after.shapes + ', ждали ' + (before.shapes + 1));
      return 'элементов ' + after.elements + ', фигур на втором листе ' + after.shapes;
    });

    await check('лассо, Shift-клик и групповое перемещение', async () => {
      const setup = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { loadModel, commit } = await import('/src/state/store.js');
        loadModel(U.deserialize(JSON.stringify({
          schema: 'uml-model/3', name: 'Лассо', elements: [], relationships: [], diagrams: [], currentDiagramId: null,
        })));
        commit('t', (m) => {
          const d = U.createDiagram('L', 'class');
          m.diagrams.push(d);
          m.currentDiagramId = d.id;
        });
        commit('t', (m) => {
          U.placeElement(m, 'class', 100, 100);
          U.placeElement(m, 'class', 420, 100);
          U.placeElement(m, 'class', 120, 520);
        });
        U.fitToWindow();
        U.renderCanvas();
        const cv = document.querySelector('#canvas').getBoundingClientRect();
        const v = U.store.ui.view;
        const at = (x, y) => ({ x: Math.round(cv.x + v.tx + x * v.scale), y: Math.round(cv.y + v.ty + y * v.scale) });
        await new Promise((r) => setTimeout(r, 80));
        return { a: at(60, 60), b: at(650, 250), third: at(160, 560) };
      })()`);
      // Рамка-лассо по пустому месту вокруг первых двух фигур.
      await s.drag(setup.a.x, setup.a.y, setup.b.x, setup.b.y);
      const sel1 = await s.evaluate('window.__uml.store.ui.selection.length');
      assert(sel1 === 2, 'лассо выделило ' + sel1 + ' фигур, ждали 2');
      // Shift-клик добавляет третью.
      await s.mouse('mouseMoved', setup.third.x, setup.third.y, { buttons: 0 });
      await s.mouse('mousePressed', setup.third.x, setup.third.y, { modifiers: 8 });
      await s.mouse('mouseReleased', setup.third.x, setup.third.y, { modifiers: 8, buttons: 0 });
      await sleep(120);
      const sel2 = await s.evaluate('window.__uml.store.ui.selection.length');
      assert(sel2 === 3, 'после Shift-клика выделено ' + sel2 + ', ждали 3');
      // Групповое перемещение: тянем первую фигуру — едут все три.
      const before = await s.evaluate(`(async () => {
        const U = window.__uml;
        const d = U.currentDiagram(U.store.model);
        return d.shapes.map((s) => ({ id: s.id, x: s.x, y: s.y }));
      })()`);
      const grab = await s.evaluate(`(async () => {
        const U = window.__uml;
        const d = U.currentDiagram(U.store.model);
        const s0 = d.shapes[0];
        const cv = document.querySelector('#canvas').getBoundingClientRect();
        const v = U.store.ui.view;
        return { x: Math.round(cv.x + v.tx + (s0.x + 40) * v.scale), y: Math.round(cv.y + v.ty + (s0.y + 30) * v.scale) };
      })()`);
      await s.drag(grab.x, grab.y, grab.x + 50, grab.y + 30);
      const after = await s.evaluate(`(async () => {
        const U = window.__uml;
        const d = U.currentDiagram(U.store.model);
        return d.shapes.map((s) => ({ id: s.id, x: s.x, y: s.y }));
      })()`);
      const moved = after.every((s, i) => s.x > before[i].x && s.y > before[i].y);
      assert(moved, 'группа поехала не вся: ' + JSON.stringify(after));
      // Delete снимает все три вида с листа, элементы остаются.
      await s.key('Delete');
      await sleep(150);
      const gone = await s.evaluate(`(async () => {
        const U = window.__uml;
        return { shapes: U.currentDiagram(U.store.model).shapes.length, elements: U.store.model.elements.length };
      })()`);
      assert(gone.shapes === 0 && gone.elements === 3,
        'после Delete фигур ' + gone.shapes + ', элементов ' + gone.elements);
      return 'лассо 2 → Shift 3 → сдвиг группы → Delete 0 фигур, 3 элемента';
    });

    await check('выравнивание и распределение группы', async () => {
      const setup = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { loadModel, commit, set } = await import('/src/state/store.js');
        loadModel(U.deserialize(JSON.stringify({
          schema: 'uml-model/3', name: 'Ровно', elements: [], relationships: [], diagrams: [], currentDiagramId: null,
        })));
        commit('t', (m) => {
          const d = U.createDiagram('A', 'class');
          m.diagrams.push(d);
          m.currentDiagramId = d.id;
        });
        const ids = [];
        commit('t', (m) => {
          ids.push(U.placeElement(m, 'class', 100, 100).shape.id);
          ids.push(U.placeElement(m, 'class', 300, 160).shape.id);
          ids.push(U.placeElement(m, 'class', 640, 240).shape.id);
        });
        set({ selection: ids.map((id) => ({ kind: 'shape', id })) });
        U.renderCanvas();
        await new Promise((r) => setTimeout(r, 80));
        return { ids };
      })()`);
      await sleep(220);
      const btns = await s.evaluate("document.querySelectorAll('#props .align-btn').length");
      assert(btns === 8, 'пиктограмм выравнивания ' + btns + ', ждали 8');
      const left = await s.evaluate(`(() => {
        document.querySelector('#props .align-btn[data-align="left"]').click();
        return true;
      })()`);
      assert(left, 'нет кнопки «по левому краю»');
      await sleep(200);
      const xs = await s.evaluate(`(async () => {
        const U = window.__uml;
        return U.currentDiagram(U.store.model).shapes.map((s) => s.x);
      })()`);
      assert(new Set(xs).size === 1, 'после выравнивания x = ' + JSON.stringify(xs));
      await s.evaluate(`document.querySelector('#props .align-btn[data-align="distribute-h"]').click()`);
      await sleep(200);
      const gaps = await s.evaluate(`(async () => {
        const U = window.__uml;
        const d = U.currentDiagram(U.store.model);
        const boxes = d.shapes.map((s) => ({ x: s.x, w: s.w })).sort((a, b) => a.x - b.x);
        return { g1: boxes[1].x - (boxes[0].x + boxes[0].w), g2: boxes[2].x - (boxes[1].x + boxes[1].w) };
      })()`);
      assert(Math.abs(gaps.g1 - gaps.g2) <= 1,
        'промежутки разные: ' + JSON.stringify(gaps));
      // При одном выделении пиктограмм быть не должно.
      await s.evaluate(`(async () => {
        const { set } = await import('/src/state/store.js');
        const U = window.__uml;
        set({ selection: [{ kind: 'shape', id: U.currentDiagram(U.store.model).shapes[0].id }] });
      })()`);
      await sleep(150);
      const one = await s.evaluate("document.querySelectorAll('#props .align-btn').length");
      assert(one === 0, 'при одном выделении пиктограмм ' + one + ', ждали 0');
      return '6 выравниваний и 2 распределения, промежутки ' + gaps.g1 + ' и ' + gaps.g2;
    });

    await check('перетаскивание элемента из дерева на лист', async () => {
      const first = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { loadModel, commit } = await import('/src/state/store.js');
        loadModel(U.deserialize(JSON.stringify({
          schema: 'uml-model/3', name: 'Дерево', elements: [], relationships: [], diagrams: [], currentDiagramId: null,
        })));
        commit('t', (m) => {
          const d = U.createDiagram('D', 'class');
          m.diagrams.push(d);
          m.currentDiagramId = d.id;
          U.placeElement(m, 'class', 120, 120);
          U.placeElement(m, 'class', 520, 120);
        });
        U.renderCanvas();
        await new Promise((r) => setTimeout(r, 80));
        return { elementId: U.store.model.elements[0].id, elements: U.store.model.elements.length };
      })()`);
      await sleep(200);
      // Первый элемент уже на листе: перетаскивание подсвечивает его, а не
      // создаёт второй вид.
      const dropped = await s.evaluate(`(() => {
        const row = document.querySelector('#model .node:not(.diagram)');
        const wrap = document.querySelector('#canvas-wrap');
        const r = wrap.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.setData('application/x-uml-element', ${JSON.stringify(first.elementId)});
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: r.x + 300, clientY: r.y + 400 }));
        wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: r.x + 300, clientY: r.y + 400 }));
        return { shapes: window.__uml.currentDiagram(window.__uml.store.model).shapes.length,
                 selected: window.__uml.store.ui.selection.length,
                 hint: window.__uml.store.ui.hint };
      })()`);
      assert(dropped.shapes === 2, 'второй вид создан: фигур ' + dropped.shapes);
      assert(dropped.selected === 1, 'существующий вид не выделен');
      assert(/уже показан/.test(dropped.hint), 'нет подсказки о существующем виде: ' + dropped.hint);
      // Элемент, которого на листе нет: перетаскивание кладёт его вид.
      const second = await s.evaluate(`(async () => {
        const U = window.__uml;
        const el = U.store.model.elements[1];
        U.commit('t', (m) => {
          const cur = U.currentDiagram(m);
          cur.shapes = cur.shapes.filter((s) => s.elementId !== el.id);
        });
        U.renderCanvas();
        await new Promise((r) => setTimeout(r, 80));
        return { id: el.id, elements: U.store.model.elements.length,
                 shapes: U.currentDiagram(U.store.model).shapes.length };
      })()`);
      await sleep(150);
      const dropped2 = await s.evaluate(`(() => {
        const wrap = document.querySelector('#canvas-wrap');
        const r = wrap.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.setData('application/x-uml-element', ${JSON.stringify(second.id)});
        wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: r.x + 500, clientY: r.y + 300 }));
        wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: r.x + 500, clientY: r.y + 300 }));
        const U = window.__uml;
        const d = U.currentDiagram(U.store.model);
        const sel = U.store.ui.selection;
        const sh = sel.length ? d.shapes.find((s) => s.id === sel[0].id) : null;
        return { shapes: d.shapes.length, elements: U.store.model.elements.length,
                 elementId: sh && sh.elementId, x: sh && sh.x };
      })()`);
      assert(dropped2.shapes === second.shapes + 1, 'вид не поставлен: фигур ' + dropped2.shapes);
      assert(dropped2.elements === second.elements, 'создан новый элемент вместо вида: ' + dropped2.elements);
      assert(dropped2.elementId === second.id, 'вид указывает не на тот элемент');
      return 'второй дроп не дублирует, новый вид — view элемента (фигур ' + dropped2.shapes + ')';
    });

    // PlantUML-импорт (план Э7) через сам интерфейс: меню «Файл», диалог
    // вставки, тост с итогом и списком пропущенного. Импорт идёт НА НОВЫЙ
    // ЛИСТ: то, что было открыто, не заменяется.
    await check('меню «Файл» предлагает импорт PlantUML', async () => {
      const out = await s.evaluate(`(() => {
        const bar = document.querySelector('#toolbar');
        const file = [...bar.querySelectorAll('.menu > button')].find((b) => /^Файл/.test(b.textContent.trim()));
        if (!file) return { error: 'нет меню «Файл»' };
        file.click();
        const items = [...document.querySelectorAll('.menu-pop button')]
          .map((b) => b.textContent.trim());
        return { items };
      })()`);
      assert(!out.error, out.error);
      assert(out.items.some((t) => /Импорт PlantUML…/.test(t)), 'нет пункта «Импорт PlantUML…»: ' + out.items.join(' | '));
      assert(out.items.some((t) => /Импорт PlantUML: вставить текст/.test(t)), 'нет пункта вставки текста');
      await s.evaluate("document.body.click()");
      return out.items.filter((t) => /PlantUML/.test(t)).join(' / ');
    });

    await check('импорт PlantUML из вставленного текста даёт лист и итог', async () => {
      const before = await s.evaluate('window.__uml.store.model.diagrams.length');
      // Пункт меню зовётся напрямую тем же путём, что и клик: openPasteDialog()
      // возвращает промис, который завершится, когда человек нажмёт кнопку.
      await s.evaluate("window.__pumlPaste = window.__uml.puml.paste(); 1");
      await sleep(300);
      const opened = await s.evaluate("!!document.querySelector('sc-dialog[open] #puml-paste')");
      assert(opened, 'диалог с полем текста не открылся');
      await s.evaluate(`(() => {
        const dlg = document.querySelector('sc-dialog[open]');
        const a = dlg.querySelector('#puml-paste');
        a.value = '@startuml\\ntitle Из меню\\nclass Q1 as "Первый"\\nclass Q2 as "Второй"\\nQ1 --> Q2\\nнеизвестная строка\\n@enduml';
        a.dispatchEvent(new Event('input', { bubbles: true }));
        [...dlg.querySelectorAll('button')].find((b) => /Импортировать/.test(b.textContent)).click();
        return 1;
      })()`);
      await s.evaluate('window.__pumlPaste');
      await sleep(400);
      const after = await s.evaluate(`(() => {
        const U = window.__uml;
        const d = U.currentDiagram(U.store.model);
        const toast = document.querySelector('sc-toast');
        return { diagrams: U.store.model.diagrams.length, name: d.name,
                 shapes: d.shapes.length, links: d.links.length,
                 dom: document.querySelectorAll('#canvas [data-kind="shape"]').length,
                 toast: toast ? toast.textContent.replace(/\\s+/g, ' ') : '' };
      })()`);
      assert(after.diagrams === before + 1, `листов ${after.diagrams}, было ${before}`);
      assert(after.name === 'Из меню', 'имя листа из title не взято: ' + after.name);
      assert(after.shapes === 2 && after.links === 1, `фигур ${after.shapes}, связей ${after.links}`);
      assert(after.dom === 2, `на листе нарисовано ${after.dom} фигур`);
      assert(/Импортировано: 2/.test(after.toast), 'в тосте нет итога: ' + after.toast);
      assert(/Подробности/.test(after.toast), 'в тосте нет кнопки «Подробности»');
      return after.toast.slice(0, 90);
    });

    await check('«Подробности» показывает пропущенные строки с номерами', async () => {
      await s.evaluate(`(() => {
        const t = document.querySelector('sc-toast');
        const b = [...t.querySelectorAll('button')].find((x) => /Подробности/.test(x.textContent));
        if (b) b.click();
        return 1;
      })()`);
      await sleep(300);
      const text = await s.evaluate("(document.querySelector('sc-dialog[open]') || {}).textContent || ''");
      assert(/строка 6/.test(text), 'нет строки 6 в списке: ' + text.slice(0, 120));
      assert(/не понята/.test(text), 'нет причины пропуска');
      await s.evaluate(`(() => {
        const dlg = document.querySelector('sc-dialog[open]');
        const b = dlg && [...dlg.querySelectorAll('button')].find((x) => /Понятно/.test(x.textContent));
        if (b) b.click();
        return 1;
      })()`);
      await sleep(200);
      return 'список открылся и закрылся';
    });

    await check('снимок содержит интерфейс (свой и через CDP сходятся)', async () => {
      const out = path.join(tmpdir(), `uml-shot-${process.pid}.png`);
      // Свой снимок: тот же стартёр, что зовёт Craft Anything. Он сам решает,
      // принят ли кадр (размер + доля чернил), и падает, если кадр пустой.
      //
      // `--query model=sample` обязателен: кадр сравнивается с CDP-снимком
      // этой же страницы, а она открыта с примером. Без параметра стартёр
      // открывает первый запуск (пустой лист с приглашением), и два снимка
      // показывали бы РАЗНЫЕ состояния приложения — сравнение мерило бы не
      // отрисовку, а разницу экранов.
      execFileSync(path.join(ROOT, 'Build', 'uml-modeler'), ['--screenshot', out, '--query', 'model=sample'], {
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
      });
      const own = inkRatio(await readFile(out));
      await rm(out, { force: true });
      const cdp = inkRatio(cdpShot);
      assert(own.ratio >= INK_MIN, `свой снимок: чернил ${(own.ratio * 100).toFixed(1)} % < 3 %`);
      assert(cdp.ratio >= INK_MIN, `CDP-снимок: чернил ${(cdp.ratio * 100).toFixed(1)} % < 3 %`);
      assert(own.width >= 1200 && own.height >= 800,
        `свой снимок ${own.width}×${own.height}, ждали кадр окна`);
      const spread = Math.abs(own.ratio - cdp.ratio) / Math.max(own.ratio, cdp.ratio);
      assert(spread <= 0.10,
        `доли расходятся на ${(spread * 100).toFixed(1)} %: свой ${(own.ratio * 100).toFixed(1)} %,`
        + ` CDP ${(cdp.ratio * 100).toFixed(1)} %`);
      return `свой ${(own.ratio * 100).toFixed(1)} %, CDP ${(cdp.ratio * 100).toFixed(1)} %,`
        + ` расхождение ${(spread * 100).toFixed(1)} %`;
    });

    // Маркеры замечаний на холсте (фаза 4.1). Меряем именно демо: 6 листов,
    // 70 элементов, 69 связей, 47 замечаний — каждое обязано получить маркер
    // хотя бы на одном листе. Три замечания («элемент не показан ни на одной
    // диаграмме», «связь не показана», «имя стереотипа занято») вида не имеют
    // вовсе, поэтому у них свой бейдж «вне листов» — иначе число было бы 44.
    await check('маркеры замечаний видны на каждом замечании демо', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { loadModel } = await import('/src/state/store.js');
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        loadModel(U.deserialize(text));
        await new Promise((r) => setTimeout(r, 250));
        // Набор правил грузится при старте отдельным запросом; ждать его
        // готовности — дело проверки, а не удачи: иначе маркеры «пропадают»
        // ровно в тех прогонах, где движок ещё не приехал.
        for (let i = 0; i < 20 && !checks.checkResult().ready; i += 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
        const per = [];
        for (const d of U.store.model.diagrams) {
          U.commit('t', (m) => { m.currentDiagramId = d.id; });
          await new Promise((r) => setTimeout(r, 80));
          const marks = [...document.querySelectorAll('#markslayer [data-mark]')];
          per.push({
            id: d.id,
            dom: marks.length,
            count: marks.reduce((n, g) => n + Number(g.dataset.markCount || 0), 0),
            kinds: marks.map((g) => g.dataset.markKind),
          });
        }
        return { report: checks.markerReport(), per };
      })()`);
      const r = out.report;
      assert(!out.error, `ошибка в браузере: ${out.error}`);
      assert(r && r.ready, `движок не отработал: ${JSON.stringify(out).slice(0, 300)}`);
      // Число замечаний не прибито гвоздями: набор правил растёт, и демо
      // вместе с ним (на 2026-11-07 было 47 на 6 листах, стало 59 на 9).
      // Проверяется не цифра, а полнота: у КАЖДОГО замечания есть маркер.
      assert(r.findings >= 47, `замечаний ${r.findings}, меньше документированных 47`);
      assert(r.covered === r.findings, `маркер получили ${r.covered} из ${r.findings}`);
      assert(r.undrawn.length === 0, `без маркера: ${r.undrawn.join(', ')}`);
      assert(r.offSheet > 0, 'нет ни одного замечания «вне листов» — бейдж не проверен');
      assert(out.per.length === r.perDiagram.length, `листов ${out.per.length} вместо ${r.perDiagram.length}`);
      for (let i = 0; i < out.per.length; i += 1) {
        const p = out.per[i];
        const want = r.perDiagram[i];
        assert(p.id === want.id, `лист ${i}: ${p.id} вместо ${want.id}`);
        assert(p.dom === want.markers + 1,
          `лист ${p.id}: маркеров в DOM ${p.dom}, ждали ${want.markers} + бейдж «вне листов»`);
        assert(p.count === want.findings + r.offSheet,
          `лист ${p.id}: замечаний на маркерах ${p.count}, ждали ${want.findings + r.offSheet}`);
        assert(p.dom > 0, `лист ${p.id}: маркеров нет`);
        assert(p.kinds.includes('model'), `лист ${p.id}: нет бейджа «вне листов»`);
      }
      const sumFindings = r.perDiagram.reduce((n, d) => n + d.findings, 0);
      return `${r.findings} замечаний, маркеров на листах ${r.targetMarkers} (+${r.offSheet} вне листов), `
        + `по листам ${r.perDiagram.map((d) => d.findings).join('+')} = ${sumFindings}`;
    });

    await check('маркер: подсказка, клик и переключатель «маркеры на листе»', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const checks = await import('/src/ui/checks.js');
        checks.openChecksPanel();
        await new Promise((r) => setTimeout(r, 120));

        const first = document.querySelector('#markslayer [data-mark-kind="shape"]');
        if (!first) return { error: 'на листе нет маркера фигуры' };
        const dot = first.querySelector('.finding-mark-dot');
        const rule = (first.dataset.markRules || '').split(' ')[0];

        dot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
        await new Promise((r) => setTimeout(r, 40));
        const tip = document.getElementById('mark-tip');
        const tipText = tip ? tip.textContent : '';
        const tipOpen = !!tip && !tip.hidden;
        dot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerId: 1, relatedTarget: document.body }));
        await new Promise((r) => setTimeout(r, 30));
        const tipClosed = !document.getElementById('mark-tip') || document.getElementById('mark-tip').hidden;

        const before = document.querySelectorAll('#markslayer [data-mark]').length;
        const box = document.getElementById('checks-show-marks');
        if (!box) return { error: 'нет переключателя маркеров' };
        box.checked = false;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const off = document.querySelectorAll('#markslayer [data-mark]').length;
        const flagInModel = /showMarks/.test(JSON.stringify(U.store.model));
        const box2 = document.getElementById('checks-show-marks');
        box2.checked = true;
        box2.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const on = document.querySelectorAll('#markslayer [data-mark]').length;

        const first2 = document.querySelector('#markslayer [data-mark-kind="shape"]');
        const dot2 = first2.querySelector('.finding-mark-dot');
        const view = first2.dataset.markView;
        const afterToggle = document.querySelectorAll('#markslayer [data-mark]').length;
        dot2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
        await new Promise((r) => setTimeout(r, 250));
        // Маркеры обязаны пережить смену выделения: renderOverlay() чистит
        // оверлей, и слой маркеров для того и отдельный.
        const afterSelect = document.querySelectorAll('#markslayer [data-mark]').length;
        const selectionAfterClick = U.store.ui.selection;
        const picked = !!document.querySelector('#checks .finding.picked');
        const checksActive = document.getElementById('checks').classList.contains('active');
        U.set({ selection: [] });
        await new Promise((r) => setTimeout(r, 120));
        const afterClear = document.querySelectorAll('#markslayer [data-mark]').length;
        return {
          rule, tipOpen, tipText, tipClosed,
          before, off, on, afterToggle, afterSelect, afterClear, flagInModel, view,
          checksActive, selection: selectionAfterClick, picked,
        };
      })()`);
      assert(!out.error, out.error);
      assert(out.tipOpen, 'подсказка при наведении не открылась');
      assert(out.tipText.includes(out.rule), `в подсказке нет id правила «${out.rule}»: ${out.tipText.slice(0, 80)}`);
      assert(out.tipClosed, 'подсказка не закрылась');
      assert(out.before > 0 && out.off === 0 && out.on === out.before,
        `переключатель: было ${out.before}, выключено ${out.off}, включено ${out.on}`);
      assert(!out.flagInModel, 'showMarks попал в файл модели');
      assert(out.afterToggle === out.on, `после клика по маркеру маркеров ${out.afterToggle} из ${out.on}`);
      assert(out.afterSelect === out.on, `смена выделения снесла маркеры: ${out.afterSelect} из ${out.on}`);
      assert(out.afterClear === out.on, `снятие выделения снесло маркеры: ${out.afterClear} из ${out.on}`);
      assert(out.checksActive, 'клик по маркеру не открыл панель «Проверки»');
      assert(out.selection.length === 1 && out.selection[0].kind === 'shape',
        `клик по маркеру не выделил фигуру: ${JSON.stringify(out.selection)}`);
      assert(out.picked, 'строка замечания в панели не подсвечена');
      return `правило ${out.rule}, маркеров ${out.on}, выделено ${out.selection[0].id}, `
        + 'подсказка и переключатель работают';
    });

    // Тултип — ОПОЗНАНИЕ, а не объяснение (решение владельца 2026-11-07):
    // «белая карточка — паспорт, чёрная подпись — быстрый тултип». Поэтому в
    // подсказке только id правила и message, а hint — совет без контекста
    // модели — живёт в карточке и в тултип не попадает. Проверяется на
    // заведомо длинном hint: короткий мог бы случайно встретиться в message.
    await check('тултип маркера: id правила и message есть, hint — нет', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        U.loadModel(U.deserialize(text));
        await sleep(250);
        checks.openChecksPanel();
        for (let i = 0; i < 30 && !checks.checkResult().ready; i += 1) await sleep(100);
        await sleep(150);
        const rules = U.ruleset().rules;
        let pick = null;
        for (const g of document.querySelectorAll('#markslayer [data-mark]')) {
          const rid = (g.dataset.markRules || '').split(' ')[0];
          const rule = rules.find((r) => r.id === rid);
          if (!rule?.hint || rule.hint.length < 60) continue;
          if (!pick || rule.hint.length > pick.rule.hint.length) pick = { g, rule };
        }
        if (!pick) return { error: 'нет маркера, у первого правила которого длинный hint' };
        const dot = pick.g.querySelector('.finding-mark-dot');
        dot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
        await sleep(60);
        const tip = document.getElementById('mark-tip');
        const shown = tip ? tip.textContent : '';
        const open = !!tip && !tip.hidden;
        dot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerId: 1, relatedTarget: document.body }));
        await sleep(40);
        return {
          open, shown, rule: pick.rule.id, message: pick.rule.message, hint: pick.rule.hint,
          foot: !!tip?.querySelector('.mark-tip-foot'),
          hiddenAfter: !document.getElementById('mark-tip') || document.getElementById('mark-tip').hidden,
        };
      })()`);
      assert(!out.error, out.error);
      assert(out.open, 'подсказка при наведении не открылась');
      assert(out.shown.includes(out.rule), `в подсказке нет id правила «${out.rule}»`);
      assert(out.shown.includes(out.message), `в подсказке нет message правила «${out.rule}»`);
      assert(!out.shown.includes(out.hint), 'в подсказке есть hint правила — это объяснение, а не опознание');
      assert(out.foot, 'в подсказке нет подвала «Клик — паспорт ошибки»');
      assert(out.hiddenAfter, 'подсказка не закрылась');
      return `правило ${out.rule}: message есть, hint (${out.hint.length} симв.) скрыт`;
    });

    // Второй ответ на тот же вопрос — нативный <title> — убран из drawMark:
    // браузер рисовал им чёрную подпись поверх нашего тултипа и склеивал все
    // замечания маркера в одну строку. Имя для программ чтения экрана остаётся
    // за aria-label, и проверка стережёт оба конца: <title> нет, aria-label есть.
    await check('у маркера нет нативного title, имя даёт aria-label', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        U.loadModel(U.deserialize(text));
        await sleep(250);
        checks.openChecksPanel();
        for (let i = 0; i < 30 && !checks.checkResult().ready; i += 1) await sleep(100);
        await sleep(150);
        const first = document.querySelector('#markslayer [data-mark]');
        return {
          marks: document.querySelectorAll('#markslayer [data-mark]').length,
          hasTitle: !!document.querySelector('#markslayer [data-mark] title'),
          anyTitle: document.querySelectorAll('#markslayer title').length,
          aria: first?.getAttribute('aria-label') ?? '',
        };
      })()`);
      assert(out.marks > 0, 'на листе нет маркеров');
      assert(!out.hasTitle, 'у маркера снова есть нативный <title> — он рисует второй, чёрный тултип');
      assert(out.anyTitle === 0, `в слое маркеров ${out.anyTitle} нативных <title>`);
      assert(out.aria.length > 10, 'у маркера нет aria-label: имя для чтения экрана пропало');
      return `${out.marks} маркеров: title нет, aria-label ${out.aria.length} симв.`;
    });

    // Паспорт объекта: у маркера с несколькими правилами клик открывает ОДНУ
    // карточку со всеми замечаниями объекта, сгруппированными по правилам.
    // Раньше открывалось первое замечание, и остальные искали глазами.
    // В демо такой объект есть — компонент в классе на d1 (2 правила).
    await check('клик по маркеру с несколькими правилами открывает паспорт объекта', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        U.loadModel(U.deserialize(text));
        await sleep(250);
        checks.openChecksPanel();
        for (let i = 0; i < 30 && !checks.checkResult().ready; i += 1) await sleep(100);
        await sleep(150);
        const multi = [...document.querySelectorAll('#markslayer [data-mark]')]
          .find((g) => Number(g.dataset.markCount) >= 2);
        if (!multi) return { error: 'на листе нет маркера с двумя правилами' };
        const want = Number(multi.dataset.markCount);
        const rules = (multi.dataset.markRules || '').split(' ').filter(Boolean);
        const view = multi.dataset.markView;
        const diagram = U.store.model.diagrams.find((d) => d.id === U.store.model.currentDiagramId);
        const shape = diagram?.shapes.find((s) => s.id === view);
        const element = shape ? U.store.model.elements.find((e) => e.id === shape.elementId) : null;
        multi.querySelector('.finding-mark-dot')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
        await sleep(250);
        const card = document.getElementById('mark-card');
        const groups = card ? [...card.querySelectorAll('.mc-group')] : [];
        const info = {
          want, rules, view, name: element?.name ?? '',
          card: !!card,
          groups: groups.length,
          groupRules: groups.map((g) => g.dataset.rule),
          title: card?.querySelector('.rc-head .rc-id')?.textContent ?? '',
          count: card?.querySelector('.rc-head .rc-lvl')?.textContent ?? '',
          first: groups[0] ? {
            msg: groups[0].querySelector('.mc-msg')?.textContent ?? '',
            sections: [...groups[0].querySelectorAll('.rc-sec > b')].map((b) => b.textContent),
            goto: !!groups[0].querySelector('.rc-goto'),
          } : null,
        };
        // Паспорт описывает вид на конкретном листе — смена листа его закрывает.
        U.commit('t', (m) => { m.currentDiagramId = 'd2'; });
        await sleep(200);
        info.afterSheet = !!document.getElementById('mark-card');
        return info;
      })()`);
      assert(!out.error, out.error);
      assert(out.card, 'паспорт объекта не открылся');
      assert(out.groups === out.rules.length, `групп ${out.groups}, правил у маркера ${out.rules.length}`);
      assert(out.groups === out.want, `групп ${out.groups}, замечаний у маркера ${out.want}`);
      assert(out.groupRules.join(' ') === out.rules.join(' '),
        `группы не по правилам маркера: ${out.groupRules.join(', ')} вместо ${out.rules.join(', ')}`);
      assert(out.name && out.title.includes(out.name),
        `заголовок «${out.title}» не называет объект «${out.name}»`);
      assert(/\d+ (правило|правила|правил) на этом объекте/.test(out.count),
        `нет строки «N правил на этом объекте»: «${out.count}»`);
      assert(out.first?.msg.length > 5, 'в первой группе нет message');
      assert(out.first.sections.includes('Где'), 'в группе нет «Где»');
      assert(out.first.sections.includes('Что делать'), 'в группе нет «Что делать»');
      assert(out.first.goto, 'в группе нет кнопки «Показать на листе»');
      assert(!out.afterSheet, 'паспорт пережил смену листа');
      return `${out.name}: ${out.groups} группы (${out.groupRules.join(', ')}), закрыт сменой листа`;
    });

    // Одно замечание — паспорт не нужен: поведение прежнее, строка списка и её
    // карточка. Иначе на каждом маркере появлялась бы карточка-дубль строки.
    await check('клик по маркеру с одним замечанием паспорт-объект не открывает', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        U.loadModel(U.deserialize(text));
        await sleep(250);
        checks.openChecksPanel();
        for (let i = 0; i < 30 && !checks.checkResult().ready; i += 1) await sleep(100);
        await sleep(150);
        const single = [...document.querySelectorAll('#markslayer [data-mark]')]
          .find((g) => Number(g.dataset.markCount) === 1);
        if (!single) return { error: 'на листе нет маркера с одним замечанием' };
        single.querySelector('.finding-mark-dot')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
        await sleep(250);
        return {
          view: single.dataset.markView,
          passport: !!document.getElementById('mark-card'),
          rowCard: !!document.querySelector('#checks .finding .rule-card'),
          picked: !!document.querySelector('#checks .finding.picked'),
        };
      })()`);
      assert(!out.error, out.error);
      assert(!out.passport, 'паспорт объекта открылся на маркере с одним замечанием');
      assert(out.rowCard, 'у строки не открылась её карточка правила');
      assert(out.picked, 'строка замечания не подсвечена');
      return `маркер ${out.view}: строка и её карточка, паспорта нет`;
    });

    // Escape — третий путь закрытия (ещё клик вне карточки и смена листа).
    await check('Escape закрывает паспорт объекта', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        U.loadModel(U.deserialize(text));
        await sleep(250);
        checks.openChecksPanel();
        for (let i = 0; i < 30 && !checks.checkResult().ready; i += 1) await sleep(100);
        await sleep(150);
        const multi = [...document.querySelectorAll('#markslayer [data-mark]')]
          .find((g) => Number(g.dataset.markCount) >= 2);
        if (!multi) return { error: 'на листе нет маркера с двумя правилами' };
        multi.querySelector('.finding-mark-dot')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
        await sleep(250);
        const before = !!document.getElementById('mark-card');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(150);
        return { before, after: !!document.getElementById('mark-card') };
      })()`);
      assert(!out.error, out.error);
      assert(out.before, 'паспорт не открылся — закрывать нечего');
      assert(!out.after, 'Escape не закрыл паспорт объекта');
      return 'паспорт открылся и закрылся по Escape';
    });

    // Привязка маркера к листу (фаза 4.1, п. 5): замечание с `diagramId`
    // живёт на своём листе, замечание модели (`diagramId: null`) — на каждом,
    // где есть фигура цели. Проверяется на синтетической модели, потому что в
    // демо ни один элемент не показан на двух листах сразу, и отличить
    // «фильтр работает» от «вида больше негде нарисовать» там нельзя.
    await check('маркер листа не переезжает на другой лист, а модельный — на обоих', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const { loadModel, commit } = await import('/src/state/store.js');
        const checks = await import('/src/ui/checks.js');
        loadModel(U.deserialize(JSON.stringify({
          schema: 'uml-model/3', name: 'Маркеры', elements: [], relationships: [],
          diagrams: [], currentDiagramId: null,
        })));
        commit('t', (m) => {
          const a = U.createDiagram('A', 'class');
          const b = U.createDiagram('B', 'class');
          m.diagrams.push(a, b);
          m.currentDiagramId = a.id;
        });
        const ids = {};
        commit('t', (m) => {
          // Листы ищем по имени: читатель файла заводит свою «Диаграмму 1»,
          // и порядок в массиве — не то, на что можно опираться.
          const a = m.diagrams.find((d) => d.name === 'A');
          const b = m.diagrams.find((d) => d.name === 'B');
          m.currentDiagramId = a.id;
          // X и Y: на A обе фигуры без связей (замечание листа A), на B —
          // связаны. Z без имени: замечание модели, вид есть на обоих листах.
          const x = U.placeElement(m, 'class', 100, 100);
          const y = U.placeElement(m, 'class', 400, 100);
          const z = U.placeElement(m, 'class', 100, 400);
          ids.x = x.element.id; ids.y = y.element.id; ids.z = z.element.id;
          b.shapes.push(
            { id: 'b-x', elementId: x.element.id, x: 100, y: 100, w: 190, h: 120 },
            { id: 'b-y', elementId: y.element.id, x: 400, y: 100, w: 190, h: 120 },
            { id: 'b-z', elementId: z.element.id, x: 100, y: 400, w: 190, h: 120 },
          );
          const rel = U.createRelationship('association', x.element.id, y.element.id);
          m.relationships.push(rel);
          b.links.push(U.createLink(rel, { shapeId: 'b-x', side: 'right' }, { shapeId: 'b-y', side: 'left' }));
          const zEl = m.elements.find((e) => e.id === z.element.id);
          zEl.name = '';
        });
        checks.refreshChecks();
        await new Promise((r) => setTimeout(r, 120));

        const perSheet = {};
        for (const d of U.store.model.diagrams) {
          commit('t', (m) => { m.currentDiagramId = d.id; });
          await new Promise((r) => setTimeout(r, 100));
          const marks = [...document.querySelectorAll('#markslayer [data-mark]')];
          perSheet[d.name] = {
            markers: marks.length,
            rules: marks.flatMap((g) => (g.dataset.markRules || '').split(' ').filter(Boolean)),
            views: marks.map((g) => g.dataset.markView),
          };
        }
        const findings = checks.checkResult().findings;
        const iso = findings.filter((f) => f.ruleId === 'shape-isolated-on-diagram');
        const unnamed = findings.filter((f) => f.ruleId === 'element-unnamed');
        return {
          perSheet, ids,
          iso: iso.map((f) => ({ d: f.diagramId, t: f.targets })),
          unnamedTargets: unnamed.flatMap((f) => f.targets),
          report: checks.markerReport(),
        };
      })()`);
      assert(!out.error, `ошибка в браузере: ${out.error}`);
      const sheetA = out.report.perDiagram.find((d) => d.name === 'A');
      assert(sheetA, `нет листа A среди ${out.report.perDiagram.map((d) => d.name).join(', ')}`);
      assert(out.iso.length >= 2 && out.iso.every((f) => f.d === sheetA.id),
        `замечания листа A: ${JSON.stringify(out.iso)}, лист A ${sheetA.id}`);
      assert(out.unnamedTargets.includes(out.ids.z),
        `нет модельного замечания про безымянный элемент: ${JSON.stringify(out.unnamedTargets)}`);
      // На B связи есть — изоляции там нет; маркер A туда переехать не может.
      const a = out.perSheet.A;
      const b = out.perSheet.B;
      assert(a.rules.filter((r) => r === 'shape-isolated-on-diagram').length === 2,
        `на листе A изоляций ${a.rules.filter((r) => r === 'shape-isolated-on-diagram').length}, ждали 2`);
      assert(!b.rules.includes('shape-isolated-on-diagram'),
        `замечание листа A переехало на B: ${b.rules.join(', ')}`);
      // Модельное замечание — на обоих листах.
      assert(a.rules.includes('element-unnamed') && b.rules.includes('element-unnamed'),
        `модельное замечание не на обоих листах: A ${a.rules.join(',')} / B ${b.rules.join(',')}`);
      assert(b.views.includes('b-z'), `на B нет маркера безымянного элемента: ${b.views.join(',')}`);
      return `A: ${a.markers} маркеров (2 изоляции), B: ${b.markers} (только модельное)`;
    });

    // Вкладка «Стандарт» (фаза 4.3): реестр констрейнтов целиком. Числа не
    // прибиты гвоздями — они сверяются с тем же файлом, который грузит
    // вкладка: реестр растёт (правила пишут другие агенты), а контракт
    // «строк столько, сколько в реестре» остаётся.
    await check('полка «Стандарт»: все констрейнты, 166 в области, фильтр по статусу', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const data = await (await fetch('/notation/rules/coverage.json')).json();
        // Реестр переехал из правой панели в библиотеку (полка «Стандарт»):
        // в панели 255 px таблица из 449 строк не помещалась, а сам реестр —
        // справочный материал, а не инструмент рисования. Открываем статью
        // полки тем же путём, что и человек, — через справочник.
        await U.reference.openArticle('standard:');
        for (let i = 0; i < 40 && !document.querySelector('#ref-doc .std-row'); i += 1) await sleep(100);
        const rows = [...document.querySelectorAll('#ref-doc .std-row')];
        const visible = rows.filter((n) => !n.hidden);
        const head = document.getElementById('standard-nums')?.textContent ?? '';
        // Фильтр по одному статусу: снять остальные нажатые чипы. Проверяются
        // два статуса — «executable» (строк много) и «todo» (в реестре их может
        // не быть вовсе: правила пишут другие агенты). Оба числа берутся из
        // файла, а не из головы: реестр меняется, контракт — нет.
        const only = async (status) => {
          for (const b of document.querySelectorAll('#standard-statuses .std-chip')) {
            if (b.dataset.status !== status && b.getAttribute('aria-pressed') === 'true') b.click();
          }
          await new Promise((r) => requestAnimationFrame(r));
          await sleep(80);
          const shown = [...document.querySelectorAll('#ref-doc .std-row')].filter((n) => !n.hidden);
          return { n: shown.length, statuses: [...new Set(shown.map((n) => n.dataset.status))] };
        };
        const byExec = await only('executable');
        const todo = await only('todo');
        const todoStatuses = todo.statuses;
        document.getElementById('standard-reset').click();
        await new Promise((r) => requestAnimationFrame(r));
        await sleep(60);
        const afterReset = [...document.querySelectorAll('#ref-doc .std-row')].filter((n) => !n.hidden).length;
        // раскрытие строки: текст констрейнта и OCL
        const row = [...document.querySelectorAll('#ref-doc .std-row')]
          .find((n) => !n.hidden && n.dataset.status === 'executable');
        row?.click();
        await sleep(60);
        return {
          totals: data.totals, byStatus: data.byStatus,
          rows: rows.length, visible: visible.length, head,
          todo: todo.n, todoStatuses, byExec, afterReset,
          detail: !!row?.querySelector('.std-ocl'), clause: row?.querySelector('.std-clause')?.textContent ?? '',
          panelScroll: (() => { const p = document.getElementById('ref-scroll'); return { c: p.clientWidth, s: p.scrollWidth }; })(),
        };
      })()`);
      assert(!out.error, `ошибка в браузере: ${out.error}`);
      assert(out.rows === out.totals.constraints, `строк ${out.rows}, в реестре ${out.totals.constraints}`);
      assert(out.visible === out.totals.inScope,
        `видимых по умолчанию ${out.visible}, в области ${out.totals.inScope} (283 «вне области» скрыты)`);
      assert(out.head === `${out.byStatus.executable} из ${out.totals.inScope} в области · записано ${out.totals.rulesWritten}`,
        `шапка «${out.head}»`);
      assert(out.byExec.n === out.byStatus.executable,
        `фильтр executable дал ${out.byExec.n} строк, в реестре ${out.byStatus.executable}`);
      assert(out.byExec.statuses.length === 1 && out.byExec.statuses[0] === 'executable',
        `под фильтром executable статусы: ${out.byExec.statuses.join(', ')}`);
      // «todo» может быть пуст: важно, что фильтр не показывает всё подряд.
      assert(out.todo === out.byStatus.todo, `фильтр todo дал ${out.todo} строк, в реестре ${out.byStatus.todo}`);
      assert(out.todoStatuses.every((s) => s === 'todo'),
        `под фильтром todo статусы: ${out.todoStatuses.join(', ')}`);
      assert(out.afterReset === out.totals.inScope, `после сброса видимых ${out.afterReset}`);
      assert(out.detail && /^п\. \d/.test(out.clause), 'раскрытие строки не показало текст и OCL');
      assert(out.panelScroll.s <= out.panelScroll.c + 1,
        `вкладка шире панели: ${out.panelScroll.s} при ${out.panelScroll.c}`);
      return `${out.rows} строк, видимых ${out.visible}, executable ${out.byExec.n}, todo ${out.todo}, `
        + `шапка «${out.head}»`;
    });

    // Карточка правила (фаза 4.2) — не пересказ стандарта, а инстанс: что
    // нашлось в этой модели, где и что делать. Текст и OCL остаются в
    // справочнике, и проверка это стережёт: карточка не имеет права их
    // повторять, иначе человек читает одно и то же в двух местах.
    await check('карточка правила: что нашлось, где, что делать — три метакласса', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        const text = await (await fetch('/material/demo-errors.json')).text();
        U.loadModel(U.deserialize(text));
        await sleep(250);
        checks.openChecksPanel();
        for (let i = 0; i < 30 && !checks.checkResult().ready; i += 1) await sleep(100);
        await sleep(150);
        const rules = U.ruleset().rules;
        const seen = new Set();
        const cards = [];
        for (const f of checks.checkResult().findings) {
          if (f.status === 'failed') continue;
          const rule = rules.find((r) => r.id === f.ruleId);
          const mc = rule?.source?.metaclass ?? 'practice';
          if (seen.has(mc)) continue;
          seen.add(mc);
          const row = [...document.querySelectorAll('#checks .finding')]
            .find((n) => n.dataset.rule === f.ruleId && n.dataset.targets === (f.targets ?? []).join(' '));
          if (!row) continue;
          row.querySelector('.finding-open').click();
          await sleep(80);
          const card = row.querySelector('.rule-card');
          const cardText = card ? card.textContent : '';
          const secs = card ? [...card.querySelectorAll('.rc-sec .rc-body')].map((n) => n.textContent.trim()) : [];
          const info = {
            rule: f.ruleId, metaclass: mc, card: !!card,
            id: card?.querySelector('.rc-id')?.textContent ?? '',
            level: card?.querySelector('.rc-lvl')?.textContent ?? '',
            detail: secs[0] ?? '', where: secs[1] ?? '', advice: secs[secs.length - 1] ?? '',
            hasRuleBtn: !!card?.querySelector('.rc-rule'),
            // дубликата справочника быть не должно
            dupText: rule?.source?.text ? cardText.includes(rule.source.text) : false,
            dupOcl: rule?.source?.ocl ? cardText.includes(rule.source.ocl) : false,
            hasClause: /п\. \d/.test(cardText),
          };
          // кнопка ведёт в статью правила, а не в диалог с цитатой
          card?.querySelector('.rc-rule')?.click();
          await sleep(1200);
          info.article = U.reference.current().id === f.ruleId ? 'ok' : U.reference.current().id;
          info.articleOcl = !!document.querySelector('#ref-doc .ocl');
          U.reference.close();
          await sleep(200);
          row.querySelector('.finding-open').click();
          await sleep(40);
          cards.push(info);
          if (cards.length === 3) break;
        }
        return { cards, findings: checks.checkResult().findings.length };
      })()`);
      assert(!out.error, `ошибка в браузере: ${out.error}`);
      assert(out.cards.length === 3, `карточек ${out.cards.length}, ждали три разных метакласса`);
      for (const c of out.cards) {
        assert(c.card, `карточка ${c.rule} не открылась`);
        assert(c.id === c.rule, `в карточке ${c.rule} нет её id`);
        assert(c.detail && c.detail.length > 10, `${c.rule}: «что нашлось» пусто`);
        assert(c.where && c.where.length > 5, `${c.rule}: «где» пусто`);
        assert(c.advice && c.advice.length > 5, `${c.rule}: «что делать» пусто`);
        assert(c.hasRuleBtn, `${c.rule}: нет кнопки в справочник`);
        assert(!c.dupText && !c.dupOcl && !c.hasClause, `${c.rule}: карточка повторяет текст стандарта`);
        assert(c.article === 'ok', `${c.rule}: кнопка открыла «${c.article}» вместо статьи правила`);
        assert(c.articleOcl, `${c.rule}: в статье справочника нет OCL`);
      }
      return out.cards.map((c) => `${c.rule} (${c.metaclass})`).join(', ');
    });

    // Невыразимое правило: причина и недостающее поле — только в карточке.
    // Замечания у такого правила нет, вход один — список «не проверяется».
    await check('карточка невыразимого правила: почему не проверяется и чего не хватает', async () => {
      const out = await s.evaluate(`(async () => {
        const U = window.__uml;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const checks = await import('/src/ui/checks.js');
        checks.openChecksPanel();
        await sleep(120);
        const det = document.getElementById('checks-coverage');
        if (det) det.open = true;
        const row = document.querySelector('#checks .coverage-rule');
        if (!row) return { error: 'нет списка «не проверяется»' };
        row.click();
        await sleep(80);
        const card = row.querySelector('.rule-card');
        const secs = card ? [...card.querySelectorAll('.rc-sec')].map((s) => ({
          title: s.querySelector('b')?.textContent ?? '',
          len: (s.querySelector('.rc-body')?.textContent ?? '').length,
        })) : [];
        const info = {
          id: card?.querySelector('.rc-id')?.textContent ?? '',
          level: card?.querySelector('.rc-lvl')?.textContent ?? '',
          secs,
          goto: !!card?.querySelector('.rc-goto'),
          uncovered: (U.ruleset()?.uncovered ?? []).map((u) => u.id),
        };
        row.click();
        return info;
      })()`);
      assert(!out.error, out.error);
      assert(out.uncovered.includes(out.id), `в карточке «${out.id}», а в списке невыразимых: ${out.uncovered.join(', ')}`);
      assert(out.level === 'не проверяется', `уровень карточки «${out.level}»`);
      const titles = out.secs.map((x) => x.title);
      assert(titles.includes('Почему не проверяется') && titles.includes('Чего не хватает'),
        `разделы карточки: ${titles.join(', ')}`);
      assert(out.secs.every((x) => x.len > 20), 'в карточке пустая причина или пустое «чего не хватает»');
      assert(!out.goto, 'у невыразимого правила не должно быть перехода к объекту');
      return `${out.id}: ${out.secs.map((x) => `${x.title} ${x.len} симв.`).join(', ')}`;
    });

    await check('в консоли нет ошибок', async () => {
      const errs = s.errors();
      assert(errs.length === 0, errs.slice(0, 3).join(' | '));
      return 'ошибок 0';
    });

    await check('ни одного запроса в сеть', async () => {
      const urls = s.events
        .filter((e) => e.method === 'Network.requestWillBeSent')
        .map((e) => e.params.request.url);
      const external = urls.filter((u) => !u.startsWith('http://127.0.0.1:') && !u.startsWith('data:') && !u.startsWith('blob:'));
      assert(external.length === 0, external.slice(0, 3).join(' | '));
      return `${urls.length} запросов, все локальные`;
    });
  } finally {
    child.kill('SIGKILL');
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // Файл модели: канонический JSON, пересохранение даёт те же байты.
  // Вне браузера пакет нотации надо применить руками: loadNotation() читает
  // его по HTTP, а здесь его берём с диска.
  const applyDiskPackage = async (name = 'uml') => {
    const { applyPackage } = await import('../src/model/notation.js');
    applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation', `${name}.json`), 'utf8')));
  };

  await check('файл *.uml.json пересохраняется байт в байт', async () => {
    await applyDiskPackage();
    const { buildSampleModel } = await import('../src/model/sample.js');
    const { serialize, deserialize } = await import('../src/io/umljson.js');
    const once = serialize(buildSampleModel());
    const twice = serialize(deserialize(once));
    assert(once === twice, 'после загрузки файл отличается');
    assert(!/NaN|undefined|null/.test(once), 'в файле есть NaN/undefined/null');
    const lines = once.split('\n').length;
    return `${once.length} Б, ${lines} строк`;
  });

  await check('битый файл читается с ремонтом', async () => {
    const { deserialize } = await import('../src/io/umljson.js');
    const model = deserialize(JSON.stringify({
      schema: 'uml-class-diagram/1',
      shapes: [{ id: 's1', kind: 'неведомая', x: 10.4, y: 20.6 }, { kind: 'class', name: 'A' }],
      connectors: [{ from: { shapeId: 'nope' }, to: { shapeId: 's1' } }],
    }));
    assert(model.elements.length === 2, `элементов ${model.elements.length}`);
    assert(model.diagrams[0].shapes.length === 2, `фигур ${model.diagrams[0].shapes.length}`);
    assert(model.elements[0].kind === 'class', 'неизвестный вид не стал классом');
    assert(model.diagrams[0].links.length === 0, 'битая связь не отброшена');
    return 'неизвестный вид → класс, битая связь отброшена';
  });

  await check('старый файл uml-model/3 без новых полей не меняется при пересохранении', async () => {
    await applyDiskPackage();
    const { deserialize, serialize } = await import('../src/io/umljson.js');
    // Файл, каким его писал прежний редактор: ни abstract, ни флагов членов,
    // ни навигации/агрегации/наборов обобщений. Он должен открыться с
    // умолчаниями и пересохраниться теми же байтами.
    const old = {
      schema: 'uml-model/3',
      id: 'mold',
      name: 'Старая модель',
      created: '2026-10-01',
      revised: '2026-10-02',
      elements: [
        {
          id: 'e1',
          kind: 'class',
          name: 'Заказ',
          stereotype: 'entity',
          documentation: 'заказ',
          attributes: [{ vis: 'private', name: 'номер', type: 'int' }],
          operations: [{ vis: 'private', name: 'итого()', type: 'double' }],
        },
        { id: 'e2', kind: 'class', name: 'Клиент' },
        {
          id: 'e3',
          kind: 'interface',
          name: 'Сериализуемый',
          operations: [{ vis: 'protected', name: 'вJson()', type: 'String' }],
        },
      ],
      relationships: [
        {
          id: 'r1',
          kind: 'association',
          name: 'оформляет',
          from: 'e1',
          to: 'e2',
          fromMultiplicity: '1',
          toMultiplicity: '0..*',
        },
        { id: 'r2', kind: 'aggregation', from: 'e1', to: 'e3', fromMultiplicity: '1' },
        { id: 'r3', kind: 'generalization', from: 'e2', to: 'e3' },
      ],
      diagrams: [{
        id: 'd1',
        name: 'Диаграмма 1',
        kind: 'class',
        shapes: [
          { id: 's1', elementId: 'e1', x: 60, y: 60, w: 190, h: 170 },
          { id: 's2', elementId: 'e2', x: 340, y: 60, w: 190, h: 170 },
          { id: 's3', elementId: 'e3', x: 620, y: 60, w: 190, h: 170 },
        ],
        links: [
          { id: 'l1', relId: 'r1', from: { shapeId: 's1', side: 'right' }, to: { shapeId: 's2', side: 'left' } },
          { id: 'l2', relId: 'r2', from: { shapeId: 's1', side: 'right', t: 0.2 }, to: { shapeId: 's3', side: 'left' } },
        ],
      }],
      currentDiagramId: 'd1',
    };
    const text = JSON.stringify(old, null, 2) + '\n';
    const m = deserialize(text);
    assert(m.elements[0].abstract === false, 'abstract не получил умолчание');
    assert(m.relationships[0].navigable === 'none', 'навигация не получила умолчание');
    assert(m.relationships[0].fromAggregation === 'none', 'агрегация ассоциации не none');
    assert(m.relationships[1].fromAggregation === 'shared',
      'умолчание вида «агрегация» не применено: ' + m.relationships[1].fromAggregation);
    assert(m.generalizationSets.length === 0, 'появились наборы обобщений из ниоткуда');
    assert(m.elements[0].attributes[0].isStatic === false, 'флаг члена не получил умолчание');
    const again = serialize(m);
    assert(again === text, 'пересохранение изменило файл ('
      + text.length + ' Б → ' + again.length + ' Б)');
    assert(serialize(deserialize(again)) === again, 'второе пересохранение нестабильно');
    return text.length + ' Б, умолчания применены, байты те же';
  });

  // Эталон совместимости из задания: файл, записанный самым первым редактором,
  // обязан пройти deserialize → serialize без единого байта разницы и без
  // ремонтов. Лежит он вне app/ — рядом с прототипом движка правил.
  await check('эталон tests/fixtures/old-v3.json пересохраняется побайтово', async () => {
    await applyDiskPackage();
    const { deserialize, serialize } = await import('../src/io/umljson.js');
    const text = await readFile(path.resolve(ROOT, '..', 'tests', 'fixtures', 'old-v3.json'), 'utf8');
    const repairs = [];
    const model = deserialize(text, { repairs });
    assert(!repairs.length, 'загрузчик что-то починил: ' + repairs.join(' | '));
    const again = serialize(model);
    assert(again === text,
      'пересохранение изменило эталон (' + text.length + ' Б → ' + again.length + ' Б)');
    return text.length + ' Б, ремонтов 0';
  });

  // Э2-бис: девять партий расширили `uml-model/3`. Корпус пособия — 48
  // моделей — теперь читается целиком: ни одна связь не теряется, а новые
  // поля переживают второй круг байт в байт.
  await check('корпус 48 моделей читается без потерь связей и держит второй круг', async () => {
    await applyDiskPackage();
    const { deserialize, serialize } = await import('../src/io/umljson.js');
    const dir = path.resolve(ROOT, '..', 'tests', 'corpus');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json');
    const bad = [];
    for (const f of files) {
      const text = await readFile(path.join(dir, f), 'utf8');
      const raw = JSON.parse(text);
      const m = deserialize(text, { repairs: [] });
      const out = serialize(m);
      const again = serialize(deserialize(out, { repairs: [] }));
      const lost = (raw.relationships?.length ?? 0) - m.relationships.length;
      if (lost || again !== out) bad.push(`${f}: -${lost} связей${again !== out ? ', круг нестабилен' : ''}`);
    }
    assert(!bad.length, bad.slice(0, 4).join('; '));
    return `${files.length} моделей, потерь нет`;
  });

  // Доказательство из задания: 5.2.10 и 5.2.18 теряли по связи с свободным
  // концом на загрузчике («Связь пропущена: её элемент не найден»).
  await check('5.2.10 и 5.2.18 больше не теряют сообщение с null-концом', async () => {
    await applyDiskPackage();
    const { deserialize, serialize } = await import('../src/io/umljson.js');
    const dir = path.resolve(ROOT, '..', 'tests', 'corpus');
    const out = [];
    for (const f of ['5210', '5218']) {
      const text = await readFile(path.join(dir, `${f}.json`), 'utf8');
      const raw = JSON.parse(text);
      const repairs = [];
      const m = deserialize(text, { repairs });
      const free = m.relationships.filter((r) => r.to === null || r.from === null);
      const again = deserialize(serialize(m), { repairs: [] });
      assert(m.relationships.length === raw.relationships.length,
        `${f}: ${m.relationships.length} из ${raw.relationships.length} связей`);
      assert(!repairs.length, `${f}: ремонты ${repairs.join(' | ')}`);
      assert(free.length === 1 && again.relationships.some((r) => r.to === null),
        `${f}: свободный конец не пережил круг`);
      out.push(`${f}: ${m.relationships.length} связей, свободный конец ${free[0].id}`);
    }
    return out.join('; ');
  });

  // Счётчик пробелов корпуса — единственное доказательство, которое нельзя
  // объявить, не сдвинув число: каждая проба сама гоняет поле через файл.
  await check('счётчик model.*: ни одного открытого кода (17 корпусных + 2 поля плана 2b)', async () => {
    await applyDiskPackage();
    const { deserialize, serialize } = await import('../src/io/umljson.js');
    const { gapReport, gapTable, stillOpen, makeRt } = await import('./gaps.mjs');
    const report = gapReport(makeRt(deserialize, serialize));
    const open = stillOpen(report);
    const rows = gapTable(report);
    assert(!open.length, `открыты: ${open.join(', ')}`);
    // Эталон совместимости проверяется после КАЖДОЙ партии из таблицы — это
    // и есть «побайтово после каждой партии»: у эталона ни одного нового поля,
    // поэтому каждая строка обязана его сохранить.
    const ref = await readFile(path.resolve(ROOT, '..', 'tests', 'fixtures', 'old-v3.json'), 'utf8');
    for (const row of rows) {
      const again = serialize(deserialize(ref, { repairs: [] }));
      assert(again === ref, `после ${row.party} эталон old-v3.json изменился`);
    }
    return rows.map((r) => `${r.party}+${r.closed}→${r.total}`).join(' ')
      + `, эталон ${ref.length} симв. / ${Buffer.byteLength(ref)} Б цел после каждой партии`;
  });

  await check('старый файл uml-class-diagram/1 мигрирует в uml-model/3', async () => {
    await applyDiskPackage();
    const { deserialize, serialize } = await import('../src/io/umljson.js');
    const old = JSON.stringify({
      schema: 'uml-class-diagram/1',
      id: 'mold',
      name: 'Старая модель',
      created: '2026-11-01',
      shapes: [
        {
          id: 's1', kind: 'class', name: 'Заказ', stereotype: 'entity',
          x: 10, y: 20, w: 190, h: 170,
          attributes: [{ vis: 'private', text: 'номер: int' }, { vis: 'public', text: 'итого()' }],
          operations: [{ vis: 'public', text: 'оплатить(): bool' }],
          documentation: 'заказ', fill: null, taggedValues: [],
        },
        { id: 's2', kind: 'class', name: 'Клиент', x: 300, y: 20, w: 190, h: 170 },
      ],
      connectors: [{
        id: 'c1', kind: 'association',
        from: { shapeId: 's1', side: 'right', t: 0.5 },
        to: { shapeId: 's2', side: 'left', t: 0.5 },
        name: 'оформляет', fromMultiplicity: '1', toMultiplicity: '0..*',
      }],
    });
    const repairs = [];
    const m = deserialize(old, { repairs });
    assert(m.schema === 'uml-model/3', `schema ${m.schema}`);
    assert(m.elements.length === 2 && m.diagrams.length === 1, `${m.elements.length} элементов, ${m.diagrams.length} диаграмм`);
    const d = m.diagrams[0];
    assert(d.shapes.length === 2 && d.shapes.every((s) => m.elements.some((e) => e.id === s.elementId)),
      'фигуры не указывают на элементы');
    assert(m.relationships.length === 1 && m.relationships[0].name === 'оформляет', 'связь потерялась');
    assert(d.links.length === 1 && d.links[0].relId === m.relationships[0].id, 'вид связи потерялся');
    const order = m.elements.find((e) => e.name === 'Заказ');
    const attr = order.attributes[0];
    assert(attr.vis === 'private' && attr.name === 'номер' && attr.type === 'int' && attr.default === '',
      `атрибут ${JSON.stringify(attr)}`);
    const op = order.operations[0];
    assert(op.name === 'оплатить()' && op.type === 'bool', `операция ${JSON.stringify(op)}`);
    const saved = serialize(m);
    const parsed = JSON.parse(saved);
    assert(parsed.schema === 'uml-model/3' && !('shapes' in parsed), 'сохранение не перешло на uml-model/3');
    assert(serialize(deserialize(saved)) === saved, 'миграция не даёт побайтового пересохранения');
    return `${m.elements.length} элемента, ${d.links.length} связь, члены разобраны на поля`;
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
  if (failed.length) {
    console.log('упали:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke: ', e.message);
  process.exit(1);
});