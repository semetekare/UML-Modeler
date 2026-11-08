#!/usr/bin/env node
// Проверка канонического профиля: ничего не потеряно и числа совпали.
//
//   node material/profile-canonical/check.mjs
//
// Читает material/stereotypes.xml (источник), material/stereotype-icons.json,
// app/notation/uml.json и material/profile-canonical/profile.json (результат).
// Код возврата 1, если хоть одна проверка не прошла — как audit.py, чтобы
// числа в документации не могли тихо разъехаться с данными.
//
// XML разбирается регулярным выражением намеренно: в проекте нет зависимостей,
// а выгрузка VP регулярна — атрибуты всегда в двойных кавычках, тег
// <Stereotype …> не бывает самозакрытым. Парсер проверяет это на 428 записях.
//
// Проверки:
//   1. каждая из 428 записей исходника — в sources ровно одной канонической
//      записи; ни одна не потеряна и не посчитана дважды;
//   2. 428 → 407 (−21: 18 дублей + 3 дефекта написания);
//   3. все 23 непустых iconPath сохранены;
//   4. baseTypes канонической записи — объединение baseTypes схлопнутых;
//   5. name есть в app/notation/uml.json или в исходном профиле дословно;
//   6. EXPECTED не разошёлся с измеренным.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE_XML = resolve(ROOT, 'material/stereotypes.xml');
const ICONS = resolve(ROOT, 'material/stereotype-icons.json');
const NOTATION = resolve(ROOT, 'app/notation/uml.json');
const PROFILE_JSON = resolve(ROOT, 'material/profile-canonical/profile.json');

// Опубликованные величины. Расхождение — ошибка прогона, а не «новые данные».
const EXPECTED = {
  records: 428,
  definitionsAfter: 407,
  iconPaths: 23,
  stereotypes: 304,
};
const EXPECTED_DERIVED = {
  exactPairs: 410,
  duplicates: 18,
  spellingMerged: 3,
  mergedTotal: 21,
  drawings: 15,
};

const problems = [];
const fail = (message) => problems.push(message);
const check = (condition, message) => {
  if (!condition) fail(message);
};

// ---------------------------------------------------------------- разбор XML

function decodeEntities(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function readRecords(text) {
  const scopeMarks = [
    { tag: '<ApplicationStereotypes', scope: 'application', at: text.indexOf('<ApplicationStereotypes') },
    { tag: '<ProjectStereotypes', scope: 'project', at: text.indexOf('<ProjectStereotypes') },
  ].filter((mark) => mark.at >= 0);
  check(scopeMarks.length === 2, 'в XML нет обоих разделов профиля');

  const records = [];
  const openTag = /<Stereotype\b((?:"[^"]*"|[^>"])*)>/g;
  const attr = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
  for (const match of text.matchAll(openTag)) {
    const attrs = {};
    for (const [, key, value] of match[1].matchAll(attr)) attrs[key] = decodeEntities(value);
    const before = scopeMarks.filter((mark) => mark.at <= match.index);
    const scope = before.length ? before[before.length - 1].scope : 'unknown';
    records.push({
      id: attrs.id ?? '',
      name: attrs.name ?? '',
      baseType: attrs.baseType ?? '',
      iconPath: (attrs.iconPath ?? '').trim(),
      scope,
    });
  }
  return records;
}

const normalize = (name) => (name ?? '').replace(/[\s_-]+/g, '').toLowerCase();

// ------------------------------------------------------------------- чтение

const xml = readFileSync(PROFILE_XML, 'utf8');
const records = readRecords(xml);
const profile = JSON.parse(readFileSync(PROFILE_JSON, 'utf8'));
const iconMap = JSON.parse(readFileSync(ICONS, 'utf8')).map ?? {};
const notation = JSON.parse(readFileSync(NOTATION, 'utf8'));

const notationValues = new Set();
for (const group of ['shapes', 'connectors']) {
  for (const defn of Object.values(notation[group] ?? {})) {
    for (const field of ['stereotype', 'keyword']) {
      if (defn[field]) notationValues.add(defn[field]);
    }
  }
}

// ------------------------------------------------------------------ проверки

const recordsById = new Map();
for (const record of records) {
  check(record.id, 'запись без id');
  check(!recordsById.has(record.id), `повтор id в исходнике: ${record.id}`);
  check(record.scope !== 'unknown', `запись ${record.id} вне разделов профиля`);
  recordsById.set(record.id, record);
}
check(records.length === EXPECTED.records, `записей в исходнике ${records.length}, ожидалось ${EXPECTED.records}`);

