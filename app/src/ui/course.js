// Панель «Курс» — пособие ВМК МГУ внутри инструмента (план Э6).
//
// Данные готовит tools/build-course.mjs: course/index.json (главы →
// упражнения → рисунки), course/text/<id>.md (текст с метками [[fig:…]]) и
// course/figures/<номер>.uml.json (копия модели корпуса). Здесь только показ.
//
// ГДЕ ЧТО ЖИВЁТ. Курс — РЕЖИМ, а не панель (docs/research/UX-COURSE-LIBRARY.md §2.1):
// кнопка «Курс» в тулбаре открывает #course-mode — слой поверх листа внутри
// #work. Лист не теряет ширину (при 1440×900 он так и остаётся 856 px),
// инспектор справа не отбирается (вкладка «Курс» из правой колонки убрана), а
// выход есть в трёх местах: «✕ Закрыть» в шапке режима, Esc и «К листу» в
// подвале урока. Масштаб и выделение при выходе те же: режим их не трогает,
// он только перекрывает лист.
//
// НУМЕРАЦИЯ. Главы пособия в бумаге начинаются с 3 (1–2 — вводные), и курс,
// честно повторявший номера, выглядел оборванным. В интерфейсе главы и
// упражнения считаются с 1 (1, 2, 3 и 1.1, 1.2, 2.1 …), а номер пособия
// остаётся в данных (`number`) и показывается мелким «глава 3 пособия» — по
// нему ищут место в бумажной книге. Id и имена файлов не меняются.
//
// НАША КАРТИНКА. Эталон рисует наш же render.js из модели корпуса — то же,
// что человек увидит, открыв модель. Когда есть и модель, и снимок из пособия
// (reference/vp163/<номер>.png), они стоят РЯДОМ в уроке (слева наш
// рендер, справа снимок) — сравнивать надо бок о бок. Если места на две
// картинки нет (узкое окно), остаётся переключатель «Наши модели / Из
// пособия» в шапке режима; если снимка нет — наш рендер с пометкой «снимка
// нет».
//
// ПРОГРЕСС. Галочка «пройдено» живёт в localStorage (она общая для всех
// моделей) и в поле courseDone самой модели — так отметки уезжают вместе с
// файлом. Поле пишется только когда непусто (io/umljson.js), поэтому старые
// файлы пересохраняются побайтово.

import { el, clear } from '../util.js';
import { store, set, commit, loadModel } from '../state/store.js';
import { deserialize } from '../io/umljson.js';
import { typeOf } from '../model/notation.js';
import { renderCanvas, fitToWindow } from './canvas.js';
import { exportSvgString } from './render.js';
import { confirmDialog } from './dialog.js';
import { closeReference } from './reference.js';
import { icon } from './icons.js';
import { ScToast } from '../../ui-kit/js/toast.js';

const DONE_KEY = 'uml-course.done';
const SEL_KEY = 'uml-course.selected';
// Отдельный от модели ключ: «какие рисунки показывать» — настройка читателя,
// а не свойство файла, и в модель она не уезжает.
const FIG_KEY = 'uml-course.figures';
const INDEX_URL = 'course/index.json';

let index = null;               // course/index.json
let loadError = '';             // почему курс не загрузился
let selectedId = null;          // 'ex-3.1' или 'ch3' — что открыто в центре
let done = new Set();           // id пройденных упражнений
let figureMode = 'ours';        // 'ours' — наш рендер | 'source' — снимок пособия
let openFigs = null;            // рисунки открытого урока: переключатель их и перерисовывает
// Есть ли в уроке место на две картинки рядом. Решает ширину #course-view, а
// не окно: слева главы, и они отнимают свои 236 px (updatePairMode).
let pairMode = true;
const textCache = new Map();    // id → markdown
const svgCache = new Map();     // номер рисунка → SVG модели корпуса
const modelCache = new Map();   // путь → текст модели

/* --------------------------------------------------------------- состояние */

function readDone() {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch { return []; }
}

function writeDone() {
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...done].sort())); } catch { /* окно без хранилища */ }
}

function readFigureMode() {
  try {
    return localStorage.getItem(FIG_KEY) === 'source' ? 'source' : 'ours';
  } catch { return 'ours'; }
}

function writeFigureMode(mode) {
  try { localStorage.setItem(FIG_KEY, mode); } catch { /* окно без хранилища */ }
}

