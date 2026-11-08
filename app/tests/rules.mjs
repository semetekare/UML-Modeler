// Движок правил приложения — проверки без браузера.
//
// Это тот же движок, который работает в панели «Проверки» (`src/rules/`), но
// прогнанный из Node: наборы правил читаются с диска, нотация применяется тем
// же `applyPackage`, что и на странице. Доказывается то, чего не видно в
// браузерных сценариях:
//
//   * у каждого правила стандарта есть пункт, уровень и `check`;
//   * у каждого `check` есть функция в реестре, либо правило записано
//     невыразимым с названным полем модели, которого не хватает;
//   * правило без функции в реестре — ошибка загрузки, а не тихий пропуск;
//   * у слоя практики нет и не может быть `source`, зато обязателен
//     `rationale`: притворяться стандартом нельзя;
//   * на каждое правило стандарта — пара фикстур, на каждое правило практики —
//     пара моделей: нарушение ловится, контрольная чиста, чужие правила молчат;
//   * 48 моделей корпуса дают НОЛЬ замечаний стандарта — учебные модели
//     правильные, и находка на них означала бы ложное срабатывание, — а слой
//     практики на корпусе с видами даёт 21 совет (число по правилам названо
//     ниже; это свойство корпуса, а не инвариант);
//   * прогон детерминирован: одинаковая модель — одинаковый список.
//
//   node tests/rules.mjs
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(HERE, 'data');
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

const { applyPackage, NOTATION } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8')));
const { deserialize, serialize } = await load('src/io/umljson.js');
const { createRuleset } = await load('src/rules/engine.js');
const { IMPLEMENTED, PRACTICE_CHECKS } = await load('src/rules/registry.js');
const { STANDALONE, STRUCTURAL } = await load('src/rules/practice.js');

const PKG = JSON.parse(await readFile(path.join(ROOT, 'notation/rules/uml-2.5.1.json'), 'utf8'));
const PRACTICE = JSON.parse(await readFile(path.join(ROOT, 'notation/rules/practice.json'), 'utf8'));

// `ruleset` — прежний однослойный движок: он и дальше отвечает за правила
// стандарта. `both` — тот движок, который собирает приложение: два слоя.
const ruleset = createRuleset(PKG);
const both = createRuleset(PKG, { practice: PRACTICE });

const loadModel = async (dir, file) => {
  const text = await readFile(path.join(DATA, dir, file), 'utf8');
  const repairs = [];
  return deserialize(text, { repairs });
};

const describe = (list) => list.map((f) => `${f.ruleId}@${f.targets.join('+')}: ${f.detail}`).join('; ');

/* ------------------------------------------------------------- набор */

await check('набор правил: 58 правил, у каждого пункт стандарта', async () => {
  assert(ruleset.rules.length === 58, `правил ${ruleset.rules.length}, а в наборе 58`);
  const bad = ruleset.rules.filter((r) => !r.source?.clause || !r.source?.constraint || !r.source?.text);
  assert(!bad.length, `без источника: ${bad.map((r) => r.id).join(', ')}`);
  const levels = new Set(ruleset.rules.map((r) => r.level));
  assert(levels.size === 2, 'уровней не два');
  const errors = ruleset.rules.filter((r) => r.level === 'error').length;
  return `${ruleset.rules.length} правил, ошибок ${errors}, предупреждений ${ruleset.rules.length - errors}`;
});

await check('реестр: 52 проверки стандарта и 13 практики, остальные 6 записаны невыразимыми', async () => {
  assert(IMPLEMENTED.length === 65, `в реестре ${IMPLEMENTED.length} проверок, а не 65`);
  assert(PRACTICE_CHECKS.size === 13, `проверок практики ${PRACTICE_CHECKS.size}, а не 13`);
  const standardChecks = IMPLEMENTED.filter((c) => !PRACTICE_CHECKS.has(c));
  assert(standardChecks.length === 52, `проверок стандарта ${standardChecks.length}, а не 52`);
  assert(both.uncovered.length === 6, `невыразимых ${both.uncovered.length}`);
  const silent = both.rules.filter((r) => !r.fn && !r.gap);
  assert(!silent.length, `молча не проверяются: ${silent.map((r) => r.id).join(', ')}`);
  return `${standardChecks.length} + ${PRACTICE_CHECKS.size} проверяются, ${both.uncovered.length} — нет`;
});

await check('у каждого непроверяемого правила названо недостающее поле модели', async () => {
  const bad = both.uncovered.filter((u) => !u.missing || !u.reason);
  assert(!bad.length, `без поля/причины: ${bad.map((u) => u.id).join(', ')}`);
  return both.uncovered.map((u) => u.id).join(', ');
});

await check('две причины sequence записаны отдельно от NOT_EXPRESSIBLE и сверены с каталогом', async () => {
  // Эти два констрейнта НЕ правила набора: их нельзя ни записать функцией, ни
  // объявить `gap` в `NOT_EXPRESSIBLE` — `createRuleset` падает на ключе, кото-
  // рому не соответствует правило. Поэтому у них своя таблица в `coverage.js`, а
  // здесь проверяется, что она не разошлась с каталогом проверяемости: ключ —
  // `Метакласс::констрейнт`, статус `gap`, и названо ровно то, чего не хватает.
  // Без этой сверки таблица стала бы мёртвым текстом: каталог пересобрали,
  // причина изменилась, а запись осталась врать.
  const { NOT_EXPRESSIBLE_CONSTRAINTS } = await load('src/rules/coverage.js');
  const keys = Object.keys(NOT_EXPRESSIBLE_CONSTRAINTS);
  assert(keys.length === 2, `записей ${keys.length}, а ждали две: ${keys.join(', ')}`);
  assert(!both.rules.some((r) => keys.includes(r.id)), 'причина записана id правила набора');

  const catalog = JSON.parse(await readFile(
    path.join(ROOT, '..', 'material', 'rules-coverage', 'coverage.json'), 'utf8'));
  const items = (catalog.byMetaclass ?? []).flatMap((g) => g.items ?? []);
  const seen = [];
  const found = {};
  for (const [key, rec] of Object.entries(NOT_EXPRESSIBLE_CONSTRAINTS)) {
    assert(String(rec.reason ?? '').trim() && String(rec.missing ?? '').trim(),
      `«${key}»: пустая причина или пустое «чего не хватает»`);
    // Ключ таблицы — имя правила-заменителя, а каталог называет констрейнт
    // парой «метакласс + имя констрейнта»; связывает их сама запись.
    const item = items.find((i) => i.metaclass === rec.metaclass && i.name === rec.constraint);
    assert(item, `«${key}» нет в каталоге проверяемости`);
    assert(item.status === 'gap', `«${key}»: статус «${item.status}», а ждали gap`);
    assert(item.clause === rec.clause, `«${key}»: пункт ${item.clause} против ${rec.clause}`);
    found[key] = item;
    seen.push(`${key} (${item.clause})`);
  }
  // Каталог называет недостающее своими словами: у Lifeline это само поле
  // `interaction` (а `context` — его свойство), у Message — типы `Operation` и
  // `Signal`. Сверка держит обе записи вместе: пересобрали каталог, и причина
  // перестала быть той — запись устарела.
  assert((found['lifeline-same-classifier'].missing ?? []).some((m) => m.property === 'interaction'),
    'каталог больше не считает `interaction` недостающим у Lifeline::same_classifier');
  const need = found['message-signature-refer-to'].requires ?? [];
  assert(need.includes('Operation') && need.includes('Signal'),
    `каталог больше не требует Operation и Signal: ${need.join(', ') || '—'}`);
  // Названо именно то, чего не хватает: `context` у взаимодействия и
  // `Operation`/`Signal` как элементы. Это и есть разница с прежней причиной
  // каталога («нет поля: interaction», «нет вида: OCL требует …»).
  assert(/context/.test(NOT_EXPRESSIBLE_CONSTRAINTS['lifeline-same-classifier'].missing),
    'у Lifeline::same_classifier не названо поле context');
  assert(/Operation/.test(NOT_EXPRESSIBLE_CONSTRAINTS['message-signature-refer-to'].missing),
    'у Message::signature_refer_to не названы Operation/Signal');
  return `${seen.join(', ')} — gap в каталоге, причина записана`;
});

await check('createRuleset(pkg) без опций — прежний однослойный вызов', async () => {
  assert(ruleset.rules.length === 58, `правил ${ruleset.rules.length}, а не 58`);
  const notUml = ruleset.rules.filter((r) => r.basis !== 'uml');
  assert(!notUml.length, `в однослойном движке чужие правила: ${notUml.map((r) => r.id).join(', ')}`);
  const model = await loadModel('rules', 'mult-upper-ge-lower.json');
  const findings = ruleset.run(model);
  assert(findings.every((f) => f.basis === 'uml'), 'замечание не из слоя стандарта');
  return '58 правил, все с basis «uml»';
});

await check('два слоя: 58 правил стандарта, затем 13 правил практики', async () => {
  assert(both.rules.length === 71, `правил ${both.rules.length}, а не 71`);
  const umbrella = both.rules.slice(0, 58);
  const advice = both.rules.slice(58);
  assert(umbrella.every((r) => r.basis === 'uml'), 'в начале не слой стандарта');
  assert(advice.every((r) => r.basis === 'practice'), 'в конце не слой практики');
  const order = advice.map((r) => r.id).join(', ');
  assert(order === PRACTICE.map((r) => r.id).join(', '), `порядок практики поехал: ${order}`);
  return `58 стандарта + ${advice.length} практики (${order})`;
});

await check('правила практики: без source, с rationale, уровень warning', async () => {
  const bad = PRACTICE.filter((r) => 'source' in r || !String(r.rationale ?? '').trim() || r.level !== 'warning');
  assert(!bad.length, `не по контракту: ${bad.map((r) => r.id).join(', ')}`);
  const empty = PRACTICE.filter((r) => !String(r.message ?? '').trim() || !String(r.hint ?? '').trim());
  assert(!empty.length, `без message/hint: ${empty.map((r) => r.id).join(', ')}`);
  return PRACTICE.map((r) => r.id).join(', ');
});

await check('practice.json: appliesTo совпадает с границами в коде', async () => {
  const byId = new Map(PRACTICE.map((r) => [r.id, r]));
  const elements = Object.keys(NOTATION.shapes);
  const nameless = elements.filter((k) => NOTATION.shapes[k].nameless);
  const connectors = Object.keys(NOTATION.connectors);
  const uniq = (list) => [...new Set(list)].sort().join(',');
  const want = {
    'element-isolated': { element: elements.filter((k) => !STANDALONE.has(k)) },
    'element-not-on-any-diagram': { element: elements },
    'element-unnamed': { element: elements.filter((k) => !STANDALONE.has(k) && !nameless.includes(k)) },
    'relationship-duplicate': { relationship: connectors.filter((k) => STRUCTURAL.has(k)) },
    'relationship-not-on-any-diagram': { relationship: connectors },
    'shape-isolated-on-diagram': { element: elements.filter((k) => !STANDALONE.has(k)) },
    // Четыре правила о ссылках судят ровно один вид-носитель ссылки: другого
    // вида у поля нет (classifierId — у объекта, behaviorRef — у действия,
    // represents — у дорожки, refersTo — у ссылки на взаимодействие).
    'object-classifier-kind': { element: ['object'] },
    'action-behavior-is-activity': { element: ['action'] },
    'swimlane-represents-kind': { element: ['swimlane'] },
    'interaction-use-refers-kind': { element: ['interactionUse'] },
    // Два совета о последовательности: у `represents` два вида-носителя (линия
    // жизни и линия жизни актёра), у подписи — четыре вида связи-сообщения.
    // Списки сверяются с кодом, а не с памятью: пропущенный вид молча выпал бы
    // из проверки.
    'lifeline-represents-classifier': { element: ['lifeline', 'actorLifeline'] },
    'message-signature-operation': {
      relationship: ['message', 'reply', 'createMessage', 'destroyMessage'],
    },
  };
  for (const [id, expected] of Object.entries(want)) {
    const rule = byId.get(id);
    assert(rule, `правила «${id}» нет в practice.json`);
    for (const [field, kinds] of Object.entries(expected)) {
      const got = rule.appliesTo?.[field] ?? [];
      assert(uniq(got) === uniq(kinds), `«${id}».appliesTo.${field}: список расходится с кодом`);
    }
  }
  const unknown = PRACTICE.flatMap((r) => [...(r.appliesTo?.element ?? []), ...(r.appliesTo?.relationship ?? [])])
    .filter((k) => !NOTATION.shapes[k] && !NOTATION.connectors[k]);
  assert(!unknown.length, `в appliesTo виды, которых нет в нотации: ${[...new Set(unknown)].join(', ')}`);
  return `${PRACTICE.length} правил, списки видов сверены с notation/uml.json`;
});

/* --------------------------------------------------- ошибки загрузки */

const broken = (mutate) => {
  const copy = JSON.parse(JSON.stringify(PKG));
  mutate(copy);
  return copy;
};
const brokenPractice = (mutate) => {
  const copy = JSON.parse(JSON.stringify(PRACTICE));
  mutate(copy);
  return copy;
};
const throws = (pkg, re, options) => {
  let msg = '';
  try { createRuleset(pkg, options); } catch (e) { msg = e.message; }
  assert(msg, 'набор загрузился, хотя должен был отказать');
  assert(re.test(msg), `не та ошибка: ${msg}`);
};

await check('правило без функции в реестре — ошибка загрузки', async () => {
  throws(broken((p) => { p[1].check = 'multiplicity-upper-ge-lower-typo'; }), /нет в реестре/);
  return 'отказ с названием правила';
});

await check('правило без пункта стандарта — ошибка загрузки', async () => {
  throws(broken((p) => { delete p[1].source.clause; }), /нет пункта стандарта/);
  return 'отказ с названием правила';
});

await check('правило без уровня — ошибка загрузки', async () => {
  throws(broken((p) => { p[1].level = 'info'; }), /не error и не warning/);
  return 'отказ с названием правила';
});

await check('два правила с одним id — ошибка загрузки', async () => {
  throws(broken((p) => { p[2].id = p[1].id; }), /повторяется/);
  return 'отказ с названием правила';
});

await check('правило стандарта без source в двухслойной сборке — ошибка загрузки', async () => {
  throws(broken((p) => { delete p[3].source; }), /нет пункта стандарта/, { practice: PRACTICE });
  return 'отказ с названием правила';
});

await check('правило практики с полем source — ошибка загрузки', async () => {
  throws(PKG, /source/, {
    practice: brokenPractice((p) => {
      p[0].source = { clause: '7.8.6.6', constraint: 'Element::not_own_self', text: 'An element may not own itself.' };
    }),
  });
  return 'практика не имеет права притворяться стандартом';
});

