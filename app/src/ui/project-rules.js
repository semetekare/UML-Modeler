// Редактор правил проекта — третий слой проверок, который пишет сама команда.
//
// Правила живут в файле модели (`model.projectRules`), поэтому редактор — не
// отдельное приложение и не настройка: он правит модель теми же `commit`,
// значит каждое изменение отменяется Ctrl+Z и сохраняется вместе с моделью.
//
// Условие собирается ТОЛЬКО из выпадающих списков: поле — из белого списка
// DSL, оператор — из списка операторов, связка — «все / любое / ни одно».
// Свободного текста в условии нет, поэтому опечатка `owner.nam` невозможна:
// её негде набрать. Импортированный файл может нести вложенное условие
// (`all` внутри `any`), которое форма не рисует, — такое правило показывается
// «условие сложной формы» и правится заменой на простое, а не молчаливой
// потерей: молча стереть половину условия хуже, чем сказать об этом.
//
// Вход — из панели «Проверки» (кнопка в шапке), а не из меню: правила проекта
// это третий слой ПРОВЕРОК, и человек ищет их там, где видит замечания этого
// слоя. Меню «Файл» занято файлами модели, «Модель» — чужая зона правки
// (`panels.js`), а панель проверок — наша. Второй вход — заголовок раздела
// «Правила проекта»: он появляется, когда правила уже есть.

import { el, clear, downloadText, slugify } from '../util.js';
import { store, commit } from '../state/store.js';
import { NOTATION } from '../model/notation.js';
import { ScDialog } from '../../ui-kit/js/dialog.js';
import {
  ELEMENT_FIELDS, RELATIONSHIP_FIELDS, OPERATORS, RULE_LEVELS, RULE_SCOPES,
  toRulesFile, fromRulesFile, validateRule, canonicalRule,
} from '../rules/dsl.js';

/* ------------------------------------------------------------- словари */

const LEVEL_LABEL = { error: 'ошибка', warning: 'предупреждение' };
const SCOPE_LABEL = { element: 'элемент', relationship: 'связь', model: 'модель' };
const LOGIC_LABEL = { all: 'все условия', any: 'любое из условий', not: 'ни одно из условий' };

/** Поля элемента/связи — те же имена, что в `dsl.js`; человеку — по-русски. */
const FIELD_LABEL = {
  kind: 'вид',
  name: 'имя',
  stereotype: 'стереотип',
  'owner.name': 'имя владельца',
  'owner.kind': 'вид владельца',
  visibility: 'видимость',
  'documentation.empty': 'документации нет',
  incoming: 'входящих связей',
  outgoing: 'исходящих связей',
  'from.name': 'имя начала',
  'from.kind': 'вид начала',
  'to.name': 'имя конца',
  'to.kind': 'вид конца',
  fromMultiplicity: 'кратность начала',
  toMultiplicity: 'кратность конца',
};

const OP_LABEL = {
  eq: 'равно', ne: 'не равно', in: 'одно из', notIn: 'не одно из',
  glob: 'по шаблону', exists: 'есть', empty: 'пусто', notEmpty: 'не пусто',
  gt: 'больше', lt: 'меньше', ge: 'не меньше', le: 'не больше',
};

/** Операторы без значения: у них в форме нет поля ввода. */
const NO_VALUE = new Set(['exists', 'empty', 'notEmpty']);
/** Операторы со списком значений (вводятся через запятую). */
const LIST_VALUE = new Set(['in', 'notIn']);
const NUMBER_VALUE = new Set(['gt', 'lt', 'ge', 'le']);