/** Отметки из файла модели — часть того же прогресса, а не второй счёт. */
function mergeModelDone() {
  const fromModel = Array.isArray(store.model?.courseDone) ? store.model.courseDone : [];
  for (const id of fromModel) done.add(String(id));
}

export const courseIndex = () => index;
export const selectedExercise = () => findExercise(selectedId);
export const courseDone = () => [...done].sort();
/** Курс открыт? (Режим, а не вкладка.) */
export const courseModeOpen = () => document.body.classList.contains('course-mode');
export const lessonOpen = courseModeOpen;

const allExercises = () => (index?.chapters ?? []).flatMap((c) => c.exercises);

function findExercise(id) {
  if (!id) return null;
  return allExercises().find((e) => e.id === id) ?? null;
}

function chapterOf(exOrId) {
  const id = typeof exOrId === 'string' ? exOrId : exOrId?.id;
  for (const ch of index?.chapters ?? []) {
    if (ch.id === id) return ch;
    if (ch.exercises.some((e) => e.id === id)) return ch;
  }
  return null;
}

/**
 * Номер для человека: главы 1, 2, 3 и упражнения 1.1, 1.2, 2.1 — по порядку в
 * курсе, а не по номерам пособия (там главы начинаются с 3).
 */
const chapterNo = (ch) => (index?.chapters ?? []).indexOf(ch) + 1;

function exerciseNo(ex) {
  const ch = chapterOf(ex);
  if (!ch) return ex?.number ?? '';
  return `${chapterNo(ch)}.${ch.exercises.indexOf(ex) + 1}`;
}

/* ------------------------------------------------------------------ загрузка */

