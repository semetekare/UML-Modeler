// The header: commands only.
//
// design/README.md §2 шаг 0 and ui-audit-design.md §3.1: the tools moved to
// the strip above the sheet, so this bar is four menus plus four controls —
// eight buttons, not twenty-two. Nothing here repeats a tool, and nothing
// repeats a command that already lives somewhere else:
//   * zoom lives in the statusbar readout (one place for a readout and its
//     menu), so "Вид" carries the grid and nothing else;
//   * panel toggles have no second home: they are here and in Ctrl+K, and
//     Ctrl+K is an index, not a button.
//
// 44 px tall = menu item 28 + 2×8 (density-spec §2.2).

import { el, clear, downloadText } from '../util.js';
import { NOTATION, typeOf, keyFor } from '../model/notation.js';
import {
  store, set, undo, redo, canUndo, canRedo, loadModel, markSaved, clearAutosave, commit, selectionKind,
} from '../state/store.js';
import { deleteSelection, deleteElementFromModel, deleteRelationshipFromModel, fitToWindow, renderCanvas, flushEdits } from './canvas.js';
import { copySelection, cutSelection, pasteClipboard, duplicateSelection } from './clipboard.js';
import { arrange, autoLayout, layoutHint } from './arrange.js';
import { confirmDialog, showHelp, chooseDiagramType } from './dialog.js';
import { openReference, closeReference, referenceOpen } from './reference.js';
import { openCourse, closeCourse, courseModeOpen } from './course.js';
import { createModel, createDiagram, currentDiagram } from '../model/model.js';
import { buildSampleModel, buildAllTypesModel } from '../model/sample.js';
import { saveModel, serialize, serializeProject, deserialize } from '../io/umljson.js';
import { openPumlPicker, openPasteDialog } from './import-puml.js';
import { exportSvgString, exportDiagramSvgString, exportPngBlob } from './render.js';
import { printDiagram, printAllDiagrams } from './print.js';
import { icon } from './icons.js';
import { LOGO_SVG } from '../brand/logo.js';
import { SOURCE_URL } from './dialog.js';
import { slugify } from '../util.js';
import { ScToast } from '../../ui-kit/js/toast.js';
import { openChecksPanel, checkCounts } from './checks.js';
import { MODES, MODE_LABELS, getMode, currentMode, applyMode, onThemeChange } from './appearance.js';
import { track } from '../telemetry.js';

let openMenu = null;

document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.contains(e.target)) {
    openMenu.querySelector('.menu-pop')?.remove();
    openMenu = null;
  }
});

/** Close any open popover (the strip's zoom menu uses it too). */
export function closeMenus() {
  if (!openMenu) return;
  openMenu.querySelector('.menu-pop')?.remove();
  openMenu = null;
}

// Esc закрывает открытое меню ДО любых действий. Раньше попап закрывался
// только кликом мимо: клавиатура оставляла его висеть поверх листа, а Esc
// уходил дальше — в main.js, где снимал выделение или инструмент. Обработчик
// стоит на всплытии и срабатывает раньше main.js (этот модуль загружается
// первым), поэтому Esc при открытом меню значит «закрой меню» и ничего
// больше; фокус возвращается на кнопку меню, иначе он терялся в body.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openMenu) return;
  e.preventDefault();
  e.stopPropagation();
  const host = openMenu;
  closeMenus();
  host.querySelector('.btn')?.focus();
});

/**
 * Keep a popover inside the window.
 *
 * `.menu-pop` hangs from the left edge of its host, which is right for the
 * four menus on the left of the strip and wrong for anything parked at the
 * right end: the accent menu opened at x=1351 with a 220 px panel, so 131 px
 * of it — the check marks and half the labels — sat past the viewport.
 *
 * Measured once after the popover is in the DOM, then corrected in three
 * steps: flip to the host's right edge when the panel would cross the right
 * one; open upwards when it does not fit below and there is more room above;
 * and otherwise cap its height to the room that is left and let it scroll.
 * The third step matters on a short window, where flipping up would put the
 * panel off the top edge instead — worse than the problem being fixed. All
 * corrections are inline styles recomputed from a reset state each time, so
 * re-opening never compounds them.
 */
