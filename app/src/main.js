// Application entry point: wiring, keyboard, file open, autosave recovery.
// Same shape as the reference modeler's main: render everything on store
// changes, keep focus while typing, own the keyboard when no dialog is up.

import {
  store, set, subscribe, undo, redo, loadModel, markClean, readAutosave, commit, selectionKind,
} from './state/store.js';
import {
  initCanvas, renderCanvas, fitToWindow, zoomStep, cancelInlineEdit,
  startEditSelected, flushEdits, deleteSelection, deleteElementFromModel,
  deleteRelationshipFromModel, setZoom, deleteWaypoint, targetAt, segmentAt,
} from './ui/canvas.js';
import { copySelection, cutSelection, pasteClipboard, duplicateSelection } from './ui/clipboard.js';
import { renderModel, renderProps, renderProfile, renderStatus as renderStatusBar, initPanels } from './ui/panels.js';
import {
  renderChecks, attachRuleset, attachRulesError, refreshChecks, checkResult,
  openChecksPanel, gotoFinding,
} from './ui/checks.js';
import { loadRules, ruleset } from './rules/index.js';
import { renderToolbar, saveCurrent, loadSample, currentBrand } from './ui/toolbar.js';
import { renderToolstrip } from './ui/toolstrip.js';
import { exportSvgString, exportPngBlob } from './ui/render.js';
import {
  initCourse, renderCourse, openCourseTab, closeCourse, courseModeOpen,
  openCourse, openExercise, openChapter, openAsModel, toggleDone, courseIndex, courseDone,
  selectedExercise,
} from './ui/course.js';
import { initIcons } from './ui/icons.js';
import { initFavicon } from './ui/favicon.js';
// Экран «Начало работы»: приглашение вместо готового примера (src/welcome.css).
import { initWelcome, renderWelcome, showWelcome } from './ui/welcome.js';
import { initReference, reference, openNotation, openStandardShelf } from './ui/reference.js';
// Реестр констрейнтов: рисовальщик переехал на полку «Стандарт» библиотеки,
// а замер для проверок остался тем же — `standardReport()`.
import { standardReport } from './ui/standard.js';
import { confirmDialog, modalOpen, showRepairs } from './ui/dialog.js';
import { initCommands } from './ui/commands.js';
import { deserialize, serialize } from './io/umljson.js';
import {
  createModel, currentDiagram, createDiagram, placeElement, createRelationship, createLink,
  childrenOf, rootsOf, setOwner, ownerCandidates, messageOrder, isMessage,
  regionMembers, regionsOf, qualifiersOf, internalsOf, removeElement,
} from './model/model.js';
import { loadProfile } from './io/stereotypes.js';
import { loadNotation, NOTATION, keyFor } from './model/notation.js';
import { selfRuleOf, selfRuleOfRelationship, selfRefusal } from './model/connector-style.js';
import { applyLayoutMetrics } from './ui/theme.js';
import { resolveMode } from './ui/appearance.js';
// Счётчик событий: клиент выключен по умолчанию и в обычной сборке не делает
// ни одного запроса. Здесь только точки вызова из белого списка (§6.3) и
// строка согласия — она появляется лишь тогда, когда сборка разрешила счётчик.
import { track } from './telemetry.js';
import { initConsent } from './ui/consent.js';
import { showError } from './ui/dialog.js';
import { plural } from './util.js';
import { importPumlFile, importPumlText, openPasteDialog, showWarnings } from './ui/import-puml.js';
import { ScToast } from '../ui-kit/js/toast.js';
import { buildAllTypesModel } from './model/sample.js';

/**
 * The tool a keyboard letter selects. The letters belong to the diagram TYPE
 * (a Class diagram has C for class, a State diagram has S for state), so this
 * reads the active diagram at call time.
 */
/** Opening zoom cap: see the note at the setZoom call in start(). */
const SAMPLE_ZOOM_CAP = 0.75;

/* --------------------------------------------------------------- счётчик */

/**
 * Сбои приложения — одним событием `error {code}`. Код, а не сообщение: текст
 * исключения может содержать имя файла или обрывок модели, и ему нечего делать
 * в счётчике (docs/seo/SEO-PLAN.md §6.3). Обработчики ставятся один раз —
 * модуль вычисляется один раз.
 */
window.addEventListener('error', () => track('error', { code: 'window.error' }));
window.addEventListener('unhandledrejection', () => track('error', { code: 'unhandledrejection' }));