export async function initCourse() {
  try {
    const res = await fetch(INDEX_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${INDEX_URL}: ${res.status}`);
    index = await res.json();
    loadError = '';
  } catch (e) {
    index = null;
    loadError = `Курс не загрузился: ${e.message}`;
  }
  mergeModelDone();
  figureMode = readFigureMode();
  try {
    const saved = localStorage.getItem(SEL_KEY);
    if (saved && (findExercise(saved) || chapterOf(saved))) selectedId = saved;
  } catch { /* окно без хранилища */ }
  renderCourse();
  renderFigureToggle();
  wireMode();
  updateBar();
}

/**
 * Шапка режима: «✕ Закрыть», значок курса и слежение за шириной урока.
 * Ширина решает, стоят ли две картинки рядом или работает запасной
 * переключатель «Наши модели / Из пособия» (§5.5).
 */
function wireMode() {
  const close = document.getElementById('course-close');
  if (close) close.addEventListener('click', () => closeCourse());
  const mark = document.getElementById('course-mark');
  if (mark && !mark.childNodes.length) mark.append(icon('ui-course', 18));
  const host = document.getElementById('course-mode');
  if (host && 'ResizeObserver' in window) {
    new ResizeObserver(() => updatePairMode()).observe(host);
  }

  // Esc выходит из режима курса из любого места, как Esc закрывает читалку.
  // Захват на window — раньше приложения: иначе Esc заодно снял бы выделение
  // и сбросил инструмент. Поле ввода и диалог оставляют Esc себе.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !courseModeOpen()) return;
    if (document.querySelector('sc-dialog[open]')) return;
    const a = document.activeElement;
    const field = !!a && (/^(input|textarea|select)$/i.test(a.tagName)
      || a.isContentEditable);
    if (field && !(a.tagName === 'INPUT' && a.type === 'checkbox')) return;
    e.preventDefault();
    e.stopPropagation();
    closeCourse();
  }, true);
}

async function loadText(ex) {
  if (textCache.has(ex.id)) return textCache.get(ex.id);
  const res = await fetch(ex.text, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${ex.text}: ${res.status}`);
  const text = await res.text();
  textCache.set(ex.id, text);
  return text;
}

async function loadModelText(path) {
  if (modelCache.has(path)) return modelCache.get(path);
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const text = await res.text();
  modelCache.set(path, text);
  return text;
}

/* --------------------------------------------------------------- прогресс */

export function toggleDone(id, value = null) {
  const on = value === null ? !done.has(id) : !!value;
  if (on) done.add(id); else done.delete(id);
  writeDone();
  // Та же отметка — в файл модели: иначе прогресс не уедет вместе с моделью.
  commit('Отметка упражнения', (m) => {
    const list = [...done].sort();
    if (list.length) m.courseDone = list;
    else delete m.courseDone;
  });
  renderCourse();
  syncLessonDone();
}

function syncLessonDone() {
  const box = document.getElementById('cv-done');
  if (box && selectedExercise()) box.checked = done.has(selectedExercise().id);
}

function updateProgress() {
  const host = document.getElementById('course-progress');
  if (!host) return;
  const total = allExercises().length;
  const n = allExercises().filter((e) => done.has(e.id)).length;
  host.textContent = total ? `${n} / ${total}` : '';
  host.title = total ? `Пройдено ${n} из ${total} упражнений` : '';
}

/**
 * Шапка режима: «Курс · глава N «…» · урок N.M» и счётчик пройденного.
 * Это пункт чек-листа «current location is clear»: место в курсе видно всегда,
 * даже когда урок прокручен до середины.
 */
function updateBar() {
  const place = document.getElementById('course-place');
  if (!place) return;
  const sel = selectedId ? (findExercise(selectedId) ?? chapterOf(selectedId)) : null;
  const ch = chapterOf(selectedId);
  let text = 'Курс';
  if (sel && ch) {
    text = selectedId === ch.id
      ? `Курс · глава ${chapterNo(ch)} «${ch.title}»`
      : `Курс · глава ${chapterNo(ch)} «${ch.title}» · урок ${exerciseNo(sel)}`;
  }
  place.textContent = text;
  place.title = text;
  updateProgress();
}

/** Две картинки рядом помещаются? Меряем урок, а не окно: слева ещё главы. */
const PAIR_MIN = 560;   // 2 × ~260 px картинки + отступы

function updatePairMode() {
  const view = lessonHost();
  const next = (view?.clientWidth ?? 0) >= PAIR_MIN;
  if (next === pairMode) return;
  pairMode = next;
  renderFigureToggle();
  refreshFigures();
}

/* ------------------------------------------------------------ список в панели */

export function renderCourse() {
  renderFigureToggle();
  updateBar();
  const host = document.getElementById('course-list');
  if (!host) return;
  if (!index) {
    clear(host);
    host.append(el('div', { class: 'empty', id: 'course-empty', text: loadError || 'Курс загружается…' }));
    return;
  }
  mergeModelDone();
  // Перерисовка не должна отбирать фокус у галочки, по которой только что
  // щёлкнули: запоминаем строку и возвращаем фокус на её флажок.
  const focused = document.activeElement?.closest?.('.node')?.dataset.ex ?? null;
  clear(host);
  const tree = el('div', { class: 'tree course-tree', role: 'tree', 'aria-label': 'Упражнения пособия' });
  for (const [ci, ch] of index.chapters.entries()) {
    tree.append(el('div', {
      class: `tree-group${selectedId === ch.id ? ' current' : ''}`,
      role: 'treeitem',
      tabindex: '0',
      title: `${ch.title} — глава ${ch.number} пособия`,
      onclick: () => openChapter(ch.id),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openChapter(ch.id); } },
    }, `${ci + 1}. ${ch.title}`));
    const ul = el('ul');
    for (const [ei, ex] of ch.exercises.entries()) {
      ul.append(el('li', { role: 'none' }, exerciseRow(ex, `${ci + 1}.${ei + 1}`)));
    }
    tree.append(ul);
  }
  host.append(tree);
  updateProgress();
  if (focused) host.querySelector(`.node[data-ex="${focused}"] input`)?.focus();
}

/**
 * Переключатель рисунков на весь курс: наш рендер или снимок пособия.
 * Живёт в шапке вкладки, а не в уроке: настройка одна для всех упражнений.
 */
function renderFigureToggle() {
  const host = document.getElementById('course-fig-toggle');
  if (!host) return;
  // Пара картинок рядом — норма (§5.5); переключатель нужен только там, где
  // на две не хватает места, и тогда он единственный способ увидеть снимок.
  host.hidden = pairMode;
  clear(host);
  if (pairMode) return;
  const btn = (mode, label, title) => el('button', {
    type: 'button',
    class: `cvt${figureMode === mode ? ' on' : ''}`,
    title,
    'aria-pressed': figureMode === mode ? 'true' : 'false',
    onclick: () => setFigureMode(mode),
  }, label);
  host.append(
    btn('ours', 'Наши модели', 'Показывать модели корпуса, нарисованные инструментом'),
    btn('source', 'Из пособия', 'Показывать снимки из пособия'),
  );
}

/** Сменить режим рисунков: запомнить и перерисовать открытый урок. */
export function setFigureMode(mode) {
  const next = mode === 'source' ? 'source' : 'ours';
  if (next === figureMode) return;
  figureMode = next;
  writeFigureMode(next);
  renderFigureToggle();
  refreshFigures();
}

