#!/usr/bin/env node
/**
 * Сборка профиля стереотипов приложения (Э9, партия Б11).
 *
 * Вход — канонический профиль, уже сверенный с выгрузкой профиля:
 *   material/profile-canonical/profile.json
 *     428 записей <Stereotype> → 407 определений → 304 стереотипа,
 *     9 псевдонимов, 23 iconPath, 15 различных рисунков.
 *   Сверка 428/428 и этих чисел — material/profile-canonical/check.mjs.
 *
 * Выход — app/profile/stereotypes.json: то же самое, но только то, что
 * приложение действительно читает. Перевод из канонической формы:
 *
 *   * `sources` (id всех 428 записей) НЕ переносится: это доказательство
 *     полноты канонизации, а не данные приложения; оно остаётся в
 *     material/profile-canonical и проверяется там;
 *   * `rules` не переносится: правила канонизации — текст документации
 *     (docs/uml/profile.md), а не поле, которое кто-то читает;
 *   * порядок ключей фиксирован, порядок записей — порядок канонического
 *     профиля. Значит два прогона дают побайтово тот же файл.
 *
 * Почему отдельный шаг, а не чтение XML на старте: 428 записей сводятся по
 * (нормализованное имя, baseType) правилами из docs/uml/profile.md §2.
 * Держать вторую копию этих правил в браузере — гарантированное расхождение
 * с check.mjs; здесь правила применены один раз, результат проверяем.
 *
 * ФЛАГИ
 *   --check   ничего не писать: собрать в памяти и сравнить с файлом на
 *             диске; код 1, если файл устарел (так проверяется, что
 *             app/profile/stereotypes.json соответствует входу)
 *   --out=<dir>   куда писать (по умолчанию app/profile); нужно проверке
 *                 детерминированности: два прогона в разные пустые папки
 *   --quiet   не печатать сводку
 *
 * Только stdlib Node: никаких зависимостей, никакой установки.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');            // .../visual-paradigm
const CANONICAL = path.join(ROOT, 'material', 'profile-canonical', 'profile.json');
const ICONS = path.join(ROOT, 'app', 'src', 'brand', 'icons');

const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq < 0 ? true : hit.slice(eq + 1);
};
const CHECK = arg('check') === true;
const QUIET = arg('quiet') === true;
const outArg = arg('out');
const OUT = path.resolve(ROOT, typeof outArg === 'string' ? outArg : path.join('app', 'profile'));
const FILE = path.join(OUT, 'stereotypes.json');

/**
 * Опубликованные величины (docs/uml/profile.md §3). Расхождение —
 * ошибка прогона, а не «новые данные»: числа в документации не могут тихо
 * разъехаться с входом.
 */
const EXPECTED = {
  records: 428,
  definitions: 407,
  stereotypes: 304,
  aliases: 9,
  iconPaths: 23,
  drawings: 15,
};

const problems = [];
const fail = (message) => { problems.push(message); };

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ------------------------------------------------------------- проверки */

/**
 * Сверка входа с опубликованными числами. Проверяется не только `counts`,
 * но и то, что из него следует: сумма baseTypes — это определения, длина
 * списка — стереотипы. Иначе `counts` мог бы соврать в одиночку.
 */
function verify(profile) {
  const list = Array.isArray(profile?.stereotypes) ? profile.stereotypes : [];
  const counts = profile?.counts ?? {};
  const compare = (name, measured) => {
    const published = EXPECTED[name];
    const declared = name === 'stereotypes' ? counts.stereotypes
      : name === 'records' ? counts.records
        : name === 'definitions' ? counts.definitions
          : name === 'aliases' ? counts.aliases
            : name === 'drawings' ? counts.icons
              : null;
    if (declared != null && declared !== published) {
      fail(`counts.${name}: ${declared} вместо ${published} — вход пересобран, обновите EXPECTED и документацию`);
    }
    if (measured != null && measured !== published) {
      fail(`${name}: измерено ${measured} вместо ${published}`);
    }
  };

  compare('stereotypes', list.length);
  compare('definitions', list.reduce((n, s) => n + (s.baseTypes?.length ?? 0), 0));
  compare('aliases', list.reduce((n, s) => n + (s.aliases?.length ?? 0), 0));
  compare('records', null);

  const iconPaths = new Set();
  const drawings = new Set();
  for (const s of list) {
    for (const p of s.pictogram?.iconPaths ?? []) iconPaths.add(p);
    for (const row of Object.values(s.pictogramByBaseType ?? {})) {
      for (const p of row?.iconPaths ?? []) iconPaths.add(p);
      if (row?.asset) drawings.add(row.asset);
    }
    if (s.pictogram?.asset) drawings.add(s.pictogram.asset);
  }
  compare('iconPaths', iconPaths.size);
  compare('drawings', drawings.size);

  const ids = new Set();
  const names = new Set();
  for (const s of list) {
    if (!s?.id) fail('запись без id');
    else if (ids.has(s.id)) fail(`id ${s.id} повторяется`);
    else ids.add(s.id);
    if (!s?.name) fail(`запись ${s.id}: нет имени`);
    else if (names.has(s.name)) fail(`имя «${s.name}» повторяется`);
    else names.add(s.name);
    if (!Array.isArray(s.baseTypes) || !s.baseTypes.length) fail(`запись ${s.id}: нет baseTypes`);
    if (!['application', 'project'].includes(s.scope)) fail(`запись ${s.id}: область «${s.scope}»`);
    for (const a of s.aliases ?? []) if (names.has(a)) fail(`псевдоним «${a}» совпал с именем записи`);
  }

  // Каждый рисунок обязан иметь файл: профиль называет ассет, а рисует его
  // SVG рядом с приложением. Иначе «пиктограмма есть в данных, но не на
  // листе» — тихая потеря, которую видно только глазами.
  for (const asset of drawings) {
    if (!existsSync(path.join(ICONS, `${asset}.svg`))) fail(`нет файла рисунка ${asset}.svg`);
  }
}

