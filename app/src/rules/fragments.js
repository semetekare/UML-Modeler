// 17.12.3.7 и 17.12.18.7 — два констрейнта CombinedFragment и один Message.
//
// Все три правила работают с одним и тем же полем модели: `operands[]` у
// элемента вида `fragment`. Отдельного `covered` в модели НЕТ и не должно быть —
// покрытие выводится из `from`/`to` сообщений, которые называет операнд
// (`operands[].messages`). Это важно: одно и то же сообщение может лежать в
// операнде внешнего фрагмента, и второй источник истины разошёлся бы с ним
// при первом же переносе сообщения.
//
// Граница, без которой правило срабатывало бы на каждом новом фрагменте:
// фрагмент без операндов (только что нарисованный `opt`) — не нарушение.
// Операнды ещё не заведены, и `operand->size() = 1` проверять не на чем.
// По той же причине `break` молчит, пока у фрагмента нет ни одного сообщения:
// его покрытие ещё не выведено, и сравнивать не с чем. Обе договорённости
// записаны в `hint` правил, а не спрятаны в коде.

import { isMessage } from '../model/model.js';
import { elementById } from './meta.js';
import { report } from './finding.js';

/** Операторы, у которых по стандарту ровно один операнд. */
const SINGLE_OPERAND = new Set(['opt', 'loop', 'break', 'assert', 'neg']);

const operandsOf = (el) => (Array.isArray(el?.operands) ? el.operands : []);

/** «фрагмент loop «Проверка»» — имя есть не у каждого фрагмента. */
function titleOf(el) {
  const op = String(el?.operator ?? '').trim();
  const name = String(el?.name ?? '').trim();
  return name ? `фрагмент ${op} «${name}»` : `фрагмент ${op || 'без оператора'}`;
}

/**
 * Покрытие фрагмента: объединение `from` и `to` всех сообщений его операндов.
 *
 * Считаются только связи вида «сообщение»: операнд хранит id сообщений, но
 * битый файл мог назвать что угодно, а концы ассоциации — не линии жизни.
 * Свободный конец найденного/потерянного сообщения (`null`) не добавляется.
 */
function coveredOf(model, fragment) {
  const byId = new Map((model.relationships ?? []).map((r) => [String(r.id), r]));
  const covered = new Set();
  for (const operand of operandsOf(fragment)) {
    for (const id of operand?.messages ?? []) {
      const rel = byId.get(String(id));
      if (!rel || !isMessage(rel)) continue;
      for (const end of [rel.from, rel.to]) {
        if (end != null && end !== '') covered.add(String(end));
      }
    }
  }
  return covered;
}

/**
 * Ближайший объемлющий фрагмент — по цепочке `ownerId`, а не по геометрии:
 * вложенность фрагментов хранится в модели. Цепочка может идти через
 * промежуточные элементы (например, линию жизни), поэтому ищем первый
 * предок вида `fragment`, а не только непосредственного владельца.
 */
function enclosingFragment(model, fragment) {
  const seen = new Set([fragment.id]);
  let cur = fragment.ownerId ? elementById(model, fragment.ownerId) : null;
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'fragment') return cur;
    seen.add(cur.id);
    cur = cur.ownerId ? elementById(model, cur.ownerId) : null;
  }
  return null;
}

/** Одинаковые ли множества линий жизни (порядок не важен). */
const sameSet = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));

/** Имена линий жизни для `detail`; порядок — по id, чтобы прогон был детерминирован. */
function namesOf(model, ids) {
  return [...ids].sort().map((id) => {
    const el = elementById(model, id);
    const name = String(el?.name ?? '').trim();
    return name ? `«${name}»` : `«${el?.kind ?? id}»`;
  }).join(', ');
}

/**
 * 17.12.3.7 `opt_loop_break_neg`: у `opt`, `loop`, `break`, `assert` и `neg`
 * ровно один операнд.
 *
 * Фрагмент без операндов пропускается: это только что нарисованная рамка, а не
 * нарушение. Иначе правило ругалось бы на каждый новый `opt` и `loop`.
 */
export function optLoopBreakNeg(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'fragment') continue;
    if (!SINGLE_OPERAND.has(String(el.operator ?? '').trim())) continue;
    const count = operandsOf(el).length;
    if (count === 0) continue;
    if (count === 1) continue;
    out.push(report(rule, [el.id], `${titleOf(el)}: операндов ${count}, а стандарт требует ровно один`));
  }
  return out;
}

