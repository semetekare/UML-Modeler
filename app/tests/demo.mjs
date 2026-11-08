// Демонстрационный набор: каждая ошибка, которую мы умеем находить.
//
// `app/material/demo-errors.json` — модель, в которой нарушения расставлены
// НАМЕРЕННО, по одному на каждое правило. Она существует, чтобы человек мог
// открыть её, нажать «Проверки» и увидеть, что проверка действительно работает,
// а не только заявлена в документе.
//
// Зачем отдельный набор, если у каждого правила есть фикстура: фикстура
// доказывает правило, но не показывает его человеку. Она узкая (одна связь,
// один элемент), лежит в `tests/data/` и открывается только из кода. Демо — то
// же самое, но одним листом, с подписями и пригодное для «потыкать».
//
// Отсюда три требования, и все три проверяются здесь:
//
//   1. каждое правило, у которого есть функция, срабатывает хотя бы раз —
//      иначе демо врёт: правило есть, а показать его нечем;
//   2. в демо нет случайных находок: множество сработавших правил совпадает с
//      ожидаемым. Лишняя находка значит, что модель сломана не так, как
//      задумано, и человек увидит не то, что написано в описании;
//   3. модель читается без починок: битый JSON в демо был бы ошибкой демо, а
//      не модели.
//
// Плюс отдельно: ни одно замечание не ссылается на несуществующий элемент —
// иначе клик по нему в панели повёл бы в пустоту.
//
//   node tests/demo.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEMO = path.join(ROOT, 'material', 'demo-errors.json');

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

// Нотация обязана быть применена ДО `deserialize`: без неё читатель подменяет
// `kind` и картина получается ложной. Это грабля проекта, проверенная трижды.
const { applyPackage } = await load('src/model/notation.js');
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'notation/uml.json'), 'utf8')));
const { deserialize } = await load('src/io/umljson.js');
const { createRuleset } = await load('src/rules/engine.js');

const PKG = JSON.parse(await readFile(path.join(ROOT, 'notation/rules/uml-2.5.1.json'), 'utf8'));
const PRACTICE = JSON.parse(await readFile(path.join(ROOT, 'notation/rules/practice.json'), 'utf8'));
const ruleset = createRuleset(PKG, { practice: PRACTICE });

const text = await readFile(DEMO, 'utf8');

let model = null;
let repairs = [];

await check('демо читается без починок', async () => {
  repairs = [];
  model = deserialize(text, { repairs });
  assert(!repairs.length, `починок ${repairs.length}: ${repairs.slice(0, 3).map((r) => r.note ?? r).join('; ')}`);
  return `${model.elements.length} элементов, ${model.relationships.length} связей, ${model.diagrams.length} диаграмм`;
});

if (!model) {
  console.log('\nмодель не прочиталась — дальше проверять нечего');
  process.exit(1);
}

const findings = ruleset.run(model);
const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
  byRule.get(f.ruleId).push(f);
}

/** Правила, которые обязаны сработать: всё, у чего есть функция. */
const expected = ruleset.rules.filter((r) => r.fn).map((r) => r.id).sort();

await check('каждое правило с функцией срабатывает хотя бы раз', async () => {
  const silent = expected.filter((id) => !byRule.has(id));
  assert(!silent.length, `молчат: ${silent.join(', ')}`);
  return `${expected.length} правил, все с находкой`;
});

await check('у каждого замечания есть текст и понятная цель', async () => {
  const mute = findings.filter((f) => !String(f.detail ?? '').trim());
  assert(!mute.length, `без текста: ${mute.map((f) => f.ruleId).join(', ')}`);
  const noTarget = findings.filter((f) => !f.targets.length && f.ruleId !== 'name-not-clash');
  assert(!noTarget.length, `без цели: ${noTarget.map((f) => f.ruleId).join(', ')}`);
  return `${findings.length} замечаний с текстом`;
});

await check('прогон детерминирован', async () => {
  const again = ruleset.run(model);
  assert(JSON.stringify(again) === JSON.stringify(findings), 'второй прогон дал другой список');
  return 'байт в байт';
});

