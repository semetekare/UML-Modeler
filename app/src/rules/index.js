// Загрузка наборов правил и прогон по модели — точка входа движка.
//
// Наборы лежат рядом с нотацией (`notation/rules/`) и читаются при загрузке
// страницы, как и сама нотация: правила — данные, код — только реестр проверок.
// Файлов два, и это не случайность: `uml-2.5.1.json` — констрейнты стандарта,
// `practice.json` — советы практики моделирования. Разные происхождение и
// уровень доверия к ним нельзя прятать в одном файле.
//
// Ошибка загрузки не мешает работать с моделью: панель «Проверки» говорит, что
// набор не загрузился, и всё. Врать «нарушений нет» в этом случае нельзя —
// поэтому и бросаем, а не возвращаем пустой список.

import { createRuleset } from './engine.js';
import { countByLevel } from './finding.js';

export const RULES_URL = new URL('../../notation/rules/uml-2.5.1.json', import.meta.url).href;
export const PRACTICE_URL = new URL('../../notation/rules/practice.json', import.meta.url).href;

let current = null;

/** Прочитать один файл правил; ошибка называет файл, а не только JSON. */
async function readJson(url, what) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${what} не загрузился: HTTP ${res.status} ${url}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${what} не разобрался как JSON (${e.message}): ${url}`);
  }
}

/**
 * Прочитать оба набора и собрать движок. Бросает, если битый любой из них:
 * половина правил — это не «частично проверено», а непроверенная модель.
 */
export async function loadRules(url = RULES_URL, practiceUrl = PRACTICE_URL) {
  const [pkg, practice] = await Promise.all([
    readJson(url, 'набор правил UML 2.5.1'),
    readJson(practiceUrl, 'набор правил практики'),
  ]);
  current = createRuleset(pkg, { practice });
  return current;
}

/** Движок, собранный `loadRules` (или подставленный тестом); null до загрузки. */
export const ruleset = () => current;

/** Подставить готовый движок — так тесты работают без HTTP. */
export function setRuleset(rs) { current = rs; return current; }

/** Все замечания по модели. Без загруженного набора — ошибка, не пустой список. */
export function runChecks(model, rs = current) {
  if (!rs) throw new Error('набор правил не загружен');
  return rs.run(model);
}

export { countByLevel };