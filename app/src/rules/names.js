// Имена: различимость членов пространства имён (7.8.10.7) и два правила
// «must_have_name» у актёра и варианта использования (18.2.1.4, 18.2.5.6).

import { MEMBER_FIELDS } from '../model/model.js';
import { report } from './finding.js';

/**
 * 7.8.10.7 — `members_distinguishable`.
 *
 * OCL: `member->forAll(memb | member->excluding(memb)->forAll(other |
 * memb.isDistinguishableFrom(other, self)))`, а `isDistinguishableFrom`
 * (7.8.9) различает два члена по метаклассу и имени.
 *
 * Толкование: пространство имён — сам элемент (вложенности элементов в
 * `uml-model/3` нет), а «метакласс» члена — его полка: два атрибута — это два
 * Property, атрибут и операция — Property и Operation, они различимы по
 * метаклассу при любых именах. Поэтому дубли ищутся внутри одной полки.
 * Сигнатура операции хранится в её `name` (`updateStudent(st:Student)`), так
 * что перегрузка «одно имя, разные параметры» даёт разные имена и различима —
 * ровно как требует BehavioralFeature::isDistinguishableFrom.
 */
export function namespaceMembersDistinguishable(model, rule) {
  const kinds = rule.appliesTo?.element ?? [];
  const out = [];
  for (const el of model.elements ?? []) {
    if (!kinds.includes(el.kind)) continue;
    for (const field of MEMBER_FIELDS) {
      const rows = Array.isArray(el[field]) ? el[field] : [];
      const seen = new Set();
      for (const row of rows) {
        const name = String(row?.name ?? '');
        if (seen.has(name)) {
          out.push(report(rule, [el.id], `«${el.name}», полка ${field}: два члена с именем «${name}»`));
        } else seen.add(name);
      }
    }
  }
  return out;
}

/** 18.2.1.4 — `Actor::must_have_name`: `name->notEmpty()`. */
export function actorMustHaveName(model, rule) {
  return (model.elements ?? [])
    .filter((e) => e.kind === 'actor' && !String(e.name ?? '').trim())
    .map((e) => report(rule, [e.id], 'у актёра пустое имя'));
}

/** 18.2.5.6 — `UseCase::must_have_name`: `name -> notEmpty ()`. */
export function usecaseMustHaveName(model, rule) {
  return (model.elements ?? [])
    .filter((e) => e.kind === 'usecase' && !String(e.name ?? '').trim())
    .map((e) => report(rule, [e.id], 'у варианта использования пустое имя'));
}