function placePopover(host, wrap) {
  wrap.style.left = '';
  wrap.style.right = '';
  wrap.style.top = '';
  wrap.style.bottom = '';
  wrap.style.maxHeight = '';
  wrap.style.overflowY = '';
  const edge = 8;
  const gap = 4;
  const h = host.getBoundingClientRect();
  const r = wrap.getBoundingClientRect();
  if (r.right > window.innerWidth - edge) {
    wrap.style.left = 'auto';
    wrap.style.right = '0';
  }
  const roomBelow = window.innerHeight - h.bottom - edge - gap;
  const roomAbove = h.top - edge - gap;
  if (r.height > roomBelow && roomAbove > roomBelow) {
    wrap.style.top = 'auto';
    wrap.style.bottom = `calc(100% + ${gap}px)`;
    if (r.height > roomAbove) {
      wrap.style.maxHeight = `${Math.max(120, roomAbove)}px`;
      wrap.style.overflowY = 'auto';
    }
  } else if (r.height > roomBelow) {
    wrap.style.maxHeight = `${Math.max(120, roomBelow)}px`;
    wrap.style.overflowY = 'auto';
  }
}

function menu(label, items, opts = {}) {
  const pop = () => {
    const list = el('div', { class: 'menu-pop' });
    for (const it of items()) {
      if (it === '-') { list.appendChild(el('hr')); continue; }
      if (it.note) { list.appendChild(el('div', { class: 'mnote', text: it.note })); continue; }
      list.appendChild(el('button', {
        type: 'button',
        text: it.label,
        disabled: it.disabled,
        title: it.title,
        'aria-label': it['aria-label'] ?? it.label,
        onclick: () => {
          list.remove();
          openMenu = null;
          track('command', { id: it.id ?? `menu:${String(it.label).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48)}` });
          it.run();
        },
      }));
    }
    return list;
  };
  const host = el('div', { class: 'menu' });
  const btn = el('button', {
    type: 'button',
    class: 'btn',
    title: opts.title ?? label,
    'aria-label': opts.title ?? label,
    'aria-haspopup': 'menu',
    onclick: (e) => {
      e.stopPropagation();
      const existing = host.querySelector('.menu-pop');
      if (openMenu && openMenu !== host) openMenu.querySelector('.menu-pop')?.remove();
      if (existing) { existing.remove(); openMenu = null; return; }
      host.appendChild(pop());
      openMenu = host;
      placePopover(host, host.querySelector('.menu-pop'));
    },
  }, label, icon('ui-chevron-down', 10));
  host.appendChild(btn);
  return host;
}

/* --------------------------------------------------------------- brand */
/* One variable (--brand) drives every accent AND every surface tint; the
 * presets live in src/brand/brand.css and the choice in localStorage['brand'].
 * index.html reads it before the first paint, so a reload never flashes
 * Flame. There is no skin/appearance switch any more: the editor has one
 * appearance (light), and this menu only picks the accent. */

export const BRANDS = [
  { id: 'flame', label: 'Flame', hex: '#fa5d00' },
  { id: 'moss', label: 'Moss', hex: '#4f6b21' },
  { id: 'teal', label: 'Teal', hex: '#0e7490' },
  { id: 'violet', label: 'Violet', hex: '#6b3fd4' },
  { id: 'plum', label: 'Plum', hex: '#9a1f6e' },
  { id: 'graphite', label: 'Graphite', hex: '#3f3f42' },
];

export const currentBrand = () => document.documentElement.dataset.brand || 'flame';

export function applyBrand(id) {
  const name = BRANDS.some((b) => b.id === id) ? id : 'flame';
  if (name === 'flame') delete document.documentElement.dataset.brand;
  else document.documentElement.dataset.brand = name;
  try { localStorage.setItem('brand', name); } catch { /* private mode: colour is cosmetic */ }
}

