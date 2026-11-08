// The kit's <sc-command-palette> (ui-kit/js/command-palette.js) as the app's
// Ctrl+K: every toolbar action, tool and view command reachable by typing.
// The palette binds nothing itself — this module feeds it the command list
// and runs what it selects.

// Registers <sc-command-palette> as a side effect.
import '../../ui-kit/js/command-palette.js';

import { NOTATION, paletteFor, toolHint } from '../model/notation.js';
import { store, set, undo, redo, subscribe, selectionKind } from '../state/store.js';
import {
  renderCanvas, fitToWindow, zoomStep, deleteSelection, startEditSelected, setZoom,
  deleteElementFromModel, deleteRelationshipFromModel,
} from './canvas.js';
import { copySelection, cutSelection, pasteClipboard, duplicateSelection } from './clipboard.js';
import { arrange, autoLayout, layoutHint } from './arrange.js';
import { exportSvgString, exportPngBlob } from './render.js';
import { downloadText, slugify } from '../util.js';
import { ScToast } from '../../ui-kit/js/toast.js';
import { saveCurrent, newModel, loadSample, loadDemoErrors, loadAllTypes, toggleLeft, toggleRight, newDiagram } from './toolbar.js';
import { openPumlPicker, openPasteDialog } from './import-puml.js';
import { renderStatus } from './panels.js';
import { showHelp } from './dialog.js';
import { openReference } from './reference.js';
import { openCourse, closeCourse, courseModeOpen } from './course.js';
import { toolKey } from './toolbar.js';
import { currentDiagram } from '../model/model.js';

export function initCommands() {
  const paletteEl = document.getElementById('cmdpal');
  if (!paletteEl) return;

  const build = () => {
    const pal = paletteFor(currentDiagram(store.model)?.kind);
    return [
      { id: 'file-new', label: 'Новая модель', shortcut: '', group: 'Файл' },
      { id: 'file-open', label: 'Открыть *.uml.json…', shortcut: 'Ctrl+O', group: 'Файл' },
      { id: 'file-save', label: 'Сохранить *.uml.json', shortcut: 'Ctrl+S', group: 'Файл' },
      // Примеры — своя группа и в палитре: в шапке они переехали в меню
      // «Примеры», и палитра не должна называть их «Файлом».
      { id: 'file-sample', label: 'Пример: классы (интернет-магазин)', group: 'Примеры' },
      { id: 'file-demo-errors', label: 'Пример с ошибками (проверки)…', group: 'Примеры' },
      { id: 'file-all-types', label: 'Пример: все 14 типов UML', group: 'Примеры' },
      { id: 'diagram-new', label: 'Новая диаграмма (любой из 14 типов)', group: 'Файл' },
      { id: 'file-import-puml', label: 'Импорт PlantUML (.puml) — новый лист', group: 'Файл' },
      { id: 'file-import-puml-text', label: 'Импорт PlantUML: вставить текст', group: 'Файл' },
      { id: 'file-export-svg', label: 'Экспорт: SVG этой диаграммы', group: 'Файл' },
      { id: 'file-export-png', label: 'Экспорт: PNG этой диаграммы (в своём размере)', group: 'Файл' },
      { id: 'file-export-png2', label: 'Экспорт: PNG ×2', group: 'Файл' },
      { id: 'tool-select', label: 'Инструмент: выбор', shortcut: 'V', group: 'Инструменты' },
      ...pal.shapes.map((k) => ({
        id: `tool-${k}`,
        label: `Инструмент: ${NOTATION.shapes[k].label}`,
        shortcut: toolKey(k),
        group: 'Инструменты',
      })),
      ...pal.connectors.map((k) => ({
        id: `tool-${k}`,
        label: `Инструмент: ${NOTATION.connectors[k].label}`,
        shortcut: toolKey(k),
        group: 'Инструменты',
      })),
      { id: 'edit-undo', label: 'Отменить', shortcut: 'Ctrl+Z', group: 'Правка' },
      { id: 'edit-redo', label: 'Повторить', shortcut: 'Ctrl+Shift+Z', group: 'Правка' },
      { id: 'edit-rename', label: 'Переименовать выделенное', shortcut: 'F2', group: 'Правка' },
      { id: 'edit-copy', label: 'Копировать', shortcut: 'Ctrl+C', group: 'Правка' },
      { id: 'edit-cut', label: 'Вырезать', shortcut: 'Ctrl+X', group: 'Правка' },
      { id: 'edit-paste', label: 'Вставить', shortcut: 'Ctrl+V', group: 'Правка' },
      { id: 'edit-duplicate', label: 'Дублировать со сдвигом', shortcut: 'Ctrl+D', group: 'Правка' },
      { id: 'edit-align-left', label: 'Выровнять по левому краю', group: 'Правка' },
      { id: 'edit-align-center', label: 'Выровнять по центру', group: 'Правка' },
      { id: 'edit-align-right', label: 'Выровнять по правому краю', group: 'Правка' },
      { id: 'edit-align-top', label: 'Выровнять по верху', group: 'Правка' },
      { id: 'edit-align-middle', label: 'Выровнять по середине', group: 'Правка' },
      { id: 'edit-align-bottom', label: 'Выровнять по низу', group: 'Правка' },
      { id: 'edit-distribute-h', label: 'Равные промежутки по горизонтали', group: 'Правка' },
      { id: 'edit-distribute-v', label: 'Равные промежутки по вертикали', group: 'Правка' },
      { id: 'edit-layout', label: 'Разложить автоматически…', group: 'Правка' },
      { id: 'edit-delete', label: 'Снять с диаграммы', shortcut: 'Delete', group: 'Правка' },
      { id: 'edit-delete-model', label: 'Удалить из модели (элемент или связь)', shortcut: 'Shift+Delete', group: 'Правка' },
      { id: 'view-zoom-in', label: 'Крупнее', shortcut: 'Ctrl+=', group: 'Вид' },
      { id: 'view-zoom-out', label: 'Мельче', shortcut: 'Ctrl+-', group: 'Вид' },
      { id: 'view-zoom-100', label: 'Масштаб 100 %', shortcut: 'Ctrl+1', group: 'Вид' },
      { id: 'view-fit', label: 'Вписать диаграмму в окно', shortcut: 'Ctrl+0', group: 'Вид' },
      { id: 'view-left', label: 'Показать/скрыть левую панель', group: 'Вид' },
      { id: 'view-right', label: 'Показать/скрыть правую панель', group: 'Вид' },
      { id: 'view-grid', label: 'Показать/скрыть сетку', group: 'Вид' },
      { id: 'view-course', label: 'Курс: открыть вкладку «Курс»', group: 'Вид' },
      { id: 'reference', label: 'Справочник-учебник UML 2.5.1', group: 'Справка' },
      { id: 'help', label: 'Подсказка: клавиши и правка', group: 'Справка' },
    ];
  };

  let lastKind = null;
  const refresh = () => {
    const kind = currentDiagram(store.model)?.kind ?? null;
    if (kind === lastKind) return;
    lastKind = kind;
    paletteEl.commands = build();
  };
  refresh();
  subscribe(refresh);
  paletteEl.addEventListener('sc-command', (e) => run(e.detail.id, paletteEl));
}

