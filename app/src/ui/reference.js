// Читалка справочника-учебника (партии Б19, Б21, Б22).
//
// Панель живёт ВНУТРИ #center, соседом листа: четыре сценария из пяти требуют
// «текст и лист одновременно». Не четвёртая вкладка справа (320 px = 45
// знаков, и лист закрыт) и не модал (пока открыт — рисовать нельзя).
//
// Вёрстка перенесена из material/reference-prototype/index.html: те же классы,
// те же ширины (--ref-w 420, --ref-measure 480, --ref-nav 200, --ref-toc 200),
// те же три режима (split / page / wide). Расхождения с прототипом — только
// там, где прототип был стендом: кнопка режима переключает три состояния
// подряд, а не два (в прототипе «широко» включалось отдельной кнопкой стенда).

import { el, clear } from '../util.js';
import { icon } from './icons.js';
import { renderCanvas } from './canvas.js';
import { markdown, closeCourse, courseModeOpen } from './course.js';
import { renderBlocks, inline } from '../reference/blocks.js';
import { createSearch, SHELF_OF_KIND } from '../reference/search.js';
import { NOTATION } from '../model/notation.js';
import * as data from '../reference/data.js';
import { store, set, commit, undo } from '../state/store.js';
import { currentDiagram, placeElement, createRelationship, createLink } from '../model/model.js';
import { ScToast } from '../../ui-kit/js/toast.js';
import { track } from '../telemetry.js';
// Реестр констрейнтов рисует свой модуль: данные и разметка таблицы живут в
// одном месте (src/ui/standard.js), а полка «Стандарт» даёт им место и переход
// в пункт. Обратного импорта нет — standard.js о читалке не знает.
import { renderStandardInto } from './standard.js';

// Названия и вторая строка полки. Раньше «Правила» и «Стандарт» стояли рядом
// и назывались похоже — вопрос владельца «как отличить, кто за что отвечает»
// решается самими словами: «движок» — это то, что исполняется, «реестр» — то,
// что записано в стандарте. Подсказка теперь ВИДИМАЯ строка под названием
// (`.shelf-hint`), а не только title: в title она остаётся для наведения.
//
// Числа здесь не стоят: их подставляет `shelvesNow()` из загруженных данных.
// «23 ограничения» пережили сорок правил (docs/research/VALIDATOR-PLAN.md §3.4) именно
// потому, что были вписаны руками; строки ниже — запасной вариант без чисел,
// если данные ещё не приехали или не загрузились.
export const SHELVES = [
  { id: 'notation', title: 'Нотация', hint: 'Фигуры и связи UML: что рисует и чем отличается от соседа' },
  { id: 'rules', title: 'Правила движка', hint: 'Констрейнты стандарта и советы практики: здесь — почему проверка ругается' },
  { id: 'standard', title: 'Реестр констрейнтов', hint: 'Требования стандарта со статусами: что проверяем, что нет и почему' },
  { id: 'spec', title: 'Спецификация', hint: 'Текст стандарта по пунктам — первоисточник, а не объяснение' },
  { id: 'tutorial', title: 'Пособие', hint: 'Упражнения: что построить. Проходить — кнопкой «Курс»' },
  { id: 'stereotypes', title: 'Стереотипы', hint: 'Стереотипы профиля: что применимо к какому виду' },
  { id: 'plantuml', title: 'PlantUML', hint: 'Конструкции языка: как то же самое записать текстом' },
];

const SHELF_TITLE = Object.fromEntries(SHELVES.map((s) => [s.id, s.title]));

// Порядок — по вопросу, а не по алфавиту: три группы, и подпись группы
// объясняет, зачем сюда идут. Это же порядок рисует `navModel`.
const SHELF_GROUPS = [
  { title: 'Объяснения', shelves: ['notation', 'tutorial', 'rules'] },
  { title: 'Стандарт', shelves: ['standard', 'spec'] },
  { title: 'Данные профиля', shelves: ['stereotypes', 'plantuml'] },
];
const PAGE = 40;                       // строк выдачи за раз
const HISTORY_MAX = 50;

// Язык текста стандарта. Ключ свой: выбор рисунков курса (course.fig) и тема
// (brand) живут под другими ключами и не должны сбиваться переводом.
const LANG_KEY = 'ref.lang';

function readLang() {
  try { return localStorage.getItem(LANG_KEY) === 'ru' ? 'ru' : 'en'; } catch { return 'en'; }
}
function saveLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* окно без хранилища */ }
}

const st = {
  open: false,
  ready: false,
  mode: 'split',                       // split | page | wide
  view: 'article',                     // article | tree | search
  current: { shelf: 'spec', id: 'about' },
  history: [],
  expanded: new Set(),
  sections: new Map(),                 // file → {articles, tree, section}
  data: null,                          // specIndex, links, rules, course, stereotypes, plantuml
  cards: null,
  search: null,                        // движок и индекс (оригинал)
  searchRu: null,                      // движок и индекс перевода
  lang: readLang(),                    // en | ru — только для полки «Спецификация»
  query: '',
  results: [],
  shown: PAGE,
  seq: 0,                              // защита от гонки асинхронных открытий
};

let dom = null;

/* ------------------------------------------------------------------ утиль */

const keyOf = ({ shelf, id }) => `${shelf}:${id}`;

/**
 * Действующий индекс стандарта. У оригинала и перевода он одной формы и с
 * одними и теми же id статей, поэтому язык — это выбор индекса, а не второй
 * набор навигации: крошки, пейджер и оглавление работают одинаково.
 */
const specNow = () => (st.lang === 'ru' && st.data?.specRu ? st.data.specRu : st.data?.spec);
const specEn = () => st.data?.spec;

const sectionIn = (index, n) => {
  const head = String(n).startsWith('Annex') ? String(n) : String(n).split('.')[0];
  return index?.sections.find((s) => s.number === head) ?? null;
};
const sectionOfNumber = (n) => sectionIn(specNow(), n);
const clauseByNumber = (n) => specNow()?.clauses.find((c) => c.n === n) ?? null;
const clauseById = (id) => specNow()?.clauses.find((c) => c.i === id) ?? null;
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};

async function sectionData(file) {
  if (st.sections.has(file)) return st.sections.get(file);
  const payload = await data.section(file);
  st.sections.set(file, payload);
  return payload;
}

/* ------------------------------------------------------------- загрузка */

async function ensure() {
  if (st.ready) return;
  const [spec, links, rules, practice, course, stereotypes, plantuml, specRu, gloss, coverage] = await Promise.all([
    data.specIndex(), data.links(), data.rules(), data.practiceRules(), data.courseIndex(),
    data.stereotypes(), data.plantuml(),
    // Перевода может не быть — это не ошибка загрузки, а его отсутствие:
    // оригинал обязан открываться и без него.
    data.optional(data.specRuIndex), data.optional(data.glossary),
    // Реестр 449 констрейнтов нужен только полке «Стандарт», но грузится
    // здесь: подсказка полки и счётчик в дереве называют его числа, а врать
    // в подсказке нельзя (грабли №10). Не загрузился — полка скажет об этом,
    // остальные полки работают.
    data.optional(data.coverage),
  ]);
  st.data = { spec, links, rules, practice, course, stereotypes, plantuml, specRu, gloss, coverage };
  st.ready = true;
  dom.ref.dataset.ready = '1';
}

/**
 * Все правила полки: стандарт и практика вместе, в порядке файлов. Слой
 * практики читается отдельным файлом и не имеет `source` — поэтому смешивать
 * их можно только там, где слой важен для подписи (дерево, указатель,
 * переходы по «следующему»), а не для текста статьи.
 */
const allRules = () => [...(st.data?.rules ?? []), ...(st.data?.practice ?? [])];

/**
 * Полки с числами из загруженного набора: вторая строка не имеет права
 * утверждать «23 ограничения», когда в наборе 58 констрейнтов и 13 советов.
 * Счётчики берутся там же, где их читают статьи: правила — из `st.data.rules`,
 * реестр — из `coverage.totals`, пособие — из `course.chapters`, нотация — из
 * `NOTATION` (её загружает приложение до открытия читалки).
 */
function shelvesNow() {
  const d = st.data;
  if (!d) return SHELVES;
  const practice = d.practice ?? [];
  const cov = d.coverage?.totals;
  const shapes = Object.keys(NOTATION.shapes ?? {}).length;
  const conns = Object.keys(NOTATION.connectors ?? {}).length;
  const exercises = d.course.chapters.reduce((n, c) => n + c.exercises.length, 0);
  return SHELVES.map((s) => {
    if (s.id === 'notation' && shapes && conns) {
      return { ...s, hint: `${plural(shapes, 'фигура', 'фигуры', 'фигур')} и `
        + `${plural(conns, 'связь', 'связи', 'связей')}: что рисует и чем отличается от соседа` };
    }
    if (s.id === 'rules') {
      const total = d.rules.length + practice.length;
      return { ...s, hint: `${plural(total, 'правило', 'правила', 'правил')}: `
        + `${d.rules.length} из стандарта, ${plural(practice.length, 'совет', 'совета', 'советов')}. `
        + 'Здесь — почему проверка ругается' };
    }
    // Различие двух полок — в подсказке, а не только в статье: человек
    // наводит на «Реестр констрейнтов» и должен сразу понять, что это реестр
    // ВСЕГО стандарта, а не список того, что движок проверяет.
    if (s.id === 'standard' && cov) {
      return { ...s, hint: `${plural(cov.constraints, 'требование', 'требования', 'требований')} `
        + 'стандарта: что проверяем, что нет и почему' };
    }
    if (s.id === 'tutorial' && exercises) {
      return { ...s, hint: `${plural(exercises, 'упражнение', 'упражнения', 'упражнений')}: `
        + 'что построить. Проходить — кнопкой «Курс»' };
    }
    if (s.id === 'stereotypes' && d.stereotypes?.count) {
      return { ...s, hint: `${plural(d.stereotypes.count, 'стереотип', 'стереотипа', 'стереотипов')} `
        + 'профиля' };
    }
    if (s.id === 'plantuml' && d.plantuml?.count) {
      return { ...s, hint: `${plural(d.plantuml.count, 'конструкция', 'конструкции', 'конструкций')}: `
        + 'как то же самое записать текстом' };
    }
    return s;
  });
}

async function ensureCards() {
  if (st.data?.cards) return st.data.cards;
  const payload = await data.cards();
  st.data.cards = payload;
  return payload;
}

async function ensureSearch() {
  if (st.search) return st.search;
  const index = await data.searchIndex();
  st.search = createSearch(index);
  st.index = index;
  // Индекс перевода — тот же движок (createSearch), другой корпус: постинги
  // не дублируются кодом, они просто строятся по русскому тексту.
  const ruIndex = await data.optional(data.searchRu);
  st.searchRu = ruIndex ? createSearch(ruIndex) : null;
  return st.search;
}

/* ------------------------------------------------------- навигация: полки */

/**
 * Строка дерева: {id, label, count, children, kind} — без состояния DOM.
 *
 * Полки идут ГРУППАМИ по вопросу, а не по алфавиту: группа начинается
 * элементом {kind:'caption', title} — это подпись, а не полка, и кликаться она
 * не должна. Порядок и подписи — docs/research/REFERENCE-SCOPE.md §5.1; названия полок
 * берутся из SHELVES, чтобы переименование не разъехалось с навигацией.
 */