export const figureSource = () => figureMode;

function refreshFigures() {
  if (!openFigs) return;
  const col = lessonHost()?.querySelector('.cv-figs');
  if (!col) return;
  clear(col);
  for (const f of openFigs.figs) col.append(figureBlock(f, openFigs.ex));
  if (!openFigs.figs.length) {
    col.append(el('div', { class: 'empty', text: 'У этого упражнения в пособии нет рисунков — только текст.' }));
  }
}

function exerciseRow(ex, shown) {
  const isDone = done.has(ex.id);
  const current = selectedId === ex.id;
  const label = ex.type ? (typeOf(ex.type)?.label ?? ex.type) : 'без диаграммы';
  const box = el('label', {
    class: 'ex-done',
    title: isDone ? 'Пройдено — снять отметку' : 'Отметить пройденным',
    onclick: (ev) => ev.stopPropagation(),
  }, el('input', {
    type: 'checkbox',
    checked: isDone ? true : null,
    'aria-label': `Упражнение ${shown}: пройдено`,
    onchange: (ev) => toggleDone(ex.id, ev.target.checked),
  }));
  return el('div', {
    class: `node${current ? ' current' : ''}${isDone ? ' done' : ''}${ex.missing ? ' nomodel' : ''}`,
    'data-ex': ex.id,
    role: 'treeitem',
    tabindex: '0',
    'aria-selected': current ? 'true' : 'false',
    title: `${shown}. ${ex.title} — ${label} (в пособии ${ex.number})`,
    onclick: () => openExercise(ex.id),
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openExercise(ex.id); } },
  },
  box,
  el('span', { class: 'ex-num', text: shown }),
  el('span', { class: 'nm', text: ex.title }),
  el('span', { class: 'dglyph' }, icon('ui-diagram', 12)));
}

/* ------------------------------------------------------------ режим курса */

/**
 * Войти в режим курса. Слой #course-mode лежит поверх #work: лист под ним
 * сохраняет и ширину, и масштаб, и выделение — их никто не трогает.
 */
function enterMode() {
  if (courseModeOpen()) return;
  // Библиотека стоит рядом с листом в #center; в режиме курса её место занято
  // уроком, поэтому вход в курс её закрывает (§5.2, п. 5 приёмки).
  closeReference();
  document.body.classList.add('course-mode');
  const host = document.getElementById('course-mode');
  if (host) host.hidden = false;
  updateBar();
  // Кнопка «Курс» — переключатель (aria-pressed): шапка должна узнать о входе,
  // кто бы его ни вызвал — кнопка, Ctrl+K или «Открыть как модель».
  set({});
  // Ширину урока знает только раскладка — меряем после того, как слой показан.
  requestAnimationFrame(() => { updatePairMode(); });
}

/** «Курс» в тулбаре: войти и вернуть то, что было открыто, а не пустой экран. */
export function openCourse() {
  enterMode();
  if (index) openCourseTab();
  else renderCourse();          // покажет «Курс не загрузился: …»
  set({});
  return true;
}

/**
 * Выйти из режима курса. Единственное действие над листом — renderCanvas():
 * если окно меняло размер, пока урок был открыт, лист пересчитается, но
 * масштаб и выделение останутся теми же (§5.2, п. 3 приёмки).
 */
export function closeCourse() {
  if (!courseModeOpen()) return false;
  document.body.classList.remove('course-mode');
  const host = document.getElementById('course-mode');
  if (host) {
    host.hidden = true;
    if (host.contains(document.activeElement)) document.activeElement.blur();
  }
  set({});
  renderCanvas();
  return true;
}

/** Старое имя: «К листу» в подвале урока теперь выходит из режима целиком. */
export const closeLesson = closeCourse;

/* ------------------------------------------------------------------- урок */

/** Открыть упражнение: текст, наш рендер и снимок пособия рядом, кнопки. */
export function openExercise(id) {
  const ex = findExercise(id);
  if (!ex) return;
  enterMode();
  selectedId = ex.id;
  rememberSelection();
  showLesson();
  const host = lessonHost();
  clear(host);
  renderLesson(ex);
  renderCourse();
}

/** Глава как текст: вступление, без картинки и без модели. */
export function openChapter(id) {
  const ch = chapterOf(id);
  if (!ch) return;
  enterMode();
  selectedId = ch.id;
  rememberSelection();
  showLesson();
  const host = lessonHost();
  clear(host);
  renderChapter(ch);
  renderCourse();
}

