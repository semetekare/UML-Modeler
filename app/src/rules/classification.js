// Обобщение: 9.9.4.8 (`specialize_type`, `no_cycles_in_generalization`) и
// 12.4.9.6 (`Stereotype::generalize`).
//
// Обобщение в модели направлено от частного к общему: `from` — specific,
// `to` — general (так же, как в корпусе и в `sample.js`).

import { elementById, metaclassesOf } from './meta.js';
import { report } from './finding.js';
import { cyclePath } from './cycle-path.js';

const generalizations = (model) => (model.relationships ?? []).filter((r) => r.kind === 'generalization');
const parentsOf = (model, id) => generalizations(model).filter((r) => r.from === id).map((r) => r.to);

/** Имя элемента для текста замечания; безымянный называется своим id. */
const nameOf = (model, id) => elementById(model, id)?.name || String(id);

/** Транзитивное замыкание предков (OCL: `allParents()`). */
export function allParents(model, id) {
  const seen = new Set();
  const walk = (from) => {
    for (const p of parentsOf(model, from)) {
      if (seen.has(p)) continue;
      seen.add(p);
      walk(p);
    }
  };
  walk(id);
  return seen;
}

/**
 * 9.9.4.8 — `specialize_type`: `parents()->forAll(c | self.maySpecializeType(c))`,
 * тело `maySpecializeType`: `self.oclIsKindOf(c.oclType())` — частный вид
 * должен быть видом метакласса общего. Виды вне таблицы метаклассов
 * пропускаются (см. `meta.js`).
 */
export function generalizationCompatibleKinds(model, rule) {
  const out = [];
  for (const rel of generalizations(model)) {
    const specific = elementById(model, rel.from);
    const general = elementById(model, rel.to);
    if (!specific || !general) continue;
    const specificKinds = metaclassesOf(specific.kind);
    const generalKinds = metaclassesOf(general.kind);
    if (!specificKinds || !generalKinds) continue;
    if (specificKinds.includes(generalKinds[0])) continue;
    out.push(report(rule, [rel.id],
      `«${specific.name}» (${specific.kind}) обобщает «${general.name}» (${general.kind}): `
      + `${generalKinds[0]} не является видом ${specificKinds[0]}`));
  }
  return out;
}

/**
 * 9.9.4.8 — `no_cycles_in_generalization`: `not allParents()->includes(self)`.
 *
 * Замечание несёт весь путь цикла, а не один элемент: «A входит в собственные
 * предки» называет симптом, а «A → B → C → A» — то, что человеку нужно
 * исправить. Замечаний по-прежнему по одному на каждый элемент цикла, но у
 * каждого путь повёрнут так, чтобы начинаться с этого элемента: панель ведёт к
 * первому id, а в `detail` видна вся цепочка.
 */
export function generalizationCycle(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (!parentsOf(model, el.id).length) continue;
    if (!allParents(model, el.id).has(el.id)) continue;
    const path = cyclePath(el.id, (id) => parentsOf(model, id));
    if (!path) {
      // Путь не собрался — этого не должно случаться: сам факт «элемент в
      // своих предках» уже доказан. Но выдумывать цепочку нельзя, поэтому
      // остаётся прежний текст с одним виноватым.
      out.push(report(rule, [el.id], `«${el.name}» входит в собственные предки`));
      continue;
    }
    const names = path.map((id) => `«${nameOf(model, id)}»`);
    out.push(report(rule, path, `Цикл обобщения: ${[...names, names[0]].join(' → ')}`));
  }
  return out;
}

/**
 * 12.4.9.6 — `Stereotype::generalize`:
 * `allParents()->forAll(oclIsKindOf(Stereotype)) and
 *  Classifier.allInstances()->forAll(c | c.allParents()->exists(oclIsKindOf(Stereotype))
 *  implies c.oclIsKindOf(Stereotype))`.
 * Оба конъюнкта сводятся к одному: у обобщения, где один конец — стереотип,
 * другой обязан быть стереотипом. Стереотип здесь — ВИД элемента
 * (`kind: "stereotype"`, фигура «Стереотип»), а не прикладная метка в поле
 * `stereotype` у обычного элемента.
 */
export function stereotypeGeneralizesStereotype(model, rule) {
  const out = [];
  for (const rel of generalizations(model)) {
    const specific = elementById(model, rel.from);
    const general = elementById(model, rel.to);
    if (!specific || !general) continue;
    const specificIsStereotype = specific.kind === 'stereotype';
    const generalIsStereotype = general.kind === 'stereotype';
    if (specificIsStereotype === generalIsStereotype) continue;
    out.push(report(rule, [rel.id], specificIsStereotype
      ? `стереотип «${specific.name}» обобщает «${general.name}» (${general.kind}), а это не стереотип`
      : `«${specific.name}» (${specific.kind}) обобщает стереотип «${general.name}»`));
  }
  return out;
}
