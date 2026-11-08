// Гигиена имён стереотипов — проверки без браузера.
//
// Э9, партия Б14. Профиль и `stereotypeId` уже подключены (Б10, Б11); здесь
// доказывается то, что мешает человеку заводить свои стереотипы без
// конфликтов, и то, что профиль честно говорит о своей применимости:
//
//   * `name_not_clash` — наше правило удобства, а не §12.4.9.6: одно
//     нормализованное имя на одном baseType — отказ, на разных — разрешено;
//     псевдоним занятого имени занят так же, как само имя;
//   * псевдонимы ключевых слов: `include` отвечает и на `IncludeStereotype`,
//     и в PlantUML ключевое слово со стереотипом не печатаются дважды;
//   * достижимость: 173 из 304 стереотипов применимы хоть где-то, 131 — нет;
//     числа, имена и причины совпадают с material/profile-canonical/
//     reachability.json — отчёт панели «Профиль» не выдумывает свои;
//   * 11 записей пробела нотации — шесть метаклассов — не «исправлены», а
//     названы: это работа Б14-нотации, а не этой партии;
//   * эталон old-v3.json по-прежнему пересохраняется побайтово.
//
//   node tests/stereotype-hygiene.mjs
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                       // .../app
const REPO = path.resolve(ROOT, '..');                       // .../visual-paradigm
const PROFILE = path.join(ROOT, 'profile', 'stereotypes.json');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'old-v3.json');
const REACHABILITY = path.join(REPO, 'material', 'profile-canonical', 'reachability.json');
const EMIT = path.join(REPO, 'material', 'plantuml-export', 'emit.mjs');
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

const load = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// Пакет нотации нужен и профилю (APPLICABILITY), и правилам: без него виды не
// разрешаются, а правило о ключевых словах сверяется с notation/uml.json.
const { applyPackage, NOTATION } = await load('src/model/notation.js');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'notation', 'uml.json'), 'utf8'));
applyPackage(pkg);

const {
  parseProfileJson, resolveStereotype, normalizeStereotypeName, stereotypeNameClash,
  reachabilityOf, unreachableReason, keywordAliasFor, UML_KEYWORDS, NOTATION_GAPS,
  UNREACHABLE_WHY,
} = await load('src/io/stereotypes.js');
const { createRuleset } = await load('src/rules/engine.js');
const { deserialize, serialize } = await load('src/io/umljson.js');

const profileText = await readFile(PROFILE, 'utf8');
const profile = parseProfileJson(profileText);
const reachability = JSON.parse(await readFile(REACHABILITY, 'utf8'));

const PKG = JSON.parse(await readFile(path.join(ROOT, 'notation', 'rules', 'uml-2.5.1.json'), 'utf8'));
const PRACTICE = JSON.parse(await readFile(path.join(ROOT, 'notation', 'rules', 'practice.json'), 'utf8'));
const both = createRuleset(PKG, { practice: PRACTICE });

/* ------------------------------------------- name_not_clash: отказ */

await check('name_not_clash: одно имя на одном baseType — отказ', async () => {
  const clash = stereotypeNameClash(profile, { name: 'Use Case', baseTypes: ['Class'] });
  assert(clash, 'конфликт не найден');
  assert(clash.record.id === 'st-usecase', `занято записью ${clash.record.id}, а не st-usecase`);
  assert(clash.baseTypes.join() === 'Class', `общий baseType «${clash.baseTypes.join()}»`);
  for (const part of ['Use Case', 'usecase', 'Class']) {
    assert(clash.message.includes(part), `в сообщении нет «${part}»: ${clash.message}`);
  }
  // Нормализация — та же, что сводила 428 записей: регистр, пробелы, _ и -.
  for (const name of ['usecase', 'USE_CASE', 'use case', 'Use-Case']) {
    assert(stereotypeNameClash(profile, { name, baseTypes: ['Class'] }),
      `«${name}» не считается занятым, хотя нормализуется в usecase`);
  }
  return clash.message;
});

await check('name_not_clash: другой baseType — не конфликт', async () => {
  assert(!stereotypeNameClash(profile, { name: 'usecase', baseTypes: ['Component'] }),
    'usecase на Component сочтён конфликтом с usecase на Class');
  // А вот entity занимает и Class, и Component — на Component спорит.
  const clash = stereotypeNameClash(profile, { name: 'entity', baseTypes: ['Component'] });
  assert(clash && clash.baseTypes.join() === 'Component', 'entity на Component не найден');
  return 'usecase × Component свободно, entity × Component занято';
});

