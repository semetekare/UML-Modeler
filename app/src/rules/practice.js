// Одиннадцать проверок «практики моделирования» — советы, а не требования стандарта.
// Две проверки о диаграмме последовательности живут рядом, в `sequence.js`:
// у них та же природа (заполненная ссылка/подпись, а не констрейнт), но свой
// предмет, и держать их здесь значило бы смешать ссылки модели с подписями.
//
// Это отдельный слой: у этих проверок нет пункта UML, на который можно
// сослаться, есть только объяснение, почему такую модель трудно читать.
// Поэтому замечания уходят через `report` с `basis: 'practice'` и пустыми
// ссылками на стандарт (см. `finding.js`), а сами правила лежат в
// `notation/rules/practice.json`, не в наборе стандарта.
//
// Границы откалиброваны по корпусу учебных моделей (48 диаграмм): наивное
// «элемент без связей» даёт 137 срабатываний, и почти все ложные — заметки,
// пакеты, дорожки и прочие виды, которые стоят на листе сами по себе по своей
// природе. Отсюда `STANDALONE`. Дубль связи ограничен структурными видами:
// сообщения, потоки управления и переходы повторяются законно (вызов и ответ,
// несколько вызовов подряд), и на полном наборе видов корпус даёт шесть ложных
// срабатываний — все на `message`.

import { NOTATION } from '../model/notation.js';
import { layoutOf } from '../model/geometry.js';
import { stereotypeNameClash } from '../io/stereotypes.js';
import { elementById, metaclassesOf } from './meta.js';
import {
  INTERACTION_DIAGRAMS, refIndex, resolve, diagramById, sheetsOf,
} from './refs.js';
import { report } from './finding.js';

/**
 * Виды, которые стоят сами по себе по своей природе: заметка, пакет, дорожка,
 * фрагмент. Отсутствие связей у них — норма, а не сиротство.
 */
export const STANDALONE = new Set([
  'note', 'text', 'package', 'model', 'profile', 'systemBoundary', 'swimlane',
  'fragment', 'interactionUse', 'activation', 'port', 'activityParameter', 'timingLane',
]);

/**
 * Виды связей, у которых повтор между той же парой — дубль. Сообщения,
 * переходы и потоки сюда не входят: они повторяются законно.
 */
export const STRUCTURAL = new Set([
  'association', 'aggregation', 'composition', 'generalization', 'realization', 'dependency',
]);

/** Как назвать элемент в замечании: имя, а если его нет — вид. */
export const titleOf = (el) => (String(el?.name ?? '').trim()
  ? `«${el.name}» (${el.kind})`
  : `элемент вида «${el.kind}» без имени`);

/** Имя элемента без вида — для фраз, где вид уже назван. */
const nameOf = (el) => (String(el?.name ?? '').trim() ? `«${el.name}»` : 'без имени');

/** «между «A» и «B»»; концы, которых нет в модели, тоже надо назвать честно. */
function endsOf(model, rel) {
  const from = elementById(model, rel.from);
  const to = elementById(model, rel.to);
  return from && to ? `между ${nameOf(from)} и ${nameOf(to)}` : 'между элементами, которых в модели нет';
}

/**
 * Есть ли в модели хоть одна фигура. Файл `uml-model/3` вправе хранить модель
 * без видов — так лежит учебный корпус и так выглядит модель, у которой листы
 * почистили. На таком файле правила о диаграммах молчат: «не показан» пришлось
 * бы сказать про каждый элемент и каждую связь, а это шум, а не находка.
 */
const hasAnyView = (model) => (model.diagrams ?? []).some((d) => (d.shapes ?? []).length > 0);

/** id элементов, участвующих хотя бы в одной связи модели. */
function connectedIds(model) {
  const ids = new Set();
  for (const rel of model.relationships ?? []) {
    ids.add(rel.from);
    ids.add(rel.to);
  }
  return ids;
}

