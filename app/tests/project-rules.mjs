// Третий слой правил — правила ПРОЕКТА: DSL, движок, хранение.
//
// Проверяется то, чего не видно в браузере:
//
//   * DSL берёт только поля из белого списка и только известные операторы;
//     неизвестное — ошибка загрузки с ИМЕНЕМ правила, а не тихое «ничего не
//     нашло» (иначе человек искал бы дефект в модели);
//   * `glob` — это `*` и `?`, а не регулярное выражение: точка в шаблоне
//     остаётся точкой;
//   * правило проекта не притворяется стандартом: `basis: 'project'`,
//     `clause === null`, `constraint === null`, `rationale === null`;
//   * сбой одного правила проекта не роняет прогон — запись `status: 'failed'`
//     через `failure()`, остальные замечания на месте;
//   * модель без правил сохраняется байт в байт (эталон old-v3.json), а модель
//     с правилами держит круг «сохранить → открыть → сохранить»;
//   * старые вызовы `createRuleset(pkg)` и `createRuleset(pkg, { practice })`
//     работают как раньше.
//
//   node tests/project-rules.mjs
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

/** Ожидание исключения: и факт, и текст важны — ошибка обязана называть правило. */
function throws(fn, re, what) {
  try {
    fn();
  } catch (e) {
    assert(re.test(e.message), `${what}: в ошибке нет «${re}» — «${e.message}»`);
    return e.message;
  }
  throw new Error(`${what}: ошибки не было`);
}

const load = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// Грабля проекта: без загруженной нотации `deserialize` подменяет `kind`.
const { applyPackage } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8')));

const { deserialize, serialize } = await load('src/io/umljson.js');
const { createRuleset } = await load('src/rules/engine.js');
const { countByLevel } = await load('src/rules/finding.js');
const { compileProjectRule } = await load('src/rules/project.js');
const {
  validateRule, globMatch, toRulesFile, fromRulesFile, canonicalRule,
  ELEMENT_FIELDS, RELATIONSHIP_FIELDS, OPERATORS, RULES_SCHEMA,
} = await load('src/rules/dsl.js');

const PKG = JSON.parse(await readFile(path.join(ROOT, 'notation/rules/uml-2.5.1.json'), 'utf8'));
const PRACTICE = JSON.parse(await readFile(path.join(ROOT, 'notation/rules/practice.json'), 'utf8'));

/* ------------------------------------------------------------- модели */

/**
 * Модель под пять примеров: два пакета (домен и интерфейс), три класса, один
 * интерфейс и один класс-сирота без документации. Каждая связь стоит здесь
 * ради одного правила, поэтому ожидаемые id видно глазами.
 */
const baseModel = () => ({
  schema: 'uml-model/3',
  id: 'm-project',
  name: 'Модель правил проекта',
  elements: [
    { id: 'p1', kind: 'package', name: 'domain' },
    { id: 'p2', kind: 'package', name: 'ui' },
    { id: 'c1', kind: 'class', name: 'Заказ', ownerId: 'p1', documentation: 'Заказ клиента' },
    { id: 'c2', kind: 'class', name: 'Клиент', ownerId: 'p1', documentation: 'Клиент' },
    { id: 'c3', kind: 'class', name: 'Окно', ownerId: 'p2', documentation: 'Окно' },
    { id: 'c4', kind: 'interface', name: 'Оплата', ownerId: 'p1' },
    { id: 'c5', kind: 'class', name: 'Одинокий', ownerId: 'p1' },
  ],
  relationships: [
    { id: 'r1', kind: 'dependency', from: 'c2', to: 'c3' },
    { id: 'r2', kind: 'association', from: 'c1', to: 'c2', fromMultiplicity: '1', toMultiplicity: '*' },
    { id: 'r3', kind: 'association', from: 'c2', to: 'c4', fromMultiplicity: '1' },
  ],
  diagrams: [{ id: 'd1', name: 'Диаграмма 1', kind: 'class', shapes: [], links: [] }],
  currentDiagramId: 'd1',
});

/**
 * Пять примеров — по одному на случай: `eq` с булевым полем, `any` + `empty`,
 * `in` по виду конца, счётчики степеней и снова `eq` по документации.
 * Уровни разные нарочно: слой проекта не «всегда предупреждение».
 */