await check('правило практики без rationale — ошибка загрузки', async () => {
  throws(PKG, /rationale/, { practice: brokenPractice((p) => { delete p[0].rationale; }) });
  return 'отказ с названием правила';
});

await check('проверка практики без правила — ошибка загрузки (по объединению слоёв)', async () => {
  // Осиротевшая проверка в реестре — это опечатка, а не запас на будущее.
  // Слой практики подан, значит проверка «element-isolated» обязана быть
  // использована; без правила — отказ загрузки.
  throws(PKG, /проверки без правила/, { practice: PRACTICE.filter((r) => r.id !== 'element-isolated') });
  return 'отказ с названием проверки';
});

await check('правило практики с чужим check — ошибка загрузки', async () => {
  throws(PKG, /нет в реестре/, { practice: brokenPractice((p) => { p[5].check = 'element-isolatd'; }) });
  return 'отказ с названием правила';
});

/* ------------------------------------------------------------- фикстуры */

const files = (await readdir(path.join(DATA, 'rules'))).filter((f) => f.endsWith('.json')).sort();
const withFixture = [...new Set(files.map((f) => f.replace(/\.ok\.json$|\.json$/, '')))].sort();

// Пар фикстур два рода, и проверяются они по-разному. У правила стандарта
// «чужие правила» — весь набор стандарта: нарушение одно, и второе замечание
// значило бы, что фикстура не минимальна. У правила практики пункта стандарта
// нет вовсе, поэтому «чужие» для него — ДРУГИЕ правила практики: нарушение одного
// совета не должно задевать соседний, иначе пара доказывает не то, что заявляет.
const PRACTICE_RULE_IDS = new Set(PRACTICE.map((r) => r.id));
const standardFixtures = withFixture.filter((id) => !PRACTICE_RULE_IDS.has(id));
const practiceFixtures = withFixture.filter((id) => PRACTICE_RULE_IDS.has(id));

await check('фикстуры: каждая читается без починок и пересохраняется байт в байт', async () => {
  // Фикстура — не «примерно такая» модель: она лежит в репозитории как эталон,
  // и её байты кто-то будет сравнивать. Круг `serialize(deserialize(x))` ловит
  // и починки загрузчика (нарушение, которое схема не выражает, — это не
  // фикстура), и ручную правку, из-за которой файл перестал быть каноническим
  // (порядок ключей, пустые поля, значения по умолчанию).
  const broken = [];
  for (const file of files) {
    const text = await readFile(path.join(DATA, 'rules', file), 'utf8');
    const repairs = [];
    let back;
    try {
      back = deserialize(text, { repairs });
    } catch (e) {
      broken.push(`${file}: не читается — ${e.message}`);
      continue;
    }
    if (repairs.length) broken.push(`${file}: починки — ${repairs.join('; ')}`);
    else if (serialize(back) !== text) broken.push(`${file}: не байт в байт`);
  }
  assert(!broken.length, `неканонические фикстуры: ${broken.slice(0, 5).join(' | ')}`);
  return `${files.length} файлов, 0 починок, круг байт в байт`;
});

await check('фикстуры: у каждого проверяемого правила стандарта есть пара', async () => {
  const implementedIds = ruleset.rules.filter((r) => r.fn).map((r) => r.id);
  const missing = implementedIds.filter((id) => !standardFixtures.includes(id));
  assert(!missing.length, `нет фикстур: ${missing.join(', ')}`);
  const extra = standardFixtures.filter((id) => !implementedIds.includes(id));
  assert(!extra.length, `фикстуры без правила: ${extra.join(', ')}`);
  return `${standardFixtures.length} правил × (нарушение + контроль)`;
});

await check('фикстуры практики: у каждого из 13 советов есть пара', async () => {
  const missing = [...PRACTICE_RULE_IDS].filter((id) => !practiceFixtures.includes(id));
  assert(!missing.length, `нет пар у советов: ${missing.join(', ')}`);
  assert(practiceFixtures.length === PRACTICE_RULE_IDS.size,
    `пар практики ${practiceFixtures.length}, а советов ${PRACTICE_RULE_IDS.size}`);
  return `${practiceFixtures.length} советов × (нарушение + контроль)`;
});

for (const id of standardFixtures) {
  await check(`${id}: нарушение поймано`, async () => {
    const model = await loadModel('rules', `${id}.json`);
    const hits = ruleset.run(model).filter((f) => f.ruleId === id);
    assert(hits.length, `правило не сработало на ${id}.json`);
    for (const h of hits) assert(h.targets.length, `${id}: замечание без виноватого`);
    return `${hits.length} зам.: ${hits.map((h) => h.detail).join('; ')}`;
  });

  // Фикстуры стандарта нарочно минимальны (один элемент без связей, пара фигур),
  // поэтому слой практики на них законно ругается — его проверяют своей парой
  // моделей ниже. Здесь важно, что нарушено ровно одно правило стандарта.
  await check(`${id}: чужие правила молчат`, async () => {
    const model = await loadModel('rules', `${id}.json`);
    const others = ruleset.run(model).filter((f) => f.ruleId !== id);
    assert(!others.length, `сработало лишнее: ${describe(others)}`);
    return 'только своё правило';
  });

  await check(`${id}: контрольная модель чиста`, async () => {
    const model = await loadModel('rules', `${id}.ok.json`);
    const hits = ruleset.run(model);
    assert(!hits.length, `на ${id}.ok.json сработало: ${describe(hits)}`);
    return 'ни одного замечания';
  });
}

// Советы практики: пара моделей в файлах, а не в коде. Модели в коде ниже
// остаются — они проверяют границы (`STANDALONE`, `hasAnyView`, дубль по ролям),
// а пара в файлах доказывает ровно то, чего корпус доказать не может:
// СРАБАТЫВАНИЕ. Корпус — 48 правильных моделей — доказывает только отсутствие
// ложных срабатываний.
const PRACTICE_NO_TARGET = new Set(['name-not-clash']);

for (const id of practiceFixtures) {
  await check(`${id}: нарушение поймано (фикстура слоя практики)`, async () => {
    const model = await loadModel('rules', `${id}.json`);
    const hits = both.run(model).filter((f) => f.ruleId === id);
    assert(hits.length, `совет не сработал на ${id}.json`);
    for (const h of hits) {
      assert(h.basis === 'practice', `${id}: замечание не из слоя практики`);
      assert(h.clause === null && h.constraint === null, `${id}: у совета появился пункт стандарта`);
      assert(PRACTICE_NO_TARGET.has(id) || h.targets.length, `${id}: замечание без виноватого`);
    }
    return `${hits.length} зам.: ${hits.map((h) => h.detail).join('; ')}`;
  });

  // «Чужие» для совета — другие советы, а не стандарт: пункта у практики нет,
  // и слой стандарта к ней отношения не имеет. Проверяется именно это.
  await check(`${id}: чужие правила практики молчат`, async () => {
    const model = await loadModel('rules', `${id}.json`);
    const others = both.run(model).filter((f) => f.basis === 'practice' && f.ruleId !== id);
    assert(!others.length, `сработал чужой совет: ${describe(others)}`);
    return 'только свой совет';
  });

  await check(`${id}: контрольная модель чиста`, async () => {
    const model = await loadModel('rules', `${id}.ok.json`);
    const hits = both.run(model);
    assert(!hits.length, `на ${id}.ok.json сработало: ${describe(hits)}`);
    return 'ни одного замечания — ни стандарта, ни практики';
  });
}

/* ------------------------------------- границы CombinedFragment */

await check('opt_loop_break_neg: фрагмент с нулём операндов молчит (граница)', async () => {
  // По букве OCL `operand->size()=1` свежий opt — нарушение, но операндов у
  // него ещё нет: правило обязано молчать, иначе оно ругается на каждый новый
  // фрагмент. Договорённость записана в hint, а не только в коде.
  const rule = ruleset.rules.find((r) => r.id === 'opt_loop_break_neg');
  assert(rule, 'правила opt_loop_break_neg нет в наборе');
  assert(/без операндов/i.test(rule.hint), `в hint не сказано про ноль операндов: «${rule.hint}»`);
  const model = await loadModel('rules', 'opt_loop_break_neg.ok.json');
  const fresh = model.elements.find((e) => e.id === 'e4');
  assert(fresh?.kind === 'fragment' && fresh.operator === 'opt', 'в контрольной фикстуре нет свежего opt');
  assert(!Array.isArray(fresh.operands) || fresh.operands.length === 0,
    'у свежего opt появились операнды — граница не проверена');
  const hits = ruleset.run(model).filter((f) => f.ruleId === 'opt_loop_break_neg');
  assert(!hits.length, `правило сработало на фрагменте без операндов: ${describe(hits)}`);
  return 'свежий opt без операндов: 0 замечаний, договорённость записана в hint';
});

await check('break: объемлющий фрагмент ищется по ownerId; верхний уровень и невыведенное покрытие молчат', async () => {
  const model = await loadModel('rules', 'break.ok.json');
  const nested = model.elements.find((e) => e.id === 'e5');
  const top = model.elements.find((e) => e.id === 'e6');
  const underived = model.elements.find((e) => e.id === 'e8');
  const outerEmpty = model.elements.find((e) => e.id === 'e7');
  assert(nested?.ownerId === 'e4', 'вложенный break не связан с объемлющим по ownerId');
  assert(!top?.ownerId, 'верхний break получил владельца — граница не проверена');
  assert(underived?.ownerId === 'e7', 'в контрольной фикстуре нет break с невыведенным покрытием');
  assert(!(outerEmpty?.operands?.[0]?.messages ?? []).length,
    'у внешнего фрагмента появились сообщения — граница «покрытие не выведено» не проверена');
  const hits = ruleset.run(model).filter((f) => f.ruleId === 'break');
  assert(!hits.length, `на контрольной модели break сработало: ${describe(hits)}`);
  return 'вложенный break покрывает все линии; верхний и с невыведенным покрытием молчат';
});

await check('opt_loop_break_neg: все пять операторов списка ловятся, alt и par — нет', async () => {
  // Набор операторов — часть правила, а не деталь реализации: пропущенный
  // `assert` или `neg` не поймает фикстура с одним `loop`.
  const frag = (id, operator) => ({
    id, kind: 'fragment', name: id, operator,
    operands: [{ id: 'o1', guard: '', messages: [] }, { id: 'o2', guard: '', messages: [] }],
  });
  const model = {
    schema: 'uml-model/3', id: 'm-operators', name: 'Операторы', elements: [
      frag('e-opt', 'opt'), frag('e-loop', 'loop'), frag('e-break', 'break'),
      frag('e-assert', 'assert'), frag('e-neg', 'neg'),
      frag('e-alt', 'alt'), frag('e-par', 'par'), frag('e-critical', 'critical'),
    ], relationships: [], diagrams: [],
  };
  const hits = ruleset.run(model).filter((f) => f.ruleId === 'opt_loop_break_neg');
  const caught = hits.map((h) => h.targets.join()).sort().join(',');
  assert(hits.length === 5, `поймано ${hits.length} фрагментов, а ждали 5: ${caught}`);
  assert(caught === 'e-assert,e-break,e-loop,e-neg,e-opt', `не тот набор операторов: ${caught}`);
  return 'пойманы opt, loop, break, assert, neg; alt, par, critical молчат';
});

/* -------------------------------------------- правила практики: модели */

// Модели собраны здесь, а не файлами: правила практики проверяют не констрейнт
// стандарта, а взгляд на модель и на лист, и такую пару проще прочитать рядом с
// утверждением. Фикстуры стандарта остались файлами — их читает ещё и панель.
const el = (id, kind, name = '') => ({ id, kind, name });
const rel = (id, kind, from, to) => ({ id, kind, name: '', from, to });
const shape = (id, elementId) => ({ id, elementId, x: 40, y: 40, w: 180, h: 90 });
const link = (id, relId, fromShape, toShape) => ({
  id, relId, from: { shapeId: fromShape, side: 'right', t: 0.5 }, to: { shapeId: toShape, side: 'left', t: 0.5 },
});
const diagram = (id, name, shapes = [], links = []) => ({ id, name, kind: 'class', shapes, links });
const model = ({ elements = [], relationships = [], diagrams = [] }) => ({
  schema: 'uml-model/3', id: 'm-practice', name: 'Проверка практики', elements, relationships, diagrams,
  currentDiagramId: diagrams[0]?.id ?? null,
});

const PRACTICE_CASES = [
  {
    id: 'element-isolated',
    bad: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент'), el('e3', 'class', 'Отчёт')],
      relationships: [rel('r1', 'association', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2'), shape('s3', 'e3')],
        [link('l1', 'r1', 's1', 's2')])],
    }),
    ok: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент'), el('e3', 'class', 'Отчёт')],
      relationships: [rel('r1', 'association', 'e1', 'e2'), rel('r2', 'association', 'e3', 'e1')],
      diagrams: [diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2'), shape('s3', 'e3')],
        [link('l1', 'r1', 's1', 's2'), link('l2', 'r2', 's3', 's1')])],
    }),
    targets: ['e3'],
  },
  {
    id: 'element-not-on-any-diagram',
    // Пакет взят нарочно: у класса, которого нет ни на одном листе, честно
    // горит ещё и «элемент изолирован» — связь такого элемента негде нарисовать.
    // Такой случай проверяется отдельно ниже.
    bad: model({
      elements: [el('e1', 'package', 'Приложение'), el('e2', 'package', 'Модуль отчётов')],
      diagrams: [diagram('d1', 'Диаграмма пакетов', [shape('s1', 'e2')])],
    }),
    ok: model({
      elements: [el('e1', 'package', 'Приложение'), el('e2', 'package', 'Модуль отчётов')],
      diagrams: [diagram('d1', 'Диаграмма пакетов', [shape('s1', 'e1'), shape('s2', 'e2')])],
    }),
    targets: ['e1'],
  },
  {
    id: 'element-unnamed',
    bad: model({
      elements: [el('e1', 'class', ''), el('e2', 'class', 'Клиент')],
      relationships: [rel('r1', 'association', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2')],
        [link('l1', 'r1', 's1', 's2')])],
    }),
    ok: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
      relationships: [rel('r1', 'association', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2')],
        [link('l1', 'r1', 's1', 's2')])],
    }),
    targets: ['e1'],
  },
  {
    id: 'relationship-duplicate',
    bad: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
      relationships: [rel('r1', 'association', 'e1', 'e2'), rel('r2', 'association', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2')],
        [link('l1', 'r1', 's1', 's2'), link('l2', 'r2', 's1', 's2')])],
    }),
    ok: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
      relationships: [rel('r1', 'association', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2')],
        [link('l1', 'r1', 's1', 's2')])],
    }),
    targets: ['r2'],
  },
  {
    id: 'relationship-not-on-any-diagram',
    // Пакеты вместо классов: у пакета фигура без связей — норма, поэтому
    // рядом не загорается «фигура не соединена ни с одной».
    bad: model({
      elements: [el('e1', 'package', 'Приложение'), el('e2', 'package', 'Библиотека')],
      relationships: [rel('r1', 'dependency', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма пакетов', [shape('s1', 'e1'), shape('s2', 'e2')])],
    }),
    ok: model({
      elements: [el('e1', 'package', 'Приложение'), el('e2', 'package', 'Библиотека')],
      relationships: [rel('r1', 'dependency', 'e1', 'e2')],
      diagrams: [diagram('d1', 'Диаграмма пакетов',
        [shape('s1', 'e1'), shape('s2', 'e2')],
        [link('l1', 'r1', 's1', 's2')])],
    }),
    targets: ['r1'],
  },
  {
    id: 'shape-isolated-on-diagram',
    bad: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
      relationships: [rel('r1', 'association', 'e1', 'e2')],
      diagrams: [
        diagram('d1', 'Диаграмма классов',
          [shape('s1', 'e1'), shape('s2', 'e2')],
          [link('l1', 'r1', 's1', 's2')]),
        diagram('d2', 'Схема выгрузки', [shape('s3', 'e1')]),
      ],
    }),
    ok: model({
      elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
      relationships: [rel('r1', 'association', 'e1', 'e2')],
      diagrams: [
        diagram('d1', 'Диаграмма классов',
          [shape('s1', 'e1'), shape('s2', 'e2')],
          [link('l1', 'r1', 's1', 's2')]),
        diagram('d2', 'Схема выгрузки',
          [shape('s3', 'e1'), shape('s4', 'e2')],
          [link('l2', 'r1', 's3', 's4')]),
      ],
    }),
    targets: ['e1'],
  },
];

