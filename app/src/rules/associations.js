// Ассоциации: 11.8.1.8 (`binary_associations` — половина, которую схема
// выражает), 18.2.1.4 (`Actor::associations`) и 18.2.5.6
// (`no_association_to_use_case`).
//
// `Association::specialized_end_types` здесь СОЗНАТЕЛЬНО нет: констрейнт говорит
// об обобщении между двумя ассоциациями, а `from`/`to` обобщения обязаны
// указывать на элементы модели. Обобщение, у которого конец — id связи,
// загрузчик выбрасывает с починкой «её элемент не найден» (проверено), так что
// нарушить правило в этой схеме нечем. Оно записано невыразимым в
// `coverage.js` — с названным полем, а не спрятано.

import { aggregationOf } from '../model/model.js';
import { elementById, metaclassesOf } from './meta.js';
import { report } from './finding.js';

const ASSOCIATION_KINDS = new Set(['association', 'aggregation', 'composition']);

/**
 * 11.8.1.8 — `binary_associations`:
 * `memberEnd->exists(aggregation <> none) implies (memberEnd->size() = 2 and
 *  memberEnd->exists(aggregation = none))`.
 *
 * В `uml-model/3` у связи ровно два конца (`from` и `to`), поэтому первая
 * половина посылки недостижима — небинарную ассоциацию схема не выражает.
 * Проверяется вторая половина: если агрегация стоит на обоих концах, конца
 * с `aggregation = none` нет.
 */
export function associationAggregationBinaryOnly(model, rule) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
    const ends = ['from', 'to'].map((end) => ({ end, aggregation: aggregationOf(rel, end) }));
    if (!ends.some((e) => e.aggregation !== 'none')) continue;
    if (ends.length !== 2 || !ends.some((e) => e.aggregation === 'none')) {
      out.push(report(rule, [rel.id],
        `агрегация на обоих концах: ${ends.map((e) => `${e.end}=${e.aggregation}`).join(', ')}`));
    }
  }
  return out;
}

/**
 * 18.2.1.4 — `Actor::associations`: «An Actor can only have Associations to
 * UseCases, Components, and Classes. Furthermore these Associations must be
 * binary.» OCL: `actorEnd.opposite.class.oclIsKindOf(UseCase) or
 * (oclIsKindOf(Class) and not oclIsKindOf(Behavior))`.
 *
 * Компонент — вид класса (Component → Class), поэтому OCL и проза сходятся.
 * Бинарность в схеме всегда выполнена. Виды без метакласса (пакет,
 * состояние…) пропускаются: их типизация — предмет отдельной проверки.
 */
export function actorAssociationTargets(model, rule) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
    // Виновата СВЯЗЬ, а не конец: у актёр↔актёр оба конца нарушают условие, и
    // цикл по концам давал на одну линию две строки панели. Поэтому собираем
    // нарушения связи и выдаём одно замечание, называя оба конца.
    const bad = [];
    for (const [actorEnd, otherEnd] of [['from', 'to'], ['to', 'from']]) {
      const actor = elementById(model, rel[actorEnd]);
      const other = elementById(model, rel[otherEnd]);
      if (!actor || !other || actor.kind !== 'actor') continue;
      const kinds = metaclassesOf(other.kind);
      if (!kinds) continue;
      const allowed = kinds.includes('UseCase')
        || (kinds.includes('Class') && !kinds.includes('Behavior'));
      if (allowed) continue;
      bad.push(`актёр «${actor.name}» связан ассоциацией с «${other.name}» (${other.kind})`);
    }
    if (!bad.length) continue;
    out.push(report(rule, [rel.id], bad.join('; ')));
  }
  return out;
}

/**
 * 18.2.5.6 — `no_association_to_use_case`:
 * `usecases->size() > 1 implies usecases->collect(subject)->size() > 1`.
 *
 * Толкование: поля `subject` в `uml-model/3` нет (это `Classifier::useCase`,
 * обратная сторона `UseCase::subject`), поэтому `collect(subject)` пуст и
 * `size()` даёт 0. Значит любая ассоциация между двумя вариантами
 * использования — нарушение: субъект у них один и тот же (не задан ни у кого).
 * Когда в схеме появится `subject`, здесь появится и исключение для пары с
 * разными субъектами; сейчас исключать нечего.
 */
export function usecaseNoAssociationToUsecase(model, rule) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
    const usecases = ['from', 'to']
      .map((end) => elementById(model, rel[end]))
      .filter((el) => el && el.kind === 'usecase');
    if (usecases.length <= 1) continue;
    out.push(report(rule, [rel.id],
      `ассоциация между вариантами использования ${usecases.map((u) => `«${u.name}»`).join(' и ')}: субъект один (не задан)`));
  }
  return out;
}