/**
 * `brand.change {value}`.
 *
 * Смена акцента живёт в toolbar.js (`applyBrand`), а её единственный общий
 * след — атрибут `data-brand` на <html>: по нему считает CSS, его ставит
 * index.html до первой отрисовки. Наблюдаем за атрибутом, а не за функцией:
 * так событие одно на все входы (меню «Акцент», тесты, будущие вызовы) и не
 * требует править чужой файл ради одной строки.
 */
{
  let seenBrand = currentBrand();
  new MutationObserver(() => {
    const value = currentBrand();
    if (value === seenBrand) return;
    seenBrand = value;
    track('brand.change', { value });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-brand'] });
}

function keyTool(key) {
  const lower = String(key).toLowerCase();
  if (lower === 'v') return 'select';
  const d = currentDiagram(store.model);
  for (const tool of Object.keys(NOTATION.shapes)) {
    if (keyFor(d?.kind, tool).toLowerCase() === lower) return tool;
  }
  for (const tool of Object.keys(NOTATION.connectors)) {
    if (keyFor(d?.kind, tool).toLowerCase() === lower) return tool;
  }
  return undefined;
}

/* ------------------------------------------------------------------ tabs */

for (const group of document.querySelectorAll('.panel-tabs')) {
  group.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const pane = group.parentElement;
    for (const t of group.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
    for (const p of pane.querySelectorAll('.tabpane')) p.classList.toggle('active', p.id === tab.dataset.tab);
    // The checks panel runs on open, not only on the button: the person came
    // to it to see the verdict on the model as it is now.
    if (tab.dataset.tab === 'checks') refreshChecks();
  });
}

/**
 * Вход в реестр констрейнтов из панели «Проверки».
 *
 * Зачем: увидев «невыразимо» или «не хватает поля», человек спрашивает «а что
 * вообще требует стандарт и почему это не проверяется» — ответ лежит в
 * реестре 449 констрейнтов на полке «Стандарт». Без входа оттуда он его не
 * найдёт: панель говорит о модели, реестр — о стандарте.
 *
 * Почему не в разметке checks.js: это чужая зона правки (там параллельно
 * работает другой агент). renderChecks() чистит #checks при каждой
 * перерисовке («Проверить», фильтр, смена модели), поэтому статическая строка
 * исчезла бы; ссылка досыпается наблюдателем после каждой перерисовки.
 */
function decorateChecks() {
  const host = document.getElementById('checks');
  if (!host || host.querySelector('#checks-standard-link')) return;
  const link = document.createElement('button');
  link.type = 'button';
  link.id = 'checks-standard-link';
  link.className = 'checks-std-link';
  link.title = 'Реестр констрейнтов UML 2.5.1: что стандарт требует и что из этого проверяется';
  link.textContent = 'Почему правило не проверяется — реестр констрейнтов';
  // Отказ библиотеки (узкое окно, не загрузились данные) не должен молчать:
  // причина уходит в подсказку статусбара, как у остальных входов в читалку.
  link.addEventListener('click', () => {
    openStandardShelf().catch((e) => set({ hint: `Реестр не открылся: ${e.message}` }));
  });
  host.append(link);
}
{
  const checksHost = document.getElementById('checks');
  if (checksHost) new MutationObserver(decorateChecks).observe(checksHost, { childList: true });
  decorateChecks();
}

/* -------------------------------------------------------------- rendering */

const typing = () => {
  const a = document.activeElement;
  return !!a && (/^(input|textarea|select)$/i.test(a.tagName) || a.isContentEditable);
};

/**
 * Статусбар: обычные числа модели, а в пустой модели — что делать.
 *
 * «элементы 0 · фигуры 0 · связи 0» — правда, но не ответ на вопрос «и что
 * теперь?». Пустой старт — это приглашение, и статусбар говорит то же самое
 * словами. Числа возвращаются сами, как только появилась первая диаграмма.
 */
function renderStatus() {
  renderStatusBar();
  if ((store.model.diagrams ?? []).length) return;
  const count = document.getElementById('sb-count');
  if (count) count.textContent = 'Модель пуста — создайте диаграмму';
}

/**
 * Rebuild the panels. A pane the user is typing in is left alone — replacing
 * its DOM would drop focus, the caret and the value not yet committed.
 */
function renderAll() {
  const focused = typing() ? document.activeElement : null;
  const holdsFocus = (id) => focused && document.getElementById(id)?.contains(focused);
  const scrolls = [...document.querySelectorAll('.panel-body')].map((n) => [n, n.scrollTop]);

  renderToolbar();
  renderToolstrip();
  if (!holdsFocus('model')) renderModel();
  if (!holdsFocus('props')) renderProps();
  if (!holdsFocus('profile')) renderProfile();
  if (!holdsFocus('checks')) renderChecks();
  // Курс живёт в своём слое; перерисовываем список, только если фокус не в нём
  // (иначе галочка «пройдено», по которой только что щёлкнули, потеряла бы его).
  if (!holdsFocus('course-list')) renderCourse();
  // Приглашение первого запуска — поверх листа; видно, пока в модели ноль
  // диаграмм. Идёт ПЕРЕД статусбаром: экран снимает устаревшую подсказку
  // «Создана «…»», если создание отменили (Ctrl+Z), и статусбар должен
  // прочитать уже очищенное значение.
  renderWelcome();
  renderStatus();

  for (const [n, top] of scrolls) n.scrollTop = top;
}

subscribe((_s, meta) => {
  if (meta?.light) { renderStatus(); renderCanvas(); return; }
  renderAll();
  renderCanvas();
});

/* ------------------------------------------------------------------ files */

async function openFile(file) {
  if (store.ui.dirty && !await confirmDialog(`Открыть ${file.name}?`, 'Несохранённые изменения текущей модели будут потеряны.', 'Открыть')) return;
  try {
    const text = await file.text();
    // Профиль передаётся, если уже загружен: тогда битая ссылка на запись
    // стереотипа снимается с записью в `repairs`, а имя остаётся. Профиля
    // нет — проверять нечем, и файл всё равно открывается.
    const repairs = [];
    const meta = {};
    const model = deserialize(text, { repairs, profile: store.profile, meta });
    cancelInlineEdit();
    loadModel(model, file.name);
    fitToWindow();
    renderCanvas();
    set({ hint: repairs.length
      ? `Открыт ${file.name}: замечаний ${repairs.length} — ${repairs[0]}`
      : `Открыт ${file.name}` });
    // Обрыв файла — не мелочь: человек должен узнать и о нём, и о числе
    // исправлений, и иметь возможность прочитать список, а не одну строку
    // в статусбаре. Тост с «Подробностями» показывается на ЛЮБОЙ ремонт.
    if (repairs.length) {
      ScToast.show(
        `Файл прочитан с исправлениями: ${repairs.length}. Модель открыта.`,
        {
          tone: meta.truncated ? 'warning' : 'info',
          duration: 9000,
          action: { label: 'Подробности', onSelect: () => showRepairs(file.name, repairs) },
        },
      );
    } else if (meta.kind === 'project') {
      const n = model.diagrams.length;
      ScToast.show(`Открыт проект «${model.name}»: ${n} ${plural(n, 'диаграмма', 'диаграммы', 'диаграмм')}`,
        { tone: 'success' });
    }
  } catch (e) {
    set({ hint: `Не удалось открыть ${file.name}: ${e.message}` });
    await confirmDialog('Файл не открылся', e.message, 'Понятно');
  }
}

// `.puml` has its own input: the model picker accepts JSON only, and a
// PlantUML import never replaces the open model — it adds a sheet.
const pumlInput = document.getElementById('puml-input');
pumlInput?.addEventListener('change', () => {
  const file = pumlInput.files?.[0];
  pumlInput.value = '';
  if (file) importPumlFile(file).catch((e) => ScToast.show(`PlantUML не прочитан: ${e.message}`, { tone: 'danger' }));
});

const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) openFile(file);
});