function navModel() {
  const d = st.data;
  const byId = {};

  // Нотация: две группы карточек. Числа — из загруженной нотации, а не из
  // разметки: «78 = 51 + 27» сегодня верно, но это производное.
  const shapes = notationRows('shape');
  const conns = notationRows('connector');
  byId.notation = {
    id: 'notation',
    title: SHELF_TITLE.notation,
    count: shapes.length + conns.length,
    rows: [
      { id: 'n:shapes', label: 'Фигуры', count: shapes.length, children: shapes },
      { id: 'n:conns', label: 'Связи', count: conns.length, children: conns },
    ],
  };

  // Пособие: главы и упражнения.
  byId.tutorial = {
    id: 'tutorial',
    title: SHELF_TITLE.tutorial,
    count: d.course.chapters.reduce((n, c) => n + c.exercises.length, 0),
    rows: d.course.chapters.map((c) => ({
      id: `tut:${c.id}`,
      label: `${c.number} ${c.title}`,
      count: c.exercises.length,
      children: c.exercises.map((e) => ({ id: `tutorial:${e.id}`, label: `Упражнение ${e.number}`, count: null })),
    })),
  };

  // Правила: по уровню, и отдельной группой — слой практики. Смешивать его с
  // констрейнтами нельзя: у совета нет пункта, и в общем списке «ошибки» он
  // читался бы как требование стандарта.
  const byLevel = (lv) => d.rules.filter((r) => r.level === lv);
  const practice = d.practice ?? [];
  byId.rules = {
    id: 'rules',
    title: SHELF_TITLE.rules,
    count: d.rules.length + practice.length,
    rows: [
      {
        id: 'r:error', label: 'Ошибки', count: byLevel('error').length,
        children: byLevel('error').map((r) => ({ id: `rules:${r.id}`, label: r.id, count: null })),
      },
      {
        id: 'r:warn', label: 'Предупреждения', count: byLevel('warning').length,
        children: byLevel('warning').map((r) => ({ id: `rules:${r.id}`, label: r.id, count: null })),
      },
      ...(practice.length ? [{
        id: 'r:practice', label: 'Практика', count: practice.length,
        children: practice.map((r) => ({ id: `rules:${r.id}`, label: r.id, count: null })),
      }] : []),
    ],
  };

  // Реестр констрейнтов: одна статья-таблица. Строк в дереве нет — 449 строк
  // живут в статье с фильтром, а не в навигации: дерево про «куда пойти»,
  // фильтр про «что найти».
  const cov = d.coverage?.totals;
  byId.standard = {
    id: 'standard',
    title: SHELF_TITLE.standard,
    count: cov?.constraints ?? 0,
    rows: [],
  };

  // Спецификация: разделы; дети — пункты второго уровня. Заголовки берутся
  // у действующего языка: дерево слева на русском так же на русском, а номера
  // и id — те же, поэтому переходы не меняются.
  const spec = specNow() ?? d.spec;
  byId.spec = {
    id: 'spec',
    title: SHELF_TITLE.spec,
    count: spec.clauses.length,
    rows: [
      ...spec.sections.map((s) => ({
        id: `spec:${s.id}`,
        label: `${s.number} ${s.title}`,
        count: s.nodes,
        children: spec.clauses
          .filter((c) => c.s === s.number && c.l === 2)
          .map((c) => ({ id: `spec:${c.i}`, label: `${c.n} ${c.t}`, count: null })),
      })),
      // Словарь — такой же пункт полки, как раздел стандарта: на него ведут
      // и дерево, и корень полки.
      ...(d.gloss?.terms?.length
        ? [{ id: 'spec:glossary', label: 'Словарь терминов', count: d.gloss.terms.length }]
        : []),
    ],
  };

  // Стереотипы: прикладные и проектные.
  const groups = [
    { key: 'ApplicationStereotypes', label: 'Прикладные' },
    { key: 'ProjectStereotypes', label: 'Проектные' },
  ];
  byId.stereotypes = {
    id: 'stereotypes',
    title: SHELF_TITLE.stereotypes,
    count: d.stereotypes.count,
    rows: groups.map((g) => {
      const list = d.stereotypes.stereotypes.filter((s) => s.group === g.key);
      return {
        id: `s:${g.key}`, label: g.label, count: list.length,
        children: list.map((s) => ({ id: `stereotypes:${s.name}`, label: s.name, count: null })),
      };
    }),
  };

  // PlantUML: по видам диаграмм.
  byId.plantuml = {
    id: 'plantuml',
    title: SHELF_TITLE.plantuml,
    count: d.plantuml.count,
    rows: d.plantuml.diagrams.map((dg) => ({
      id: `p:${dg.id}`, label: dg.id, count: dg.count,
      children: d.plantuml.constructs
        .filter((c) => c.diagram === dg.id)
        .map((c) => ({ id: `plantuml:${c.id}`, label: c.id, count: null })),
    })),
  };

  // Сборка в порядке групп. Полка, которой почему-то нет в данных, просто не
  // попадает в навигацию — но подпись группы остаётся: пустая группа хуже
  // пропавшей строки, потому что читается как поломка.
  const out = [];
  for (const g of SHELF_GROUPS) {
    out.push({ kind: 'caption', title: g.title });
    for (const id of g.shelves) if (byId[id]) out.push(byId[id]);
  }
  return out;
}

function notationRows(kind) {
  // Ключи берутся из нотации приложения: она уже загружена к моменту открытия.
  const src = kind === 'shape' ? NOTATION.shapes : NOTATION.connectors;
  const keys = Object.keys(src ?? {});
  return keys.map((k) => ({
    id: `notation:${kind}:${k}`,
    label: src[k].label ?? k,
    count: null,
  }));
}

/* ------------------------------------------------------------- отрисовка */

function renderBar() {
  clear(dom.crumbs);
  const { shelf, id } = st.current;
  const crum = (label, run) => el('button', { type: 'button', onclick: run }, label);
  dom.crumbs.append(crum(SHELF_TITLE[shelf] ?? shelf, () => openArticle(`${shelf}:`)));

  if (shelf === 'spec' && id === 'glossary') {
    dom.crumbs.append(el('span', { class: 'sep', text: '›' }));
    dom.crumbs.append(el('span', { class: 'cur', text: 'Словарь терминов' }));
  } else if (shelf === 'spec' && id !== 'about') {
    const node = clauseById(id);
    if (node) {
      const sec = sectionOfNumber(node.n);
      if (sec) {
        dom.crumbs.append(el('span', { class: 'sep', text: '›' }));
        dom.crumbs.append(crum(`${sec.number} ${sec.title}`, () => openArticle(`spec:${sec.id}`)));
      }
      // ancestors() отдаёт и корень раздела — он уже стоит предыдущей крошкой.
      for (const anc of ancestors(node)) {
        if (anc.l <= 1) continue;
        dom.crumbs.append(el('span', { class: 'sep', text: '›' }));
        dom.crumbs.append(crum(`${anc.n} ${anc.t}`, () => openArticle(`spec:${anc.i}`)));
      }
      dom.crumbs.append(el('span', { class: 'sep', text: '›' }));
      dom.crumbs.append(el('span', { class: 'cur', text: `${node.n} ${node.t}` }));
    }
  } else if (shelf === 'notation' && id) {
    dom.crumbs.append(el('span', { class: 'sep', text: '›' }));
    dom.crumbs.append(el('span', { class: 'cur', text: st.data.cards?.cards?.[id]?.title ?? id }));
  } else if (id) {
    dom.crumbs.append(el('span', { class: 'sep', text: '›' }));
    dom.crumbs.append(el('span', { class: 'cur', text: labelOf(shelf, id) }));
  }

  dom.mode.title = `Режим: ${modeLabel(st.mode)} — нажмите, чтобы сменить`;
  dom.mode.setAttribute('aria-label', `Режим раскладки: ${modeLabel(st.mode)}`);
  dom.prev.disabled = !neighbour(-1);
  dom.next.disabled = !neighbour(1);
  dom.tree.classList.toggle('on', st.view === 'tree');
}

function modeLabel(m) {
  return m === 'split' ? 'рядом с листом' : m === 'page' ? 'страница' : 'широко';
}

function labelOf(shelf, id) {
  const d = st.data;
  if (!d) return id;
  if (shelf === 'rules') return allRules().find((r) => r.id === id)?.id ?? id;
  if (shelf === 'tutorial') {
    for (const c of d.course.chapters) {
      const ex = c.exercises.find((e) => e.id === id);
      if (ex) return `Упражнение ${ex.number}`;
    }
  }
  if (shelf === 'stereotypes') return id;
  if (shelf === 'plantuml') return d.plantuml.constructs.find((c) => c.id === id)?.id ?? id;
  return id;
}

/** Прямые дети узла в дереве стандарта (пункты на уровень ниже). */
function childrenOf(node) {
  const all = (specNow()?.clauses ?? []).filter((c) => c.s === node.s);
  const at = all.findIndex((c) => c.i === node.i);
  const out = [];
  for (let i = at + 1; i < all.length; i += 1) {
    const c = all[i];
    if (c.l <= node.l) break;
    if (c.l === node.l + 1) out.push(c);
  }
  return out;
}

/** Предки узла в дереве стандарта — от старшего к младшему. */
function ancestors(node) {
  const list = [];
  const all = (specNow()?.clauses ?? []).filter((c) => c.s === node.s);
  let i = all.findIndex((c) => c.i === node.i);
  let level = node.l;
  while (i > 0 && level > 1) {
    let j = i - 1;
    while (j >= 0 && all[j].l >= level) j -= 1;
    if (j < 0) break;
    list.unshift(all[j]);
    level = all[j].l;
    i = j;
  }
  return list;
}

function renderNav() {
  if (!st.data) return;
  clear(dom.nav);
  const depthLimit = st.view === 'tree' && st.mode !== 'wide' ? 2 : 4;
  const hints = Object.fromEntries(shelvesNow().map((s) => [s.id, s.hint]));
  for (const item of navModel()) {
    // Подпись группы — не полка: она не кликается и не раскрывается. Отдельный
    // элемент, а не заголовок над списком, потому что навигация плоская и
    // группы перемежаются полками.
    if (item.kind === 'caption') {
      dom.nav.append(el('div', { class: 'shelf-caption', text: item.title }));
      continue;
    }
    const hint = hints[item.id] ?? 'Открыть полку';
    // Подсказка полки — из данных: у «Правил движка» число правил берётся у
    // загруженного набора, а не пишется в разметке (оно уже врало: «23»).
    // Вторая строка видима (не только title): различие «движок/реестр» должно
    // читаться без наведения.
    const head = el('div', { class: 'shelf', title: hint });
    const line = el('div', { class: 'shelf-line' });
    line.append(el('button', {
      class: 'shelf-btn', type: 'button', onclick: () => openArticle(`${item.id}:`),
    }, item.title));
    line.append(el('span', { class: 'n', text: String(item.count) }));
    head.append(line, el('div', { class: 'shelf-hint', text: hint }));
    dom.nav.append(head);

    const open = st.expanded.has(`g:${item.id}`) || item.id === st.current.shelf;
    for (const row of open ? item.rows : []) {
      dom.nav.append(nodeRow(row, item.id, 1, depthLimit));
    }
  }
}

function nodeRow(row, shelf, depth, depthLimit) {
  const wrap = document.createDocumentFragment();
  const isCurrent = st.current.shelf === shelf && row.id === keyOf(st.current);
  const hasKids = !!row.children?.length;
  const btn = el('button', {
    class: `node depth${Math.min(3, depth)}${hasKids ? '' : ' leaf'}${isCurrent ? ' current' : ''}`,
    type: 'button',
    title: row.label,
    onclick: () => {
      if (row.id.includes(':') && !row.id.startsWith('g:')) openArticle(row.id);
      else openShelf(row.id);
      if (hasKids) {
        if (st.expanded.has(row.id)) st.expanded.delete(row.id);
        else st.expanded.add(row.id);
        renderNav();
      }
    },
  });
  const caret = el('span', { class: 'caret' });
  if (hasKids) caret.append(icon('ui-chevron-down', 12));
  btn.append(caret);
  btn.append(el('span', { class: 'nm', text: row.label }));
  if (row.count != null) btn.append(el('span', { class: 'cnt', text: String(row.count) }));
  wrap.append(btn);

  const expanded = st.expanded.has(row.id);
  if (hasKids && expanded && depth < depthLimit) {
    for (const kid of row.children) wrap.append(nodeRow(kid, shelf, depth + 1, depthLimit));
  }
  return wrap;
}

function openShelf(id) {
  const shelf = SHELVES.find((s) => s.id === id);
  if (!shelf) return;
  st.expanded.add(`g:${id}`);
  openArticle(`${id}:`);
}

/* --------------------------------------------------------------- статья */

async function renderArticle() {
  const seq = ++st.seq;
  clear(dom.doc);
  dom.doc.dataset.shelf = st.current.shelf;
  dom.doc.dataset.article = st.current.id;
  try {
    await ensure();
    if (seq !== st.seq) return;
    // Пустой id — это «полка целиком»: указатель, а не статья с пустым id.
    if (!st.current.id) await renderShelfIndex();
    // У полки «Стандарт» ровно одна статья: любой id — это она же. Пустой id
    // уже отдан renderShelfIndex, а лишний («standard:foo») не должен давать
    // пустую страницу.
    else if (st.current.shelf === 'standard') articleStandard();
    else if (st.current.shelf === 'spec') await articleSpec();
    else if (st.current.shelf === 'notation') await articleCard();
    else if (st.current.shelf === 'rules') await articleRule();
    else if (st.current.shelf === 'tutorial') await articleTutorial();
    else if (st.current.shelf === 'stereotypes') await articleStereotype();
    else if (st.current.shelf === 'plantuml') await articlePlantuml();
  } catch (e) {
    clear(dom.doc);
    dom.doc.append(el('div', { class: 'empty', text: `Статья не открылась: ${e.message}` }));
  }
  if (seq !== st.seq) return;
  renderBar();
  renderToc();
  dom.scroll.scrollTop = 0;
}

