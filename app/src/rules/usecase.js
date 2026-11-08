// 18.2.5.6 — `cannot_include_self`: `not allIncludedUseCases()->includes(self)`.
//
// Включение — связь `include` от включающего (`from`) к включаемому (`to`).

import { elementById } from './meta.js';
import { report } from './finding.js';
import { cyclePath } from './cycle-path.js';

/** Имя варианта использования для текста замечания; безымянный — своим id. */
const nameOf = (model, id) => elementById(model, id)?.name || String(id);

export function usecaseIncludeCycle(model, rule) {
  const includes = (model.relationships ?? []).filter((r) => r.kind === 'include');
  const includedOf = (id) => includes.filter((r) => r.from === id).map((r) => r.to);
  const allIncluded = (id) => {
    const seen = new Set();
    const walk = (from) => {
      for (const next of includedOf(from)) {
        if (seen.has(next)) continue;
        seen.add(next);
        walk(next);
      }
    };
    walk(id);
    return seen;
  };
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'usecase') continue;
    if (!includedOf(el.id).length) continue;
    if (!allIncluded(el.id).has(el.id)) continue;
    // Замечание несёт весь путь включений: «A → B → C → A» вместо одного
    // «A включает сам себя». Одно замечание на каждый вариант использования в
    // цикле, путь у каждого начинается с него — как у цикла обобщения.
    const path = cyclePath(el.id, includedOf);
    if (!path) {
      out.push(report(rule, [el.id], `«${el.name}» прямо или косвенно включает сам себя`));
      continue;
    }
    const names = path.map((id) => `«${nameOf(model, id)}»`);
    out.push(report(rule, path, `Цикл включений: ${[...names, names[0]].join(' → ')}`));
  }
  return out;
}
