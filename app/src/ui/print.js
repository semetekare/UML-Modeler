// Печать листов: «Экспорт → Печать всех диаграмм (PDF)…» и
// «Экспорт → Печать этой диаграммы (PDF)…».
//
// ОДИН МЕХАНИЗМ, РАЗНОЕ ЧИСЛО ЛИСТОВ. Печать всех и печать одной — это одна
// и та же сборка страниц, отличается только список диаграмм: у печати одной
// он из одного элемента. Поэтому подпись, вписывание в A4, снятие контейнера
// после `afterprint` и запасной путь Ctrl+P описаны здесь один раз.
//
// ПОЧЕМУ КОПИЯ, А НЕ ЖИВОЙ ЛИСТ. Живой лист свёрстан под окно: `#canvas`
// растянут на `#canvas-wrap`, а масштаб и сдвиг — состояние редактора
// (`store.ui.view`). Чтобы вписать его в A4, пришлось бы перед печатью знать
// размеры страницы в CSS-пикселях, а браузер отдаёт их только после входа в
// режим печати, — и масштаб пришлось бы менять туда и обратно, рискуя оставить
// человеку чужой вид. `exportDiagramSvgString` уже отдаёт лист с собственным
// `viewBox`, без панелей и без путей захвата клика; вписывание такого SVG в
// страницу — задача CSS (`max-width`/`max-height`), без единого замера и без
// трогания масштаба. Поэтому печатается КОПИЯ, а `#app` на печати скрыт
// целиком (`body.printing` в print.css).
//
// Копия живёт в `#print-sheet` на экране скрытом (`display: none`) и
// показывается только в `@media print`. Каждая диаграмма — свой `.ps-page`;
// print.css ставит разрыв страницы между ними.

import { el } from '../util.js';
import { store } from '../state/store.js';
import { currentDiagram } from '../model/model.js';
import { NOTATION } from '../model/notation.js';
import { exportDiagramSvgString } from './render.js';

const HOST_ID = 'print-sheet';

/** Контейнер печати: один на страницу, пересоздаётся на каждую печать. */
function host() {
  let node = document.getElementById(HOST_ID);
  if (!node) {
    node = el('div', { id: HOST_ID });
    document.body.append(node);
  }
  return node;
}

/** Подпись вида диаграммы — то, что человек видит в списке типов. */
const kindLabel = (diagram) => NOTATION.types[diagram?.kind]?.label ?? diagram?.kind ?? '';

/**
 * Имя модели, имя листа и дата — мелким под листом, как в оригинале.
 * У печати всех листов добавляется тип: страницы идут подряд, и на глаз
 * «Состояния заказа» и «Состояния заказа (вложенная)» различить нечем.
 */
function caption(model, diagram, withKind) {
  const date = new Date().toLocaleDateString('ru-RU');
  return [model?.name, diagram?.name, withKind ? kindLabel(diagram) : '', date]
    .filter((s) => String(s ?? '').trim()).join(' · ');
}

/**
 * Одна печатная страница: рисунок и подпись. Пустая диаграмма даёт пустой
 * лист с подписью — это её честный вид, а не «нет содержимого».
 */
function pageFor(model, diagram, withKind) {
  const page = el('div', { class: 'ps-page' });
  const art = el('div', { class: 'ps-art' });
  // Строка — уже готовый SVG (render.js собирает его одним сериализатором),
  // поэтому вставляется как разметка, а не как текст: корень `<svg>` даёт
  // парсеру правильное пространство имён.
  art.innerHTML = exportDiagramSvgString(model, diagram, store.profile);
  const svg = art.querySelector('svg');
  if (svg) {
    // Размеры оставляем родные (1 px листа = 1 px файла): маленькая диаграмма
    // печатается в своём размере, большая ужимается полями страницы через
    // max-width/max-height. `meet` — чтобы при ужатии не резались края.
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Диаграмма «${diagram?.name || ''}»`);
  }
  page.append(art, el('div', { class: 'ps-caption', text: caption(model, diagram, withKind) }));
  return page;
}

/**
 * Собрать печатную копию. Возвращает `false`, если собирать нечего: тогда
 * класс `printing` ставить нельзя — он скрыл бы всё приложение и напечатал
 * пустое место.
 */
function build(diagrams, withKind) {
  const model = store.model;
  const list = diagrams.filter(Boolean);
  if (!list.length) return false;

  const node = host();
  node.replaceChildren(...list.map((d) => pageFor(model, d, withKind)));
  return true;
}

function cleanup() {
  document.body.classList.remove('printing');
  document.getElementById(HOST_ID)?.remove();
}

/** Напечатать список листов: сборка копии, `print()`, уборка после. */
function printSheets(diagrams, { withKind = false } = {}) {
  try {
    if (!build(diagrams, withKind)) return;
  } catch {
    // Копию собрать не удалось — печатаем как есть, без скрытия #app:
    // пустая страница хуже, чем лист с панелями.
    cleanup();
    return;
  }
  document.body.classList.add('printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

/** «Печать этой диаграммы (PDF)…» — текущий лист. */
export function printDiagram() {
  printSheets([currentDiagram(store.model)]);
}

/**
 * «Печать всех диаграмм (PDF)…» — каждый лист модели на своей странице,
 * в порядке списка диаграмм (он же порядок дерева), вложенные включительно.
 */
export function printAllDiagrams() {
  printSheets(store.model?.diagrams ?? [], { withKind: true });
}

// Ctrl+P и «Печать» из меню браузера: собираем ту же копию для текущего листа.
// Если собрать не удалось, класс не ставится — печатается живой лист, а не
// пустое место.
window.addEventListener('beforeprint', () => {
  if (document.body.classList.contains('printing')) return;
  try {
    if (build([currentDiagram(store.model)], false)) document.body.classList.add('printing');
  } catch {
    cleanup();
  }
});
window.addEventListener('afterprint', cleanup);