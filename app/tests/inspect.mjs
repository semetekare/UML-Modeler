// Diagnostic: open the app with a query, wait, print console errors and a few
// model counts. Exits by itself. `node tests/inspect.mjs "model=all&diagram=state"`.
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
const query = process.argv[2] || '';
const shot = process.argv[3] || '';

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
const base = `http://127.0.0.1:${server.address().port}/`;
const url = base + (query ? `?${query}` : '');

const home = process.env.HOME ?? '';
const bin = [
  `${home}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`,
  `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  `${home}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`,
  `${home}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
  `${home}/.hermes/tools/chromium-1208/chrome-linux64/chrome`,
].find((p) => existsSync(p));
if (!bin) { console.error('no chrome'); process.exit(1); }
const profile = await mkdtemp(path.join(tmpdir(), 'uml-insp-'));
const port = 9800 + Math.floor(Math.random() * 100);
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, '--window-size=1440,900', `--user-data-dir=${profile}`, url],
{ stdio: ['ignore', 'ignore', 'pipe'] });

let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); }
  } catch { /* starting */ }
}
if (!ws) { child.kill('SIGKILL'); console.error('no target'); process.exit(1); }
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Log.enable');
await sleep(2500);

const state = await evaluate(`(() => {
  const app = document.querySelector('#model');
  const svg = document.querySelector('#canvas');
  const bad = [];
  const nan = [];
  for (const g of svg.querySelectorAll('[data-kind="shape"]')) {
    const r = g.getBBox();
    const texts = [...g.querySelectorAll('text')];
    let maxW = 0;
    for (const t of texts) { try { maxW = Math.max(maxW, t.getBBox().width); } catch {} }
    const name = texts.map(t => t.textContent).join(' / ').slice(0, 40);
    if (maxW > r.width + 2) bad.push({ name, box: Math.round(r.width), text: Math.round(maxW) });
    for (const t of texts) {
      const b = t.getBBox();
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) nan.push(t.textContent);
      const gb = g.getBBox();
      if (b.y + b.height > gb.y + gb.height + 2 || b.y < gb.y - 2) {
        bad.push({ name: 'вертикально вне фигуры: ' + t.textContent.slice(0, 24), box: Math.round(gb.height), text: Math.round(b.y + b.height) });
      }
    }
  }
  return {
    title: document.title,
    shapes: svg ? svg.querySelectorAll('[data-kind="shape"]').length : -1,
    conns: svg ? svg.querySelectorAll('[data-kind="conn"]').length : -1,
    overflow: bad.slice(0, 12),
    nan: nan.slice(0, 5),
    hint: document.querySelector('#sb-hint')?.textContent ?? '',
    status: document.querySelector('#sb-count')?.textContent ?? '',
    strip: (() => {
      const s = document.querySelector('#toolstrip');
      return s ? { client: s.clientWidth, scroll: s.scrollWidth, chips: s.querySelectorAll('.tool').length } : null;
    })(),
    bodyScroll: { w: document.body.scrollWidth, h: document.body.scrollHeight, cw: document.body.clientWidth, ch: document.body.clientHeight },
  };
})()`);
console.log(JSON.stringify(state, null, 2));
const errs = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map((e) => `${e.params.entry.text} ${e.params.entry.url ?? ''}`);
for (const e of events.filter((e) => e.method === 'Runtime.exceptionThrown')) {
  errs.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
}
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
if (shot) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(ROOT, shot), Buffer.from(r.result.data, 'base64'));
  console.log('shot →', shot);
}
child.kill('SIGKILL');
await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
server.close();
process.exit(0);
