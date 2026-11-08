// 17.12.11.5 — Interaction::not_contained: `enclosingInteraction->isEmpty()`.
//
// Взаимодействие — самостоятельный лист: рамка `interaction` описывает один
// сценарий и не лежит внутри другого сценария. Ссылка на другое взаимодействие
// (`interactionUse`) — это не вложение, а ссылка: она и названа по-другому, и
// вид у неё другой, поэтому правило её не трогает.
//
// ГРАНИЦА. `ownerId` в `uml-model/3` означает ЛЮБУЮ вложенность: элемент может
// лежать внутри пакета, класса, дорожки. Правило смотрит только на цепочку
// владельцев и срабатывает, лишь когда среди предков есть другое взаимодействие.
// Взаимодействие верхнего уровня (без владельца) и взаимодействие внутри пакета
// молчат — пакет не `enclosingInteraction`.

import { elementById } from './meta.js';
import { titleOf } from './graph.js';
import { report } from './finding.js';

/**
 * 17.12.11.5 — `enclosingInteraction->isEmpty()`.
 *
 * Ближайший предок вида `interaction` и есть `enclosingInteraction`; ищем его по
 * цепочке `ownerId`, а не только у непосредственного владельца: между рамками
 * может стоять линия жизни или пакет. Цикл владения снимает загрузчик
 * (`validateRefs`), но счётчик шагов всё равно ограничен — правило не имеет
 * права повесить прогон на битом файле.
 */
export function interactionNotNested(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'interaction' || !el.ownerId) continue;
    const seen = new Set([String(el.id)]);
    let cur = elementById(model, el.ownerId);
    let outer = null;
    while (cur && !seen.has(String(cur.id))) {
      if (cur.kind === 'interaction') { outer = cur; break; }
      seen.add(String(cur.id));
      cur = cur.ownerId ? elementById(model, cur.ownerId) : null;
    }
    if (!outer) continue;
    out.push(report(rule, [el.id, outer.id],
      `${titleOf(el)} вложено в ${titleOf(outer)}: взаимодействие не может содержаться `
      + 'в другом взаимодействии — ссылайтесь на него через «ссылку на взаимодействие»'));
  }
  return out;
}