/** Ссылка на документ OMG — в шапке каждой статьи стандарта. */
function omgLink() {
  const row = dom.doc.querySelector('.doc-meta');
  if (!row) return;
  row.append(el('span', { text: '·' }));
  row.append(el('a', {
    class: 'attrib-link', href: 'https://www.omg.org/spec/UML/2.5.1/',
    target: '_blank', rel: 'noopener', title: 'OMG UML 2.5.1 (formal/2017-12-05)',
  }, 'OMG'));
}

/**
 * Шапка статьи: номер, заголовок и строка мета.
 *
 * `meta` — строки ИЛИ готовые узлы: с A4 в шапке правила стоит чип «в реестре:
 * проверяется», а он кликается, значит строкой быть не может. Разделитель
 * «·» ставится только между непустыми частями — иначе пустая строка давала бы
 * двойной разделитель.
 */
function head(num, title, meta) {
  dom.doc.append(el('div', { class: 'doc-num', text: num }));
  dom.doc.append(el('h2', { class: 'doc-title', text: title }));
  if (meta?.length) {
    const row = el('p', { class: 'doc-meta' });
    let first = true;
    for (const part of meta) {
      if (part == null || part === '') continue;
      if (!first) row.append(el('span', { text: '·' }));
      first = false;
      if (typeof part === 'string') row.append(el('span', { text: part }));
      else row.append(part);
    }
    dom.doc.append(row);
  }
}

/** Список пунктов раздела — оглавление статьи, а не дерева. */
function clauseList(nodes) {
  const ul = el('ul', { class: 'doc-list' });
  for (const n of nodes) {
    ul.append(el('li', {}, el('a', {
      href: `#${n.i}`,
      onclick: (e) => { e.preventDefault(); openArticle(`spec:${n.i}`); },
    }, `${n.n} ${n.t}`)));
  }
  dom.doc.append(ul);
}

function attribution() {
  const box = el('div', { class: 'attrib' });
  box.append(el('h3', { text: 'Текст стандарта — не наш' }));
  box.append(el('p', {}, 'UML® 2.5.1 — документ Object Management Group: ',
    el('b', { text: 'formal/2017-12-05' }),
    ', декабрь 2017. Здесь он приведён целиком, потому что инструмент личный; ',
    'номера пунктов, заголовки, имена констрейнтов и OCL — дословно.'));
  box.append(el('p', {}, 'Полный текст и права принадлежат OMG и держателям авторских прав, ',
    'перечисленным в уведомлении. Английский текст не изменялся.'));
  // Одна строка про перевод — и только здесь: дальше о нём напоминает метка в
  // шапке статьи, а не баннер.
  box.append(el('p', {}, 'Полный текст ниже — официальный английский (',
    el('b', { text: 'formal/2017-12-05' }),
    '). Русский перевод — ', el('b', { text: 'неофициальный' }),
    ', сделан для личного пользования, OMG его не заверял.'));
  box.append(el('p', {}, el('a', {
    class: 'attrib-link',
    href: data.noticeHref,
    target: '_blank',
    rel: 'noopener',
  }, 'Уведомление OMG и условия использования — reference/NOTICE.md')));
  box.append(el('p', { class: 'fine' }, el('a', {
    class: 'attrib-link', href: 'https://www.omg.org/spec/UML/2.5.1/', target: '_blank', rel: 'noopener',
  }, 'omg.org/spec/UML/2.5.1')));
  return box;
}

/**
 * Указатель полки: что на ней лежит, плотным списком.
 *
 * Клик по названию полки в дереве приходит сюда как `openArticle('rules:')` —
 * с ПУСТЫМ id. Раньше пустой id уходил в статью, статьи с пустым id, конечно,
 * не было, и человек читал «Правило не найдено». Пустой id означает «полка
 * целиком», а не битую ссылку; битый id (правило удалили, ссылка осталась)
 * по-прежнему даёт внятное «не найдено» внутри своей статьи.
 */
function indexList(rows) {
  const ul = el('ul', { class: 'doc-list' });
  for (const r of rows) {
    const li = el('li');
    li.append(el('a', {
      href: '#', onclick: (e) => { e.preventDefault(); r.run(); },
    }, r.label));
    if (r.note) li.append(el('span', { class: 'fine', text: ` · ${r.note}` }));
    ul.append(li);
  }
  return ul;
}