const practiceFindings = (m) => both.run(m);
const idsOf = (m) => new Set([...m.elements.map((e) => e.id), ...m.relationships.map((r) => r.id)]);

for (const c of PRACTICE_CASES) {
  await check(`${c.id}: нарушение поймано`, async () => {
    const hits = practiceFindings(c.bad).filter((f) => f.ruleId === c.id);
    assert(hits.length, `правило не сработало на модели нарушения`);
    const got = hits.map((h) => h.targets.join('+')).join(',');
    assert(got === c.targets.join(','), `не тот виноватый: ${got}, ждали ${c.targets.join(',')}`);
    const known = idsOf(c.bad);
    for (const h of hits) {
      assert(h.targets.length, `${c.id}: замечание без виноватого`);
      for (const t of h.targets) assert(known.has(t), `${c.id}: цель ${t} — не id модели`);
    }
    return `${hits.length} зам.: ${hits.map((h) => h.detail).join('; ')}`;
  });

  await check(`${c.id}: чужие правила молчат`, async () => {
    const others = practiceFindings(c.bad).filter((f) => f.ruleId !== c.id);
    assert(!others.length, `сработало лишнее: ${describe(others)}`);
    return 'только своё правило';
  });

  await check(`${c.id}: контрольная модель чиста`, async () => {
    const hits = practiceFindings(c.ok);
    assert(!hits.length, `на контрольной модели сработало: ${describe(hits)}`);
    return 'ни одного замечания';
  });
}

/* --------------------------------------- ссылки модели: refs.js и границы */

// Модуль `src/rules/refs.js` — общая часть четырёх советов о ссылках. Здесь
// проверяется то, ради чего он написан, а не то, что он «есть»:
//   * индекс находит по одному id и элемент, и связь: в модели это два разных
//     списка, и правило не должно знать, в каком искать;
//   * цепочка владельцев обрывается на цикле, а не висит: цикл ловит
//     element-own-self, но упавшее правило не имеет права унести прогон;
//   * `diagramOf` отдаёт ПЕРВЫЙ по порядку модели лист — по нему панель ведёт
//     клик, и «последний» увёл бы не туда;
//   * пустая, битая и неразрешённая ссылки молчат во всех четырёх правилах:
//     договорённость из `hint` проверяется прогоном, а не словами.
const { refIndex, resolve, ownerChain, diagramOf } = await load('src/rules/refs.js');

const REF_RULES = ['object-classifier-kind', 'action-behavior-is-activity',
  'swimlane-represents-kind', 'interaction-use-refers-kind'];

await check('refs.js: индекс находит элемент и связь по одному id', async () => {
  const m = model({
    elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
    relationships: [rel('r1', 'association', 'e1', 'e2')],
    diagrams: [diagram('d1', 'Диаграмма классов', [shape('s1', 'e1')])],
  });
  const ix = refIndex(m);
  assert(ix.elements.size === 2 && ix.relationships.size === 1,
    `в индексе ${ix.elements.size} элементов и ${ix.relationships.size} связей`);
  assert(resolve(m, 'e1')?.kind === 'class', 'элемент не нашёлся');
  assert(resolve(m, 'r1')?.kind === 'association', 'связь не нашлась');
  assert(resolve(m, 'nope') === null, 'битый id вернул не null');
  assert(resolve(m, null) === null && resolve(m, '') === null, 'пустой id вернул не null');
  // Индекс и разовый поиск обязаны отвечать одинаково — иначе правило, зовущее
  // `resolve` с индексом, судило бы не ту модель.
  assert(resolve(m, 'e2', ix)?.name === 'Клиент', 'поиск по индексу разошёлся с разовым');
  return `${ix.elements.size} элемента + ${ix.relationships.size} связь, битый id — null`;
});

await check('refs.js: цепочка владельцев обрывается на цикле', async () => {
  // Цикл по ownerId в файле снимает загрузчик, а в модели, собранной в памяти,
  // он возможен. `ownerChain` обязан вернуть конечную цепочку, а не зависнуть.
  const m = model({
    elements: [
      { ...el('e1', 'package', 'A'), ownerId: 'e2' },
      { ...el('e2', 'package', 'B'), ownerId: 'e1' },
      { ...el('e3', 'package', 'C'), ownerId: 'e2' },
    ],
  });
  const chain = ownerChain(m, 'e3');
  assert(chain.length === 2, `цепочка из ${chain.length} звеньев: ${chain.map((x) => x.id).join('→')}`);
  assert(chain.map((x) => x.id).join(',') === 'e2,e1', `цепочка ${chain.map((x) => x.id).join('→')}`);
  assert(ownerChain(m, 'nope').length === 0, 'у неизвестного id появилась цепочка');
  return chain.map((x) => x.id).join('→');
});

await check('refs.js: diagramOf — первый лист по порядку модели', async () => {
  const m = model({
    elements: [el('e1', 'class', 'Заказ')],
    diagrams: [
      diagram('d1', 'Первый лист', [shape('s1', 'e1')]),
      diagram('d2', 'Второй лист', [shape('s2', 'e1')]),
    ],
  });
  assert(diagramOf(m, 'e1')?.id === 'd1', `diagramOf вернул «${diagramOf(m, 'e1')?.id}»`);
  assert(diagramOf(m, 'nope') === null, 'diagramOf на неизвестный id вернул лист');
  return 'd1 (первый по порядку), для неизвестного — null';
});

await check('ссылки: пустая, битая и неразрешённая ссылки молчат во всех четырёх правилах', async () => {
  // Три случая, в которых правило обязано молчать (и это записано в hint):
  //   * ссылка пустая — поле не заполнено;
  //   * ссылка битая — id, которого нет в модели (в файле её снимает загрузчик;
  //     здесь она пришла из модели, собранной в памяти);
  //   * лист не найден — refersTo называет подпоток, которого нет в файле; так
  //     лежит учебный корпус (12 ссылок на подпотоки), и
  //     ругаться на них значило бы красить корпус.
  const m = model({
    elements: [
      el('c1', 'class', 'Заказ'),
      el('p1', 'package', 'Подсистема заказов'),
      el('o1', 'object', ':Заказ'),                                    // пусто
      el('o2', 'object', ':Клиент', { classifierId: 'nope' }),         // битая
      el('a1', 'action', 'Оформить'),                                  // пусто
      el('a2', 'action', 'Согласовать', { behaviorRef: 'nope' }),      // битая
      el('s1', 'swimlane', 'Студент'),                                 // пусто
      el('s2', 'swimlane', 'Преподаватель', { represents: 'nope' }),   // битая
      el('iu1', 'interactionUse', 'Оплата'),                           // пусто
      el('iu2', 'interactionUse', 'Возврат', { refersTo: 'CreateSchedule Subflow' }),
      el('iu3', 'interactionUse', 'Доставка', { refersTo: 'nope-id' }), // битая
    ],
    relationships: [rel('r1', 'association', 'c1', 'o1'), rel('r2', 'association', 'p1', 'o2')],
    diagrams: [diagram('d1', 'Ссылки без цели',
      [shape('s1', 'c1'), shape('s2', 'o1'), shape('s3', 'o2')])],
  });
  const hits = both.run(m).filter((f) => REF_RULES.includes(f.ruleId));
  assert(!hits.length, `правила о ссылках сработали на пустом/битом: ${describe(hits)}`);
  return '4 правила × 3 границы: 0 замечаний';
});

await check('ссылки: лист взаимодействия, на котором стоит сама ссылка, — нарушение', async () => {
  // Единственный случай, где мало «вид листа подходящий»: ссылка на себя не
  // разворачивается никогда, даже если лист — последовательность. Второй лист
  // рядом нужен, чтобы у ссылки было куда смотреть без нарушения.
  // Листы строятся здесь явно: у общей `diagram()` вид всегда `class`, а
  // проверяется как раз вид листа.
  const seq = (id, name, shapes, links = []) => ({ id, name, kind: 'sequence', shapes, links });
  const m = model({
    elements: [
      el('e1', 'lifeline', ':Клиент'),
      el('e2', 'lifeline', ':Сервер'),
      { ...el('e3', 'interactionUse', 'Оплата'), refersTo: 'd1' },
      { ...el('e6', 'interactionUse', 'Возврат'), refersTo: 'e6' },
      el('e4', 'lifeline', ':Касса'),
      el('e5', 'lifeline', ':Банк'),
    ],
    relationships: [rel('r1', 'message', 'e1', 'e2'), rel('r2', 'message', 'e4', 'e5')],
    diagrams: [
      seq('d1', 'Заказ', [shape('s1', 'e1'), shape('s2', 'e2'), shape('s3', 'e3'), shape('s6', 'e6')],
        [link('l1', 'r1', 's1', 's2')]),
      seq('d2', 'Оплата', [shape('s4', 'e4'), shape('s5', 'e5')],
        [link('l2', 'r2', 's4', 's5')]),
    ],
  });
  const hits = both.run(m).filter((f) => f.ruleId === 'interaction-use-refers-kind');
  // Две формы петли, и обе — «на себя»: ссылка на лист, где она нарисована, и
  // ссылка на собственный id элемента. Первая не разворачивается, вторая не
  // называет лист вовсе.
  const byTarget = new Map(hits.map((h) => [h.targets.join(), h.detail]));
  assert(hits.length === 2, `замечаний ${hits.length}, а ждали два: ${describe(hits)}`);
  assert(byTarget.has('e3') && byTarget.has('e6'), `виноваты не те: ${[...byTarget.keys()].join(',')}`);
  assert(/на котором стоит сама/.test(byTarget.get('e3')), `detail e3: «${byTarget.get('e3')}»`);
  assert(/на себя/.test(byTarget.get('e6')), `detail e6: «${byTarget.get('e6')}»`);
  return `${byTarget.get('e3')} | ${byTarget.get('e6')}`;
});

await check('ссылки: у каждого из четырёх советов есть пара фикстур и своё правило', async () => {
  // Пара фикстур у совета доказывает СРАБАТЫВАНИЕ (корпус доказывает только
  // отсутствие ложных срабатываний), поэтому «пара есть» — отдельное условие.
  const missing = REF_RULES.filter((id) => !practiceFixtures.includes(id));
  assert(!missing.length, `нет пары фикстур: ${missing.join(', ')}`);
  const unknown = REF_RULES.filter((id) => !both.rules.some((r) => r.id === id && r.basis === 'practice'));
  assert(!unknown.length, `нет правила практики: ${unknown.join(', ')}`);
  const checks = REF_RULES.filter((id) => !PRACTICE_CHECKS.has(id));
  assert(!checks.length, `проверки нет в PRACTICE_CHECKS: ${checks.join(', ')}`);
  return `${REF_RULES.length} правила: пара, слой, реестр`;
});

/* --------------------- диаграмма последовательности: два новых совета */

// Разбор подписи — отдельная функция, потому что от неё зависит вердикт обоих
// концов сообщения. Ошибка в разборе (`read()` ≠ `read`) покрасила бы корпус
// или, наоборот, ослепила правило; поэтому случаи названы явно.
const { operationName } = await load('src/rules/sequence.js');

await check('message-signature-operation: имя операции — до «(» или «:»', async () => {
  const cases = [
    ['updateStudent(st: Student)', 'updateStudent'],
    ['ok: boolean', 'ok'],
    ['read()', 'read'],
    ['createOrder', 'createOrder'],
    ['+send(st: Student)', 'send'],
    ['  ', ''],
    ['(st: Student)', ''],
  ];
  for (const [input, want] of cases) {
    const got = operationName(input);
    assert(got === want, `operationName(«${input}») = «${got}», а ждали «${want}»`);
  }
  return cases.map(([i, w]) => `«${i}» → «${w}»`).join('; ');
});

