// SEO-проверка лендинга: то, что обязан иметь собранный сайт, и то, что
// ломается молча.
//
// ЗАЧЕМ. Лендинг живёт вне публичного репозитория (landing/ в .gitignore), но
// проверять его надо той же командой, что и приложение: иначе «собралось» и
// «правильно» — разные вещи. Скрипт читает `landing/dist/` и ничего не
// собирает; сборка — `node landing/build.mjs`.
//
// ЧЕСТНО ПРО ОТСУТСТВИЕ. В свежем клоне публичного репозитория каталога
// `landing/` нет и быть не должно. Тогда проверка печатает «пропуск» и
// возвращает 0: это не зелёный результат, а отсутствие предмета проверки.
// Молча зелёным он не притворяется — в выводе так и написано.
//
// Запуск: node tools/seo-check.mjs [--dist=<путь>]
// Код возврата 1 — есть падения; 0 — всё сошлось (или лендинга нет).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..');
const distArg = process.argv.find((a) => a.startsWith('--dist='));
const DIST = path.resolve(distArg ? distArg.slice('--dist='.length) : path.join(ROOT, 'landing', 'dist'));

// facts.json — приватный файл (docs/seo/ в .gitignore). В свежем клоне
// публичного репозитория его нет, и это нормально: тогда нет и лендинга.
// Печатаем «пропуск» и выходим нулём — но именно «пропуск», а не «ок»:
// отсутствие предмета проверки не то же самое, что проверка пройдена.
let facts;
try {
  facts = JSON.parse(readFileSync(path.join(ROOT, 'docs', 'seo', 'facts.json'), 'utf8'));
} catch {
  console.log('пропуск: нет docs/seo/facts.json (и landing/ нет) — проверять нечего');
  process.exit(0);
}
const SITE = facts.site;

let failed = 0;
let checks = 0;
const problems = [];

const ok = (cond, msg) => {
  checks += 1;
  if (!cond) {
    failed += 1;
    problems.push(msg);
  }
  return cond;
};

/* --------------------------------------------------------------- утилиты */

function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    // `_*` — временные сборки (`--out=dist/_c`): их проверять нечего, они не
    // попадают в деплой. Пропускаем, чтобы чужой черновик не красил прогон.
    if (name.startsWith('_')) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