function accentMenu() {
  const host = el('div', { class: 'menu' });
  const btn = el('button', {
    type: 'button',
    class: 'btn',
    title: 'Акцентный цвет интерфейса',
    'aria-label': 'Акцентный цвет интерфейса',
    'aria-haspopup': 'menu',
    onclick: (e) => {
      e.stopPropagation();
      const existing = host.querySelector('.menu-pop');
      if (openMenu && openMenu !== host) openMenu.querySelector('.menu-pop')?.remove();
      if (existing) { existing.remove(); openMenu = null; return; }
      const wrap = el('div', { class: 'menu-pop', style: 'width:220px;padding:8px' });
      wrap.append(el('div', { class: 'mnote', text: 'Акцентный цвет' }));
      for (const b of BRANDS) {
        const on = currentBrand() === b.id;
        wrap.append(el('button', {
          type: 'button',
          'aria-label': `Акцентный цвет: ${b.label}`,
          'aria-pressed': on ? 'true' : 'false',
          onclick: () => {
            applyBrand(b.id);
            wrap.remove(); openMenu = null;
            set({ hint: `Акцентный цвет: ${b.label}` });
          },
        },
        el('span', { class: 'swatch-dot', style: `background:${b.hex}` }),
        el('span', { text: b.label }),
        el('span', { class: 'check', text: on ? '✓' : '' })));
      }
      host.appendChild(wrap);
      openMenu = host;
      placePopover(host, wrap);
    },
  }, icon('ui-palette', 14), 'Акцент');
  host.appendChild(btn);
  return host;
}

/* --------------------------------------------------------- оформление */
/* Тема — не акцент. Акцент решает, какого цвета интерфейс; тема решает, с
 * какой стороны он освещён: светлые поверхности, выведенные из акцента, или
 * тёмные, выведенные из того же акцента. Поэтому это отдельная кнопка, а не
 * пункт в меню акцента: два независимых выбора не должны выглядеть одним.
 *
 * Три состояния, как у системной настройки: «Авто» следует ОС и переключается
 * на лету (подписка — ui-kit/js/theme.js), «Светлая» и «Тёмная» — ручной
 * выбор. Кнопка показывает то, что человек видит СЕЙЧАС, а не то, что выбрано:
 * при «Авто» в тёмной системе на ней луна, и это правда. */

const MODE_ICON = { system: 'ui-contrast', light: 'ui-sun', dark: 'ui-moon' };

function appearanceMenu() {
  const host = el('div', { class: 'menu' });
  const btn = el('button', {
    type: 'button',
    class: 'btn',
    title: `Оформление: ${MODE_LABELS[getMode()].toLowerCase()}`,
    'aria-label': 'Оформление',
    'aria-haspopup': 'menu',
    onclick: (e) => {
      e.stopPropagation();
      const existing = host.querySelector('.menu-pop');
      if (openMenu && openMenu !== host) openMenu.querySelector('.menu-pop')?.remove();
      if (existing) { existing.remove(); openMenu = null; return; }
      const wrap = el('div', { class: 'menu-pop', style: 'width:220px;padding:8px' });
      wrap.append(el('div', { class: 'mnote', text: 'Оформление' }));
      for (const mode of MODES) {
        const on = getMode() === mode;
        wrap.append(el('button', {
          type: 'button',
          'aria-label': `Оформление: ${MODE_LABELS[mode]}`,
          'aria-pressed': on ? 'true' : 'false',
          onclick: () => {
            applyMode(mode);
            wrap.remove(); openMenu = null;
            set({ hint: `Оформление: ${MODE_LABELS[mode]}` });
          },
        },
        el('span', { class: 'seg-ico' }, icon(MODE_ICON[mode], 14)),
        el('span', { text: MODE_LABELS[mode] }),
        el('span', { class: 'check', text: on ? '✓' : '' })));
      }
      // Подпись под выбором: «Авто» — это не «серая кнопка», а следование
      // системе, и когда тема уже тёмная, это единственное место, где видно,
      // почему она такая.
      if (getMode() === 'system') {
        wrap.append(el('div', {
          class: 'mnote',
          text: `Сейчас: ${currentMode() === 'dark' ? 'тёмная' : 'светлая'} — по настройке системы`,
        }));
      }
      host.appendChild(wrap);
      openMenu = host;
      placePopover(host, wrap);
    },
  }, icon(MODE_ICON[getMode()], 16));
  host.appendChild(btn);
  return host;
}

/* ------------------------------------------------------------- panels */

/* Тема сменилась — перерисовать интерфейс целиком.
 * ЗАЧЕМ НЕ ТОЛЬКО ПАНЕЛЬ: заливка фигуры и цвет линии связи в тёмной теме
 * считаются в JS (fill.js#themeFill) и лежат в inline-стилях, а кружки
 * палитры показывают цвет, которым фигура будет залита. CSS-переменных тут
 * мало: без перерисовки лист остался бы в прежних цветах до следующей правки.
 * `set({})` — тот же путь, которым приложение перерисовывается после любой
 * команды, поэтому второй механизм не нужен. */