await check('lifeline-represents-classifier: пусто и битая ссылка молчат, не-классификатор ловится', async () => {
  // Проверка положительная: «цель — классификатор». Поэтому актёр, класс и
  // компонент законны, а пакет, заметка, состояние и другая линия жизни — нет.
  // Пустая и битая ссылки названы в hint и обязаны молчать: первую не судят,
  // вторую снимает загрузчик.
  const m = model({
    elements: [
      el('L0', 'lifeline', ':Без классификатора'),                  // пусто — молчим
      { ...el('L1', 'lifeline', ':Битая'), represents: 'nope' },    // битая — молчим
      { ...el('L2', 'lifeline', ':Пакет'), represents: 'p1' },      // нарушение
      { ...el('L3', 'lifeline', ':Заметка'), represents: 'n1' },    // нарушение
      { ...el('L4', 'lifeline', ':Состояние'), represents: 's1' },  // нарушение
      { ...el('L5', 'lifeline', ':Линия'), represents: 'L6' },      // нарушение
      { ...el('L6', 'actorLifeline', ':Актёр'), represents: 'a1' }, // классификатор
      { ...el('L7', 'lifeline', ':Класс'), represents: 'c1' },      // классификатор
      { ...el('L8', 'lifeline', ':Компонент'), represents: 'comp1' }, // классификатор
      el('p1', 'package', 'Подсистема'),
      el('n1', 'note', 'Заметка'),
      el('s1', 'state', 'Состояние'),
      el('a1', 'actor', 'Актёр'),
      el('c1', 'class', 'Класс'),
      el('comp1', 'component', 'Компонент'),
    ],
  });
  const hits = both.run(m).filter((f) => f.ruleId === 'lifeline-represents-classifier');
  const caught = hits.map((h) => h.targets.join()).sort().join(',');
  assert(caught === 'L2,L3,L4,L5', `пойманы «${caught}», а ждали L2,L3,L4,L5`);
  assert(hits.every((h) => h.basis === 'practice' && h.level === 'warning'),
    'замечание не слоя практики или не warning');
  return `${hits.length} нарушения: пакет, заметка, состояние, линия жизни; класс, актёр и компонент законны`;
});

await check('message-signature-operation: границы «нет represents», «нет операций», «пустая подпись»', async () => {
  // Модель собирается под каждый случай: линия жизни получателя, линия жизни
  // отправителя, два класса и пакет. `ops` — только у того класса, у которого
  // список заполнен; остальные элементы `operations` не несут вовсе, и это
  // законный «списка нет».
  const ops = (...names) => names.map((name) => ({ name }));
  const build = ({ signature, recv, send, recvOps, sendOps, kind = 'message' }) => model({
    elements: [
      { ...el('L1', 'lifeline', ':Отправитель'), ...(send ? { represents: send } : {}) },
      { ...el('L2', 'lifeline', ':Получатель'), ...(recv ? { represents: recv } : {}) },
      { ...el('c1', 'class', 'Класс отправителя'), ...(sendOps ? { operations: sendOps } : {}) },
      { ...el('c2', 'class', 'Класс получателя'), ...(recvOps ? { operations: recvOps } : {}) },
      el('p1', 'package', 'Пакет'),
    ],
    relationships: [
      { id: 'r1', kind, from: 'L1', to: 'L2', name: 'вызов()', ...(signature ? { signature } : {}) },
      rel('r2', 'association', 'c1', 'c2'),
    ],
  });
  const fired = (m) => both.run(m).filter((f) => f.ruleId === 'message-signature-operation');

  const silent = [
    ['пустая сигнатура', build({ recv: 'c2', recvOps: ops('read()') })],
    ['у получателя нет represents', build({ signature: 'delete()', recvOps: ops('read()') })],
    ['у классификатора нет операций', build({ signature: 'delete()', recv: 'c2' })],
    ['операция нашлась у получателя', build({ signature: 'read(id: int)', recv: 'c2', recvOps: ops('read()') })],
    ['операция нашлась у отправителя', build({
      signature: 'delete()', recv: 'c2', recvOps: ops('read()'), send: 'c1', sendOps: ops('delete()'),
    })],
    ['получатель представляет пакет', build({ signature: 'delete()', recv: 'p1', recvOps: ops('read()') })],
    ['битая ссылка represents', build({ signature: 'delete()', recv: 'nope' })],
  ];
  for (const [what, m] of silent) {
    const hits = fired(m);
    assert(!hits.length, `${what}: сработало — ${describe(hits)}`);
  }

  const loud = [
    ['нет операции ни у одного конца', build({
      signature: 'delete(st: Student)', recv: 'c2', recvOps: ops('read()', 'write()'),
      send: 'c1', sendOps: ops('send()'),
    })],
    ['подпись ответа', build({ signature: 'delete()', recv: 'c2', recvOps: ops('read()'), kind: 'reply' })],
    ['создание', build({ signature: 'delete()', recv: 'c2', recvOps: ops('read()'), kind: 'createMessage' })],
    ['уничтожение', build({ signature: 'delete()', recv: 'c2', recvOps: ops('read()'), kind: 'destroyMessage' })],
  ];
  for (const [what, m] of loud) {
    const hits = fired(m);
    assert(hits.length === 1, `${what}: замечаний ${hits.length}, а ждали одно`);
    assert(hits[0].targets.join() === 'r1', `${what}: виновата не связь — ${hits[0].targets.join()}`);
    assert(/delete/.test(hits[0].detail), `${what}: detail не называет операцию — «${hits[0].detail}»`);
  }
  return `${silent.length} границ молчат, ${loud.length} вида связи ловятся`;
});

await check('relationship-duplicate: роли и кратности различают связи, полное совпадение — дубль', async () => {
  // Две ассоциации между одной парой — законный UML, если их можно различить
  // (пособие, упражнение 4.1: полюсам дают имена именно для этого). Дубль —
  // только полное совпадение вида, концов, ролей, кратностей, имени,
  // навигации и агрегации.
  const withRels = (rels) => model({
    elements: [el('e1', 'class', 'CourseOffering'), el('e2', 'class', 'Schedule')],
    relationships: rels,
    diagrams: [diagram('d1', 'Диаграмма классов',
      [shape('s1', 'e1'), shape('s2', 'e2')],
      rels.map((r, i) => link(`l${i + 1}`, r.id, 's1', 's2')))],
  });
  const roles = withRels([
    { ...rel('r1', 'association', 'e1', 'e2'), fromRole: 'primary', fromMultiplicity: '0..4', toMultiplicity: '*' },
    { ...rel('r2', 'association', 'e1', 'e2'), fromRole: 'alternative', fromMultiplicity: '0..2', toMultiplicity: '*' },
  ]);
  const mults = withRels([
    { ...rel('r1', 'association', 'e1', 'e2'), fromMultiplicity: '1', toMultiplicity: '*' },
    { ...rel('r2', 'association', 'e1', 'e2'), fromMultiplicity: '0..1', toMultiplicity: '*' },
  ]);
  const twins = withRels([
    { ...rel('r1', 'association', 'e1', 'e2'), fromMultiplicity: '1', toMultiplicity: '*' },
    { ...rel('r2', 'association', 'e1', 'e2'), fromMultiplicity: '1', toMultiplicity: '*' },
  ]);
  const dup = (m) => practiceFindings(m).filter((f) => f.ruleId === 'relationship-duplicate');
  assert(!dup(roles).length, `разные роли сочтены дублем: ${describe(dup(roles))}`);
  assert(!dup(mults).length, `разные кратности сочтены дублем: ${describe(dup(mults))}`);
  assert(dup(twins).length === 1 && dup(twins)[0].targets.join() === 'r2',
    `одинаковые связи: ${describe(dup(twins))}`);
  return 'роли и кратности различают; полное совпадение — одно замечание на r2';
});

await check('element-not-on-any-diagram: класс вне всех листов ловится, рядом горит element-isolated', async () => {
  // Связь элемента, которого нет ни на одном листе, негде нарисовать — либо он
  // изолирован в модели, либо его связь не показана. Поэтому два замечания об
  // одном элементе здесь честные, а не дубль.
  // Пакет рядом нужен, чтобы на листе была хоть одна фигура: без видов правила
  // о диаграммах молчат (см. `hasAnyView` в practice.js).
  const m = model({
    elements: [el('e1', 'class', 'Заказ'), el('e2', 'package', 'Модуль отчётов')],
    diagrams: [diagram('d1', 'Диаграмма классов', [shape('s1', 'e2')])],
  });
  const fired = practiceFindings(m).map((f) => f.ruleId).sort();
  assert(fired.join(',') === 'element-isolated,element-not-on-any-diagram', `сработало: ${fired.join(', ')}`);
  const named = practiceFindings(m).find((f) => f.ruleId === 'element-not-on-any-diagram');
  assert(named.targets.join() === 'e1', `цель ${named.targets.join()}`);
  return 'два замечания об одном элементе: изолирован и не показан';
});

/* ------------------------------- честная диагностика: сбой и путь цикла */

// Упавшее правило подменяется на месте: `fn` живёт в объекте правила, поэтому
// достаточно сохранить старую функцию и вернуть её в `finally` — иначе сбой
// протёк бы в следующие проверки.
const breakRules = (ids, boom = () => { throw new Error('нарочно: проверка не смогла прочитать модель'); }) => {
  const saved = [];
  for (const id of ids) {
    const rule = ruleset.rules.find((r) => r.id === id);
    assert(rule, `правила «${id}» нет в наборе`);
    saved.push([rule, rule.fn]);
    rule.fn = boom;
  }
  return () => { for (const [rule, fn] of saved) rule.fn = fn; };
};

await check('упавшее правило не убивает прогон', async () => {
  const m = await loadModel('rules', 'mult-upper-ge-lower.json');
  const restore = breakRules(['generalization-cycle']);
  let findings;
  try {
    findings = ruleset.run(m);
  } finally {
    restore();
  }
  const normal = findings.filter((f) => f.ruleId === 'mult-upper-ge-lower');
  assert(normal.length === 1, `обычных замечаний ${normal.length}, а ждали одно`);
  const broken = findings.filter((f) => f.status === 'failed');
  assert(broken.length === 1, `замечаний-сбоев ${broken.length}, а ждали одно`);
  const [f] = broken;
  assert(f.ruleId === 'generalization-cycle', `сбой назвал правило «${f.ruleId}»`);
  assert(f.level === 'error', `уровень сбоя «${f.level}», а не error`);
  assert(f.detail.includes('нарочно: проверка не смогла прочитать модель'),
    `в detail нет текста ошибки: «${f.detail}»`);
  const counts = ruleset.counts(findings);
  assert(counts.failed === 1, `counts.failed ${counts.failed}, а не 1`);
  assert(counts.errors === 1, `counts.errors ${counts.errors}: сбой попал в ошибки?`);
  assert(counts.total === 1, `counts.total ${counts.total}: сбой попал в сумму?`);
  return `1 обычное замечание + 1 сбой, counts ${JSON.stringify(counts)}`;
});

await check('два упавших правила — две записи, каждая названа один раз', async () => {
  const m = await loadModel('rules', 'mult-upper-ge-lower.json');
  const restore = breakRules(['generalization-cycle', 'usecase-include-cycle']);
  let findings;
  try {
    findings = ruleset.run(m);
  } finally {
    restore();
  }
  const broken = findings.filter((f) => f.status === 'failed');
  assert(broken.length === 2, `сбоев ${broken.length}, а ждали две записи`);
  const ids = new Set(broken.map((f) => f.ruleId));
  assert(ids.size === 2, `правил среди сбоев ${ids.size}, а ждали два: ${[...ids].join(', ')}`);
  return `${broken.length} записи: ${[...ids].join(', ')}`;
});

await check('сбой проверки отличим от нарушения модели', async () => {
  const m = await loadModel('rules', 'mult-upper-ge-lower.json');
  const restore = breakRules(['generalization-cycle']);
  let findings;
  try {
    findings = ruleset.run(m);
  } finally {
    restore();
  }
  const normal = findings.find((f) => f.ruleId === 'mult-upper-ge-lower');
  const broken = findings.find((f) => f.status === 'failed');
  assert(normal && broken, 'нет пары «нарушение + сбой»');
  assert(normal.status === undefined, `у нарушения появился status «${normal.status}»`);
  assert(broken.status === 'failed', `у сбоя status «${broken.status}»`);
  assert(Array.isArray(broken.targets) && broken.targets.length === 0,
    `targets сбоя: ${broken.targets?.join(',') || '—'} — виноватого быть не должно`);
  assert(broken.message.includes(broken.ruleId), `message «${broken.message}» не называет правило`);
  return 'нарушение без status, сбой со status «failed» и пустыми targets';
});

// Циклы собраны в коде, а не файлами: файл в tests/data/rules попал бы в
// общий цикл фикстур и потребовал бы пары «нарушение + контроль».
await check('generalization-cycle: путь из трёх классов', async () => {
  const m = model({
    elements: [el('a', 'class', 'Заказ'), el('b', 'class', 'Клиент'), el('c', 'class', 'Отчёт')],
    relationships: [
      rel('r1', 'generalization', 'a', 'b'),
      rel('r2', 'generalization', 'b', 'c'),
      rel('r3', 'generalization', 'c', 'a'),
    ],
  });
  const hits = ruleset.run(m).filter((f) => f.ruleId === 'generalization-cycle');
  assert(hits.length === 3, `замечаний ${hits.length}, а ждали три — по одному на элемент`);
  const want = { a: 'a,b,c', b: 'b,c,a', c: 'c,a,b' };
  for (const h of hits) {
    const first = h.targets[0];
    assert(h.targets.length === 3, `«${first}»: targets ${h.targets.join(',')} — не путь из трёх`);
    assert(h.targets.join(',') === want[first], `«${first}»: путь ${h.targets.join(',')}, ждали ${want[first]}`);
    for (const name of ['Заказ', 'Клиент', 'Отчёт']) {
      assert(h.detail.includes(name), `«${first}»: detail «${h.detail}» не называет «${name}»`);
    }
    assert(/Цикл обобщения: «/.test(h.detail), `«${first}»: detail не называет путь: «${h.detail}»`);
  }
  return hits.map((h) => h.targets.join('→')).join('; ');
});

await check('generalization-cycle: самообобщение', async () => {
  const m = model({
    elements: [el('a', 'class', 'Заказ')],
    relationships: [rel('r1', 'generalization', 'a', 'a')],
  });
  const hits = ruleset.run(m).filter((f) => f.ruleId === 'generalization-cycle');
  assert(hits.length === 1, `замечаний ${hits.length}, а ждали одно`);
  assert(hits[0].targets.length === 1, `targets ${hits[0].targets.join(',')} — петля обязана остаться одной`);
  assert(hits[0].targets[0] === 'a', `цель «${hits[0].targets[0]}»`);
  assert(hits[0].detail.includes('Заказ'), `detail «${hits[0].detail}» не называет класс`);
  return hits[0].detail;
});

