// Метрики листа из mechanics.json.
//
// build.mjs превращает mechanics.json в src/mechanics.generated.js. Оттуда
// берутся ТОЛЬКО числа, проверяемые по записи .vpp: сетка листа, высота
// подписи, толщина линии, стартовый масштаб образца.
//
// Числа группы layout (высота тулбара, ширины панелей, высота статусбара)
// сверены с настоящим кадром reference/vp163/1001.png (docs/MEASUREMENTS-AUDIT.md):
// подтвердилось одно — статусбар 28 px; три отвергнуты (в кадре три полосы
// 28/22/84, левая панель 202 и 328 на двух кадрах, правой панели нет вовсе),
// масштаб 75 % не читается. Поэтому раскладку окна задаёт
// design/density-spec.md через CSS (src/styles.css), а не этот файл.

import { MECHANICS, REJECTED } from '../mechanics.generated.js';

/**
 * Отклонённые числа — оставлены названными, чтобы отказ был виден в коде,
 * а не выражался молчаливым удалением. Ни одно не участвует в раскладке.
 * Рядом — что на самом деле в кадре.
 */
export const REJECTED_REFERENCE = {
  toolbarHeight: REJECTED.toolbarHeight?.value,     // 78: в кадре 28 + 22 + 84
  leftPanelWidth: REJECTED.leftPanelWidth?.value,   // 236: в кадре 202 и 328 (сплиттер)
  rightPanelWidth: REJECTED.rightPanelWidth?.value, // 300: правой панели в кадре нет
  // statusBarHeight здесь нет: 28 ИЗМЕРЕНО (MECHANICS.statusBarHeight), но
  // раскладку всё равно задаёт density-spec (24). Одно другому не противоречит:
  // 28 — что в кадре снимка, 24 — что выбрано в системе оформления.
};

/**
 * Размеры листа, которые нельзя выразить в CSS: они живут в SVG.
 * Вызывается из main.js в начале start(), до первой отрисовки.
 * Высоты хрома (44 / 32 / 24) и ширины панелей (264/240/216, 320/296) —
 * в styles.css, по density-spec.
 */
export function applyLayoutMetrics() {
  const root = document.documentElement;
  root.style.setProperty('--grid-size', String(MECHANICS.gridSize));
  // The dash of a dashed model line is the program's own LineStyle.Style2
  // (MECHANICS §13: v/dal/au#<clinit> entry 2 = {8, 5}), not a chosen number.
  root.style.setProperty('--dash', MECHANICS.dashPattern);
}