// Drag a model file anywhere onto the window to open it.
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();                   // before anything async
  const file = e.dataTransfer?.files?.[0];
  if (file) openFile(file);
});

window.addEventListener('beforeunload', (e) => {
  if (!store.ui.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* -------------------------------------------------------------- keyboard */

window.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (modalOpen()) {
    if (meta && (/^[so0=+-]$/i.test(e.key) || (e.key.toLowerCase() === 'z' && !typing()))) e.preventDefault();
    return;
  }

  if (meta && e.key.toLowerCase() === 'z') {
    if (typing()) return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    renderCanvas();
    return;
  }
  if (meta && e.key === '0') { e.preventDefault(); fitToWindow(); renderStatus(); return; }
  if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomStep(1); renderStatus(); return; }
  if (meta && e.key === '-') { e.preventDefault(); zoomStep(-1); renderStatus(); return; }
  if (meta && e.key === '1') { e.preventDefault(); setZoom(1); renderStatus(); return; }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); flushEdits(); saveCurrent(); return; }
  if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); fileInput.click(); return; }

  // Clipboard and duplicate. They are model operations, not text ones, so a
  // focused input keeps its own Ctrl+C/V (the guard above returns first).
  if (meta && !typing()) {
    const k = e.key.toLowerCase();
    if (k === 'c') {
      e.preventDefault();
      const n = copySelection();
      set({ hint: n ? `Скопировано: ${n}.` : 'Нечего копировать — выделите фигуры на листе.' });
      return;
    }
    if (k === 'x') {
      e.preventDefault();
      const n = cutSelection();
      if (!n) set({ hint: 'Нечего вырезать — выделите фигуры на листе.' });
      return;
    }
    if (k === 'v') {
      e.preventDefault();
      const r = pasteClipboard();
      // pasteClipboard explains a non-empty but unusable buffer itself.
      if (!r && !store.clipboard) set({ hint: 'Буфер пуст — сначала Ctrl+C.' });
      return;
    }
    if (k === 'd') {
      e.preventDefault();
      const r = duplicateSelection();
      if (!r) set({ hint: 'Дублировать можно фигуры — выделите их на листе.' });
      return;
    }
  }

  if (typing() || meta) return;

  const k = e.key.toLowerCase();
  const tool = keyTool(k);
  if (tool) {
    e.preventDefault();
    set({ tool, pending: null, hint: '' });
    return;
  }
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      const shapes = store.ui.selection.filter((s) => s.kind === 'shape');
      if (!shapes.length) break;
      e.preventDefault();
      // One grid step per press; Shift makes it one pixel for fine placement.
      const step = e.shiftKey ? 1 : 10;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      commit('Сдвиг выделения', (m) => {
        const d = currentDiagram(m);
        for (const item of shapes) {
          const s = d?.shapes.find((x) => x.id === item.id);
          if (s) { s.x = Math.round(s.x + dx); s.y = Math.round(s.y + dy); }
        }
      });
      renderCanvas();
      break;
    }
    case 'Delete': case 'Backspace': {
      e.preventDefault();
      // Delete takes the VIEW off the sheet; Shift+Delete removes the thing
      // from the model (the element, or the relationship a link shows).
      // A picked bend point is the narrowest target: it goes first.
      if (!e.shiftKey && deleteWaypoint()) break;
      if (e.shiftKey) {
        if (selectionKind() === 'connector') deleteRelationshipFromModel();
        else deleteElementFromModel();
      } else deleteSelection();
      break;
    }
    case 'F2': case 'Enter': {
      if (!store.ui.selection.length) break;
      e.preventDefault();
      startEditSelected();
      break;
    }
    case 'F1': {
      // F1 — справка по выделенному: статья нотации фигуры или связи в
      // читалке. preventDefault обязателен, иначе браузер откроет свою
      // справку и уведёт со страницы. Выделение и лист не трогаются:
      // читалка стоит рядом с листом ровно для этого.
      const one = store.ui.selection.length === 1 ? store.ui.selection[0] : null;
      if (!one) break;
      e.preventDefault();
      const d = currentDiagram(store.model);
      let kind = null;
      let key = null;
      if (one.kind === 'shape') {
        const shape = d?.shapes.find((s) => s.id === one.id);
        const element = shape ? store.model.elements.find((x) => x.id === shape.elementId) : null;
        kind = 'shape';
        key = element?.kind ?? null;
      } else if (one.kind === 'connector') {
        const link = d?.links.find((l) => l.id === one.id);
        const rel = link ? store.model.relationships.find((r) => r.id === link.relId) : null;
        kind = 'connector';
        key = rel?.kind ?? null;
      }
      if (!key) { set({ hint: 'F1: у выделенного нет статьи нотации.' }); break; }
      openNotation(kind, key)
        .then((ok) => { if (!ok) set({ hint: `F1: статьи нотации для «${key}» нет.` }); })
        .catch((err) => set({ hint: `F1: справочник не открылся — ${err.message}` }));
      break;
    }
    case 'Escape': {
      // Курс — режим, и Esc из него выходит (основной обработчик — capture в
      // course.js; здесь запасной путь, когда фокус уже не в поле ввода).
      if (courseModeOpen()) { e.preventDefault(); closeCourse(); break; }
      if (store.ui.pending) { set({ pending: null, hint: '' }); renderCanvas(); break; }
      if (store.ui.tool !== 'select') { set({ tool: 'select', hint: '' }); renderCanvas(); break; }
      if (store.ui.selection.length) { set({ selection: [] }); break; }
      break;
    }
    default: break;
  }
});