await check('usecase-include-cycle: путь из трёх вариантов использования', async () => {
  const m = model({
    elements: [
      el('a', 'usecase', 'Войти в систему'),
      el('b', 'usecase', 'Проверить пароль'),
      el('c', 'usecase', 'Открыть сеанс'),
    ],
    relationships: [
      rel('r1', 'include', 'a', 'b'),
      rel('r2', 'include', 'b', 'c'),
      rel('r3', 'include', 'c', 'a'),
    ],
  });
  const hits = ruleset.run(m).filter((f) => f.ruleId === 'usecase-include-cycle');
  assert(hits.length === 3, `замечаний ${hits.length}, а ждали три — по одному на элемент`);
  const want = { a: 'a,b,c', b: 'b,c,a', c: 'c,a,b' };
  for (const h of hits) {
    const first = h.targets[0];
    assert(h.targets.length === 3, `«${first}»: targets ${h.targets.join(',')} — не путь из трёх`);
    assert(h.targets.join(',') === want[first], `«${first}»: путь ${h.targets.join(',')}, ждали ${want[first]}`);
    for (const name of ['Войти в систему', 'Проверить пароль', 'Открыть сеанс']) {
      assert(h.detail.includes(name), `«${first}»: detail «${h.detail}» не называет «${name}»`);
    }
  }
  return hits.map((h) => h.targets.join('→')).join('; ');
});

await check('usecase-include-cycle: самовключение', async () => {
  const m = model({
    elements: [el('a', 'usecase', 'Войти в систему')],
    relationships: [rel('r1', 'include', 'a', 'a')],
  });
  const hits = ruleset.run(m).filter((f) => f.ruleId === 'usecase-include-cycle');
  assert(hits.length === 1, `замечаний ${hits.length}, а ждали одно`);
  assert(hits[0].targets.length === 1 && hits[0].targets[0] === 'a',
    `targets ${hits[0].targets.join(',')} — петля обязана остаться одной`);
  assert(hits[0].detail.includes('Войти в систему'), `detail «${hits[0].detail}» не называет вариант`);
  return hits[0].detail;
});

/* ---------------------------------- основные действующие лица варианта */

// Правило считает ЛИЦА, а не связи, и понимает навигацию буквально: основное
// лицо — актёр, чья ассоциация направлена ОТ него. Эти случаи не выводятся из
// пары фикстур, поэтому проверяются отдельно — на модели, собранной здесь же.
const ucModel = ({ elements, relationships }) => model({ elements, relationships });








/* ------------------------------ одна битая связь — одно замечание (D9) */

await check('actor-association-targets: актёр↔актёр даёт ОДНО замечание, а не два', async () => {
  // Дефект D9: цикл по двум концам давал по замечанию с каждого конца, и одна
  // битая линия превращалась в две строки панели. Виновата связь, поэтому
  // замечание одно, а в тексте названы оба актёра — иначе непонятно, какую
  // линию править.
  const m = ucModel({
    elements: [el('a1', 'actor', 'Студент'), el('a2', 'actor', 'Профессор')],
    relationships: [rel('r1', 'association', 'a1', 'a2')],
  });
  const hits = both.run(m).filter((f) => f.ruleId === 'actor-association-targets');
  assert(hits.length === 1, `замечаний ${hits.length}, а ждали одно`);
  assert(hits[0].targets.join() === 'r1', `виновата не связь: ${hits[0].targets.join()}`);
  assert(hits[0].detail.includes('Студент') && hits[0].detail.includes('Профессор'),
    `detail «${hits[0].detail}» не называет обоих`);
  return hits[0].detail;
});

await check('actor-association-targets: актёр↔интерфейс по-прежнему одно замечание', async () => {
  // Обычный случай не должен был поехать от правки: одна линия — одно
  // замечание, и в нём назван второй конец.
  const m = ucModel({
    elements: [el('a', 'actor', 'Студент'), el('i', 'interface', 'Оплата')],
    relationships: [rel('r1', 'association', 'a', 'i')],
  });
  const hits = both.run(m).filter((f) => f.ruleId === 'actor-association-targets');
  assert(hits.length === 1, `замечаний ${hits.length}, а ждали одно`);
  assert(hits[0].detail.includes('Оплата'), `detail «${hits[0].detail}» не называет цель`);
  return hits[0].detail;
});

/* -------------------------------------------- список ненаписанных правил */



/* ------------------------------------------------- контракт замечания */

await check('замечание практики: basis practice, ссылок на стандарт нет, rationale есть', async () => {
  const hits = practiceFindings(PRACTICE_CASES[0].bad).filter((f) => f.basis === 'practice');
  assert(hits.length, 'практика не дала ни одного замечания');
  for (const f of hits) {
    assert(f.basis === 'practice', `basis «${f.basis}»`);
    assert(f.clause === null, `clause «${f.clause}» у практики`);
    assert(f.constraint === null, `constraint «${f.constraint}» у практики`);
    assert(f.page === null, `page «${f.page}» у практики`);
    assert(String(f.rationale ?? '').trim(), 'у практики пустой rationale');
    assert(!/спецификаци/i.test(f.message + f.hint + f.rationale), 'практика ссылается на стандарт словами');
  }
  return `${hits.length} зам., рациональное объяснение на месте`;
});

await check('замечание стандарта: basis uml, пункт есть, rationale пуст', async () => {
  const m = await loadModel('rules', 'mult-upper-ge-lower.json');
  const hits = both.run(m);
  assert(hits.length, 'стандарт не дал ни одного замечания');
  for (const f of hits) {
    assert(f.basis === 'uml', `basis «${f.basis}»`);
    assert(String(f.clause ?? '').trim(), 'у стандарта пустой пункт');
    assert(String(f.constraint ?? '').trim(), 'у стандарта пустое имя констрейнта');
    assert(f.rationale === null, `у стандарта rationale «${f.rationale}»`);
  }
  return `${hits.length} зам., п. ${hits[0].clause}`;
});

/* ---------------------------------------------------------- diagramId */

// `diagramId` — лист, к которому относится замечание. Он нужен панели, чтобы
// клик по замечанию открыл тот лист, где беда, а не первый, на котором элемент
// нарисован. Ставить его вправе только правило, которое судит лист; правило
// стандарта говорит о модели, поэтому у него всегда `null` — это значение
// «лист не назван», а не забытое поле.

await check('diagramId: у замечаний слоя стандарта всегда null', async () => {
  const m = await loadModel('rules', 'mult-upper-ge-lower.json');
  const hits = both.run(m).filter((f) => f.basis === 'uml');
  assert(hits.length, 'стандарт не дал ни одного замечания');
  for (const f of hits) {
    assert('diagramId' in f, `у замечания «${f.ruleId}» нет поля diagramId`);
    assert(f.diagramId === null, `«${f.ruleId}»: diagramId «${f.diagramId}», а стандарт лист не называет`);
  }
  // То же на модели с листом: у правила стандарта есть соблазн назвать лист,
  // на котором стоит виноватая связь, но его слой о листах не говорит.
  const withDiagram = model({
    elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
    relationships: [{
      id: 'r1', kind: 'association', name: '', from: 'e1', to: 'e2',
      fromMultiplicity: '5..2',
    }],
    diagrams: [diagram('d1', 'Диаграмма классов',
      [shape('s1', 'e1'), shape('s2', 'e2')],
      [link('l1', 'r1', 's1', 's2')])],
  });
  const onDiagram = both.run(withDiagram).filter((f) => f.basis === 'uml');
  assert(onDiagram.length, 'стандарт не сработал на модели с листом');
  for (const f of onDiagram) {
    assert(f.diagramId === null, `«${f.ruleId}» на модели с листом: diagramId «${f.diagramId}»`);
  }
  return `${hits.length + onDiagram.length} зам. стандарта, лист не назван ни у одного`;
});

await check('diagramId: shape-isolated-on-diagram несёт лист, где фигура одинока', async () => {
  // В фикстуре «Заказ» нарисован на двух листах: на «Диаграмме классов» он
  // соединён, на «Схеме выгрузки» — висит один. Замечание должно назвать
  // второй лист, а не первый по порядку модели.
  const m = PRACTICE_CASES.find((c) => c.id === 'shape-isolated-on-diagram').bad;
  const hits = practiceFindings(m).filter((f) => f.ruleId === 'shape-isolated-on-diagram');
  assert(hits.length === 1, `замечаний ${hits.length}, а ждали одно`);
  const [hit] = hits;
  const byId = new Map(m.diagrams.map((d) => [d.id, d]));
  assert(hit.diagramId === 'd2', `diagramId «${hit.diagramId}», а одинока фигура на «d2»`);
  assert(byId.has(hit.diagramId), `diagramId «${hit.diagramId}» — не лист этой модели`);
  // Данные и текст обязаны говорить об одном листе: иначе клик поведёт не туда,
  // куда зовёт `detail`.
  assert(hit.detail.includes(byId.get(hit.diagramId).name),
    `detail «${hit.detail}» не называет лист «${byId.get(hit.diagramId).name}»`);
  return `diagramId «${hit.diagramId}» = «${byId.get(hit.diagramId).name}»`;
});

await check('diagramId: одинокая на двух листах фигура даёт два замечания с разными листами', async () => {
  const m = model({
    elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент')],
    relationships: [rel('r1', 'association', 'e1', 'e2')],
    diagrams: [
      diagram('d1', 'Диаграмма классов',
        [shape('s1', 'e1'), shape('s2', 'e2')],
        [link('l1', 'r1', 's1', 's2')]),
      diagram('d2', 'Схема выгрузки', [shape('s3', 'e1')]),
      diagram('d3', 'Схема отчёта', [shape('s4', 'e1')]),
    ],
  });
  const hits = practiceFindings(m).filter((f) => f.ruleId === 'shape-isolated-on-diagram');
  assert(hits.length === 2, `замечаний ${hits.length}, а ждали два`);
  const diagrams = hits.map((f) => f.diagramId);
  assert(diagrams.join(',') === 'd2,d3', `листы замечаний: ${diagrams.join(', ') || '—'}`);
  assert(diagrams[0] !== diagrams[1], 'оба замечания назвали один лист');
  // Виноват в обоих случаях один и тот же элемент: разговор идёт о листах.
  assert(hits.every((f) => f.targets.join() === 'e1'), `цели: ${hits.map((f) => f.targets.join('+')).join(',')}`);
  return `два замечания: ${diagrams.join(' и ')}`;
});

await check('diagramId: остальные пять правил практики лист не называют', async () => {
  // Модель, на которой горит сразу несколько правил практики: безымянный класс,
  // дубль связи, класс не на листе. Ни одному из них лист не принадлежит.
  const m = model({
    elements: [el('e1', 'class', ''), el('e2', 'class', 'Клиент'), el('e3', 'class', 'Отчёт')],
    relationships: [rel('r1', 'association', 'e1', 'e2'), rel('r2', 'association', 'e1', 'e2')],
    diagrams: [diagram('d1', 'Диаграмма классов',
      [shape('s1', 'e1'), shape('s2', 'e2')],
      [link('l1', 'r1', 's1', 's2'), link('l2', 'r2', 's1', 's2')])],
  });
  const named = practiceFindings(m).filter((f) => f.ruleId !== 'shape-isolated-on-diagram');
  assert(named.length >= 3, `правил практики сработало ${named.length} — мало для проверки`);
  for (const f of named) {
    assert(f.diagramId === null, `«${f.ruleId}»: diagramId «${f.diagramId}» — лист называет только shape-isolated-on-diagram`);
  }
  const rules = [...new Set(named.map((f) => f.ruleId))];
  return `${rules.join(', ')}: diagramId null`;
});

await check('форма замечания: прежние поля на месте и с прежними значениями', async () => {
  // Поле добавилось, но замечание остаётся тем же объектом, что читает панель:
  // набор и порядок полей прежние, `diagramId` — последним.
  const want = 'ruleId,level,basis,message,detail,hint,clause,constraint,page,rationale,targets,diagramId';

  const m = await loadModel('rules', 'mult-upper-ge-lower.json');
  const [std] = both.run(m);
  const stdRule = both.rules.find((r) => r.id === std.ruleId);
  assert(Object.keys(std).join(',') === want, `поля замечания: ${Object.keys(std).join(',')}`);
  assert(std.ruleId === stdRule.id, `ruleId «${std.ruleId}»`);
  assert(std.level === stdRule.level, `level «${std.level}»`);
  assert(std.basis === 'uml', `basis «${std.basis}»`);
  assert(std.message === stdRule.message, 'message не из набора правил');
  assert(String(std.detail ?? '').trim(), 'пустой detail');
  assert(std.hint === stdRule.hint, 'hint не из набора правил');
  assert(std.clause === stdRule.source.clause, `clause «${std.clause}»`);
  assert(std.constraint === stdRule.source.constraint, `constraint «${std.constraint}»`);
  assert(std.page === stdRule.source.page, `page «${std.page}»`);
  assert(std.rationale === null, `у стандарта rationale «${std.rationale}»`);
  assert(Array.isArray(std.targets) && std.targets.length, 'targets пуст');
  assert(std.targets.every((t) => typeof t === 'string'), `targets не строки: ${std.targets.join(',')}`);

  const advice = practiceFindings(PRACTICE_CASES[0].bad).find((f) => f.basis === 'practice');
  const practiceRule = both.rules.find((r) => r.id === advice.ruleId);
  assert(Object.keys(advice).join(',') === want, `поля замечания практики: ${Object.keys(advice).join(',')}`);
  assert(advice.ruleId === practiceRule.id && advice.level === practiceRule.level, 'ruleId/level не из набора');
  assert(advice.message === practiceRule.message && advice.hint === practiceRule.hint, 'message/hint не из набора');
  assert(String(advice.detail ?? '').trim(), 'пустой detail у практики');
  assert(advice.clause === null && advice.constraint === null && advice.page === null,
    `у практики ссылки на стандарт: ${advice.clause}/${advice.constraint}/${advice.page}`);
  assert(advice.rationale === practiceRule.rationale, 'rationale не из набора правил');
  assert(advice.targets.join() === 'e3', `цель «${advice.targets.join()}»`);
  return `11 прежних полей + diagramId, у обоих слоёв`;
});

await check('порядок: сначала весь слой стандарта, потом практика', async () => {
  // Одна модель, два нарушения разных слоёв: кратность 5..2 (стандарт) и
  // изолированный класс «Отчёт» (практика).
  const m = model({
    elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент'), el('e3', 'class', 'Отчёт')],
    relationships: [{
      id: 'r1', kind: 'association', name: '', from: 'e1', to: 'e2',
      fromMultiplicity: '5..2',
    }],
    diagrams: [diagram('d1', 'Диаграмма классов',
      [shape('s1', 'e1'), shape('s2', 'e2'), shape('s3', 'e3')],
      [link('l1', 'r1', 's1', 's2')])],
  });
  const findings = both.run(m);
  const bases = findings.map((f) => f.basis);
  const lastStandard = bases.lastIndexOf('uml');
  const firstPractice = bases.indexOf('practice');
  assert(lastStandard !== -1, 'стандарт не сработал');
  assert(firstPractice !== -1, 'практика не сработала');
  assert(lastStandard < firstPractice, `слои перемешаны: ${bases.join(', ')}`);
  assert(bases.slice(firstPractice).every((b) => b === 'practice'),
    `после первого замечания практики вернулся стандарт: ${bases.join(', ')}`);
  return `${bases.length} зам.: ${lastStandard + 1} стандарта, ${bases.length - firstPractice} практики`;
});