function rememberSelection() {
  try { localStorage.setItem(SEL_KEY, selectedId); } catch { /* окно без хранилища */ }
}

const lessonHost = () => document.getElementById('course-view');

/** «1 рисунок / 2 рисунка / 7 рисунков» — без кривых форм в шапке урока. */
function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function showLesson() {
  const host = lessonHost();
  if (!host) return;
  host.hidden = false;
}

/** Вкладка «Курс» нажата: вернуть то, что было открыто, а не пустой экран. */
export function openCourseTab() {
  if (!index) { renderCourse(); return; }
  enterMode();
  if (selectedId && (findExercise(selectedId) || chapterOf(selectedId))) {
    if (findExercise(selectedId)) openExercise(selectedId);
    else openChapter(selectedId);
    return;
  }
  // Первый вход: курс открывается с первой главы — иначе панель выглядела бы
  // пустой, пока не угадаешь, что нужно щёлкнуть строку.
  const first = index.chapters?.[0];
  if (first) openChapter(first.id);
}

function headFor({ crumb, title, meta }) {
  return el('div', { class: 'cv-head' },
    el('div', { class: 'cv-crumb', text: crumb }),
    el('h1', { class: 'cv-title', text: title }),
    el('div', { class: 'cv-meta' }, ...meta));
}

function renderLesson(ex) {
  const host = lessonHost();
  const ch = chapterOf(ex);
  const typeLabel = ex.type ? (typeOf(ex.type)?.label ?? ex.type) : 'без диаграммы';
  const figs = ex.figures ?? [];
  const shown = exerciseNo(ex);

  host.append(headFor({
    crumb: `Курс · ${ch ? `${chapterNo(ch)}. ${ch.title}` : ''}`,
    title: `Упражнение ${shown}. ${ex.title}`,
    meta: [
      el('span', { class: 'cv-type', text: typeLabel }),
      el('span', { class: 'cv-figcount', text: figs.length ? plural(figs.length, 'рисунок', 'рисунка', 'рисунков') : 'без рисунков' }),
      // Номер пособия — мелким и рядом: по нему сверяются с бумажной книгой.
      el('span', { class: 'cv-src', text: `в пособии ${ex.number}` }),
      el('label', { class: 'cv-done' },
        el('input', {
          type: 'checkbox', id: 'cv-done',
          checked: done.has(ex.id) ? true : null,
          onchange: (ev) => toggleDone(ex.id, ev.target.checked),
        }),
        ' пройдено'),
    ],
  }));

  const body = el('div', { class: 'cv-body' });
  const textCol = el('article', { class: 'cv-text' });
  textCol.append(el('div', { class: 'empty', text: 'Текст загружается…' }));
  const figsCol = el('aside', { class: 'cv-figs' });
  body.append(textCol, figsCol);
  host.append(body);

  // В подвале урока только «К листу»: «Открыть как модель» и «Оригинал в
  // пособии» живут у каждого рисунка (figureBlock) — там, где видно, к чему
  // они относятся. Дублировать их внизу владелец попросил убрать.
  host.append(el('div', { class: 'cv-foot' },
    el('button', { type: 'button', class: 'btn', id: 'cv-close', onclick: () => closeLesson() }, 'К листу'),
    ex.missing ? el('span', { class: 'cv-why', text: ex.missing }) : null));

  openFigs = { figs, ex };
  for (const f of figs) figsCol.append(figureBlock(f, ex));
  if (!figs.length) {
    figsCol.append(el('div', { class: 'empty', text: 'У этого упражнения в пособии нет рисунков — только текст.' }));
  }

  loadText(ex)
    .then((md) => { clear(textCol); textCol.append(markdown(md)); })
    .catch((e) => { clear(textCol); textCol.append(el('div', { class: 'empty', text: `Текст не загрузился: ${e.message}` })); });
}