/**
 * Развёртывание — это СВЯЗЬ, а не украшение: компонент (или артефакт),
 * лежащий внутри узла, развёрнут на нём, и «одиноким» он не является даже
 * когда у него нет ни одной проведённой линии. Пособие проговаривает это
 * прямо: «Компоненты следует создавать, размещая их внутри родительского
 * узла: вложенность у нас геометрическая — фигура компонента просто лежит на
 * фигуре узла, и модель об этом не знает» (5.1.6). Поля `nodeNesting` в
 * `uml-model/3` нет, поэтому вложенность читается с ЛИСТА — теми же
 * функциями, что рисуют редактор (`layoutOf`, попадание прямоугольника в
 * прямоугольник), — и дополнительно из модели по `ownerId`.
 *
 * Почему только узлы, а не любой контейнер. Дорожка, пакет и рамка — это
 * ДЕЛЕНИЕ листа, а не отношение: действие в дорожке «Студент» без единого
 * потока всё равно одиноко, а узел решения внутри дорожки без рёбер — дефект
 * (так и лежит в 3402: `s11` внутри дорожки и без единого ребра). Освободить
 * всё, что лежит в контейнере, значило бы ослепить правило ровно на тех
 * диаграммах деятельности, где оно и нужно.
 */
const isDeploymentNode = (kind) => NOTATION.shapes[kind]?.style === 'node';

/** id элементов, развёрнутых на узле: `ownerId` в модели или фигура в фигуре. */
function deployedIds(model) {
  const out = new Set();
  const byId = new Map((model.elements ?? []).map((e) => [e.id, e]));
  for (const el of model.elements ?? []) {
    let cur = el;
    const seen = new Set([el.id]);
    while (cur?.ownerId && !seen.has(cur.ownerId)) {
      seen.add(cur.ownerId);
      const owner = byId.get(cur.ownerId);
      if (!owner) break;
      if (isDeploymentNode(owner.kind)) { out.add(el.id); break; }
      cur = owner;
    }
  }
  const holds = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  for (const d of model.diagrams ?? []) {
    const boxes = (d.shapes ?? []).map((s) => {
      const el = byId.get(s.elementId);
      if (!el) return null;
      const laid = layoutOf(s, el);
      return { el, box: { x: s.x, y: s.y, w: laid.w, h: laid.h } };
    }).filter(Boolean);
    for (const inner of boxes) {
      if (out.has(inner.el.id)) continue;
      if (boxes.some((outer) => outer !== inner && isDeploymentNode(outer.el.kind)
        && holds(outer.box, inner.box))) out.add(inner.el.id);
    }
  }
  return out;
}

/** id элементов, у которых есть фигура хотя бы на одной диаграмме. */
function shownIds(model) {
  const ids = new Set();
  for (const d of model.diagrams ?? []) for (const s of d.shapes ?? []) ids.add(s.elementId);
  return ids;
}

/** id связей, у которых есть вид хотя бы на одной диаграмме. */
function drawnIds(model) {
  const ids = new Set();
  for (const d of model.diagrams ?? []) for (const l of d.links ?? []) ids.add(l.relId);
  return ids;
}

/** Сирота в модели: элемент не участвует ни в одной связи. */
export function elementIsolated(model, rule) {
  const connected = connectedIds(model);
  const deployed = deployedIds(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (STANDALONE.has(el.kind)) continue;
    if (connected.has(el.id)) continue;
    if (deployed.has(el.id)) continue;
    out.push(report(rule, [el.id], `${titleOf(el)} не участвует ни в одной связи`));
  }
  return out;
}

/** Элемент есть в модели, но ни на одном листе его не показали. */
export function elementNotOnAnyDiagram(model, rule) {
  if (!hasAnyView(model)) return [];
  const shown = shownIds(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (shown.has(el.id)) continue;
    out.push(report(rule, [el.id], `${titleOf(el)} есть в модели, но ни на одной диаграмме нет его фигуры`));
  }
  return out;
}

/**
 * Пустое имя у элемента. Виды с `nameless: true` в нотации (начальное
 * состояние, решение, соединение…) имени не имеют вовсе, поэтому их не судим.
 */
export function elementUnnamed(model, rule) {
  const out = [];
  for (const el of model.elements ?? []) {
    if (STANDALONE.has(el.kind)) continue;
    if (NOTATION.shapes[el.kind]?.nameless) continue;
    if (String(el.name ?? '').trim()) continue;
    out.push(report(rule, [el.id], `у элемента вида «${el.kind}» пустое имя`));
  }
  return out;
}

