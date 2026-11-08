// Контекстное меню листа (правый клик).
//
// ЗАЧЕМ. В учебном пособии «контекстное меню» упоминается 70 раз из 999 строк:
// человек, прошедший книгу, правым кликом ищет «Sub Diagrams → New Diagram»,
// «Add Operand», «Navigability». До этой правки `canvas.js` молча съедал
// `contextmenu` — правый клик не делал ничего, и привычка из книги упиралась в
// пустоту.
//
// ЧТО ЗДЕСЬ ЕСТЬ. Только панель: разметка, позиционирование у края окна,
// клавиатура и закрытие. Что показать — решает вызывающий (`canvas.js` для
// листа, `panels.js` для дерева): он передаёт пункты, а не разметку.
//
// ПОЧЕМУ СВОЙ API, А НЕ `<sc-menu>`. Панель нужна ДВУМ местам с разными
// правилами: лист строит пункты по фигуре и связи, дерево — по строке модели.
// Общий компонент пришлось бы учить обоим; здесь общий только показ.
//
//   openContextMenu(x, y, items)   items: [{label, hint?, shortcut?, disabled?, danger?, run} | '-']
//   closeContextMenu()             закрыть, если открыто
//
// Пункт с `hint` рисуется двумя строками: подпись и пояснение. Разделитель —
// строка '-'.

import { el } from '../util.js';

let open = null;      // { menu, restore } — открытая панель
let outsideBound = false;

/**
 * Чем запомнить элемент, на котором был фокус.
 *
 * Узла мало: меню открывается поверх листа, а `selectOnly` перед ним запускает
 * `renderAll`, который пересобирает шапку и панели — к моменту закрытия
 * исходная кнопка уже выброшена из документа, и фокус уезжал в `body`.
 * Поэтому рядом с узлом лежит «адрес» — по нему тот же элемент находится
 * заново, если старый отсоединён.
 */
function rememberFocus() {
  const node = document.activeElement;
  if (!node || node === document.body) return { node: null, key: null };
  const attr = (n) => node.getAttribute?.(n);
  if (node.id) return { node, key: ['id', node.id] };
  if (attr('data-tool')) return { node, key: ['data-tool', attr('data-tool')] };
  if (attr('data-id') && attr('data-kind')) return { node, key: ['data-pair', attr('data-kind'), attr('data-id')] };
  if (attr('aria-label')) return { node, key: ['aria-label', attr('aria-label')] };
  return { node, key: null };
}