async function renderShelfIndex() {
  const shelf = st.current.shelf;
  const d = st.data;

  if (shelf === 'standard') {
    articleStandard();
    return;
  }

  if (shelf === 'spec') {
    // У полки стандарта указатель уже есть — её «Разделы».
    await articleSpec();
    return;
  }

  if (shelf === 'notation') {
    const rows = (src) => Object.entries(src ?? {}).map(([k, v]) => ({
      label: v.label ?? k,
      run: () => openArticle(`notation:${src === NOTATION.shapes ? 'shape' : 'connector'}:${k}`),
    }));
    const shapes = rows(NOTATION.shapes);
    const conns = rows(NOTATION.connectors);
    head('полка', 'Нотация', [plural(shapes.length, 'фигура', 'фигуры', 'фигур'), plural(conns.length, 'связь', 'связи', 'связей')]);
    dom.doc.append(el('p', { class: 'lead' },
      'Карточки нотации: что рисует фигура, чем отличается от соседней и в каких диаграммах работает. '
      + 'Клик по названию открывает карточку.'));
    dom.doc.append(el('h3', { text: `Фигуры · ${shapes.length}` }), indexList(shapes));
    dom.doc.append(el('h3', { text: `Связи · ${conns.length}` }), indexList(conns));
    return;
  }

  if (shelf === 'rules') {
    const byLevel = (lv) => d.rules.filter((r) => r.level === lv);
    const errors = byLevel('error');
    const warns = byLevel('warning');
    const practice = d.practice ?? [];
    head('полка', SHELF_TITLE.rules, [plural(d.rules.length, 'констрейнт', 'констрейнта', 'констрейнтов'),
      `${errors.length} ошибок · ${warns.length} предупреждений · ${practice.length} советов практики`]);
    dom.doc.append(el('p', { class: 'lead' },
      'Констрейнты UML 2.5.1, которые проверяет движок. У каждого правила — id, сообщение и '
      + 'пункт стандарта, из которого оно взято.'));
    const rows = (list) => list.map((r) => ({
      label: r.id,
      note: r.message || r.check || '',
      run: () => openArticle(`rules:${r.id}`),
    }));
    dom.doc.append(el('h3', { text: `Ошибки · ${errors.length}` }), indexList(rows(errors)));
    dom.doc.append(el('h3', { text: `Предупреждения · ${warns.length}` }), indexList(rows(warns)));
    // Практика — отдельной группой и с оговоркой: это не требования
    // стандарта, у них нет пункта, и путать слои нельзя (правило `basis`).
    if (practice.length) {
      dom.doc.append(el('h3', { text: `Практика · ${practice.length}` }),
        el('p', { class: 'fine', text: 'Советы по практике моделирования: не требования стандарта UML 2.5.1. '
          + 'Такую модель можно сохранить, но читать её труднее.' }),
        indexList(rows(practice)));
    }
    return;
  }

  if (shelf === 'stereotypes') {
    const all = d.stereotypes.stereotypes;
    const groups = new Map();
    for (const s of all) {
      const key = s.baseType || 'без базового типа';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    head('полка', 'Стереотипы', [plural(all.length, 'стереотип', 'стереотипа', 'стереотипов'),
      `${groups.size} базовых типов`]);
    dom.doc.append(el('p', { class: 'lead' },
      'Профиль по базовым типам: под каждым — имена стереотипов, которые к нему применимы. '
      + 'Клик по имени открывает карточку.'));
    for (const [base, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dom.doc.append(el('h3', { text: `${base} · ${list.length}` }), indexList(list.map((s) => ({
        label: s.name,
        note: s.group === 'ProjectStereotypes' ? 'проектный' : '',
        run: () => openArticle(`stereotypes:${s.name}`),
      }))));
    }
    return;
  }

  if (shelf === 'plantuml') {
    head('полка', 'PlantUML', [plural(d.plantuml.count, 'конструкция', 'конструкции', 'конструкций'),
      plural(d.plantuml.diagrams.length, 'семейство', 'семейства', 'семейств')]);
    dom.doc.append(el('p', { class: 'lead' },
      'Конструкции языка по семействам диаграмм: как то же самое записать текстом, '
      + 'и какой класс PlantUML её рисует.'));
    for (const dg of d.plantuml.diagrams) {
      const list = d.plantuml.constructs.filter((c) => c.diagram === dg.id);
      dom.doc.append(el('h3', { text: `${dg.id} · ${list.length}` }), indexList(list.map((c) => ({
        label: c.id,
        note: c.diagramTitle && c.diagramTitle !== dg.id ? c.diagramTitle : '',
        run: () => openArticle(`plantuml:${c.id}`),
      }))));
    }
    return;
  }

  if (shelf === 'tutorial') {
    const chapters = d.course.chapters;
    head('полка', SHELF_TITLE.tutorial, [plural(chapters.reduce((n, c) => n + c.exercises.length, 0), 'упражнение', 'упражнения', 'упражнений'),
      plural(chapters.length, 'глава', 'главы', 'глав')]);
    dom.doc.append(el('p', { class: 'lead' },
      'Учебник ВМК МГУ: главы и упражнения. Полные уроки с рисунками — во вкладке «Курс» '
      + 'правой панели; здесь — текст упражнения для чтения рядом с листом.'));
    chapters.forEach((ch, ci) => {
      dom.doc.append(el('h3', { text: `${ci + 1}. ${ch.title}` }));
      dom.doc.append(el('div', { class: 'fine', text: `глава ${ch.number} пособия` }));
      dom.doc.append(indexList(ch.exercises.map((e, ei) => ({
        label: `${ci + 1}.${ei + 1}. ${e.title}`,
        note: `в пособии ${e.number}`,
        run: () => openArticle(`tutorial:${e.id}`),
      }))));
    });
    return;
  }

  // Неизвестная полка — это уже настоящая ошибка, не «пустой id».
  dom.doc.append(el('div', { class: 'empty', text: `Полка «${SHELF_TITLE[shelf] ?? shelf}» не найдена.` }));
}

/**
 * Статья полки «Стандарт»: реестр констрейнтов UML 2.5.1 целиком.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ПОЛКА, А НЕ ВКЛАДКА ПРАВОЙ ПАНЕЛИ. Панель говорит о
 * выделенном объекте, а реестр — справочный материал: «что стандарт требует
 * вообще и что из этого проверяется». В панели 255 px таблица из 449 строк
 * тесна, а рядом с листом у неё 420 px и есть куда расти.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ «ПРАВИЛ». На «Правилах» — 58 записанных правил движка (с
 * сообщением, подсказкой и функцией); здесь — все 449 констрейнтов стандарта,
 * включая 283 «вне области», которые проверить нечем по конструкции. Поэтому
 * шапка и подсказка полки называют оба числа: одно без другого врало бы.
 */
function articleStandard() {
  const cov = st.data?.coverage;
  const totals = cov?.totals;
  const rules = st.data?.rules?.length ?? 0;
  // «Чей это текст» — первой строкой мета: реестр стандарта, а не наши
  // правила. Дальше числа из того же файла, что читает таблица.
  head('полка', SHELF_TITLE.standard, [
    'реестр стандарта, не наши правила',
    totals ? plural(totals.constraints, 'констрейнт', 'констрейнта', 'констрейнтов') : 'реестр констрейнтов',
    totals ? `${totals.inScope} в области` : '',
    totals ? `${totals.outOfScope} вне области` : '',
  ]);
  // Различие полок названо здесь словами: это первое, что человек должен
  // понять, иначе он будет искать в реестре замечания к своей модели.
  dom.doc.append(el('p', { class: 'lead' },
    'Реестр констрейнтов UML 2.5.1: у каждого — метакласс, пункт, статус проверяемости '
    + 'и, если правило записано, дословный текст с OCL. Это не список того, что проверяет '
    + `движок: записанных правил ${rules} — они на полке «${SHELF_TITLE.rules}»; здесь весь стандарт, `
    + `включая ${totals?.outOfScope ?? 0} констрейнтов «вне области», которых нет ни одной `
    + 'фигурой или связью нотации.'));
  const box = el('div', { class: 'std-root' });
  dom.doc.append(box);
  if (!cov) {
    box.append(el('div', { class: 'empty', text: 'Реестр констрейнтов не загрузился: файл notation/rules/coverage.json не прочитан.' }));
    return;
  }
  renderStandardInto(box, { data: cov, openClause });
  // Реестр → правило: чип у 58 строк, у которых правило записано. Дописываем
  // после отрисовки — таблицу рисует standard.js, а набор правил знает читалка.
  decorateStandardRows(box);
}

/* ------------------------------------------- правило ↔ реестр (A4: 1 и 2) */

/**
 * Словарь статусов реестра — значения те же, что в coverage.json. Подписи
 * короче, чем в standard.js («тавтология», а не «тавтология схемы»): здесь они
 * стоят в шапке правила, где каждое слово на счету. Статус НЕ выдумывается —
 * он берётся из строки реестра по `метакласс::констрейнт`.
 */
const REG_STATUS = {
  executable: 'проверяется',
  todo: 'готово к написанию',
  tautology: 'тавтология',
  gap: 'нужно поле',
  'no-ocl': 'нет OCL',
  'out-of-scope': 'вне области',
};

/** Ключ строки реестра для правила: `Метакласс::констрейнт`. */
const ruleKey = (rule) => `${rule.source.metaclass}::${rule.source.name
  ?? String(rule.source.constraint ?? '').split('::').pop()}`;

/** Строка реестра, в которую попадает правило, — или null. */
function registryRow(rule) {
  if (!rule.source) return null;
  const key = ruleKey(rule);
  return (st.data?.coverage?.items ?? []).find((i) => `${i.metaclass}::${i.name}` === key) ?? null;
}

/**
 * Чип «в реестре: <статус>» — переход из правила в его строку реестра. Сейчас
 * человек видит пункт, но не видит, что этот констрейнт — одна из строк
 * реестра и что с ним всё в порядке.
 */
function registryChip(rule) {
  const row = registryRow(rule);
  if (!row) return null;
  const key = `${row.metaclass}::${row.name}`;
  return el('button', {
    class: 'chip',
    type: 'button',
    title: `Строка реестра: ${key} · п. ${row.clause}`,
    onclick: () => openStandardRow(key),
  }, `в реестре: ${REG_STATUS[row.status] ?? row.status}`);
}

/**
 * Открыть реестр на строке `метакласс::констрейнт`: строка раскрыта и в поле
 * зрения. Фильтры реестра могли остаться от прошлого взгляда, поэтому сначала
 * сбрасываем их (сброс возвращает статусы по умолчанию, а в них входят все
 * статусы правил), потом ищем строку заново.
 */
async function openStandardRow(key) {
  await openArticle('standard:');
  const find = () => [...dom.doc.querySelectorAll('.std-row')].find((n) => n.dataset.key === key) ?? null;
  let row = find();
  if (!row) return false;
  if (row.hidden) {
    document.getElementById('standard-reset')?.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    row = find();
  }
  if (!row || row.hidden) return false;
  if (row.getAttribute('aria-expanded') !== 'true') row.click();
  row.scrollIntoView({ block: 'center' });
  row.classList.add('hit');
  row.focus?.();
  return true;
}

/**
 * Реестр → правило: у 58 строк реестра есть записанное правило, и чип ведёт в
 * него. Разметку строки рисует standard.js, поэтому чип дописывается здесь:
 * читалка знает набор правил, а реестр — нет (обратного импорта не заводим).
 */
function decorateStandardRows(box) {
  const rules = st.data?.rules ?? [];
  if (!rules.length) return;
  const byKey = new Map(rules.map((r) => [ruleKey(r), r.id]));
  for (const row of box.querySelectorAll('.std-row')) {
    const id = byKey.get(row.dataset.key);
    if (!id) continue;
    const line2 = row.querySelector('.std-line2');
    if (!line2) continue;
    line2.append(el('button', {
      class: 'std-rule chip',
      type: 'button',
      title: `Правило движка «${id}» — открыть статью`,
      onclick: (e) => { e.stopPropagation(); openArticle(`rules:${id}`); },
    }, `правило ${id}`));
  }
}

/* ------------------------------------------------- язык: оригинал / русский */

/*
 * Переключатель — подмена файла по тому же id: у перевода те же id статей, что
 * у оригинала (`spec-tree.json` считает их от английских заголовков), поэтому
 * «Русский» открывает spec-ru/<NN>.json той же статьёй, а не ищет соответствие
 * по тексту. Если статьи в переводе нет — показывается оригинал и одна строка
 * «перевода этого пункта нет».
 */

/**
 * Переключатель языка и метка «неофиц. перевод». Метка стоит только там, где
 * на экране правда русский текст: на откате к оригиналу её нет — иначе она
 * подписывала бы английский абзац.
 */
function langBar({ translated = true } = {}) {
  const num = dom.doc.querySelector('.doc-num');
  if (!num) return;
  const box = el('span', { class: 'cv-figtoggle', role: 'group', 'aria-label': 'Язык текста' });
  const btn = (lang, label, title) => el('button', {
    type: 'button',
    class: `cvt${st.lang === lang ? ' on' : ''}`,
    title,
    'aria-pressed': st.lang === lang ? 'true' : 'false',
    onclick: () => setLang(lang),
  }, label);
  box.append(
    btn('en', 'Оригинал', 'Английский текст стандарта OMG (formal/2017-12-05)'),
    btn('ru', 'Русский', st.data?.specRu ? 'Неофициальный русский перевод' : 'Перевод не входит в эту сборку'),
  );
  num.append(document.createTextNode(' '), box);
  if (st.lang === 'ru' && translated) num.append(el('span', { class: 'fine', text: 'неофиц. перевод' }));
}

/** Сменить язык, оставаясь на той же статье: меняется файл, не место. */
export function setLang(lang) {
  const next = lang === 'ru' ? 'ru' : 'en';
  if (next === st.lang) return;
  st.lang = next;
  saveLang(next);
  renderNav();
  // Статья перерисовывается асинхронно: пейджер дописывается ПОСЛЕ неё, иначе
  // он оказался бы в очищенном документе, то есть в самом начале статьи.
  return renderArticle().then(() => renderPager());
}

/** Статья из файла раздела: сначала на выбранном языке, иначе — оригинал. */
async function articleOfLang(id, number) {
  const sec = sectionOfNumber(number);
  let article = null;
  if (sec?.file) {
    // Битый или недоехавший файл перевода — не повод не показать статью:
    // ниже сработает откат на оригинал.
    const file = await sectionData(sec.file).catch(() => null);
    article = file?.articles.find((a) => a.id === id) ?? null;
  }
  if (article || st.lang !== 'ru') return { article, sec, fellBack: false };
  // Пункта нет в переводе: оригинал остаётся доступным — иначе перевод нечем
  // проверить, а статья стала бы пустой страницей.
  const enSec = sectionIn(specEn(), number);
  if (!enSec?.file) return { article: null, sec, fellBack: false };
  const enFile = await sectionData(enSec.file);
  return {
    article: enFile?.articles.find((a) => a.id === id) ?? null,
    sec: enSec,
    fellBack: true,
  };
}

async function articleSpec() {
  const { id } = st.current;
  const index = specNow() ?? st.data.spec;

  if (id === 'glossary') {
    await articleGlossary();
    return;
  }

  if (id === 'about' || id === '') {
    head('UML 2.5.1', 'Спецификация', [
      // «Чей это текст» — первой строкой: это первоисточник OMG, а не наше
      // объяснение (объяснения — на других полках).
      'первоисточник OMG',
      'Object Management Group',
      `formal/2017-12-05`,
      plural(index.sections.length, 'раздел', 'раздела', 'разделов'),
      plural(index.clauses.length, 'пункт', 'пункта', 'пунктов'),
    ]);
    langBar();
    dom.doc.append(el('p', { class: 'lead' },
      'Полный текст стандарта по разделам. Дерево слева — 25 разделов и пункты '
      + 'второго уровня; внутри статьи работают ссылки на номера пунктов, '
      + '«предыдущий / следующий» и оглавление раздела.'));
    omgLink();
    dom.doc.append(attribution());
    const gloss = st.data?.gloss?.terms?.length ?? 0;
    if (gloss) {
      dom.doc.append(el('p', { class: 'fine' }, el('a', {
        class: 'attrib-link',
        href: '#словарь',
        onclick: (e) => { e.preventDefault(); openArticle('spec:glossary'); },
      }, 'Словарь терминов'), document.createTextNode(` · ${plural(gloss, 'термин', 'термина', 'терминов')}: как понятие называется в оригинале и в переводе`)));
    }
    dom.doc.append(el('h3', { text: 'Разделы' }));
    const ul = el('ul', { class: 'doc-list' });
    for (const s of index.sections) {
      ul.append(el('li', {}, el('a', {
        href: `#${s.id}`,
        onclick: (e) => { e.preventDefault(); openArticle(`spec:${s.id}`); },
      }, `${s.number} ${s.title}`), el('span', { class: 'fine', text: ` · ${plural(s.nodes, 'пункт', 'пункта', 'пунктов')}` })));
    }
    dom.doc.append(ul);
    return;
  }

  const node = clauseById(id);
  if (!node) {
    dom.doc.append(el('div', { class: 'empty', text: 'Пункт не найден в дереве стандарта.' }));
    return;
  }
  const { article, sec, fellBack } = await articleOfLang(id, node.n);
  const stats = article?.stats ?? {};
  const meta = ['первоисточник OMG', 'UML 2.5.1'];
  if (sec) meta.push(`раздел ${sec.number}${sec.pages?.printed ? ` · стр. ${sec.pages.printed}` : ''}`);
  if (stats.constraints) meta.push(plural(stats.constraints, 'констрейнт', 'констрейнта', 'констрейнтов'));
  if (stats.paragraphs) meta.push(plural(stats.paragraphs, 'абзац', 'абзаца', 'абзацев'));
  if (stats.lists) meta.push(plural(stats.lists, 'список', 'списка', 'списков'));
  head(node.n, article?.title ?? node.t, meta);
  langBar({ translated: !fellBack });
  omgLink();
  if (fellBack) {
    dom.doc.append(el('p', { class: 'fine', text: 'Перевода этого пункта нет — показан оригинал.' }));
  }

  const ctx = {
    hasClause: (n) => !!clauseByNumber(n),
    openClause: (n) => {
      const c = clauseByNumber(n);
      if (c) openArticle(`spec:${c.i}`);
    },
    openRule: (id2) => openArticle(`rules:${id2}`),
  };
  if (article?.blocks?.length) renderBlocks(dom.doc, article.blocks, ctx);
  // Первое упоминание термина в русском тексте подписывается английским
  // оригиналом: «ассоциация (Association)» — из словаря, не из догадки.
  if (st.lang === 'ru' && !fellBack) markTerms(dom.doc);

  // Пункты внутри статьи: у раздела их видно всегда, у пункта — когда они
  // есть. Иначе статья раздела была бы пустой страницей с заголовком.
  const kids = childrenOf(node);
  if (kids.length) {
    dom.doc.append(el('h3', { text: 'В этом разделе' }));
    clauseList(kids);
  }
  // Констрейнты метакласса — внутри статьи о нём, как в прототипе: правила
  // лежат в другом пункте (11.8.1.8), и без этого раздела с 11.5.4 на них
  // ничего не ведёт.
  await articleConstraints(node, article);
  related(node);
}

/** Раздел «Правила, которые к этому относятся» — блоки kv из Constraints. */
async function articleConstraints(node, article) {
  const con = node.c;
  if (!con || con.i === node.id) return;
  const sec = sectionOfNumber(con.n);
  if (!sec?.file) return;
  const file = await sectionData(sec.file).catch(() => null);
  const blocks = (file?.articles.find((a) => a.id === con.i)?.blocks ?? []).filter((b) => b.t === 'kv');
  if (!blocks.length) return;
  if (article?.blocks?.some((b) => b.t === 'kv')) return;   // это и есть статья констрейнтов

  const checked = blocks.filter((b) => b.rule).length;
  const total = blocks.length;
  dom.doc.append(el('h3', { id: 'h-constraints', text: 'Правила, которые к этому относятся' }));
  const lead = el('p', { class: 'lead' });
  lead.append(document.createTextNode(`${plural(total, 'констрейнт', 'констрейнта', 'констрейнтов')} раздела ${con.n}. `));
  lead.append(document.createTextNode(checked === total
    ? (total === 1 ? 'Его проверяет наш движок.' : 'Все проверяются нашим движком.')
    : checked === 0
      ? 'Ни один не проверяется движком: в модели uml-model/3 нет полей, на которых они выражаются.'
      : `Движок проверяет ${checked} из ${total}; у остальных в uml-model/3 нет поля, на котором они выражаются.`));
  lead.append(document.createTextNode(' У каждого правила ниже — чип: чем именно оно проверяется.'));
  dom.doc.append(lead);
  renderBlocks(dom.doc, blocks, {
    openRule: (id) => openArticle(`rules:${id}`),
    hasClause: () => false,
  });
  // Пункт → реестр: строка «все N констрейнтов — в реестре» ведёт на полку.
  // Без неё из статьи видно только «движок проверяет 2 из 5», и человек не
  // понимает, что остальные строки стандарта где-то есть.
  const cov = st.data?.coverage?.totals;
  if (cov) {
    const line = el('p', { class: 'fine' });
    line.append(el('a', {
      class: 'attrib-link',
      href: '#реестр',
      onclick: (e) => { e.preventDefault(); openArticle('standard:'); },
    }, `все ${plural(cov.constraints, 'констрейнт', 'констрейнта', 'констрейнтов')} — в реестре`));
    line.append(document.createTextNode(': что проверяем, что нет и почему.'));
    dom.doc.append(line);
  }
}

/** Номера пунктов, от которых статья наследует связи: своя, потом предки. */
function relatedChain(node) {
  const out = [node.n];
  if (node.c?.n && node.c.n !== node.n) out.push(node.c.n);
  for (const anc of [...ancestors(node)].reverse()) out.push(anc.n);
  return out;
}

/**
 * «Связано» — из графа links.json, а не из прозы статьи.
 *
 * Четыре группы: нотация, правила, пособие, PlantUML. Связи ищутся по номеру
 * своей статьи, а если там пусто — по ближайшему предку: на 11.5.4 их не
 * может быть в принципе, они принадлежат 11.5, и читалка показывает их оттуда
 * (в подсказке чипа сказано, из какого пункта связь).
 */
function related(node) {
  const l = st.data.links;
  const chain = relatedChain(node);
  const first = (pool) => {
    for (const num of chain) {
      const hits = pool.filter((e) => e.clause?.number === num);
      if (hits.length) return { from: num, hits };
    }
    return null;
  };
  const inherit = (num) => (num === node.n ? undefined : `Из пункта ${num}`);

  const groups = [];

  const notation = first(l.notation, 'clause');
  if (notation) {
    groups.push({ title: 'Нотация', items: notation.hits.map((n) => ({
      label: n.label,
      title: inherit(notation.from),
      guess: n.confidence === 'guess',
      run: () => openArticle(`notation:${n.kind}:${n.id}`),
    })) });
  }

  const rules = first(l.rules ?? [], 'clause');
  if (rules) {
    groups.push({ title: 'Правила', items: rules.hits.map((r) => ({
      label: r.id,
      title: inherit(rules.from),
      guess: r.confidence === 'guess',
      run: () => openArticle(`rules:${r.id}`),
    })) });
  }

  const tutorial = first(l.tutorial ?? []);
  if (tutorial) {
    groups.push({ title: 'Пособие', items: tutorial.hits.map((t) => (
      t.kind === 'exercise'
        ? {
          label: t.label,
          title: [inherit(tutorial.from), ...(t.basis ?? [])].filter(Boolean).join(' · '),
          guess: t.confidence === 'guess',
          run: () => {
            const ex = findExercise(t.id);
            if (ex) openArticle(`tutorial:${ex.id}`);
          },
        }
        : {
          // У рисунка своей статьи нет: чип только называет его и объясняет,
          // откуда связь, — поэтому span, а не кнопка-обманка.
          label: t.label,
          title: [inherit(tutorial.from), ...(t.basis ?? [])].filter(Boolean).join(' · '),
          guess: t.confidence === 'guess',
          plain: true,
        }
    )) });
  }

  const plantuml = first(l.plantuml ?? [], 'clause');
  if (plantuml) {
    groups.push({ title: 'PlantUML', items: plantuml.hits.map((p) => ({
      label: p.label,
      title: [inherit(plantuml.from), ...(p.basis ?? [])].filter(Boolean).join(' · '),
      guess: p.confidence === 'guess',
      run: () => openArticle(`plantuml:${p.construct}`),
    })) });
  }

  if (!groups.length) return;
  const box = el('div', { class: 'rel' });
  box.append(el('h4', { text: 'Связано' }));
  for (const g of groups) {
    // Длинную группу режем: двадцать чипов подряд — уже не «связано», а свалка.
    const MAX = 8;
    const shown = g.items.slice(0, MAX);
    const hidden = g.items.slice(MAX);
    const line = chips(shown);
    if (hidden.length) {
      line.append(el('span', {
        class: 'chip plain',
        title: hidden.map((it) => it.label).join(', '),
        text: `ещё ${hidden.length}`,
      }));
    }
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: g.title }), line));
  }
  dom.doc.append(box);
}

