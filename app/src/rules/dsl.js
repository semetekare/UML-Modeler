// DSL правил проекта: формат правила, белый список полей, операторы, проверка.
//
// Правило проекта пишет человек в файле модели, без кода. Значит, у DSL две
// обязанности, и обе важнее выразительности:
//
//   * ничего не исполнять. Здесь нет `eval`, нет `new Function` и нет
//     регулярных выражений: строка `glob` сравнивается двумя указателями
//     (`globMatch`), поэтому ReDoS неоткуда взяться, а файл правил можно
//     открыть без страха;
//   * не молчать. Неизвестное поле, оператор или связка — это НЕ «правило
//     ничего не нашло» (человек искал бы дефект в модели), а ошибка загрузки с
//     именем правила. Опечатка `owner.nam` обязана назвать себя.
//
// Поэтому `validateRule` — отдельная функция: её же зовёт редактор, чтобы
// показать ошибку до сохранения, и движок, чтобы отказаться собирать правило.
// Формат канонизируется здесь же: порядок ключей правила фиксирован, иначе
// побайтовый круг «сохранить → открыть → сохранить» поехал бы от одной
// перестановки полей в форме.
//
// Поля — только те, что есть в модели. Белый список не «на всякий случай
// узкий»: `documentation.empty` считается из документации, `incoming` и
// `outgoing` — из связей, а `owner.name` и `owner.kind` — из владельца. Всё
// это вычисляется в `project.js`; здесь лежит только перечень имён.

import { NOTATION } from '../model/notation.js';

/** Схема файла правил — та же строка, что в шапке экспорта (приложение C). */
export const RULES_SCHEMA = 'uml-project-rules/1';

/** Уровни те же, что у стандарта: третий слой не изобретает свою строгость. */
export const RULE_LEVELS = ['error', 'warning'];

/** Область: по элементам, по связям или по модели целиком. */
export const RULE_SCOPES = ['element', 'relationship', 'model'];

/** Глубже пяти уровней вложенности условие не читается человеком. */
export const MAX_WHEN_DEPTH = 5;

export const OPERATORS = ['eq', 'ne', 'in', 'notIn', 'glob', 'exists', 'empty', 'notEmpty', 'gt', 'lt', 'ge', 'le'];

/**
 * Поля элемента. `visibility` — не поле нотации, а необязательное поле файла
 * (умлjson сохраняет незнакомые поля как есть): правило на нём сработает
 * только там, где файл его несёт, и это честнее, чем выдумывать видимость из
 * членов класса.
 */
export const ELEMENT_FIELDS = [
  'kind', 'name', 'stereotype', 'owner.name', 'owner.kind', 'visibility',
  'documentation.empty', 'incoming', 'outgoing',
];

/** Поля связи: концы и кратности. Имени и стереотипа у связи в DSL нет — по заданию. */
export const RELATIONSHIP_FIELDS = [
  'kind', 'from.name', 'from.kind', 'to.name', 'to.kind',
  'fromMultiplicity', 'toMultiplicity', 'documentation.empty',
];

/**
 * У модели нет полей из белого списка: правило уровня модели срабатывает
 * один раз и виноватого не называет. Придумывать «поля модели» значило бы
 * расширять DSL без нужды — условие у такого правила просто не задаётся.
 */
export const MODEL_FIELDS = [];

export const FIELDS = {
  element: new Set(ELEMENT_FIELDS),
  relationship: new Set(RELATIONSHIP_FIELDS),
  model: new Set(MODEL_FIELDS),
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : String(v));

/** Сообщение об ошибке всегда начинается с имени правила — иначе непонятно, какое. */
const fail = (id, msg) => {
  throw new Error(`${id ? `правило «${id}»` : 'правило проекта'}: ${msg}`);
};

/**
 * Проверить правило и вернуть его нормализованную копию.
 *
 * Бросает `Error` с именем правила: неизвестное поле, неизвестный оператор,
 * неизвестная связка, пустой id, отсутствие message, чужой уровень, условие у
 * правила уровня модели, глубина больше пяти.
 */
