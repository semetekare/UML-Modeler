// Экран «Начало работы»: приглашение вместо готового примера.
//
// ЗАЧЕМ. Первый запуск показывал чужой готовый пример: человек не понимал,
// что это его модель, и начинал с чужой работы. Теперь приложение открывает
// ПУСТУЮ модель (ноль диаграмм), а над листом стоит приглашение — «распаковка
// нового подарка»: один крупный шаг и несколько спокойных путей к нему.
//
// ПОЧЕМУ СЛОЙ ПОВЕРХ ЛИСТА, А НЕ ВМЕСТО НЕГО. Панели, инструменты, дерево и
// статусбар остаются настоящими: после создания первой диаграммы ничего не
// перестраивается, и человек уже видел, где что лежит. Поэтому #welcome лежит
// поверх #canvas-wrap, а не заменяет лист; клики по листу под ним не проходят,
// пока диаграмм нет.
//
// ПОЧЕМУ МОДУЛЬ САМ СЕБЯ МОНТИРУЕТ. index.html — общий файл, его правят
// несколько агентов сразу; за время работы над задачей разметка #welcome и
// ссылка на welcome.css из него уже пропадали. Экран не должен зависеть от
// строки, которую кто-то другой может переписать: если узла нет, модуль
// создаёт его в #canvas-wrap; если нет <link>, добавляет его в <head>. Когда
// разметка в index.html есть (как задумано), обе функции ничего не делают.
//
// Экран не решает ничего про модель сам: он зовёт те же действия, что меню и
// панели (chooseDiagramType, loadSample, loadAllTypes, openCourse), и
// показывается/прячется по числу диаграмм — единственному признаку «модель
// пуста». Удалили последнюю диаграмму — приглашение вернулось.

import { el } from '../util.js';
import {
  store, set, commit, LAST_FILE_KEY,
} from '../state/store.js';
import { createDiagram } from '../model/model.js';
import { chooseDiagramType } from './dialog.js';
import { loadSample, loadAllTypes } from './toolbar.js';
import { openCourse } from './course.js';
import { fitToWindow, renderCanvas } from './canvas.js';
import { icon } from './icons.js';
import { LOGO_SVG } from '../brand/logo.js';
import { telemetryEnabled } from '../telemetry.js';
import { ScToast } from '../../ui-kit/js/toast.js';

/**
 * Подзаголовок — только проверяемые числа: 58 правил стандарта, из них 52
 * исполняются, а 6 модель не выражает; плюс 13 советов практики. Ни одного
 * обещания «проверяем стандарт» без знаменателя.
 */
const SUBTITLE = '14 типов диаграмм UML 2.5.1, 304 стереотипа профиля. '
  + 'Проверки: 58 правил стандарта (52 проверяются), 13 советов практики. '
  + 'Всё локально — ничего не отправляется в сеть.';

/**
 * Подзаголовок ПОСЛЕ согласия на счётчик (SEO-PLAN §6.6).
 *
 * Первая половина прежней фразы остаётся правдой, вторая — уже нет: имена
 * нажатых команд уходят. Обещать «ничего не отправляется» человеку, который
 * только что разрешил отправку, было бы обманом, поэтому строка меняется
 * ровно в тот момент, когда меняется факт.
 */
const SUBTITLE_CONSENT = 'Модель не покидает устройство; отправляются только имена команд и числа — выключить можно в справке.';

/** Текущий подзаголовок: до согласия — прежний, после «да» — честный. */
const currentSubtitle = () => (telemetryEnabled() ? SUBTITLE_CONSENT : SUBTITLE);

/** Ссылка на исходный код: подвал карточки, не тулбар (§5.1). */
const SOURCE_URL = 'https://github.com/semetekare/UML-Modeler';

/** Drag-and-drop элемента из дерева: тот же тип, что пишет canvas.js. */
const DND_ELEMENT = 'application/x-uml-element';

/* --------------------------------------------------------------- носитель */

