#!/usr/bin/env node
// Данные вкладки «Стандарт»: реестр констрейнтов UML 2.5.1, обрезанный до
// полей, которые вкладка действительно показывает.
//
// ПОЧЕМУ отдельный файл, а не чтение `material/rules-coverage/coverage.json`
// по HTTP: корневая папка `material/` в `dist` не попадает (в сборку идёт
// `app/material/`), поэтому у человека в браузере этого файла нет вовсе.
// Копия лежит рядом с нотацией — `notation/` уже в списке `SITE` у build.mjs,
// и вкладке достаточно одного запроса к своему же сайту.
//
// ПОЧЕМУ обрезка: исходник — 917 КБ, из них вкладке нужны 449 строк с
// метаклассом, пунктом, именем, статусом и текстом констрейнта. Поля
// `needs`, `requires`, `legacyReason`, `reasonChecked`, `reasonNote`,
// `appeared`, `ruleId` вкладка не показывает; `missing` (чего не хватает
// модели) нужна только строкам В ОБЛАСТИ — у 283 «вне области» причина уже
// сказана в `reason` («метакласс не представлен ни одной фигурой»), и
// перечислять у них недостающие свойства значило бы объяснять отсутствие
// фигуры отсутствием поля.
//
// Запуск: из папки `app` — `node tools/build-coverage-ui.mjs`.
// Свежесть проверяет tools/verify.mjs по md5 исходника: он записан в
// `source.md5` сгенерированного файла.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(APP, '..', 'material', 'rules-coverage', 'coverage.json');
const OUT = path.join(APP, 'notation', 'rules', 'coverage.json');

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const kb = (n) => `${(n / 1024).toFixed(0)} КБ`;

const raw = readFileSync(SOURCE);
const src = JSON.parse(raw.toString('utf8'));
if (!Array.isArray(src.byMetaclass)) throw new Error(`${SOURCE}: нет byMetaclass — это не реестр покрытия`);

const STATUSES = ['executable', 'todo', 'tautology', 'gap', 'no-ocl', 'out-of-scope'];

/**
 * Одна строка реестра. Пустые поля не пишутся вовсе: у `executable` и `todo`
 * причины нет, у `out-of-scope` нет `missing`, — и `null` в файле читался бы
 * как «поле есть, но пустое», то есть как другая причина.
 */
function row(it) {
  const out = {
    metaclass: it.metaclass,
    name: it.name,
    clause: it.clause,
    page: it.page ?? null,
    status: it.status,
    scope: it.scope,
  };
  if (it.reason) out.reason = it.reason;
  if (it.text) out.text = it.text;
  if (it.ocl) out.ocl = it.ocl;
  // Свойства из `missing` — только там, где модель вообще способна выразить
  // метакласс: у «вне области» разговор не о поле, а о фигуре.
  if (it.scope === 'in' && Array.isArray(it.missing) && it.missing.length) {
    out.missing = it.missing.map((m) => ({ property: m.property, why: m.why }));
  }
  return out;
}

const items = src.byMetaclass.flatMap((m) => m.items ?? []).map(row);
if (items.length !== src.totals.constraints) {
  throw new Error(`строк ${items.length}, а в totals ${src.totals.constraints} — реестр сам себе противоречит`);
}

/** Счётчики по статусам: чипы фильтра берут числа отсюда, а не считают на глаз. */
const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
for (const it of items) {
  if (!(it.status in byStatus)) throw new Error(`неизвестный статус «${it.status}» у ${it.metaclass}::${it.name}`);
  byStatus[it.status] += 1;
}
// Сверка с totals: если реестр поменяет раскладку статусов, а этот файл нет,
// вкладка покажет числа, которых нет ни в одном отчёте. Лучше упасть здесь.
const EXPECT = {
  executable: src.totals.executable,
  todo: src.totals.todo,
  tautology: src.totals.tautology,
  gap: src.totals.gap,
  'no-ocl': src.totals.noOcl,
  'out-of-scope': src.totals.outOfScope,
};
for (const [k, v] of Object.entries(EXPECT)) {
  if (byStatus[k] !== v) throw new Error(`статус ${k}: посчитано ${byStatus[k]}, в totals ${v}`);
}

const inScope = items.filter((it) => it.scope === 'in').length;
if (inScope !== src.totals.inScope) {
  throw new Error(`в области ${inScope}, а в totals ${src.totals.inScope}`);
}

const payload = {
  schema: 'uml-coverage-ui/1',
  // Отпечаток исходника: по нему verify.mjs ловит «реестр пересобрали, а
  // вкладку нет» — иначе человек читал бы в приложении прошлые числа.
  source: {
    file: 'material/rules-coverage/coverage.json',
    bytes: raw.length,
    md5: md5(raw),
    builtBy: 'app/tools/build-coverage-ui.mjs',
  },
  totals: {
    constraints: src.totals.constraints,
    inScope: src.totals.inScope,
    outOfScope: src.totals.outOfScope,
    rulesWritten: src.totals.rulesWritten,
    metaclasses: src.totals.metaclasses,
    metaclassesCovered: src.totals.metaclassesCovered,
  },
  byStatus,
  items,
};

const text = JSON.stringify(payload);
writeFileSync(OUT, text);

const before = statSync(SOURCE).size;
const after = Buffer.byteLength(text);
console.log(`build-coverage-ui: ${path.relative(APP, OUT)}`);
console.log(`  строк ${items.length}: в области ${inScope}, вне области ${src.totals.outOfScope}`);
console.log(`  статусы: ${STATUSES.map((s) => `${s} ${byStatus[s]}`).join(' · ')}`);
console.log(`  размер ${kb(before)} → ${kb(after)} (${(100 - (after / before) * 100).toFixed(0)} % меньше), `
  + `md5 исходника ${md5(raw).slice(0, 8)}…`);