/** Виды для выпадающего списка: подпись из нотации, значение — ключ вида. */
function kindOptions(area) {
  const table = area === 'element' ? NOTATION.shapes : NOTATION.connectors;
  return Object.entries(table)
    .map(([kind, def]) => ({ kind, label: def?.label ?? kind }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

const fieldsFor = (scope) => (scope === 'element' ? ELEMENT_FIELDS : scope === 'relationship' ? RELATIONSHIP_FIELDS : []);

/* ------------------------------------------------------------- черновик */

/** Пустой черновик правила для формы. */
const blankDraft = () => ({
  id: '', title: '', level: 'warning', scope: 'element', kinds: [],
  logic: 'all', rows: [{ field: 'name', op: 'empty', value: '' }],
  message: '', hint: '',
});

/**
 * Черновик из правила. Сложное условие (вложенное глубже одного уровня или
 * незнакомой формы) не превращается в пустое: `complex` держит исходный `when`
 * и показывается предупреждением, пока человек не заменит условие.
 */
function draftOf(rule) {
  const d = blankDraft();
  d.id = String(rule.id ?? '');
  d.title = String(rule.title ?? '');
  d.level = RULE_LEVELS.includes(rule.level) ? rule.level : 'warning';
  d.scope = RULE_SCOPES.includes(rule.scope) ? rule.scope : 'element';
  d.kinds = [...(rule.appliesTo?.element ?? rule.appliesTo?.relationship ?? [])];
  d.message = String(rule.message ?? '');
  d.hint = String(rule.hint ?? '');

  const when = rule.when;
  if (when === undefined || when === null) {
    d.rows = [];
    d.logic = 'all';
  } else if (when.all || when.any) {
    const key = when.all ? 'all' : 'any';
    const list = when[key];
    if (Array.isArray(list) && list.every(isLeaf)) {
      d.logic = key;
      d.rows = list.map(leafDraft);
    } else {
      d.complex = when;
    }
  } else if (when.not && Array.isArray(when.not.any) && when.not.any.every(isLeaf)) {
    d.logic = 'not';
    d.rows = when.not.any.map(leafDraft);
  } else if (isLeaf(when)) {
    d.logic = 'all';
    d.rows = [leafDraft(when)];
  } else {
    d.complex = when;
  }
  return d;
}

const isLeaf = (n) => !!n && typeof n === 'object' && !Array.isArray(n)
  && !n.all && !n.any && !n.not && typeof n.field === 'string';

function leafDraft(leaf) {
  const op = OPERATORS.includes(leaf.op) ? leaf.op : 'eq';
  let value = leaf.value;
  if (LIST_VALUE.has(op) && Array.isArray(value)) value = value.join(', ');
  return { field: String(leaf.field ?? ''), op, value: value == null ? '' : String(value) };
}

/**
 * Условие из черновика. `undefined` — правило без условия (срабатывает на
 * всех). У правила уровня модели условия нет вовсе: строки формы остаются от
 * прошлой области, и без этой ветки сохранение падало бы на проверке
 * «у правила модели не бывает условия» — то есть на том, что человек только
 * что переключил.
 */
function whenOf(d) {
  if (d.scope === 'model') return undefined;
  if (d.complex) return d.complex;
  const rows = d.rows.filter((r) => r.field);
  if (!rows.length) return undefined;
  const leaves = rows.map((r) => {
    const leaf = { field: r.field, op: r.op };
    if (NO_VALUE.has(r.op)) return leaf;
    if (LIST_VALUE.has(r.op)) {
      leaf.value = String(r.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return leaf;
    }
    if (NUMBER_VALUE.has(r.op)) {
      leaf.value = r.value === '' ? '' : Number(r.value);
      return leaf;
    }
    return { ...leaf, value: String(r.value ?? '') };
  });
  if (d.logic === 'not') return { not: { any: leaves } };
  return { [d.logic]: leaves };
}

/* -------------------------------------------------------------- редактор */

/**
 * Открыть редактор. Возвращает обещание диалога (тестам и меню это удобно);
 * ошибки валидации не закрывают диалог, а показываются в форме.
 */
export function openProjectRules() {
  const body = el('div', { class: 'rules-editor', id: 'rules-editor' });
  let editingId = null;   // id правила, которое правим; null — новое
  let draft = blankDraft();

  const errorBox = el('div', { class: 'rules-error', id: 'rules-error', role: 'alert' });
  const noteBox = el('div', { class: 'rules-note', id: 'rules-note' });

  const rules = () => (Array.isArray(store.model.projectRules) ? store.model.projectRules : []);

  const showError = (msg) => { errorBox.textContent = msg || ''; errorBox.hidden = !msg; };
  const showNote = (msg) => { noteBox.textContent = msg || ''; };

  /* --- список правил ------------------------------------------------- */

  function listView() {
    const box = el('div', { class: 'rules-list', id: 'rules-list' });
    const list = rules();
    if (!list.length) {
      box.append(el('div', { class: 'mini rules-empty', id: 'rules-empty' },
        'Правил проекта пока нет. Правило — это соглашение команды: «домен не зависит от интерфейса», '
        + '«у публичного интерфейса обязательна документация».'));
      return box;
    }
    box.append(el('div', { class: 'mini rules-count', text: `Правил в модели: ${list.length}` }));
    for (const rule of list) {
      const row = el('div', {
        class: 'rules-row',
        'data-rule': rule.id,
        role: 'button',
        tabindex: '0',
        title: 'Изменить правило',
        onclick: () => { edit(rule); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); edit(rule); } },
      },
      el('span', { class: `rules-lvl ${rule.level}`, text: LEVEL_LABEL[rule.level] ?? String(rule.level ?? '?') }),
      el('span', { class: 'rules-name', text: rule.title || rule.id }),
      el('span', { class: 'mono mini', text: rule.id }),
      el('span', { class: 'rules-where mini', text: SCOPE_LABEL[rule.scope] ?? String(rule.scope ?? '') }),
      el('button', {
        type: 'button', class: 'rules-del', 'data-del': rule.id,
        title: 'Удалить правило (отменяется Ctrl+Z)',
        onclick: (e) => { e.stopPropagation(); remove(rule.id); },
      }, '×'));
      box.append(row);
    }
    return box;
  }

  function edit(rule) {
    editingId = String(rule.id ?? '');
    draft = draftOf(rule);
    // Битое правило (его мог написать человек в файле) показывается с ошибкой
    // сразу: иначе форма молча подставила бы «ближайшее понятное» значение, и
    // сохранение незаметно переписало бы правило.
    let problem = '';
    try { validateRule(rule); } catch (e) { problem = e.message; }
    showError(problem);
    showNote(problem ? '' : `Правите правило «${editingId}».`);
    render();
    body.querySelector('#rule-id')?.focus();
  }

  function remove(id) {
    commit(`Удалить правило проекта «${id}»`, (m) => {
      m.projectRules = (Array.isArray(m.projectRules) ? m.projectRules : []).filter((r) => r.id !== id);
      if (!m.projectRules.length) delete m.projectRules;
    });
    if (editingId === id) { editingId = null; draft = blankDraft(); }
    showError('');
    showNote(`Правило «${id}» удалено.`);
    render();
  }

  /* --- форма --------------------------------------------------------- */

  function formView() {
    const form = el('div', { class: 'rules-form', id: 'rules-form' });
    form.append(el('div', { class: 'rules-form-head', id: 'rules-form-head' },
      editingId ? `Правило «${editingId}»` : 'Новое правило'));

    const text = (labelText, key, placeholder, id) => {
      const input = el('input', {
        type: 'text', id, value: draft[key] ?? '', placeholder: placeholder ?? '',
        oninput: (e) => { draft[key] = e.target.value; },
      });
      return el('label', { class: 'rules-field' }, el('span', { text: labelText }), input);
    };

    form.append(text('Имя правила (id)', 'id', 'no-domain-to-ui', 'rule-id'));
    form.append(text('Заголовок', 'title', 'Домен не зависит от интерфейса', 'rule-title'));

    const level = el('select', {
      id: 'rule-level',
      onchange: (e) => { draft.level = e.target.value; },
    }, ...RULE_LEVELS.map((v) => el('option', { value: v, selected: draft.level === v ? true : null }, LEVEL_LABEL[v])));
    form.append(el('label', { class: 'rules-field' }, el('span', { text: 'Уровень' }), level));

    const scope = el('select', {
      id: 'rule-scope',
      onchange: (e) => {
        draft.scope = e.target.value;
        draft.kinds = [];
        // Поля условия зависят от области: старое поле могло стать
        // недопустимым, и оставлять его в форме — значит обещать то, чего
        // валидация не пропустит.
        const allowed = fieldsFor(draft.scope);
        if (!draft.complex) {
          draft.rows = draft.rows.map((r) => ({ ...r, field: allowed.includes(r.field) ? r.field : allowed[0] }));
        }
        render();
      },
    }, ...RULE_SCOPES.map((v) => el('option', { value: v, selected: draft.scope === v ? true : null }, SCOPE_LABEL[v])));
    form.append(el('label', { class: 'rules-field' }, el('span', { text: 'Область' }), scope));

    // Виды — только у element/relationship; у модели их нет.
    if (draft.scope !== 'model') {
      const area = draft.scope;
      const kinds = el('select', {
        id: 'rule-kinds', multiple: true, size: Math.min(8, kindOptions(area).length),
        class: 'rules-kinds',
        onchange: (e) => { draft.kinds = [...e.target.selectedOptions].map((o) => o.value); },
      }, ...kindOptions(area).map(({ kind, label }) => el('option', {
        value: kind, selected: draft.kinds.includes(kind) ? true : null,
      }, label)));
      form.append(el('label', { class: 'rules-field' },
        el('span', { text: area === 'element' ? 'Виды элементов (пусто — все)' : 'Виды связей (пусто — все)' }),
        kinds));
    }

    form.append(conditionView());

    const message = el('textarea', {
      id: 'rule-message', rows: 2, value: draft.message ?? '',
      placeholder: 'Пакет домена зависит от пакета интерфейса',
      oninput: (e) => { draft.message = e.target.value; },
    });
    form.append(el('label', { class: 'rules-field' }, el('span', { text: 'Сообщение замечания' }), message));

    const hint = el('input', {
      type: 'text', id: 'rule-hint', value: draft.hint ?? '',
      placeholder: 'Разверните зависимость или перенесите тип',
      oninput: (e) => { draft.hint = e.target.value; },
    });
    form.append(el('label', { class: 'rules-field' }, el('span', { text: 'Подсказка (необязательно)' }), hint));

    const actions = el('div', { class: 'rules-actions' },
      el('button', {
        type: 'button', class: 'btn on', id: 'rule-save',
        onclick: () => save(),
      }, editingId ? 'Сохранить правило' : 'Добавить правило'),
      el('button', {
        type: 'button', class: 'btn', id: 'rule-reset',
        onclick: () => { editingId = null; draft = blankDraft(); showError(''); showNote(''); render(); },
      }, 'Очистить форму'));
    form.append(actions);
    return form;
  }

  /**
   * Условие: связка и строки «поле · оператор · значение». Всё — списки.
   * Сложное условие из импортированного файла показывается предупреждением:
   * форма не умеет его рисовать, и притворяться, что умеет, — хуже.
   */
  function conditionView() {
    const box = el('div', { class: 'rules-condition', id: 'rule-condition' });
    box.append(el('div', { class: 'rules-field-label', text: 'Условие' }));

    if (draft.scope === 'model') {
      box.append(el('div', { class: 'mini', id: 'rule-condition-none' },
        'У правила уровня модели условия нет: полей модели в DSL нет, замечание одно на всю модель.'));
      return box;
    }

    if (draft.complex) {
      box.append(el('div', { class: 'rules-warn', id: 'rule-condition-complex' },
        'Условие сложной формы (вложенные связки) — форма его не рисует. ',
        el('button', {
          type: 'button', class: 'btn', id: 'rule-condition-simple',
          onclick: () => { draft.complex = null; draft.rows = [{ field: fieldsFor(draft.scope)[0], op: 'eq', value: '' }]; render(); },
        }, 'Заменить простым условием')));
      return box;
    }

    const logic = el('select', {
      id: 'rule-logic',
      onchange: (e) => { draft.logic = e.target.value; },
    }, ...Object.entries(LOGIC_LABEL).map(([v, label]) => el('option', {
      value: v, selected: draft.logic === v ? true : null,
    }, label)));
    box.append(el('label', { class: 'rules-field' }, el('span', { text: 'Связка' }), logic));

    const allowed = fieldsFor(draft.scope);
    draft.rows.forEach((row, i) => {
      const field = el('select', {
        class: 'rule-field', 'data-i': i,
        onchange: (e) => { row.field = e.target.value; },
      }, ...allowed.map((f) => el('option', { value: f, selected: row.field === f ? true : null }, FIELD_LABEL[f] ?? f)));

      const op = el('select', {
        class: 'rule-op', 'data-i': i,
        onchange: (e) => { row.op = e.target.value; render(); },
      }, ...OPERATORS.map((o) => el('option', { value: o, selected: row.op === o ? true : null }, OP_LABEL[o] ?? o)));

      const value = NO_VALUE.has(row.op) ? el('span', { class: 'mini', text: '—' }) : el('input', {
        type: NUMBER_VALUE.has(row.op) ? 'number' : 'text',
        class: 'rule-value', 'data-i': i, value: row.value ?? '',
        placeholder: LIST_VALUE.has(row.op) ? 'a, b, c' : (row.op === 'glob' ? 'domain*' : 'значение'),
        oninput: (e) => { row.value = e.target.value; },
      });

      box.append(el('div', { class: 'rules-row-condition' },
        field, op, value,
        el('button', {
          type: 'button', class: 'rules-del', 'data-drop': i,
          title: 'Убрать условие',
          onclick: () => { draft.rows.splice(i, 1); render(); },
        }, '×')));
    });

    box.append(el('button', {
      type: 'button', class: 'btn', id: 'rule-add-condition',
      onclick: () => {
        draft.rows.push({ field: allowed[0], op: 'eq', value: '' });
        render();
      },
    }, '+ условие'));
    return box;
  }

  /* --- сохранение ---------------------------------------------------- */

  function save() {
    const rule = {
      id: String(draft.id ?? '').trim(),
      title: String(draft.title ?? '').trim() || undefined,
      level: draft.level,
      scope: draft.scope,
      appliesTo: draft.scope === 'element'
        ? { element: draft.kinds }
        : draft.scope === 'relationship' ? { relationship: draft.kinds } : undefined,
      when: whenOf(draft),
      message: String(draft.message ?? '').trim(),
      hint: String(draft.hint ?? '').trim() || undefined,
    };
    // Та же проверка, что у движка: ошибка видна до сохранения, а не в консоли
    // после перезагрузки.
    let cleanRule;
    try {
      cleanRule = validateRule(rule);
    } catch (e) {
      showError(e.message);
      return;
    }
    const list = rules();
    const clash = list.find((r) => r.id === cleanRule.id && r.id !== editingId);
    if (clash) { showError(`правило «${cleanRule.id}» уже есть — выберите другое имя`); return; }

    const stored = canonicalRule(cleanRule);
    commit(`Правило проекта «${stored.id}»`, (m) => {
      const next = Array.isArray(m.projectRules) ? m.projectRules.slice() : [];
      const at = editingId == null ? -1 : next.findIndex((r) => r.id === editingId);
      if (at >= 0) next[at] = stored;
      else next.push(stored);
      m.projectRules = next;
    });
    showError('');
    showNote(`Правило «${stored.id}» сохранено в модели.`);
    editingId = String(stored.id);
    draft = draftOf(stored);
    render();
  }

  /* --- экспорт и импорт ---------------------------------------------- */

  function exportRules() {
    const list = rules().map(canonicalRule);
    if (!list.length) { showError('экспортировать нечего: в модели нет правил проекта'); return; }
    const name = `${slugify(store.model.name || 'model')}.rules.json`;
    downloadText(toRulesFile(list), name, 'application/json');
    showError('');
    showNote(`Экспортировано правил: ${list.length} → ${name}`);
  }

  async function importFile(file) {
    try {
      const imported = fromRulesFile(await file.text());
      // Слияние по id: одноимённое правило заменяется, новое добавляется.
      // Заменить весь список значило бы стереть правила, которых нет в файле,
      // без спроса.
      let added = 0;
      let replaced = 0;
      commit('Импорт правил проекта', (m) => {
        const next = Array.isArray(m.projectRules) ? m.projectRules.slice() : [];
        for (const rule of imported) {
          const at = next.findIndex((r) => r.id === rule.id);
          if (at >= 0) { next[at] = canonicalRule(rule); replaced += 1; } else { next.push(canonicalRule(rule)); added += 1; }
        }
        m.projectRules = next;
      });
      showError('');
      showNote(`Импортировано: ${imported.length} (новых ${added}, заменено ${replaced}).`);
    } catch (e) {
      showError(e.message);
    }
    render();
  }

  /* --- сборка диалога ------------------------------------------------ */

  function render() {
    clear(body);
    const list = listView();
    const form = formView();
    const file = el('input', {
      type: 'file', accept: '.json,application/json', id: 'rules-import', hidden: true,
      onchange: (e) => { const f = e.target.files?.[0]; if (f) importFile(f); },
    });
    const foot = el('div', { class: 'rules-foot' },
      el('button', {
        type: 'button', class: 'btn', id: 'rules-export', title: 'Сохранить правила в файл .rules.json',
        onclick: () => exportRules(),
      }, 'Экспорт .rules.json'),
      el('button', {
        type: 'button', class: 'btn', id: 'rules-import-btn',
        title: 'Добавить правила из файла .rules.json: одноимённые заменяются',
        onclick: () => file.click(),
      }, 'Импорт…'),
      file);
    body.append(
      el('div', { class: 'mini rules-intro' },
        'Правила проекта — соглашения команды, а не требования стандарта UML 2.5.1. '
        + 'Они хранятся в файле модели и переезжают вместе с ним.'),
      list, form, errorBox, noteBox, foot);
  }

  showError('');
  render();
  return ScDialog.open({
    heading: 'Правила проекта',
    body,
    buttons: [{ id: 'close', label: 'Закрыть', kind: 'primary' }],
  });
}
