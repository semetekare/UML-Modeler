// Два совета практики о диаграмме последовательности: чей экземпляр рисует
// линия жизни и какую операцию называет сигнатура сообщения.
//
// Почему это слой практики, а не констрейнты стандарта. `Lifeline::same_classifier`
// (17.12.17.5) сравнивает классификатор линии жизни с `interaction.context`, а
// поля `context` у взаимодействия в `uml-model/3` нет вовсе: лист взаимодействия
// не знает, чей экземпляр он описывает. `Message::signature_refer_to`
// (17.12.18.7) требует `Operation`/`Signal` как ЭЛЕМЕНТЫ модели со своими id, а
// операция у нас — строка члена `operations[].name` без id. Записать эти
// констрейнты правилами стандарта значило бы соврать о происхождении, и движок
// такую ложь ловит полем `source`. Поэтому здесь два совета с `rationale` и без
// пункта: оба судят ЗАПОЛНЕННУЮ ссылку или текст, а не требуют их наличия.
//
// Общие границы (записаны в `hint` каждого правила, а не спрятаны только тут):
//   * `represents` пуст — молчим: линия жизни без классификатора законна;
//   * цель ссылки не найдена — молчим: её снимает загрузчик (`validateRefs`), и
//     второе замечание об одном и том же было бы шумом;
//   * сигнатуры нет — молчим: подпись у сообщения не обязательна;
//   * у линии жизни получателя нет `represents` — молчим: сверять сигнатуру не
//     с чем (в учебном корпусе таких линий жизни 102 из 102);
//   * у классификатора нет ни одной операции — молчим: пустой список не
//     доказывает, что операции нет, он говорит лишь, что список не заполнили.
//
// Второе правило — междиаграммное: имя сигнатуры на листе последовательности
// сверяется с `operations[].name` класса на диаграмме классов. Модель
// одноисточниковая, поэтому «класс на другом листе» — тот же самый элемент, и
// отдельный обход листов не нужен.

import { metaclassesOf } from './meta.js';
import { refIndex, resolve } from './refs.js';
import { report } from './finding.js';
import { titleOf, kindName } from './practice.js';

/**
 * Виды связей, у которых бывает подпись операции. Список назван явно, а не
 * выведен из `def.sequence` нотации: у `message`/`reply`/`createMessage`/
 * `destroyMessage` сигнатура — подпись вызова, у остальных связей такого поля
 * нет, и судить чужое поле правило не имеет права.
 */
const SIGNATURE_KINDS = new Set(['message', 'reply', 'createMessage', 'destroyMessage']);

/**
 * Имя операции из подписи: первый идентификатор до `(` или `:`.
 *
 * `updateStudent(st: Student)` → `updateStudent`; `ok: boolean` → `ok`;
 * `read()` → `read`. Так же разбирается и `operations[].name` (`read()` →
 * `read`), поэтому сверка идёт по имени, а не по всей строке: параметры и тип
 * возврата в модели могут быть записаны по-разному, а имя операции — одно.
 *
 * Ведущий маркер видимости (`+`, `-`, `#`, `~`) снимается: в подписи его
 * иногда пишут, а в `operations[].name` он хранится отдельным полем `vis`.
 * Пустая строка или строка без идентификатора даёт `''` — правило тогда
 * молчит, а не сравнивает пустое с пустым.
 */