/**
 * 17.12.3.7 `break`: фрагмент `break` покрывает те же линии жизни, что и
 * объемлющий фрагмент.
 *
 * Покрытие обеих сторон выводится из сообщений операндов. Если у `break` или у
 * объемлющего фрагмента ещё нет сообщений, покрытие неизвестно — правило
 * молчит, а не считает пустое множество «не тем». Верхний уровень без
 * объемлющего фрагмента тоже не проверяется: сравнивать не с чем.
 */
export function breakCoversEnclosing(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'fragment' || String(el.operator ?? '').trim() !== 'break') continue;
    const outer = enclosingFragment(model, el);
    if (!outer) continue;
    const own = coveredOf(model, el);
    const enclosing = coveredOf(model, outer);
    if (!own.size || !enclosing.size) continue;
    if (sameSet(own, enclosing)) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)} покрывает ${namesOf(model, own)}, а объемлющий ${titleOf(outer)} — `
      + `${namesOf(model, enclosing)}: break должен покрывать те же линии жизни`));
  }
  return out;
}

/**
 * 17.12.18.7 — `cannot_cross_boundaries`, СЛАБАЯ ФОРМА: одно сообщение не
 * должно стоять в операндах двух НЕ СВЯЗАННЫХ вложенностью фрагментов.
 *
 * ЧТО ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ И ПОЧЕМУ. Буква OCL говорит: `sendEnclosingFrag =
 * receiveEnclosingFrag`, то есть оба конца сообщения заключены в одном и том же
 * фрагменте. Сильная форма требует знать, какие линии жизни покрывает фрагмент.
 * Покрытие в этой схеме ВЫВОДИТСЯ из сообщений операнда (`coveredOf`), и тогда
 * проверка сообщения, которое само лежит в этом операнде, стала бы тавтологией:
 * «сообщение принадлежит фрагменту, потому что его линия жизни покрыта
 * фрагментом, а покрыта она потому, что сообщение принадлежит фрагменту».
 * Чтобы проверить сильную форму по-настоящему, нужно отдельное поле покрытия у
 * фрагмента — это конструкция модели, отдельная итерация (`TO-IMPLEMENT.md`,
 * пачка 7). Поэтому здесь честная слабая форма, и она ловит настоящий дефект:
 * сообщение продублировано в операндах двух фрагментов, между которыми нет
 * вложенности, то есть нарисовано в двух местах и пересекает границу между ними.
 *
 * ВЛОЖЕННОСТЬ — НЕ ПЕРЕСЕЧЕНИЕ. Сообщение вложенного фрагмента перечисляется и
 * в операнде объемлющего: так выводится покрытие объемлющего фрагмента (на этом
 * стоит правило `break`, см. `coveredOf`). Поэтому пара «внутренний фрагмент и
 * его предок» нарушением не считается — иначе правило ругалось бы на каждое
 * законное вложение, то есть на 26 фрагментов корпуса из 27.
 *
 * Сообщение вне операндов (верхний уровень взаимодействия) — норма: у него нет
 * фрагмента, и пересекать нечего. Два операнда ОДНОГО фрагмента — тоже норма:
 * фрагмент у сообщения один.
 */
export function messageCrossesFragment(model, rule) {
  // Сообщение → множество фрагментов, в чьих операндах оно названо.
  const holders = new Map();
  for (const el of model.elements ?? []) {
    if (el.kind !== 'fragment') continue;
    for (const operand of operandsOf(el)) {
      for (const id of operand?.messages ?? []) {
        const key = String(id);
        if (!holders.has(key)) holders.set(key, new Set());
        holders.get(key).add(String(el.id));
      }
    }
  }

  /** `outer` — предок `inner` по цепочке `ownerId` (вложенность фрагментов). */
  const isAncestor = (outer, inner) => {
    const seen = new Set([inner]);
    let cur = elementById(model, inner);
    while (cur?.ownerId && !seen.has(String(cur.ownerId))) {
      if (String(cur.ownerId) === outer) return true;
      seen.add(String(cur.ownerId));
      cur = elementById(model, cur.ownerId);
    }
    return false;
  };

  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!isMessage(rel)) continue;
    const owners = holders.get(String(rel.id));
    if (!owners || owners.size < 2) continue;
    // Оставляем только те фрагменты, которые не являются предками другого:
    // цепочка вложенности — это одна граница, а не две.
    const ids = [...owners];
    const leaves = ids.filter((id) => !ids.some((other) => other !== id && isAncestor(id, other)));
    if (leaves.length < 2) continue;
    const names = leaves.sort()
      .map((id) => titleOf(elementById(model, id) ?? { id, operator: '' }))
      .join(' и ');
    out.push(report(rule, [rel.id, ...leaves.sort()],
      `сообщение «${rel.name || rel.id}» названо в операндах фрагментов без общей вложенности: ${names} — `
      + 'сообщение не может пересекать границу фрагмента'));
  }
  return out;
}