export function validateRule(rule) {
  if (!isObj(rule)) fail('', 'правило — не объект');
  const id = str(rule.id).trim();
  if (!id) fail('', 'нет id: без имени правило нельзя ни назвать, ни выключить');

  if (!RULE_LEVELS.includes(rule.level)) {
    fail(id, `уровень «${str(rule.level)}» — не error и не warning`);
  }
  if (!RULE_SCOPES.includes(rule.scope)) {
    fail(id, `область «${str(rule.scope)}» — не element, не relationship и не model`);
  }
  const message = str(rule.message).trim();
  if (!message) fail(id, 'нет message: замечание без текста человеку ничего не скажет');

  const appliesTo = validateAppliesTo(rule.appliesTo, rule.scope, id);
  const when = validateWhen(rule.when, rule.scope, id);
  return { ...rule, id, message, appliesTo, when };
}

/** Виды из `appliesTo`: только существующие в нотации, только своей области. */
function validateAppliesTo(raw, scope, id) {
  if (raw == null) return {};
  if (!isObj(raw)) fail(id, 'appliesTo — не объект');
  const extra = Object.keys(raw).filter((k) => k !== 'element' && k !== 'relationship');
  if (extra.length) fail(id, `неизвестный ключ appliesTo «${extra[0]}»`);
  if (scope === 'model' && (raw.element?.length || raw.relationship?.length)) {
    fail(id, 'у правила уровня модели не бывает appliesTo: оно срабатывает один раз на модель');
  }
  if (scope === 'element' && raw.relationship?.length) {
    fail(id, 'правило по элементам не может ограничивать виды связей (appliesTo.relationship)');
  }
  if (scope === 'relationship' && raw.element?.length) {
    fail(id, 'правило по связям не может ограничивать виды элементов (appliesTo.element)');
  }
  const out = {};
  const table = { element: NOTATION.shapes, relationship: NOTATION.connectors };
  for (const area of ['element', 'relationship']) {
    const list = raw[area];
    if (list == null) continue;
    if (!Array.isArray(list)) fail(id, `appliesTo.${area} — не список видов`);
    const kinds = [];
    for (const kind of list) {
      const k = str(kind).trim();
      if (!k) continue;
      // Нотация — данные: без неё сверять вид не с чем, и молча пропустить
      // опечатку хуже, чем сказать об этом.
      if (!Object.keys(table[area]).length) fail(id, 'нотация не загружена — вид не с чем сверить');
      if (!table[area][k]) {
        fail(id, `неизвестный вид ${area === 'element' ? 'элемента' : 'связи'} «${k}»`);
      }
      if (!kinds.includes(k)) kinds.push(k);
    }
    if (kinds.length) out[area] = kinds;
  }
  return out;
}

/** Условие: `undefined` — правило без условия (срабатывает на всех). */
function validateWhen(raw, scope, id) {
  if (raw == null) return undefined;
  if (scope === 'model') {
    fail(id, 'у правила уровня модели не бывает условия: полей модели в DSL нет');
  }
  return normalizeWhen(raw, scope, id, 1);
}

/**
 * Нормализация узла условия: `{all|any|not}` или лист `{field, op, value}`.
 * Глубина считается от единицы; шестой уровень — ошибка.
 */
function normalizeWhen(node, scope, id, depth) {
  if (depth > MAX_WHEN_DEPTH) fail(id, `условие вложено глубже ${MAX_WHEN_DEPTH} уровней`);
  if (!isObj(node)) fail(id, 'условие — не объект');
  const keys = Object.keys(node);
  const logic = keys.filter((k) => k === 'all' || k === 'any' || k === 'not');

  if (logic.length) {
    // Две связки рядом (`all` и `any`) — не «оба», а неоднозначность: какая
    // из них главная, знает только автор правила.
    if (keys.length > 1) fail(id, `в условии рядом стоят «${keys.join('», «')}» — нужна ровно одна связка`);
    const k = logic[0];
    if (k === 'not') return { not: normalizeWhen(node.not, scope, id, depth + 1) };
    const list = node[k];
    if (!Array.isArray(list) || !list.length) fail(id, `«${k}» — пустой список условий`);
    return { [k]: list.map((c) => normalizeWhen(c, scope, id, depth + 1)) };
  }

  const extra = keys.filter((k) => k !== 'field' && k !== 'op' && k !== 'value');
  if (extra.length) fail(id, `неизвестный ключ условия «${extra[0]}»`);

  const field = str(node.field);
  if (!field) fail(id, 'в условии нет field');
  if (!FIELDS[scope].has(field)) {
    fail(id, `неизвестное поле «${field}» — можно: ${[...FIELDS[scope]].join(', ')}`);
  }
  const op = str(node.op);
  if (!OPERATORS.includes(op)) {
    fail(id, `неизвестный оператор «${op}» — можно: ${OPERATORS.join(', ')}`);
  }

  const has = Object.prototype.hasOwnProperty.call(node, 'value');
  if (op === 'in' || op === 'notIn') {
    if (!Array.isArray(node.value) || !node.value.length) fail(id, `у оператора «${op}» значение — непустой список`);
  } else if (op === 'gt' || op === 'lt' || op === 'ge' || op === 'le') {
    if (!has || node.value === '' || node.value == null || !Number.isFinite(Number(node.value))) {
      fail(id, `у оператора «${op}» значение — число`);
    }
  } else if (op === 'eq' || op === 'ne') {
    if (!has || node.value == null || typeof node.value === 'object') {
      fail(id, `у оператора «${op}» значение — строка, число или true/false`);
    }
  } else if (op === 'glob') {
    if (!has || typeof node.value !== 'string') fail(id, 'у оператора «glob» значение — строка с * и ?');
  } else if (has) {
    // `empty`, `notEmpty`, `exists` значения не имеют: приписанное — опечатка
    // формы, и тихо его игнорировать значит оставить человека с мыслью, что
    // правило сравнивает с чем-то.
    fail(id, `у оператора «${op}» не бывает значения`);
  }
  return has ? { field, op, value: node.value } : { field, op };
}