const FIVE = [
  {
    id: 'no-domain-to-ui', title: 'Домен не зависит от интерфейса', level: 'warning',
    scope: 'relationship', appliesTo: { relationship: ['dependency'] },
    when: { all: [
      { field: 'from.name', op: 'glob', value: 'Кл*' },
      { field: 'to.kind', op: 'in', value: ['class'] },
    ] },
    message: 'Пакет домена зависит от класса интерфейса', hint: 'Разверните зависимость',
  },
  {
    id: 'class-documented', title: 'У класса есть документация', level: 'warning',
    scope: 'element', appliesTo: { element: ['class'] },
    when: { all: [{ field: 'documentation.empty', op: 'eq', value: true }] },
    message: 'У класса нет документации', hint: 'Опишите назначение класса',
  },
  {
    id: 'association-ends', title: 'У ассоциации кратность на обоих концах', level: 'error',
    scope: 'relationship', appliesTo: { relationship: ['association'] },
    when: { any: [
      { field: 'fromMultiplicity', op: 'empty' },
      { field: 'toMultiplicity', op: 'empty' },
    ] },
    message: 'У ассоциации не задана кратность конца', hint: 'Поставьте кратность',
  },
  {
    id: 'class-connected', title: 'Класс участвует в связях', level: 'warning',
    scope: 'element', appliesTo: { element: ['class'] },
    when: { all: [
      { field: 'incoming', op: 'eq', value: 0 },
      { field: 'outgoing', op: 'eq', value: 0 },
    ] },
    message: 'Класс ни с чем не связан', hint: 'Свяжите класс или уберите его',
  },
  {
    id: 'interface-documented', title: 'У интерфейса есть документация', level: 'error',
    scope: 'element', appliesTo: { element: ['interface'] },
    when: { all: [{ field: 'documentation.empty', op: 'eq', value: true }] },
    message: 'У интерфейса нет документации', hint: 'Опишите контракт',
  },
];

/** Ожидаемые виноватые по пяти правилам — ровно по одному на правило. */
const FIVE_HITS = {
  'no-domain-to-ui': ['r1'],
  'class-documented': ['c5'],
  'association-ends': ['r3'],
  'class-connected': ['c5'],
  'interface-documented': ['c4'],
};

const hitsOf = (findings) => Object.fromEntries(
  findings.map((f) => [f.ruleId, f.targets]),
);

const compile = (rule) => compileProjectRule(rule);
const runRule = (rule, model) => compile(rule)(model, rule);

/* ---------------------------------------------------------------- DSL */

await check('DSL: белый список полей и операторов совпадает с заданием', async () => {
  const element = ELEMENT_FIELDS.join(',');
  const relationship = RELATIONSHIP_FIELDS.join(',');
  assert(element === 'kind,name,stereotype,owner.name,owner.kind,visibility,documentation.empty,incoming,outgoing',
    `поля элемента: ${element}`);
  assert(relationship === 'kind,from.name,from.kind,to.name,to.kind,fromMultiplicity,toMultiplicity,documentation.empty',
    `поля связи: ${relationship}`);
  assert(OPERATORS.length === 12, `операторов ${OPERATORS.length}, а не 12`);
  return `${ELEMENT_FIELDS.length} полей элемента, ${RELATIONSHIP_FIELDS.length} — связи, ${OPERATORS.length} операторов`;
});

await check('DSL: glob — это * и ?, а не регулярное выражение', async () => {
  assert(globMatch('*', 'что угодно'), '* не совпал ни с чем');
  assert(globMatch('domain*', 'domain.ui'), 'domain* не совпал с domain.ui');
  assert(!globMatch('domain*', 'ui.domain'), 'domain* совпал с ui.domain');
  assert(globMatch('?', 'a') && !globMatch('?', 'ab'), '? не ровно один символ');
  assert(globMatch('a*b*c', 'aXXbYYc'), 'a*b*c не совпал');
  // Точка в шаблоне — точка, а не «любой символ»: регулярного выражения нет.
  assert(globMatch('a.b', 'a.b') && !globMatch('a.b', 'axb'), 'точка в шаблоне ведёт себя как в regex');
  assert(!globMatch('*a*a*a*b', 'a'.repeat(40)), 'шаблон совпал с тем, чего в нём нет');
  return 'пять шаблонов, точка литеральна';
});