await check('name_not_clash: псевдоним ключевого слова занят так же', async () => {
  const viaAlias = stereotypeNameClash(profile, { name: 'IncludeStereotype', baseTypes: ['Include'] });
  assert(viaAlias && viaAlias.record.name === 'include',
    `IncludeStereotype не нашёл include: ${viaAlias?.message ?? 'конфликта нет'}`);
  const viaKeyword = stereotypeNameClash(profile, { name: 'include', baseTypes: ['Include'] });
  assert(viaKeyword && viaKeyword.record.name === 'include', 'include не спорит сам с собой');
  // `substitute` в профиле — стереотип проекта на Dependency, и он занят.
  assert(stereotypeNameClash(profile, { name: 'Substitute', baseTypes: ['Dependency'] }),
    'Substitute на Dependency не считается занятым');
  return 'IncludeStereotype и include ведут к одной записи';
});

await check('name_not_clash: правка записи не спорит сама с собой', async () => {
  assert(!stereotypeNameClash(profile, { name: 'usecase', baseTypes: ['Class'] }, { exceptId: 'st-usecase' }),
    'запись спорит с собой при переименовании');
  assert(stereotypeNameClash(profile, { name: 'usecase', baseTypes: ['Class'] }, { exceptId: 'st-entity' }),
    'чужая запись перестала мешать из-за чужого exceptId');
  return 'exceptId снимает только свою запись';
});

await check('name_not_clash: пустое имя или пустой baseType — не отказ', async () => {
  assert(!stereotypeNameClash(profile, { name: '', baseTypes: ['Class'] }), 'пустое имя дало конфликт');
  assert(!stereotypeNameClash(profile, { name: 'usecase', baseTypes: [] }), 'пустой baseType дал конфликт');
  assert(!stereotypeNameClash(profile, { name: '   ', baseTypes: ['Class'] }), 'пробелы дали конфликт');
  return 'нечего занимать — нечего и запрещать';
});

/* --------------------------------------- name_not_clash: правило */

const ruleModel = (profiles) => ({
  schema: 'uml-model/3', id: 'm-hygiene', name: 'Гигиена имён',
  elements: [], relationships: [], diagrams: [], profiles,
});

const findingsOf = (model, id) => both.run(model).filter((f) => f.ruleId === id);

await check('правило name-not-clash: одинаковые имена на одном метаклассе — замечание', async () => {
  const model = ruleModel([{
    id: 'p1', name: 'Профиль разработки', scope: 'application',
    stereotypes: [
      { id: 'p1-s1', name: 'entity', baseTypes: ['Class'] },
      { id: 'p1-s2', name: 'Entity', baseTypes: ['Class', 'Component'] },
    ],
  }]);
  const hits = findingsOf(model, 'name-not-clash');
  assert(hits.length === 1, `замечаний ${hits.length}, ждали одно`);
  const f = hits[0];
  assert(f.basis === 'practice', `basis «${f.basis}», а не practice`);
  assert(f.level === 'warning', `уровень «${f.level}»`);
  assert(f.clause === null && f.constraint === null && f.page === null,
    'у практики появилась ссылка на стандарт');
  assert(String(f.rationale ?? '').trim(), 'нет rationale');
  assert(f.targets.length === 0, `цель «${f.targets.join()}» — а профиль не элемент модели`);
  for (const part of ['Профиль разработки', 'Entity', 'entity', 'Class']) {
    assert(f.detail.includes(part), `в detail нет «${part}»: ${f.detail}`);
  }
  return f.detail;
});

await check('правило name-not-clash: разные метаклассы и чистый профиль молчат', async () => {
  const different = ruleModel([{
    id: 'p1', name: 'P', scope: 'project',
    stereotypes: [
      { id: 'p1-s1', name: 'usecase', baseTypes: ['UseCase'] },
      { id: 'p1-s2', name: 'usecase', baseTypes: ['Component'] },
    ],
  }]);
  assert(!findingsOf(different, 'name-not-clash').length,
    'разные baseType сочтены конфликтом');
  const clean = ruleModel([{
    id: 'p1', name: 'P', scope: 'project',
    stereotypes: [{ id: 'p1-s1', name: 'entity', baseTypes: ['Class'] }],
  }]);
  assert(!findingsOf(clean, 'name-not-clash').length, 'чистый профиль дал замечание');
  // Модель без профилей — обычный случай: правило молчит, а не падает.
  assert(!findingsOf(ruleModel(undefined), 'name-not-clash').length,
    'модель без секции profiles дала замечание');
  return 'два baseType, чистый профиль и модель без профилей — 0 замечаний';
});