// Стиль подключается на уровне модуля: main.js грузится из <body>, и ссылка
// успевает доехать до первого показа приглашения — вспышки без стилей нет.
// Путь считается от модуля, а не от страницы: экран не зависит от того, из
// какой папки его открыли.
const hasCss = () => [...document.querySelectorAll('link[rel="stylesheet"]')]
  .some((n) => /(^|\/)welcome\.css(\?|$)/.test(n.getAttribute('href') || ''));
if (!hasCss()) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../welcome.css', import.meta.url).href;
  link.dataset.welcomeCss = '1';
  document.head.append(link);
}

/**
 * Узел приглашения. В index.html он уже есть (пустой, `hidden`); если разметку
 * переписали без него — создаём здесь, в том же #canvas-wrap, чтобы слой лёг
 * ровно поверх листа, а не поверх панелей.
 */
function ensureHost() {
  let node = document.getElementById('welcome');
  if (node) return node;
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return null;
  node = document.createElement('div');
  node.id = 'welcome';
  node.hidden = true;
  node.setAttribute('aria-label', 'Начало работы');
  wrap.append(node);
  return node;
}

let host = null;
let primary = null;
let lastLine = null;
// Подзаголовок: узел запоминается, чтобы переписать фразу, когда человек
// ответит на вопрос о счётчике (SUBTITLE → SUBTITLE_CONSENT).
let subLine = null;
let built = false;
// Диалог типа уже открыт: второй Enter не должен открыть второй диалог.
let picking = false;
// Подсказка, которую поставило создание диаграммы. Нужна, чтобы снять её,
// если создание отменили (Ctrl+Z): «Создана «…»» рядом с «Модель пуста» —
// это два противоположных утверждения в одной строке состояния.
let createdHint = '';

export const welcomeVisible = () => !!host && !host.hidden;

/* ------------------------------------------------------------ построение */

