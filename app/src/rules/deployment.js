// 19.5.5.6 — два констрейнта DeploymentSpecification.
//
// Спецификация развёртывания описывает конфигурацию: что именно развёрнуто на
// цели и в какой среде. Оба правила читают одно и то же поле — связи вида
// `deployment`, где начало (`from`) — разворачиваемое, а конец (`to`) — цель
// (`TO-IMPLEMENT.md`, пачка 6).
//
// ОБЩАЯ ГРАНИЦА. Спецификация без единой связи `deployment` молчит: разворачивать
// ещё некуда, и проверять нечего. Это не «только что нарисовано» в смысле
// `CombinedFragment` (там молчание — договорённость против ложных срабатываний),
// а буква OCL: `deployment->forAll(...)` на пустом множестве истинно.
//
// Второе правило говорит о ЦЕЛИ, а не о спецификации: `location.deployedElement`
// — это всё, что развёрнуто на ту же цель. Сама спецификация в это множество не
// входит по смыслу констрейнта (иначе `deploymentSpec` нарушал бы его всегда,
// потому что он не компонент), и другие спецификации тоже: они описывают
// конфигурацию, а не являются развёрнутыми компонентами. Это записано в `hint`.

import { elementById } from './meta.js';
import { titleOf } from './graph.js';
import { report } from './finding.js';

/** Все связи развёртывания модели: начало — разворачиваемое, конец — цель. */
const deploymentsOf = (model) => (model.relationships ?? []).filter((rel) => rel.kind === 'deployment');

/**
 * 19.5.5.6 — `deployment_target`: `deployment->forAll(location.oclIsKindOf(
 * ExecutionEnvironment))`.
 *
 * Спецификация развёртывания разворачивается в среду выполнения, а не в голый
 * узел: она описывает конфигурацию среды, и без среды описывать нечего.
 * Замечание — на спецификацию; в `targets` дальше идут сами связи, чтобы клик
 * по замечанию вёл к линии, а не только к рамке.
 */
export function deploySpecTargetEnvironment(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'deploymentSpec') continue;
    const own = deploymentsOf(model).filter((rel) => String(rel.from) === String(el.id));
    if (!own.length) continue;
    const bad = [];
    for (const rel of own) {
      const target = elementById(model, rel.to);
      if (!target) continue;
      if (target.kind === 'executionEnvironment') continue;
      bad.push({ rel, target });
    }
    if (!bad.length) continue;
    out.push(report(rule, [el.id, ...bad.map(({ rel }) => rel.id)],
      `${titleOf(el)}: развёрнута на ${bad.map(({ target }) => `${titleOf(target)} (${target.kind})`).join(', ')}, `
      + 'а стандарт требует среду выполнения'));
  }
  return out;
}

/**
 * 19.5.5.6 — `deployed_elements`:
 * `deployment->forAll(location.deployedElement->forAll(oclIsKindOf(Component)))`.
 *
 * На цели, где стоит спецификация, развёрнуты компоненты — то есть
 * сконфигурированные части системы, а не что попало. Правило уровня
 * `warning`: это приближение. Мы не знаем, какие именно элементы «участвуют в
 * развёртывании, с которым связана спецификация», и берём всё, что развёрнуто
 * на ту же цель, кроме самих спецификаций (см. шапку модуля).
 */
export function deploySpecDeployedComponents(model, rule) {
  const all = deploymentsOf(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'deploymentSpec') continue;
    const own = all.filter((rel) => String(rel.from) === String(el.id));
    if (!own.length) continue;
    const targets = new Set(own.map((rel) => String(rel.to)));
    const strangers = [];
    const seen = new Set();
    for (const rel of all) {
      if (String(rel.from) === String(el.id)) continue;
      if (!targets.has(String(rel.to))) continue;
      const deployed = elementById(model, rel.from);
      if (!deployed || deployed.kind === 'deploymentSpec') continue;
      if (deployed.kind === 'component') continue;
      if (seen.has(String(deployed.id))) continue;
      seen.add(String(deployed.id));
      strangers.push(deployed);
    }
    if (!strangers.length) continue;
    out.push(report(rule, [el.id, ...strangers.map((e) => e.id)],
      `${titleOf(el)}: на её цели развёрнуты ${strangers.map((e) => `${titleOf(e)} (${e.kind})`).join(', ')}, `
      + 'а рядом со спецификацией развёртывания разворачивают компоненты'));
  }
  return out;
}
