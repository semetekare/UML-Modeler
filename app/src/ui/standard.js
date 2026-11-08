// Реестр констрейнтов UML 2.5.1 — 449 строк со статусом проверяемости,
// фильтрами и поиском. Это НЕ вкладка правой панели, а статья полки
// «Стандарт» в библиотеке: реестр — справочный материал, а не инструмент
// рисования, и панель 255 px для таблицы из 449 строк заведомо тесна.
// Разметку рисует этот модуль, а вызывает его `reference.js`
// (`renderStandardInto`) — данные и разметка остаются в одном месте.
//
// ЗАЧЕМ ОН. Панель «Проверки» показывает то, что нашлось в ЭТОЙ модели, а
// справочник — записанные правила. Между ними остаётся главный вопрос
// человека, который открыл учебное пособие: «а что стандарт требует вообще и
// что из этого редактор проверяет?». Ответ лежит в реестре
// (`material/rules-coverage/coverage.json`); в приложение он попадает через
// `notation/rules/coverage.json` — тот же реестр, собранный для страницы.
//
// ПОЧЕМУ ЗНАМЕНАТЕЛЬ 166, А НЕ 449. 283 констрейнта относятся к метаклассам,
// которых редактор не рисует ни одной фигурой (Gate, LoopNode,
// ReadLinkObjectEndAction…). Проверять их нечем не потому, что «не успели», а
// потому что таких конструкций на листе не бывает. Поэтому шапка называет две
// цифры сразу — «исполняется из 166 в области» и «записано правил»: первая
// отвечает на вопрос «как мы выглядим перед стандартом», вторая — «сколько
// правил есть». Одно число без второго врало бы в одну из сторон, а вписанные
// руками числа разъезжаются с реестром молча (грабли проекта №10).
//
// Строка «вне области» по умолчанию СКРЫТА: 283 строки шума, у каждой одна и
// та же причина («метакласса нет ни одной фигурой»), и включать их надо
// осознанно — чипом статуса.
//
// 449 строк в DOM — нормально. Пересобирать таблицу на каждый ввод символа
// нельзя: фильтр только прячет уже построенные строки (`hidden`), а пачка
// скрытий идёт в requestAnimationFrame, чтобы быстрый набор не устраивал
// очередь из перерисовок.

import { el, clear } from '../util.js';

/**
 * Статусы реестра — ровно те, что в данных. Подписи и значения — из
 * docs/RULES-COVERAGE.md: это не наша выдумка, а словарь реестра, и
 * расходиться с ним полка не имеет права.
 */
const STATUS_ORDER = ['executable', 'todo', 'tautology', 'gap', 'no-ocl', 'out-of-scope'];
const STATUS = {
  executable: { label: 'проверяется', about: 'правило записано, функция есть' },
  todo: { label: 'готово к написанию', about: 'всё нужное в модели есть, правило ещё не написано' },
  tautology: { label: 'тавтология схемы', about: 'в этой схеме нарушить нечем' },
  gap: { label: 'нужно поле', about: 'нет поля или конструкции модели' },
  'no-ocl': { label: 'нет OCL', about: 'в стандарте у констрейнта нет OCL — проверять нечего' },
  'out-of-scope': { label: 'вне области', about: 'метакласса нет ни одной фигурой или связью нотации' },
};

/** «Вне области» — не долг, а граница редактора: по умолчанию её не видно. */
const DEFAULT_STATUSES = STATUS_ORDER.filter((s) => s !== 'out-of-scope');

const st = {
  data: null,
  error: '',
  statuses: new Set(DEFAULT_STATUSES),
  metaclass: '',
  query: '',
  expanded: new Set(),      // ключи раскрытых строк: переживают фильтрацию
  rows: [],                 // { item, node, key, hay }
  countNode: null,
  raf: 0,
};

// Куда рисовать и чем открывать пункт. `host` — статья полки в библиотеке;
// `ctx.openClause` передаёт reference.js, поэтому обратного импорта нет:
// standard.js не знает о читалке, а читалка зовёт его. Данные тоже приходят
// снаружи (`ctx.data`): их грузит и кэширует reference/data.js — один fetch
// на всё приложение, а не второй такой же здесь.
let host = null;
let ctx = {};

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

/**
 * Нарисовать реестр в переданный узел (статью полки «Стандарт»).
 * `ctx.data` — разобранный coverage.json, `ctx.error` — почему его нет,
 * `ctx.openClause(номер)` — переход в пункт стандарта.
 */
export function renderStandardInto(target, context = {}) {
  if (!target) return;
  host = target;
  ctx = context;
  st.error = context.error ? String(context.error) : '';
  if (context.data) st.data = context.data;
  renderStandard();
}

