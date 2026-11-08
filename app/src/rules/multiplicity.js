// Четыре правила кратности — UML 2.5.1, п. 7.8.8.8 (MultiplicityElement).
//
// Границы берутся такими, какими их отдают запросы 7.8.8.7: `lowerBound()` и
// `upperBound()` возвращают значение литерала, а если его нет или оно не того
// вида — 1. Поэтому «1..1.5» нарушает только `upper_is_unlimitedNatural`
// (верхняя граница не UnlimitedNatural), а сравнение границ на нём сходится:
// 1 >= 1. Одна опечатка — одно правило.

import { aggregationOf } from '../model/model.js';
import { report } from './finding.js';

/**
 * Разобрать кратность, записанную строкой (`n`, `a..b`, `*`, `a..*`), в те
 * числа, которые вернули бы `lowerBound()` и `upperBound()`: `lower` —
 * `integerValue` нижней границы, `upper` — `unlimitedValue` верхней
 * (`Infinity` для «*»).
 *
 * Толкование: пустая строка — кратности нет вовсе; строка без единой цифры
 * (и не «*») кратностью не является. Корпус пособия пишет в это поле пометку
 * «не названо в тексте» — это не значение, и правила кратности такую пометку
 * не судят.
 */
export function parseRange(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (s === '*') return { text: s, lower: 0, upper: Infinity, lowerLiteral: true, upperLiteral: true };
  if (!/\d/.test(s)) return null;
  const parts = s.split('..');
  const lowerText = parts[0].trim();
  const upperText = (parts.length === 2 ? parts[1] : parts[0]).trim();
  const lower = parts.length <= 2 && /^-?\d+$/.test(lowerText) ? Number(lowerText) : null;
  const upper = parts.length <= 2
    ? (upperText === '*' ? Infinity : (/^\d+$/.test(upperText) ? Number(upperText) : null))
    : null;
  return {
    text: s,
    lowerLiteral: lower !== null,
    upperLiteral: upper !== null,
    lower: lower ?? 1,
    upper: upper ?? 1,
  };
}

/** Концы связей, у которых вообще есть кратность. */
export function multiplicityEnds(model) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    for (const end of ['from', 'to']) {
      const text = rel[end === 'from' ? 'fromMultiplicity' : 'toMultiplicity'];
      if (text === undefined) continue;
      const range = parseRange(text);
      if (!range) continue;
      out.push({ rel, end, text, range });
    }
  }
  return out;
}

/** Нарушения, общие для четырёх правил кратности: одно правило — один предикат. */
export function multiplicityRule(predicate) {
  return (model, rule) => multiplicityEnds(model)
    .map((end) => ({ ...end, detail: predicate(end) }))
    .filter((end) => end.detail)
    .map((end) => report(rule, [end.rel.id],
      `${end.end === 'from' ? 'конец «from»' : 'конец «to»'}: ${end.detail}`));
}

export const multUpperGeLower = multiplicityRule(({ text, range }) => {
  if (range.upper >= range.lower) return null;
  return `кратность «${text}»: верхняя граница ${range.upper} меньше нижней ${range.lower}`;
});

export const multLowerNonNegative = multiplicityRule(({ text, range }) => {
  if (range.lower >= 0) return null;
  return `кратность «${text}»: нижняя граница ${range.lower} отрицательна`;
});

export const multLowerIsInteger = multiplicityRule(({ text, range }) => {
  if (range.lowerLiteral) return null;
  return `кратность «${text}»: нижняя граница не целочисленный литерал`;
});

export const multUpperIsUnlimitedNatural = multiplicityRule(({ text, range }) => {
  if (range.upperLiteral) return null;
  return `кратность «${text}»: верхняя граница не целое число и не «*»`;
});

/**
 * 9.9.17.8 — `multiplicity_of_composite`: «A multiplicity on the composing end
 * of a composite aggregation must not have an upper bound greater than 1.»
 *
 * Толкование: констрейнт применяется к тому концу, который помечен
 * `isComposite` (ромб), — это конец `from` у вида «Композиция» (и `from`, и
 * `to` берутся через `aggregationOf`, чтобы явное поле и умолчание вида связи
 * читались одинаково).
 *
 * Расхождение в самом стандарте: OCL рядом с этой фразой говорит
 * `opposite.upperBound() <= 1`, то есть про противоположный конец. Буквальное
 * чтение OCL запретило бы обычную композицию «1 ◆—— 0..*», где у части
 * верхняя граница как раз больше 1, — поэтому прозе верим больше, чем OCL, и
 * проверяем конец с ромбом.
 */
export function compositeUpperBoundLe1(model, rule) {
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!['association', 'aggregation', 'composition'].includes(rel.kind)) continue;
    for (const end of ['from', 'to']) {
      if (aggregationOf(rel, end) !== 'composite') continue;
      const text = rel[end === 'from' ? 'fromMultiplicity' : 'toMultiplicity'];
      const range = parseRange(text);
      if (!range || range.upper <= 1) continue;
      out.push(report(rule, [rel.id],
        `конец «${end}» с ромбом композиции имеет кратность «${range.text}»: `
        + `верхняя граница ${range.upper === Infinity ? '∞' : range.upper} > 1`));
    }
  }
  return out;
}
