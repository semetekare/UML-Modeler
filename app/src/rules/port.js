// 11.8.14.7 — Port::encapsulated_owner: `owner = encapsulatedClassifier`.
//
// Порт — точка взаимодействия классификатора с внешним миром, поэтому он
// существует только внутри классификатора. Ошибка, которую ловит правило,
// самая ранняя и массовая: порт перетащили на лист и не положили внутрь
// классификатора — в модели у него нет `ownerId`.
//
// ГРАНИЦА «ТОЛЬКО ЧТО НАРИСОВАНО». У свежей фигуры порта нет ни владельца, ни
// единой связи, и ругаться на неё с первого штриха нельзя — прецедент тот же,
// что у `CombinedFragment` (`fragments.js`): граница «ноль операндов» сняла 26
// ложных срабатываний на корпусе. Поэтому порт без владельца молчит, пока он
// ни к чему не присоединён; как только у него появляется связь (сборка,
// коннектор), он заявлен как порт — и тогда отсутствие классификатора-
// владельца нарушение. Порт С владельцем проверяется всегда, даже без связей:
// владелец-пакет, заметка или другой порт — нарушение по существу, а не по
// недорисовке.
//
// Список видов-владельцев — из задания к правилу (`TO-IMPLEMENT.md`, пачка 2):
// класс, компонент, интерфейс, перечисление, тип данных, актёр, вариант
// использования, узел, артефакт, кооперация. Порта в нём нет, поэтому «порт
// внутри порта» правило ловит — это и есть проверка границы «владелец —
// инкапсулированный классификатор».

import { elementById } from './meta.js';
import { titleOf } from './graph.js';
import { report } from './finding.js';

/** Классификаторы, внутри которых порт имеет смысл (EncapsulatedClassifier). */
const ENCAPSULATED = new Set([
  'class', 'component', 'interface', 'enumeration', 'datatype',
  'actor', 'usecase', 'node', 'artifact', 'collaboration',
]);

/** id элементов, участвующих хотя бы в одной связи модели. */
function wiredIds(model) {
  const ids = new Set();
  for (const rel of model.relationships ?? []) {
    if (rel.from != null && rel.from !== '') ids.add(String(rel.from));
    if (rel.to != null && rel.to !== '') ids.add(String(rel.to));
  }
  return ids;
}

/**
 * 11.8.14.7 — `encapsulated_owner`: все порты принадлежат инкапсулированному
 * классификатору.
 *
 * Замечание — на порт: виноват он сам, а не владелец. Битый `ownerId` правило
 * пропускает: такую ссылку снимает загрузчик (`validateRefs`), и судить её
 * здесь значило бы сообщать об одном и том же дважды.
 */
export function portEncapsulatedOwner(model, rule) {
  const wired = wiredIds(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'port') continue;
    if (!el.ownerId) {
      // Только что нарисованный порт — не нарушение, пока он ни к чему не
      // присоединён (см. шапку модуля).
      if (!wired.has(String(el.id))) continue;
      out.push(report(rule, [el.id],
        `${titleOf(el)}: у порта нет владельца, хотя он уже соединён — `
        + 'порт принадлежит инкапсулированному классификатору'));
      continue;
    }
    const owner = elementById(model, el.ownerId);
    if (!owner) continue;
    if (ENCAPSULATED.has(owner.kind)) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: владелец — ${titleOf(owner)}, а порт принадлежит только `
      + 'инкапсулированному классификатору (класс, компонент, интерфейс, узел, артефакт…)'));
  }
  return out;
}