// 1. покрытие sources: каждая запись ровно в одной канонической записи
const sourceOwner = new Map();
const sourceOccurrences = [];
for (const stereotype of profile.stereotypes ?? []) {
  check(Array.isArray(stereotype.sources) && stereotype.sources.length > 0,
    `${stereotype.id}: пустой sources`);
  for (const source of stereotype.sources ?? []) {
    const m = /^([AP]):(.+)$/.exec(source);
    check(m, `${stereotype.id}: источник ${source} не в форме A:<id> или P:<id>`);
    if (!m) continue;
    const id = m[2];
    const record = recordsById.get(id);
    check(record, `${stereotype.id}: источник ${id} отсутствует в исходнике`);
    check(!sourceOwner.has(id), `запись ${id} посчитана дважды: ${sourceOwner.get(id)} и ${stereotype.id}`);
    sourceOwner.set(id, stereotype.id);
    sourceOccurrences.push(source);
    if (record) {
      check(m[1] === (record.scope === 'application' ? 'A' : 'P'),
        `${stereotype.id}: ${id} записан как ${source}, а его область ${record.scope}`);
      check(stereotype.name === record.name || (stereotype.aliases ?? []).includes(record.name),
        `${stereotype.id}: написание ${JSON.stringify(record.name)} не каноническое и не в aliases`);
      check(stereotype.baseTypes.includes(record.baseType),
        `${stereotype.id}: baseType ${record.baseType} записи ${id} не в baseTypes`);
    }
  }
}
check(sourceOwner.size === records.length,
  `sources покрывают ${sourceOwner.size} записей из ${records.length}`);
for (const record of records) {
  check(sourceOwner.has(record.id), `запись ${record.id} (${record.name} / ${record.baseType}) потеряна`);
}

// 2. числа до и после
const exactPairs = new Set(records.map((r) => `${r.name}\u0000${r.baseType}`));
const duplicates = records.length - exactPairs.size;
const definitions = profile.stereotypes.reduce((sum, s) => sum + s.baseTypes.length, 0);
const spellingMerged = exactPairs.size - definitions;
const names = new Set(profile.stereotypes.map((s) => s.name));
const normalizedSource = new Set(records.map((r) => normalize(r.name)));

check(definitions === EXPECTED.definitionsAfter,
  `определений после дедупликации ${definitions}, ожидалось ${EXPECTED.definitionsAfter}`);
check(profile.stereotypes.length === EXPECTED.stereotypes,
  `стереотипов ${profile.stereotypes.length}, ожидалось ${EXPECTED.stereotypes}`);
check(names.size === profile.stereotypes.length, 'два стереотипа с одним именем');
check(normalizedSource.size === EXPECTED.stereotypes,
  `нормализованных имён в исходнике ${normalizedSource.size}, ожидалось ${EXPECTED.stereotypes}`);
check(records.length - definitions === EXPECTED_DERIVED.mergedTotal,
  `удалено ${records.length - definitions} записей, ожидалось ${EXPECTED_DERIVED.mergedTotal}`);
check(duplicates === EXPECTED_DERIVED.duplicates,
  `дублей ${duplicates}, ожидалось ${EXPECTED_DERIVED.duplicates}`);
check(spellingMerged === EXPECTED_DERIVED.spellingMerged,
  `сведено написаний ${spellingMerged}, ожидалось ${EXPECTED_DERIVED.spellingMerged}`);
check(exactPairs.size === EXPECTED_DERIVED.exactPairs,
  `пар (имя, baseType) ${exactPairs.size}, ожидалось ${EXPECTED_DERIVED.exactPairs}`);
// 428 − 18 − 3 = 407 — арифметика должна сходиться явно, а не «получилось»
check(EXPECTED.records - EXPECTED_DERIVED.duplicates - EXPECTED_DERIVED.spellingMerged
  === EXPECTED.definitionsAfter, 'арифметика 428 − 18 − 3 ≠ 407');

// 3. рисунки
const sourcePaths = new Set(records.filter((r) => r.iconPath).map((r) => r.iconPath));
const profilePaths = new Set(
  profile.stereotypes.flatMap((s) => s.pictogram?.iconPaths ?? []),
);
check(sourcePaths.size === EXPECTED.iconPaths,
  `различных iconPath в исходнике ${sourcePaths.size}, ожидалось ${EXPECTED.iconPaths}`);
check(profilePaths.size === EXPECTED.iconPaths,
  `различных iconPath в каноническом профиле ${profilePaths.size}, ожидалось ${EXPECTED.iconPaths}`);
for (const path of sourcePaths) {
  check(profilePaths.has(path), `iconPath ${path} потерян`);
  check(Object.hasOwn(iconMap, path), `iconPath ${path} отсутствует в material/stereotype-icons.json`);
}
for (const path of profilePaths) {
  check(sourcePaths.has(path), `iconPath ${path} появился из ниоткуда`);
}
const assets = new Set([...profilePaths].map((path) => iconMap[path]?.asset).filter(Boolean));
const drawings = new Set([...profilePaths].map((path) => iconMap[path]?.glyph ?? iconMap[path]?.asset).filter(Boolean));
check(drawings.size === EXPECTED_DERIVED.drawings,
  `рисунков ${drawings.size}, ожидалось ${EXPECTED_DERIVED.drawings}`);