/** Тот же элемент после перерисовки — или null, если его больше нет. */
function findAgain(key) {
  if (!key) return null;
  const esc = (v) => (window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
  try {
    if (key[0] === 'id') return document.getElementById(key[1]);
    if (key[0] === 'data-tool') return document.querySelector(`[data-tool="${esc(key[1])}"]`);
    if (key[0] === 'data-pair') return document.querySelector(`[data-kind="${esc(key[1])}"][data-id="${esc(key[2])}"]`);
    if (key[0] === 'aria-label') return document.querySelector(`[aria-label="${esc(key[1])}"]`);
  } catch { /* кривой селектор — просто некуда вернуть фокус */ }
  return null;
}

/**
 * Открыть меню в точке экрана. Повторный вызов закрывает предыдущее: два меню
 * одновременно — это уже не меню, а беспорядок.
 */
export function openContextMenu(x, y, items = []) {
  closeContextMenu();
  if (!items.length) return;

  // Запомнить фокус ДО вставки панели: вставка сама его не трогает, но
  // `renderAll` от выделения успевает пересобрать шапку — адрес спасает.
  const restore = rememberFocus();

  const menu = el('div', {
    class: 'ctx-menu',
    role: 'menu',
    tabindex: '-1',
    'aria-label': 'Действия',
  });

  let first = null;
  for (const it of items) {
    if (it === '-') {
      menu.append(el('hr', { class: 'ctx-sep' }));
      continue;
    }
    const btn = el('button', {
      type: 'button',
      class: `ctx-item${it.danger ? ' danger' : ''}`,
      role: 'menuitem',
      disabled: it.disabled ? true : null,
      // Подпись и сочетание — в одной строке; пояснение — во второй. Порядок
      // для скринридера тот же, что для глаза: сначала что сделает, потом чем.
      'aria-label': it.hint ? `${it.label}. ${it.hint}` : it.label,
      onclick: () => { runItem(it); },
    },
    el('span', { class: 'ctx-main' },
      el('span', { class: 'ctx-label', text: it.label }),
      it.shortcut ? el('span', { class: 'ctx-key', text: it.shortcut }) : null),
    it.hint ? el('span', { class: 'ctx-hint', text: it.hint }) : null);
    if (!it.disabled && !first) first = btn;
    menu.append(btn);
  }

  document.body.append(menu);
  place(menu, x, y);

  open = { menu, restore };
  bindOutside();
  // Фокус — на первом доступном пункте: меню открывается клавиатурой и живёт
  // клавиатурой, а Tab из него уходит наружу (см. keydown ниже).
  (first ?? menu).focus({ preventScroll: true });

  return menu;
}

/** Закрыть меню и вернуть фокус туда, откуда его открыли. */
export function closeContextMenu({ restoreFocus = true } = {}) {
  if (!open) return false;
  const { menu, restore } = open;
  open = null;
  menu.remove();
  if (restoreFocus && restore) {
    // Узел мог пережить перерисовку (тогда он и нужен), а мог быть выброшен —
    // тогда ищем его двойника по адресу. Фокус в `body` после закрытия меню
    // означал бы, что клавиатура «ослепла»: следующие клавиши уходят в никуда.
    const node = restore.node?.isConnected ? restore.node : findAgain(restore.key);
    if (node && node.isConnected) node.focus?.({ preventScroll: true });
  }
  return true;
}

/** Открыто ли меню — нужно canvas.js, чтобы не начинать жест под ним. */
export const contextMenuOpen = () => !!open;

/* ------------------------------------------------------------- поведение */

function runItem(it) {
  // Сначала закрываем, потом выполняем: пункт может открыть диалог или
  // перерисовать панель, и закрытие «после» вернуло бы фокус уже не туда.
  closeContextMenu({ restoreFocus: false });
  try {
    it.run?.();
  } catch (e) {
    console.error('контекстное меню:', e);
  }
}

/**
 * Поставить панель в точку и удержать в окне.
 *
 * Три шага, как у меню шапки (`placePopover` в toolbar.js): сдвинуть влево,
 * если панель вылезает вправо; открыть вверх, если снизу меньше места, чем
 * сверху; иначе ограничить высоту и дать прокрутку. Третий шаг важен на
 * низком окне: переворот вверх поставил бы панель за верхнюю кромку.
 */
function place(menu, x, y) {
  const edge = 8;
  const gap = 2;
  const r = menu.getBoundingClientRect();
  let left = x;
  // Небольшой зазор, чтобы панель не наезжала на точку клика: курсор должен
  // оставаться видимым на том, к чему меню относится.
  let top = y + gap;
  if (left + r.width > window.innerWidth - edge) left = Math.max(edge, x - r.width);
  if (left < edge) left = edge;
  const roomBelow = window.innerHeight - y - edge - gap;
  const roomAbove = y - edge - gap;
  if (r.height > roomBelow && roomAbove > roomBelow) {
    top = Math.max(edge, y - r.height - gap);
    if (r.height > roomAbove) {
      top = edge;
      menu.style.maxHeight = `${Math.max(120, roomAbove)}px`;
      menu.style.overflowY = 'auto';
    }
  } else if (r.height > roomBelow) {
    menu.style.maxHeight = `${Math.max(120, roomBelow)}px`;
    menu.style.overflowY = 'auto';
  }
  // Высота панели могла только что стать ограниченной — перечитываем её,
  // иначе нижняя поправка считалась бы по прежнему, «идеальному» размеру.
  const box = menu.getBoundingClientRect();
  if (top + box.height > window.innerHeight - edge) {
    top = Math.max(edge, window.innerHeight - edge - box.height);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function bindOutside() {
  if (outsideBound) return;
  outsideBound = true;
  // Закрытие по клику вне и по прокрутке — в capture: иначе лист успел бы
  // обработать pointerdown и, например, снять выделение под закрывающимся меню.
  document.addEventListener('pointerdown', (e) => {
    if (!open) return;
    if (open.menu.contains(e.target)) return;
    closeContextMenu({ restoreFocus: false });
  }, true);
  document.addEventListener('wheel', (e) => {
    if (!open) return;
    // Колесо НАД самой панелью — это её собственная прокрутка (длинное меню на
    // низком окне), а не уход листа из-под неё.
    if (open.menu.contains(e.target)) return;
    closeContextMenu({ restoreFocus: false });
  }, { capture: true, passive: true });
  // Прокрутка без колеса — ползунком, клавишами, тачпадом в панели модели:
  // меню висит в координатах окна и отъехало бы от того, к чему относится.
  document.addEventListener('scroll', (e) => {
    if (!open || e.target === open.menu) return;
    closeContextMenu({ restoreFocus: false });
  }, true);
  window.addEventListener('blur', () => { if (open) closeContextMenu({ restoreFocus: false }); });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    const items = [...open.menu.querySelectorAll('.ctx-item:not(:disabled)')];
    const at = items.indexOf(document.activeElement);

    // Enter и пробел нажимают пункт САМИ, в обход остальных обработчиков.
    // Без этого Enter уходил в глобальный обработчик main.js («F2/Enter —
    // переименовать выделенное») и открывал редактор имени ПОД меню: пункт
    // оставался ненажатым, а меню — открытым. preventDefault здесь ещё и
    // гасит «щелчок» кнопки по умолчанию, чтобы действие не сработало дважды.
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (at >= 0) items[at].click();
      return;
    }

    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeContextMenu(); return; }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!items.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = at < 0
        ? (step > 0 ? 0 : items.length - 1)
        : (at + step + items.length) % items.length;
      items[next].focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      (e.key === 'Home' ? items[0] : items[items.length - 1])?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Tab') {
      // Tab — не «следующий пункт», а выход: в меню пункты ходят стрелками.
      // preventDefault не нужен: пусть фокус уйдёт своим обычным путём.
      closeContextMenu({ restoreFocus: false });
      return;
    }
    // Всё остальное за меню не проходит: пока оно открыто, буквы инструментов,
    // Ctrl+Z и Delete не должны срабатывать по листу за спиной у меню.
    e.stopPropagation();
  }, true);
}