await check('ни одно замечание не ссылается в пустоту', async () => {
  const ids = new Set([
    ...model.elements.map((e) => e.id),
    ...model.relationships.map((r) => r.id),
  ]);
  const broken = [];
  for (const f of findings) {
    for (const t of f.targets) if (!ids.has(t)) broken.push(`${f.ruleId}→${t}`);
  }
  assert(!broken.length, `битые ссылки: ${broken.slice(0, 5).join(', ')}`);
  return `${findings.length} замечаний, все цели существуют`;
});

await check('каждое правило названо в описании демо, и числа описания сходятся с прогоном', async () => {
  const doc = await readFile(path.join(ROOT, 'material', 'DEMO-ERRORS.md'), 'utf8');
  const missing = expected.filter((id) => !doc.includes(id));
  assert(!missing.length, `нет в DEMO-ERRORS.md: ${missing.join(', ')}`);

  // Числа описания сверяются с прогоном, а не с памятью автора: грабля проекта
  // в том, что «71 замечание» живёт в документе месяцами после того, как правил
  // стало больше. Здесь каждый счётчик, который читает человек, проверяется по
  // модели — и это единственное место, где документ обязан быть точным.
  const num = (re, what) => {
    const m = doc.match(re);
    assert(m, `в DEMO-ERRORS.md нет строки про «${what}»`);
    return Number(m[1]);
  };
  const totals = doc.match(/Прогон даёт \*\*(\d+) замечани[а-я]*\*\*: \*\*(\d+) стандарта[^*]*\*\* и \*\*(\d+) совет/);
  assert(totals, 'в DEMO-ERRORS.md нет строки «Прогон даёт N замечаний: N стандарта и N советов»');
  assert(Number(totals[1]) === findings.length,
    `описание обещает ${totals[1]} замечаний, прогон даёт ${findings.length}`);
  assert(Number(totals[2]) === findings.filter((f) => f.basis === 'uml').length,
    `описание обещает ${totals[2]} замечаний стандарта, прогон даёт ${findings.filter((f) => f.basis === 'uml').length}`);
  assert(Number(totals[3]) === findings.filter((f) => f.basis === 'practice').length,
    `описание обещает ${totals[3]} советов, прогон даёт ${findings.filter((f) => f.basis === 'practice').length}`);
  assert(num(/Правил с функцией — \*\*(\d+)\*\*/, 'правил с функцией') === expected.length,
    'число правил с функцией в описании разошлось с набором');
  const shape = doc.match(/Модель: \*\*(\d+) элементов, (\d+) связей?, (\d+) диаграмм/);
  assert(shape, 'в DEMO-ERRORS.md нет строки «Модель: N элементов, N связей, N диаграмм»');
  assert(Number(shape[1]) === model.elements.length && Number(shape[2]) === model.relationships.length
    && Number(shape[3]) === model.diagrams.length,
  `описание обещает ${shape[1]}/${shape[2]}/${shape[3]}, а в модели `
    + `${model.elements.length}/${model.relationships.length}/${model.diagrams.length}`);
  return `описание полно; числа сходятся: ${findings.length} = `
    + `${totals[2]} + ${totals[3]}, правил ${expected.length}, листов ${shape[3]}`;
});

await check('демо не путает слои', async () => {
  const practice = findings.filter((f) => f.basis === 'practice');
  const standard = findings.filter((f) => f.basis === 'uml');
  assert(practice.length && standard.length, 'один из слоёв пуст');
  const bad = practice.filter((f) => f.clause !== null);
  assert(!bad.length, `у практики появился пункт стандарта: ${bad.map((f) => f.ruleId).join(', ')}`);
  return `стандарт ${standard.length}, практика ${practice.length}`;
});

/* ------------------------------------------------------------- сводка */

console.log('\n  правило                                  находок  уровень  слой');
for (const id of expected) {
  const list = byRule.get(id) ?? [];
  const f = list[0];
  console.log(`  ${id.padEnd(40)} ${String(list.length).padStart(4)}     ${String(f?.level ?? '—').padEnd(7)} ${f?.basis ?? '—'}`);
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length
  ? `Провалено ${failed.length} из ${results.length}.`
  : `Проверок пройдено: ${results.length} из ${results.length}.`);
process.exit(failed.length ? 1 : 0);
