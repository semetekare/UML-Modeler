// 10.5.5.5 — `Interface::visibility`: `feature->forAll(visibility = public)`.
//
// Члены интерфейса — его полки `attributes` и `operations`; отсутствие `vis`
// в строке члена означает public (так его читает `readMembers`).

import { report } from './finding.js';

export function interfaceFeatureVisibilityPublic(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'interface') continue;
    for (const field of ['attributes', 'operations']) {
      for (const row of (Array.isArray(el[field]) ? el[field] : [])) {
        const vis = row?.vis ?? 'public';
        if (vis === 'public') continue;
        out.push(report(rule, [el.id], `«${el.name}», член «${row?.name ?? ''}»: видимость ${vis}`));
      }
    }
  }
  return out;
}