/**
 * Start a model.
 *
 * `?model=all` opens the fourteen-type example; `?diagram=<kind>` then selects
 * the first diagram of that type (used by the screenshot runs and handy when
 * checking one notation). `?model=sample` is the old default — the class
 * example — kept for the browser suites, which expect its seven shapes.
 *
 * With no `?model=` / `?diagram=` at all the app opens an EMPTY model: the
 * first run is an invitation (src/ui/welcome.js), not somebody else's work.
 */
async function openEmpty() {
  const params = new URLSearchParams(location.search);
  const want = params.get('diagram');
  // Присутствие параметра, а не его значение: `?model=` — всё равно «просили
  // пример», и молча подменять его пустым стартом нельзя.
  const wantsExample = params.has('model') || params.has('diagram');
  try {
    if (params.get('model') === 'all') {
      loadModel(buildAllTypesModel());
      if (want) {
        const d = store.model.diagrams.find((x) => x.kind === want);
        if (d) store.model.currentDiagramId = d.id;
      }
    } else if (wantsExample) {
      await loadSample();
    } else {
      loadModel(emptyModel());
    }
  } catch {
    loadModel(createModel('Новая модель'));
  }
  // The opening document is the app's own: nothing has been written yet, so it
  // must not present itself as unsaved work. A new model made later is another
  // matter — that one is somebody's edit and stays dirty until saved.
  markClean();
}