onThemeChange(() => set({}));

const narrow = () => window.matchMedia('(max-width: 999px)').matches;

/** The inspector is docked above 999 px and an overlay below it. */
export const rightVisible = () => (narrow()
  ? document.body.classList.contains('show-right')
  : !document.body.classList.contains('hide-right'));

export function toggleLeft() {
  document.body.classList.toggle('hide-left');
  set({});
}

export function toggleRight() {
  if (narrow()) document.body.classList.toggle('show-right');
  else document.body.classList.toggle('hide-right');
  set({});
}

// Crossing the breakpoint must not leave the overlay stuck open on a docked
// layout (or vice versa).
window.addEventListener('resize', () => {
  if (!narrow()) document.body.classList.remove('show-right');
});

/* -------------------------------------------------------------- render */

/**
 * PNG to the downloads folder, named after the model. The raster is produced
 * at the diagram's own size so the file does not depend on the editor's zoom.
 */
async function exportPng(scale) {
  try {
    const m = store.model;
    const { blob, width, height } = await exportPngBlob(m, store.profile, scale);
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `${slugify(m.name)}${scale === 1 ? '' : `@${scale}x`}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    track('export', { format: scale === 1 ? 'png' : 'png2' });
    set({ hint: `PNG сохранён: ${width}×${height}` });
    ScToast.show(`PNG ${width}×${height} сохранён`, { tone: 'success' });
  } catch (e) {
    set({ hint: `PNG не сохранился: ${e.message}` });
    ScToast.show(`PNG не сохранился: ${e.message}`, { tone: 'danger' });
  }
}

/**
 * Экспорт ВСЕГО проекта: один `.json` со всеми диаграммами (метка
 * `kind: 'project'`) и по одному SVG на диаграмму, `<NN>-<slug>.svg`.
 *
 * Папки программа выбрать не может — браузер отдаёт файлы по одному в
 * «Загрузки», поэтому это серия скачиваний, а не архив: зависимостей для
 * ZIP у нас нет и не будет. Между файлами пауза: браузер, которому не
 * разрешили несколько загрузок подряд, иначе теряет часть серии. Поэтому в
 * тосте есть кнопка «Только JSON» — один файл, который браузер не блокирует
 * никогда, и в нём лежит вся модель.
 */
const SVG_GAP_MS = 250;

function downloadProjectSvgs(model) {
  const diagrams = model.diagrams ?? [];
  diagrams.forEach((d, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${slugify(d.name)}.svg`;
    setTimeout(() => {
      downloadText(exportDiagramSvgString(model, d, store.profile), name, 'image/svg+xml');
    }, SVG_GAP_MS * (i + 1));
  });
  return diagrams.length;
}

export function exportProject() {
  const m = store.model;
  const base = slugify(m.name);
  const jsonName = `${base}.project.json`;
  const json = serializeProject(m, store.profile);
  downloadText(json, jsonName, 'application/json');
  const svgCount = downloadProjectSvgs(m);
  const onlyJson = () => {
    downloadText(json, jsonName, 'application/json');
    set({ hint: `JSON проекта сохранён: ${jsonName}` });
  };
  set({ hint: `Экспорт проекта: ${jsonName} и SVG: ${svgCount}` });
  ScToast.show(
    `Проект сохранён: ${jsonName} + ${svgCount} SVG. `
    + 'Браузер может спросить разрешение на несколько файлов подряд.',
    { tone: 'success', duration: 10000, action: { label: 'Только JSON', onSelect: onlyJson } },
  );
}