/** Упражнение по номеру из пособия (для перехода с пункта стандарта). */
function findExercise(number) {
  for (const c of st.data.course.chapters) {
    const ex = c.exercises.find((e) => e.number === number);
    if (ex) return ex;
  }
  return null;
}

function chips(items) {
  const box = el('div', { class: 'chips' });
  for (const it of items) {
    const plain = it.guess || it.plain;
    const title = it.guess
      ? ['Связь-догадка: прямого подтверждения в стандарте нет', it.title].filter(Boolean).join(' · ')
      : it.title ?? '';
    if (it.plain) {
      box.append(el('span', { class: 'chip plain', title, text: it.label }));
      continue;
    }
    box.append(el('button', {
      type: 'button',
      class: `chip${plain ? ' plain' : ''}`,
      title,
      onclick: it.run,
    }, it.label));
  }
  return box;
}

async function articleCard() {
  const { id } = st.current;
  const payload = await ensureCards();
  const card = payload.cards[id];
  if (!card) {
    dom.doc.append(el('div', { class: 'empty', text: 'Карточка не найдена.' }));
    return;
  }
  head(card.kind === 'shape' ? 'фигура' : 'связь', card.title, [
    card.kind === 'shape' ? 'Нотация UML' : 'Связь UML',
    card.clause ? `пункт ${card.clause.number}` : 'пункта нет',
    card.diagrams
      ? `диаграммы: ${card.diagramsLabel ? `${card.diagramsLabel} (${card.diagrams})` : card.diagrams}`
      : '',
    card.plantuml ? `PlantUML: ${card.plantuml}` : '',
  ].filter(Boolean));

  const ctx = {
    hasClause: () => false,
    openRule: (rid) => openArticle(`rules:${rid}`),
  };
  dom.doc.append(el('p', { class: 'lead' }, inline(card.oneLine ?? '', ctx)));

  const part = (title, text) => {
    if (!text) return;
    dom.doc.append(el('h3', { text: title }));
    dom.doc.append(el('p', {}, inline(text, ctx)));
  };
  part('Что рисует', card.draws);
  part('Чем отличается от ближайшего соседа', card.differs);
  part('Пример', card.example);
  if (card.plantuml) {
    dom.doc.append(el('h3', { text: 'PlantUML' }));
    dom.doc.append(el('pre', { class: 'ocl', text: card.plantuml }));
  }

  const box = el('div', { class: 'rel' });
  box.append(el('h4', { text: 'Связано' }));
  if (card.clause) {
    const c = clauseByNumber(card.clause.number);
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Пункт стандарта' }), chips([
      { label: `${card.clause.number} ${card.clause.title}`, run: () => openArticle(`spec:${c?.i ?? card.clause.id}`) },
    ])));
  }
  if (card.rules?.length) {
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Правила' }), chips(
      card.rules.map((rid) => ({ label: rid, run: () => openArticle(`rules:${rid}`) })),
    )));
  }
  if (card.seeAlso?.length) {
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Рядом' }), chips(
      card.seeAlso.map((k) => ({ label: k, run: () => openArticle(`notation:shape:${k}`), guess: true })),
    )));
  }
  if (card.stereotypes?.length) {
    const list = card.stereotypes.slice(0, 8);
    box.append(el('div', { class: 'grp' },
      el('div', { class: 'gl', text: `Стереотипы · ${card.stereotypes.length}` }),
      chips(list.map((n) => ({ label: n, run: () => openArticle(`stereotypes:${n}`), guess: true })))));
  }
  dom.doc.append(box);
  dom.doc.append(placeAction(card));
}

/* ------------------------------------------------- «Поставить на лист» */

/** Свободное место на листе: та же сетка, что у дерева модели. */
function freeSpot(diagram, w, h) {
  const shapes = diagram?.shapes ?? [];
  for (let y = 40; y < 4000; y += 20) {
    for (let x = 40; x < 4000; x += 20) {
      const hit = shapes.some((s) => x < s.x + s.w + 20 && x + w + 20 > s.x
        && y < s.y + s.h + 20 && y + h + 20 > s.y);
      if (!hit) return { x, y };
    }
  }
  return { x: 40, y: 40 };
}

/**
 * Кнопка карточки — как #btn-place прототипа. Связь требует двух фигур на
 * листе: без них кнопка неактивна и title говорит, чего не хватает, — вместо
 * клика, который молча ничего не делает.
 */
function placeAction(card) {
  const d = currentDiagram(store.model);
  const isConn = card.kind === 'connector';
  const shapes = d?.shapes ?? [];
  const need = !d
    ? 'В модели нет диаграммы — создайте её кнопкой «+» в шапке'
    : isConn && shapes.length < 2
      ? `Связь соединяет две фигуры — на листе ${shapes.length}, нужно две`
      : '';
  const ready = !need;
  return el('button', {
    type: 'button',
    class: 'action',
    id: 'btn-place',
    disabled: !ready,
    title: ready
      ? (isConn ? `Поставить связь «${card.title}» между двумя фигурами листа` : `Поставить фигуру «${card.title}» на лист`)
      : need,
    onclick: () => placeCard(card),
  }, icon('ui-plus', 16), 'Поставить на лист');
}

/** Положить фигуру или связь карточки на текущий лист; отмена — в тосте. */
function placeCard(card) {
  const d = currentDiagram(store.model);
  if (!d) { ScToast.show('Сначала создайте диаграмму', { tone: 'warning' }); return; }
  const toast = (text) => ScToast.show(text, {
    tone: 'success',
    action: { label: 'Отменить', onSelect: () => { undo(); renderCanvas(); } },
  });

  if (card.kind === 'shape') {
    const def = NOTATION.shapes[card.key];
    const spot = freeSpot(d, def?.defaultSize?.w ?? 190, def?.defaultSize?.h ?? 120);
    const made = commit(`Поставить «${card.title}»`, (m) => placeElement(m, card.key, spot.x, spot.y));
    if (!made) return;
    set({ selection: [{ kind: 'shape', id: made.shape.id }], tool: 'select', hint: `«${card.title}» на листе.` });
    renderCanvas();
    toast(`Поставлено: ${card.title}`);
    return;
  }

  const [a, b] = d.shapes ?? [];
  if (!a || !b) {
    ScToast.show('Связь соединяет две фигуры — поставьте их на лист', { tone: 'warning' });
    return;
  }
  const made = commit(`Поставить связь «${card.title}»`, (m) => {
    const rel = createRelationship(card.key, a.elementId, b.elementId);
    m.relationships.push(rel);
    const link = createLink(rel,
      { shapeId: a.id, side: 'right', t: 0.5 },
      { shapeId: b.id, side: 'left', t: 0.5 });
    currentDiagram(m).links.push(link);
    return link;
  });
  if (!made) return;
  set({ selection: [{ kind: 'connector', id: made.id }], tool: 'select', hint: `Связь «${card.title}» на листе.` });
  renderCanvas();
  toast(`Поставлено: ${card.title}`);
}