await check('DSL: пять примеров правил проходят проверку и дают ровно свои замечания', async () => {
  const model = baseModel();
  const hits = hitsOf(FIVE.map((r) => runRule(r, model)).flat());
  for (const rule of FIVE) {
    const got = hits[rule.id] ?? [];
    const want = FIVE_HITS[rule.id];
    assert(JSON.stringify(got) === JSON.stringify(want),
      `правило «${rule.id}»: ожидались ${want.join('+') || '—'}, получены ${got.join('+') || '—'}`);
  }
  const total = FIVE.map((r) => runRule(r, model)).flat().length;
  assert(total === 5, `пять правил дали ${total} замечаний, а не 5`);
  return '5 правил × по одному замечанию, цели совпали';
});

await check('DSL: каждый оператор даёт ожидаемые цели', async () => {
  const model = baseModel();
  const cases = [
    // [правило, ожидаемые id]
    [{ id: 'ne', scope: 'relationship', appliesTo: { relationship: ['association'] },
      when: { all: [{ field: 'toMultiplicity', op: 'ne', value: '*' }] } }, ['r3']],
    [{ id: 'notIn', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'kind', op: 'notIn', value: ['interface', 'package'] }] } },
    ['c1', 'c2', 'c3', 'c5']],
    [{ id: 'glob', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'name', op: 'glob', value: 'За*' }] } }, ['c1']],
    [{ id: 'exists', scope: 'element',
      when: { all: [{ field: 'owner.name', op: 'exists' }] } }, ['c1', 'c2', 'c3', 'c4', 'c5']],
    [{ id: 'notEmpty', scope: 'relationship', appliesTo: { relationship: ['association'] },
      when: { all: [{ field: 'fromMultiplicity', op: 'notEmpty' }] } }, ['r2', 'r3']],
    [{ id: 'gt', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'incoming', op: 'gt', value: 0 }] } }, ['c2', 'c3']],
    [{ id: 'lt', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'outgoing', op: 'lt', value: 1 }] } }, ['c3', 'c5']],
    [{ id: 'ge', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'incoming', op: 'ge', value: 1 }] } }, ['c2', 'c3']],
    [{ id: 'le', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'outgoing', op: 'le', value: 1 }] } }, ['c1', 'c3', 'c5']],
    [{ id: 'not', scope: 'element', appliesTo: { element: ['class'] },
      when: { not: { all: [{ field: 'documentation.empty', op: 'eq', value: false }] } } }, ['c5']],
    [{ id: 'owner-kind', scope: 'element', appliesTo: { element: ['class'] },
      when: { all: [{ field: 'owner.kind', op: 'eq', value: 'package' }] } }, ['c1', 'c2', 'c3', 'c5']],
  ];
  const bad = [];
  for (const [rule, want] of cases) {
    const full = { ...rule, title: rule.id, level: 'warning', message: `правило ${rule.id}` };
    const got = runRule(full, model).map((f) => f.targets[0]);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${rule.id}: ${got.join('+') || '—'} вместо ${want.join('+')}`);
  }
  assert(!bad.length, bad.join('; '));
  return `${cases.length} операторов, цели совпали`;
});

await check('DSL: пустая кратность — не ноль, сравнение с ней ложно', async () => {
  // У r3 нет `toMultiplicity`: `lt 1` на пустом значении молчит, иначе пустая
  // кратность считалась бы нулём и правило врало бы о модели.
  const model = baseModel();
  const rule = {
    id: 'mult-lt', title: 'кратность меньше единицы', level: 'warning', scope: 'relationship',
    appliesTo: { relationship: ['association'] },
    when: { all: [{ field: 'toMultiplicity', op: 'lt', value: 1 }] },
    message: 'кратность меньше единицы',
  };
  const got = runRule(rule, model).map((f) => f.targets[0]);
  // Ожидание: r3 (пустая кратность) не попадает, а r2 ('*') — тоже: '*' не число.
  assert(got.length === 0, `получены ${got.join('+') || '—'}`);
  return 'пустое значение и «*» не число — молчание';
});

await check('DSL: вложенность до 5 уровней, шестой — ошибка', async () => {
  const leaf = { field: 'name', op: 'empty' };
  const wrap = (n) => { let node = leaf; for (let i = 1; i < n; i++) node = { all: [node] }; return node; };
  const base = { id: 'deep', level: 'warning', scope: 'element', message: 'глубина' };
  validateRule({ ...base, when: wrap(5) });
  throws(() => validateRule({ ...base, when: wrap(6) }), /правило «deep»: условие вложено глубже 5 уровней/, 'шестой уровень');
  return '5 — можно, 6 — отказ с именем правила';
});

/* ------------------------------------------------------- отказ загрузки */

const BROKEN = [
  ['неизвестное поле', { id: 'bad-field', scope: 'element', message: 'm', level: 'warning',
    when: { all: [{ field: 'owner.nam', op: 'eq', value: 'x' }] } }, /правило «bad-field»: неизвестное поле «owner\.nam»/],
  ['неизвестный оператор', { id: 'bad-op', scope: 'element', message: 'm', level: 'warning',
    when: { all: [{ field: 'name', op: 'like', value: 'x' }] } }, /правило «bad-op»: неизвестный оператор «like»/],
  ['пустой id', { id: '  ', scope: 'element', message: 'm', level: 'warning' }, /правило проекта: нет id/],
  ['неизвестная связка', { id: 'bad-logic', scope: 'element', message: 'm', level: 'warning',
    when: { some: [{ field: 'name', op: 'empty' }] } }, /правило «bad-logic»: неизвестный ключ условия «some»/],
  ['две связки рядом', { id: 'two-logic', scope: 'element', message: 'm', level: 'warning',
    when: { all: [{ field: 'name', op: 'empty' }], any: [{ field: 'name', op: 'empty' }] } },
  /правило «two-logic»: в условии рядом стоят/],
  ['нет message', { id: 'no-message', scope: 'element', level: 'warning' }, /правило «no-message»: нет message/],
  ['чужой уровень', { id: 'bad-level', scope: 'element', message: 'm', level: 'info' }, /правило «bad-level»: уровень «info»/],
  ['чужая область', { id: 'bad-scope', scope: 'package', message: 'm', level: 'warning' }, /правило «bad-scope»: область «package»/],
  ['поле чужой области', { id: 'rel-name', scope: 'relationship', message: 'm', level: 'warning',
    when: { all: [{ field: 'name', op: 'empty' }] } }, /правило «rel-name»: неизвестное поле «name»/],
  ['неизвестный вид', { id: 'bad-kind', scope: 'element', message: 'm', level: 'warning',
    appliesTo: { element: ['clas'] }, when: { all: [{ field: 'name', op: 'empty' }] } },
  /правило «bad-kind»: неизвестный вид элемента «clas»/],
  ['условие у правила модели', { id: 'model-when', scope: 'model', message: 'm', level: 'warning',
    when: { all: [{ field: 'name', op: 'empty' }] } }, /правило «model-when»: у правила уровня модели не бывает условия/],
  ['значение у empty', { id: 'empty-value', scope: 'element', message: 'm', level: 'warning',
    when: { all: [{ field: 'name', op: 'empty', value: 'x' }] } }, /правило «empty-value»: у оператора «empty» не бывает значения/],
  ['не число у gt', { id: 'gt-text', scope: 'element', message: 'm', level: 'warning',
    when: { all: [{ field: 'incoming', op: 'gt', value: 'много' }] } }, /правило «gt-text»: у оператора «gt» значение — число/],
  ['не список у in', { id: 'in-scalar', scope: 'element', message: 'm', level: 'warning',
    when: { all: [{ field: 'kind', op: 'in', value: 'class' }] } }, /правило «in-scalar»: у оператора «in» значение — непустой список/],
];

await check('битое правило: ошибка загрузки с именем правила (14 случаев)', async () => {
  const bad = [];
  for (const [what, rule, re] of BROKEN) {
    try {
      throws(() => validateRule(rule), re, what);
    } catch (e) {
      bad.push(`${what}: ${e.message}`);
    }
  }
  assert(!bad.length, bad.join('; '));
  return BROKEN.map(([w]) => w).join(', ');
});

await check('битое правило в наборе: createRuleset отказывается с его именем', async () => {
  const bad = BROKEN.find(([w]) => w === 'неизвестное поле')[1];
  throws(() => createRuleset(PKG, { project: [bad] }), /правило «bad-field»: неизвестное поле «owner\.nam»/, 'набор проекта');
  throws(() => createRuleset(PKG, { project: [null] }), /правило №1 в слое «проект» — не объект/, 'не объект');
  const noId = { ...FIVE[0], id: '' };
  throws(() => createRuleset(PKG, { project: [noId] }), /правило №1 в слое «проект» без id/, 'без id');
  return 'три отказа: поле, не объект, пустой id';
});

await check('файл .rules.json: схема обязательна, битая строка названа', async () => {
  const text = toRulesFile(FIVE);
  const parsed = JSON.parse(text);
  assert(parsed.schema === RULES_SCHEMA && parsed.rules.length === 5, 'экспорт не той схемы');
  const back = fromRulesFile(text);
  assert(back.length === 5 && back[0].id === FIVE[0].id, 'круг файла правил потерял правила');
  throws(() => fromRulesFile('{"schema":"uml-project-rules/2","rules":[]}'), /нужна «uml-project-rules\/1»/, 'чужая схема');
  throws(() => fromRulesFile('не json'), /не разобрался как JSON/, 'не JSON');
  const broken = JSON.stringify({ schema: RULES_SCHEMA, rules: [FIVE[0], { ...FIVE[1], id: 'x', when: { all: [{ field: 'nope', op: 'eq', value: 1 }] } }] });
  throws(() => fromRulesFile(broken), /строка 2: правило «x»: неизвестное поле «nope»/, 'битая строка');
  return 'круг 5 правил, три отказа названы';
});

/* ------------------------------------------------------------- движок */

await check('правило проекта не притворяется стандартом: basis «project», пункта нет', async () => {
  const rs = createRuleset(PKG, { practice: PRACTICE, project: FIVE });
  const findings = rs.run(baseModel()).filter((f) => f.basis === 'project');
  assert(findings.length === 5, `замечаний проекта ${findings.length}, а не 5`);
  const bad = findings.filter((f) => f.clause !== null || f.constraint !== null || f.rationale !== null || f.page !== null);
  assert(!bad.length, `у замечания проекта есть чужие поля: ${bad.map((f) => f.ruleId).join(', ')}`);
  const levels = Object.fromEntries(FIVE.map((r) => [r.id, r.level]));
  const wrong = findings.filter((f) => f.level !== levels[f.ruleId]);
  assert(!wrong.length, `уровень не из правила: ${wrong.map((f) => f.ruleId).join(', ')}`);
  return `5 замечаний, clause/constraint/rationale — null, уровни из правил`;
});

await check('порядок: стандарт → практика → проект', async () => {
  const rs = createRuleset(PKG, { practice: PRACTICE, project: FIVE });
  const findings = rs.run(baseModel());
  const lastUml = findings.map((f) => f.basis).lastIndexOf('uml');
  const firstPractice = findings.findIndex((f) => f.basis === 'practice');
  const firstProject = findings.findIndex((f) => f.basis === 'project');
  assert(firstProject > firstPractice && firstPractice > lastUml,
    `порядок поехал: стандарт до ${lastUml}, практика с ${firstPractice}, проект с ${firstProject}`);
  const projectIds = findings.filter((f) => f.basis === 'project').map((f) => f.ruleId);
  assert(JSON.stringify(projectIds) === JSON.stringify(FIVE.map((r) => r.id)), `порядок правил проекта: ${projectIds.join(', ')}`);
  return `стандарт ${findings.filter((f) => f.basis === 'uml').length}, практика ${findings.filter((f) => f.basis === 'practice').length}, проект ${projectIds.length}`;
});

await check('правила проекта из модели: createRuleset(pkg) читает model.projectRules', async () => {
  const model = baseModel();
  model.projectRules = FIVE;
  const rs = createRuleset(PKG, { practice: PRACTICE });
  const findings = rs.run(model);
  assert(findings.filter((f) => f.basis === 'project').length === 5, 'правила из модели не сработали');
  // Снимок `rules` — слой загрузки; правила из модели меняются вместе с ней и
  // в него не попадают, иначе панель показывала бы правила прошлой модели.
  assert(!rs.rules.some((r) => r.basis === 'project'), 'правило из модели попало в снимок rules');
  return '5 замечаний из model.projectRules';
});

await check('явный пустой список выключает правила модели, старые вызовы не изменились', async () => {
  const model = baseModel();
  model.projectRules = FIVE;
  const off = createRuleset(PKG, { practice: PRACTICE, project: [] });
  assert(!off.run(model).some((f) => f.basis === 'project'), 'project: [] не выключил правила модели');

  // Старое поведение: модель без правил — те же замечания, что у прежних
  // вызовов, и ни одного замечания слоя проекта.
  const plain = baseModel();
  const one = createRuleset(PKG).run(plain);
  const two = createRuleset(PKG, { practice: PRACTICE }).run(plain);
  assert(one.every((f) => f.basis === 'uml'), 'createRuleset(pkg) отдал чужой слой');
  assert(JSON.stringify(one) === JSON.stringify(two.filter((f) => f.basis === 'uml')),
    'слой практики изменил замечания стандарта');
  return `${one.length} замечаний стандарта, слой проекта молчит`;
});

await check('сбой правила проекта: запись status «failed», остальные замечания на месте', async () => {
  // Поле, которое бросает: правило не сможет прочитать модель, и прогон
  // обязан это пережить — одна запись-сбой, а не пустой список. Бросает
  // `visibility` — поле, которое читают только правила проекта (нотация его не
  // выставляет), поэтому сбой остаётся сбоем ИМЕННО правила проекта, а
  // стандарт и практика отрабатывают как обычно.
  const model = baseModel();
  Object.defineProperty(model.elements.find((e) => e.id === 'c1'), 'visibility', {
    get() { throw new Error('поле видимости не читается'); },
  });
  const boom = {
    id: 'boom-visibility', title: 'бросающее правило', level: 'warning',
    scope: 'element', appliesTo: { element: ['class'] },
    when: { all: [{ field: 'visibility', op: 'eq', value: 'public' }] },
    message: 'видимость не прочиталась',
  };
  // Второе правило — по СВЯЗЯМ: его контекст видимость не читает, значит оно
  // обязано отработать рядом со сбоем.
  const rs = createRuleset(PKG, { practice: PRACTICE, project: [boom, FIVE[2]] });
  const findings = rs.run(model);
  const failed = findings.filter((f) => f.status === 'failed');
  assert(failed.length === 1, `сбоев ${failed.length}, а не 1`);
  assert(failed[0].ruleId === 'boom-visibility', `сбой назван «${failed[0].ruleId}»`);
  assert(failed[0].basis === 'project' && failed[0].clause === null, 'сбой притворяется стандартом');
  assert(/видимости не читается/.test(failed[0].detail), 'в сбое нет причины');
  const alive = findings.filter((f) => f.ruleId === 'association-ends');
  assert(alive.length === 1, 'второе правило проекта не отработало');
  // Стандарт и практика обязаны отработать ровно так же, как без правил
  // проекта: слой проекта не имеет права влиять на соседей.
  const baseline = createRuleset(PKG, { practice: PRACTICE }).run(model)
    .filter((f) => f.basis !== 'project');
  const same = findings.filter((f) => f.basis !== 'project' && f.status !== 'failed');
  assert(JSON.stringify(same) === JSON.stringify(baseline),
    `слой проекта изменил соседей: ${same.length} против ${baseline.length}`);
  return `1 сбой, ${alive.length} замечание второго правила, стандарт на месте`;
});

await check('битое правило в модели: сбой с его именем, прогон продолжается', async () => {
  const model = baseModel();
  model.projectRules = [
    { ...FIVE[0], when: { all: [{ field: 'owner.nam', op: 'eq', value: 'x' }] } },
    FIVE[2],
  ];
  const rs = createRuleset(PKG, { practice: PRACTICE });
  const findings = rs.run(model);
  const failed = findings.filter((f) => f.status === 'failed');
  assert(failed.length === 1, `сбоев ${failed.length}, а не 1`);
  assert(failed[0].ruleId === 'no-domain-to-ui', `сбой назван «${failed[0].ruleId}»`);
  assert(/неизвестное поле «owner\.nam»/.test(failed[0].detail), `причина не названа: ${failed[0].detail}`);
  assert(findings.some((f) => f.ruleId === 'association-ends' && f.status !== 'failed'),
    'второе правило проекта не отработало');
  return 'битое правило — сбой, здоровое — замечание';
});

await check('повтор id: второе правило с тем же именем — сбой, а не тихая замена', async () => {
  const model = baseModel();
  model.projectRules = [FIVE[0], { ...FIVE[2], id: FIVE[0].id }];
  const findings = createRuleset(PKG, { practice: PRACTICE }).run(model);
  const failed = findings.filter((f) => f.status === 'failed');
  assert(failed.length === 1 && /повторяется/.test(failed[0].detail), 'повтор id не назван');
  return failed[0].detail;
});

await check('правило уровня модели: одно замечание, виноватого нет', async () => {
  const rule = {
    id: 'model-note', title: 'Модель подписана', level: 'warning', scope: 'model',
    message: 'У модели нет осмысленного имени', hint: 'Назовите модель',
  };
  const findings = runRule(rule, baseModel());
  assert(findings.length === 1 && findings[0].targets.length === 0, 'замечание модели не одно или с целью');
  return '1 замечание, targets пуст';
});

await check('детерминизм: два прогона по одной модели — байт в байт', async () => {
  const model = baseModel();
  model.projectRules = FIVE;
  const rs = createRuleset(PKG, { practice: PRACTICE });
  const a = JSON.stringify(rs.run(model));
  const b = JSON.stringify(rs.run(model));
  assert(a === b, 'два прогона дали разный список');
  return `${JSON.parse(a).length} замечаний, байт в байт`;
});

/* ---------------------------------------------------------- счётчики */

await check('countByLevel: проект отдельным счётчиком, сбой — вне всех', async () => {
  const c = countByLevel([
    { basis: 'uml', level: 'error' },
    { basis: 'uml', level: 'warning' },
    { basis: 'practice', level: 'warning' },
    { basis: 'project', level: 'error' },
    { basis: 'project', level: 'warning' },
    { basis: 'project', level: 'error', status: 'failed' },
  ]);
  assert(c.errors === 1 && c.warnings === 1, `стандарт ${c.errors}/${c.warnings}`);
  assert(c.advice === 1, `советов ${c.advice}`);
  assert(c.project === 2, `проекта ${c.project}, а не 2`);
  assert(c.failed === 1, `сбоев ${c.failed}`);
  assert(c.total === 2, `total ${c.total}, а не 2 (только стандарт)`);
  return 'ошибки 1, предупреждения 1, совет 1, проект 2, сбой 1, total 2';
});

/* --------------------------------------------------------- хранение */

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const REF = { file: path.join(ROOT, '..', 'tests/fixtures/old-v3.json'), bytes: 4611, md5: '3d600cf08dc26b3329489331de80f3f6' };

await check('эталон old-v3.json: 4611 Б, md5 3d600cf0… — пересохраняется побайтово', async () => {
  const text = await readFile(REF.file, 'utf8');
  const bytes = Buffer.byteLength(text);
  assert(bytes === REF.bytes, `эталон ${bytes} Б, а не ${REF.bytes}`);
  assert(md5(text) === REF.md5, `md5 ${md5(text)}`);
  const model = deserialize(text);
  assert(serialize(model) === text, 'эталон пересохранился другими байтами');
  assert(!('projectRules' in model), 'в модели эталона появились правила проекта');
  return `${bytes} Б, md5 ${md5(text).slice(0, 8)}…, байт в байт`;
});

await check('модель без правил: projectRules не пишется, круг байт в байт', async () => {
  const model = baseModel();
  const text = serialize(model);
  assert(!text.includes('projectRules'), 'ключ projectRules появился у модели без правил');
  const back = deserialize(text);
  assert(back.projectRules === undefined, 'читатель выдумал пустой список правил');
  assert(serialize(back) === text, 'круг модели без правил не сошёлся');
  // Пустой массив — это тоже «правил нет»: иначе одна правка формы меняла бы
  // файл модели, ничего в нём не изменив.
  const empty = baseModel();
  empty.projectRules = [];
  assert(!serialize(empty).includes('projectRules'), 'пустой список правил попал в файл');
  return `${Buffer.byteLength(text)} Б, ключа нет, круг сошёлся`;
});

await check('модель с правилами: круг байт в байт, порядок ключей правила фиксирован', async () => {
  const model = baseModel();
  model.projectRules = FIVE;
  const text = serialize(model);
  const back = deserialize(text);
  assert(back.projectRules.length === 5, `прочитано правил ${back.projectRules?.length}`);
  const keys = Object.keys(back.projectRules[0]).join(',');
  assert(keys === 'id,title,level,scope,appliesTo,when,message,hint', `порядок ключей: ${keys}`);
  assert(serialize(back) === text, 'круг модели с правилами не сошёлся');
  // Второй круг — тот же результат: канонизация идемпотентна.
  assert(serialize(deserialize(serialize(back))) === text, 'второй круг разошёлся');
  return `${Buffer.byteLength(text)} Б, 5 правил, ключи в порядке, два круга`;
});

await check('модель с правилами: условия и незнакомые поля переживают круг', async () => {
  const model = baseModel();
  model.projectRules = [{
    ...FIVE[2],
    owner: 'команда А',
    when: { any: [{ field: 'toMultiplicity', op: 'empty' }, { not: { all: [{ field: 'fromMultiplicity', op: 'empty' }] } }] },
  }];
  const text = serialize(model);
  const rule = deserialize(text).projectRules[0];
  assert(rule.owner === 'команда А', 'незнакомое поле правила потеряно');
  assert(rule.when.any.length === 2 && rule.when.any[1].not.all[0].field === 'fromMultiplicity',
    'вложенное условие потеряло форму');
  assert(serialize(deserialize(text)) === text, 'круг с вложенным условием не сошёлся');
  return 'поле owner и вложенное not/all сохранены';
});

await check('канонизация правила: порядок ключей не зависит от порядка в файле', async () => {
  const shuffled = { hint: 'h', message: 'm', when: { all: [{ value: 1, op: 'eq', field: 'name' }] },
    appliesTo: { element: ['class'] }, scope: 'element', level: 'warning', title: 't', id: 'x' };
  const once = canonicalRule(shuffled);
  const twice = canonicalRule(once);
  assert(JSON.stringify(once) === JSON.stringify(twice), 'канонизация не идемпотентна');
  assert(Object.keys(once).join(',') === 'id,title,level,scope,appliesTo,when,message,hint', Object.keys(once).join(','));
  assert(Object.keys(once.when.all[0]).join(',') === 'field,op,value', Object.keys(once.when.all[0]).join(','));
  return 'id…hint, лист field,op,value';
});

/* --------------------------------------------- замер на демо-модели */

await check('5 правил проекта на демо-модели: столько же, сколько у независимого пересчёта', async () => {
  // Демо-лист правится другими задачами, поэтому «23» — не константа: тест
  // пересчитывает ожидание ВТОРЫМ, нарочно наивным проходом по модели и
  // сверяет с движком. Число печатается как замер; сверяется смысл.
  const demo = deserialize(await readFile(path.join(ROOT, 'material/demo-errors.json'), 'utf8'));
  const rs = createRuleset(PKG, { practice: PRACTICE, project: FIVE });
  const findings = rs.run(demo).filter((f) => f.basis === 'project');

  const degree = new Map(demo.elements.map((e) => [e.id, { incoming: 0, outgoing: 0 }]));
  for (const r of demo.relationships) {
    if (degree.has(r.from)) degree.get(r.from).outgoing += 1;
    if (degree.has(r.to)) degree.get(r.to).incoming += 1;
  }
  const want = [];
  for (const el of demo.elements) {
    if (el.kind === 'class' && String(el.documentation ?? '').trim() === '') want.push(`class-documented@${el.id}`);
    if (el.kind === 'interface' && String(el.documentation ?? '').trim() === '') want.push(`interface-documented@${el.id}`);
    if (el.kind === 'class' && degree.get(el.id).incoming === 0 && degree.get(el.id).outgoing === 0) {
      want.push(`class-connected@${el.id}`);
    }
  }
  for (const r of demo.relationships) {
    if (r.kind !== 'association') continue;
    if (String(r.fromMultiplicity ?? '') === '' || String(r.toMultiplicity ?? '') === '') {
      want.push(`association-ends@${r.id}`);
    }
    const to = demo.elements.find((e) => e.id === r.to);
    const from = demo.elements.find((e) => e.id === r.from);
    if (r.kind === 'dependency' && from && /^Кл/.test(from.name ?? '') && to?.kind === 'class') {
      want.push(`no-domain-to-ui@${r.id}`);
    }
  }
  const got = findings.map((f) => `${f.ruleId}@${f.targets[0]}`).sort();
  const expected = want.sort();
  const extra = got.filter((x) => !expected.includes(x));
  const missing = expected.filter((x) => !got.includes(x));
  assert(!extra.length && !missing.length,
    `лишние: ${extra.join(', ') || '—'}; пропущены: ${missing.join(', ') || '—'}`);

  const byRule = {};
  for (const f of findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
  const counts = rs.counts(rs.run(demo));
  assert(counts.project === findings.length && counts.total === counts.errors + counts.warnings,
    `счётчики: ${JSON.stringify(counts)}`);
  return `${findings.length} замечаний: `
    + FIVE.map((r) => `${r.id} ${byRule[r.id] ?? 0}`).join(', ');
});

/* ---------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);