function renderChapter(ch) {
  const host = lessonHost();
  const shown = chapterNo(ch);
  host.append(headFor({
    crumb: 'Курс',
    title: `${shown}. ${ch.title}`,
    meta: [
      el('span', { class: 'cv-type', text: plural(ch.exercises.length, 'упражнение', 'упражнения', 'упражнений') }),
      // Мелким: глава {number} пособия — так её ищут в бумажной книге, где
      // главы 1–2 были вводными.
      el('span', { class: 'cv-src', text: `глава ${ch.number} пособия` }),
    ],
  }));
  const body = el('div', { class: 'cv-body' });
  const textCol = el('article', { class: 'cv-text' });
  const figsCol = el('aside', { class: 'cv-figs' });
  body.append(textCol, figsCol);
  host.append(body);
  host.append(el('div', { class: 'cv-foot' },
    el('button', { type: 'button', class: 'btn', id: 'cv-close', onclick: () => closeLesson() }, 'К листу')));

  openFigs = null;
  const list = el('ul', { class: 'cv-toc' });
  for (const ex of ch.exercises) {
    list.append(el('li', {}, el('button', {
      type: 'button', class: 'linkbtn', onclick: () => openExercise(ex.id),
    }, `${exerciseNo(ex)}. ${ex.title}`)));
  }
  figsCol.append(el('div', { class: 'cv-toc-head', text: 'Упражнения главы' }), list);

  if (!ch.intro) {
    textCol.append(el('div', { class: 'empty', text: 'В этой главе нет вступительного текста.' }));
    return;
  }
  fetch(ch.intro, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${ch.intro}: ${r.status}`))))
    .then((md) => { clear(textCol); textCol.append(markdown(md)); })
    .catch((e) => { clear(textCol); textCol.append(el('div', { class: 'empty', text: `Текст не загрузился: ${e.message}` })); });
}

/* --------------------------------------------------------------- картинки */

function figureBlock(fig, ex) {
  const box = el('figure', { class: 'cv-fig', id: `fig-${fig.figure}` });
  const shot = fig.original || null;
  const cap = el('figcaption', { class: 'cv-cap' },
    el('b', { text: `Рис. ${fig.figureNo}.` }), ' ', fig.caption || fig.note || '');

  // Две картинки рядом — норма, когда есть оба источника и места хватает:
  // слева наш рендер модели, справа снимок из пособия. По очереди их
  // сравнивать нельзя — сравнение и есть смысл рисунка (§5.5).
  if (pairMode && fig.model && shot) {
    box.append(el('div', { class: 'cv-fig-pair' }, oursCell(fig, ex), shotCell(fig, shot)), cap);
    return box;
  }

  // Запасной путь (узкое окно) и рисунки с одним источником: одна картинка,
  // выбор — переключателем в шапке режима.
  const canvas = el('div', { class: 'cv-fig-canvas', id: `fig-svg-${fig.figure}` });
  box.append(canvas);
  box.append(cap);
  const links = el('div', { class: 'cv-fig-links' });

  // «Из пособия»: вместо нашего рендера — снимок из пособия. Снимка может
  // не быть (в пособии рисунок только описан) — тогда остаётся наш рендер с
  // честной пометкой, а не пустая рамка. И наоборот: если модели корпуса нет, а
  // снимок есть, показываем снимок — картинка полезнее пометки, а переключателя
  // в режиме пары может не быть вовсе.
  if (shot && (figureMode === 'source' || !fig.model)) {
    canvas.append(el('img', {
      class: 'cv-shot',
      src: shot,
      alt: `Рис. ${fig.figureNo} — снимок из пособия`,
      loading: 'lazy',
    }));
    cap.append(el('span', { class: 'cv-shot-note', text: 'снимок из пособия' }));
  } else {
    if (fig.model) drawFigure(fig, canvas);
    else {
      canvas.append(el('div', {
        class: 'cv-nomodel',
        text: 'Модели корпуса для этого рисунка нет — смотрите оригинал в пособии.',
      }));
    }
    if (figureMode === 'source' && !shot) {
      cap.append(el('span', { class: 'cv-shot-note', text: 'снимка нет' }));
    }
  }

  if (fig.model) {
    links.append(el('button', {
      type: 'button', class: 'linkbtn', title: 'Открыть этот рисунок как модель',
      onclick: () => openAsModel(ex.id, fig.figure),
    }, 'Открыть как модель'));
  }
  if (shot) {
    links.append(el('a', {
      class: 'linkbtn', href: shot, target: '_blank', rel: 'noopener',
      title: 'Снимок из пособия',
    }, 'Оригинал в пособии'));
  }
  if (links.childNodes.length) box.append(links);
  return box;
}

/** Левая половина пары: наш рендер модели и «Открыть как модель» под ним. */
function oursCell(fig, ex) {
  const cell = el('div', { class: 'cv-fig-src' });
  // id каретки рисунка остаётся здесь: scopeSvg() ограничивает стили экспорта
  // именно этим селектором, иначе `text{…}` перекрасил бы подписи всего окна.
  const canvas = el('div', { class: 'cv-fig-canvas', id: `fig-svg-${fig.figure}` });
  cell.append(canvas);
  drawFigure(fig, canvas);
  cell.append(el('div', { class: 'cv-fig-note', text: 'наш рендер модели' }));
  cell.append(el('div', { class: 'cv-fig-links' }, el('button', {
    type: 'button', class: 'linkbtn', title: 'Открыть этот рисунок как модель',
    onclick: () => openAsModel(ex.id, fig.figure),
  }, 'Открыть как модель')));
  return cell;
}

/** Правая половина пары: снимок из пособия и «Оригинал в пособии». */
function shotCell(fig, shot) {
  const cell = el('div', { class: 'cv-fig-src' });
  cell.append(el('div', { class: 'cv-fig-canvas' }, el('img', {
    class: 'cv-shot',
    src: shot,
    alt: `Рис. ${fig.figureNo} — снимок из пособия`,
    loading: 'lazy',
  })));
  cell.append(el('div', { class: 'cv-fig-note', text: 'снимок из пособия' }));
  cell.append(el('div', { class: 'cv-fig-links' }, el('a', {
    class: 'linkbtn', href: shot, target: '_blank', rel: 'noopener',
    title: 'Снимок из пособия',
  }, 'Оригинал в пособии')));
  return cell;
}

/**
 * Наша картинка: SVG из render.js по модели корпуса.
 *
 * Стили экспорта — обычные селекторы (`.sh-body`, `text`), а <style> внутри
 * вставленного <svg> действует на весь документ: `text{…}` перекрасил бы
 * подписи листа. Поэтому каждый селектор получает префикс с id блока, и
 * рисунок живёт в своей области — сам exportSvgString не меняется.
 */
async function drawFigure(fig, host) {
  try {
    let svg = svgCache.get(fig.figure);
    if (!svg) {
      const text = await loadModelText(fig.model);
      const model = deserialize(text);
      svg = scopeSvg(exportSvgString(model, store.profile), `#fig-svg-${fig.figure}`);
      svgCache.set(fig.figure, svg);
    }
    host.innerHTML = svg;
    const node = host.querySelector('svg');
    if (node) {
      node.removeAttribute('width');
      node.removeAttribute('height');
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', `Рис. ${fig.figureNo}. ${fig.caption || fig.note || ''}`.trim());
    }
  } catch (e) {
    clear(host);
    host.append(el('div', { class: 'cv-nomodel', text: `Рисунок не собрался: ${e.message}` }));
  }
}