/* --------------------------------------------------------------- запись */

/**
 * Запись в том виде и порядке, в каком её читает приложение.
 * Необязательные группы (рисунок и tagged-определения по baseType) пишутся
 * только когда они есть — отсутствие поля и есть «ничего особенного».
 */
const canonicalRecord = (s) => {
  const out = {
    id: s.id,
    name: s.name,
    aliases: [...(s.aliases ?? [])],
    baseTypes: [...(s.baseTypes ?? [])],
    scope: s.scope,
    documentation: s.documentation ?? '',
    pictogram: s.pictogram ?? null,
  };
  if (s.pictogramByBaseType) {
    out.pictogramByBaseType = Object.fromEntries(
      Object.entries(s.pictogramByBaseType).map(([base, row]) => [base, row ?? null]),
    );
  }
  out.taggedValues = (s.taggedValues ?? []).map(canonicalTagged);
  if (s.taggedValuesByBaseType) {
    out.taggedValuesByBaseType = Object.fromEntries(
      Object.entries(s.taggedValuesByBaseType).map(([base, rows]) => [base, (rows ?? []).map(canonicalTagged)]),
    );
  }
  if (s.taggedValuesVariants) {
    out.taggedValuesVariants = s.taggedValuesVariants.map((v) => ({
      baseType: v.baseType,
      variants: (v.variants ?? []).map((row) => ({ taggedValues: (row.taggedValues ?? []).map(canonicalTagged) })),
    }));
  }
  return out;
};

/** Tagged-определение: имя, тип, умолчание, документация, значения перечисления. */
const canonicalTagged = (t) => ({
  name: t.name ?? '',
  type: t.type ?? 'text',
  default: t.default ?? '',
  documentation: t.documentation ?? '',
  values: [...(t.values ?? [])],
});

/** Собрать файл в памяти: одна и та же строка на один и тот же вход. */
function build() {
  const profile = readJson(CANONICAL);
  verify(profile);
  const out = {
    version: 1,
    source: 'material/profile-canonical/profile.json (профиль 16.3)',
    sourceSha256: profile.sourceSha256 ?? '',
    counts: {
      records: EXPECTED.records,
      definitions: EXPECTED.definitions,
      stereotypes: EXPECTED.stereotypes,
      aliases: EXPECTED.aliases,
      icons: EXPECTED.drawings,
    },
    stereotypes: (profile.stereotypes ?? []).map(canonicalRecord),
  };
  return { out, text: JSON.stringify(out, null, 1) + '\n' };
}

/* ------------------------------------------------------------------ main */

const { out, text } = build();
if (problems.length) {
  for (const p of problems) console.error(`build-profile: ${p}`);
  process.exit(1);
}

if (CHECK) {
  const now = existsSync(FILE) ? readFileSync(FILE, 'utf8') : null;
  if (now === null) {
    console.error(`build-profile: нет файла ${path.relative(ROOT, FILE)} — запустите node tools/build-profile.mjs`);
    process.exit(1);
  }
  if (now !== text) {
    const a = JSON.parse(now);
    const b = out;
    const lost = (b.stereotypes ?? []).filter((s) => !(a.stereotypes ?? []).some((x) => x.id === s.id)).length;
    const extra = (a.stereotypes ?? []).filter((s) => !(b.stereotypes ?? []).some((x) => x.id === s.id)).length;
    console.error(`build-profile: ${path.relative(ROOT, FILE)} устарел `
      + `(${now.length} Б в файле, ${text.length} Б по входу; записей не хватает ${lost}, лишних ${extra})`);
    process.exit(1);
  }
  if (!QUIET) console.log(`build-profile: ${path.relative(ROOT, FILE)} совпадает со входом (${out.stereotypes.length} стереотипов)`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(FILE, text);
if (!QUIET) {
  const drawings = new Set(out.stereotypes.flatMap((s) => Object.values(s.pictogramByBaseType ?? {})
    .map((row) => row?.asset).filter(Boolean)));
  console.log(`build-profile готов: ${path.relative(ROOT, FILE)} — ${out.counts.stereotypes} стереотипов, `
    + `${out.counts.definitions} расширений, ${out.counts.aliases} псевдонимов, ${drawings.size} рисунков, ${text.length} Б`);
}