export function renderToolbar() {
  const host = document.getElementById('toolbar');
  clear(host);
  const m = store.model;
  const fileName = store.ui.fileName || `${slugify(m.name)}.uml.json`;

  host.append(
    // Название продукта — ссылка на лендинг: из редактора всегда есть путь
    // к описанию, скриншотам и справке «что это вообще».
    el('a', {
      class: 'brand',
      href: '/',
      title: 'UML Modeler — о продукте, на главную сайта',
    }, el('span', { class: 'brand-mark', html: LOGO_SVG(22), 'aria-hidden': 'true' }),
      'UML', el('small', { text: ' Modeler' })),

    menu('Файл', () => [
      { label: 'Новая модель', run: newModel },
      { label: 'Открыть… (*.uml.json)', run: () => document.getElementById('file-input').click() },
      '-',
      { label: `Сохранить ${fileName}`, run: saveCurrent },
      '-',
      // PlantUML: the text is read into this model as a NEW SHEET; the layout
      // stays the person's work, so this is the one import that does not
      // arrange anything for them.
      { label: 'Импорт PlantUML… (.puml, .plantuml, .txt)', run: openPumlPicker },
      { label: 'Импорт PlantUML: вставить текст…', run: openPasteDialog },
    ], { title: 'Файл' }),

    menu('Правка', () => {
      const shapes = store.ui.selection.filter((s) => s.kind === 'shape').length;
      const items = store.ui.selection.length;
      return [
        { label: 'Отменить (Ctrl+Z)', run: () => { undo(); renderCanvas(); }, disabled: !canUndo() },
        { label: 'Повторить (Ctrl+Shift+Z)', run: () => { redo(); renderCanvas(); }, disabled: !canRedo() },
        '-',
        { label: 'Вырезать (Ctrl+X)', run: cutSelection, disabled: !items },
        { label: 'Копировать (Ctrl+C)', run: () => { const n = copySelection(); set({ hint: n ? `Скопировано: ${n}.` : 'Нечего копировать.' }); }, disabled: !items },
        { label: 'Вставить (Ctrl+V)', run: pasteClipboard, disabled: !store.clipboard },
        { label: 'Дублировать (Ctrl+D)', run: duplicateSelection, disabled: !shapes },
        '-',
        { label: 'Выровнять по левому краю', run: () => runArrange('left'), disabled: shapes < 2 },
        { label: 'Выровнять по центру', run: () => runArrange('center'), disabled: shapes < 2 },
        { label: 'Выровнять по правому краю', run: () => runArrange('right'), disabled: shapes < 2 },
        { label: 'Выровнять по верху', run: () => runArrange('top'), disabled: shapes < 2 },
        { label: 'Выровнять по середине', run: () => runArrange('middle'), disabled: shapes < 2 },
        { label: 'Выровнять по низу', run: () => runArrange('bottom'), disabled: shapes < 2 },
        { label: 'Равные промежутки по горизонтали', run: () => runArrange('distribute-h'), disabled: shapes < 2 },
        { label: 'Равные промежутки по вертикали', run: () => runArrange('distribute-v'), disabled: shapes < 2 },
        '-',
        // Раскладка — только по вызову человека и всегда с вопросом: ручные
        // изгибы при ней теряются (см. autoLayout в arrange.js).
        {
          label: 'Разложить автоматически…',
          title: 'Слоистая раскладка листа или выделения; ручные изгибы связей будут потеряны — диалог назовёт их число до применения',
          run: runAutoLayout,
          disabled: (currentDiagram(m)?.shapes.length ?? 0) < 2,
        },
        '-',
        { label: 'Снять с диаграммы (Delete)', run: deleteSelection, disabled: !items },
        {
          label: selectionKind() === 'connector'
            ? 'Удалить связь из модели (Shift+Delete)'
            : 'Удалить элемент из модели (Shift+Delete)',
          run: () => (selectionKind() === 'connector' ? deleteRelationshipFromModel() : deleteElementFromModel()),
          disabled: !items,
        },
      ];
    }, { title: 'Правка' }),

    // Zoom is not here: the statusbar readout owns it (ui-audit-design §3.2).
    menu('Вид', () => [
      { label: `${store.ui.showGrid ? '✓ ' : ''}Сетка`, run: () => set({ showGrid: !store.ui.showGrid }) },
      {
        // «Display as Robustness Analysis icon»: the flag lives
        // in the model, not in the UI state: a sheet saved with the drawings
        // off has to open with them off, or the picture in the tutorial stops
        // matching the file.
        label: `${m.pictograms === false ? '' : '✓ '}Пиктограммы стереотипов`,
        title: 'Значок в углу фигуры и рисунок вместо фигуры для стереотипов, у которых он есть',
        run: () => commit('Пиктограммы', (model) => { model.pictograms = model.pictograms === false; }),
      },
      '-',
      // Лист клавиш — на кнопке «Подсказка» в шапке, здесь и в Ctrl+K:
      // три входа, потому что подсказку ищут всеми тремя способами.
      { label: 'Подсказка: клавиши и правка', run: showHelp },
    ], { title: 'Вид' }),

    // Примеры — отдельное меню, а не три пункта в «Файле»: это не работа с
    // файлом, а готовая модель, которую открывают, чтобы посмотреть. В «Файле»
    // остались только действия над своим документом.
    menu('Примеры', () => [
      { label: 'Пример: классы (интернет-магазин)', title: 'Готовая модель классов на семь фигур', run: loadSample },
      { label: 'Пример с ошибками (проверки)…', title: 'Модель с намеренными нарушениями правил UML — для панели «Проверки»', run: loadDemoErrors },
      { label: 'Пример: все 14 типов UML', title: 'По одному листу на каждый тип диаграммы плюс вложенный лист', run: loadAllTypes },
    ], { title: 'Примеры моделей: классы, ошибки проверок, все 14 типов' }),

    menu('Экспорт', () => [
      // Порядок — по смыслу «что отдаём»: сначала вся модель, потом один лист.
      // «Печать всех» стоит рядом с экспортом всего проекта (обе команды — про
      // всю модель), «Печать этой» — в конце, рядом с SVG/PNG/JSON, которые
      // тоже отдают один лист. Печать — самый частый способ отдать диаграмму
      // (методичка, отчёт), поэтому она есть в обеих половинах.
      { label: 'Экспорт всего проекта…', title: 'Все диаграммы одним файлом .json плюс SVG на каждую диаграмму', run: exportProject },
      {
        label: 'Печать всех диаграмм (PDF)…',
        title: 'Каждая диаграмма модели на своей странице A4, в порядке списка; под листом — модель, имя, тип и дата',
        run: printAllDiagrams,
        disabled: !(store.model.diagrams ?? []).length,
      },
      '-',
      { label: 'SVG этой диаграммы', run: () => {
        downloadText(exportSvgString(m, store.profile), `${slugify(m.name)}.svg`, 'image/svg+xml');
        track('export', { format: 'svg' });
        set({ hint: 'SVG сохранён' });
        ScToast.show('SVG сохранён', { tone: 'success' });
      } },
      { label: 'PNG этой диаграммы (в своём размере)', run: () => exportPng(1) },
      { label: 'PNG ×2 (для печати и Retina)', run: () => exportPng(2) },
      { label: 'JSON (как на диск)', run: () => {
        downloadText(serialize(m), `${slugify(m.name)}.uml.json`);
        set({ hint: 'JSON сохранён' });
        ScToast.show('JSON сохранён', { tone: 'success' });
      } },
      '-',
      {
        label: 'Печать этой диаграммы (PDF)…',
        title: 'Текущий лист на A4: только диаграмма, с именем модели и датой под листом',
        run: printDiagram,
        disabled: !currentDiagram(store.model),
      },
    ], { title: 'Экспорт' }),

    el('div', { class: 'doc-name', text: m.name, title: `${m.name} — ${fileName}` }),

    diagramPicker(m),

    el('button', {
      type: 'button',
      class: `iconbtn${document.body.classList.contains('hide-left') ? '' : ' on'}`,
      title: 'Левая панель: дерево модели',
      'aria-label': 'Показать или скрыть левую панель',
      'aria-pressed': document.body.classList.contains('hide-left') ? 'false' : 'true',
      onclick: toggleLeft,
    }, icon('ui-panel-left', 18)),
    el('button', {
      type: 'button',
      class: `iconbtn${rightVisible() ? ' on' : ''}`,
      title: 'Правая панель: свойства',
      'aria-label': 'Показать или скрыть правую панель',
      'aria-pressed': rightVisible() ? 'true' : 'false',
      onclick: toggleRight,
    }, icon('ui-panel-right', 18)),
    // Правая группа: панели · Библиотека · Курс · Подсказка · Акцент.
    // «Библиотека» и «Курс» — переключатели: aria-pressed и повторное нажатие
    // закрывает (UX-COURSE-LIBRARY §1.3). «Подсказка» — ui-help: до этой
    // правки «?» открывал справочник и занял место подсказки по управлению.
    el('button', {
      type: 'button',
      class: `iconbtn${referenceOpen() ? ' on' : ''}`,
      title: referenceOpen()
        ? 'Библиотека открыта — нажмите, чтобы закрыть (Esc)'
        : 'Библиотека: нотация, правила, спецификация, пособие',
      'aria-label': 'Библиотека: нотация, правила, спецификация, пособие',
      'aria-pressed': referenceOpen() ? 'true' : 'false',
      onclick: toggleLibrary,
    }, icon('ui-library', 18)),
    el('button', {
      type: 'button',
      class: `iconbtn${courseModeOpen() ? ' on' : ''}`,
      title: courseModeOpen()
        ? 'Курс открыт — нажмите, чтобы вернуться к листу (Esc)'
        : 'Курс: упражнения пособия',
      'aria-label': 'Курс: упражнения пособия',
      'aria-pressed': courseModeOpen() ? 'true' : 'false',
      onclick: toggleCourse,
    }, icon('ui-course', 18)),
    el('button', {
      type: 'button',
      class: 'iconbtn',
      title: 'Подсказка: клавиши и правка',
      'aria-label': 'Подсказка: клавиши и правка',
      onclick: showHelp,
    }, icon('ui-help', 18)),
    // Исходный код: иконка в правой группе. Правило «восемь кнопок, не
    // двадцать две» касается панели действий над листом; здесь — служебная
    // ссылка рядом с «Подсказкой», и её искали глазами, не находя.
    el('a', {
      class: 'iconbtn brand-github',
      href: SOURCE_URL,
      target: '_blank',
      rel: 'noopener',
      title: 'Исходный код на GitHub',
      'aria-label': 'Исходный код на GitHub',
      html: icon('ui-github', 18),
    }),
    accentMenu(),
    appearanceMenu(),
  );
}