/**
 * Дубль связи: вторая связь того же вида с теми же концами И теми же
 * различителями.
 *
 * Пара берётся с направлением намеренно: «A → B» и «B → A» — не дубль, а две
 * разные связи, и у обобщения такой встречный ход называется циклом, который
 * ловит правило стандарта. Дубль — это та же самая связь, заведённая второй
 * раз, поэтому лишним считается не первый, а каждый следующий: первый в
 * модели — тот, который оставляют.
 *
 * Две ассоциации между одной парой классов — законный UML, если их можно
 * различить: пособие (упражнение 4.1) прямо советует давать полюсам имена
 * именно для этого. Поэтому связи сравниваются по ролям, кратностям, имени,
 * навигации и агрегации на концах; совпало всё — это действительно дубль.
 */
const same = (a, b) => String(a ?? '') === String(b ?? '');

/** Чем две связи одной пары различаются, кроме самих концов. */
function sameRelationship(a, b) {
  return same(a.fromRole, b.fromRole)
    && same(a.toRole, b.toRole)
    && same(a.fromMultiplicity, b.fromMultiplicity)
    && same(a.toMultiplicity, b.toMultiplicity)
    && same(a.name, b.name)
    && same(a.navigable ?? 'none', b.navigable ?? 'none')
    && same(a.fromAggregation ?? '', b.fromAggregation ?? '')
    && same(a.toAggregation ?? '', b.toAggregation ?? '');
}

export function relationshipDuplicate(model, rule) {
  const first = new Map();
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (!STRUCTURAL.has(rel.kind)) continue;
    const key = `${rel.kind}\u0000${rel.from}\u0000${rel.to}`;
    const seen = first.get(key);
    if (!seen) {
      first.set(key, [rel]);
      continue;
    }
    // Между одной парой может лежать несколько разных связей; дубль — только
    // полное совпадение с одной из уже встреченных.
    const twin = seen.find((r) => sameRelationship(r, rel));
    if (!twin) {
      seen.push(rel);
      continue;
    }
    out.push(report(rule, [rel.id],
      `связь вида «${rel.kind}» ${endsOf(model, rel)} повторяет ${twin.id}`));
  }
  return out;
}

/** Связь живёт в модели, но ни на одном листе её не нарисовали. */
export function relationshipNotOnAnyDiagram(model, rule) {  if (!hasAnyView(model)) return [];
  const drawn = drawnIds(model);
  const out = [];
  for (const rel of model.relationships ?? []) {
    if (drawn.has(rel.id)) continue;
    out.push(report(rule, [rel.id],
      `связь вида «${rel.kind}» ${endsOf(model, rel)} не показана ни на одной диаграмме`));
  }
  return out;
}

/**
 * Сирота на листе: фигура не соединена ни с одной на этой диаграмме, хотя её
 * элемент в модели связан. Глобально изолированный элемент сюда не попадает —
 * его уже поймало `element-isolated`, и второй отчёт об одном и том же был бы
 * шумом. Замечание — на пару (диаграмма, фигура): один элемент может стоять на
 * нескольких листах, и на каждом это отдельный разговор.
 *
 * Это единственное правило обоих слоёв, которое ставит `diagramId`: виноват не
 * элемент сам по себе, а его фигура на конкретном листе. Одинокая на трёх
 * листах фигура даёт три замечания, и каждое несёт свой лист — иначе переход по
 * клику открыл бы первый попавшийся, а не тот, где фигура действительно висит.
 */
export function shapeIsolatedOnDiagram(model, rule) {
  const connected = connectedIds(model);
  const out = [];
  for (const d of model.diagrams ?? []) {
    const touching = new Set();
    for (const l of d.links ?? []) {
      if (l?.from?.shapeId != null) touching.add(l.from.shapeId);
      if (l?.to?.shapeId != null) touching.add(l.to.shapeId);
    }
    for (const s of d.shapes ?? []) {
      const el = elementById(model, s.elementId);
      if (!el || STANDALONE.has(el.kind)) continue;
      if (!connected.has(el.id)) continue;
      if (touching.has(s.id)) continue;
      out.push(report(rule, [el.id],
        `на диаграмме «${d.name}» фигура ${titleOf(el)} не соединена ни с одной другой`,
        { diagramId: d.id }));
    }
  }
  return out;
}

