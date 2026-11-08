// The tool strip above the sheet — the only place a tool lives.
//
// design/ui-audit-design.md §3.1: the nine create tools and the arrow used to
// be in the toolbar AND in a left-panel palette (9 of 9 labels duplicated),
// while the palette ate 473 of 679 px of the panel and the model tree sat
// behind a tab. The palette is gone; the tree owns the panel; the tools sit
// here, next to the sheet they act on.
//
// Height comes from styles.css: 32 px in icon form, 56 px with labels at
// window width ≥ 1370 px. The labels are never *lost* below that — they stay
// in each button's title, in its aria-label and in Ctrl+K.

import { el, clear } from '../util.js';
import { NOTATION, paletteFor, keyFor, toolHint } from '../model/notation.js';
import { store, set } from '../state/store.js';
import { icon, toolIcon } from './icons.js';
import { currentDiagram } from '../model/model.js';

/**
 * Липкий инструмент — тумблер в полосе, по умолчанию ВЫКЛЮЧЕН.
 *
 * ЗАЧЕМ. Десять вариантов использования подряд — это десять нажатий клавиши
 * инструмента: после каждой фигуры полоса возвращается к «Выбору». В Visual
 * Человек, пришедший из книги, ждёт, что инструмент останется выбранным.
 *
 * ПОЧЕМУ ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ. Клик по пустому листу сейчас снимает
 * выделение; с липким инструментом тот же клик начал бы НОВУЮ фигуру. Менять
 * эту привычку молча нельзя — она и в тестах, и в руках. Поэтому тумблер:
 * кому надо — включает, у кого нет — всё как было.
 *
 * Состояние живёт в localStorage, а не в модели: это настройка читателя, а не
 * свойство файла, и в .uml.json ей делать нечего.
 */
const STICKY_KEY = 'uml-sticky-tool';
let sticky = readSticky();

function readSticky() {
  try { return localStorage.getItem(STICKY_KEY) === '1'; } catch { return false; }
}

/** Остаётся ли инструмент после постановки фигуры или связи. */
export function stickyTool() { return sticky; }

function setSticky(next) {
  sticky = !!next;
  try { localStorage.setItem(STICKY_KEY, sticky ? '1' : '0'); } catch { /* заблокировано — живёт до перезагрузки */ }
  // Перерисовка полосы выбрасывает нажатую кнопку из документа, и фокус уехал
  // бы в `body`: клавиатурный человек терял бы место. Возвращаем его на тот же
  // тумблер — он единственный в полосе, и его адрес один.
  const hadFocus = document.activeElement?.classList?.contains('tstrip-sticky');
  renderToolstrip();
  if (hadFocus) document.querySelector('#toolstrip .tstrip-sticky')?.focus({ preventScroll: true });
}

/** The cursor is a tool too, but not a shape of the notation package. */
const SELECT = { label: 'Выбор', hint: 'Стрелка: выбирать и двигать' };

const defOf = (kind) => (kind === 'select'
  ? SELECT
  : NOTATION.shapes[kind] ?? NOTATION.connectors[kind] ?? { label: kind });

/**
 * Labels or icons? Measured, not taken from a width threshold: the Class
 * palette is 14 chips and needs ~1076 px with labels, while the centre column
 * is 856 px at 1440. The strip renders in its labelled form and drops to
 * icons (`.tight`) whenever the labels would overflow — that keeps every tool
 * on screen and the strip from scrolling, which is what used to clip the
 * selected chip's ring. Re-measured on resize, on panel toggles (renderAll
 * calls us) and once the webfont lands, since Inter's metrics decide the fit.
 */
function fitLabels(host) {
  if (!host?.isConnected) return;
  const wasTight = host.classList.contains('tight');
  if (wasTight) host.classList.remove('tight');
  // Forced sync layout: the strip is rebuilt on every render, so this is the
  // only moment the labelled width can be read.
  const overflow = host.scrollWidth - host.clientWidth > 1;
  if (overflow) host.classList.add('tight');
}

function bindOnce(host) {
  if (host.dataset.bound === '1') return;
  host.dataset.bound = '1';
  // The scrollbar is hidden (styles.css), so a plain mouse wheel must be able
  // to reach the tools that sit past the right edge on narrow windows.
  host.addEventListener('wheel', (e) => {
    if (host.scrollWidth <= host.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    host.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  let queued = false;
  window.addEventListener('resize', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fitLabels(host); });
  });
  document.fonts?.ready.then(() => fitLabels(host)).catch(() => {});
}

function chip(kind, diagramKind) {
  const def = defOf(kind);
  const key = kind === 'select' ? 'V' : keyFor(diagramKind, kind);
  const active = store.ui.tool === kind;
  const hint = toolHint(def);
  const btn = el('button', {
    class: `tool${active ? ' on' : ''}`,
    type: 'button',
    title: key ? `${hint} (${key})` : hint,
    'aria-label': key ? `${def.label}, инструмент, клавиша ${key}` : def.label,
    'aria-pressed': active ? 'true' : 'false',
    'data-tool': kind,
    onclick: () => set({
      tool: kind,
      pending: null,
      hint: kind === 'select' ? '' : toolHint(def),
    }),
  },
  toolIcon(kind, 24),
  el('span', { class: 'lbl', text: def.label }));
  return btn;
}

export function renderToolstrip() {
  const host = document.getElementById('toolstrip');
  if (!host) return;
  clear(host);

  const d = currentDiagram(store.model);
  const pal = paletteFor(d?.kind);

  host.append(chip('select', d?.kind));
  host.append(el('span', { class: 'tstrip-sep', role: 'separator', 'aria-orientation': 'vertical' }));
  for (const kind of pal.shapes) host.append(chip(kind, d?.kind));
  host.append(el('span', { class: 'tstrip-sep', role: 'separator', 'aria-orientation': 'vertical' }));
  for (const kind of pal.connectors) host.append(chip(kind, d?.kind));

  host.append(el('span', { class: 'tstrip-sep', role: 'separator', 'aria-orientation': 'vertical' }));
  host.append(stickyChip());

  bindOnce(host);
  fitLabels(host);
}

/**
 * Кнопка «остаться в инструменте». Стоит последней, после разделителя: она
 * про РЕЖИМ полосы, а не про фигуру, и не должна читаться как ещё один
 * инструмент.
 */
function stickyChip() {
  return el('button', {
    type: 'button',
    class: `tool tstrip-sticky${sticky ? ' on' : ''}`,
    'aria-pressed': sticky ? 'true' : 'false',
    'aria-label': sticky
      ? 'Оставаться в инструменте: включено. Следующий клик по листу поставит ещё одну фигуру'
      : 'Оставаться в инструменте: выключено. После фигуры полоса вернётся к «Выбору»',
    title: sticky
      ? 'Оставаться в инструменте (включено) — Esc возвращает «Выбор»'
      : 'Оставаться в инструменте — после фигуры не возвращаться к «Выбору»',
    onclick: () => setSticky(!sticky),
  },
  icon('ui-pin', 24),
  el('span', { class: 'lbl', text: 'Держать' }));
}
