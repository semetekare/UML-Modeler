// 15.7.22.6 — `no_executable_nodes`: `not (source.oclIsKindOf(ExecutableNode) or
// target.oclIsKindOf(ExecutableNode))`.
//
// Поток объектов переносит значения между УЗЛАМИ ОБЪЕКТОВ (ObjectNode,
// ActivityParameterNode, а в нашей нотации ещё и `object` — экземпляр класса).
// Исполняемый узел (ExecutableNode) — это действие: оно само выполняется и
// владеет своими выводами (pins), а не является концом потока. В нотации
// редактора выводов нет, поэтому концом потока объектов может быть только узел
// объекта; поток между двумя действиями — нарушение по букве констрейнта.
//
// Исполняемый узел в нотации один — `action` (UML Action, §16). Деятельность
// (`activity`) — поведение, а не исполняемый узел: у неё нет маркера
// управления, и концом ребра деятельности она не бывает. `objectNode`,
// `activityParameter` и `object` — как раз законные концы потока объектов.
//
// Границы «только что нарисовано» здесь нет и не нужно: поток объектов всегда
// нарисован между двумя концами, и оба конца уже есть в модели. Правило молчит
// только тогда, когда конца нет вовсе (битая связь) — но это забота загрузчика,
// а не узла.

import { elementById } from './meta.js';
import { report } from './finding.js';
import { titleOf } from './graph.js';

/** Виды нотации, которые UML считает исполняемыми узлами (ExecutableNode). */
const EXECUTABLE = new Set(['action']);

/**
 * 15.7.22.6 — поток объектов не может начинаться или заканчиваться
 * исполняемым узлом.
 *
 * Одно замечание на поток: виновата связь, а не каждый её конец. В `detail`
 * названы оба виноватых конца, если они оба исполняемые.
 */
export function objectFlowNoExecutableNodes(model, rule) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (rel.kind !== 'objectFlow') continue;
    const ends = [['from', 'начинается'], ['to', 'заканчивается']]
      .map(([end, verb]) => ({ verb, el: elementById(model, rel[end]) }))
      .filter(({ el }) => el && EXECUTABLE.has(el.kind));
    if (!ends.length) continue;
    const detail = ends
      .map(({ verb, el }) => `${verb} в исполняемом узле — ${titleOf(el)}`)
      .join(', а также ');
    out.push(report(rule, [rel.id],
      `поток объектов «${rel.name || rel.id}» ${detail}: `
      + 'стандарт запрещает исполняемым узлам быть концами потока объектов'));
  }
  return out;
}