await check('counts: advice отдельно, практика не подмешивается в warnings', async () => {
  const m = model({
    elements: [el('e1', 'class', 'Заказ'), el('e2', 'class', 'Клиент'), el('e3', 'class', 'Отчёт')],
    relationships: [{
      id: 'r1', kind: 'association', name: '', from: 'e1', to: 'e2',
      fromMultiplicity: '5..2',
    }],
    diagrams: [diagram('d1', 'Диаграмма классов',
      [shape('s1', 'e1'), shape('s2', 'e2'), shape('s3', 'e3')],
      [link('l1', 'r1', 's1', 's2')])],
  });
  const findings = both.run(m);
  const counts = both.counts(findings);
  assert(counts.errors === 1, `ошибок ${counts.errors}`);
  assert(counts.warnings === 0, `предупреждений ${counts.warnings}: практика попала в warnings?`);
  assert(counts.advice === 1, `советов ${counts.advice}`);
  assert(counts.total === 1, `total ${counts.total} — а должен считать только стандарт`);

  const onlyPractice = both.counts([{ ruleId: 'element-isolated', level: 'warning', basis: 'practice' }]);
  assert(onlyPractice.warnings === 0 && onlyPractice.total === 0 && onlyPractice.advice === 1,
    `counts([практика]) = ${JSON.stringify(onlyPractice)}`);
  const onlyStandard = ruleset.counts([{ ruleId: 'x', level: 'warning', basis: 'uml' }]);
  assert(onlyStandard.warnings === 1 && onlyStandard.advice === 0 && onlyStandard.total === 1,
    `counts([стандарт]) = ${JSON.stringify(onlyStandard)}`);
  return JSON.stringify(counts);
});

/* --------------------------------------------------------------- корпус */

// Корпусов два, и это важно. `tests/data/corpus` — копия, которую читают тесты
// приложения: 48 моделей учебника БЕЗ видов (0 фигур, 0 связей-видов). Слою
// практики этого мало: правила о диаграммах на файле без видов молчат (см.
// `hasAnyView` в practice.js) — иначе «не показан» пришлось бы сказать про
// каждый элемент. Числа калибровки сняты на `material/corpus-layout`: те же
// 48 моделей, но с фигурами и связями, 316 фигур и 195 связей.
const LAYOUT = path.resolve(ROOT, '..', 'material', 'corpus-layout');

const corpusFiles = async (dir) => {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return null;
  }
};

/** Замечания движка по всем моделям корпуса: по правилам, по слоям и по форме. */
const runCorpus = async (dir, files) => {
  const tally = Object.fromEntries(PRACTICE.map((r) => [r.id, 0]));
  const malformed = [];
  const standardList = [];
  let standard = 0;
  let withoutRel = 0;
  for (const file of files) {
    const model = deserialize(await readFile(path.join(dir, file), 'utf8'), { repairs: [] });
    // Модели корпуса без единой связи дают почти весь урожай «изолированных».
    // Это свойство корпуса, а не правил, поэтому оно измеряется, а не судится.
    if (!model.relationships.length) withoutRel += 1;
    const ids = new Set([...(model.elements ?? []).map((e) => e.id),
      ...(model.relationships ?? []).map((r) => r.id)]);
    for (const f of both.run(model)) {
      if (f.basis === 'practice') tally[f.ruleId] += 1;
      else { standard += 1; standardList.push(`${file}: ${f.ruleId}@${f.targets.join('+')}`); }
      // Форма замечания — то, что обязано быть верным на любой модели.
      const bad = f.basis === 'practice'
        ? (f.clause !== null || f.constraint !== null
          || !String(f.rationale ?? '').trim()
          || f.level !== 'warning'
          || !f.targets.length || !f.targets.every((id) => ids.has(id)))
        : (f.basis !== 'uml' || !String(f.clause ?? '').trim());
      if (bad) malformed.push(`${file}: ${f.ruleId}`);
    }
  }
  return { tally, standard, standardList, withoutRel, malformed };
};

// Число советов на корпусе — свойство КОРПУСА, а не правил, и твёрдым
// инвариантом быть не может: `material/corpus-layout` живут вне приложения и
// их правят отдельно. Дописали связь — сирот стало меньше; завели две
// одинаковые — стал виден настоящий дубль. И то и другое правильно.
//
// Поэтому здесь проверяется то, что обязано быть верным при любом корпусе:
// слой стандарта молчит (он не имеет права ругаться на учебную модель), каждое
// замечание практики правильно размечено и указывает на существующий объект,
// и общий урожай не превращается в «сработало на каждом элементе». Потолок
// ниже — сторож против такого обвала, а не калибровка: замеры (96 сирот и
// 2 безымянных на 48 моделях) живут в документации.
const ADVICE_RUNAWAY = 150;

await check('корпус: 48 моделей, слой стандарта молчит', async () => {
  // Учебные модели пособия правильные: ни одно правило стандарта не имеет
  // права дать на них замечание. Любая находка здесь — ложное срабатывание.
  const index = JSON.parse(await readFile(path.join(DATA, 'corpus', 'INDEX.json'), 'utf8'));
  const corpus = index.files;
  assert(corpus.length === 48, `в корпусе ${corpus.length} моделей, а не 48`);
  const bad = [];
  for (const file of corpus) {
    const model = await loadModel('corpus', file);
    for (const f of ruleset.run(model)) bad.push(`${file}: ${f.ruleId}@${f.targets.join('+')} — ${f.detail}`);
  }
  assert(bad.length === 0, `замечаний ${bad.length}, а ждали ноль: ${bad.slice(0, 5).join(' | ')}`);
  return `${corpus.length} моделей, 0 замечаний`;
});

await check('корпус без видов: в tests/data/corpus нет ни фигуры, ни вида связи', async () => {
  // Не придирка, а предпосылка: правила о диаграммах на таком корпусе
  // сработали бы на каждом элементе. Появились виды — числа ниже пора перемерить.
  const index = JSON.parse(await readFile(path.join(DATA, 'corpus', 'INDEX.json'), 'utf8'));
  let shapes = 0;
  let links = 0;
  for (const file of index.files) {
    const model = await loadModel('corpus', file);
    for (const d of model.diagrams) {
      shapes += d.shapes.length;
      links += d.links.length;
    }
  }
  assert(shapes === 0 && links === 0, `виды появились: фигур ${shapes}, связей ${links} — перемерьте правила о диаграммах`);
  return '48 моделей, 0 фигур, 0 видов связей';
});

await check('корпус с видами: слой стандарта молчит, советы размечены и адресованы', async () => {
  const files = await corpusFiles(LAYOUT);
  assert(files, `калибровочный корпус не найден: ${LAYOUT}`);
  assert(files.length === 48, `в корпусе ${files.length} моделей, а не 48`);
  const { tally, standard, standardList, withoutRel, malformed } = await runCorpus(LAYOUT, files);
  assert(standard === 0,
    `слой стандарта дал ${standard} замечаний на учебном корпусе: ${standardList.slice(0, 5).join(' | ')}`);
  assert(!malformed.length, `замечания с неверной формой: ${malformed.slice(0, 5).join(', ')}`);
  const sum = Object.values(tally).reduce((a, b) => a + b, 0);
  assert(sum <= ADVICE_RUNAWAY, `советов ${sum} — правила сработали почти на каждом элементе`);
  return `${sum} советов: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}; `
    + `моделей без связей ${withoutRel}; стандарт: ${standardList.join(' | ')}`;
});

await check('корпус без видов: правила о листах молчат', async () => {
  const index = JSON.parse(await readFile(path.join(DATA, 'corpus', 'INDEX.json'), 'utf8'));
  const { tally, standard, standardList, malformed } = await runCorpus(path.join(DATA, 'corpus'), index.files);
  assert(standard === 0,
    `слой стандарта дал ${standard} замечаний: ${standardList.slice(0, 5).join(' | ')}`);
  assert(!malformed.length, `замечания с неверной формой: ${malformed.slice(0, 5).join(', ')}`);
  // Это уже контракт `hasAnyView`, а не свойство корпуса: файл без единой
  // фигуры не должен получать «не показан» на каждый элемент и каждую связь.
  assert((tally['element-not-on-any-diagram'] ?? 0) === 0
    && (tally['relationship-not-on-any-diagram'] ?? 0) === 0,
  `на файле без видов правила о листах всё-таки сработали: ${JSON.stringify(tally)}`);
  return `правила о листах молчат; сирот ${tally['element-isolated'] ?? 0}, `
    + `безымянных ${tally['element-unnamed'] ?? 0}`;
});

await check('корпус: замечания практики указывают на id модели, а не на фигуры', async () => {
  const files = await corpusFiles(LAYOUT);
  assert(files, `калибровочный корпус не найден: ${LAYOUT}`);
  let checked = 0;
  for (const file of files) {
    const model = deserialize(await readFile(path.join(LAYOUT, file), 'utf8'), { repairs: [] });
    const known = idsOf(model);
    const shapes = new Set(model.diagrams.flatMap((d) => d.shapes.map((s) => s.id)));
    for (const f of both.run(model)) {
      if (f.basis !== 'practice') continue;
      assert(f.targets.length, `${file}: ${f.ruleId} без виноватого`);
      for (const t of f.targets) {
        assert(known.has(t), `${file}: ${f.ruleId} целится в «${t}» — это не id модели`);
        assert(!shapes.has(t), `${file}: ${f.ruleId} целится в фигуру «${t}»`);
      }
      checked += 1;
    }
  }
  return `${checked} замечаний практики, все цели — элементы и связи модели`;
});

await check('корпус: четыре совета о ссылках молчат — 0 замечаний', async () => {
  // Эти советы — про согласованность ссылок, а учебный корпус согласован по
  // построению: у его 12 ссылок на взаимодействие `refersTo` хранит ИМЯ
  // подпотока, которого в файле нет, и 8 объектов из 8 идут без
  // `classifierId`. Если правило начнёт считать «нет такого листа» нарушением,
  // корпус даст 12 ложных срабатываний — поэтому здесь стоит явный ноль, а не
  // «сумма не больше потолка».
  const files = await corpusFiles(LAYOUT);
  assert(files, `калибровочный корпус не найден: ${LAYOUT}`);
  const tally = Object.fromEntries(REF_RULES.map((id) => [id, 0]));
  const fired = [];
  for (const file of files) {
    const m = deserialize(await readFile(path.join(LAYOUT, file), 'utf8'), { repairs: [] });
    for (const f of both.run(m)) {
      if (!(f.ruleId in tally)) continue;
      tally[f.ruleId] += 1;
      fired.push(`${file}: ${f.ruleId}@${f.targets.join('+')}`);
    }
  }
  const sum = Object.values(tally).reduce((a, b) => a + b, 0);
  assert(!sum, `ложные срабатывания на корпусе: ${fired.slice(0, 5).join(' | ')}`);
  return `${files.length} моделей, ${REF_RULES.length} правила, 0 замечаний`;
});

await check('корпус: два совета о последовательности молчат — 0 замечаний', async () => {
  // Это не «повезло»: в корпусе 102 линии жизни, и НИ У ОДНОЙ нет `represents`,
  // а у 180 сообщений нет `signature`. Оба поля появились позже корпуса, и
  // правило, сработавшее здесь, ругалось бы на незаполненное поле — то есть на
  // каждую диаграмму последовательности пособия. Поэтому проверяется и ноль, и
  // предпосылка: если корпус когда-нибудь разметят, число придётся перемерить,
  // а не подогнать правило.
  const files = await corpusFiles(LAYOUT);
  assert(files, `калибровочный корпус не найден: ${LAYOUT}`);
  const RULES = ['lifeline-represents-classifier', 'message-signature-operation'];
  const fired = [];
  let lifelines = 0;
  let represented = 0;
  let messages = 0;
  let signed = 0;
  for (const file of files) {
    const m = deserialize(await readFile(path.join(LAYOUT, file), 'utf8'), { repairs: [] });
    for (const e of m.elements ?? []) {
      if (e.kind !== 'lifeline' && e.kind !== 'actorLifeline') continue;
      lifelines += 1;
      if (e.represents) represented += 1;
    }
    for (const r of m.relationships ?? []) {
      if (r.kind !== 'message' && r.kind !== 'reply' && r.kind !== 'createMessage' && r.kind !== 'destroyMessage') continue;
      messages += 1;
      if (r.signature) signed += 1;
    }
    for (const f of both.run(m)) {
      if (RULES.includes(f.ruleId)) fired.push(`${file}: ${f.ruleId}@${f.targets.join('+')}`);
    }
  }
  assert(!fired.length, `ложные срабатывания на корпусе: ${fired.slice(0, 5).join(' | ')}`);
  assert(lifelines === 102, `линий жизни ${lifelines}, а мерено 102 — корпус правили? перемерьте`);
  assert(!represented, `у ${represented} линий жизни появился represents — перемерьте ноль`);
  assert(!signed, `у ${signed} сообщений появилась signature — перемерьте ноль`);
  return `${lifelines} линий жизни (represents 0), ${messages} сообщений (signature 0), 0 замечаний`;
});

await check('корпус: 4103 (рис. 4.1.3) без ложного «дубля связи»', async () => {
  // В модели две законные ассоциации e2–e4 с ролями primary/alternative и
  // разными кратностями — ровно то, что пособие советует различать именами
  // полюсов. Правило не имеет права называть это дублем.
  const m = deserialize(await readFile(path.join(LAYOUT, '4103.uml.json'), 'utf8'), { repairs: [] });
  const hits = both.run(m).filter((f) => f.ruleId === 'relationship-duplicate');
  assert(!hits.length, describe(hits));
  return '0 замечаний relationship-duplicate';
});

/* ------------------------- границы узлов деятельности и псевдосостояний */

// Семь правил требуют наличия связей. Только что нарисованная фигура связей не
// имеет, и по букве OCL каждое такое правило сработало бы на ней — ровно тот
// случай, что был у `CombinedFragment` (`fragments.js`): там граница «ноль
// операндов» сняла 26 ложных срабатываний на корпусе из 27 фрагментов.
// Здесь граница проверяется не словами, а прогоном: свежие фигуры всех семи
// видов дают ноль замечаний, а на корпусе считается, сколько их и сколько
// замечаний дала бы буква OCL.