/**
 * `name-not-clash` — два стереотипа с одним именем на одном метаклассе.
 *
 * Это НАШЕ правило удобства, а не §12.4.9.6 UML (`name_not_clash` там про
 * совпадение с ключевым словом расширяемого элемента). Поэтому у него нет
 * пункта стандарта: по §7.4.3.2 `usecase` и `UseCase` — разные строки, то есть
 * формально различимые члены, и никакого нарушения стандарта здесь нет. Есть
 * другое: в списке инспектора две строки «usecase», и человек не понимает,
 * какая из них его. Это запах модели, а не констрейнт, — отсюда слой практики
 * и уровень `warning`.
 *
 * Судится профиль модели (`profiles[]`, свои стереотипы): канонический профиль
 * приложения чист по построению — канонизация сводит записи по паре
 * (нормализованное имя, baseType), — а свои определения человек заводит сам, и
 * именно там появляется второй `usecase`. Отказ при создании — это
 * `stereotypeNameClash` в `io/stereotypes.js`: правило сообщает о том, что уже
 * лежит в файле, а не мешает записать.
 *
 * `targets` пуст намеренно: виноват не элемент и не связь, а определение в
 * профиле, и id профиля не является id модели. Имя профиля и стереотипа стоят
 * в `detail` — по ним человек и найдёт запись.
 */
export function stereotypeNameNotClash(model, rule) {
  const out = [];
  for (const profile of model.profiles ?? []) {
    const records = Array.isArray(profile?.stereotypes) ? profile.stereotypes : [];
    const seen = [];
    for (const record of records) {
      const clash = stereotypeNameClash(seen, {
        name: record?.name, baseTypes: record?.baseTypes, id: record?.id,
      });
      if (clash) {
        const where = String(profile?.name ?? '').trim() || String(profile?.id ?? 'профиль без имени');
        out.push(report(rule, [], `профиль «${where}»: ${clash.message}`));
      }
      seen.push(record);
    }
  }
  return out;
}

/* ------------------------------ ссылки модели: вид цели (слой практики) */

// Четыре проверки ниже судят не элемент сам по себе, а ССЫЛКУ на другой
// элемент модели. Пункта стандарта у них нет: UML не запрещает объект без
// классификатора, действие без вызываемой деятельности и дорожку без
// представляемого элемента. Но если ссылка ЗАПОЛНЕНА, она обещает читателю
// цель конкретного вида, и обещание, которое не выполняется, — ошибка
// инструмента, а не констрейнт модели. Отсюда слой практики и `warning`.
//
// Общие границы (записаны в `hint`, а не спрятаны только здесь):
//   * ссылка пустая — правило молчит: объект без классификатора в корпусе
//     встречается 8 раз из 8, и ругаться на них значило бы красить корпус;
//   * ссылка битая (id не найден) — молчит: её снимает `validateRefs` в
//     `io/umljson.js`, и второе замечание об одном и том же было бы шумом;
//   * лист не найден — молчит по той же причине: имя подпотока, которого нет в
//     файле, — законная ссылка на подпоток, а не дефект модели.
//
// Индекс ссылок строится один раз на функцию (`refs.js`), а не ищется заново на
// каждом элементе: иначе проверка стала бы квадратичной на большой модели.

/** Подпись вида для `detail`: «пакет», «заметка», «деятельность». */
export const kindName = (el) => String(NOTATION.shapes[el?.kind]?.label ?? el?.kind ?? 'элемент').toLowerCase();

/**
 * Виды, экземпляром которых объект может быть.
 *
 * Это классификаторы, у которых в модели бывают экземпляры. Актёр и вариант
 * использования в список не входят, хотя по стандарту они классификаторы:
 * экземпляр актёра на диаграмме не рисуют — актёр это роль во взаимодействии, а
 * не тип объекта. Это взгляд практики, и потому правило живёт в её слое.
 */
const INSTANCE_CLASSIFIERS = new Set([
  'class', 'interface', 'enumeration', 'datatype', 'component', 'artifact',
  'deploymentSpec', 'node', 'device', 'executionEnvironment', 'stereotype',
  'metaclass', 'collaboration',
]);

/**
 * `object-classifier-kind` — объект объявил классификатором пакет, заметку,
 * актёра или другой не-классификатор.
 *
 * Читатель ищет у классификатора атрибуты, чтобы сверить слоты объекта, — и не
 * находит их там, где их не бывает. Загрузчик такую ссылку не снимает: id-то
 * существует, и формально это не битая ссылка. Поэтому ловит правило практики,
 * а не `validateRefs`.
 */