await check('правило name-not-clash: псевдоним ключевого слова спорит и в своём профиле', async () => {
  // Свои стереотипы лежат в модели, и `keywordAliases` у них нет — поле ставит
  // разбор профиля приложения. Если бы правило смотрело только на это поле,
  // `Include` и `IncludeStereotype` на одном метаклассе прошли бы молча, а то
  // же имя в профиле приложения — нет. Псевдоним выводится из имени всегда.
  const model = ruleModel([{
    id: 'p1', name: 'Мой профиль', scope: 'project',
    stereotypes: [
      { id: 'p1-s1', name: 'Include', baseTypes: ['Include'] },
      { id: 'p1-s2', name: 'IncludeStereotype', baseTypes: ['Include'] },
    ],
  }]);
  const hits = findingsOf(model, 'name-not-clash');
  assert(hits.length === 1, `замечаний ${hits.length}, ждали одно`);
  for (const part of ['IncludeStereotype', 'Include']) {
    assert(hits[0].detail.includes(part), `в detail нет «${part}»: ${hits[0].detail}`);
  }
  return hits[0].detail;
});

await check('правило name-not-clash: в слое стандарта его нет', async () => {
  const inStandard = both.rules.filter((r) => r.basis === 'uml' && r.id === 'name-not-clash');
  assert(!inStandard.length, 'правило попало в слой стандарта');
  const rule = both.rules.find((r) => r.id === 'name-not-clash');
  assert(rule && rule.basis === 'practice', 'правила нет в слое практики');
  assert(!('source' in rule), 'у правила практики появился source');
  return 'только слой практики, source отсутствует';
});

/* ----------------------------------------------- псевдонимы ключевых слов */

await check('псевдоним ключевого слова: IncludeStereotype находит include', async () => {
  const byCanon = resolveStereotype(profile, { stereotype: 'include' });
  const byAlias = resolveStereotype(profile, { stereotype: 'IncludeStereotype' });
  const bySpelling = resolveStereotype(profile, { stereotype: 'Include' });
  assert(byCanon.record?.id === 'st-include', `канон нашёл ${byCanon.record?.id}`);
  assert(byAlias.record?.id === 'st-include', `псевдоним нашёл ${byAlias.record?.id}`);
  assert(bySpelling.record?.id === 'st-include', `написание нашло ${bySpelling.record?.id}`);
  assert(byCanon.via === 'exact', `канон найден шагом «${byCanon.via}»`);
  assert(byAlias.via === 'normalized', `псевдоним найден шагом «${byAlias.via}»`);
  // Каноническое имя в точной таблице одно: псевдоним не притворяется каноном.
  assert(!profile.byName.has('IncludeStereotype'), 'псевдоним попал в byName');
  return `include: канон ${byCanon.via}, псевдоним ${byAlias.via}`;
});

await check('псевдоним ключевого слова: покрывает все ключевые слова нотации', async () => {
  const notationKeywords = new Set(Object.values(NOTATION.connectors)
    .map((c) => c.keyword).filter(Boolean));
  const missing = [...notationKeywords].filter((k) => !UML_KEYWORDS.includes(k));
  assert(!missing.length, `ключевые слова нотации не в UML_KEYWORDS: ${missing.join(', ')}`);
  assert(UML_KEYWORDS.includes('substitute'), 'substitute — ключевое слово UML — не учтён');
  assert(keywordAliasFor('merge') === 'MergeStereotype', `merge → ${keywordAliasFor('merge')}`);
  assert(keywordAliasFor('entity') === '', 'обычное имя получило псевдоним ключевого слова');
  // Псевдоним есть у каждой записи, чьё имя — ключевое слово, и только у них.
  const withAlias = profile.stereotypes.filter((s) => s.keywordAliases.length);
  const keywordNames = profile.stereotypes
    .filter((s) => UML_KEYWORDS.includes(normalizeStereotypeName(s.name)));
  assert(withAlias.length === keywordNames.length,
    `псевдонимы у ${withAlias.length} записей, ключевых имён ${keywordNames.length}`);
  for (const s of withAlias) {
    assert(s.keywordAliases.every((a) => a.endsWith('Stereotype')), `${s.name}: ${s.keywordAliases.join()}`);
  }
  return `${withAlias.length} записей: ${withAlias.map((s) => `${s.name}→${s.keywordAliases.join('')}`).join(', ')}`;
});