async function articleRule() {
  const { id } = st.current;
  const rule = allRules().find((r) => r.id === id);
  if (!rule) {
    dom.doc.append(el('div', { class: 'empty', text: 'Правило не найдено.' }));
    return;
  }
  const practice = !rule.source;
  const kv = (k, v) => {
    if (!v) return;
    const row = el('div', { class: 'kv-row' });
    row.append(el('span', { class: 'k', text: k }));
    row.append(el('span', { class: 'v', text: v }));
    dom.doc.append(row);
  };

  // Слой практики — не констрейнт: пункта и текста стандарта у него нет
  // вовсе, зато есть rationale. Показывать его в форме правила стандарта
  // значило бы выдать совет за требование (то же правило, что `basis` в
  // движке), поэтому ветка отдельная, а не «пустой source».
  if (practice) {
    // «Чей текст» — первой строкой: это наш совет, а не требование стандарта.
    head('практика', rule.id, ['наш совет, не требование стандарта']);
    if (rule.message) dom.doc.append(el('p', { class: 'lead' }, inline(rule.message, {})));
    if (rule.rationale) dom.doc.append(el('p', { text: rule.rationale }));
    kv('Проверка', rule.check);
    kv('Подсказка', rule.hint);
    const box = el('div', { class: 'rel' });
    box.append(el('h4', { text: 'Связано' }));
    const shapes = [...(rule.appliesTo?.element ?? []), ...(rule.appliesTo?.relationship ?? [])];
    if (shapes.length) {
      box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Фигуры' }), chips(
        shapes.slice(0, 12).map((s) => ({
          label: s,
          guess: true,
          run: () => openArticle(window.__uml?.NOTATION?.shapes?.[s] ? `notation:shape:${s}` : `notation:connector:${s}`),
        })),
      )));
    }
    dom.doc.append(box);
    dom.doc.append(el('p', { class: 'fine', text: 'Это совет по практике моделирования, а не пункт стандарта UML 2.5.1: '
      + 'такую модель можно сохранить, но читать её труднее.' }));
    return;
  }

  // Шапка правила говорит и «чей текст» (движок), и «где он в стандарте»:
  // чип «в реестре: …» ведёт в строку реестра, а для шести правил, которых
  // модель не выражает, честно сказано, почему движок их не исполняет.
  const reg = registryRow(rule);
  head('правило', rule.id, [
    rule.level === 'error' ? 'ошибка' : 'предупреждение',
    rule.source.metaclass,
    `пункт ${rule.source.clause}`,
    reg && reg.status !== 'executable' ? 'не выражается моделью' : 'проверяет движок',
    registryChip(rule),
  ]);
  if (rule.source.text) dom.doc.append(el('p', { class: 'lead' }, inline(rule.source.text, {})));
  if (rule.source.ocl) dom.doc.append(el('pre', { class: 'ocl', text: rule.source.ocl }));

  kv('Метакласс', rule.source.metaclass);
  kv('Констрейнт', rule.source.constraint);
  kv('Проверка', rule.check);
  kv('Сообщение', rule.message);
  kv('Подсказка', rule.hint);

  const box = el('div', { class: 'rel' });
  box.append(el('h4', { text: 'Связано' }));
  const c = clauseByNumber(rule.source.clause);
  if (c) {
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Пункт стандарта' }), chips([
      { label: `${rule.source.clause} ${c.t}`, run: () => openArticle(`spec:${c.i}`) },
    ])));
  }
  const shapes = [...(rule.appliesTo?.element ?? []), ...(rule.appliesTo?.relationship ?? [])];
  if (shapes.length) {
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Фигуры' }), chips(
      shapes.map((s) => ({
        label: s,
        guess: true,
        run: () => openArticle(window.__uml?.NOTATION?.shapes?.[s] ? `notation:shape:${s}` : `notation:connector:${s}`),
      })),
    )));
  }
  dom.doc.append(box);
}

async function articleTutorial() {
  const { id } = st.current;
  const chapter = st.data.course.chapters.find((c) => c.exercises.some((e) => e.id === id));
  const ex = chapter?.exercises.find((e) => e.id === id);
  if (!ex) {
    dom.doc.append(el('div', { class: 'empty', text: 'Упражнение не найдено.' }));
    return;
  }
  // «Чей это текст» — упражнение и рисунок: шапка называет и то, что читают
  // (номер упражнения), и то, куда смотреть (рисунок пособия).
  head(`упражнение ${ex.number}`, ex.title, [
    `упражнение ${ex.number}`,
    `глава ${chapter.number}`,
    ex.figureNo ? `рис. ${ex.figureNo}` : '',
    ex.type ? String(ex.type) : '',
  ].filter(Boolean));

  const text = await data.courseText(ex.text);
  const md = markdown(text);
  // Метки рисунков в пособии — кнопки, которые прокручивают к рисунку в панели
  // «Курс». Здесь рисунков нет: метка остаётся подписью, а не мёртвой кнопкой.
  for (const b of [...md.querySelectorAll('button.fig-ref')]) {
    b.replaceWith(el('span', { class: 'fig-label', title: 'Рисунок — в панели «Курс»', text: b.textContent }));
  }
  dom.doc.append(md);

  const box = el('div', { class: 'rel' });
  box.append(el('h4', { text: 'Связано' }));
  if (ex.figures?.length) {
    box.append(el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Рисунки пособия' }),
      el('div', { class: 'chips' }, ...ex.figures.map((f) => el('span', { class: 'chip plain', text: `Рис. ${f.figureNo}` })))));
  }
  // Упражнение → пункты стандарта: `links.tutorial` хранит связи «упражнение →
  // пункт», но статья показывала только рисунки — перехода в стандарт не было
  // вовсе, хотя обратный (пункт → упражнение) есть.
  const clauses = tutorialClauses(ex);
  if (clauses.length) {
    box.append(el('div', { class: 'grp' },
      el('div', { class: 'gl', text: `Пункты стандарта, к которым относится упражнение · ${clauses.length}` }),
      chips(clauses.map((t) => {
        const c = clauseByNumber(t.clause.number);
        return {
          label: `${t.clause.number} ${t.clause.title}`,
          title: [...(t.basis ?? [])].filter(Boolean).join(' · '),
          guess: t.confidence === 'guess',
          run: () => { if (c) openArticle(`spec:${c.i}`); },
        };
      }))));
  }
  if (box.querySelector('.grp')) dom.doc.append(box);
}

/**
 * Связи «упражнение → пункт стандарта» по номеру упражнения. Один пункт —
 * один чип: в `links.tutorial` пара может встретиться дважды (рисунок и
 * упражнение), а человеку нужен переход, а не счётчик повторов.
 */
function tutorialClauses(ex) {
  const seen = new Set();
  const out = [];
  for (const t of st.data?.links?.tutorial ?? []) {
    if (t.kind !== 'exercise' || t.id !== ex.number || !t.clause) continue;
    if (seen.has(t.clause.number)) continue;
    seen.add(t.clause.number);
    out.push(t);
  }
  return out;
}

async function articleStereotype() {
  const { id } = st.current;
  const s = st.data.stereotypes.stereotypes.find((x) => x.name === id);
  if (!s) {
    dom.doc.append(el('div', { class: 'empty', text: 'Стереотип не найден.' }));
    return;
  }
  head('стереотип', s.name, [s.baseType, s.group === 'ProjectStereotypes' ? 'проектный' : 'прикладной',
    s.abstract ? 'абстрактный' : ''].filter(Boolean));
  const kv = (k, v) => {
    if (!v) return;
    const row = el('div', { class: 'kv-row' });
    row.append(el('span', { class: 'k', text: k }));
    row.append(el('span', { class: 'v', text: v }));
    dom.doc.append(row);
  };
  kv('Базовый тип', s.baseType);
  kv('Группа', s.group);
  kv('Фигура', s.shape);
  if (s.basis) dom.doc.append(el('p', { class: 'lead', text: s.basis }));
  if (s.shape) {
    dom.doc.append(el('div', { class: 'rel' }, el('h4', { text: 'Связано' }),
      el('div', { class: 'grp' }, el('div', { class: 'gl', text: 'Нотация' }), chips([
        { label: s.shape, run: () => openArticle(`notation:${s.shapeKind === 'connector' ? 'connector' : 'shape'}:${s.shape}`), guess: s.confidence !== 'exact' },
      ]))));
  }
}

async function articlePlantuml() {
  const { id } = st.current;
  const c = st.data.plantuml.constructs.find((x) => x.id === id);
  if (!c) {
    dom.doc.append(el('div', { class: 'empty', text: 'Конструкция не найдена.' }));
    return;
  }
  head('PlantUML', c.id, [c.diagramTitle, c.sourceClass]);
  if (c.syntax) dom.doc.append(el('pre', { class: 'ocl', text: c.syntax }));
  if (c.note) dom.doc.append(el('p', { class: 'lead' }, inline(c.note, {})));
  if (c.modelElement) {
    dom.doc.append(el('div', { class: 'kv-row' },
      el('span', { class: 'k', text: 'Элемент модели' }), el('span', { class: 'v', text: c.modelElement })));
  }
  dom.doc.append(el('p', { class: 'fine', text: 'Полная грамматика — docs/research/PLANTUML-GRAMMAR.md; здесь — конструкция и её источник в PlantUML.' }));
}

/* ------------------------------------------------ словарь терминов (Э12) */

/** 315 терминов словаря как список для подсказок: одна сборка на сеанс. */
function glossTerms() {
  if (st.glossArr) return st.glossArr;
  st.glossArr = (st.data?.gloss?.terms ?? [])
    .map((t) => {
      const ru = String(t.ru ?? '').toLowerCase();
      return { en: t.en, ru, stem: ru.replace(/[аеиоуыэюя]$/, '') };
    })
    .filter((t) => t.stem.length >= 4)
    .sort((a, b) => b.stem.length - a.stem.length);
  st.glossRe = new Map();
  return st.glossArr;
}

/** Регулярка термина: основа + до трёх букв окончания, целое слово. */
function termRe(stem) {
  if (!st.glossRe) st.glossRe = new Map();
  let re = st.glossRe.get(stem);
  if (!re) {
    re = new RegExp(`(?<![а-яё])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[а-яё]{0,3}(?![а-яё])`, 'i');
    st.glossRe.set(stem, re);
  }
  return re;
}

/**
 * Первое упоминание термина в статье: русское слово остаётся словом, а
 * английский оригинал уходит в title — без новых классов, цветов и значков.
 * Подчёркивается только то, что есть в словаре: незнакомое слово не трогаем.
 */
function markTerms(host, limit = 12) {
  const terms = glossTerms();
  if (!terms.length) return;
  const seen = new Set();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (seen.size >= limit) break;
    const parent = node.parentElement;
    if (!parent || parent.closest('pre, code, abbr, .doc-num, .doc-title, .attrib, .rel')) continue;
    const text = node.nodeValue;
    if (!text || text.length < 4) continue;
    for (const t of terms) {
      if (seen.has(t.en)) continue;
      const m = termRe(t.stem).exec(text);
      if (!m) continue;
      seen.add(t.en);
      const after = node.splitText(m.index);
      after.nodeValue = after.nodeValue.slice(m[0].length);
      const abbr = el('abbr', { title: t.en, text: m[0] });
      after.parentNode.insertBefore(abbr, after);
      break;
    }
  }
}

/** Страница «Словарь терминов»: en → ru с пометкой и строкой фильтра. */
async function articleGlossary() {
  const terms = (st.data?.gloss?.terms ?? []).slice()
    .sort((a, b) => String(a.en).localeCompare(String(b.en)));
  head('словарь', 'Словарь терминов', [
    plural(terms.length, 'термин', 'термина', 'терминов'),
    'en → ru',
  ]);
  langBar();
  dom.doc.append(el('p', { class: 'lead' },
    'Как понятие стандарта называется по-русски в переводе и в панели приложения. '
    + 'По этому словарю перевод и держится за интерфейс: «Association» — «ассоциация», '
    + 'а не «связь».'));
  if (!terms.length) {
    dom.doc.append(el('div', { class: 'empty', text: 'Словарь в эту сборку не попал.' }));
    return;
  }

  const input = el('input', {
    class: 'panel-search',
    type: 'search',
    placeholder: 'Фильтр: en, ru или пометка…',
    'aria-label': 'Фильтр по словарю терминов',
  });
  dom.doc.append(input);

  const table = el('table', { class: 'doc-table' });
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Английский', 'Русский', 'Пометка']) hr.append(el('th', { text: h }));
  thead.append(hr);
  table.append(thead);
  const body = el('tbody');
  const rows = terms.map((t) => {
    const tr = el('tr');
    tr.append(el('td', { text: t.en }));
    tr.append(el('td', { text: t.ru }));
    tr.append(el('td', {}, t.note ? el('span', { class: 'fine', text: t.note }) : document.createTextNode(t.kind ?? '')));
    body.append(tr);
    return {
      tr,
      hay: `${t.en} ${t.ru} ${t.note ?? ''} ${t.kind ?? ''}`.toLowerCase().replace(/ё/g, 'е'),
    };
  });
  table.append(body);
  dom.doc.append(table);
  const counter = el('div', { class: 'fine' });
  dom.doc.append(counter);

  const apply = () => {
    const q = String(input.value ?? '').trim().toLowerCase().replace(/ё/g, 'е');
    let shown = 0;
    for (const r of rows) {
      const hit = !q || r.hay.includes(q);
      r.tr.hidden = !hit;
      if (hit) shown += 1;
    }
    counter.textContent = `${shown} из ${rows.length}`;
  };
  input.addEventListener('input', apply);
  apply();
}