/**
 * «Библиотека» — справочник рядом с листом: переключатель, как и обещает
 * aria-pressed. Второе нажатие закрывает (§1.3). Открытие урока курса закрывает
 * справочник само (курс — режим, он занимает место листа), а открытие
 * справочника в режиме курса выводит из курса: иначе читалка оказалась бы под
 * слоем режима, невидимой.
 */
function toggleLibrary() {
  if (referenceOpen()) {
    closeReference();
    set({});
    return;
  }
  if (courseModeOpen()) closeCourse();
  openReference();
  set({});
}

/**
 * «Курс» — режим обучения: вход и выход одной кнопкой. Инспектор и ширина
 * листа при этом не меняются — курс не вкладка правой колонки, а слой над
 * листом (docs/research/UX-COURSE-LIBRARY.md §2.1).
 */
function toggleCourse() {
  if (courseModeOpen()) closeCourse();
  else openCourse();
  set({});
}

/** The diagram list + «new diagram»: one model, many sheets of many types. */
function diagramPicker(m) {
  const d = currentDiagram(m);
  const select = el('select', {
    class: 'diagram-pick',
    'aria-label': 'Диаграмма модели',
    title: 'Диаграмма модели: выберите другую или создайте новую кнопкой +',
    onchange: (e) => {
      const id = e.target.value;
      if (id === m.currentDiagramId) return;
      commit('Смена диаграммы', (mm) => { mm.currentDiagramId = id; });
      set({ selection: null, pending: null, hint: '' });
      fitToWindow();
      renderCanvas();
    },
  });
  for (const dd of m.diagrams) {
    select.append(el('option', {
      value: dd.id,
      text: `${dd.name} — ${typeOf(dd.kind)?.label ?? dd.kind}`,
      selected: dd.id === d?.id ? true : null,
    }));
  }
  return el('div', { class: 'diagram-pick-wrap' },
    select,
    el('button', {
      type: 'button',
      class: 'iconbtn',
      title: 'Новая диаграмма: любой из 14 типов UML 2.5',
      'aria-label': 'Создать диаграмму',
      onclick: newDiagram,
    }, icon('ui-plus', 16)));
}