export function objectClassifierKind(model, rule) {
  const ix = refIndex(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'object') continue;
    if (!el.classifierId) continue;                       // пустая ссылка молчит
    const target = resolve(model, el.classifierId, ix);
    if (!target) continue;                                 // битую снимает загрузчик
    if (INSTANCE_CLASSIFIERS.has(target.kind)) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)}: классификатор ${titleOf(target)} — это ${kindName(target)}, `
      + 'а не классификатор, экземпляром которого объект может быть'));
  }
  return out;
}

/**
 * `action-behavior-is-activity` — действие «вызывает» не деятельность.
 *
 * Ссылка `behaviorRef` — это CallBehaviorAction: она обещает поддиаграмму с
 * собственным графом. Деятельность — единственный вид, который такую
 * поддиаграмму даёт; класс или пакет в этой роли обещают её зря.
 */
export function actionBehaviorIsActivity(model, rule) {
  const ix = refIndex(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'action') continue;
    if (!el.behaviorRef) continue;
    const target = resolve(model, el.behaviorRef, ix);
    if (!target) continue;
    if (target.kind === 'activity') continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)} вызывает ${titleOf(target)} — это ${kindName(target)}, а не деятельность`));
  }
  return out;
}

/**
 * `swimlane-represents-kind` — дорожка «представляет» пакет, заметку или
 * другую дорожку.
 *
 * Дорожка отвечает на вопрос «кто или что исполняет эти действия», поэтому
 * представляет классификатор: актёра, класс, компонент, узел. Пакет и заметка
 * на этот вопрос не отвечают, а дорожка в дорожке — просто путаница: подпись
 * «: Подсистема заказов» под дорожкой читается как ошибка, а не как участник.
 *
 * Проверка положительная — «цель классификатор», а не «цель не пакет»: иначе
 * следующая новая фигура нотации (рамка, шкала времени) молча стала бы
 * законной дорожкой.
 */
export function swimlaneRepresentsKind(model, rule) {
  const ix = refIndex(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'swimlane') continue;
    if (!el.represents) continue;
    const target = resolve(model, el.represents, ix);
    if (!target) continue;
    if (metaclassesOf(target.kind)) continue;
    out.push(report(rule, [el.id],
      `${titleOf(el)} представляет ${titleOf(target)} — это ${kindName(target)}, а не классификатор`));
  }
  return out;
}

/**
 * `interaction-use-refers-kind` — ссылка на взаимодействие ведёт не на лист
 * взаимодействия или на себя.
 *
 * В `uml-model/3` `refersTo` хранит id ЛИСТА: отдельной сущности
 * «взаимодействие» с id у нас нет, и лист — это и есть сценарий. Значит,
 * ссылка обязана вести на лист одного из четырёх видов взаимодействия
 * (`INTERACTION_DIAGRAMS`) и не может вести на лист, на котором стоит сама:
 * такая ссылка не разворачивается никогда.
 *
 * Три случая молчания названы в `hint`: пусто, битый id (его снимает
 * загрузчик) и имя подпотока, которого нет в файле (формат разрешает такую ссылку,
 * и терять её нельзя).
 */
export function interactionUseRefersKind(model, rule) {
  const ix = refIndex(model);
  const out = [];
  for (const el of model.elements ?? []) {
    if (el.kind !== 'interactionUse') continue;
    if (!el.refersTo) continue;
    if (String(el.refersTo) === String(el.id)) {
      out.push(report(rule, [el.id],
        `${titleOf(el)} ссылается на себя: развернуть такую ссылку нечем`));
      continue;
    }
    const d = diagramById(model, el.refersTo, ix);
    if (!d) continue;                                      // имя подпотока или битый id
    if (!INTERACTION_DIAGRAMS.has(d.kind)) {
      out.push(report(rule, [el.id],
        `${titleOf(el)} ссылается на лист «${d.name}» вида «${d.kind}» — `
        + 'это не лист взаимодействия'));
      continue;
    }
    if (sheetsOf(model, el.id, ix).some((x) => String(x.id) === String(d.id))) {
      out.push(report(rule, [el.id],
        `${titleOf(el)} ссылается на лист «${d.name}», на котором стоит сама: `
        + 'ссылка не разворачивается'));
    }
  }
  return out;
}