function build() {
  // Знак — официальный логотип, встроенный в разметку: он берёт акцент и
  // цвета темы из CSS, а картинка из <img> их не видит.
  const mark = el('span', { class: 'wl-mark', html: LOGO_SVG(44), 'aria-hidden': 'true' });

  subLine = el('p', { class: 'wl-sub', text: currentSubtitle() });
  const head = el('div', { class: 'wl-head' },
    mark,
    el('div', { class: 'wl-titles' },
      el('h1', { class: 'wl-title', text: 'UML Modeler' }),
      subLine));

  // Одна главная кнопка: всё остальное на экране — пути для тех, кто уже
  // знает, чего хочет. Крупная, на всю ширину карточки, первая в порядке Tab.
  primary = el('button', {
    type: 'button',
    class: 'wl-primary',
    onclick: () => createFromDialog(),
  }, icon('ui-plus', 18), el('span', { text: 'Создать диаграмму…' }));

  const ghost = (label, run, glyph = null) => el('button', {
    type: 'button',
    class: 'wl-ghost',
    onclick: run,
  }, glyph ? icon(glyph, 16) : null, el('span', { text: label }));

  const secondary = el('div', { class: 'wl-secondary' },
    // Тот же путь, что у пункта «Файл → Открыть…»: скрытый #file-input, его
    // change-обработчик живёт в main.js.
    ghost('Открыть файл…', () => document.getElementById('file-input')?.click(), 'ui-open'),
    ghost('Пример: классы', () => { loadSample(); }),
    ghost('Пример: все 14 типов', () => { loadAllTypes(); }),
    ghost('Курс: 20 упражнений', () => { openCourse(); }, 'ui-course'));

  const foot = el('p', { class: 'wl-foot' },
    'Файл → Открыть, или перетащите .uml.json в окно. Ctrl+K — все команды.');
  // Ссылка на исходники — строкой в подвале, рядом с подсказкой: правило
  // «восемь кнопок, не двадцать две» не трогаем, в тулбар иконку не ставим
  // (docs/seo/SEO-PLAN.md §5.1). Стиль — из токенов наследия, без нового
  // листа: подвал и так приглушённый, а ссылка должна читаться как ссылка.
  foot.append(' ',
    el('a', {
      class: 'wl-src',
      href: SOURCE_URL,
      target: '_blank',
      rel: 'noopener',
      title: 'Исходный код UML Modeler на GitHub',
      style: { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' },
    }, icon('ui-github', 16), el('span', { text: ' Исходники на GitHub' })));

  // Строка о последнем файле необязательна: пока файла не было, её нет вовсе,
  // чтобы приглашение не начиналось с «нет данных».
  lastLine = el('p', { class: 'wl-last', hidden: true });

  host.replaceChildren(el('div', { class: 'wl-card' },
    head, primary, secondary, foot, lastLine));
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Начало работы');

  /* --- клавиатура ---------------------------------------------------- */
  // Enter — главное действие. Кнопка в фокусе делает это сама; обработчик
  // нужен для случая «фокус ушёл на фон карточки» (клик по пустому месту
  // снимает фокус с кнопки). Esc не перехватываем: закрывать нечего, и
  // глобальный обработчик main.js пусть решает сам.
  window.addEventListener('keydown', (e) => {
    if (!welcomeVisible() || e.defaultPrevented) return;
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const a = document.activeElement;
    // Фокус в кнопке — она сама знает, что нажать; фокус в диалоге или
    // палитре команд — это их Enter, а не наш.
    if (a && a !== document.body && !host.contains(a)) return;
    if (a && a !== document.body && a.closest?.('button')) return;
    e.preventDefault();
    createFromDialog();
  });

  /* --- клики по фону -------------------------------------------------- */
  // Лист под приглашением не принимает клики (слой выше), но инструмент
  // мог остаться выбранным с полосы. Вместо исключения из placeElement —
  // внятный ответ и возврат к «Выбору».
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('button')) return;
    if (store.ui.tool !== 'select' || store.ui.pending) {
      set({
        tool: 'select',
        pending: null,
        hint: 'Сначала создайте диаграмму — «Создать диаграмму…».',
      });
    }
  });

  /* --- двойной щелчок по элементу дерева ------------------------------ */
  // Двойной щелчок по строке элемента ставит его на лист (panels.js:678).
  // При нуле диаграмм ставить некуда, и `showElement` падает на
  // `currentDiagram(m).shapes` — это чужой файл, править его не наша зона.
  //
  // ПОЧЕМУ ОДНОГО ПЕРЕХВАТА dblclick МАЛО. Первый щелчок по строке выбирает
  // элемент, перерисовка дерева заменяет строку новым узлом; к моменту
  // dblclick браузер шлёт событие уже отсоединённому узлу, и оно не доходит
  // ни до #model, ни до document — а собственный обработчик строки срабатывает.
  // Поэтому гасим ВТОРОЙ щелчок (detail ≥ 2) ещё в mousedown/click: тогда
  // строка между щелчками не перерисовывается, dblclick приходит на живой узел
  // и ловится здесь же. Как только диаграмма появилась, всё идёт обычным путём.
  const modelPane = document.getElementById('model');
  const stopSecond = (e) => {
    if (!welcomeVisible() || e.detail < 2) return;
    if (!e.target.closest?.('[data-tree-id]')) return;
    e.preventDefault();
    e.stopPropagation();
    set({ hint: 'Сначала создайте диаграмму — «Создать диаграмму…».' });
  };
  if (modelPane) {
    for (const type of ['mousedown', 'click', 'dblclick']) {
      modelPane.addEventListener(type, stopSecond, true);
    }
  }

  /* --- перетаскивание ------------------------------------------------- */
  // Элемент из дерева на лист при нуле диаграмм упал бы в canvas.js:
  // placeElement ждёт лист. Перехватываем только этот тип; файл (.uml.json)
  // пропускаем к обработчику окна — открытие перетаскиванием работает и
  // отсюда.
  const carriesElement = (e) => Array.from(e.dataTransfer?.types ?? []).includes(DND_ELEMENT);
  host.addEventListener('dragover', (e) => {
    if (!carriesElement(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  });
  host.addEventListener('drop', (e) => {
    if (!carriesElement(e)) return;
    e.preventDefault();
    e.stopPropagation();
    set({ tool: 'select', pending: null, hint: 'Сначала создайте диаграмму — «Создать диаграмму…».' });
  });
}

/* -------------------------------------------------------------- действия */

/**
 * Главное действие: тот же диалог 14 типов, что у «+» в шапке.
 *
 * Диаграмма создаётся одним `commit`, поэтому попадает и в историю отмены:
 * Ctrl+Z после «Создать» возвращает пустую модель, и приглашение появляется
 * снова — это честно, человек отменил создание.
 */
async function createFromDialog() {
  if (picking) return;
  picking = true;
  try {
    const pick = await chooseDiagramType();
    if (!pick) { focusPrimary(); return; }
    const created = commit('Новая диаграмма', (m) => {
      const d = createDiagram(pick.name, pick.kind);
      m.diagrams.push(d);
      m.currentDiagramId = d.id;
      return d;
    });
    // Прячемся сразу, не дожидаясь microtask-перерисовки: диалог уже закрыт,
    // и приглашение не должно мигнуть поверх новой диаграммы.
    host.hidden = true;
    fitToWindow();
    renderCanvas();
    createdHint = `Создана «${created.name}». Поставьте фигуру инструментом над `
      + 'листом или перетащите элемент из дерева.';
    set({
      selection: [],
      pending: null,
      tool: 'select',
      hint: createdHint,
    });
    focusSheet();
  } catch (e) {
    ScToast.show(`Диаграмма не создалась: ${e.message}`, { tone: 'danger' });
  } finally {
    picking = false;
  }
}

function focusPrimary() {
  primary?.focus({ preventScroll: true });
}

/**
 * «Фокус на листе» после создания: у #canvas-wrap нет tabindex, а без него
 * фокус некуда отдать. Ставим -1 (в порядок Tab не попадает) и убираем рамку
 * в welcome.css: рамка вокруг всего полотна читалась бы как выделение.
 */
function focusSheet() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  if (!wrap.hasAttribute('tabindex')) wrap.setAttribute('tabindex', '-1');
  wrap.focus({ preventScroll: true });
}