/**
 * Пустая модель: ноль диаграмм — это и есть состояние «начало работы».
 *
 * `createModel` всегда заводит «Диаграмму 1»; model.js не наша зона, поэтому
 * чистим список ПОСЛЕ вызова. `currentDiagramId = null` обязателен: иначе в
 * файле остался бы висячий id на диаграмму, которой нет.
 */
function emptyModel() {
  const m = createModel('Без имени');
  m.diagrams = [];
  m.currentDiagramId = null;
  return m;
}

/** Первый кадр пуст, если автосохранения нет и пример не просили в адресе. */
function startsEmpty() {
  try {
    if (readAutosave()?.model) return false;
  } catch { /* битая копия не мешает пустому старту */ }
  const params = new URLSearchParams(location.search);
  return !params.has('model') && !params.has('diagram');
}

/* ------------------------------------------------------------------ start */

initCanvas();
initPanels();
// Читалка справочника инициализируется ПОСЛЕ await initIcons() — см. start():
// initReference сразу вставляет иконки в шапку через icon(), а до загрузки
// набора icon() отдаёт пустой <svg> нужного размера, и кнопки читалки
// оставались белыми квадратами 24×24.

(async function start() {
  // Layout metrics first: the sheet's grid pitch becomes a CSS variable
  // before anything is painted. Chrome heights are CSS, see styles.css.
  applyLayoutMetrics();

  // Приглашение первого запуска — до всех await'ов: нотация, набор иконок,
  // профиль и правила грузятся параллельно, и без этого человек полсекунды
  // смотрел бы на пустой лист, а «распаковка» начиналась бы с белого
  // прямоугольника. Видимость всё равно решает renderWelcome() по числу
  // диаграмм: если ниже поднимется автосохранение или пример, экран уйдёт.
  //
  // `firstRun` считается ОДИН раз здесь же: это ответ «пустой старт без
  // автосохранения и без ?model=», и он же уходит в app.open как `first`.
  const firstRun = startsEmpty();
  initWelcome();
  if (firstRun) showWelcome();
  // Строка согласия на счётчик. Сама решает, показываться ли: нужны
  // cfg.enabled (stand-сборка), отсутствие выбора и хотя бы одна диаграмма.
  // В обычной сборке не создаёт ни узла, ни запроса.
  initConsent();

  // The notation package must be in place before anything reads NOTATION:
  // the toolbar, the palette, the sample model and the renderer all ask it
  // what a shape is. Without it the page has no shapes to draw and throws.
  try {
    const { id, pkg } = await loadNotation();
    document.title = `${pkg.title ?? 'UML'} ${pkg.subtitle ?? ''}`.trim();
    store.ui.notationId = id;
  } catch (e) {
    showError('Нотация не загрузилась', `${e.message}. Проверьте папку notation/ рядом с index.html.`);
    return;
  }

  // The icon set is one parallel fetch of local files: the strip, the tree
  // rows and the sheet's visibility glyphs are inline SVG, so they must be in
  // hand before the first render — no pop-in, no second render. The list comes
  // from the package (each kind names its own file), so this waits for it.
  await initIcons();
  initFavicon();

  // Читалка справочника: каркас, иконки шапки и обработчики. Только теперь —
  // icon() кэширован, иначе семь кнопок .ref-bar остались бы пустыми.
  // Данные справочника по-прежнему грузятся при первом открытии: до «?» в
  // шапке ни одного лишнего запроса.
  initReference();

  initCommands();
  renderAll();
  renderCanvas();

  // Курс — данные рядом со страницей (course/index.json), как нотация и
  // профиль: локальный fetch, никакой сети. Не загрузился — панель скажет
  // об этом, а редактор продолжит работать.
  initCourse();

  // The rule set is data next to the notation, so it loads at boot like the
  // notation does. A broken set is said out loud in the panel and the
  // statusbar, and the modeler keeps working: checks advise, they never block.
  try {
    const rs = await loadRules();
    attachRuleset(rs);
  } catch (e) {
    attachRulesError(e.message);
    set({ hint: `Правила UML 2.5.1 не загрузились: ${e.message}` });
  }

  // The profile loads from profile/ next to the page; offline-safe. It is the
  // canonical reading of material/stereotypes.xml (304 stereotypes over 407
  // definitions) built by tools/build-profile.mjs. A miss degrades to an empty
  // dropdown, said so in the statusbar.
  //
  // The sheet is redrawn when the profile lands: stereotype drawings come
  // from it, so the first render — which happens before the fetch returns —
  // has no pictures to draw. Without this second render a model saved with
  // pictures would open looking like it had none.
  loadProfile()
    .then((p) => { store.profile = p; renderProfile(); renderStatus(); renderCanvas(); })
    .catch((e) => {
      store.profile = null;
      set({ hint: `Профиль стереотипов не загружен: ${e.message}` });
      renderProfile();
      renderStatus();
    });

  // Quiet recovery: an autosaved model comes back on its own and says so.
  //
  // Восстановленный документ не считается изменённым — ни без имени файла, ни
  // с ним. Копия лежит в этом же браузере и переживает закрытие вкладки, так
  // что терять нечего, а прежнее `_baseline = null` помечало документ
  // изменённым навсегда: первый же клик по листу гасил подсказку, статусбар
  // подставлял «есть несохранённые изменения», и закрытие вкладки спрашивало о
  // потере правок, которых никто не терял.
  //
  // Изменённым документ становится тогда, когда его действительно тронули, —
  // первая настоящая правка. До этого статусбар держит записку о том, откуда
  // документ взялся (`store.ui.restoreNote`), и клики её не сбивают.
  const saved = readAutosave();
  if (saved?.model) {
    try {
      const model = deserialize(JSON.stringify(saved.model), { profile: store.profile });
      loadModel(model, saved.fileName);
      markClean();
      set({ restoreNote: 'Восстановлены несохранённые изменения из этого браузера — Файл → Сохранить.' });
      fitToWindow();
    } catch {
      await openEmpty();
    }
  } else {
    await openEmpty();
  }
  renderAll();
  renderCanvas();
  fitToWindow();
  // Fit first so a small window still shows everything, then cap the opening
  // zoom so a big window does not blow the sheet up. The cap is a design
  // choice, not a measurement: 75 % was rejected as a property of the reference
  // (docs/MEASUREMENTS-AUDIT.md §4.5 — the status bar in the frame carries no
  // scale text at all), so it lives here as SAMPLE_ZOOM_CAP instead of coming
  // out of mechanics.json where it would read as evidence.
  setZoom(Math.min(store.ui.view.scale, SAMPLE_ZOOM_CAP));
  // ?view=N pins the zoom — used by serve.sh --screenshot and by hand when
  // checking small text. Only read at boot; normal use is wheel/zoom buttons.
  const view = new URLSearchParams(location.search).get('view');
  if (view) {
    const n = Number(view);
    if (Number.isFinite(n) && n >= 0.15 && n <= 4) {
      setZoom(n);
      renderCanvas();
    }
  }

  // `app.open` — один раз на запуск: первый ли это визит, какая тема, какой
  // акцент и размер окна. Ни модели, ни имени файла, ни текста здесь нет.
  track('app.open', {
    first: firstRun,
    theme: resolveMode(),
    brand: currentBrand(),
    w: Math.round(window.innerWidth),
    h: Math.round(window.innerHeight),
  });
  // `perf.firstPaint` — после первого нарисованного кадра, а не после загрузки
  // скриптов: человек видит лист, а не сеть. Число — миллисекунды от начала
  // навигации; больше ничего о машине счётчик не знает.
  requestAnimationFrame(() => track('perf.firstPaint', { ms: Math.round(performance.now()) }));

  // A small handle for the self-checks (tests/types.mjs) and for the
  // screenshot runs: the app has no build step, so this is the only way to
  // drive it without clicking. It exposes the same functions the UI calls.
  window.__uml = {
    store, set, commit, undo, redo, loadModel, currentDiagram, createDiagram,
    placeElement, createRelationship, createLink, serialize, deserialize,
    // Модель Э2-бис: владение, порядок сообщений, регионы, квалификаторы.
    childrenOf, rootsOf, setOwner, ownerCandidates, messageOrder, isMessage,
    regionMembers, regionsOf, qualifiersOf, internalsOf, removeElement,
    renderCanvas, fitToWindow, NOTATION, loadProfile, exportSvgString, exportPngBlob,
    // Hit testing (итерация 15): одна и та же функция выбирает цель и при
    // создании связи, и при перетаскивании конца; segmentAt — сегмент под
    // курсором для проверок жеста.
    targetAt, segmentAt,
    // Самосвязь (итерация 18): правило вида связи живёт в нотации, отказ
    // называет пункт стандарта.
    selfRuleOf, selfRuleOfRelationship, selfRefusal,
    // Проверки: движок целиком, прогон по любой модели (в том числе не
    // загруженной в редактор), счётчики и переход к замечанию.
    ruleset, runChecks: (model) => (ruleset() ? ruleset().run(model ?? store.model) : []),
    checkResult, openChecksPanel, refreshChecks, gotoFinding,
    // Реестр констрейнтов: та же точка входа, что у полки «Стандарт» в
    // библиотеке (вкладки в правой панели больше нет), и тот же замер.
    standard: { open: openStandardShelf, report: standardReport },
    // Подмена движка в браузерных проверках: тесты ставят набор с намеренно
    // падающим правилом и смотрят раздел сбоев.
    attachRuleset,
    // Импорт PlantUML (план Э7): тот же путь, что из меню «Файл».
    puml: {
      importText: importPumlText,
      importFile: importPumlFile,
      paste: openPasteDialog,
      details: showWarnings,
    },
    // Справочник-учебник (план Э10): полки, статьи, поиск, режимы раскладки.
    reference,
    // Курс (план Э6): главы и упражнения, урок, «открыть как модель», прогресс.
    // Режим, а не вкладка: openMode/close — это вход и выход кнопкой «Курс».
    course: {
      index: courseIndex, open: openExercise, openChapter, openTab: openCourseTab,
      openMode: openCourse, close: closeCourse, isOpen: courseModeOpen,
      openAsModel, toggleDone,
      done: courseDone, selected: selectedExercise,
    },
  };

  // ?selftest=1 — прогон «как у игрока» для `Build/uml-modeler --self-test`:
  // шаги выполняются в настоящем окне, отчёт кладётся в <pre>, который читает
  // headless-браузер. Модуль грузится только по этому флагу.
  if (new URLSearchParams(location.search).has('selftest')) {
    const report = document.createElement('pre');
    report.id = 'self-test-report';
    report.hidden = true;
    document.body.append(report);
    try {
      const { runSelfTest } = await import('./selftest.js');
      report.textContent = JSON.stringify(await runSelfTest(window.__uml));
    } catch (e) {
      report.textContent = JSON.stringify({
        version: 1, steps: [{ step: 'boot', passed: false, detail: e.message }],
      });
    }
  }
})();
