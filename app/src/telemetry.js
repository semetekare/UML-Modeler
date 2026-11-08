// Клиент счётчика событий: «какие команды нажимают», не «что написано в
// модели».
//
// ЗАЧЕМ. Владельцу нужно знать, живые ли функции: доходят ли до проверок,
// импортируют ли PlantUML, чем заканчивают работу. Ответ даёт список событий
// из docs/seo/SEO-PLAN.md §6.3 — и ничего больше.
//
// ДВА ЗАМКА, И ОБА ДОЛЖНЫ БЫТЬ ОТКРЫТЫ:
//   1. `cfg.enabled === true` — приходит только из stand-сборки
//      (`node build.mjs --stand`). В обычной сборке config — {enabled:false},
//      и track() выходит на первой строке: ни очереди, ни таймера, ни запроса.
//   2. `localStorage['uml.telemetry'] === 'on'` — явное «да» человека
//      (src/ui/consent.js). Отсутствие ключа и 'off' читаются как «нет».
//
// ЧТО УХОДИТ. Только имя события из белого списка ниже и только те ключи,
// которые для этого события перечислены. Значения проверяются по типу:
// строка-идентификатор — это [a-z0-9._-] до 32 символов, подпись правки —
// короткий текст без кавычек-ёлочек (всё внутри «…» вырезается: там могло бы
// оказаться имя правила проекта, то есть текст из файла модели). Ни модель,
// ни имена файлов, ни координаты, ни сообщения об ошибках наружу не идут.
//
// КАК УХОДИТ. Очередь до 20 событий, одна отправка `navigator.sendBeacon` на
// `cfg.endpoint` — ровно один POST с массивом событий. Триггеры: переполнение
// очереди, таймер 5 с, `pagehide`, `visibilitychange(hidden)`. Никакого
// `fetch`: страница не ждёт ответа и ничего не знает о приёмнике.
//
// СЕССИЯ. Случайный номер вкладки (`crypto.randomUUID`) в sessionStorage:
// закрыл вкладку — номера нет. Это не пользователь и не устройство, а одна
// вкладка; связать два визита по нему нельзя.
//
// ХРАНИЛИЩЕ. В приложении уже есть случай заблокированного localStorage
// (приватное окно, политика браузера), поэтому КАЖДОЕ обращение обёрнуто в
// try/catch: счётчик не имеет права уронить редактор.

import cfg from './telemetry.config.js';

const CONSENT_KEY = 'uml.telemetry';
const SESSION_KEY = 'uml.telemetry.session';
const MAX_QUEUE = 20;
const FLUSH_MS = 5000;

/**
 * Белый список: событие → его ключи и их вид.
 *
 * `slug`  — короткий идентификатор кода (id команды, тип диаграммы, раздел
 *           полки, значение темы). Всё это словарь приложения, не ввод.
 * `label` — подпись правки из кода; очищается от «…» и обрезается.
 * `int`   — конечное число в разумных пределах.
 * `bool`  — true/false.
 */
const EVENTS = {
  'app.open': { first: 'bool', theme: 'slug', brand: 'slug', w: 'int', h: 'int' },
  'perf.firstPaint': { ms: 'int' },
  command: { id: 'slug' },
  commit: { label: 'label' },
  'diagram.create': { type: 'slug' },
  'validation.run': { errors: 'int', warnings: 'int', ms: 'int' },
  'validation.fix': { rule: 'slug' },
  export: { format: 'slug' },
  'import.plantuml': { ok: 'bool', constructs: 'int' },
  'course.open': { n: 'int' },
  'course.step': { n: 'int' },
  'reference.open': { section: 'slug' },
  'theme.change': { value: 'slug' },
  'brand.change': { value: 'slug' },
  error: { code: 'slug' },
};