export function operationName(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s.split(/[(:]/, 1)[0].trim().replace(/^[+\-#~]\s*/, '').trim();
}

/**
 * Классификатор, который представляет линия жизни, или `null`.
 *
 * `null` — это «сверять не с чем» в четырёх случаях: конец не линия жизни
 * (сообщение может связывать что угодно), `represents` пуст, цель не найдена,
 * цель не классификатор. Все четыре правило обязано пропустить: первое и
 * третье названы в `hint`, второе снимает загрузчик, а четвёртое уже поймало
 * `lifeline-represents-classifier` — второе замечание об одном и том же было бы
 * шумом.
 */
function representedClassifier(model, id, ix) {
  const el = resolve(model, id, ix);
  if (!el || (el.kind !== 'lifeline' && el.kind !== 'actorLifeline')) return null;
  if (!el.represents) return null;
  const target = resolve(model, el.represents, ix);
  if (!target || !metaclassesOf(target.kind)) return null;
  return target;
}

/**
 * `lifeline-represents-classifier` — линия жизни «представляет» не
 * классификатор: пакет, заметку, состояние, другую линию жизни.
 *
 * Линия жизни отвечает на вопрос «чей экземпляр участвует в сценарии», поэтому
 * представляет классификатор: класс, интерфейс, компонент, актёра, узел. Пакет
 * и заметка на этот вопрос не отвечают, а линия жизни внутри линии жизни —
 * просто путаница: подпись «: Подсистема заказов» под линией читается как
 * ошибка, а не как участник.
 *
 * Проверка положительная — «цель классификатор», а не «цель не пакет»: иначе
 * следующая новая фигура нотации (шкала времени, рамка) молча стала бы
 * законной линией жизни. Тот же приём, что у `swimlane-represents-kind`.
 */
export function lifelineRepresentsKind(model, rule) {
  const ix = refIndex(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'lifeline' && el.kind !== 'actorLifeline') continue;
    if (!el.represents) continue;                          // пустая ссылка молчит
    const target = resolve(model, el.represents, ix);
    if (!target) continue;                                 // битую снимает загрузчик
    if (metaclassesOf(target.kind)) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)} представляет ${titleOf(target)} — это ${kindName(target)}, `
      + 'а не классификатор'));
  }
  return out;
}

/**
 * `message-signature-operation` — сигнатура сообщения называет операцию,
 * которой нет ни у классификатора получателя, ни у классификатора отправителя.
 *
 * Это приближение к `Message::signature_is_operation_request/reply`: настоящая
 * проверка требует `Operation` как элемент модели, а у нас операция — строка
 * `operations[].name`. Поэтому сверяется ИМЯ (до `(` или `:`), и только когда
 * список операций у классификатора вообще заполнен.
 *
 * Почему проверяются оба конца. У сообщения `to` — получатель, и его операция
 * ищется в первую очередь; но ответ (`reply`) и обратный вызов называют
 * операцию отправителя, поэтому «ни у получателя, ни у отправителя» — честная
 * формулировка, а не запасной вариант. Отправитель без `represents` в сверке
 * просто не участвует.
 *
 * Почему якорем служит получатель. Если у линии жизни `to` нет `represents`,
 * правило молчит целиком: подпись может относиться к операции отправителя, но
 * проверить её там — значит угадывать, а не проверять. Это записано в `hint`.
 */
export function messageSignatureOperation(model, rule) {
  const ix = refIndex(model);
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!SIGNATURE_KINDS.has(rel.kind)) continue;
    const signature = String(rel.signature ?? '').trim();
    if (!signature) continue;                              // пустая сигнатура молчит
    const name = operationName(signature);
    if (!name) continue;

    const receiver = representedClassifier(model, rel.to, ix);
    if (!receiver) continue;                               // получатель не классификатор

    // Классификаторы, у которых список операций заполнен. Пустой список — не
    // доказательство отсутствия операции, поэтому такой классификатор не
    // участвует в приговоре (и не мешает другому концу его вынести).
    const checked = [];
    for (const c of [receiver, representedClassifier(model, rel.from, ix)]) {
      if (!c || !Array.isArray(c.operations) || !c.operations.length) continue;
      if (checked.some((x) => String(x.id) === String(c.id))) continue;
      checked.push(c);
    }
    if (!checked.length) continue;                         // сверять не с чем

    const found = checked.some((c) => c.operations.some((op) => operationName(op?.name) === name));
    if (found) continue;

    const names = checked.map((c) => titleOf(c));
    const where = names.length === 1
      ? `у ${names[0]}`
      : `ни у ${names[0]}, ни у ${names.slice(1).join(', ни у ')}`;
    const label = String(rel.name ?? '').trim();
    out.push(report(rule, [rel.id],
      `сигнатура «${signature}»${label ? ` сообщения «${label}»` : ''} называет операцию `
      + `«${name}», а такой операции нет ${where}`));
  }
  return out;
}
