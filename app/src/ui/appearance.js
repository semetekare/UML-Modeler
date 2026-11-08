// Тема оформления: системная или выбранная вручную.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Решение «какая тема» принимает ui-kit (у него уже
// есть `ui-kit.appearance` = system | light | dark и подписка на смену
// системной темы), но приложению нужен свой, короткий вход: прочитать выбор,
// переключить и сказать, что сейчас на экране. UI не должен знать ни про
// атрибуты кита, ни про matchMedia.
//
// ГДЕ ЖИВЁТ СОСТОЯНИЕ. Одно место — атрибут `data-race` на <html>: по нему
// считает CSS (brand.css, styles.css, ui-kit/css/tokens.css), по нему же
// видно, что показано. Выбор человека — в localStorage['ui-kit.appearance'];
// ключ именно китовый, чтобы тема не расходилась между приложениями на одном
// origin. Атрибут ставится ДО первой отрисовки (index.html, обычный <script>
// перед стилями) — иначе тёмная тема вспыхивает светлой на загрузке.
//
// ЧЕГО ЗДЕСЬ НЕТ. Перерисовки листа: цвета листа и оболочки — это CSS-переменные,
// поэтому смена темы не требует ни пересборки SVG, ни commit. Экспорт от темы
// не зависит вовсе (render.js берёт ink()/fill() из нотации).

import {
  applyTheme,
  getTheme,
  onThemeChange,
  setAppearance,
} from '../../ui-kit/js/theme.js';
import { track } from '../telemetry.js';

/** Три состояния выбора. `system` — по настройке ОС. */
export const MODES = ['system', 'light', 'dark'];

export const MODE_LABELS = { system: 'Авто', light: 'Светлая', dark: 'Тёмная' };

/** Что выбрал человек (не то, что сейчас на экране). */
export function getMode() {
  const mode = getTheme().appearance;
  return MODES.includes(mode) ? mode : 'system';
}

/** Что сейчас на экране: `system`, разрешённый через настройку ОС. */
export function resolveMode() {
  const mode = getMode();
  if (mode !== 'system') return mode;
  const dark = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/** Что на самом деле стоит на <html> — для aria-pressed и подписи кнопки. */
export const currentMode = () => (document.documentElement.dataset.race === 'dark' ? 'dark' : 'light');

/** Скин приложения закреплён: тёмная тема — это маковский скин в тёмной расе. */
function pinSkin() {
  const root = document.documentElement;
  root.setAttribute('data-sc', 'mac');
  root.setAttribute('data-app', 'uml');
}

/** Переключить тему. Неизвестное значение читается как «Авто». */
export function applyMode(mode) {
  const next = MODES.includes(mode) ? mode : 'system';
  setAppearance(next);
  pinSkin();
  // `theme.change {value}` — выбор человека: system | light | dark. Только он:
  // стартовое чтение темы (index.html, initAppearance) событием не считается.
  track('theme.change', { value: next });
  return next;
}

/**
 * Вызывается один раз на старте, после initTheme. Ещё раз закрепляет скин
 * (initTheme ставит его из localStorage, а storage может быть заблокирован)
 * и отдаёт текущий выбор.
 */
export function initAppearance() {
  pinSkin();
  return getMode();
}

export { applyTheme, onThemeChange };