/** Стили экспорта — под префиксом блока: только содержимое <style>, не разметка. */
function scopeSvg(svg, scope) {
  return svg.replace(/<style>([\s\S]*?)<\/style>/, (all, css) => `<style>${scopeCss(css, scope)}</style>`);
}

/** `text{…} .sh-body{…}` → `#id text{…} #id .sh-body{…}` (без @-правил). */
function scopeCss(css, scope) {
  return css.replace(/(^|})([^{}]+)\{/g, (all, brace, selectors) => {
    if (!selectors.trim() || selectors.trim().startsWith('@')) return all;
    const scoped = selectors.split(',').map((s) => `${scope} ${s.trim()}`).join(',');
    return `${brace}${scoped}{`;
  });
}

function showFigure(id) {
  const box = document.getElementById(`fig-${id}`);
  if (!box) return;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  box.classList.add('flash');
  setTimeout(() => box.classList.remove('flash'), 900);
}

/* ------------------------------------------------------------------- текст */

/**
 * Разметка пособия — маленькое подмножество Markdown: заголовки, абзацы,
 * списки, цитаты, `код`, *курсив*, **жирный** и метки рисунков [[fig:…]].
 * Всё остальное остаётся текстом: HTML из файла не исполняется.
 */
export function markdown(src) {
  const root = el('div', { class: 'cv-md' });
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    root.append(el('p', {}, ...inline(para.join(' '))));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flush(); i += 1; continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      flush();
      root.append(el(`h${Math.min(6, h[1].length + 2)}`, { class: 'cv-h' }, ...inline(h[2])));
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const ul = el('ul');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        ul.append(el('li', {}, ...inline(lines[i].replace(/^\s*[-*]\s+/, ''))));
        i += 1;
      }
      root.append(ul);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flush();
      // Пункты, разделённые только пустыми строками, — ОДИН список. В пособии
      // (и в его Markdown-выгрузке) между пунктами стоит пустая строка, и
      // старый цикл рвал на ней <ol>: каждый пункт становился списком из
      // одного элемента и получал номер 1.
      //
      // Список заканчивает только обычный текст — абзац, заголовок, цитата,
      // таблица. Вложенные подпункты (`- …`) и метки рисунков принадлежат
      // текущему пункту и счёт не сбрасывают: так записан пункт 1
      // «Дополнительной спецификации» с четырьмя вложенными правилами.
      const ol = el('ol');
      let item = null;
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) { i += 1; continue; }
        if (/^\s*\d+\.\s+/.test(cur)) {
          // Нумерует <ol> сам, по порядку в списке: числа в исходнике ничего
          // не значат (там они все `1.` — след HTML→Markdown).
          item = el('li', {}, ...inline(cur.replace(/^\s*\d+\.\s+/, '')));
          ol.append(item);
          i += 1;
          continue;
        }
        if (item && /^\s*[-*]\s+/.test(cur)) {
          let sub = [...item.children].find((c) => c.tagName === 'UL');
          if (!sub) { sub = el('ul'); item.append(sub); }
          sub.append(el('li', {}, ...inline(cur.replace(/^\s*[-*]\s+/, ''))));
          i += 1;
          continue;
        }
        if (item && /^\s*\[\[fig:/.test(cur)) {
          item.append(el('div', { class: 'cv-step' }, ...inline(cur)));
          i += 1;
          continue;
        }
        break;
      }
      root.append(ol);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      root.append(el('blockquote', {}, ...inline(quote.join(' '))));
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return root;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[\[fig:([\w.-]+)\|([^\]]+)\]\])/g;