/** Полная сборка статьи. Зовётся при каждом открытии полки. */
export function renderStandard() {
  if (!host) return;
  clear(host);

  if (st.error) {
    host.append(el('div', { class: 'empty', id: 'standard-error' },
      el('b', { text: 'Реестр констрейнтов не загрузился' }),
      el('div', { class: 'mini', text: `${st.error}. Файл — notation/rules/coverage.json, `
        + 'собирается командой node tools/build-coverage-ui.mjs.' })));
    return;
  }
  if (!st.data) return;

  const d = st.data;
  const t = d.totals;

  // Шапка: две цифры и разница. Первая — покрытие по области (а не по всем
  // 449), вторая — сколько правил вообще записано в наборе.
  // Заголовок статьи даёт библиотека (head() в reference.js) — здесь только
  // цифры: два «Стандарт» подряд читались бы как ошибка вёрстки.
  host.append(el('div', { class: 'std-head', id: 'standard-head' },
    el('div', { class: 'std-nums', id: 'standard-nums' },
      el('b', { text: String(countStatus(d, 'executable')) }),
      ` из ${t.inScope} в области · записано ${t.rulesWritten}`),
    el('div', { class: 'std-note mini' },
      `Всего в стандарте ${t.constraints} констрейнтов у ${t.metaclasses} метаклассов. `
      + `Вне области — ${t.outOfScope}: их метакласса нет ни одной фигурой или связью нотации, `
      + 'и проверять там нечего. Покрытие поэтому считается по области, а не по всем 449.')));

  host.append(filterBar(d));

  // Легенда — свёрнутая: словарь нужен, но не в каждом взгляде.
  const legend = el('details', { class: 'std-legend', id: 'standard-legend' },
    el('summary', { text: 'Что значат статусы' }));
  const ul = el('ul');
  for (const s of STATUS_ORDER) {
    ul.append(el('li', {},
      el('span', { class: `std-badge ${s}`, text: STATUS[s].label }),
      ` — ${STATUS[s].about} (${d.byStatus[s] ?? 0})`));
  }
  legend.append(ul);
  host.append(legend);

  st.countNode = el('div', { class: 'std-count mini', id: 'standard-count' });
  host.append(st.countNode);

  const list = el('ul', { class: 'std-rows', id: 'standard-rows' });
  st.rows = d.items.map((item) => buildRow(item));
  for (const r of st.rows) list.append(r.node);
  host.append(list);

  applyFilters();
}

const countStatus = (d, s) => d.byStatus?.[s] ?? 0;

/** Фильтры: чипы статусов, метакласс, поиск. Пересборки таблицы не делают. */
function filterBar(d) {
  const chips = el('div', { class: 'std-chips', id: 'standard-statuses', role: 'group', 'aria-label': 'Фильтр по статусу' });
  for (const s of STATUS_ORDER) {
    chips.append(el('button', {
      type: 'button',
      class: `std-chip ${s}`,
      'data-status': s,
      'aria-pressed': st.statuses.has(s) ? 'true' : 'false',
      title: `${STATUS[s].about} — ${d.byStatus[s] ?? 0}`,
      onclick: () => {
        if (st.statuses.has(s)) st.statuses.delete(s); else st.statuses.add(s);
        syncChips();
        schedule();
      },
    }, el('span', { class: 'std-chip-label', text: STATUS[s].label }),
    el('span', { class: 'std-chip-n', text: String(d.byStatus[s] ?? 0) })));
  }

  const metas = [...new Set(d.items.map((i) => i.metaclass))].sort((a, b) => a.localeCompare(b));
  const select = el('select', {
    class: 'std-select',
    id: 'standard-metaclass',
    'aria-label': 'Фильтр по метаклассу',
    onchange: (e) => { st.metaclass = e.target.value; schedule(); },
  },
  el('option', { value: '', text: `Все метаклассы (${metas.length})` }),
  ...metas.map((m) => el('option', { value: m, text: `${m} (${d.items.filter((i) => i.metaclass === m).length})` })));

  const search = el('input', {
    type: 'search',
    class: 'std-search',
    id: 'standard-search',
    placeholder: 'Имя констрейнта или текст…',
    'aria-label': 'Поиск по имени констрейнта и тексту',
    autocomplete: 'off',
    oninput: (e) => { st.query = e.target.value; schedule(); },
  });

  const reset = el('button', {
    type: 'button', class: 'std-reset', id: 'standard-reset', text: 'Сбросить',
    title: 'Вернуть фильтры по умолчанию: все статусы, кроме «вне области»',
    onclick: () => {
      st.statuses = new Set(DEFAULT_STATUSES);
      st.metaclass = '';
      st.query = '';
      syncChips();
      select.value = '';
      search.value = '';
      schedule();
    },
  });

  return el('div', { class: 'std-filters' },
    chips,
    el('div', { class: 'std-filter-row' }, select, reset),
    search);
}