/**
 * Сравнение строки с шаблоном `*` и `?` — без регулярных выражений.
 *
 * Классический алгоритм с одним откатом: указатель шаблона идёт вперёд, а
 * последняя `*` запоминает место, куда можно вернуться. Время — O(n·m) в
 * худшем случае, но ни катастрофического отката, ни компиляции шаблона нет:
 * файл правил не может подвесить проверку.
 */
export function globMatch(pattern, text) {
  const p = String(pattern);
  const t = String(text);
  let pi = 0;
  let ti = 0;
  let star = -1;
  let mark = 0;
  while (ti < t.length) {
    if (pi < p.length && (p[pi] === '?' || p[pi] === t[ti])) { pi += 1; ti += 1; }
    else if (pi < p.length && p[pi] === '*') { star = pi; pi += 1; mark = ti; }
    else if (star >= 0) { pi = star + 1; mark += 1; ti = mark; }
    else return false;
  }
  while (pi < p.length && p[pi] === '*') pi += 1;
  return pi === p.length;
}

/* --------------------------------------------------------- вычисление */

/*
 * Условие превращается в функцию один раз при загрузке правила, а не на
 * каждом элементе: `compileWhen` вызывается из `project.js`, контекст строит
 * он же. Здесь — только семантика операторов, общая для всех правил.
 *
 * Сравнение `eq`/`ne` — по строковому виду: `0`, `false` и `"0"` в файле
 * правила и в модели должны значить одно и то же, иначе человек, написавший
 * `"value": 0`, не понял бы, почему правило молчит. Числовые операторы
 * отдельны: пустая кратность — не ноль, и `lt 1` на ней ложно.
 */

const same = (a, b) => str(a) === str(b);
const isBlank = (v) => v == null || (Array.isArray(v) ? !v.length : String(v).trim() === '');

export function compileWhen(when) {
  if (when === undefined) return () => true;
  return compileNode(when);
}

function compileNode(node) {
  if (node.all) {
    const parts = node.all.map(compileNode);
    return (ctx) => parts.every((p) => p(ctx));
  }
  if (node.any) {
    const parts = node.any.map(compileNode);
    return (ctx) => parts.some((p) => p(ctx));
  }
  if (node.not) {
    const inner = compileNode(node.not);
    return (ctx) => !inner(ctx);
  }
  const { field, op } = node;
  const want = node.value;
  switch (op) {
    case 'eq': return (ctx) => same(ctx[field], want);
    case 'ne': return (ctx) => !same(ctx[field], want);
    case 'in': return (ctx) => want.some((v) => same(ctx[field], v));
    case 'notIn': return (ctx) => !want.some((v) => same(ctx[field], v));
    case 'glob': return (ctx) => globMatch(want, str(ctx[field]));
    // `exists` — «поле вообще есть»: у связи без конца `from.name` — null.
    case 'exists': return (ctx) => ctx[field] != null;
    case 'empty': return (ctx) => isBlank(ctx[field]);
    case 'notEmpty': return (ctx) => !isBlank(ctx[field]);
    default: {
      const n = Number(want);
      const num = (ctx) => {
        const v = ctx[field];
        if (v == null || v === '') return null;
        const x = Number(v);
        return Number.isFinite(x) ? x : null;
      };
      if (op === 'gt') return (ctx) => { const v = num(ctx); return v != null && v > n; };
      if (op === 'lt') return (ctx) => { const v = num(ctx); return v != null && v < n; };
      if (op === 'ge') return (ctx) => { const v = num(ctx); return v != null && v >= n; };
      return (ctx) => { const v = num(ctx); return v != null && v <= n; };
    }
  }
}