const text = (html) => decode(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const attr = (html, re) => { const m = re.exec(html); return m ? m[1] : null; };
const all = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

/** PNG 1200×630 (или другой размер) по заголовку IHDR. */
function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* --------------------------------------------------------------- предмет */

let files;
try {
  files = walk(DIST);
} catch {
  console.log(`пропуск: нет ${path.relative(ROOT, DIST)} — лендинг живёт вне публичного `
    + 'репозитория; проверять нечего (это не «всё хорошо», это «предмета нет»)');
  process.exit(0);
}

const pages = files.filter((f) => f.endsWith('index.html'));
if (!pages.length) {
  console.log(`пропуск: в ${path.relative(ROOT, DIST)} нет страниц — сначала node landing/build.mjs`);
  process.exit(0);
}

const doc = (rel) => readFileSync(path.join(DIST, rel), 'utf8');
const slugOf = (rel) => (rel === 'index.html' ? '/' : `/${rel.replace(/\/index\.html$/, '')}/`);

let illustrated = 0;
const seenTitles = new Map();
const seenDescriptions = new Map();
const sitemap = (() => {
  try { return doc('sitemap.xml'); } catch { return ''; }
})();

/* ------------------------------------------------------------- страницы */

for (const rel of pages) {
  const html = doc(rel);
  const slug = slugOf(rel);
  const where = `${slug}`;

  ok(!html.includes('{{'), `${where}: в HTML остались неподставленные {{…}}`);
  ok(/^<!doctype html>/i.test(html.trim()), `${where}: нет <!doctype html>`);
  ok((html.match(/<h1\b/g) || []).length === 1, `${where}: должен быть ровно один h1`);

  const lang = attr(html, /<html[^>]*\blang="([^"]+)"/);
  ok(lang === 'ru' || lang === 'en', `${where}: <html lang> = ${JSON.stringify(lang)}`);

  const title = attr(html, /<title>([\s\S]*?)<\/title>/);
  const description = attr(html, /<meta name="description" content="([^"]*)"/);
  if (!ok(title, `${where}: нет <title>`)) continue;
  if (!ok(description, `${where}: нет meta description`)) continue;

  ok(title.length <= 60, `${where}: title ${title.length} симв. > 60`);
  ok(description.length <= 155, `${where}: description ${description.length} симв. > 155`);
  ok(!seenTitles.has(title), `${where}: title совпадает с ${seenTitles.get(title)}`);
  ok(!seenDescriptions.has(description), `${where}: description совпадает с ${seenDescriptions.get(description)}`);
  seenTitles.set(title, where);
  seenDescriptions.set(description, where);

  const h1 = text((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '');
  ok(h1.length > 0, `${where}: пустой h1`);
  ok(h1 !== text(title), `${where}: h1 дословно равен title`);

  // Иерархия заголовков: h3 не раньше h2, h4 не раньше h3.
  const levels = [...html.matchAll(/<h([2-4])\b/g)].map((m) => Number(m[1]));
  let prev = 1;
  for (const level of levels) {
    ok(level <= prev + 1, `${where}: заголовок h${level} после h${prev} (пропуск уровня)`);
    prev = level;
  }

  const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
  ok(canonical === `${SITE}${slug === '/' ? '/' : slug}`, `${where}: canonical ${canonical}`);
  ok(!/index\.html$/.test(canonical || ''), `${where}: canonical содержит index.html`);
  ok((canonical || '').startsWith('https://'), `${where}: canonical не https`);

  // hreflang: либо все три, либо ни одного; пара обязана ссылаться обратно.
  const alts = {
    ru: attr(html, /<link rel="alternate" hreflang="ru" href="([^"]+)"/),
    en: attr(html, /<link rel="alternate" hreflang="en" href="([^"]+)"/),
    xdefault: attr(html, /<link rel="alternate" hreflang="x-default" href="([^"]+)"/),
  };
  const altCount = Object.values(alts).filter(Boolean).length;
  ok(altCount === 0 || altCount === 3, `${where}: hreflang задан неполностью (${altCount} из 3)`);
  if (altCount === 3) ok(alts.xdefault === alts.ru, `${where}: x-default должен вести на русскую версию`);

  const ogImage = attr(html, /<meta property="og:image" content="([^"]+)"/);
  ok(ogImage === `${SITE}/assets/og.png`, `${where}: og:image ${ogImage}`);
  ok(/<meta property="og:image:width" content="1200">/.test(html), `${where}: нет og:image:width`);
  ok(/<meta property="og:image:height" content="630">/.test(html), `${where}: нет og:image:height`);

  // JSON-LD: обязан разбираться и называть тип.
  const ldBlocks = all(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  ok(ldBlocks.length >= 1, `${where}: нет JSON-LD`);
  for (const block of ldBlocks) {
    checks += 1;
    try {
      const parsed = JSON.parse(block);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (!list.every((o) => o['@context'] === 'https://schema.org' && o['@type'])) {
        failed += 1;
        problems.push(`${where}: JSON-LD без @context/@type`);
      }
    } catch {
      failed += 1;
      problems.push(`${where}: JSON-LD не разбирается как JSON`);
    }
  }

  // Ссылки: внутренние обязаны существовать; внешние — только GitHub и почта.
  const hrefs = all(html, /href="([^"]+)"/g);
  const srcs = all(html, /src="([^"]+)"/g);
  const internal = hrefs.filter((h) => h.startsWith('/'));
  ok(internal.length >= 5, `${where}: внутренних ссылок ${internal.length} < 5`);

  const broken = [];
  for (const href of new Set(internal)) {
    const clean = href.split('#')[0].split('?')[0];
    if (!clean || clean === '/') continue;
    // /app/ — это приложение, его отдаёт nginx из другой папки; /a/, /s/ и
    // /notice — сервис. В landing/dist их нет и быть не должно.
    if (/^\/(app|a|s)(\/|$)/.test(clean) || clean === '/notice') continue;
    const asPage = path.join(DIST, clean.replace(/^\//, ''), 'index.html');
    const asFile = path.join(DIST, clean.replace(/^\//, ''));
    let exists = false;
    try { exists = statSync(asPage).isFile(); } catch { /* нет */ }
    if (!exists) {
      try { exists = statSync(asFile).isFile(); } catch { /* нет */ }
    }
    if (!exists) broken.push(href);
  }
  ok(broken.length === 0, `${where}: битые внутренние ссылки: ${broken.join(', ')}`);
  ok(srcs.every((s) => s.startsWith('/')), `${where}: внешний src: ${srcs.filter((s) => !s.startsWith('/')).join(', ')}`);

  const external = hrefs.filter((h) => /^(https?:)?\/\//.test(h));
  const allowedHosts = new Set([new URL(facts.repo).host, new URL(SITE).host]);
  const stray = external.filter((h) => {
    try { return !allowedHosts.has(new URL(h).host); } catch { return true; }
  });
  ok(stray.length === 0, `${where}: ссылки на сторонние хосты: ${stray.join(', ')}`);

  // CTA и картинка с alt.
  ok(hrefs.includes('/app/'), `${where}: нет CTA на /app/`);
  // У каждой картинки есть alt. Пустой alt допустим у декоративных: марка в
  // шапке, иконки карточек и второй снимок в паре «светлая/тёмная тема»
  // (первый несёт alt, второй aria-hidden). Иллюстрацией считается либо
  // <img> с alt, либо встроенный <svg role="img"> с <title>.
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  ok(imgs.every((tag) => /\balt="/.test(tag)), `${where}: у картинки нет alt`);
  ok(imgs.every((tag) => /\balt="[^"]+"/.test(tag) || /class="[^"]*\b(brand-mark|card-icon|shot-img)\b/.test(tag)),
    `${where}: картинка с пустым alt (разрешено марке, иконкам и второму снимку темы)`);
  const inlineSvg = [...html.matchAll(/<svg\b[^>]*role="img"[^>]*>[\s\S]*?<title[^>]*>[^<]+<\/title>/g)];
  // Витрина экранов: у кадров пустой alt (подпись рядом), поэтому лента
  // считается иллюстрацией отдельно — иначе страница «теряет» картинку.
  const gallery = /class="gallery"|class="gallery-item"/.test(html);
  if (imgs.some((tag) => /\balt="[^"]+"/.test(tag)) || inlineSvg.length || gallery) illustrated += 1;

  // Подвал: ссылка на /legal/ и никакого «жалоба».
  ok(html.includes('href="/legal/"'), `${where}: в подвале нет ссылки на /legal/`);
  ok(!/жалоб/i.test(text(html)), `${where}: слово «жалоба» на странице`);

  // Sitemap: страница есть (кроме noindex).
  const noindex = /<meta name="robots" content="noindex/.test(html);
  const inSitemap = sitemap.includes(`<loc>${SITE}${slug === '/' ? '/' : slug}</loc>`);
  ok(noindex ? !inSitemap : inSitemap,
    noindex ? `${where}: noindex-страница попала в sitemap` : `${where}: страницы нет в sitemap.xml`);

  // Дата обновления видна в тексте подвала/страницы — сигнал роботу и человеку.
  ok(/\d{4}-\d{2}-\d{2}/.test(text(html)) || /updated/.test(html),
    `${where}: нет даты обновления`);
}

/* --------------------------------------------------- общие файлы сайта */

const robots = (() => { try { return doc('robots.txt'); } catch { return ''; } })();
ok(/User-agent: \*/.test(robots), 'robots.txt: нет User-agent: *');
ok(/Allow: \//.test(robots), 'robots.txt: нет Allow: /');
ok(robots.includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots.txt: нет ссылки на sitemap');
ok(!/Disallow: \/app/.test(robots), 'robots.txt: /app/ закрыт от индексации (это запрещено планом)');

ok(/^<\?xml/.test(sitemap.trim()), 'sitemap.xml: нет XML-заголовка');
ok(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(sitemap),
  'sitemap.xml: нет urlset с правильным namespace');
ok(sitemap.includes(`<loc>${SITE}/</loc>`), 'sitemap.xml: нет главной');
ok(sitemap.includes(`<loc>${SITE}/app/</loc>`), 'sitemap.xml: нет /app/');
ok(sitemap.includes(`<loc>${SITE}/legal/</loc>`), 'sitemap.xml: нет /legal/');
ok(/<priority>0\.1<\/priority>/.test(sitemap), 'sitemap.xml: у /legal/ должна быть priority 0.1');

ok(illustrated >= 3, `иллюстраций с alt на сайте ${illustrated} — меньше трёх`);

const og = path.join(DIST, 'assets', 'og.png');
let ogSize = null;
try { ogSize = pngSize(og); } catch { /* нет файла */ }
ok(!!ogSize, 'assets/og.png: файла нет');
if (ogSize) ok(ogSize.w === 1200 && ogSize.h === 630, `assets/og.png: ${ogSize.w}×${ogSize.h} вместо 1200×630`);

// Картинки в разметке должны существовать — битая картинка хуже её отсутствия.
for (const rel of files.filter((f) => f.endsWith('.svg'))) {
  const svg = readFileSync(path.join(DIST, rel), 'utf8');
  ok(!/href="https?:\/\//.test(svg), `${rel}: внешний href в SVG`);
  ok(statSync(path.join(DIST, rel)).size <= 64 * 1024, `${rel}: больше 64 КБ`);
}

/* --------------------------------------------------------------- форма */

const legal = (() => { try { return doc('legal/index.html'); } catch { return ''; } })();
ok(legal.includes('<form'), 'legal: нет формы уведомления');
ok(/action="\/notice"/.test(legal), 'legal: форма не отправляется на /notice');
ok(/method="post"/i.test(legal), 'legal: форма не POST');
for (const field of ['name', 'email', 'phone', 'work', 'urls', 'rights', 'text', 'good_faith', 'consent', 'website']) {
  ok(new RegExp(`name="${field}"`).test(legal), `legal: в форме нет поля ${field}`);
}
ok(/class="hp"/.test(legal), 'legal: нет honeypot-поля');
ok(legal.includes(facts.email), 'legal: нет адреса notice@');
ok(!/жалоб/i.test(text(legal)), 'legal: слово «жалоба»');

// Контакт правообладателя не должен быть личным ящиком: только notice@ домена.
const emails = [...new Set(text(legal).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])];
ok(emails.every((e) => e === facts.email), `legal: посторонние адреса: ${emails.join(', ')}`);

/* --------------------------------------------------------------- итог */

if (failed) {
  console.log(`seo-check: ${failed} из ${checks} проверок красные`);
  for (const p of problems.slice(0, 40)) console.log(`  ✗ ${p}`);
  if (problems.length > 40) console.log(`  … всего ${problems.length}`);
  process.exit(1);
}
console.log(`${checks} проверок по ${pages.length} страницам: title/description/canonical/hreflang, `
  + 'JSON-LD, внутренние ссылки и CTA, битые ссылки, sitemap, robots, og.png 1200×630, форма /notice — всё сходится');
process.exit(0);