/** Чипы показывают своё состояние сами: без этого «нажат» не отличить от «нет». */
function syncChips() {
  for (const b of document.querySelectorAll('#standard-statuses .std-chip')) {
    b.setAttribute('aria-pressed', st.statuses.has(b.dataset.status) ? 'true' : 'false');
  }
}

/** Одна строка реестра: имя и статус, метакласс и пункт, ниже — раскрытие. */
function buildRow(item) {
  const key = `${item.metaclass}::${item.name}`;
  const open = st.expanded.has(key);

  const detail = el('div', { class: 'std-detail', hidden: !open },
    item.reason ? el('p', { class: 'std-reason', text: item.reason }) : null,
    item.text ? el('p', { class: 'std-text', text: `«${item.text}»` }) : null,
    item.ocl ? el('pre', { class: 'std-ocl mono', text: item.ocl }) : null,
    item.missing?.length
      ? el('div', { class: 'std-missing' },
        el('b', { text: 'Чего не хватает модели: ' }),
        ...item.missing.map((m) => el('div', { class: 'std-need', text: `· ${m.property} — ${m.why}` })))
      : null);

  const node = el('li', {
    class: `std-row ${item.status}`,
    'data-key': key,
    'data-status': item.status,
    'data-metaclass': item.metaclass,
    role: 'button',
    tabindex: '0',
    'aria-expanded': open ? 'true' : 'false',
    title: `${item.metaclass} · п. ${item.clause} · ${item.name} — ${STATUS[item.status].label}`,
    onclick: (e) => {
      // Кнопка пункта ведёт в справочник и строку не раскрывает: это два
      // разных действия, и путать их значит уводить человека не туда.
      if (e.target.closest('.std-clause')) return;
      toggleRow(key, node, detail);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(key, node, detail); }
    },
  },
  el('div', { class: 'std-line' },
    el('span', { class: 'std-name', text: item.name }),
    el('span', { class: `std-badge ${item.status}`, text: STATUS[item.status].label })),
  el('div', { class: 'std-line2' },
    el('span', { class: 'std-meta', text: item.metaclass }),
    el('button', {
      type: 'button',
      class: 'std-clause',
      'data-clause': item.clause,
      title: `UML 2.5.1, п. ${item.clause} — открыть статью в справочнике`,
      onclick: (e) => { e.stopPropagation(); ctx.openClause?.(item.clause); },
    }, `п. ${item.clause}`)),
  detail);

  return {
    item,
    node,
    key,
    detail,
    hay: norm(`${item.name} ${item.metaclass} ${item.clause} ${item.text ?? ''} ${item.ocl ?? ''}`),
  };
}

function toggleRow(key, node, detail) {
  if (st.expanded.has(key)) {
    st.expanded.delete(key);
    detail.hidden = true;
    node.setAttribute('aria-expanded', 'false');
    node.classList.remove('open');
  } else {
    st.expanded.add(key);
    detail.hidden = false;
    node.setAttribute('aria-expanded', 'true');
    node.classList.add('open');
  }
}

/** Фильтр — по уже построенному списку, пачкой в одном кадре. */
function schedule() {
  if (st.raf) return;
  st.raf = requestAnimationFrame(() => {
    st.raf = 0;
    applyFilters();
  });
}

function matches(row) {
  const it = row.item;
  if (!st.statuses.has(it.status)) return false;
  if (st.metaclass && it.metaclass !== st.metaclass) return false;
  if (st.query) {
    const q = norm(st.query).trim();
    if (q && !row.hay.includes(q)) return false;
  }
  return true;
}

function applyFilters() {
  let shown = 0;
  for (const row of st.rows) {
    const ok = matches(row);
    row.node.hidden = !ok;
    if (ok) shown += 1;
  }
  if (st.countNode) {
    st.countNode.textContent = st.data
      ? `показано ${shown} из ${st.rows.length}`
      : '';
  }
  return shown;
}

/**
 * Замер для проверок: сколько строк построено, сколько видно, какие статусы
 * включены. Отдельная функция, чтобы наборы не считали DOM-строки по классам
 * и не зависели от вёрстки.
 */
export function standardReport() {
  return {
    ready: !!st.data,
    error: st.error,
    rows: st.rows.length,
    visible: st.rows.filter((r) => !r.node.hidden).length,
    statuses: [...st.statuses],
    metaclass: st.metaclass,
    query: st.query,
    expanded: [...st.expanded],
    byStatus: st.data?.byStatus ?? null,
    totals: st.data?.totals ?? null,
  };
}