const SILENT_RULES = [
  'fork-one-incoming-edge',
  'merge-one-outgoing-edge',
  'decision-incoming-outgoing-edges',
  'pseudostate-choice-vertex',
  'pseudostate-junction-vertex',
  'pseudostate-fork-vertex',
  'pseudostate-join-vertex',
];

await check('граница «только что нарисовано»: названа в hint всех семи правил', async () => {
  const missing = [];
  for (const id of SILENT_RULES) {
    const rule = ruleset.rules.find((r) => r.id === id);
    assert(rule, `правила «${id}» нет в наборе`);
    if (!/Фигура без единой связи молчит/.test(rule.hint ?? '')) missing.push(id);
  }
  assert(!missing.length, `в hint не сказано про фигуру без связей: ${missing.join(', ')}`);
  // У объединения граница другая по смыслу: сверять род потока не с чем, пока
  // нет ни одного входящего ребра. Она тоже обязана быть в hint, а не в коде.
  const join = ruleset.rules.find((r) => r.id === 'join-incoming-object-flow');
  assert(/нет ни одного входящего ребра/i.test(join.hint ?? ''),
    `у join-incoming-object-flow в hint нет границы «нет входящих»: «${join.hint}»`);
  return `${SILENT_RULES.length} правил + join-incoming-object-flow: договорённость в hint`;
});

await check('граница: свежая фигура каждого из семи видов молчит', async () => {
  // Все семь фигур в одной модели, ни у одной нет ни одного ребра. Ровно этот
  // случай давал бы семь замечаний по букве OCL.
  const fresh = model({
    elements: [
      el('f1', 'fork'), el('j1', 'join'), el('m1', 'merge'), el('d1', 'decision'),
      el('c1', 'choice'), el('jn1', 'junction'), el('f2', 'fork'), el('j2', 'join'),
    ],
    relationships: [],
  });
  const hits = ruleset.run(fresh).filter((f) => SILENT_RULES.includes(f.ruleId));
  assert(!hits.length, `на фигурах без связей сработало: ${describe(hits)}`);
  return `${fresh.elements.length} фигур без связей, 0 замечаний`;
});

await check('граница: одно ребро снимает молчание, ноль — возвращает', async () => {
  // Та же фигура, но с одним входящим ребром: правило обязано проснуться и
  // сказать про нехватку второго. Иначе «молчит» означало бы «не работает».
  const withEdge = model({
    elements: [el('a', 'action', 'Принять заказ'), el('m1', 'merge')],
    relationships: [rel('r1', 'controlFlow', 'a', 'm1')],
  });
  const hits = ruleset.run(withEdge).filter((f) => f.ruleId === 'merge-one-outgoing-edge');
  assert(hits.length === 1, `на слиянии с одним входящим и без исходящих замечаний ${hits.length}`);
  assert(hits[0].targets.join() === 'm1', `цель «${hits[0].targets.join()}»`);
  return 'слияние с одним ребром: замечание про исходящее есть';
});

await check('граница: конечный узел без исходящих — норма, а не молчание', async () => {
  // Исключение из правила: у `final` ноль исходящих и есть норма. Правило
  // обязано молчать не «потому что нет связей», а потому что нарушать нечего —
  // и это сказано в hint.
  const rule = ruleset.rules.find((r) => r.id === 'final-node-no-outgoing-edges');
  assert(/ноль связей и есть норма/i.test(rule.hint ?? ''), `в hint нет оговорки: «${rule.hint}»`);
  const ok = model({
    elements: [el('a', 'action', 'Отгрузить'), el('f', 'final')],
    relationships: [rel('r1', 'controlFlow', 'a', 'f')],
  });
  assert(!ruleset.run(ok).filter((f) => f.ruleId === 'final-node-no-outgoing-edges').length,
    'конечный узел с одним входящим получил замечание');
  const stateRule = ruleset.rules.find((r) => r.id === 'finalstate-no-outgoing-transitions');
  assert(/ноль связей и есть норма/i.test(stateRule.hint ?? ''),
    `у finalstate-no-outgoing-transitions в hint нет оговорки: «${stateRule.hint}»`);
  const fresh = model({ elements: [el('f', 'final')], relationships: [] });
  assert(!ruleset.run(fresh).length, `свежий конечный узел дал замечание: ${describe(ruleset.run(fresh))}`);
  return 'ноль исходящих — норма у обоих правил о конечном узле';
});

await check('вид fork/join различается по роду рёбер: правила не судят чужую диаграмму', async () => {
  // Вид `fork` один для узла деятельности и для псевдосостояния. Правило о
  // деятельности считает рёбра деятельности, правило о машине состояний —
  // переходы, поэтому фигура с переходами не получает замечаний о рёбрах, а
  // фигура с рёбрами деятельности — о переходах.
  const asActivity = model({
    elements: [el('a1', 'action', 'Оплачен'), el('a2', 'action', 'Отгружен'), el('a3', 'action', 'Упакован'),
      el('f', 'fork')],
    relationships: [
      rel('r1', 'controlFlow', 'a1', 'f'),
      rel('r2', 'controlFlow', 'f', 'a2'),
      rel('r3', 'controlFlow', 'f', 'a3'),
    ],
  });
  const activityHits = ruleset.run(asActivity).filter((h) => h.ruleId.startsWith('pseudostate-'));
  assert(!activityHits.length, `разделение деятельности получило замечания о переходах: ${describe(activityHits)}`);

  const asState = model({
    elements: [el('s1', 'state', 'Оплачен'), el('s2', 'state', 'Отгружен'), el('s3', 'state', 'Упакован'),
      el('f', 'fork')],
    relationships: [
      rel('r1', 'transition', 's1', 'f'),
      rel('r2', 'transition', 'f', 's2'),
      rel('r3', 'transition', 'f', 's3'),
    ],
  });
  const stateHits = ruleset.run(asState).filter((h) => h.ruleId === 'fork-one-incoming-edge' || h.ruleId === 'fork-edges');
  assert(!stateHits.length, `разделение машины состояний получило замечания о рёбрах: ${describe(stateHits)}`);
  return 'три перехода — не рёбра деятельности, и наоборот';
});

await check('objectflow-no-executable-nodes: поток из действия ловится, между узлами объектов — нет', async () => {
  const bad = model({
    elements: [el('a', 'action', 'Проверить заказ'), el('o', 'object', 'Заказ')],
    relationships: [rel('r1', 'objectFlow', 'a', 'o')],
  });
  const hits = ruleset.run(bad).filter((f) => f.ruleId === 'objectflow-no-executable-nodes');
  assert(hits.length === 1, `замечаний ${hits.length}, а ждали одно`);
  assert(hits[0].targets.join() === 'r1', `виновата не связь: ${hits[0].targets.join()}`);
  assert(/Проверить заказ/.test(hits[0].detail), `detail не называет действие: «${hits[0].detail}»`);

  // Оба конца исполняемые — по-прежнему ОДНО замечание на связь, а не два.
  const both = model({
    elements: [el('a1', 'action', 'Принять'), el('a2', 'action', 'Отгрузить')],
    relationships: [rel('r1', 'objectFlow', 'a1', 'a2')],
  });
  const bothHits = ruleset.run(both).filter((f) => f.ruleId === 'objectflow-no-executable-nodes');
  assert(bothHits.length === 1, `на потоке между двумя действиями замечаний ${bothHits.length}`);
  assert(/начинается/.test(bothHits[0].detail) && /заканчивается/.test(bothHits[0].detail),
    `detail не назвал оба конца: «${bothHits[0].detail}»`);

  const ok = model({
    elements: [el('o1', 'object', 'Заказ'), el('n', 'objectNode', 'Заказы в обработке'), el('o2', 'object', 'Заказ')],
    relationships: [rel('r1', 'objectFlow', 'o1', 'n'), rel('r2', 'objectFlow', 'n', 'o2')],
  });
  assert(!ruleset.run(ok).filter((f) => f.ruleId === 'objectflow-no-executable-nodes').length,
    'поток между узлами объектов получил замечание');
  return 'одно замечание на связь, оба конца названы; узлы объектов чисты';
});

await check('корпус: цена границы — фигуры без связей и замечания по букве OCL', async () => {
  // Числа сняты прогоном, а не на глаз: 20 фигур целевых видов на 48 листах,
  // из них одна — пустой ромб 3402 — без единой связи. Буква OCL без границы
  // дала бы на ней замечание «у решения неверное число входящих и исходящих
  // рёбер»: это и есть цена границы, одно ложное срабатывание.
  const files = await corpusFiles(LAYOUT);
  assert(files, `калибровочный корпус не найден: ${LAYOUT}`);
  const ACTIVITY = new Set(['fork', 'join', 'merge', 'decision', 'final', 'initial', 'choice',
    'junction', 'historyShallow', 'historyDeep', 'terminate']);
  const NEW = ruleset.rules.filter((r) => r.fn && r.source?.clause
    && (r.source.clause.startsWith('15.7.') || r.source.clause.startsWith('14.5.')));
  let figures = 0;
  let lonely = 0;
  const lonelyIds = [];
  const fired = [];
  for (const file of files) {
    const m = deserialize(await readFile(path.join(LAYOUT, file), 'utf8'), { repairs: [] });
    const touched = new Set((m.relationships ?? []).flatMap((r) => [r.from, r.to])
      .filter((id) => id != null).map(String));
    for (const e of m.elements ?? []) {
      if (!ACTIVITY.has(e.kind)) continue;
      figures += 1;
      if (!touched.has(String(e.id))) { lonely += 1; lonelyIds.push(`${file}:${e.id}`); }
    }
    for (const f of ruleset.run(m)) {
      if (NEW.some((r) => r.id === f.ruleId)) fired.push(`${file}: ${f.ruleId}@${f.targets.join('+')}`);
    }
  }
  // Числа — свойство корпуса: правили листы, перемерьте их, а не подгоняйте
  // правило. Оба утверждения сторожат именно границу, а не красоту корпуса.
  assert(figures === 20, `фигур целевых видов ${figures}, а мерено 20 — корпус правили? перемерьте`);
  assert(lonely === 1,
    `фигур без единой связи ${lonely}, а мерено одна — корпус правили? перемерьте: ${lonelyIds.join(', ')}`);
  assert(!fired.length, `новые правила сработали на корпусе: ${fired.slice(0, 5).join(' | ')}`);
  return `${figures} фигур, из них без связей ${lonely} (${lonelyIds.join(', ')}); `
    + `${NEW.length} новых правил, 0 замечаний`;
});


/* ------------------- границы правил пачек 2–10 (порт, слоты, фрагменты) */

// У этих правил граница не «фигура без связей», а другая, и у каждой она
// названа в hint. Здесь границы проверяются прогоном, а не только словами:
// договорённость, которая держится на комментарии, ломается первой.

await check('границы пачек 2–10 названы в hint, а не спрятаны в коде', async () => {
  const want = {
    'port-encapsulated-owner': /без единой связи молчит/i,
    'instance-slot-unique-feature': /classifierId.*молчит/i,
    'instance-slot-defining-feature': /classifierId.*молчит/i,
    'instance-deployment-artifact': /без единой связи deployment молчит/i,
    'deploy-spec-target-environment': /нет ни одной связи deployment/i,
    'message-crosses-fragment': /слабая форма[\s\S]*вложенност/i,
    'component-nested-in-class': /внутри компонента/i,
    'interaction-not-nested': /пакет/i,
  };
  const missing = [];
  for (const [id, re] of Object.entries(want)) {
    const rule = ruleset.rules.find((r) => r.id === id);
    assert(rule, `правила «${id}» нет в наборе`);
    if (!re.test(rule.hint ?? '')) missing.push(`${id}: «${rule.hint}»`);
  }
  assert(!missing.length, `в hint нет границы: ${missing.join(' | ')}`);
  return `${Object.keys(want).length} правил: граница названа словами`;
});

await check('port-encapsulated-owner: свежий порт молчит, соединённый без владельца — нет', async () => {
  // Порт без владельца и без связей — только что нарисованная фигура.
  const fresh = model({ elements: [el('p1', 'port')], relationships: [] });
  assert(!ruleset.run(fresh).filter((f) => f.ruleId === 'port-encapsulated-owner').length,
    'свежий порт получил замечание');
  // Как только порт соединён, он заявлен как порт — владелец обязателен.
  const wired = model({
    elements: [el('p1', 'port'), el('c1', 'class', 'Заказ')],
    relationships: [rel('r1', 'association', 'p1', 'c1')],
  });
  const hits = ruleset.run(wired).filter((f) => f.ruleId === 'port-encapsulated-owner');
  assert(hits.length === 1 && hits[0].targets.join() === 'p1', `соединённый порт: ${describe(hits)}`);
  // Порт внутри порта: порт не EncapsulatedClassifier — нарушение по существу.
  const nested = model({
    elements: [el('p1', 'port', 'внешний'), { ...el('p2', 'port', 'внутренний'), ownerId: 'p1' }],
  });
  const inner = ruleset.run(nested).filter((f) => f.ruleId === 'port-encapsulated-owner');
  assert(inner.length === 1 && inner[0].targets.join() === 'p2', `порт внутри порта: ${describe(inner)}`);
  return 'свежий молчит; соединённый и порт-в-порте ловятся';
});

await check('transition-fork-target-state: fork → final — предупреждение, fork → action — ошибка', async () => {
  // По букве OCL `target` обязан быть State, и конечное состояние им не является.
  // Но так рисуют, поэтому уровень понижен до warning — и это записано в hint.
  const toFinal = model({
    elements: [el('f1', 'fork'), el('s1', 'final')],
    relationships: [rel('r1', 'transition', 'f1', 's1')],
  });
  const warn = ruleset.run(toFinal).filter((f) => f.ruleId === 'transition-fork-target-state');
  assert(warn.length === 1, `fork → final: замечаний ${warn.length}`);
  assert(warn[0].level === 'warning', `fork → final: уровень «${warn[0].level}», а ждали warning`);
  assert(warn[0].targets.join() === 'r1,s1', `fork → final: цели «${warn[0].targets.join()}»`);

  const toAction = model({
    elements: [el('f1', 'fork'), el('a1', 'action', 'Отгрузить')],
    relationships: [rel('r1', 'transition', 'f1', 'a1')],
  });
  const err = ruleset.run(toAction).filter((f) => f.ruleId === 'transition-fork-target-state');
  assert(err.length === 1, `fork → action: замечаний ${err.length}`);
  assert(err[0].level === 'error', `fork → action: уровень «${err[0].level}», а ждали error`);

  const rule = ruleset.rules.find((r) => r.id === 'transition-fork-target-state');
  assert(/конечное состояние/i.test(rule.hint ?? ''), `в hint нет оговорки про final: «${rule.hint}»`);
  return 'warning для final и псевдосостояний, error для действия; оговорка в hint';
});