/** Ask for the type, then add the diagram and switch to it. */
export async function newDiagram() {
  const pick = await chooseDiagramType();
  if (!pick) return null;
  const created = commit('Новая диаграмма', (m) => {
    const diagram = createDiagram(pick.name, pick.kind);
    m.diagrams.push(diagram);
    m.currentDiagramId = diagram.id;
    return diagram;
  });
  set({
    selection: null,
    pending: null,
    hint: `Создана «${created.name}» (${typeOf(created.kind)?.label ?? created.kind}). Двойной щелчок по элементу в дереве поставит его на этот лист.`,
  });
  fitToWindow();
  renderCanvas();
  return created;
}

/** «Разложить автоматически…» из меню: тот же вызов, что и в палитре. */
async function runAutoLayout() {
  const r = await autoLayout();
  set({ hint: layoutHint(r) });
  renderCanvas();
}

function runArrange(id) {
  const n = arrange(id);
  set({ hint: n ? `Выравнивание: ${n} фигур.` : 'Нужно две фигуры или больше.' });
  renderCanvas();
}

export const TOOL_KEYS = {
  select: 'V', class: 'C', interface: 'I', enumeration: 'E', package: 'P', note: 'N',
  association: 'A', generalization: 'G', dependency: 'D', realization: 'R',
};