/* ------------------------------------------------------------- оглавление */

function renderToc() {
  clear(dom.toc);
  if (st.mode !== 'page' || st.current.shelf !== 'spec' || !st.current.id || st.current.id === 'about') {
    dom.toc.hidden = true;
    return;
  }
  const node = clauseById(st.current.id);
  if (!node) {
    dom.toc.hidden = true;
    return;
  }
  const sec = sectionOfNumber(node.n);
  const all = (specNow()?.clauses ?? []).filter((c) => c.s === node.s);
  // Как в прототипе: пункты раздела второго уровня и, под текущей веткой,
  // её пункты третьего уровня. Глубина 4–5 в оглавление не идёт.
  const chain = [...ancestors(node), node].map((c) => c.i);
  const parent = node.l >= 3 ? chain[chain.length - 2] : null;
  const at = parent ? all.findIndex((c) => c.i === parent) : -1;
  const rows = [];
  for (let i = 0; i < all.length; i += 1) {
    const c = all[i];
    if (c.l === 2) rows.push(c);
    else if (parent && c.l === 3 && i > at) {
      let owner = null;
      for (let j = i - 1; j >= 0; j -= 1) if (all[j].l === 2) { owner = all[j].i; break; }
      if (owner === parent) rows.push(c);
    }
  }
  dom.toc.hidden = false;
  dom.toc.append(el('h4', { text: 'В этом разделе' }));
  const ol = el('ol');
  for (const c of rows) {
    const a = el('a', {
      href: `#${c.i}`,
      class: `${c.i === node.i ? 'on' : ''}${c.l > 2 ? ' lvl4' : ''}`.trim(),
      title: `${c.n} ${c.t}`,
      onclick: (e) => { e.preventDefault(); openArticle(`spec:${c.i}`); },
    }, `${c.n} ${c.t}`);
    ol.append(el('li', {}, a));
  }
  dom.toc.append(ol);
  if (sec) dom.toc.append(el('div', { class: 'toc-foot', text: `раздел ${sec.number} · стр. ${sec.pages?.printed ?? '—'}` }));
}

/* ----------------------------------------------- предыдущий / следующий */

function shelfOrder() {
  if (st.current.shelf === 'spec') return (specNow()?.clauses ?? []).map((c) => `spec:${c.i}`);
  if (st.current.shelf === 'notation') {
    const n = window.__uml?.NOTATION;
    return [
      ...Object.keys(n?.shapes ?? {}).map((k) => `notation:shape:${k}`),
      ...Object.keys(n?.connectors ?? {}).map((k) => `notation:connector:${k}`),
    ];
  }
  if (st.current.shelf === 'rules') return allRules().map((r) => `rules:${r.id}`);
  if (st.current.shelf === 'tutorial') {
    return st.data.course.chapters.flatMap((c) => c.exercises.map((e) => `tutorial:${e.id}`));
  }
  if (st.current.shelf === 'stereotypes') return st.data.stereotypes.stereotypes.map((s) => `stereotypes:${s.name}`);
  if (st.current.shelf === 'plantuml') return st.data.plantuml.constructs.map((c) => `plantuml:${c.id}`);
  return [];
}

function neighbour(dir) {
  if (!st.data) return null;
  const order = shelfOrder();
  const at = order.indexOf(keyOf(st.current));
  if (at < 0) return null;
  const next = order[at + dir];
  return next ? { key: next, label: labelOfKey(next) } : null;
}

function labelOfKey(key) {
  const [shelf, ...rest] = key.split(':');
  const id = rest.join(':');
  if (shelf === 'spec') {
    const c = clauseById(id);
    return c ? `${c.n} ${c.t}` : id;
  }
  return labelOf(shelf, id);
}

function renderPager() {
  const prev = neighbour(-1);
  const next = neighbour(1);
  if (!prev && !next) return;
  const pager = el('div', { class: 'pager' });
  if (prev) {
    pager.append(el('button', { class: 'prev', type: 'button', title: prev.label, onclick: () => openKey(prev.key) },
      icon('ui-arrow-up', 16), prev.label));
  }
  if (next) {
    pager.append(el('button', { class: 'next', type: 'button', title: next.label, onclick: () => openKey(next.key) },
      next.label, icon('ui-arrow-down', 16)));
  }
  dom.doc.append(pager);
}

/* --------------------------------------------------------------- поиск */

function renderSearch() {
  clear(dom.results);
  clear(dom.sum);
  const q = st.query.trim();
  if (!q) {
    dom.sum.append(el('span', { text: 'Поиск по всем полкам: нотация, правила, стандарт, спецификация, пособие, стереотипы, PlantUML.' }));
    dom.results.append(el('li', { class: 'empty', text: 'Начните печатать: «квалификатор», «association», «композиция», «Упражнение 4.3.B».' }));
    return;
  }
  const cyrillic = /[а-яё]/i.test(q);
  const alias = st.terms?.pairs?.[q.toLowerCase()];
  dom.sum.append(document.createTextNode(`Найдено ${st.results.length}`));
  dom.sum.append(el('span', { text: ` по запросу «${q}»` }));
  if (cyrillic) {
    dom.sum.append(el('span', { class: 'alias', text: alias ? ` → ${alias}` : ' → через таблицу псевдонимов' }));
  }
  const shelves = [...new Set(st.results.map((r) => SHELF_OF_KIND[r.kind]))]
    .map((s) => SHELF_TITLE[s]).filter(Boolean);
  if (shelves.length) dom.sum.append(el('span', { text: ` · ${shelves.join(' · ')}` }));
  if (st.searchRu) {
    const ruN = st.results.filter((r) => r.lang === 'ru').length;
    const enN = st.results.length - ruN;
    dom.sum.append(el('span', { text: ` · рус ${ruN} · en ${enN}` }));
  }

  if (!st.results.length) {
    dom.results.append(el('li', { class: 'empty', text:
      'Ничего не найдено. Попробуйте «ассоциация», «квалификатор», «кратность», '
      + '«композиция» — эти русские слова разворачиваются в английские через таблицу псевдонимов.' }));
    return;
  }
  // Подсветка идёт по тому, что человек видит: для русского запроса —
  // по переводу из таблицы псевдонимов, иначе «квалификатор» не подсветил бы
  // ничего (в тексте стандарта слова «квалификатор» нет вовсе).
  const needles = [q];
  if (alias) needles.push(...String(alias).split(/\s+/).filter((w) => w.length >= 3));
  for (const r of st.results.slice(0, st.shown)) {
    const key = keyForResult(r);
    const li = el('li');
    const { title, snippet } = resultParts(r);
    const btn = el('button', {
      class: 'res', type: 'button', title: r.text.slice(0, 300),
      onclick: () => {
        if (!key) return;
        // Клик по русской выдаче открывает ту же статью по-русски: язык — это
        // свойство найденного текста, а не отдельная полка.
        if (r.lang && r.lang !== st.lang) {
          st.lang = r.lang;
          saveLang(r.lang);
          renderNav();
        }
        openKey(key);
      },
    });
    const r1 = el('span', { class: 'r1' });
    r1.append(el('span', { class: 'rt' }, mark(title, needles)));
    r1.append(el('span', { class: 'rnum', text: r.ref }));
    if (r.lang) r1.append(el('span', { class: 'rnum', text: r.lang === 'ru' ? 'рус' : 'en' }));
    r1.append(el('span', { class: 'corp', text: SHELF_TITLE[SHELF_OF_KIND[r.kind]] ?? r.kind }));
    btn.append(r1);
    btn.append(el('span', { class: 'r2' }, mark(snippet, needles)));
    li.append(btn);
    dom.results.append(li);
  }
  if (st.results.length > st.shown) {
    dom.results.append(el('li', { class: 'more' }, el('button', {
      type: 'button', class: 'more-btn',
      onclick: () => { st.shown += PAGE; renderSearch(); },
    }, `Показать ещё ${Math.min(PAGE, st.results.length - st.shown)}`)));
  }
}

/** Заголовок и фрагмент строки выдачи: у каждого вида своё. */
function resultParts(r) {
  const text = String(r.text ?? '');
  const uniq = (s2) => [...new Set(s2.split(/\s+/))].join(' ');
  if (r.kind === 'rule') {
    const rest = text.split(' ').slice(1).join(' ');
    return { title: r.ref, snippet: rest };
  }
  if (r.kind === 'stereotype') return { title: r.ref, snippet: uniq(text) };
  if (r.kind === 'shape' || r.kind === 'connector') {
    const def = r.kind === 'shape' ? NOTATION.shapes[r.ref] : NOTATION.connectors[r.ref];
    return { title: def?.label ?? r.ref, snippet: uniq(text) };
  }
  if (r.kind === 'spec-node') return { title: text, snippet: `Пункт ${r.ref} стандарта` };
  return { title: text.split(' ').slice(0, 9).join(' '), snippet: text };
}

/** Подсветка: первый вход любой иглы в строку, остальное — как есть. */
function mark(text, needles) {
  const frag = document.createDocumentFragment();
  const s = String(text ?? '');
  const list = (Array.isArray(needles) ? needles : [needles]).filter(Boolean);
  let best = -1;
  let hit = '';
  for (const n of list) {
    const i = s.toLowerCase().indexOf(String(n).toLowerCase());
    if (i >= 0 && (best < 0 || i < best)) { best = i; hit = String(n); }
  }
  if (best < 0) { frag.append(document.createTextNode(s)); return frag; }
  frag.append(document.createTextNode(s.slice(0, best)));
  frag.append(el('mark', { text: s.slice(best, best + hit.length) }));
  frag.append(document.createTextNode(s.slice(best + hit.length)));
  return frag;
}

function keyForResult(r) {
  const shelf = SHELF_OF_KIND[r.kind];
  if (!shelf) return null;
  if (shelf === 'spec') {
    const c = clauseByNumber(r.ref);
    return c ? `spec:${c.i}` : null;
  }
  if (shelf === 'notation') return `notation:${r.kind}:${r.ref}`;
  if (shelf === 'rules') return `rules:${r.ref}`;
  if (shelf === 'stereotypes') return `stereotypes:${r.ref}`;
  if (shelf === 'tutorial') {
    for (const c of st.data.course.chapters) {
      const ex = c.exercises.find((e) => e.number === r.ref);
      if (ex) return `tutorial:${ex.id}`;
    }
    return null;
  }
  if (shelf === 'plantuml') return `plantuml:${r.ref}`;
  return null;
}

/**
 * Поиск сразу по двум языкам. Каждый индекс отвечает своим движком (алгоритм
 * один — createSearch), счета приводятся к лучшему результату своего индекса:
 * напрямую их сравнивать нельзя, idf считается от своего корпуса. Язык,
 * совпадающий с письмом запроса, идёт первым — иначе латинский запрос топило
 * бы русскими совпадениями по словарю.
 */
function searchBoth(q) {
  if (!st.search) return [];
  const en = st.search.search(q).map((r) => ({ ...r, lang: 'en' }));
  const ru = st.searchRu ? st.searchRu.search(q).map((r) => ({ ...r, lang: 'ru' })) : [];
  const norm = (list) => {
    const top = list[0]?.score || 1;
    return list.map((r) => ({ ...r, score: r.score / top }));
  };
  const cyrillic = /[а-яё]/i.test(q);
  const primary = cyrillic ? 'ru' : 'en';
  const merged = [...norm(en), ...norm(ru)];
  for (const r of merged) r.rank = r.score + (r.lang === primary ? 0.5 : 0);
  merged.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    const fa = a.lang === primary ? 0 : 1;
    const fb = b.lang === primary ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.id - b.id;
  });
  return merged;
}

