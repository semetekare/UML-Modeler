// 11.8.6.7 — Component::no_packaged_elements: компонент, вложенный в класс, не
// может иметь упаковываемых элементов.
//
// Смысл констрейнта: компонент внутри класса — это ЧАСТЬ класса, его внутренняя
// реализация, и собственного содержимого у такой части нет — содержимое есть у
// класса. Нарушение выглядит так: компонент положили внутрь класса и тут же
// завели внутри компонента ещё класс или интерфейс.
//
// ГРАНИЦА. Правило молчит, если компонент лежит внутри компонента: `nestingClass`
// — именно класс, а компонент в компоненте — законная композиция (и о ней
// говорит отдельное правило о вложенных классификаторах, `componentNestedClassifier`
// ниже). Молчит и компонент верхнего уровня: у него `nestingClass = null`, и
// содержимое ему положено. Обе границы названы в `hint`.
//
// Второе правило модуля, `Component::no_nested_classifiers` (11.8.6.7),
// продолжает ту же мысль с другой стороны: у компонента, вложенного в класс,
// бывает только упаковываемое содержимое (пакеты, заметки, артефакты), а
// классификаторов нет. Компонент в компоненте и компонент верхнего уровня с
// классификаторами — норма: у них своё содержимое есть. Это и есть граница
// правила, записанная в `hint`.
//
// ПОЧЕМУ «ВНУТРИ КЛАССА» — ЭТО ЦЕПОЧКА, А НЕ ПРЯМОЙ ВЛАДЕЛЕЦ. Вложенный
// классификатор — одновременно и упаковываемый элемент (Classifier — потомок
// PackageableElement), поэтому у компонента прямо в классе оба констрейнта
// описывают одну ситуацию, и фикстура одного задевала бы другое. Пакет по
// дороге разводит их без вранья: пакет — пространство имён, а не классификатор,
// и компонент в пакете внутри класса всё равно часть класса. Поэтому
// `nestingClass` ищется по цепочке владельцев до первого классификатора-
// контейнера (см. `nestingClassOf`), а `componentNestedInClass` остаётся на
// прямом владельце — так и задумано: это разные констрейнты.

import { elementById, metaclassesOf } from './meta.js';
import { titleOf } from './graph.js';
import { report } from './finding.js';

/**
 * Классификатор ли вид: `Classifier` есть в цепочке предков метакласса вида
 * (`meta.js`). Виды, которых в таблице нет (заметка, состояние, действие,
 * объект), классификаторами не являются — и это не «не знаем», а свойство
 * метамодели: у них нет Classifier среди предков.
 */
const isClassifier = (kind) => Boolean(metaclassesOf(kind)?.includes('Classifier'));

/**
 * 11.8.6.7 — `nestingClass <> null implies packagedElement->isEmpty()`.
 *
 * `packagedElement` — это содержимое компонента, то есть элементы с
 * `ownerId = компонент`. Замечание — на компонент; в `targets` дальше идут его
 * элементы, чтобы было видно, что именно убирать.
 */
export function componentNestedInClass(model, rule) {
  const children = new Map();
  for (const el of model.elements ?? []) {
    if (!el.ownerId) continue;
    const key = String(el.ownerId);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(el);
  }
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'component' || !el.ownerId) continue;
    const owner = elementById(model, el.ownerId);
    if (!owner || owner.kind !== 'class') continue;
    const inside = children.get(String(el.id)) ?? [];
    if (!inside.length) continue;
    out.push(report(rule, [el.id, ...inside.map((e) => e.id)],
      `${titleOf(el)} вложен в ${titleOf(owner)}, но содержит `
      + `${inside.map((e) => `${titleOf(e)} (${e.kind})`).join(', ')}: `
      + 'у компонента внутри класса своего содержимого быть не может'));
  }
  return out;
}

/**
 * 11.8.6.7 — `no_nested_classifiers`: `nestedClassifier->isEmpty()`.
 *
 * Констрейнт говорит о компоненте, вложенном в класс: у такой части класса
 * своего содержимого нет, поэтому и классификаторов внутри неё нет — только
 * упаковываемые элементы (заметки, артефакты). Границы названы в `hint`:
 * компонент в компоненте и компонент верхнего уровня правило не трогает.
 *
 * `nestedClassifier` — это вложенные элементы, чей метакласс — Classifier
 * (класс, интерфейс, перечисление, компонент, актёр…). Заметка и состояние
 * классификаторами не являются и в нарушение не идут: они и есть то
 * упаковываемое содержимое, которое у компонента внутри класса остаётся.
 *
 * Замечание — на компонент; в `targets` дальше идут его классификаторы, чтобы
 * было видно, что именно убирать (так же устроен `componentNestedInClass`).
 */
export function componentNestedClassifier(model, rule) {
  const children = new Map();
  for (const el of model.elements ?? []) {
    if (!el.ownerId) continue;
    const key = String(el.ownerId);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(el);
  }
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'component' || !el.ownerId) continue;
    const owner = nestingClassOf(model, el);
    if (!owner) continue;
    const inside = (children.get(String(el.id)) ?? []).filter((e) => isClassifier(e.kind));
    if (!inside.length) continue;
    out.push(report(rule, [el.id, ...inside.map((e) => e.id)],
      `${titleOf(el)} вложен в ${titleOf(owner)}, но содержит `
      + `${inside.map((e) => `${titleOf(e)} (${e.kind})`).join(', ')}: `
      + 'классификаторов у компонента внутри класса быть не может'));
  }
  return out;
}

/**
 * Класс, внутри которого лежит компонент (`nestingClass`), или `null`.
 *
 * Идём по цепочке владельцев вверх и останавливаемся на первом
 * КЛАССИФИКАТОРЕ-контейнере: встретился компонент — это «компонент в
 * компоненте», законная композиция, и правило молчит (граница названа в
 * `hint`); встретился класс — компонент есть часть класса, и его содержимое
 * судится. Пакеты, узлы и прочие пространства имён по дороге пропускаются: они
 * не классификаторы, и вложенность через них не делает компонент «верхним
 * уровнем» — он всё равно часть класса.
 *
 * Почему не просто `ownerId`: `componentNestedInClass` (`no_packaged_elements`)
 * смотрит на ПРЯМОГО владельца, и его фикстура — компонент прямо в классе с
 * упаковываемым элементом. Две констрейнта об одном и том же месте разошлись бы
 * ровно на промежуточном пакете; здесь этого нет: `nestingClass` — класс, в
 * чьей внутренности компонент оказался, а не обязательно сосед по `ownerId`.
 */
function nestingClassOf(model, el) {
  const byId = new Map((model.elements ?? []).map((e) => [e.id, e]));
  const seen = new Set([String(el.id)]);
  let cur = el.ownerId ? byId.get(String(el.ownerId)) : null;
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id));
    if (cur.kind === 'component') return null;   // компонент в компоненте — норма
    if (cur.kind === 'class') return cur;        // часть класса — судим
    cur = cur.ownerId ? byId.get(String(cur.ownerId)) : null;
  }
  return null;
}