/* ------------------------------------------------------------ канонизация */

/*
 * Порядок ключей правила фиксирован: id, title, level, scope, appliesTo, when,
 * message, hint. Без этого одна перестановка полей в форме меняла бы байты
 * файла, а побайтовый круг «сохранить → открыть → сохранить» — единственная
 * проверка, которая ловит потерю данных при чтении.
 *
 * Канонизация НЕ проверяет правило: битое правило из файла должно доехать до
 * редактора, чтобы человек увидел и починил его, а не потерял при открытии.
 */

const canonicalWhen = (w) => {
  if (w == null) return undefined;
  if (!isObj(w)) return w;
  if (Array.isArray(w.all)) return { all: w.all.map(canonicalWhen) };
  if (Array.isArray(w.any)) return { any: w.any.map(canonicalWhen) };
  if (w.not !== undefined) return { not: canonicalWhen(w.not) };
  if (w.field !== undefined || w.op !== undefined) {
    return clean({
      field: w.field == null ? undefined : str(w.field),
      op: w.op == null ? undefined : str(w.op),
      value: w.value,
      ...extras(w, ['field', 'op', 'value']),
    });
  }
  return w;
};

const canonicalAppliesTo = (a) => {
  if (!isObj(a)) return undefined;
  const out = clean({
    element: Array.isArray(a.element) && a.element.length ? a.element.map(str) : undefined,
    relationship: Array.isArray(a.relationship) && a.relationship.length ? a.relationship.map(str) : undefined,
    ...extras(a, ['element', 'relationship']),
  });
  return Object.keys(out).length ? out : undefined;
};

/** Одно правило в том порядке ключей, в каком оно пишется в файл модели. */
export const canonicalRule = (r) => {
  if (!isObj(r)) return r;
  return clean({
    id: r.id == null ? undefined : str(r.id),
    title: r.title == null ? undefined : str(r.title),
    level: r.level == null ? undefined : str(r.level),
    scope: r.scope == null ? undefined : str(r.scope),
    appliesTo: canonicalAppliesTo(r.appliesTo),
    when: canonicalWhen(r.when),
    message: r.message == null ? undefined : str(r.message),
    hint: r.hint == null ? undefined : str(r.hint),
    ...extras(r, ['id', 'title', 'level', 'scope', 'appliesTo', 'when', 'message', 'hint']),
  });
};

/**
 * Список правил для файла модели: пустой список — это ОТСУТСТВИЕ поля.
 * Модель без правил обязана сохраняться байт в байт, поэтому `undefined`, а
 * не `[]`: `clean` в `umljson.js` тогда просто не пишет ключ.
 */
export const canonicalProjectRules = (list) => {
  const rules = (Array.isArray(list) ? list : []).filter(isObj).map(canonicalRule);
  return rules.length ? rules : undefined;
};

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const extras = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/* ------------------------------------------------------ файл правил (.json) */

/** Файл экспорта: обёртка со схемой и правилами — как в приложении C. */
export function toRulesFile(rules) {
  const list = (Array.isArray(rules) ? rules : []).map(canonicalRule);
  return `${JSON.stringify({ schema: RULES_SCHEMA, rules: list }, null, 2)}\n`;
}

/**
 * Прочитать файл правил. Каждое правило проверяется тем же `validateRule`:
 * импорт битого файла обязан назвать правило и строку, а не принять половину.
 */
export function fromRulesFile(text) {
  let raw;
  try {
    raw = JSON.parse(String(text ?? ''));
  } catch (e) {
    throw new Error(`файл правил не разобрался как JSON: ${e.message}`);
  }
  if (!isObj(raw)) throw new Error('файл правил — не объект');
  if (raw.schema !== RULES_SCHEMA) {
    throw new Error(`это не файл правил проекта: schema «${str(raw.schema)}», нужна «${RULES_SCHEMA}»`);
  }
  if (!Array.isArray(raw.rules)) throw new Error('в файле правил нет списка rules');
  return raw.rules.map((rule, i) => {
    try {
      return validateRule(rule);
    } catch (e) {
      throw new Error(`строка ${i + 1}: ${e.message}`);
    }
  });
}
