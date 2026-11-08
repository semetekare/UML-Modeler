// 7.8.6.6 — `Element::not_own_self`: `not allOwnedElements()->includes(self)`.
//
// ЗАЧЕМ ПРАВИЛО, ЕСЛИ ЦИКЛ И ТАК ЗАПРЕЩЁН. Живую правку не пропускает
// редактор: `setOwner` (`model/model.js`) отказывает, если новый владелец —
// сам элемент или его потомок. Файл при открытии чинит загрузчик: `validateRefs`
// (`io/umljson.js`) снимает `ownerId` у каждого звена цикла и пишет об этом
// строку в `repairs`. То есть в модели, которую человек только что сохранил или
// только что открыл, цикла по `ownerId` быть не может.
//
// Правило нужно для ДРУГОГО входа в модель: модель, собранная в памяти (импорт,
// восстановление, будущие команды) и ещё не прошедшая загрузчик, правил
// загрузчика не видела. Проверять такую модель и есть задача правила — оно
// смотрит на то, что лежит в модели СЕЙЧАС, а не на то, что успел починить
// загрузчик. Поэтому в фикстуре и демо цикл приходит не через `ownerId`.
//
// ВЛАДЕНИЕ В СХЕМЕ ДВОЙНОЕ, и оба вида — настоящее `ownedElement` UML:
//   * `ownerId` — вложенность элементов (пакет в пакете, класс в классе);
//   * членство в регионе — `Region::subvertex`/`Region::node` входят в
//     `Namespace::ownedMember` региона, а регион принадлежит своему элементу
//     (`State::region`, `Activity::node`). Значит, элемент, перечисленный в
//     регионе состояния, этим состоянием и ВЛАДЕЕТ — ровно как требует
//     `allOwnedElements()`.
// Регионы в `uml-model/3` есть (`regions[].nodes` / `regions[].states`), а
// загрузчик снимает только ПРЯМУЮ ссылку региона на себя (`x !== e.id`), но не
// цикл из двух и более элементов. Инспектор позволяет положить в регион любой
// элемент модели (`panels.js`, раздел «Регионы»), так что цикл «A в регионе B,
// B в регионе A» — не выдумка, а состояние, которое редактор даёт собрать.
//
// Цена такого толкования: элемент, лежащий в регионе своего же предка по
// `ownerId`, цикла не образует — это нормальная вложенность, и обход её не
// замечает. Цикл — только возврат в тот же элемент.
//
// Путь цикла общий с обобщением и включениями (`cycle-path.js`): человеку нужен
// не симптом «элемент входит в собственные предки», а цепочка «A → B → A».

import { elementById } from './meta.js';
import { report } from './finding.js';
import { cyclePath } from './cycle-path.js';

/** Имя элемента для текста замечания; безымянный называется своим id. */
const nameOf = (model, id) => elementById(model, id)?.name || String(id);

/**
 * Родители каждого элемента по владению: `ownerId` плюс членство в регионе.
 *
 * Возвращает `Map<id, string[]>`; у элемента без владельца записи нет. Один и
 * тот же родитель не повторяется: элемент может быть назван и в `nodes`, и в
 * `states` одного региона — это одно владение, а не два.
 */
function parentsOf(model) {
  const parents = new Map();
  const add = (child, parent) => {
    if (child == null || parent == null) return;
    const key = String(child);
    const up = String(parent);
    const list = parents.get(key);
    if (!list) parents.set(key, [up]);
    else if (!list.includes(up)) list.push(up);
  };
  for (const el of model.elements ?? []) {
    if (el.ownerId) add(el.id, el.ownerId);
    for (const region of Array.isArray(el.regions) ? el.regions : []) {
      for (const field of ['nodes', 'states']) {
        for (const member of Array.isArray(region?.[field]) ? region[field] : []) add(member, el.id);
      }
    }
  }
  return parents;
}

/**
 * 7.8.6.6 — `not allOwnedElements()->includes(self)`.
 *
 * Замечание несёт весь путь, как у цикла обобщения: «A → B → A» показывает, что
 * именно снимать. Замечаний по одному на каждый элемент цикла — так панель
 * ведёт к первому звену, а в `detail` видна вся цепочка.
 *
 * Элементы без владельцев пропускаются сразу: у них нет родителей, и путь
 * замыкаться не на что.
 */
export function elementOwnSelf(model, rule) {
  const parents = parentsOf(model);
  const out = [];
  for (const el of model.elements ?? []) {
    const id = String(el.id);
    if (!parents.has(id)) continue;
    const path = cyclePath(id, (node) => parents.get(String(node)) ?? []);
    if (!path) continue;
    const names = path.map((node) => `«${nameOf(model, node)}»`);
    out.push(report(rule, path, `Цикл владения: ${[...names, names[0]].join(' → ')}`));
  }
  return out;
}