await check('PlantUML: ключевое слово и стереотип не печатаются дважды', async () => {
  const { emit } = await import(pathToFileURL(EMIT).href);
  const el = (id, kind, name) => ({ id, kind, name });
  const shape = (id, elementId) => ({ id, elementId, x: 40, y: 40, w: 180, h: 90 });
  const model = (rels, elements) => ({
    schema: 'uml-model/3', id: 'm-puml', name: 'Выгрузка',
    elements,
    relationships: rels,
    diagrams: [{
      id: 'd1', name: 'Диаграмма классов', kind: 'class',
      shapes: elements.map((e, i) => shape(`s${i + 1}`, e.id)),
      links: rels.map((r, i) => ({
        id: `l${i + 1}`, relId: r.id,
        from: { shapeId: `s${elements.findIndex((e) => e.id === r.from) + 1}`, side: 'right', t: 0.5 },
        to: { shapeId: `s${elements.findIndex((e) => e.id === r.to) + 1}`, side: 'left', t: 0.5 },
      })),
    }],
    currentDiagramId: 'd1',
  });
  const elements = [el('a', 'class', 'Заказ'), el('b', 'class', 'Оплата')];
  // Старое написание в модели и каноническое — оба дают один `<<include>>`:
  // вид связи уже печатает ключевое слово, и второй раз его печатать нельзя.
  for (const spelling of ['include', 'Include']) {
    const text = emit(model([{
      id: 'r1', kind: 'include', name: '', from: 'a', to: 'b', stereotype: spelling,
    }], elements));
    const hits = text.match(/<<include>>/g) ?? [];
    assert(hits.length === 1, `«${spelling}»: <<include>> встречается ${hits.length} раз:\n${text}`);
    assert(!/<<Include>>/.test(text), `«${spelling}»: в тексте есть <<Include>>:\n${text}`);
  }
  // На классе ключевого слова нет — стереотип печатается один раз, как обычно.
  const withStereotype = emit(model([], [{ id: 'a', kind: 'class', name: 'Заказ', stereotype: 'include' }]));
  assert((withStereotype.match(/<<include>>/g) ?? []).length === 1,
    `класс со стереотипом include: <<include>> не один раз:\n${withStereotype}`);
  return 'связь include + стереотип include → один <<include>>';
});

await check('псевдоним ключевого слова: не перебивает каноническое имя', async () => {
  // Псевдоним — второй шаг разрешения, а не второй владелец ключа: если бы
  // `IncludeStereotype` лёг в `byNormalized` раньше `include`, канон перестал
  // бы находиться своим же именем. Проверяется на всех 304 записях.
  const lost = profile.stereotypes.filter((s) => {
    const hit = profile.byNormalized.get(normalizeStereotypeName(s.name));
    return hit?.id !== s.id;
  });
  assert(!lost.length, `канон перебит псевдонимом: ${lost.map((s) => s.name).join(', ')}`);
  assert(profile.byName.size === 304, `в byName ${profile.byName.size} имён, а канонических 304`);
  const canonical = new Set(profile.stereotypes.map((s) => s.name));
  const extra = [...profile.byName.keys()].filter((n) => !canonical.has(n));
  assert(!extra.length, `в byName чужие написания: ${extra.join(', ')}`);
  return `byName 304 канонических, byNormalized ${profile.byNormalized.size} ключей`;
});

/* ------------------------------------------------------- достижимость */

