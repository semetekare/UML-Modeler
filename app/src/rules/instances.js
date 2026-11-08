// 9.9.9.6 — три констрейнта InstanceSpecification: слоты и развёртывание.
//
// Объектная диаграмма говорит о конкретном экземпляре, и слот — это его
// характеристика: имя строки слота и есть `definingFeature` (`TO-IMPLEMENT.md`,
// пачка 4). Отдельного поля у слота нет, поэтому «характеристика слота» —
// это `slots[].name`, а характеристики классификатора — его `attributes[].name`
// вместе с унаследованными (обобщение в модели есть) и ролями ассоциаций:
// по §9.9.9.6 `allSlottableFeatures` включает концы-члены ассоциаций, а в
// `uml-model/3` конец ассоциации хранится ролью `fromRole`/`toRole`.
//
// ОБЩАЯ ГРАНИЦА ДВУХ ПРАВИЛ О СЛОТАХ. Объект без `classifierId` молчит. В
// корпусе таких восемь из восьми — объект назван «заказ1: Заказ», а ссылки на
// класс нет, и судить его слоты не с чем: по букве OCL `classifier->forAll(...)`
// на пустом множестве классификаторов выполняется всегда. Это та же граница,
// что `hasAnyView` в правилах о диаграммах, и она записана в `hint`, а не
// спрятана в коде. По той же причине молчит объект, чей `classifierId` ведёт не
// на классификатор (пакет, заметка): это другой дефект, и называть его чужими
// словами о слотах нельзя.

import { metaclassesOf, elementById } from './meta.js';
import { titleOf } from './graph.js';
import { report } from './finding.js';

const ASSOCIATION_KINDS = new Set(['association', 'aggregation', 'composition']);

/** Имена слотов объекта; слот без имени ничего не называет и не судится. */
function slotNames(el) {
  const rows = Array.isArray(el?.slots) ? el.slots : [];
  return rows.map((s) => String(s?.name ?? '').trim()).filter(Boolean);
}

/**
 * Классификатор и все его предки по обобщению: `allSlottableFeatures` включает
 * унаследованные атрибуты, поэтому слот с именем атрибута базового класса —
 * не нарушение. Цепочка защищена от петли: цикл обобщения ловит отдельное
 * правило, а здесь он не имеет права повесить прогон.
 */
function classifierChain(model, classifier) {
  const byId = new Map((model.elements ?? []).map((e) => [String(e.id), e]));
  const seen = new Set([String(classifier.id)]);
  const queue = [String(classifier.id)];
  while (queue.length) {
    const id = queue.pop();
    for (const rel of model.relationships ?? []) {
      if (rel.kind !== 'generalization' || String(rel.from) !== id) continue;
      const parent = byId.get(String(rel.to));
      if (!parent || seen.has(String(parent.id))) continue;
      seen.add(String(parent.id));
      queue.push(String(parent.id));
    }
  }
  return [...seen].map((id) => byId.get(id)).filter(Boolean);
}

/** Характеристики, которые классификатор позволяет заполнить слотом. */
function slottableNames(model, classifier) {
  const names = new Set();
  const chain = classifierChain(model, classifier);
  for (const el of chain) {
    for (const m of el.attributes ?? []) {
      const name = String(m?.name ?? '').trim();
      if (name) names.add(name);
    }
  }
  const ids = new Set(chain.map((el) => String(el.id)));
  for (const rel of model.relationships ?? []) {
    if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
    if (!ids.has(String(rel.from)) && !ids.has(String(rel.to))) continue;
    for (const role of [rel.fromRole, rel.toRole]) {
      const name = String(role ?? '').trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Классификатор объекта, если он есть и это действительно классификатор. */
function classifierOf(model, el) {
  if (!el.classifierId) return null;
  const classifier = elementById(model, el.classifierId);
  if (!classifier || !metaclassesOf(classifier.kind)) return null;
  return classifier;
}

const quote = (names) => names.map((n) => `«${n}»`).join(', ');

/**
 * 9.9.9.6 — `structural_feature`: не больше одного слота на характеристику.
 *
 * По букве OCL проверка идёт по характеристикам классификатора
 * (`classifier->forAll(c | ...)`), поэтому без классификатора она выполняется
 * пусто — см. шапку модуля. Сравниваются имена слотов: `definingFeature` слота
 * в этой схеме — его имя.
 */
export function instanceSlotUniqueFeature(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'object') continue;
    const classifier = classifierOf(model, el);
    if (!classifier) continue;
    const counts = new Map();
    for (const name of slotNames(el)) counts.set(name, (counts.get(name) ?? 0) + 1);
    const doubled = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
    if (!doubled.length) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: характеристика ${quote(doubled)} заполнена больше одного раза, `
      + 'а у характеристики бывает ровно один слот'));
  }
  return out;
}

/**
 * 9.9.9.6 — `defining_feature`: каждый слот называет характеристику своего
 * классификатора.
 *
 * Характеристики — атрибуты классификатора и его предков плюс роли ассоциаций
 * (см. шапку модуля). Объект без `classifierId` молчит: в корпусе таких много,
 * и правило, сработавшее на каждом из них, было бы неверным правилом.
 */
export function instanceSlotDefiningFeature(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'object') continue;
    const classifier = classifierOf(model, el);
    if (!classifier) continue;
    const allowed = slottableNames(model, classifier);
    const unknown = slotNames(el).filter((name) => !allowed.has(name));
    if (!unknown.length) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: слоты ${quote(unknown)} называют характеристики, которых нет `
      + `у классификатора ${titleOf(classifier)}`));
  }
  return out;
}

/**
 * 9.9.9.6 — `deployment_artifact`: экземпляр, который разворачивают, должен
 * представлять артефакт.
 *
 * `deploymentForArtifact` — это связи `deployment`, где экземпляр стоит началом
 * (начало — разворачиваемое, конец — цель). Экземпляр без единой такой связи
 * молчит: правило говорит только о развёрнутых. А вот отсутствие
 * `classifierId` у развёрнутого экземпляра — нарушение, а не повод молчать:
 * `classifier->exists(oclIsKindOf(Artifact))` на пустом множестве ложно.
 */
export function instanceDeploymentArtifact(model, rule) {
  const deployed = new Set();
  for (const rel of model.relationships ?? []) {
    if (rel.kind !== 'deployment' || rel.from == null || rel.from === '') continue;
    deployed.add(String(rel.from));
  }
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'object') continue;
    if (!deployed.has(String(el.id))) continue;
    const classifier = el.classifierId ? elementById(model, el.classifierId) : null;
    const chain = classifier ? metaclassesOf(classifier.kind) : null;
    if (chain && chain.includes('Artifact')) continue;
    const what = classifier
      ? `${titleOf(classifier)} (${classifier.kind})`
      : 'классификатора нет';
    out.push(report(rule, [el.id],
      `${titleOf(el)} развёрнут как артефакт, но ${what}: `
      + 'разворачиваемый экземпляр представляет экземпляр артефакта'));
  }
  return out;
}