async function runSearch(q) {
  await ensure();
  await ensureSearch();
  if (!st.terms) st.terms = await data.terms();
  st.query = String(q ?? '');
  st.results = st.query.trim() ? searchBoth(st.query) : [];
  st.shown = PAGE;
  if (st.open) {
    st.view = 'search';
    dom.ref.dataset.view = 'search';
    renderSearch();
  }
  return st.results;
}

/* ------------------------------------------------------------ переходы */

const VALID = new Set(SHELVES.map((s) => s.id));

function parseKey(key) {
  const i = String(key).indexOf(':');
  if (i < 0) return { shelf: 'spec', id: key };
  return { shelf: key.slice(0, i), id: key.slice(i + 1) };
}

function openKey(key) {
  openArticle(key);
}

async function openArticle(key) {
  await ensure();
  const next = parseKey(key);
  if (!VALID.has(next.shelf)) return;
  // `reference.open {section}` — с какой полки человек читает. Раздел — это
  // id полки из закрытого списка SHELVES: 'spec' — «Спецификация», и так
  // далее. Ни заголовка статьи, ни поискового запроса счётчик не получает.
  track('reference.open', { section: next.shelf });
  if (key !== keyOf(st.current) || !dom.doc.childElementCount) {
    if (dom.doc.childElementCount) {
      st.history.push({ ...st.current });
      if (st.history.length > HISTORY_MAX) st.history.shift();
    }
    st.current = next;
  }
  // Дерево: раскрыть полку и, для стандарта, раздел с текущим пунктом.
  st.expanded.add(`g:${next.shelf}`);
  if (next.shelf === 'spec' && next.id !== 'about') {
    const node = clauseById(next.id);
    if (node) {
      const sec = sectionOfNumber(node.n);
      if (sec) st.expanded.add(`spec:${sec.id}`);
    }
  }
  st.view = 'article';
  dom.ref.dataset.view = 'article';
  renderNav();
  await renderArticle();
  renderPager();
}

/**
 * Открыть статью пункта стандарта по номеру — из «Проверок» и по F1.
 * Возвращает false, если такого пункта в дереве нет: вызывающий покажет
 * диалог с цитатой, а не пустую панель.
 */
/**
 * Открыть статью правила по id — из карточки замечания в панели «Проверки».
 * Возвращает false, если такого правила нет в наборе: карточка тогда не
 * показывает мёртвую кнопку, а говорит, что правило не найдено.
 */
export async function openRule(id) {
  await ensure();
  if (!allRules().some((r) => r.id === id)) return false;
  if (!openReference()) return false;
  await openArticle(`rules:${id}`);
  return true;
}

/**
 * Открыть полку «Стандарт» — вход из панели «Проверки» (человек увидел
 * «невыразимо» и хочет объяснения) и новая точка входа `window.__uml.standard`.
 * Возвращает false, если библиотеке не хватило места: вызывающий не должен
 * считать, что полка открылась.
 */
export async function openStandardShelf() {
  await ensure();
  if (!openReference()) return false;
  await openArticle('standard:');
  return true;
}

export async function openClause(number) {
  await ensure();
  const node = clauseByNumber(String(number ?? '').trim());
  if (!node) return false;
  if (!openReference()) return false;
  await openArticle(`spec:${node.i}`);
  return true;
}

/** Открыть статью нотации фигуры/связи по ключу — F1 на выделенной фигуре. */
export async function openNotation(kind, key) {
  await ensure();
  await ensureCards();
  const cardKind = kind === 'connector' ? 'connector' : 'shape';
  const id = `${cardKind}:${key}`;
  if (!st.data.cards?.cards?.[id]) return false;
  if (!openReference()) return false;
  await openArticle(`notation:${id}`);
  return true;
}

/** Назад по истории (Alt+←). */
function back() {
  const prev = st.history.pop();
  if (!prev) return false;
  st.current = prev;
  st.view = 'article';
  dom.ref.dataset.view = 'article';
  renderNav();
  renderArticle();
  renderPager();
  return true;
}

/* -------------------------------------------------------------- режимы */

function setMode(mode) {
  st.mode = mode === 'page' || mode === 'wide' ? mode : 'split';
  // Смена раскладки возвращает к статье: «страница» поверх выдачи поиска
  // показала бы пустую колонку статьи (в прототипе то же — rig зовёт setView).
  if (st.view !== 'article') setView('article');
  dom.work.classList.toggle('page', st.mode !== 'split');
  dom.work.classList.toggle('wide', st.mode === 'wide');
  document.getElementById('body')?.classList.toggle('wide', st.mode === 'wide');
  updateRoom();
  renderNav();
  renderToc();
  renderCanvas();
}

function cycleMode() {
  const order = ['split', 'page', 'wide'];
  setMode(order[(order.indexOf(st.mode) + 1) % order.length]);
}

/** Колонка дерева возможна только при #center ≥ 980 px — правило §6.2. */
function updateRoom() {
  const center = document.getElementById('center');
  const room = (center?.clientWidth ?? 0) >= 980;
  dom.work.classList.toggle('room', room);
}

function setView(v) {
  st.view = v === 'tree' || v === 'search' ? v : 'article';
  dom.ref.dataset.view = st.view;
  if (st.view === 'tree') {
    renderNav();
    // Текущая статья может быть глубоко в дереве: показать её, а не начало.
    requestAnimationFrame(() => {
      dom.nav.querySelector('.node.current')?.scrollIntoView({ block: 'center' });
    });
  }
  if (st.view === 'search') { renderSearch(); dom.searchInput.focus(); }
  dom.tree.classList.toggle('on', st.view === 'tree');
}

/* ------------------------------------------------------------- открытие */

// Ширина полосы читалки (--ref-w) и предел, ниже которого лист перестаёт быть
// рабочим: на 360 px ещё видны две фигуры рядом, на 150 — нет (§5.4).
const REF_W = 420;
const MIN_SHEET_W = 360;

/** Сколько осталось бы листу, если открыть читалку сейчас. */
function sheetRoom() {
  const center = document.getElementById('center');
  return (center?.clientWidth ?? 0) - REF_W;
}

export function openReference() {
  if (!dom) initReference();
  // Защита ширины (п. 6 приёмки): читалка отнимает у листа свои 420 px, и на
  // узком окне ему осталось бы меньше 360. Тогда честнее не открыть и
  // подсказать выход, чем оставить человеку полосу, на которой нечего рисовать.
  if (!st.open) {
    const room = sheetRoom();
    if (room < MIN_SHEET_W) {
      const need = `${Math.max(0, Math.round(room))} px из ${MIN_SHEET_W}`;
      ScToast.show('Окно узкое: закройте инспектор или разверните окно', { tone: 'warning' });
      set({ hint: `Библиотеке не хватает места: листу осталось бы ${need}. Закройте инспектор или разверните окно.` });
      return false;
    }
  }
  // Режим курса занимает место листа: читалка открылась бы под его слоем.
  // Курс и библиотека не живут одновременно — вход в курс закрывает читалку,
  // обратный вход закрывает курс.
  if (courseModeOpen()) closeCourse();
  st.open = true;
  dom.work.classList.add('ref-open');
  if (st.mode === 'split') setMode('split');
  // Кнопка «Библиотека» в тулбаре — переключатель (aria-pressed): её состояние
  // обязано следовать за читалкой, кто бы её ни открыл — тулбар, F1 или ссылка
  // в статье.
  set({});
  ensure().then(() => {
    renderNav();
    renderArticle();
    renderPager();
  });
  // Лист сузился — пересчитать вписывание, не трогая масштаб и выделение.
  requestAnimationFrame(() => {
    updateRoom();
    renderCanvas();
  });
  return true;
}

export function closeReference() {
  if (!dom) return false;
  const was = st.open;
  st.open = false;
  dom.work.classList.remove('ref-open');
  // Режим «страница» без читалки оставил бы пустой центр: лист в нём скрыт.
  // Поэтому закрытие возвращает раскладку «рядом», а «широко» — ещё и
  // показывает инспектор.
  st.mode = 'split';
  dom.work.classList.remove('page', 'wide');
  document.getElementById('body')?.classList.remove('wide');
  requestAnimationFrame(() => { updateRoom(); renderCanvas(); });
  // Состояние кнопки-переключателя в тулбаре (aria-pressed) идёт за читалкой.
  if (was) set({});
  return true;
}

export const referenceOpen = () => st.open;

/* -------------------------------------------------------------- каркас */

export function initReference() {
  if (dom) return;
  const ref = document.getElementById('ref');
  const work = document.getElementById('work');
  if (!ref || !work) return;
  dom = {
    ref,
    work,
    bar: ref.querySelector('.ref-bar'),
    crumbs: document.getElementById('ref-crumbs'),
    nav: document.getElementById('ref-nav'),
    scroll: document.getElementById('ref-scroll'),
    doc: document.getElementById('ref-doc'),
    toc: document.getElementById('ref-toc'),
    results: document.getElementById('ref-results'),
    sum: document.getElementById('ref-sum'),
    searchInput: document.getElementById('ref-q'),
    searchBody: document.getElementById('ref-search-body'),
  };
  dom.tree = document.getElementById('ref-tree');
  dom.prev = document.getElementById('ref-prev');
  dom.next = document.getElementById('ref-next');
  dom.mode = document.getElementById('ref-mode');
  dom.close = document.getElementById('ref-close');

  dom.crumbs.title = 'Крошки кликабельны; Alt+← — назад по истории (до 50 переходов)';
  dom.tree.append(icon('ui-panel-left', 18));
  dom.prev.append(icon('ui-arrow-up', 18));
  dom.next.append(icon('ui-arrow-down', 18));
  dom.mode.append(icon('ui-diagram', 18));
  dom.close.append(icon('ui-close', 18));

  dom.tree.addEventListener('click', () => setView(st.view === 'tree' ? 'article' : 'tree'));
  dom.prev.addEventListener('click', () => { const p = neighbour(-1); if (p) openKey(p.key); });
  dom.next.addEventListener('click', () => { const n = neighbour(1); if (n) openKey(n.key); });
  dom.mode.addEventListener('click', cycleMode);
  dom.close.addEventListener('click', closeReference);

  const searchBtn = document.getElementById('ref-search');
  if (searchBtn) {
    searchBtn.append(icon('ui-help', 18));
    searchBtn.addEventListener('click', () => setView(st.view === 'search' ? 'article' : 'search'));
  }

  let timer = null;
  dom.searchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => { runSearch(q); }, 120);
  });
  dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); runSearch(dom.searchInput.value); }
  });

  dom.ref.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      back();
    }
  });

  // Esc закрывает читалку из любого места. Обработчик висел на #ref и ловил
  // Escape, только когда фокус был внутри: после клика по листу панель
  // оставалась открытой, хотя title кнопки обещал «Закрыть (Esc)».
  // Capture-фаза на window срабатывает раньше обработчика приложения, поэтому
  // Esc не сбрасывает заодно выделение и инструмент — только читалку.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !st.open) return;
    if (document.querySelector('sc-dialog[open]')) return;   // диалог закрывает себя сам
    const a = document.activeElement;
    // В поле поиска Esc сначала чистит строку: стереть запрос — ближайшее
    // действие, а не «закрыть всё».
    if (a === dom.searchInput && a.value) {
      e.preventDefault();
      e.stopPropagation();
      a.value = '';
      runSearch('');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (st.view !== 'article') { setView('article'); return; }
    closeReference();
    if (dom.ref.contains(document.activeElement)) document.activeElement.blur();
  }, true);

  window.addEventListener('resize', () => { if (st.open) updateRoom(); });
  updateRoom();
  setView('article');
}

/* --------------------------------------------------------- для проверок */

export const reference = {
  open: openReference,
  close: closeReference,
  isOpen: () => st.open,
  ready: () => st.ready,
  mode: () => st.mode,
  setMode,
  cycleMode,
  view: () => st.view,
  setView,
  openArticle,
  openKey,
  openClause,
  openStandard: openStandardShelf,
  // Переход «правило → его строка реестра» (A4). Отдельным методом, потому что
  // проверке нужен сам переход, а не клик по чипу в разметке.
  openStandardRow,
  openRule,
  openNotation,
  back,
  current: () => ({ ...st.current }),
  history: () => st.history.map((h) => keyOf(h)),
  lang: () => st.lang,
  setLang,
  shelves: () => shelvesNow().map((s) => ({ id: s.id, title: s.title, hint: s.hint })),
  search: runSearch,
  results: () => st.results.slice(),
  query: () => st.query,
  neighbour: (dir) => neighbour(dir),
  searchBoth: (q) => searchBoth(q),
  state: st,
};