await check('достижимость: 304 / 173 / 131 и 97 / 52 / 45 совпадают с отчётом', async () => {
  const r = profile.reachability ?? reachabilityOf(profile);
  const s = reachability.summary;
  const a = reachability.applicability;
  assert(s.stereotypes === r.stereotypes.total, `стереотипов ${r.stereotypes.total}, в отчёте ${s.stereotypes}`);
  assert(s.stereotypesReachable === r.stereotypes.reachable,
    `достижимых ${r.stereotypes.reachable}, в отчёте ${s.stereotypesReachable}`);
  assert(s.stereotypesEntirelyUnreachable === r.stereotypes.entirelyUnreachable,
    `недостижимых ${r.stereotypes.entirelyUnreachable}, в отчёте ${s.stereotypesEntirelyUnreachable}`);
  assert(s.stereotypesPartlyReachable === r.stereotypes.partlyReachable,
    `частично ${r.stereotypes.partlyReachable}, в отчёте ${s.stereotypesPartlyReachable}`);
  assert(a.profileBaseTypes === r.baseTypes.profile, `baseType ${r.baseTypes.profile}, в отчёте ${a.profileBaseTypes}`);
  assert(a.reachableBaseTypes === r.baseTypes.reachable, `достижимых baseType ${r.baseTypes.reachable}`);
  assert(a.unreachableBaseTypes === r.baseTypes.unreachable, `недостижимых baseType ${r.baseTypes.unreachable}`);
  // 304 = 173 + 131: достижимость стереотипа — «хоть одно расширение».
  assert(r.stereotypes.reachable + r.stereotypes.entirelyUnreachable === r.stereotypes.total,
    'достижимые и недостижимые не складываются в целое');
  return `${r.stereotypes.total} = ${r.stereotypes.reachable} + ${r.stereotypes.entirelyUnreachable}`;
});

await check('достижимость: имена недостижимых и частично достижимых совпадают', async () => {
  const r = profile.reachability ?? reachabilityOf(profile);
  const entirely = profile.stereotypes.filter((s) => !r.isReachable(s)).map((s) => s.name).sort();
  const partly = profile.stereotypes
    .filter((s) => r.isReachable(s) && r.unreachableBaseTypes(s).length)
    .map((s) => s.name).sort();
  const wantEntirely = reachability.stereotypesEntirelyUnreachable.map((x) => x.name).sort();
  const wantPartly = reachability.stereotypesPartlyReachable.map((x) => x.name).sort();
  assert(entirely.join() === wantEntirely.join(),
    `недостижимые расходятся: ${entirely.filter((n) => !wantEntirely.includes(n)).join(', ')}`);
  assert(partly.join() === wantPartly.join(),
    `частично достижимые расходятся: ${partly.join()} против ${wantPartly.join()}`);
  return `${entirely.length} недостижимых, ${partly.length} частично`;
});

await check('достижимость: причина каждого недостижимого baseType — из отчёта', async () => {
  const groups = new Map();
  for (const g of reachability.groups) {
    for (const row of g.baseTypes) groups.set(row.baseType, { family: g.family, why: g.why });
  }
  const bases = new Set(profile.stereotypes.flatMap((s) => s.baseTypes));
  const unreachable = [...bases].filter((b) => !(profile.reachability ?? reachabilityOf(profile))
    .isReachable({ baseTypes: [b] }));
  assert(unreachable.length === 45, `недостижимых baseType ${unreachable.length}`);
  for (const base of unreachable) {
    const reason = unreachableReason(base);
    assert(reason, `${base}: причина не названа`);
    const want = groups.get(base);
    assert(want, `${base}: нет в группах отчёта`);
    assert(reason.family === want.family, `${base}: семейство «${reason.family}», в отчёте «${want.family}»`);
    assert(reason.why === want.why, `${base}: причина «${reason.why}», в отчёте «${want.why}»`);
  }
  for (const base of ['Class', 'UseCase', 'Include']) {
    assert(!unreachableReason(base), `${base} назван недостижимым, хотя APPLICABILITY его знает`);
  }
  return `45 причин, все дословно как в reachability.json`;
});

await check('пробел нотации: 11 записей — шесть метаклассов, и они названы', async () => {
  const gaps = [...NOTATION_GAPS.element, ...NOTATION_GAPS.connector].sort();
  assert(gaps.join() === [...reachability.ourGaps.baseTypes].sort().join(),
    `наши пробелы расходятся: ${gaps.join()} против ${reachability.ourGaps.baseTypes.join()}`);
  assert(reachability.ourGaps.records === 11, `в отчёте пробел ${reachability.ourGaps.records} записей`);
  // Пробел не «исправлен»: у каждого метакласса нет вида ни в одном из списков.
  const kinds = [...Object.values(NOTATION.connectors), ...Object.values(NOTATION.shapes)];
  const present = new Set(kinds.flatMap((k) => [k.kind, k.baseType, k.metaclass].filter(Boolean)));
  for (const base of gaps) assert(!present.has(base), `${base} уже заведён видом — тогда это не пробел`);
  // И у каждого есть причина, отличная от «чужой нотации» и «строки члена».
  for (const base of gaps) {
    const reason = unreachableReason(base);
    assert(reason && reason.family.startsWith('UML'), `${base}: семейство «${reason?.family}»`);
  }
  return `${gaps.join(', ')} — ${reachability.ourGaps.records} записей`;
});