const fileInput = () => document.getElementById('file-input');

function run(id, paletteEl) {
  switch (id) {
    case 'file-new': newModel(); break;
    case 'file-open': fileInput().click(); break;
    case 'file-save': saveCurrent(); break;
    case 'file-sample': loadSample(); break;
    case 'file-demo-errors': loadDemoErrors(); break;
    case 'file-all-types': loadAllTypes(); break;
    case 'diagram-new': newDiagram(); break;
    case 'file-import-puml': openPumlPicker(); break;
    case 'file-import-puml-text': openPasteDialog(); break;
    case 'file-export-svg': {
      const m = store.model;
      downloadText(exportSvgString(m, store.profile), `${slugify(m.name)}.svg`, 'image/svg+xml');
      set({ hint: 'SVG сохранён' });
      ScToast.show('SVG сохранён', { tone: 'success' });
      break;
    }
    case 'file-export-png':
    case 'file-export-png2': {
      const scale = id === 'file-export-png2' ? 2 : 1;
      const m = store.model;
      exportPngBlob(m, store.profile, scale).then(({ blob, width, height }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slugify(m.name)}${scale === 1 ? '' : '@2x'}.png`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        set({ hint: `PNG сохранён: ${width}×${height}` });
        ScToast.show(`PNG ${width}×${height} сохранён`, { tone: 'success' });
      }).catch((e) => {
        set({ hint: `PNG не сохранился: ${e.message}` });
        ScToast.show(`PNG не сохранился: ${e.message}`, { tone: 'danger' });
      });
      break;
    }
    case 'edit-undo': undo(); renderCanvas(); break;
    case 'edit-redo': redo(); renderCanvas(); break;
    case 'edit-rename': startEditSelected(); break;
    case 'edit-copy': {
      const n = copySelection();
      set({ hint: n ? `Скопировано: ${n}.` : 'Нечего копировать.' });
      break;
    }
    case 'edit-cut': cutSelection(); break;
    case 'edit-paste': pasteClipboard(); break;
    case 'edit-duplicate': duplicateSelection(); break;
    case 'edit-layout':
      // Та же команда, что в меню «Правка»: один диалог, один commit.
      autoLayout().then((r) => { set({ hint: layoutHint(r) }); renderCanvas(); });
      break;
    case 'edit-delete': deleteSelection(); break;
    case 'edit-delete-model':
      if (selectionKind() === 'connector') deleteRelationshipFromModel();
      else deleteElementFromModel();
      break;
    case 'view-zoom-in': zoomStep(1); renderStatus(); break;
    case 'view-zoom-out': zoomStep(-1); renderStatus(); break;
    case 'view-zoom-100': setZoom(1); renderStatus(); break;
    case 'view-fit': fitToWindow(); renderStatus(); break;
    case 'view-grid': set({ showGrid: !store.ui.showGrid }); break;
    case 'view-course':
      // Курс — режим: команда входит в него или выходит, как кнопка в тулбаре.
      if (courseModeOpen()) closeCourse(); else openCourse();
      break;
    case 'view-left': toggleLeft(); break;
    case 'view-right': toggleRight(); break;
    case 'reference': openReference(); break;
    case 'help': showHelp(); break;
    default: {
      if (id.startsWith('edit-align-') || id.startsWith('edit-distribute-')) {
        const n = arrange(id.replace(/^edit-/, ''));
        set({ hint: n ? `Выравнивание: ${n} фигур.` : 'Нужно две фигуры или больше.' });
        renderCanvas();
        break;
      }
      if (!id.startsWith('tool-')) break;
      const tool = id.slice(5);
      const def = NOTATION.shapes[tool] ?? NOTATION.connectors[tool];
      if (!def) break;
      set({ tool, pending: null, hint: tool === 'select' ? '' : toolHint(def) });
      if (store.ui.selection.length) renderCanvas();
    }
  }
}