// Идентификатор кода: строчные латинские, цифры, точка, дефис, подчёркивание.
// До 48 знаков — самые длинные id правил стандарта (35) влезают, а произвольный
// текст из модели в этот алфавит не попадает: в нём есть кириллица и пробелы.
const SLUG = /^[a-z0-9][a-z0-9._-]{0,47}$/;
const LABEL_LIMIT = 40;
/** Разрешённые знаки подписи: буквы, цифры, пробел и простая пунктуация. */
const LABEL_JUNK = /[^\p{L}\p{N} .,:;()+\-/=«»…]/gu;

let queue = [];
let timer = 0;
let session = '';

/** Согласие человека; любая ошибка хранилища — «нет ключа», то есть «нет». */
function consentValue() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

/** Включён ли счётчик прямо сейчас: сборка разрешила И человек сказал «да». */
export function telemetryEnabled() {
  return cfg.enabled === true && consentValue() === 'on';
}

/** Номер вкладки: sessionStorage (умирает с вкладкой), иначе — в памяти. */
function sessionId() {
  if (session) return session;
  try {
    const kept = sessionStorage.getItem(SESSION_KEY);
    if (kept) { session = kept; return session; }
  } catch { /* хранилище закрыто — номер останется в памяти */ }
  let made = '';
  try {
    made = (globalThis.crypto?.randomUUID?.() ?? '').toString();
  } catch { made = ''; }
  if (!made) made = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  session = made;
  try { sessionStorage.setItem(SESSION_KEY, session); } catch { /* см. выше */ }
  return session;
}

/** Привести одно значение к разрешённому виду; undefined — выбросить ключ. */
function clean(kind, value) {
  if (kind === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (kind === 'int') {
    return Number.isFinite(value) && Math.abs(value) <= 1e7 ? Math.round(value) : undefined;
  }
  if (kind === 'slug') {
    const text = String(value ?? '');
    return SLUG.test(text) ? text : undefined;
  }
  if (kind === 'label') {
    // «…» — единственное место, где в подпись мог бы попасть текст модели
    // (имя правила проекта, имя элемента): содержимое вырезается целиком.
    const text = String(value ?? '').replace(/«[^»]*»/g, '«…»').replace(LABEL_JUNK, '').trim();
    if (!text) return undefined;
    return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
  }
  return undefined;
}

/**
 * Записать событие. `name` — только имя из белого списка; неизвестное имя или
 * выключенный счётчик означают «ничего не произошло» и не стоят ни одной
 * миллисекунды вызывающему коду.
 */
export function track(name, k = {}) {
  if (!telemetryEnabled()) return false;
  const spec = EVENTS[name];
  if (!spec) return false;
  const payload = {};
  for (const [key, kind] of Object.entries(spec)) {
    if (!(key in k)) continue;
    const value = clean(kind, k[key]);
    if (value !== undefined) payload[key] = value;
  }
  queue.push({ v: 1, s: sessionId(), e: name, k: payload });
  if (queue.length >= MAX_QUEUE) { flush(); return true; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_MS);
  return true;
}

/**
 * Отправить очередь ОДНИМ запросом. Без sendBeacon (старый браузер, тестовый
 * стенд) события просто не отправляются: запасного `fetch` нет намеренно —
 * второй путь доставки означал бы второй адрес, который надо охранять.
 */
export function flush() {
  if (timer) { clearTimeout(timer); timer = 0; }
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  if (!cfg.endpoint) return;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  try {
    navigator.sendBeacon(cfg.endpoint, new Blob([JSON.stringify(batch)], { type: 'application/json' }));
  } catch { /* сеть закрыта — событие теряется, редактор продолжает работать */ }
}

/**
 * Записать выбор человека. Зовётся из UI согласия (src/ui/consent.js) и из
 * теста; других путей записи ключа нет.
 */
export function setTelemetryChoice(choice) {
  const value = choice === 'on' ? 'on' : 'off';
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* хранилище закрыто */ }
  if (value !== 'on') {
    queue = [];
    if (timer) { clearTimeout(timer); timer = 0; }
  }
  return value;
}

// Отправка на уходе со страницы. Слушатели ставятся один раз и только там, где
// есть окно: модуль импортируют и Node-тесты (store.js → telemetry.js).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}