await check('сводка панели берётся из разобранного профиля, без второго файла', async () => {
  // Панель читает `store.profile.reachability`; если поле пропадёт, сводка
  // молча станет пустой. Поэтому контракт проверяется здесь, а не в браузере.
  assert(profile.reachability, 'у разобранного профиля нет reachability');
  for (const key of ['stereotypes', 'definitions', 'baseTypes']) {
    assert(profile.reachability[key], `в reachability нет «${key}»`);
  }
  const again = reachabilityOf(profile.stereotypes);
  assert(JSON.stringify(again.stereotypes) === JSON.stringify(profile.reachability.stereotypes),
    'reachabilityOf(profile.stereotypes) расходится с profile.reachability');
  return `304 стереотипа · ${profile.reachability.stereotypes.reachable} достижимы · `
    + `${profile.reachability.stereotypes.entirelyUnreachable} недостижимы`;
});

await check('достижимость: разбивка недостижимых по причинам — 91 + 38 + 2', async () => {
  const st = (profile.reachability ?? reachabilityOf(profile)).stereotypes;
  const by = st.unreachableByFamily ?? {};
  const sum = (names) => names.reduce((n, name) => n + (by[name] ?? 0), 0);
  const foreign = sum(['BMM', 'ArchiMate', 'SysML']);
  const members = sum(['Attribute', 'Operation']);
  const gap = sum(['UML-элемент', 'UML-связь']);
  assert(foreign + members + gap === st.entirelyUnreachable,
    `${foreign} + ${members} + ${gap} ≠ ${st.entirelyUnreachable}`);
  // Числа в единицах СТЕРЕОТИПОВ, а не записей профиля: в отчёте те же причины дают
  // 96 + 44 + 11 = 151 запись, и это не то же число. Смешать их — значит
  // показать человеку строку, которая не складывается.
  assert(reachability.byDesign.foreignNotationUnreachable === 96,
    `чужих записей в отчёте ${reachability.byDesign.foreignNotationUnreachable}`);
  assert(reachability.byDesign.membersNotElements === 44,
    `записей членов в отчёте ${reachability.byDesign.membersNotElements}`);
  assert(reachability.ourGaps.records === 11, `пробел ${reachability.ourGaps.records}`);
  assert(foreign + members + gap !== 151 || st.entirelyUnreachable === 151,
    'разбивка в стереотипах совпала с записями — единицы перепутаны');
  return `стереотипы ${foreign} + ${members} + ${gap} = ${st.entirelyUnreachable}; `
    + `записи 96 + 44 + 11 = ${96 + 44 + 11}`;
});

/* --------------------------------------------------------------- эталон */

await check('old-v3.json: 4 611 Б, md5 3d600cf0…, пересохранение побайтово', async () => {
  const bytes = await readFile(FIXTURE);
  assert(bytes.length === 4611, `файл ${bytes.length} Б, а не 4611`);
  const md5 = createHash('md5').update(bytes).digest('hex');
  assert(md5 === '3d600cf08dc26b3329489331de80f3f6', `md5 ${md5}`);
  const repairs = [];
  const model = deserialize(bytes.toString('utf8'), { repairs, profile });
  const out = serialize(model);
  assert(Buffer.from(out).equals(bytes), 'пересохранение изменило файл');
  assert(!repairs.length, `repairs не пуст: ${repairs.join('; ')}`);
  return `${bytes.length} Б, md5 ${md5.slice(0, 8)}…, repairs пуст`;
});

/* --------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log(`\nПроверок пройдено: ${results.length - failed.length} из ${results.length}.`);
if (failed.length) {
  console.log(`Провалено ${failed.length}:`);
  for (const f of failed) console.log(`  - ${f.name}`);
}
process.exitCode = failed.length ? 1 : 0;