/** The active diagram's keyboard letter for a tool, or ''. */
export function toolKey(kind) {
  if (kind === 'select') return 'V';
  const d = currentDiagram(store.model);
  return keyFor(d?.kind, kind) || TOOL_KEYS[kind] || '';
}

/** Save what the user sees: an open editor commits first. */
export function saveCurrent() {
  flushEdits();
  const n = saveModel(store.model, store.ui.fileName);
  markSaved(n);
  ScToast.show(`Сохранено: ${n}`, { tone: 'success' });
}

async function newModel() {
  if (store.ui.dirty && !await confirmDialog('Новая модель?', 'Несохранённые изменения будут потеряны.', 'Открыть новую', 'Остаться')) return;
  clearAutosave();
  loadModel(createModel('Новая модель'));
  fitToWindow();
  renderCanvas();
}

async function loadSample() {
  if (store.ui.dirty && !await confirmDialog('Загрузить пример?', 'Несохранённые изменения будут потеряны.', 'Загрузить', 'Остаться')) return;
  loadModel(buildSampleModel());
  fitToWindow();
  renderCanvas();
}

/** One model, fourteen diagrams — one per UML 2.5 type, each with content. */
async function loadAllTypes() {
  if (store.ui.dirty && !await confirmDialog('Загрузить все 14 типов?', 'Несохранённые изменения будут потеряны.', 'Загрузить', 'Остаться')) return;
  loadModel(buildAllTypesModel());
  fitToWindow();
  renderCanvas();
  set({ hint: 'Пример: 14 диаграмм UML 2.5 в одной модели. Переключайтесь списком диаграмм или из дерева.' });
}

/**
 * Демонстрационный набор с намеренными ошибками: одна модель, шесть листов,
 * по одному нарушению на каждое правило с функцией. Файл лежит рядом с
 * приложением и читается так же, как любой `*.uml.json`, — через http, а не
 * из сборки: демо должно открываться и тогда, когда `dist/` ещё не пересобран.
 *
 * После загрузки панель «Проверки» открывается сама, а статусбар называет
 * числа из того же прогона, что и панель: `checkCounts` читает кеш
 * `openChecksPanel` → `refreshChecks`, поэтому цифры не расходятся.
 */
async function loadDemoErrors() {
  if (store.ui.dirty && !await confirmDialog('Загрузить демо с ошибками?', 'Несохранённые изменения будут потеряны.', 'Загрузить', 'Остаться')) return;
  try {
    const res = await fetch('material/demo-errors.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    const repairs = [];
    const model = deserialize(await res.text(), { repairs, profile: store.profile });
    loadModel(model);
    fitToWindow();
    renderCanvas();
    openChecksPanel();
    if (repairs.length) {
      ScToast.show(`Демо прочитано с починками: ${repairs.length}. Первая: ${repairs[0]}`, { tone: 'warning', duration: 9000 });
    }
    const c = checkCounts();
    set({
      hint: c.ready
        ? `Демо с ошибками: ${c.total} замечаний стандарта и ${c.advice} советов практики — панель «Проверки» открыта.`
        : 'Демо с ошибками загружено, но набор проверок не подключён.',
    });
  } catch (e) {
    set({ hint: `Демо не загрузилось: ${e.message}` });
    ScToast.show(`Демо не загрузилось: ${e.message}`, { tone: 'danger' });
  }
}

export { newModel, loadSample, loadDemoErrors, loadAllTypes };
