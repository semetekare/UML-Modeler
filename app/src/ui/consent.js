// Строка согласия на счётчик событий.
//
// ЗАЧЕМ. Счётчик включён по умолчанию (решение владельца 2026-11-08), а строка
// говорит об этом прямо и даёт отказаться одной кнопкой. Появляется один раз —
// в stand-сборке, когда в модели уже есть хотя бы одна диаграмма (человек
// начал работать, а не просто открыл пустую страницу).
//
// ЧТО ЗНАЧИТ ЗАКРЫТЬ. Крестик — это «оставить как есть»: выбор записывается
// как 'on', второго вопроса не будет. Отказ — только явная кнопка
// «Не отправлять» (или переключатель в справке), и тогда не уходит ничего.
//
// ГДЕ ЖИВЁТ. Отдельный узел `#uml-consent`, приклеенный к низу окна
// (`position: fixed`), выше статусбара. Раскладку он не трогает: панели,
// лист и статусбар остаются на своих местах — за это отвечают layout-тесты,
// и они не должны покраснеть из-за строки согласия.
//
// ПОЧЕМУ МОДУЛЬ САМ СЕБЯ МОНТИРУЕТ. Точно так же, как экран «Начало работы»
// (src/ui/welcome.js): `index.html` — общий файл, его правят несколько агентов,
// и ссылка на лист стилей оттуда легко теряется. Здесь и разметка, и `link`
// на `consent.css` создаются из самого модуля; при этом `initConsent()`
// вызывается только тогда, когда счётчик в сборке включён, — в обычной
// сборке не появляется ни узла, ни запроса.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ни одного внешнего хоста: «Что именно» ведёт на
// `../privacy/` того же сайта, откуда бы приложение ни открыли (из `/app/`
// это `/privacy/`, из корня — тоже `/privacy/`). Модель, файлы и текст не
// отправляются, и строка говорит это словами, а не мелким шрифтом.

import cfg from '../telemetry.config.js';
import { setTelemetryChoice } from '../telemetry.js';
import { store, subscribe } from '../state/store.js';
import { el } from '../util.js';

const KEY = 'uml.telemetry';

/** Стиль — из модуля, а не из index.html: см. шапку. */
const hasCss = () => [...document.querySelectorAll('link[rel="stylesheet"]')]
  .some((n) => /(^|\/)consent\.css(\?|$)/.test(n.getAttribute('href') || ''));
if (!hasCss()) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../consent.css', import.meta.url).href;
  link.dataset.consentCss = '1';
  document.head.append(link);
}

/** Значение согласия; ошибка хранилища — «ключа нет», то есть «не спрашивали». */
function consentValue() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

let host = null;
let built = false;
// Выбор сделан в этой вкладке: строка больше не показывается, даже если
// запись в localStorage не легла (заблокированное хранилище).
let chosen = false;

function choose(value) {
  chosen = true;
  setTelemetryChoice(value);
  dismiss();
}

function dismiss() {
  if (!host) return;
  host.hidden = true;
  host.remove();
  host = null;
}

function build(node) {
  const text = 'Счётчик включён: отправляем названия команд и число замечаний. '
    + 'Модель, файлы и текст — никогда. Выключить можно здесь или в справке.';
  node.append(el('div', { class: 'cs-line' },
    el('p', { class: 'cs-text', text }),
    el('div', { class: 'cs-actions' },
      // Относительная ссылка: тот же origin, другой путь. Никаких внешних
      // хостов — приложение офлайновое, и объяснение живёт рядом с ним.
      el('a', {
        class: 'cs-what',
        href: '../privacy/',
        target: '_blank',
        rel: 'noopener',
        text: 'Что именно',
      }),
      el('button', {
        type: 'button', class: 'btn cs-yes', text: 'Оставить', onclick: () => choose('on'),
      }),
      el('button', {
        type: 'button', class: 'btn cs-no', text: 'Не отправлять', onclick: () => choose('off'),
      }),
      // Крестик = «оставить как есть»: выбор записывается, второй раз не спрашиваем.
      el('button', {
        type: 'button',
        class: 'cs-close',
        text: '×',
        title: 'Закрыть — сбор остаётся включённым',
        'aria-label': 'Закрыть: сбор остаётся включённым',
        onclick: () => choose('on'),
      }))));
}

/**
 * Показывать ли строку: сборка разрешила, человек ещё не выбирал, и в модели
 * есть хотя бы одна диаграмма. Последнее — «начал работать»: спрашивать на
 * пустой странице не о чем.
 */
function shouldShow() {
  if (cfg.enabled !== true || chosen) return false;
  if (consentValue() !== null) return false;
  return (store.model?.diagrams ?? []).length > 0;
}

function render() {
  if (!host) return;
  host.hidden = !shouldShow();
}

/** Вызывается из main.js на старте. В обычной сборке не делает ничего. */
export function initConsent() {
  if (cfg.enabled !== true) return false;
  if (host || built) return false;
  // Выбор уже сделан раньше (в этой вкладке или в прошлый визит): узла не
  // создаём вовсе. «Строка исчезает навсегда» — значит её нет в документе,
  // а не «есть, но hidden».
  if (consentValue() !== null) {
    built = true;
    return false;
  }
  const node = document.createElement('div');
  node.id = 'uml-consent';
  node.hidden = true;
  node.setAttribute('role', 'region');
  node.setAttribute('aria-label', 'Согласие на счётчик событий');
  document.body.append(node);
  host = node;
  built = true;
  build(node);
  subscribe(render);
  render();
  return true;
}

/** Только для теста: показана ли строка сейчас. */
export const consentVisible = () => !!host && !host.hidden;