check(assets.size === EXPECTED_DERIVED.drawings,
  `ассетов ${assets.size}, ожидалось ${EXPECTED_DERIVED.drawings}`);
for (const stereotype of profile.stereotypes) {
  if (!stereotype.pictogram) continue;
  const paths = stereotype.pictogram.iconPaths ?? [];
  check(paths.length > 0, `${stereotype.id}: pictogram без iconPaths`);
  for (const [base, row] of Object.entries(stereotype.pictogramByBaseType ?? {})) {
    check(stereotype.baseTypes.includes(base),
      `${stereotype.id}: рисунок для baseType ${base}, которого нет в baseTypes`);
    if (!row) continue;
    check(paths.includes(row.iconPath),
      `${stereotype.id}: рисунок ${base} не в iconPaths`);
    check(row.asset === stereotype.pictogram.asset,
      `${stereotype.id}: рисунок ${base} ведёт на ${row.asset}, а не на ${stereotype.pictogram.asset}`);
  }
  for (const path of paths) {
    const row = iconMap[path];
    check(row, `${stereotype.id}: рисунок ${path} не в карте`);
    if (row) {
      check(stereotype.pictogram.asset === row.asset,
        `${stereotype.id}: path ${path} ведёт на ${row.asset}, а не на ${stereotype.pictogram.asset}`);
      check(stereotype.pictogram.kind === (row.kind ?? 'badge'),
        `${stereotype.id}: kind разошёлся с картой на ${path}`);
      check(stereotype.pictogram.glyph === (row.glyph ?? row.asset),
        `${stereotype.id}: glyph разошёлся с картой на ${path}`);
    }
  }
}

// 4. baseTypes — объединение схлопнутых записей
for (const stereotype of profile.stereotypes) {
  const union = new Set();
  for (const source of stereotype.sources) {
    const id = source.slice(2);
    const record = recordsById.get(id);
    if (record) union.add(record.baseType);
  }
  const declared = new Set(stereotype.baseTypes);
  check(union.size === declared.size
    && [...union].every((base) => declared.has(base)),
    `${stereotype.id}: baseTypes ${[...declared].join(', ')} ≠ объединение источников ${[...union].join(', ')}`);
  check(new Set(stereotype.baseTypes).size === stereotype.baseTypes.length,
    `${stereotype.id}: повтор baseType`);
}

// 5. имя — реальное написание, а не выдуманное
const sourceNames = new Set(records.map((r) => r.name));
for (const stereotype of profile.stereotypes) {
  check(notationValues.has(stereotype.name) || sourceNames.has(stereotype.name),
    `${stereotype.id}: имя ${JSON.stringify(stereotype.name)} нет ни в нотации, ни в профиле`);
  for (const alias of stereotype.aliases ?? []) {
    check(sourceNames.has(alias), `${stereotype.id}: псевдоним ${JSON.stringify(alias)} не встречается в профиле`);
    check(alias !== stereotype.name, `${stereotype.id}: псевдоним совпал с именем`);
  }
}

// 6. EXPECTED
check(records.length === EXPECTED.records, `EXPECTED.records: ${records.length}`);
check(profile.stereotypes.length === EXPECTED.stereotypes, `EXPECTED.stereotypes: ${profile.stereotypes.length}`);
check(sourcePaths.size === EXPECTED.iconPaths, `EXPECTED.iconPaths: ${sourcePaths.size}`);
check(definitions === EXPECTED.definitionsAfter, `EXPECTED.definitionsAfter: ${definitions}`);

// -------------------------------------------------------------------- вывод

const report = profile.report ?? {};
check(report.recordsIn === records.length, 'report.recordsIn разошёлся с исходником');
check(report.after === definitions, 'report.after разошёлся с baseTypes');
check(report.merged === records.length - definitions, 'report.merged разошёлся с числом удалённых');
check(report.stereotypes === profile.stereotypes.length, 'report.stereotypes разошёлся со списком');

console.log(
  `записей ${records.length} → определений ${definitions} → стереотипов ${profile.stereotypes.length}; ` +
  `удалено ${records.length - definitions} (дублей ${duplicates}, написаний ${spellingMerged})`,
);
console.log(
  `iconPath ${sourcePaths.size} → рисунков ${drawings.size}; ` +
  `покрытие sources: ${sourceOwner.size}/${records.length}`,
);

if (problems.length) {
  for (const problem of problems) console.error(`РАСХОЖДЕНИЕ: ${problem}`);
  process.exit(1);
}
console.log('ok: канонический профиль полон, числа сошлись');