/* ------------------------------------------------------------- состояние */

export function initWelcome() {
  host = ensureHost();
  if (!host || built) return;
  built = true;
  build();
}

/**
 * Показать приглашение, если диаграмм нет, и спрятать, если есть.
 * Зовётся из renderAll(): число диаграмм — единственный источник правды, а
 * не отдельный флаг «первый запуск», который пришлось бы где-то сбрасывать.
 */
export function renderWelcome() {
  if (!host) return;
  const empty = !(store.model.diagrams ?? []).length;
  const wasVisible = !host.hidden;
  // Согласие на счётчик могли дать в другой вкладке (или в этой, пока экран
  // был скрыт): подзаголовок обязан следовать факту, а не только сборке.
  refreshSubtitle();
  // Создание отменили (Ctrl+Z): подсказка «Создана «…»» больше не правда.
  // Поле правится напрямую, без emit: renderStatus идёт сразу за нами в том
  // же проходе renderAll и прочитает уже очищенное значение — второй
  // перерисовки не будет.
  if (empty && createdHint && store.ui.hint === createdHint) {
    createdHint = '';
    store.ui.hint = '';
  }
  host.hidden = !empty;
  if (!empty) {
    // Переход «было видно → скрыли» — это и есть создание/загрузка модели;
    // фокус отдаём листу, чтобы клавиши работали сразу.
    if (wasVisible) focusSheet();
    return;
  }
  refreshLastFile();
  if (!wasVisible) focusPrimary();
}

/**
 * Показать приглашение ДО загрузки модели — на самом первом кадре, пока
 * идут fetch'и нотации и набора иконок. Иначе первый экран — пустой лист,
 * а «распаковка» начинается с белого прямоугольника.
 */
export function showWelcome() {
  initWelcome();
  if (!host) return;
  refreshSubtitle();
  host.hidden = false;
  refreshLastFile();
  focusPrimary();
}

function refreshLastFile() {
  if (!lastLine) return;
  let name = '';
  try { name = localStorage.getItem(LAST_FILE_KEY) || ''; } catch { name = ''; }
  lastLine.hidden = !name;
  lastLine.textContent = name ? `Последний файл: ${name}` : '';
  lastLine.title = name;
}

/** Переписать подзаголовок, если согласие изменилось. */
function refreshSubtitle() {
  if (!subLine) return;
  const text = currentSubtitle();
  if (subLine.textContent !== text) subLine.textContent = text;
}