function inline(text) {
  const out = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let m;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(el('code', { text: m[1].slice(1, -1) }));
    else if (m[2]) out.push(el('b', { text: m[2].slice(2, -2) }));
    else if (m[3]) out.push(el('i', { text: m[3].slice(1, -1) }));
    else {
      // Номер рисунка — в локальную константу: замыкание на `m` показало бы
      // последний рисунок текста для любой метки.
      const figure = m[5];
      const label = m[6];
      out.push(el('button', {
        type: 'button', class: 'fig-ref', title: `Показать рисунок ${figure}`,
        onclick: () => showFigure(figure),
      }, label));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* -------------------------------------------------------------- как модель */

/**
 * «Открыть как модель»: копия эталона в редакторе.
 *
 * Копия, а не файл корпуса: правки человека не должны портить эталон, поэтому
 * документ открывается без имени файла (store.ui.fileName = null) и «Сохранить»
 * спросит имя. Текущая модель не подменяется молча — при несохранённых правках
 * спрашиваем так же, как при открытии файла.
 */
export async function openAsModel(exId, figure = null) {
  const ex = findExercise(exId ?? selectedId);
  if (!ex) return false;
  // Без явного рисунка берём тот, что выбрал build-course: самый полный из
  // моделей упражнения (ex.figure), а не первую картинку по порядку.
  const figs = ex.figures ?? [];
  const fig = figure
    ? figs.find((f) => f.figure === figure && f.model)
    : (figs.find((f) => f.model && f.model === ex.figure) ?? figs.find((f) => f.model));
  if (!fig) {
    set({ hint: 'У этого упражнения нет модели корпуса — открывать нечего.' });
    return false;
  }
  if (store.ui.dirty && !await confirmDialog(
    'Открыть упражнение как модель?',
    'Несохранённые изменения текущей модели будут потеряны. Откроется копия эталона — сам эталон корпуса не изменится.',
    'Открыть',
  )) return false;

  try {
    const text = await loadModelText(fig.model);
    const model = deserialize(text);
    // Лист лежит под слоем режима, поэтому «Открыть как модель» выводит из
    // курса: иначе только что открытая копия осталась бы невидимой. Место в
    // курсе помнится (selectedId), вернуться — одно нажатие «Курс».
    closeCourse();
    loadModel(model, null);
    fitToWindow();
    renderCanvas();
    set({ hint: `Упражнение ${exerciseNo(ex)}, рис. ${fig.figureNo} — открыта копия эталона. Сохранить её можно под своим именем.` });
    ScToast.show(`Упражнение ${exerciseNo(ex)} открыто как модель`, { tone: 'success' });
    return true;
  } catch (e) {
    set({ hint: `Модель рисунка не открылась: ${e.message}` });
    await confirmDialog('Модель не открылась', e.message, 'Понятно');
    return false;
  }
}