await check('instance-slot-defining-feature: объект без classifierId молчит', async () => {
  // В корпусе восемь объектов, и ни у одного нет ссылки на класс: правило,
  // сработавшее на них, было бы неверным правилом, а не находкой.
  const without = model({
    elements: [el('o1', 'object', 'заказ1: Заказ', { slots: [{ vis: 'public', name: 'что угодно' }] })],
  });
  const hits = ruleset.run(without).filter((f) => f.ruleId === 'instance-slot-defining-feature'
    || f.ruleId === 'instance-slot-unique-feature');
  assert(!hits.length, `объект без classifierId: ${describe(hits)}`);
  // Со слотом, который есть у предка, правило тоже молчит: allSlottableFeatures
  // включает унаследованные атрибуты.
  const inherited = model({
    elements: [el('c1', 'class', 'Заказ', { attributes: [{ vis: 'public', name: 'номер' }] }),
      el('c2', 'class', 'Срочный заказ'),
      el('o1', 'object', ':Срочный заказ', { classifierId: 'c2', slots: [{ vis: 'public', name: 'номер' }] })],
    relationships: [rel('r1', 'generalization', 'c2', 'c1')],
  });
  assert(!ruleset.run(inherited).filter((f) => f.ruleId === 'instance-slot-defining-feature').length,
    'унаследованный атрибут сочтён чужим');
  return 'без classifierId — тишина; унаследованный атрибут — не нарушение';
});

await check('message-crosses-fragment: верхний уровень и два операнда одного фрагмента молчат', async () => {
  const base = (fragments, rels) => model({
    elements: [el('L1', 'lifeline', ':Клиент'), el('L2', 'lifeline', ':Сервер'), ...fragments],
    relationships: rels,
  });
  const outside = base([], [rel('r1', 'message', 'L1', 'L2')]);
  assert(!ruleset.run(outside).filter((f) => f.ruleId === 'message-crosses-fragment').length,
    'сообщение вне операндов получило замечание');
  const oneFragment = base([
    { id: 'f1', kind: 'fragment', name: 'Оплата', operator: 'alt',
      operands: [{ id: 'o1', guard: '[карта]', messages: ['r1'] }, { id: 'o2', guard: '[счёт]', messages: ['r1'] }] },
  ], [rel('r1', 'message', 'L1', 'L2')]);
  assert(!ruleset.run(oneFragment).filter((f) => f.ruleId === 'message-crosses-fragment').length,
    'два операнда одного фрагмента сочтены пересечением границы');
  // Вложенный фрагмент перечисляет то же сообщение, что и объемлющий: так
  // выводится покрытие объемлющего, и это не пересечение границы.
  const nested = base([
    { id: 'f1', kind: 'fragment', name: 'Оплата', operator: 'alt',
      operands: [{ id: 'o1', guard: '', messages: ['r1'] }] },
    { id: 'f2', kind: 'fragment', name: 'Ошибка', operator: 'break', ownerId: 'f1',
      operands: [{ id: 'o1', guard: '', messages: ['r1'] }] },
  ], [rel('r1', 'message', 'L1', 'L2')]);
  assert(!ruleset.run(nested).filter((f) => f.ruleId === 'message-crosses-fragment').length,
    'вложенные фрагменты сочтены пересечением границы');
  return 'вне операндов, один фрагмент и вложенность молчат';
});

await check('deploy-spec-target-environment: спецификация без связей deployment молчит', async () => {
  const lonely = model({ elements: [el('d1', 'deploymentSpec', 'Конфигурация')] });
  assert(!ruleset.run(lonely).filter((f) => f.ruleId === 'deploy-spec-target-environment'
    || f.ruleId === 'deploy-spec-deployed-components').length, 'свежая спецификация получила замечание');
  // Спецификация развёрнута в среду, а рядом на той же цели стоит артефакт:
  // ошибки цели нет, предупреждение о чужих развёрнутых элементах есть.
  const mixed = model({
    elements: [el('d1', 'deploymentSpec', 'Конфигурация'), el('e1', 'executionEnvironment', 'Среда'),
      el('a1', 'artifact', 'журнал.log')],
    relationships: [rel('r1', 'deployment', 'd1', 'e1'), rel('r2', 'deployment', 'a1', 'e1')],
  });
  const hits = ruleset.run(mixed);
  assert(!hits.filter((f) => f.ruleId === 'deploy-spec-target-environment').length,
    `среда выполнения сочтена ошибкой: ${describe(hits)}`);
  const comp = hits.filter((f) => f.ruleId === 'deploy-spec-deployed-components');
  assert(comp.length === 1 && comp[0].level === 'warning', `чужие элементы: ${describe(comp)}`);
  return 'без deployment — тишина; среда без ошибки, артефакт — предупреждение';
});

/* --------------- границы правил о конечном состоянии и владении -------- */

await check('finalstate-*: три ошибки и одно предупреждение, «приближение» названо в hint', async () => {
  // `entry`, `exit` и `regions` — то, что человек вписал в поле; непустое поле у
  // конечного состояния всегда ошибка. `do` — приближение: в модели это текст,
  // а не поведение, поэтому уровень warning, и это сказано словами в hint.
  const want = {
    'finalstate-no-regions': 'error',
    'finalstate-no-entry': 'error',
    'finalstate-no-exit': 'error',
    'finalstate-no-do': 'warning',
  };
  for (const [id, level] of Object.entries(want)) {
    const rule = ruleset.rules.find((r) => r.id === id);
    assert(rule, `правила «${id}» нет в наборе`);
    assert(rule.level === level, `«${id}»: уровень «${rule.level}», а ждали «${level}»`);
  }
  const doRule = ruleset.rules.find((r) => r.id === 'finalstate-no-do');
  assert(/приближение/i.test(doRule.hint), `в hint finalstate-no-do нет оговорки: «${doRule.hint}»`);
  return '3 error + 1 warning; приближение названо в hint';
});

await check('finalstate-*: поле из одних пробелов — не текст, свежее состояние молчит', async () => {
  // Поле хранится как список строк, и читатель оставляет в нём даже пробелы.
  // «Пусто» для правила — пусто после trim: иначе конечное состояние с полем
  // « » получало бы замечание о тексте, которого никто не видит.
  const fresh = model({
    elements: [{ ...el('e1', 'final'), entry: ['   '], exit: ['\t'], do: ['  '] }],
  });
  const hits = ruleset.run(fresh).filter((f) => f.ruleId.startsWith('finalstate-'));
  assert(!hits.length, `пробелы сочтены текстом: ${describe(hits)}`);
  return 'три поля из пробелов: 0 замечаний';
});

await check('element-own-self: загрузчик снимает цикл по ownerId, цикл по регионам проходит', async () => {
  // Это ответ на вопрос «зачем правило, если цикл и так запрещён». Живую правку
  // не пускает редактор (`setOwner`), файл при открытии чинит загрузчик. Правило
  // нужно для модели, собранной в памяти (импорт, восстановление), и для второго
  // вида владения — членства в регионе: загрузчик снимает только ПРЯМУЮ ссылку
  // региона на себя, а цикл из двух элементов пропускает. Проверяем оба факта,
  // иначе следующий читатель решит, что правило недостижимо.
  const cycleByOwner = {
    schema: 'uml-model/3', id: 'm-own-cycle', name: 'цикл по ownerId',
    elements: [
      { id: 'e1', kind: 'package', name: 'A', ownerId: 'e2' },
      { id: 'e2', kind: 'package', name: 'B', ownerId: 'e1' },
    ],
    relationships: [],
    diagrams: [diagram('d1', 'цикл по ownerId')],
    currentDiagramId: 'd1',
  };
  const repairs = [];
  const stripped = deserialize(JSON.stringify(cycleByOwner), { repairs });
  assert(repairs.some((r) => /цикл/i.test(r)), `загрузчик не назвал цикл владения: ${repairs.join('; ')}`);
  assert(!stripped.elements.some((e) => e.ownerId === 'e2' && e.id === 'e1'),
    'загрузчик оставил цикл по ownerId — правило проверяло бы уже починенную модель');
  assert(!ruleset.run(stripped).filter((f) => f.ruleId === 'element-not-own-self').length,
    'после починки загрузчика правило всё ещё срабатывает');

  // Цикл по регионам: загрузчик его не снимает, и правило обязано поймать.
  const cycleByRegion = model({
    elements: [
      { ...el('e1', 'state', 'Заказ'), regions: [{ id: 'g1', name: 'область', states: ['e2'] }] },
      { ...el('e2', 'state', 'Оплата'), regions: [{ id: 'g2', name: 'область', states: ['e1'] }] },
    ],
    diagrams: [diagram('d1', 'цикл по регионам')],
  });
  const regionRepairs = [];
  deserialize(JSON.stringify(cycleByRegion), { repairs: regionRepairs });
  assert(!regionRepairs.length, `загрузчик починил цикл по регионам: ${regionRepairs.join('; ')}`);
  const hits = ruleset.run(cycleByRegion).filter((f) => f.ruleId === 'element-not-own-self');
  assert(hits.length === 2, `цикл по регионам: замечаний ${hits.length}, а ждали два (по одному на звено)`);
  assert(hits.every((h) => h.targets.length === 2), 'в замечании нет пути цикла');

  // Обычная вложенность циклом не считается.
  const nested = model({
    elements: [
      { ...el('e1', 'state', 'Заказ'), regions: [{ id: 'g1', name: 'область', states: ['e2'] }] },
      el('e2', 'state', 'Оплата'),
      { ...el('p1', 'package', 'Домен') },
      { ...el('p2', 'package', 'Заказы'), ownerId: 'p1' },
    ],
    diagrams: [diagram('d1', 'обычная вложенность')],
  });
  assert(!ruleset.run(nested).filter((f) => f.ruleId === 'element-not-own-self').length,
    'обычная вложенность сочтена циклом');
  return 'ownerId-цикл снимает загрузчик; цикл по регионам ловится (2 звена), вложенность молчит';
});

await check('component-no-nested-classifier: компонент в компоненте и верхний уровень — норма', async () => {
  // Граница правила, названная в hint: судится только компонент ВНУТРИ КЛАССА.
  // Компонент в компоненте — законная композиция, компонент верхнего уровня с
  // содержимым — тоже: у них своё содержимое есть.
  const m = model({
    elements: [
      el('c1', 'class', 'Заказ'),
      { ...el('comp1', 'component', 'Оплата'), ownerId: 'c1' },
      el('comp3', 'component', 'Сервис'),
      { ...el('comp2', 'component', 'Ядро'), ownerId: 'comp3' },
      { ...el('inner', 'class', 'Правило'), ownerId: 'comp2' },
      { ...el('inner2', 'class', 'Обработчик'), ownerId: 'comp3' },
    ],
    relationships: [
      rel('r1', 'dependency', 'comp1', 'c1'),
      rel('r2', 'dependency', 'comp3', 'c1'),
    ],
    diagrams: [diagram('d1', 'вложенность компонентов')],
  });
  const hits = ruleset.run(m).filter((f) => f.ruleId === 'component-no-nested-classifier');
  assert(!hits.length, `вложенность компонента в компонент сочтена нарушением: ${describe(hits)}`);
  // А компонент в классе с классификатором внутри — нарушение, и виноват он сам.
  const bad = model({
    elements: [
      el('c1', 'class', 'Заказ'),
      { ...el('comp1', 'component', 'Оплата'), ownerId: 'c1' },
      { ...el('inner', 'class', 'Строка'), ownerId: 'comp1' },
    ],
    relationships: [rel('r1', 'dependency', 'comp1', 'c1')],
    diagrams: [diagram('d1', 'компонент в классе')],
  });
  const caught = ruleset.run(bad).filter((f) => f.ruleId === 'component-no-nested-classifier');
  assert(caught.length === 1, `компонент в классе: замечаний ${caught.length}`);
  assert(caught[0].targets[0] === 'comp1' && caught[0].targets.includes('inner'),
    `цели «${caught[0].targets.join('+')}», а ждали компонент и его классификатор`);
  return 'компонент в компоненте и верхний уровень молчат; компонент в классе с классом пойман';
});

/* ------------------------------------------------- набор против docs */

await check('uml-2.5.1.json и docs/rules-uml-2.5.1.json — один и тот же набор', async () => {
  const docs = JSON.parse(await readFile(path.join(ROOT, '..', 'docs', 'rules-uml-2.5.1.json'), 'utf8'));
  const strip = (pkg) => pkg.map((r) => ({
    ...r,
    source: Object.fromEntries(Object.entries(r.source ?? {}).filter(([k]) => k !== 'notice')),
  }));
  assert(docs.length === PKG.length, `правил ${docs.length} против ${PKG.length}`);
  // Разница ровно одна и она известна: копия в приложении несёт `source.notice`
  // (путь к уведомлению об авторских правах OMG внутри app/), в docs его нет.
  for (let i = 0; i < PKG.length; i += 1) {
    const extra = Object.keys(PKG[i].source ?? {}).filter((k) => !(k in (docs[i].source ?? {})));
    assert(extra.length === 1 && extra[0] === 'notice',
      `правило «${PKG[i].id}»: лишние поля ${extra.join(', ') || '—'}`);
  }
  assert(JSON.stringify(strip(PKG)) === JSON.stringify(strip(docs)), 'наборы разошлись по содержимому');
  return `${PKG.length} правил, разница только в source.notice`;
});

await check('appliesTo правил кратности не обещает поля «member»', async () => {
  // У члена модели в uml-model/3 нет кратности: `member()` — это
  // {vis, name, type, default}, а `multiplicityEnds()` смотрит только на концы
  // связей. Обещать `member` в appliesTo значит врать о покрытии.
  const liars = PKG.concat(PRACTICE).filter((r) => r.appliesTo?.multiplicity && 'member' in r.appliesTo);
  assert(!liars.length, `обещают кратность члена: ${liars.map((r) => r.id).join(', ')}`);
  const mult = PKG.filter((r) => r.appliesTo?.multiplicity).map((r) => r.id);
  assert(mult.length === 5, `правил кратности ${mult.length}, а не 5`);
  return `${mult.length} правил кратности, member ни у одного`;
});

/* ------------------------------------------------------- детерминизм */

await check('прогон детерминирован', async () => {
  const model = await loadModel('rules', 'usecase-include-cycle.json');
  const a = JSON.stringify(both.run(model));
  const b = JSON.stringify(both.run(model));
  assert(a === b, 'два прогона по одной модели дали разный список');
  return `${both.run(model).length} замечаний, байт в байт`;
});

/* ---------------------------------------------------------------- итог */

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);