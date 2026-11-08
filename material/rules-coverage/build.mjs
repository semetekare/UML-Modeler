#!/usr/bin/env node
// Аудит проверяемости констрейнтов UML 2.5.1: считает из данных, какие
// well-formedness rules редактор может проверять, и пересобирает из этого
// документацию (`docs/RULES-SOURCE.md`).
//
//   node material/rules-coverage/build.mjs           # пересобрать
//   node material/rules-coverage/build.mjs --check   # код 1, если файлы устарели
//
// Вход (только чтение):
//   material/spec-ru/ru/*.md            перевод спецификации, разделы `Ограничения`
//   reference/spec/md/*.md              английский оригинал: сверка OCL
//   app/notation/uml.json               виды фигур и связей (`shapes`, `connectors`)
//   KIND_METACLASS в этом файле         вид → метакласс UML (основной источник)
//   app/src/io/stereotypes.js           APPLICABILITY: вид → метаклассы, только
//                                       для видов, которых нет в KIND_METACLASS
//   app/src/io/umljson.js               `*_KEYS` — что модель реально хранит
//   app/src/rules/registry.js           `CHECKS` — у какого правила есть функция
//   app/notation/rules/uml-2.5.1.json   правила, которые уже есть в наборе
//   material/rules-coverage/legacy-reasons.json   ручные причины отброса (заморожены)
//   material/rules-coverage/clause-pages.json     печатная страница каждого пункта
//
// Выход:
//   material/rules-coverage/coverage.json   все 449 с областью, статусом и причиной
//   material/rules-coverage/report.md       человекочитаемая сводка
//   docs/RULES-SOURCE.md                    источник правил, пересобранный из данных
//   docs/RULES-COVERAGE.md                  короткий указатель на эти три файла
//
// Шесть состояний констрейнта (сумма обязана равняться числу констрейнтов):
//   executable  — правило записано и у него есть функция в реестре проверок
//   todo        — всё нужное в модели есть, правило ещё не написано
//   tautology   — в этой схеме нарушить нечем (ручная таблица `TAUTOLOGY`)
//   gap         — упирается в отсутствующее поле или конструкцию модели
//   no-ocl      — в стандарте у констрейнта нет OCL
//   out-of-scope — метакласса нет ни одной фигурой или связью нотации
//
// Область (`scope`) считается отдельно от статуса: `out` — только те, чья
// причина уже говорит «нет вида: метакласс …». Абстрактные метаклассы
// (`Element`, `MultiplicityElement`) остаются `in`: правило на них опирается
// на виды-потомки, и это доказывает записанное правило, а не таблица.
//
// Порядок ветвей важен и задаёт знаменатель: тавтология → нет OCL → вне
// области → исполняется → gap → todo. «Нет OCL» стоит раньше «вне области»
// намеренно: отсутствие OCL — свойство самого стандарта, и оно верно даже для
// метакласса, которого редактор не рисует; иначе эти констрейнты попали бы в
// «вне области» и знаменатель области стал бы меньше, чем он есть.
//
// `TO-IMPLEMENT.md` написан человеком, но `--check` следит, чтобы он не
// потерял ни одного проверяемого констрейнта: список правил меняется только
// вместе с документом.
//
// Детерминизм: ни времени, ни случайности, ни порядка файловой системы —
// обход сортируется, вывод не содержит дат. Два прогона дают те же байты.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'material/rules-coverage');

const FILES = {
  specRu: path.join(ROOT, 'material/spec-ru/ru'),
  specEn: path.join(ROOT, 'reference/spec/md'),
  notation: path.join(ROOT, 'app/notation/uml.json'),
  stereotypes: path.join(ROOT, 'app/src/io/stereotypes.js'),
  umljson: path.join(ROOT, 'app/src/io/umljson.js'),
  registry: path.join(ROOT, 'app/src/rules/registry.js'),
  rules: path.join(ROOT, 'app/notation/rules/uml-2.5.1.json'),
  legacy: path.join(OUT_DIR, 'legacy-reasons.json'),
  toImplement: path.join(OUT_DIR, 'TO-IMPLEMENT.md'),
  pages: path.join(OUT_DIR, 'clause-pages.json'),
  coverage: path.join(OUT_DIR, 'coverage.json'),
  report: path.join(OUT_DIR, 'report.md'),
  source: path.join(ROOT, 'docs/RULES-SOURCE.md'),
  rulesCoverage: path.join(ROOT, 'docs/RULES-COVERAGE.md'),
  rulesTests: path.join(ROOT, 'docs/RULES-TESTS.md'),
  appFixtures: path.join(ROOT, 'app/tests/data/rules'),
  protoFixtures: path.join(ROOT, 'tests/rules'),
};

const read = (file) => fs.readFileSync(file, 'utf8');
/** sha256 файла — чтобы в coverage.json было видно, по какому срезу `app/` считано. */
const sha256 = (file) => sha256Of(fs.readFileSync(file));
/** sha256 произвольного содержимого. */
const sha256Of = (content) => crypto.createHash('sha256').update(content).digest('hex');
const readJson = (file) => JSON.parse(read(file));

/* ══════════════════════════════════════════════════════════ 1. вход */

/**
 * Разбор раздела `Ограничения` перевода.
 *
 * Заголовок `### 11.8.14.7 Port (порт) [Class]` даёт метакласс и номер его
 * подраздела; заголовок `#### 11.8.14.7 Ограничения` открывает раздел;
 * пункт `- **имя**` — констрейнт: дальше проза, затем блок ```ocl.
 *
 * Блок OCL в исходнике иногда разорван: закрывающая ``` стоит в середине
 * выражения, а хвост идёт обычным абзацем (так пришло из PDF). Поэтому после
 * закрытия блока собирается продолжение — до следующего пункта или заголовка.
 *
 * @param {string} dir каталог с разделами
 * @param {RegExp} constraintsHeading заголовок раздела ограничений
 * @returns {Array<object>} констрейнты в порядке документа
 */
function parseConstraints(dir, constraintsHeading) {
  const items = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = read(path.join(dir, file)).split('\n');
    let metaclass = null;
    let metaclassClause = null;
    let inConstraints = false;
    let clause = null;
    for (const line of lines) {
      const heading = line.match(/^### (\d+(?:\.\d+)+) ([^(\[]+?)\s*(?:\(.*?\))?\s*\[[^\]]+\]\s*$/);
      if (heading) {
        metaclass = heading[2].trim();
        metaclassClause = heading[1];
        inConstraints = false;
        continue;
      }
      const sub = line.match(/^#### (\d+(?:\.\d+)+) (.+)$/);
      if (sub) {
        clause = sub[1];
        inConstraints = constraintsHeading.test(sub[2].trim());
        continue;
      }
      if (/^## /.test(line)) {
        metaclass = null;
        inConstraints = false;
        continue;
      }
      if (!inConstraints) continue;
      const bullet = line.match(/^- \*\*(.+?)\*\*\s*$/);
      if (bullet) {
        items.push({
          metaclass, metaclassClause, clause, file, name: bullet[1],
          text: '', ocl: '', oclAfterFence: false, inOcl: false,
        });
        continue;
      }
      const current = items[items.length - 1];
      if (!current) continue;
      if (line.trim() === '```ocl') { current.inOcl = true; continue; }
      if (current.inOcl) {
        if (line.trim() === '```') { current.inOcl = false; current.oclAfterFence = true; continue; }
        current.ocl += `${current.ocl ? '\n' : ''}${line.trimEnd()}`;
        continue;
      }
      if (current.oclAfterFence) {
        if (!line.trim()) continue;
        current.ocl += `\n${line.trimEnd()}`;
        continue;
      }
      if (line.trim()) current.text += `${current.text ? ' ' : ''}${line.trim()}`;
    }
  }
  for (const item of items) {
    item.ocl = item.ocl.replace(/\n{2,}/g, '\n').trim();
    delete item.inOcl;
    delete item.oclAfterFence;
  }
  return items;
}

/**
 * `APPLICABILITY` из `app/src/io/stereotypes.js` — таблица «вид → метаклассы».
 *
 * Это таблица профиля Visual Paradigm, а не UML: состояние в ней `State2`,
 * заметка — `NOTE`, а `initial`, `fork`, `decision` отсутствуют вовсе. Поэтому
 * покрытие считается по `KIND_METACLASS`, а эта таблица — только дополнение для
 * видов, которых в `KIND_METACLASS` нет (см. `metaclassToKinds` в `build()`).
 *
 * Разбирается текстом, а не импортом: файл принадлежит приложению и тянет за
 * собой профиль; аудит читает только таблицу. Формат строки — `вид: ['A', 'B'],`.
 *
 * @param {string} source текст модуля
 * @returns {Record<string, string[]>} вид → метаклассы профиля
 */
function parseApplicability(source) {
  const block = source.match(/export const APPLICABILITY = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('APPLICABILITY не найдена в app/src/io/stereotypes.js');
  const map = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+):\s*\[(.*?)\],?\s*$/);
    if (!m) continue;
    map[m[1]] = m[2].split(',').map((s) => s.trim().replace(/^'/, '').replace(/'$/, '')).filter(Boolean);
  }
  return map;
}

/**
 * Наборы полей модели из `app/src/io/umljson.js`.
 *
 * Аудит не переписывает список полей у себя: он читает `ELEMENT_KEYS`,
 * `REL_KEYS` и остальные `*_KEYS` из кода. Появилось поле — появилось и в
 * аудите, без правки скрипта.
 *
 * @param {string} source текст модуля
 * @returns {{sets: Record<string, string[]>, paths: Set<string>,
 *   scopes: Record<string, Set<string>>, containers: Record<string, string[]>}}
 */
function parseModelFields(source) {
  const sets = {};
  for (const m of source.matchAll(/^const ([A-Z_]+_KEYS) = \[([\s\S]*?)\];/gm)) {
    sets[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  for (const name of ['ELEMENT_KEYS', 'REL_KEYS', 'MEMBER_KEYS', 'OPERAND_KEYS', 'REGION_KEYS', 'INTERNAL_KEYS']) {
    if (!sets[name]) throw new Error(`${name} не найдены в app/src/io/umljson.js`);
  }
  // Поля по областям: у элемента свои, у связи свои, у вложенной строки
  // (член, операнд, регион, внутренний переход) — свои. Плоский список тут
  // соврал бы: `type` есть у строки члена и нет у элемента.
  const scopes = {
    element: new Set(sets.ELEMENT_KEYS),
    connector: new Set(sets.REL_KEYS),
    member: new Set(sets.MEMBER_KEYS),
    operand: new Set(sets.OPERAND_KEYS),
    region: new Set(sets.REGION_KEYS),
    internal: new Set(sets.INTERNAL_KEYS),
  };
  const containers = {
    member: ['attributes', 'operations', 'literals', 'slots'],
    operand: ['operands'],
    region: ['regions'],
    internal: ['internals'],
  };
  // Плоское объединение нужно только для проверки причин («поле `ownerId` есть»).
  const paths = new Set();
  for (const set of Object.values(scopes)) for (const key of set) paths.add(key);
  return { sets, paths, scopes, containers };
}

/**
 * Имена проверок из `app/src/rules/registry.js` (`CHECKS`).
 *
 * Это единственный честный ответ на вопрос «правило исполняется»: движок
 * считает правило исполняемым ровно тогда, когда `check` есть в реестре
 * (`engine.js`, `createRuleset`). Поэтому аудит читает реестр, а не список
 * «невыразимых»: список — объявление, реестр — факт.
 *
 * @param {string} source текст модуля
 * @returns {Set<string>} имена проверок
 */
function parseChecks(source) {
  const block = source.match(/export const CHECKS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('CHECKS не найден в app/src/rules/registry.js');
  return new Set([...block[1].matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

/* ══════════════════════════════════════════ 2. словарь модели */

/**
 * Метаклассы, которые профиль зовёт иначе, чем UML.
 *
 * `APPLICABILITY` — таблица Visual Paradigm, а не UML: состояние в ней
 * `State2`, переход — `Transition2`, линия жизни — `InteractionLifeLine`,
 * объект — `Object`. Это те же метаклассы UML.
 *
 * С тех пор как покрытие считается по `KIND_METACLASS`, нормализация нужна
 * только дополнению из `APPLICABILITY` (виды, которых в таблице нет; сейчас
 * таких нет) и строгому столбцу сверки, который сравнивает имена буквально.
 *
 * SysML-имена (`SysMLBlock`, `SysMLValueType`, `SysMLParticipantProperty`) и
 * служебные имена VP (`NOTE`, `System`, `SequenceMessage`, …) сюда не входят:
 * это не метаклассы UML, и покрытием они не считаются.
 */
const METACLASS_ALIAS = {
  State2: 'State',
  Transition2: 'Transition',
  InteractionLifeLine: 'Lifeline',
  InteractionActor: 'Actor',
  ActivityAction: 'Action',
  Collaboration2: 'Collaboration',
  Object: 'InstanceSpecification',
  NodeInstance: 'Node',
  AssociationEnd: 'Property',
  CentralBufferNode: 'ObjectNode',
  DataStoreNode: 'ObjectNode',
};

/**
 * Свойства UML → поле модели. `null` — поля нет, и это причина отказа.
 *
 * Таблица — единственное место, где аудит «знает» соответствия; каждое
 * значение проверяется на существование в `paths` (наборы `*_KEYS`), так что
 * выдумать поле нельзя: скрипт упадёт на загрузке.
 *
 * `derived` означает «не отдельное поле, а вывод из хранимого»: вложенность —
 * это `ownerId`, границы дорожки — `laneId`, концы связи — `from`/`to`.
 */
const PROPERTY_PATHS = {
  // идентичность и владение
  name: { path: 'name' },
  owner: { path: 'ownerId' },
  encapsulatedClassifier: { path: 'ownerId', derived: 'владелец порта — тот же ownerId' },
  enclosingInteraction: { path: 'ownerId', derived: 'вложенность — ownerId' },
  enclosingOperand: { path: 'ownerId', derived: 'вложенность — ownerId' },
  nestedClassifier: { path: 'ownerId', derived: 'вложенность классификаторов — ownerId' },
  packagedElement: { path: 'ownerId', derived: 'содержимое — ownerId' },
  ownedBehavior: { path: 'ownerId', derived: 'вложенность поведения — ownerId' },
  nestingClass: { path: 'ownerId', derived: 'класс-владелец — ownerId' },
  container: { path: 'ownerId', derived: 'контейнер — ownerId' },
  classifier: { path: 'classifierId' },
  represents: { path: 'represents' },
  refersTo: { path: 'refersTo' },
  laneId: { path: 'laneId' },
  superPartition: { path: 'laneId', derived: 'объемлющая дорожка — laneId' },
  subpartition: { path: 'laneId', derived: 'вложенная дорожка — laneId' },

  // фрагменты и операнды
  interactionOperator: { path: 'operator' },
  operand: { path: 'operands' },
  operands: { path: 'operands' },
  covered: { path: 'operands.messages', derived: 'покрытые линии жизни — сообщения операнда и их концы' },
  messages: { path: 'operands.messages' },

  // рёбра и концы
  incoming: { path: 'to', relation: true, derived: 'входящие — связи, у которых to = элемент' },
  outgoing: { path: 'from', relation: true, derived: 'исходящие — связи, у которых from = элемент' },
  source: { path: 'from', relation: true },
  target: { path: 'to', relation: true },
  opposite: { path: 'to', relation: true, derived: 'противоположный конец бинарной связи' },
  general: { path: 'from', relation: true, derived: 'родитель — начало обобщения' },
  usecases: { path: 'from', relation: true, derived: 'include/extend — связь между вариантами использования' },
  extensionLocation: { path: 'from', relation: true, derived: 'точки расширения — конец связи extend' },
  deployedElement: { path: 'from', relation: true, derived: 'развёрнутые элементы цели — начала связей deployment в эту цель' },
  deployment: { path: 'from', relation: true, derived: 'развёртывания — связи вида deployment' },
  deploymentForArtifact: { path: 'from', relation: true, derived: 'развёртывания, где экземпляр — артефакт' },
  location: { path: 'to', relation: true, derived: 'цель развёртывания — конец связи deployment' },
  association: { path: 'from', relation: true, derived: 'связь, концом которой является свойство' },
  extensionPoint: { path: 'extensionPoints' },
  qualifier: { path: null, why: 'квалификаторы хранятся у концов связи, а не у свойства' },
  aggregation: { path: null, why: 'у порта нет поля агрегации; fromAggregation/toAggregation — у концов связей, а порт не конец связи' },
  isComposite: { path: 'fromAggregation', derived: 'композитный конец — fromAggregation/toAggregation' },
  memberEnd: {
    path: null,
    why: 'у связи ровно два конца from/to; набора концов (n-арности) нет',
  },
  ownedEnd: { path: null, why: 'конец ассоциации не хранится отдельным объектом' },
  end: { path: null, why: 'конец коннектора не хранится объектом; from/to — элементы, а не концы' },
  role: { path: 'from', relation: true, derived: 'роль конца коннектора — элемент на этом конце' },
  partWithPort: { path: null, why: 'у конца коннектора нет части-с-портом' },
  owningAssociation: { path: null, why: 'владелец конца (класс или ассоциация) не различается' },
  isExternal: { path: null, why: 'у дорожки нет флага «внешняя»' },
  isDimension: { path: null, why: 'у дорожки нет флага «измерение»' },

  // члены и слоты
  feature: { path: 'attributes', derived: 'члены элемента — строки attributes/operations' },
  ownedAttribute: { path: 'attributes', derived: 'принадлежащие атрибуты — строки attributes' },
  slot: { path: 'slots' },
  definingFeature: { path: 'slots.name', derived: 'определяющая характеристика слота — имя строки слота' },
  allSlottableFeatures: { path: 'attributes', derived: 'характеристики классификатора — его attributes' },
  default: { path: 'attributes.default' },
  defaultValue: { path: null, why: 'у элемента нет значения по умолчанию (оно есть только у строки члена)' },
  type: { path: null, why: 'у элемента нет поля типа; тип хранится только у строки члена (attributes.type)' },
  visibility: { path: null, why: 'у элемента нет видимости; видимость есть только у строки члена (vis)' },
  isStatic: { path: 'attributes.isStatic' },

  // поведение, параметры, действия
  ownedParameter: { path: null, why: 'у операции и деятельности нет параметров' },
  parameter: { path: null, why: 'узел параметра не хранит ссылку на параметр' },
  direction: { path: null, why: 'у параметра нет направления (in/out/inout)' },
  argument: { path: null, why: 'у сообщения нет аргументов' },
  signature: { path: 'signature', derived: 'подпись сообщения — строка signature у связи' },
  sendEvent: { path: 'from', derived: 'отправка — начало сообщения; отдельного события нет' },
  receiveEvent: { path: 'to', derived: 'приём — конец сообщения; отдельного события нет' },
  events: { path: null, why: 'у линии жизни нет упорядоченного списка событий' },
  action: { path: null, why: 'у пина нет действия-владельца' },
  selection: { path: null, why: 'у узла объектов нет поведения-выбора' },
  ordering: { path: null, why: 'у узла объектов нет порядка' },
  isControlType: { path: null, why: 'у узла объектов нет флага управляющего типа' },
  isActive: { path: null, why: 'у класса нет флага активности' },
  ownedReception: { path: null, why: 'приёмники (reception) не хранятся' },

  // состояния и переходы
  kind: { path: null, why: 'у перехода нет вида (external/internal/local); у псевдосостояния вид — это вид элемента' },
  guard: { path: null, why: 'сторож хранится только у внутреннего перехода состояния (internals.guard), у перехода-связи его нет' },
  trigger: { path: null, why: 'триггер хранится только у внутреннего перехода состояния (internals.trigger), у перехода-связи его нет' },
  connectionPoint: { path: null, why: 'у состояния нет точек подключения' },
  connection: { path: null, why: 'у состояния нет ссылок на точки подключения' },
  isSubmachineState: { path: null, why: 'у состояния нет флага состояния-подавтомата' },
  submachine: { path: null, why: 'у состояния нет ссылки на подмашину' },
  isComposite: { path: 'regions', derived: 'составное состояние — непустые regions' },
  regions: { path: 'regions' },

  // свойства и их связи
  subsettedProperty: { path: null, why: 'отношение subsets не хранится' },
  redefinedProperty: { path: null, why: 'отношение redefines не хранится' },
  redefinitionContext: { path: null, why: 'контекст переопределения не хранится' },
  templateParameterSubstitution: { path: null, why: 'шаблоны не хранятся' },
  formal: { path: null, why: 'формальный параметр шаблона не хранится' },
  isDerivedUnion: { path: null, why: 'флага union нет' },
  isDerived: { path: 'attributes.isDerived', derived: 'производность — флаг строки члена' },
  isReadOnly: { path: null, why: 'флага readOnly нет' },
  part: { path: null, why: 'части узла не хранят тип, поэтому «часть типа узел» не проверить' },
  node: { path: 'regions.nodes', derived: 'узлы деятельности — regions[].nodes' },
  associatedNodes: { path: null, why: 'узел параметра не связан с параметром' },

  // прочее
  associationClass: { path: null, why: 'связь нельзя пометить классом ассоциации' },
  qualifiers: { path: 'fromQualifiers' },
};

/**
 * Свойства, которые в OCL означают разное у разных метаклассов.
 *
 * `memberEnd` и `type` — главный случай. У ассоциации `memberEnd` — это два
 * её конца, а `end.type` — элемент на конце; у порта `type` — тип порта, поля
 * у нас нет. Одна таблица на всех соврала бы в одну сторону или в другую.
 */
const PROPERTY_BY_METACLASS = {
  Association: {
    memberEnd: { path: 'from', derived: 'у связи два конца — from и to; n-арности модель не выражает' },
    type: { path: 'to', derived: 'тип конца ассоциации — элемент на этом конце' },
  },
  UseCase: {
    memberEnd: { path: 'from', derived: 'у связи два конца — from и to' },
    type: { path: 'to', derived: 'тип конца — элемент на этом конце' },
  },
  ActivityParameterNode: {
    activity: { path: 'ownerId', derived: 'деятельность-владелец узла — ownerId' },
  },
  // Четыре свойства OCL названы не так, как поля модели. Без этой таблицы
  // `FinalState::no_regions` и три соседних правила числились «нет поля»,
  // хотя поле есть: `regions`, `entry`, `exit`, `do`.
  FinalState: {
    region: { path: 'regions', derived: 'регионы состояния — regions' },
    entry: { path: 'entry', derived: 'поведение входа — текст entry' },
    exit: { path: 'exit', derived: 'поведение выхода — текст exit' },
    doActivity: { path: 'do', derived: 'поведение do — текст do (приближение: текст, а не поведение)' },
  },
};

/**
 * Вид нотации → метакласс UML. Ключ — `фигура:вид` или `связь:вид`: вид
 * `merge` есть и среди фигур (MergeNode), и среди связей (PackageMerge), и
 * это разные метаклассы.
 *
 * Таблица нужна для одного вопроса: покрыт ли метакласс, который OCL называет
 * в `oclIsKindOf`/`oclAsType`. Отвечает на него цепочка `SUPERCLASS`, а не
 * совпадение имён: `oclAsType(Classifier)` покрыт, потому что у нас есть
 * `class` → `Class` → `Classifier`.
 */
const KIND_METACLASS = {
  'фигура:class': 'Class',
  'фигура:interface': 'Interface',
  'фигура:enumeration': 'Enumeration',
  'фигура:datatype': 'DataType',
  'фигура:package': 'Package',
  'фигура:model': 'Model',
  'фигура:profile': 'Profile',
  'фигура:component': 'Component',
  'фигура:artifact': 'Artifact',
  'фигура:deploymentSpec': 'DeploymentSpecification',
  'фигура:node': 'Node',
  'фигура:device': 'Device',
  'фигура:executionEnvironment': 'ExecutionEnvironment',
  'фигура:object': 'InstanceSpecification',
  'фигура:part': 'Property',
  'фигура:port': 'Port',
  'фигура:collaboration': 'Collaboration',
  'фигура:collaborationUse': 'CollaborationUse',
  'фигура:stereotype': 'Stereotype',
  'фигура:metaclass': 'Class',
  'фигура:actor': 'Actor',
  'фигура:usecase': 'UseCase',
  'фигура:systemBoundary': 'Package',
  'фигура:note': 'Comment',
  'фигура:text': 'Comment',
  'фигура:state': 'State',
  'фигура:action': 'Action',
  'фигура:activity': 'Activity',
  'фигура:objectNode': 'ObjectNode',
  'фигура:activityParameter': 'ActivityParameterNode',
  'фигура:swimlane': 'ActivityPartition',
  'фигура:lifeline': 'Lifeline',
  'фигура:actorLifeline': 'Lifeline',
  'фигура:timingLane': 'Lifeline',
  'фигура:fragment': 'CombinedFragment',
  'фигура:interaction': 'Interaction',
  'фигура:interactionUse': 'InteractionUse',
  'фигура:activation': 'ExecutionSpecification',
  'фигура:initial': 'Pseudostate',
  'фигура:choice': 'Pseudostate',
  'фигура:junction': 'Pseudostate',
  'фигура:historyShallow': 'Pseudostate',
  'фигура:historyDeep': 'Pseudostate',
  'фигура:entryPoint': 'Pseudostate',
  'фигура:exitPoint': 'Pseudostate',
  'фигура:final': 'FinalState',
  'фигура:terminate': 'FinalNode',
  'фигура:decision': 'DecisionNode',
  'фигура:merge': 'MergeNode',
  'фигура:fork': 'ForkNode',
  'фигура:join': 'JoinNode',
  'связь:association': 'Association',
  'связь:aggregation': 'Association',
  'связь:composition': 'Association',
  'связь:generalization': 'Generalization',
  'связь:realization': 'Realization',
  'связь:dependency': 'Dependency',
  'связь:usage': 'Usage',
  'связь:import': 'PackageImport',
  'связь:merge': 'PackageMerge',
  'связь:include': 'Include',
  'связь:extend': 'Extend',
  'связь:assembly': 'Connector',
  'связь:delegation': 'Connector',
  'связь:connector': 'Connector',
  'связь:controlFlow': 'ControlFlow',
  'связь:objectFlow': 'ObjectFlow',
  'связь:transition': 'Transition',
  'связь:message': 'Message',
  'связь:reply': 'Message',
  'связь:createMessage': 'Message',
  'связь:destroyMessage': 'Message',
  'связь:link': 'Association',
  'связь:deployment': 'Deployment',
  'связь:communicationPath': 'Association',
  'связь:manifest': 'Dependency',
  'связь:trace': 'Dependency',
  'связь:extension': 'Generalization',
};

/**
 * Родители метаклассов — та часть иерархии UML 2.5.1, которую называют
 * правила из `Ограничений`. Нужна, чтобы `oclAsType(Classifier)` считался
 * покрытым при наличии вида `class`, а `ConsiderIgnoreFragment` — нет.
 */
const SUPERCLASS = {
  NamedElement: 'Element', Namespace: 'NamedElement', PackageableElement: 'NamedElement',
  Type: 'PackageableElement', TypedElement: 'NamedElement', MultiplicityElement: 'Element',
  Relationship: 'Element', DirectedRelationship: 'Relationship', RedefinableElement: 'NamedElement',
  ConnectableElement: 'TypedElement', Vertex: 'NamedElement', Feature: 'NamedElement',
  Classifier: 'Namespace',
  Class: 'Classifier', Interface: 'Classifier', DataType: 'Classifier', Association: 'Classifier',
  Component: 'Class', Node: 'Class', Device: 'Node', ExecutionEnvironment: 'Node',
  Artifact: 'Classifier', Stereotype: 'Class', Signal: 'Classifier', Collaboration: 'BehavioredClassifier',
  BehavioredClassifier: 'Classifier', Behavior: 'Class', Activity: 'Behavior',
  Interaction: 'Behavior', StateMachine: 'Behavior', UseCase: 'Classifier', Actor: 'Classifier',
  InformationItem: 'Classifier', Enumeration: 'DataType', PrimitiveType: 'DataType',
  Property: 'StructuralFeature', Port: 'Property', StructuralFeature: 'Feature',
  Operation: 'BehavioralFeature', BehavioralFeature: 'Feature',
  Generalization: 'DirectedRelationship', Dependency: 'DirectedRelationship',
  Realization: 'Dependency', Usage: 'Dependency', PackageImport: 'DirectedRelationship',
  PackageMerge: 'DirectedRelationship', Include: 'DirectedRelationship',
  Extend: 'DirectedRelationship', Deployment: 'Dependency',
  InstanceSpecification: 'PackageableElement', DeploymentTarget: 'NamedElement',
  DeploymentSpecification: 'Artifact', Profile: 'Package', Model: 'Package',
  State: 'Namespace', FinalState: 'State', Pseudostate: 'Vertex', Region: 'Namespace',
  Transition: 'Namespace', ActivityNode: 'RedefinableElement',
  ExecutableNode: 'ActivityNode', Action: 'ExecutableNode', ObjectNode: 'ActivityNode',
  ControlNode: 'ActivityNode', DecisionNode: 'ControlNode', MergeNode: 'ControlNode',
  ForkNode: 'ControlNode', JoinNode: 'ControlNode', FinalNode: 'ControlNode',
  InitialNode: 'ControlNode', ActivityParameterNode: 'ObjectNode',
  CentralBufferNode: 'ObjectNode', Pin: 'ObjectNode', InputPin: 'Pin', OutputPin: 'Pin',
  ActivityEdge: 'RedefinableElement', ControlFlow: 'ActivityEdge', ObjectFlow: 'ActivityEdge',
  ActivityGroup: 'NamedElement', ActivityPartition: 'ActivityGroup',
  InteractionFragment: 'NamedElement', InteractionUse: 'InteractionFragment',
  CombinedFragment: 'InteractionFragment', InteractionOperand: 'InteractionFragment',
  OccurrenceSpecification: 'InteractionFragment', Continuation: 'InteractionFragment',
  ExecutionSpecification: 'InteractionFragment',
  MessageOccurrenceSpecification: 'OccurrenceSpecification',
  ConsiderIgnoreFragment: 'CombinedFragment', Lifeline: 'NamedElement', Message: 'NamedElement',
  Connector: 'Feature',
  Constraint: 'PackageableElement', ValueSpecification: 'TypedElement',
  LiteralSpecification: 'ValueSpecification', LiteralString: 'LiteralSpecification',
  LiteralInteger: 'LiteralSpecification', Expression: 'ValueSpecification',
  OpaqueExpression: 'ValueSpecification', Comment: 'Element',
  StructuredActivityNode: 'Action', ConditionalNode: 'StructuredActivityNode',
  LoopNode: 'StructuredActivityNode', ExpansionRegion: 'StructuredActivityNode',
  ExpansionNode: 'ObjectNode', Variable: 'ConnectableElement', ExceptionHandler: 'Element',
  Clause: 'Element', QualifierValue: 'Element', LinkEndData: 'Element',
  TemplateSignature: 'Element', TemplateParameter: 'Element', TemplateBinding: 'DirectedRelationship',
  TemplateParameterSubstitution: 'Element', AssociationClass: 'Class', CollaborationUse: 'NamedElement',
  IntervalConstraint: 'Constraint', InteractionConstraint: 'Constraint',
  DurationConstraint: 'IntervalConstraint', TimeConstraint: 'IntervalConstraint',
  ParameterSet: 'NamedElement', Gate: 'NamedElement', PartDecomposition: 'InteractionUse',
  Reception: 'BehavioralFeature', ProtocolStateMachine: 'StateMachine',
  ProtocolTransition: 'Transition', ConnectionPointReference: 'Vertex',
  InterruptibleActivityRegion: 'ActivityGroup', LinkAction: 'Action',
  MessageEnd: 'NamedElement', Event: 'PackageableElement', TimeObservation: 'PackageableElement',
  DurationObservation: 'PackageableElement', GeneralOrdering: 'NamedElement',
  InformationFlow: 'PackageableElement', Parameter: 'TypedElement', Extension: 'Association',
  ChangeEvent: 'Event', CallEvent: 'Event', SignalEvent: 'MessageEvent', MessageEvent: 'Event',
  TimeEvent: 'Event', DestructionOccurrenceSpecification: 'MessageOccurrenceSpecification',
};

/**
 * Цепочка метакласса и его предков.
 *
 * @param {string} metaclass метакласс UML
 * @returns {string[]} он сам и все предки до `Element`
 */
function metaclassChain(metaclass) {
  const chain = [];
  for (let current = metaclass; current; current = SUPERCLASS[current] ?? null) chain.push(current);
  return chain;
}

/**
 * Имена, которые в модели значат не то, что в OCL.
 *
 * `kind` у элемента — это вид фигуры (`class`, `port`), а `TransitionKind` в
 * правилах — вид перехода (`external`/`internal`/`local`). Одно имя, разные
 * понятия; таблица свойств обязана их различать.
 */
const SHARED_FIELD_NAMES = new Set(['kind']);

/**
 * Констрейнты, которые в нашей схеме нарушить нечем.
 *
 * Это не долг и не «не успели»: свойство самой схемы. Список ручной, потому
 * что автоматически такое не выводится — нужно понять, что конструкция
 * редактора делает нарушение невыразимым. Причина печатается в отчёте.
 */
const TAUTOLOGY = {
  'Association::ends_must_be_typed': 'конец связи всегда элемент: его тип — это from/to, а связь без элемента на конце загрузчик выбрасывает',
  'Stereotype::binaryAssociationsOnly': 'схема бинарна: у связи ровно два конца from/to, поэтому memberEnd->size() = 2 выполняется всегда',
  'UseCase::binary_associations': 'схема бинарна: memberEnd->size() = 2 выполняется всегда',
};

/**
 * Констрейнты, которые в этой схеме нельзя даже нарушить — не «не написали».
 *
 * Отличие от `TAUTOLOGY`: там нарушение невозможно потому, что условие
 * выполняется всегда; здесь — потому что саму ситуацию нельзя выразить в
 * файле модели: загрузчик её выбрасывает. Статус у обоих `gap`/`tautology`
 * разный, а «чего не хватает» у таких констрейнтов нет вовсе: не хватает не
 * поля, а конструкции.
 *
 * Ключ — `метакласс::имя`; значение — причина, она печатается вместо списка
 * полей. Таблица ручная: автоматически не выводится, нужно прочитать загрузчик.
 */
const NO_CONSTRUCT_CONSTRAINT = {
  'Association::specialized_end_types':
    'концы обобщения не могут указывать на связь: from/to называют элемент, '
    + 'и обобщение с id связи загрузчик выбрасывает («Связь N пропущена: её элемент не найден»)',
  // Одно и то же правило с другой стороны: у связи ровно два конца, поэтому
  // `memberEnd->size()` равен 2 у любой ассоциации — и у потомка, и у предка.
  // Нарушить равенство нечем: n-арности схема не знает.
  'Association::specialized_end_number':
    'у связи ровно два конца (from/to), n-арности схема не знает: '
    + 'memberEnd->size() = 2 у любой ассоциации, равенство концов выполняется всегда',
};

/**
 * Страж против молчаливого расхождения: поле, которое таблица считает
 * отсутствующим, но модель уже хранит.
 *
 * Без него аудит тихо остался бы при старом ответе: `defaultValue` появился в
 * `ELEMENT_KEYS`, а правило `Port::default_value` всё ещё «не проверяемо».
 * Лучше упасть с указанием, какую строку таблицы обновить.
 *
 * @param {object} model разобранные `*_KEYS`
 */
function assertNoPhantomAbsence(model) {
  const absent = new Map();
  for (const [property, spec] of Object.entries(PROPERTY_PATHS)) {
    if (spec.path || spec.skip) continue;
    if (SHARED_FIELD_NAMES.has(property)) continue;
    absent.set(property, spec);
  }
  // Проверяются только области самого элемента и связи: вложенная строка
  // (член, операнд, регион) — не то же поле, что одноимённое поле элемента.
  const found = [];
  for (const [property] of absent) {
    for (const scope of ['element', 'connector']) {
      if (model.scopes[scope].has(property)) found.push(`${property} (область ${scope})`);
    }
  }
  if (found.length) {
    throw new Error(
      `PROPERTY_PATHS устарела: модель хранит ${found.join(', ')}, а таблица считает эти поля отсутствующими.\n`
      + 'Обновите PROPERTY_PATHS в material/rules-coverage/build.mjs: укажите путь и уберите причину.',
    );
  }
}

/** Свойства-операции OCL (`x.endType()`), а не поля. */
const DERIVED_CALLS = {
  endType: { path: 'from', derived: 'типы концов — элементы на концах связи' },
  allParents: { path: 'from', derived: 'предки — цепочка обобщений' },
  allFeatures: { path: null, why: 'полного набора характеристик с учётом предков нет' },
  allRoles: { path: null, why: 'набора ролей классификатора нет' },
  inputParameters: { path: null, why: 'у поведения нет параметров' },
  outputParameters: { path: null, why: 'у поведения нет параметров' },
  inheritedMember: { path: null, why: 'наследованных членов не выводим' },
  subsettingContext: { path: null, why: 'отношение subsets не хранится' },
  allOwnedNodes: { path: 'regions.nodes', derived: 'вложенные узлы — regions[].nodes' },
  enclosingFragment: { path: 'operands.messages', relation: true, derived: 'фрагмент-владелец — операнд, в списке сообщений которого перечислено сообщение' },
  parents: { path: 'from', derived: 'родители — цепочка обобщений' },
  oclIsKindOf: { path: null, skip: true },
};

/**
 * Метаклассы, у которых нет конструкции, даже когда есть вид.
 *
 * Вид `activityParameter` профиль считает носителем стереотипов InputPin и
 * OutputPin (так устроен Visual Paradigm), но узел параметра — не пин: у него
 * нет действия-владельца. Проверять правила пинов на нём значило бы проверять
 * не то.
 */
const NO_CONSTRUCT = {
  AssociationClass: 'связь нельзя пометить классом ассоциации — конструкции нет',
  InputPin: 'вид `activityParameter` — узел параметра, а не пин: у пина есть действие-владелец',
  OutputPin: 'вид `activityParameter` — узел параметра, а не пин: у пина есть действие-владелец',
};

/**
 * Счёт, названный до этого аудита, — исторический факт, а не вывод.
 *
 * Проверяется арифметикой: `build.mjs` считает строгий вариант (метакласс
 * совпадает с именем в `APPLICABILITY` буквально) и сравнивает множества.
 * Расхождение печатается поимённо, а не «примерно совпало».
 */
const PRIOR_CLAIM = {
  constraints: 449,
  checked: 23,
  onCoveredMetaclasses: 70,
  onUncoveredMetaclasses: 379,
  discardedOnCovered: 58,
  staleOnCovered: 29,
  staleNames: [
    'Activity::maximum_one_parameter_node', 'Activity::maximum_two_parameter_nodes',
    'ActivityParameterNode::no_outgoing_edges', 'ActivityParameterNode::has_parameters',
    'ActivityParameterNode::same_type', 'ActivityParameterNode::no_incoming_edges',
    'ActivityParameterNode::no_edges',
    'ActivityPartition::represents_classifier', 'ActivityPartition::represents_property_and_is_contained',
    'ActivityPartition::represents_property', 'ActivityPartition::dimension_not_contained',
    'CombinedFragment::break', 'CombinedFragment::consider_and_ignore', 'CombinedFragment::opt_loop_break_neg',
    'ObjectNode::input_output_parameter', 'ObjectNode::selection_behavior', 'ObjectNode::object_flow_edges',
    'Port::port_aggregation', 'Port::default_value', 'Port::encapsulated_owner',
    'Association::association_ends', 'Property::type_of_opposite_end',
    'DeploymentSpecification::deployment_target', 'DeploymentSpecification::deployed_elements',
    'Extend::extension_points', 'Interaction::not_contained', 'Message::cannot_cross_boundaries',
    'Node::internal_structure', 'Property::qualified_is_association_end',
  ],
};

/**
 * К какой области модели относится путь поля.
 *
 * `ownerId` — поле элемента, `to` — поле связи, `slots.name` — поле строки
 * слота внутри элемента. Область нужна, чтобы «у элемента нет типа» не
 * превращалось в «поля `type` нет вовсе»: у строки члена оно есть.
 *
 * @param {string} path путь из PROPERTY_PATHS
 * @returns {{scope: string, field: string, container: string|null}}
 */
function scopeOfPath(path, model) {
  const dot = path.indexOf('.');
  if (dot === -1) {
    if (model.scopes.element.has(path)) return { scope: 'element', field: path, container: null };
    if (model.scopes.connector.has(path)) return { scope: 'connector', field: path, container: null };
    return { scope: 'element', field: path, container: null };
  }
  const head = path.slice(0, dot);
  const field = path.slice(dot + 1);
  const scope = head === 'attributes' || head === 'operations' || head === 'literals' || head === 'slots'
    ? 'member'
    : head === 'operands' ? 'operand'
      : head === 'regions' ? 'region'
        : head === 'internals' ? 'internal'
          : head;
  return { scope, field, container: head };
}

/**
 * Есть ли это поле у вида, которым представлен метакласс.
 *
 * Метакласс может быть представлен и фигурой, и связью (`Property` — это и
 * `part`, и конец ассоциации). Поле считается доступным, если оно есть хотя бы
 * у одного из этих видов.
 *
 * @param {string} path путь из PROPERTY_PATHS
 * @param {Set<string>} kindScopes области видов метакласса: element / connector
 * @param {object} model разобранные `*_KEYS` и контейнеры
 * @returns {boolean}
 */
function fieldAvailable(path, kindScopes, model, relation = false) {
  const { scope, field, container } = scopeOfPath(path, model);
  // Свойство, выводимое из связей модели: оно есть у любого вида, потому что
  // связи хранятся отдельным списком с концами from/to.
  if (relation) return model.scopes.connector.has('from') && model.scopes.connector.has('to');
  if (scope === 'element' || scope === 'connector') {
    // Одноимённое поле бывает и у элемента, и у связи (`name`). Метакласс
    // представлен фигурой или связью — берём ту область, которая ему подходит.
    // `kind` — исключение: у перехода это TransitionKind, у элемента — вид
    // фигуры; одно имя, разные понятия (`SHARED_FIELD_NAMES`).
    if (SHARED_FIELD_NAMES.has(field)) return false;
    return (kindScopes.has('element') && model.scopes.element.has(field))
      || (kindScopes.has('connector') && model.scopes.connector.has(field));
  }
  if (!kindScopes.has('element')) return false;
  const holders = model.containers[scope] ?? [];
  return holders.some((name) => model.scopes.element.has(name)) && model.scopes[scope].has(field);
}

/** Есть ли путь хоть где-то в модели — проверка самой таблицы, не констрейнта. */
function pathExists(path, model) {
  const { scope, field } = scopeOfPath(path, model);
  return Boolean(model.scopes[scope]?.has(field));
}

/* ══════════════════════════════════════════ 3. свойства из OCL */

const OCL_KEYWORDS = new Set([
  'inv', 'pre', 'post', 'body', 'let', 'in', 'if', 'then', 'else', 'elseif', 'endif',
  'and', 'or', 'not', 'implies', 'xor', 'true', 'false', 'null', 'self', 'result',
  'def', 'context', 'package', 'endpackage', 'static', 'derive', 'init',
  'size', 'includes', 'includesAll', 'excludes', 'excludesAll', 'isEmpty', 'notEmpty',
  'forAll', 'exists', 'select', 'reject', 'collect', 'collectNested', 'any', 'one',
  'isUnique', 'sortedBy', 'closure', 'asSet', 'asOrderedSet', 'asSequence', 'asBag',
  'flatten', 'union', 'intersection', 'including', 'excluding', 'symmetricDifference',
  'at', 'first', 'last', 'indexOf', 'append', 'prepend', 'insertAt', 'subSequence',
  'oclIsKindOf', 'oclIsTypeOf', 'oclAsType', 'oclIsUndefined', 'oclIsInvalid', 'oclType',
  'allInstances', 'allOwnedElements', 'conformsTo', 'is', 'toInteger', 'toReal',
  'toString', 'toUpper', 'toLower', 'substring', 'abs', 'max', 'min', 'round', 'floor',
  'ceil', 'div', 'mod', 'sum', 'product', 'count', 'deepClone', 'oclContainer', 'oclContents',
  'Set', 'OrderedSet', 'Sequence', 'Bag', 'Collection', 'Integer', 'Real', 'Boolean',
  'String', 'UnlimitedNatural', 'OclAny', 'OclVoid', 'Tuple',
]);

/**
 * Свойства, которые читает OCL-выражение, и отдельно — «голые» из них.
 *
 * Идентификаторы после точки, коллекции `x->`, и «голые» имена вида
 * `isDimension implies …`. Отбрасываются: ключевые слова OCL, объявленные
 * `let`-переменные, переменные итераторов, имена типов (`oclAsType(Property)`,
 * `Set(...)`) и литералы перечислений (`AggregationKind::composite`).
 *
 * `bare` — имена, которые не стоят после точки, то есть свойства самого
 * констрейнта (`region->size()`, `name = signature.name`). Свойство из цепочки
 * (`cp.entry`) принадлежит другому метаклассу, и плоский разбор не знает его
 * область — поэтому сторож синонимов смотрит только на `bare`.
 *
 * @param {string} ocl текст выражения
 * @returns {{names: string[], bare: Set<string>}} свойства по алфавиту и голые
 */
function scanOcl(ocl) {
  if (!ocl) return { names: [], bare: new Set() };
  const text = ocl
    .replace(/--.*$/gm, '')
    .replace(/"[^"]*"/g, '""')
    // Разрыв внутри `->`: PDF переносит стрелку как `memberEnd- >exists`,
    // иногда ещё и через конец строки.
    .replace(/-\s*>/g, '->')
    // Экранирование ключевого слова OCL: `ParameterDirectionKind::_'in'`.
    .replace(/_\s*'([a-z]+)'/gi, '$1')
    .replace(/\s+/g, ' ');
  const declared = new Set();
  for (const m of text.matchAll(/\blet\s+([A-Za-z_]\w*)\s*:/g)) declared.add(m[1]);
  // Переменные итераторов: `->exists(end2 | …)`, `->select(n : NamedElement | …)`.
  for (const m of text.matchAll(/->\s*\w+\s*\(\s*([A-Za-z_]\w*)\s*(?::[^|]*?)?\s*\|/g)) {
    declared.add(m[1]);
  }
  const found = new Set();
  const bare = new Set();
  for (const m of text.matchAll(/\.\s*([A-Za-z_]\w*)/g)) found.add(m[1]);
  for (const m of text.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*->/g)) { found.add(m[1]); bare.add(m[1]); }
  for (const m of text.matchAll(/(?<![.\w:'"A-Za-z0-9_])([a-z][A-Za-z0-9_]*)\b(?!\s*::)(?!\s*\()/g)) {
    found.add(m[1]);
    bare.add(m[1]);
  }
  const names = [];
  const bareNames = new Set();
  for (const name of found) {
    if (OCL_KEYWORDS.has(name) || declared.has(name)) continue;
    if (/^[A-Z]/.test(name)) continue; // имя типа
    names.push(name);
    if (bare.has(name)) bareNames.add(name);
  }
  return { names: [...new Set(names)].sort(), bare: bareNames };
}

/** Свойства OCL по алфавиту — то, что раньше возвращал `propertiesOf`. */
function propertiesOf(ocl) {
  return scanOcl(ocl).names;
}

/**
 * Метаклассы, которые OCL называет в `oclIsKindOf` / `oclIsTypeOf` / `oclAsType`.
 *
 * Это отдельный вопрос от свойств: `oclIsKindOf(ConsiderIgnoreFragment)`
 * требует не поля, а вида, которого у нас нет. Проверяется по цепочке
 * `SUPERCLASS`, поэтому `oclAsType(Classifier)` покрыт видом `class`.
 *
 * @param {string} ocl текст выражения
 * @returns {string[]} имена метаклассов по алфавиту
 */
function requiredTypes(ocl) {
  if (!ocl) return [];
  const names = new Set();
  for (const m of ocl.matchAll(/ocl(?:IsKindOf|IsTypeOf|AsType)\s*\(\s*([A-Za-z_]\w*)\s*\)/g)) names.add(m[1]);
  return [...names].sort();
}

/* ══════════════════════════════════ 4. устаревшие причины */

/**
 * Что именно утверждает ручная причина и что теперь есть в модели.
 *
 * Причина не проверяется по тексту «на глаз»: для каждой названо, отсутствие
 * какого вида или поля она утверждает. `kinds` — виды нотации, `fields` —
 * поля модели (пути из `paths`). Причина устарела, если названное существует.
 *
 * `partial` — названо и существующее, и отсутствующее (вид есть, конструкция
 * нет). Это не «устарела» и не «верна»: документ обязан сказать обе половины.
 */
const REASON_CLAIMS = [
  { match: /типизированные действия/i, fields: [], note: 'вид `action` есть, но пинов и параметров у действия нет' },
  { match: /структурированные узлы активностей/i, fields: [], note: 'вида структурированного узла нет' },
  { match: /Требует конструкции, которой нет/i, vague: 'причина не называет конструкцию' },
  { match: /шаблоны|Шаблоны/i, fields: [], note: 'шаблонов нет' },
  { match: /не хранит пины/i, fields: [], note: 'узел параметра (`activityParameter`) — не пин' },
  { match: /псевдосостояния \(initial, fork, join, choice/i, kinds: ['initial', 'final', 'choice', 'junction', 'fork', 'join', 'historyShallow', 'historyDeep', 'entryPoint', 'exitPoint', 'terminate'] },
  { match: /псевдосостояния \(final\)/i, kinds: ['final'] },
  { match: /узлы решений/i, kinds: ['decision', 'merge'] },
  { match: /узлы активностей/i, kinds: ['initial', 'final', 'fork', 'join', 'merge'] },
  { match: /не хранит гейты/i, fields: [] },
  { match: /данные концов связей/i, fields: [] },
  { match: /обработчики исключений/i, fields: [] },
  { match: /ссылки на взаимодействия|Ссылки на взаимодействия/i, kinds: ['interactionUse'] },
  { match: /параметры операций|Параметры операций/i, fields: [] },
  { match: /узлы параметров активности/i, kinds: ['activityParameter'] },
  { match: /поведения как элементы/i, kinds: ['activity', 'interaction'] },
  { match: /выражения как элементы/i, fields: [] },
  { match: /разделы \(partitions\)/i, kinds: ['swimlane'] },
  { match: /коннекторы внутренней структуры/i, kinds: ['connector'], fields: [], partialFields: ['partWithPort'], note: 'вид связи есть, конца коннектора с частью-с-портом нет' },
  { match: /Узлы объектов не являются/i, kinds: ['objectNode'] },
  { match: /не хранит узлы объектов/i, kinds: ['objectNode'] },
  { match: /расширения \(Extension\) профилей/i, fields: [] },
  { match: /Сигнатуры сообщений/i, fields: [] },
  { match: /протокольные машины состояний/i, fields: [] },
  { match: /не хранит регионы|Регионы не являются/i, fields: ['regions'] },
  { match: /машину состояний как элемент/i, fields: [] },
  { match: /клаузы условных узлов/i, fields: [] },
  { match: /коллаборации и их использования/i, kinds: ['collaboration', 'collaborationUse'] },
  { match: /Операнды фрагментов|операнды фрагментов/i, fields: ['operands'] },
  { match: /континуации/i, fields: [] },
  { match: /Информационные потоки не являются/i, fields: [] },
  { match: /информационные элементы/i, fields: [] },
  { match: /наборы параметров/i, fields: [] },
  { match: /декомпозиции частей/i, fields: [] },
  { match: /не хранит порты/i, kinds: ['port'] },
  { match: /Отношение subsets|подмножество/i, fields: [] },
  { match: /протокольные переходы/i, fields: [] },
  { match: /квалификаторы|Квалификаторы/i, fields: ['fromQualifiers', 'toQualifiers'] },
  { match: /redefines\/redefinable|Отношение redefines/i, fields: [] },
  { match: /base-свойства расширений/i, fields: [] },
  { match: /спецификации выполнения/i, kinds: ['activation'], note: 'вид `activation` есть; у спецификации выполнения нет ссылки на действие' },
  { match: /активности как элементы/i, kinds: ['activity'] },
  { match: /группы активностей/i, kinds: ['swimlane'], fields: ['regions'] },
  { match: /Обобщение ассоциаций/i, fields: [] },
  { match: /владельца конца ассоциации/i, fields: ['ownerId'] },
  { match: /ассоциативные классы/i, fields: [] },
  { match: /точки подключения состояний/i, kinds: ['entryPoint', 'exitPoint'] },
  { match: /Коннекторы не являются элементом/i, kinds: ['connector'], partialFields: ['partWithPort', 'memberEnd'], note: 'вид СВЯЗИ `connector` есть, конца коннектора с частью-с-портом и набора концов нет' },
  { match: /consider\/ignore-фрагменты/i, fields: [] },
  { match: /Constraint как элемент|не хранит Constraint/i, fields: [] },
  { match: /спецификации развёртывания/i, kinds: ['deploymentSpec'] },
  { match: /импорт элементов как элементы|Импорт элементов/i, kinds: ['import'], partialFields: ['setId'], partial: true, note: 'вид связи `import` есть; ElementImport как элемент (с псевдонимом и видимостью) не хранится' },
  { match: /GeneralizationSet/i, fields: ['generalizationSets'] },
  { match: /Слоты \(slot\)|Слоты \(slot\) не являются/i, fields: ['slots'] },
  { match: /Требует развёртывания$/i, kinds: ['deployment'], partial: true, note: 'связь `deployment` есть; внутренней структуры узла (частей с типом) нет' },
  { match: /Требует развёртывания и слотов/i, kinds: ['deployment'], fields: ['slots'], partial: true, note: 'развёртывание и слоты есть; класса-артефакта у экземпляра нет' },
  { match: /Селекторы линий жизни/i, fields: [] },
  { match: /Производный запрос/i, vague: 'это не утверждение о модели' },
  { match: /Требует поведений и параметров/i, vague: 'причина называет конструкции без полей' },
  { match: /профили как контейнеры/i, kinds: ['profile'] },
  { match: /Свойство union/i, fields: [] },
  { match: /приёмники сигналов/i, fields: [] },
  { match: /Требует псевдосостояний join/i, kinds: ['join'] },
  { match: /Требует псевдосостояний fork/i, kinds: ['fork'] },
  { match: /Требует псевдосостояний и регионов/i, kinds: ['initial', 'final', 'choice', 'junction', 'fork', 'join'], fields: ['regions'] },
  { match: /Требует псевдосостояний initial/i, kinds: ['initial'] },
  { match: /Требует псевдосостояний$/i, kinds: ['initial', 'final', 'choice', 'junction', 'fork', 'join', 'historyShallow', 'historyDeep', 'entryPoint', 'exitPoint', 'terminate'] },
  { match: /Псевдосостояния не являются/i, kinds: ['initial', 'final', 'choice', 'junction', 'fork', 'join', 'historyShallow', 'historyDeep', 'entryPoint', 'exitPoint', 'terminate'] },
  { match: /рёбра активностей/i, kinds: ['controlFlow', 'objectFlow'] },
  { match: /Методы \(method\)/i, fields: [] },
  { match: /Приёмники и classifierBehavior/i, fields: [] },
  { match: /Пути связи не являются/i, kinds: ['communicationPath'] },
  { match: /Компонент внутри класса/i, fields: ['ownerId'] },
  { match: /У перечисления/i, fields: ['attributes'] },
  { match: /наблюдения за временем|временные значения|временные ограничения|события времени|временные выражения/i, fields: [] },
  { match: /mustBeOwned/i, vague: 'причина называет операцию метамодели' },
  { match: /узлы расширения/i, fields: [] },
  { match: /Extend не является/i, kinds: ['extend'] },
  { match: /общие упорядочения/i, fields: [] },
  { match: /взаимодействия как элементы/i, kinds: ['interaction'] },
  { match: /прерываемые области/i, fields: [] },
  { match: /внутренней структуры классификатора/i, kinds: ['part'], fields: ['ownerId'] },
  { match: /порядка событий во времени/i, vague: 'причина про порядок событий, не про поле' },
  { match: /Аргументы сообщений/i, fields: [] },
  { match: /принадлежности линий жизни операндам/i, fields: ['operands'] },
  { match: /Спецификации вхождений|спецификации вхождений/i, fields: [] },
  { match: /анализа побочных эффектов|анализа выражений/i, vague: 'причина про анализ выражений' },
  { match: /владелец-Namespace/i, vague: 'причина называет различие, а не поле' },
  { match: /Импорт пакетов|импорт пакетов/i, kinds: ['import'], partial: true, note: 'вид связи `import` есть; PackageImport как элемент не хранится' },
  { match: /внутренней структуры узла/i, kinds: ['part'], fields: ['ownerId'] },
  { match: /Исполняемые узлы/i, kinds: ['executionEnvironment'] },
  { match: /поведений и узлов объектов/i, vague: 'причина называет конструкции без полей' },
  { match: /Флаги мультивещания/i, fields: [] },
  { match: /Параметры и bodyCondition/i, fields: [] },
  { match: /redefines не является/i, fields: [] },
  { match: /Подмашины состояний/i, fields: [] },
  { match: /Таблицы ключевых слов/i, keywords: true, note: 'таблица UML_KEYWORDS есть в app/src/io/stereotypes.js' },
  { match: /вида перехода \(kind\) и псевдосостояний/i, kinds: ['initial', 'final', 'choice', 'junction', 'fork', 'join'], fields: [], partialFields: ['kind'], note: 'псевдосостояния есть, вида перехода нет' },
  { match: /вида перехода \(kind = local\) и точек входа/i, kinds: ['entryPoint', 'exitPoint'], fields: [], partialFields: ['kind'], note: 'точки входа есть, вида перехода нет' },
  { match: /вида перехода \(kind = internal\)/i, fields: [] },
  { match: /не хранит триггеры переходов/i, fields: ['internals.trigger'], partial: true, note: 'триггер есть только у внутреннего перехода состояния' },
  { match: /переменные активностей/i, fields: [] },
];

/** Вердикт по причине: stale | partial | valid | vague. */
function judgeReason(reason, model) {
  const claim = REASON_CLAIMS.find((c) => c.match.test(reason));
  if (!claim) return { verdict: 'vague', note: 'правило разбора не найдено — причина не проверена', appeared: [] };
  if (claim.vague) return { verdict: 'vague', note: claim.vague, appeared: [] };
  const appeared = [];
  const absent = [];
  for (const kind of claim.kinds ?? []) {
    if (model.kinds.has(kind)) appeared.push(`вид \`${kind}\``);
    else absent.push(`вид \`${kind}\``);
  }
  for (const field of claim.fields ?? []) {
    if (model.paths.has(field)) appeared.push(`поле \`${field}\``);
    else absent.push(`поле \`${field}\``);
  }
  if (claim.keywords) appeared.push('таблица `UML_KEYWORDS`');
  const partialExtra = (claim.partialFields ?? []).filter((f) => !model.paths.has(f));
  const verdict = appeared.length === 0
    ? 'valid'
    : (absent.length || partialExtra.length || claim.partial) ? 'partial' : 'stale';
  return { verdict, note: claim.note ?? '', appeared };
}

/* ══════════════════════════════════════════ 5. классификация */

/**
 * Состояние одного констрейнта.
 *
 * @param {object} constraint разобранный пункт
 * @param {object} ctx правила, виды, поля, уже проверяемые констрейнты
 * @returns {object} запись coverage.json
 */
function classify(constraint, ctx) {
  const key = `${constraint.metaclass}::${constraint.name}`;
  const kinds = ctx.kindsFor(constraint.metaclass);
  const byMetaclass = PROPERTY_BY_METACLASS[constraint.metaclass] ?? {};
  const needs = propertiesOf(constraint.ocl).map((property) => {
    const spec = byMetaclass[property] ?? PROPERTY_PATHS[property] ?? DERIVED_CALLS[property] ?? null;
    if (!spec) return { property, path: null, why: 'соответствия полю нет' };
    if (spec.skip) return { property, path: null, skip: true, why: 'служебная операция OCL' };
    if (spec.path && !pathExists(spec.path, ctx)) {
      throw new Error(`PROPERTY_PATHS: поля «${spec.path}» (свойство «${property}») нет в модели — таблица устарела`);
    }
    const ok = spec.path ? fieldAvailable(spec.path, ctx.scopesFor(constraint.metaclass), ctx, spec.relation) : false;
    return { property, path: ok ? spec.path : null, why: spec.path ? (spec.derived ?? '') : spec.why };
  }).filter((n) => !n.skip);

  const rule = ctx.rulesByKey.get(key) ?? null;
  // `kind` в OCL — это либо вид перехода (TransitionKind), либо вид
  // псевдосостояния. Первое у нас не хранится, второе — это вид элемента.
  // Какой именно случай перед нами, говорит имя перечисления в самом OCL.
  if (needs.some((n) => n.property === 'kind') && /PseudostateKind::/.test(constraint.ocl) && !/TransitionKind::/.test(constraint.ocl)) {
    for (const need of needs) if (need.property === 'kind') { need.path = 'kind'; need.why = 'вид псевдосостояния — это вид элемента'; }
  }
  const missing = needs.filter((n) => !n.path);
  const construct = NO_CONSTRUCT[constraint.metaclass];
  const types = requiredTypes(constraint.ocl);
  const missingTypes = types.filter((type) => !ctx.coveredTypes.has(type));
  const tautology = TAUTOLOGY[key] ?? null;
  const impossible = NO_CONSTRUCT_CONSTRAINT[key] ?? null;
  const hasFunction = Boolean(rule && ctx.checks.has(rule.check));

  let status;
  let reason = null;
  if (tautology) {
    status = 'tautology';
    reason = tautology;
  } else if (impossible) {
    // Нарушить нечем, но и не тавтология: ситуацию нельзя записать в файл.
    status = 'gap';
    reason = impossible;
  } else if (!constraint.ocl) {
    status = 'no-ocl';
    reason = 'в стандарте у правила нет OCL (только проза или «Cannot be expressed in OCL») — проверять нечего';
  } else if (!kinds.length && !rule) {
    // Причина «вне области» — ровно та, что уже стояла в отчёте; из неё же
    // выводится `scope`, чтобы знаменатель 166/283 нельзя было разойтись.
    status = 'out-of-scope';
    reason = `нет вида: метакласс ${constraint.metaclass} не представлен ни одной фигурой или связью нотации`;
  } else if (hasFunction) {
    status = 'executable';
  } else if (construct) {
    status = 'gap';
    reason = construct;
  } else if (missingTypes.length) {
    status = 'gap';
    reason = `нет вида: OCL требует ${missingTypes.map((t) => `\`${t}\``).join(', ')}, такого метакласса у нас нет`;
  } else if (missing.length) {
    status = 'gap';
    reason = `нет поля: ${missing.map((m) => `${m.property} (${m.why})`).join('; ')}`;
  } else {
    status = 'todo';
  }
  const scope = reason?.startsWith('нет вида: метакласс ') ? 'out' : 'in';

  return {
    metaclass: constraint.metaclass,
    name: constraint.name,
    clause: constraint.clause,
    page: ctx.pages[key] ?? null,
    scope,
    status,
    ruleId: rule?.id ?? null,
    text: constraint.text,
    ocl: constraint.ocl,
    needs: needs.map((n) => ({ property: n.property, field: n.path, why: n.why })),
    requires: types,
    missing: missing.map((m) => ({ property: m.property, why: m.why })),
    reason,
  };
}

/**
 * Сторож синонимов: свойство, которого «нет в модели», не имеет права
 * совпадать с полем схемы в той же области.
 *
 * Иначе следующее поле потеряется так же тихо, как потерялись `entry`, `exit`,
 * `region` и `doActivity` у `FinalState`. Ловим только буквальное совпадение:
 * синонимы (`region` → `regions`) задаются таблицей `PROPERTY_BY_METACLASS`, а
 * этот сторож страхует от точного имени, которое забыли провести через неё.
 *
 * `kind` пропускается намеренно: у перехода это `TransitionKind`, у элемента —
 * вид фигуры; одно имя, разные понятия (`SHARED_FIELD_NAMES`).
 *
 * @param {Array<object>} items записи coverage.json
 * @param {object} model разобранные `*_KEYS`
 */
function assertNoPhantomGap(items, model) {
  const found = [];
  for (const item of items) {
    if (item.scope !== 'in') continue;
    const { bare } = scanOcl(item.ocl);
    for (const miss of item.missing) {
      // Свойство из цепочки (`cp.entry`) принадлежит чужому метаклассу:
      // «та же область» для него не определена, и совпадение имени ничего не
      // доказывает. Проверяются только голые свойства констрейнта.
      if (!bare.has(miss.property)) continue;
      if (SHARED_FIELD_NAMES.has(miss.property)) continue;
      for (const scope of ['element', 'connector']) {
        if (model.scopes[scope].has(miss.property)) {
          found.push(`${item.metaclass}::${item.name}: свойство «${miss.property}» есть в области ${scope}`);
        }
      }
    }
  }
  if (found.length) {
    throw new Error(
      'сторож синонимов: свойство из missing совпало с полем модели — таблица соответствий неполна:\n'
      + `${found.join('\n')}\n`
      + 'добавьте синоним в PROPERTY_PATHS или PROPERTY_BY_METACLASS в material/rules-coverage/build.mjs.',
    );
  }
}

/**
 * Один sha256 на весь каталог перевода: имена файлов по порядку и их байты.
 *
 * @returns {string} содержимое, по которому считается отпечаток
 */
function specDigestSource() {
  const parts = [];
  for (const file of fs.readdirSync(FILES.specRu).filter((f) => f.endsWith('.md')).sort()) {
    parts.push(file, read(path.join(FILES.specRu, file)));
  }
  return parts.join('\u0000');
}

/* ══════════════════════════════════════════ 6. вывод */

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
/** Уникальные поля записи, по алфавиту: `ownerId, ownerId` → `ownerId`. */
const fieldsOf = (item) => [...new Set(item.needs.map((n) => n.field))].sort();
const code = (s) => `\`${esc(s)}\``;

/** coverage.json — машиночитаемый результат: все констрейнты с состоянием. */
function coverageJson(result) {
  const { items, groups, totals } = result;
  const doc = {
    schema: 'rules-coverage/1',
    about: 'Проверяемость well-formedness rules UML 2.5.1 в редакторе visual-paradigm. Собрано material/rules-coverage/build.mjs из перевода, KIND_METACLASS (вид → метакласс UML; APPLICABILITY — дополнение для видов, которых в ней нет), *_KEYS, набора правил и реестра проверок. scope — в области ли констрейнт (метакласс выражен фигурой или связью); status — одно из шести состояний, их сумма равна числу констрейнтов.',
    inputs: {
      'app/src/io/stereotypes.js': sha256(FILES.stereotypes),
      'app/src/io/umljson.js': sha256(FILES.umljson),
      'app/src/rules/registry.js': sha256(FILES.registry),
      'app/notation/uml.json': sha256(FILES.notation),
      'app/notation/rules/uml-2.5.1.json': sha256(FILES.rules),
      'material/spec-ru/ru': sha256Of(specDigestSource()),
      'material/rules-coverage/legacy-reasons.json': sha256(FILES.legacy),
      'material/rules-coverage/clause-pages.json': sha256(FILES.pages),
    },
    totals,
    byMetaclass: groups.map((group) => ({
      metaclass: group.metaclass,
      clause: group.clause,
      metaclassClause: group.metaclassClause,
      kinds: group.kinds,
      constraints: group.items.length,
      inScope: group.items.filter((i) => i.scope === 'in').length,
      statuses: Object.fromEntries(
        ['executable', 'todo', 'tautology', 'gap', 'no-ocl', 'out-of-scope']
          .map((status) => [status, group.items.filter((i) => i.status === status).length]),
      ),
      items: group.items,
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** report.md — сводка для человека: счёт, что проверяемо, что устарело. */
function reportMd(result) {
  const { groups, totals, rules } = result;
  const lines = [];
  const push = (...xs) => lines.push(...xs);
  const itemByKey = new Map(result.items.map((item) => [`${item.metaclass}::${item.name}`, item]));
  const ruleItems = rules
    .map((rule) => itemByKey.get(`${rule.source.metaclass}::${rule.source.name}`))
    .filter(Boolean);
  const writtenWithoutFunction = ruleItems.filter((item) => item.status !== 'executable');
  const notExecuted = (status) => writtenWithoutFunction.filter((item) => item.status === status).length;
  const impossibleWritten = writtenWithoutFunction
    .filter((item) => NO_CONSTRUCT_CONSTRAINT[`${item.metaclass}::${item.name}`]).length;
  const statusSum = totals.executable + totals.todo + totals.tautology + totals.gap
    + totals.noOcl + totals.outOfScope;

  push(
    '# Проверяемость констрейнтов UML 2.5.1 — сводка по данным',
    '',
    'Собрано `material/rules-coverage/build.mjs`. Править вручную бессмысленно:',
    'следующий прогон перезапишет файл, а `--check` покажет расхождение.',
    '',
    '| Показатель | Значение |',
    '| --- | ---: |',
    `| Констрейнтов в спецификации | ${totals.constraints} |`,
    `| **В области** (метакласс выражен фигурой или связью) | **${totals.inScope}** |`,
    `| Вне области (метакласса нет ни одной фигурой) | ${totals.outOfScope} |`,
    `| **Исполняется** | **${totals.executable} из ${totals.inScope} в области** |`,
    `| **Записано правил** | **${totals.rulesWritten}** |`,
    `| Метаклассов с видом | ${totals.metaclassesCovered} |`,
    `| Метаклассов без вида | ${totals.metaclassesUncovered} |`,
    `| Устаревших причин | ${totals.staleReasons} |`,
    `| Причин, верных наполовину | ${totals.partialReasons} |`,
    `| Причин, которые нечего проверять | ${totals.vagueReasons} |`,
    '',
  );

  push(
    `Разница ${totals.rulesWritten} − ${totals.executable} = ${totals.rulesWritten - totals.executable}: правила записаны, но не исполняются — `
      + `${notExecuted('tautology')} тавтологии схемы, ${notExecuted('todo')} без функции, хотя всё для проверки есть, `
      + `${notExecuted('gap') - impossibleWritten} упираются в отсутствующее поле или конструкцию модели, `
      + `${impossibleWritten} невозможно по конструкции схемы.`,
    '',
    '| Статус | Констрейнтов | Что значит |',
    '| --- | ---: | --- |',
    `| \`executable\` | ${totals.executable} | правило записано, функция есть |`,
    `| \`todo\` | ${totals.todo} | всё нужное в модели есть, правило ещё не написано |`,
    `| \`tautology\` | ${totals.tautology} | в этой схеме нарушить нечем |`,
    `| \`gap\` | ${totals.gap} | нет поля или конструкции модели |`,
    `| \`no-ocl\` | ${totals.noOcl} | в стандарте у констрейнта нет OCL |`,
    `| \`out-of-scope\` | ${totals.outOfScope} | метакласса нет ни одной фигурой или связью |`,
    `| **сумма** | **${statusSum}** | равна числу констрейнтов |`,
    '',
  );

  // Констрейнты, которые нельзя даже нарушить: не «не написали» и не «нет
  // поля», а «такой ситуации не бывает в файле модели». Список ручной
  // (`NO_CONSTRUCT_CONSTRAINT`), поэтому он идёт отдельным разделом: в
  // таблице «чего не хватает» у них нет ни одного поля.
  const impossible = result.items.filter((item) => NO_CONSTRUCT_CONSTRAINT[`${item.metaclass}::${item.name}`]);
  push('## Невозможные по конструкции', '');
  if (!impossible.length) push('Нет.', '');
  else {
    push(
      `Таких констрейнтов **${impossible.length}**: нарушить их нечем, потому что ситуацию`,
      'нельзя записать в файл модели — загрузчик её выбрасывает. Это не долг и не',
      'очередь; причина названа, поля не хватает не здесь.',
      '',
      '| Метакласс | Пункт | Констрейнт | Почему нельзя нарушить |',
      '| --- | --- | --- | --- |',
    );
    for (const item of impossible) {
      push(`| ${item.metaclass} | ${item.clause} | ${code(item.name)} | ${esc(item.reason)} |`);
    }
    push('');
  }

  const todo = groups.flatMap((group) => group.items
    .filter((item) => item.status === 'todo')
    .map((item) => ({ ...item, metaclass: group.metaclass })));
  push('## Очередь: что можно проверить сейчас', '');
  if (!todo.length) push('Ни одного: у всех констрейнтов не хватает вида или поля.', '');
  else {
    push(
      `Констрейнтов со статусом \`todo\`: **${todo.length}**. У каждого есть вид и все поля;`,
      'часть уже записана в наборе, но без функции. Порядок и пачки — в',
      '[`TO-IMPLEMENT.md`](../material/rules-coverage/TO-IMPLEMENT.md).',
      '',
      '| Метакласс | Пункт | Констрейнт | Что нужно из модели | Правило |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const item of todo) {
      push(`| ${item.metaclass} | ${item.clause} | ${code(item.name)} | ${fieldsOf(item).map(code).join(', ') || '—'} | ${item.ruleId ? code(item.ruleId) : '—'} |`);
    }
    push('');
  }

  const stale = groups.flatMap((group) => group.items
    .filter((item) => item.reasonChecked === 'stale' || item.reasonChecked === 'partial')
    .map((item) => ({ ...item, metaclass: group.metaclass })));
  push('## Устаревшие причины', '');
  push('Причина — та, что стоит в старом документе; справа — что с тех пор появилось.', '');
  if (!stale.length) push('Нет.', '');
  else {
    push('| Метакласс | Констрейнт | Старая причина | Появилось | Вердикт |', '| --- | --- | --- | --- | --- |');
    for (const item of stale) {
      push(`| ${item.metaclass} | ${code(item.name)} | ${esc(item.legacyReason)} | ${esc(item.appeared.join(', '))} | ${item.reasonChecked} |`);
    }
    push('');
    const staleOnly = stale.filter((item) => item.reasonChecked === 'stale').length;
    const partialOnly = stale.filter((item) => item.reasonChecked === 'partial').length;
    push(
      `Всего устаревших причин: **${staleOnly}**; ещё ${partialOnly} верны наполовину —`,
      'вид появился, а конструкции, нужной самому правилу, всё ещё нет.',
      '',
    );
  }

  // Считаются только констрейнты в области: у остальных причина отказа —
  // отсутствие вида, а не поля.
  const missingCounter = new Map();
  for (const item of result.items.filter((i) => i.scope === 'in')) {
    for (const miss of item.missing) {
      if (!missingCounter.has(miss.property)) missingCounter.set(miss.property, { property: miss.property, why: miss.why, count: 0 });
      missingCounter.get(miss.property).count += 1;
    }
  }
  push('## Чего не хватает — по частоте', '');
  push('| Свойство OCL | Почему нельзя | Констрейнтов |', '| --- | --- | ---: |');
  for (const row of [...missingCounter.values()].sort((a, b) => b.count - a.count || (a.property < b.property ? -1 : 1))) {
    push(`| ${code(row.property)} | ${esc(row.why)} | ${row.count} |`);
  }
  push('');

  push('## По метаклассам', '');
  push(
    '| Метакласс | Виды | Пункт | Всего | В области | Исполняется | Очередь | Тавтологии | Gap | Без OCL | Вне области |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const group of groups) {
    const count = (status) => group.items.filter((i) => i.status === status).length;
    push(`| ${group.metaclass} | ${group.kinds.join(', ') || '—'} | ${group.clause} | ${group.items.length}`
      + ` | ${group.items.filter((i) => i.scope === 'in').length} | ${count('executable')} | ${count('todo')}`
      + ` | ${count('tautology')} | ${count('gap')} | ${count('no-ocl')} | ${count('out-of-scope')} |`);
  }
  push('');
  return `${lines.join('\n')}\n`;
}

/**
 * docs/RULES-COVERAGE.md — короткий указатель, а не второй отчёт.
 *
 * Раньше этот файл писали руками, и он разошёлся с набором правил настолько,
 * что говорил «23 правила» при 41 записанном. Теперь он собирается из тех же
 * данных, что и `report.md`, и не содержит ни одного числа, написанного руками:
 * единственное место, где числа появляются, — этот генератор.
 *
 * @param {object} result результат сборки
 * @returns {string} текст документа
 */
function coverageDocMd(result) {
  const { totals } = result;
  const sum = totals.executable + totals.todo + totals.tautology + totals.gap
    + totals.noOcl + totals.outOfScope;
  return [
    '# Покрытие правил проверки — указатель',
    '',
    'Этот файл не хранит чисел, написанных руками: он собирается',
    '[`material/rules-coverage/build.mjs`](../material/rules-coverage/build.mjs) из',
    'перевода спецификации, нотации и набора правил. Полная сводка —',
    '[`material/rules-coverage/report.md`](../material/rules-coverage/report.md),',
    'машиночитаемые данные — [`coverage.json`](../material/rules-coverage/coverage.json),',
    'очередь правил — [`TO-IMPLEMENT.md`](../material/rules-coverage/TO-IMPLEMENT.md),',
    'источник правил — [`RULES-SOURCE.md`](RULES-SOURCE.md).',
    '',
    '| Показатель | Значение |',
    '| --- | ---: |',
    `| Констрейнтов UML 2.5.1 | ${totals.constraints} |`,
    `| В области (метакласс выражен фигурой или связью) | ${totals.inScope} |`,
    `| Вне области | ${totals.outOfScope} |`,
    `| Исполняется правил | ${totals.executable} |`,
    `| Записано правил | ${totals.rulesWritten} |`,
    '',
    '| Статус | Констрейнтов |',
    '| --- | ---: |',
    `| \`executable\` | ${totals.executable} |`,
    `| \`todo\` | ${totals.todo} |`,
    `| \`tautology\` | ${totals.tautology} |`,
    `| \`gap\` | ${totals.gap} |`,
    `| \`no-ocl\` | ${totals.noOcl} |`,
    `| \`out-of-scope\` | ${totals.outOfScope} |`,
    `| **сумма** | **${sum}** |`,
    '',
    'Значения статусов:',
    '',
    '* `executable` — правило записано, функция есть;',
    '* `todo` — всё нужное в модели есть, правило ещё не написано;',
    '* `tautology` — в этой схеме нарушить нечем;',
    '* `gap` — нет поля или конструкции модели;',
    '* `no-ocl` — в стандарте у констрейнта нет OCL;',
    '* `out-of-scope` — метакласса нет ни одной фигурой или связью нотации.',
    '',
    'Слой практики ([`practice.json`](../app/notation/rules/practice.json)) в этот',
    'счёт не входит: у советов практики нет пункта UML, и знаменатель — только',
    'констрейнты стандарта.',
    '',
    'Пересборка: `node material/rules-coverage/build.mjs`; проверка расхождений:',
    '`node material/rules-coverage/build.mjs --check`.',
    '',
  ].join('\n');
}

/**
 * Число пар фикстур в каталоге: `<id>.json` + `<id>.ok.json`.
 *
 * Считается по файлам, а не берётся из документа: пара — это факт каталога, а
 * не утверждение текста. Отсутствующий каталог — ноль, а не ошибка: у
 * прототипа и приложения каталоги разные, и один из них может не быть.
 *
 * @param {string} dir каталог фикстур
 * @returns {number} число пар
 */
function fixturePairs(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((file) => file.endsWith('.ok.json')).length;
}

/**
 * Блок чисел в `docs/RULES-TESTS.md` — единственная генерируемая часть файла.
 *
 * Остальной текст документа ручной: он про прототип и про то, что именно
 * нарушено в каждой модели, и из данных не выводится. Генерируется только
 * сводка, между маркерами `generated:rules-summary`; поэтому `--check` ловит
 * устаревший счётчик, но не запрещает править прозу.
 *
 * @param {object} result результат сборки
 * @returns {string} файл целиком
 */
function rulesTestsMd(result) {
  const begin = '<!-- generated:rules-summary -->';
  const end = '<!-- /generated:rules-summary -->';
  const actual = fs.existsSync(FILES.rulesTests) ? read(FILES.rulesTests) : null;
  if (actual == null) throw new Error('docs/RULES-TESTS.md нет: документ удалён, а блок чисел собирается в нём');
  const from = actual.indexOf(begin);
  const to = actual.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`в docs/RULES-TESTS.md нет маркеров «${begin}» … «${end}» — блок чисел некуда вставить`);
  }

  const { totals } = result;
  const written = result.rules
    .map((rule) => result.items.find((item) => item.metaclass === rule.source.metaclass && item.name === rule.source.name))
    .filter(Boolean);
  const withoutFunction = written.filter((item) => item.status !== 'executable');
  const tautology = withoutFunction.filter((item) => item.status === 'tautology').length;
  const impossible = withoutFunction
    .filter((item) => NO_CONSTRUCT_CONSTRAINT[`${item.metaclass}::${item.name}`]).length;
  const queue = withoutFunction.length - tautology - impossible;
  const appPairs = fixturePairs(FILES.appFixtures);
  const protoPairs = fixturePairs(FILES.protoFixtures);

  const block = [
    '| Показатель | Значение |',
    '| --- | ---: |',
    `| Правил стандарта в наборе | ${totals.rulesWritten} |`,
    `| Из них исполняются (функция есть) | ${totals.executable} |`,
    `| Из них без функции | ${withoutFunction.length} |`,
    `| — тавтологии схемы: нарушить нечем | ${tautology} |`,
    `| — в очереди: не написаны или упираются в отсутствующее поле | ${queue} |`,
    `| — невозможно по конструкции схемы | ${impossible} |`,
    `| Пар фикстур приложения (\`app/tests/data/rules/\`) | ${appPairs} |`,
    `| Пар фикстур прототипа (\`tests/rules/\`) — историческая цифра | ${protoPairs} |`,
    '',
    'Числа считает [`material/rules-coverage/build.mjs`](../material/rules-coverage/build.mjs)',
    'из [`coverage.json`](../material/rules-coverage/coverage.json) и каталогов фикстур;',
    'этот блок руками не правится — `--check` покажет расхождение. Прототип заморожен,',
    'поэтому его число не меняется: это срез на момент заморозки, а не текущее состояние.',
  ].join('\n');

  // Пустые строки вокруг таблицы обязательны: HTML-комментарий без них
  // приклеивается к таблице, и Markdown перестаёт её разбирать.
  return `${actual.slice(0, from)}${begin}\n\n${block}\n\n${end}${actual.slice(to + end.length)}`;
}

/**
 * Документ-источник правил, пересобранный из данных.
 *
 * Постоянные разделы (шапка, устройство констрейнтов, оговорки) — текст,
 * который не выводится из данных. Всё, что считается, — считается: счётчики,
 * таблица применимых правил, отброшенные с проверкой причины, список
 * проверяемого сейчас и разбор пробелов.
 */
function sourceMd(result) {
  const { groups, totals, rules, items } = result;
  const clauses = new Set(items.map((i) => i.clause)).size;
  const aliasRows = Object.entries(METACLASS_ALIAS)
    .filter(([from, to]) => result.applicabilityValues.has(from) && !result.applicabilityValues.has(to))
    .map(([from, to]) => `\`${from}\` → ${to}`)
    .join(', ');
  const { strictView } = result;
  const normalized = {
    onCovered: totals.inScope,
    uncovered: totals.outOfScope,
    discarded: items.filter((item) => item.scope === 'in' && item.status !== 'executable').length,
    stale: items.filter((item) => item.scope === 'in' && item.reasonChecked === 'stale').length,
    partial: items.filter((item) => item.scope === 'in' && item.reasonChecked === 'partial').length,
    valid: items.filter((item) => item.scope === 'in' && item.reasonChecked === 'valid').length,
    vague: items.filter((item) => item.scope === 'in' && item.reasonChecked === 'vague').length,
    none: items.filter((item) => item.scope === 'in' && item.reasonChecked === 'none').length,
  };
  const lines = [];
  const push = (...xs) => lines.push(...xs);

  push(
    '# Откуда взяты правила UML 2.5.1',
    '',
    'Набор `rules-uml-2.5.1.json` собран из спецификации OMG UML 2.5.1 и только из неё. Каждая запись ссылается на пункт стандарта, имя констрейнта и страницу печатного издания.',
    '',
    '| | |',
    '| --- | --- |',
    '| Документ | OMG Unified Modeling Language (OMG UML), Version 2.5.1 |',
    '| Номер документа | `formal/2017-12-05`, декабрь 2017 |',
    '| Источник | <https://www.omg.org/spec/UML/2.5.1/PDF> |',
    '| Локальная копия | [`reference/spec/uml-2.5.1.pdf`](../reference/spec/uml-2.5.1.pdf) |',
    '| Размер / страниц | 18 069 510 байт / 796 |',
    '| SHA-256 | `416b57e1933780eb48bd60fe513e031da220c28a521bdd334a366bebc78a463e` |',
    '| Markdown-серия | [`reference/spec/md/`](../reference/spec/md/INDEX.md) — 25 файлов, 1725670 байт |',
    '| Текстовый слой | выделяемый (`pdftotext -layout` даёт чистый текст, не скан) |',
    '',
    'Печатная страница *n* соответствует странице PDF *n + 42*.',
    '',
    '## Как в UML 2.5.1 устроены well-formedness rules',
    '',
    'В 2.5.1 констрейнты **именованные**, а не нумерованные. В разделах вида `11.8.1.8 Constraints` каждый констрейнт оформлен как пункт списка: имя, прозаическое описание, затем OCL-выражение в блоке `inv:`. Конструкции `[1] … [2] …` с квадратными скобками в спецификации **нет** — такая нумерация была в более ранних редакциях UML и в примерах к задачам; в 2.5.1 её не существует.',
    '',
    'Поэтому в записи правила поле `source.constraint` имеет вид `Метакласс::имя`, а поле `source.clause` — номер подраздела Constraints, например `11.8.1.8`.',
    '',
    'Отдельно отметим: у метакласса **Generalization в 2.5.1 нет подраздела Constraints вообще** (9.9.7 содержит только Description, Diagrams, Generalizations, Attributes, Association Ends). Правило «родитель и потомок обобщения не могут совпадать» из UML 2.4 в 2.5.1 отсутствует — его роль выполняет `Classifier::no_cycles_in_generalization` (9.9.4.8), которое и включено в набор.',
    '',
    '## Сколько констрейнтов',
    '',
    'Все числа ниже считает [`material/rules-coverage/build.mjs`](../material/rules-coverage/build.mjs); правка руками разойдётся с данными на первом же прогоне `--check`.',
    '',
    '| Показатель | Значение |',
    '| --- | ---: |',
    `| Подразделов \`Ограничения\` в переводе | ${new Set(items.map((i) => i.clause)).size} |`,
    `| Всего well-formedness rules извлечено | ${totals.constraints} |`,
    `| **В области** (метакласс выражен фигурой или связью) | **${totals.inScope}** |`,
    `| Вне области (метакласса нет ни одной фигурой) | ${totals.outOfScope} |`,
    `| **Записано правил** | **${totals.rulesWritten}** |`,
    `| Из них **исполняется** | **${totals.executable}** |`,
    `| Из них без функции | ${totals.rulesWritten - totals.executable} |`,
    `| Из неисполняемых с OCL-выражением | ${items.filter((i) => i.status !== 'executable' && i.ocl).length} |`,
    `| Из неисполняемых без OCL (в стандарте «Cannot be expressed in OCL» или только проза) | ${items.filter((i) => i.status !== 'executable' && !i.ocl).length} |`,
    `| Метаклассов, у которых есть вид | ${totals.metaclassesCovered} |`,
    `| Метаклассов без вида | ${totals.metaclassesUncovered} |`,
    '',
    '| Статус | Констрейнтов | Что значит |',
    '| --- | ---: | --- |',
    `| \`executable\` | ${totals.executable} | правило записано, функция есть |`,
    `| \`todo\` | ${totals.todo} | всё нужное в модели есть, правило ещё не написано |`,
    `| \`tautology\` | ${totals.tautology} | в этой схеме нарушить нечем |`,
    `| \`gap\` | ${totals.gap} | нет поля или конструкции модели |`,
    `| \`no-ocl\` | ${totals.noOcl} | в стандарте у констрейнта нет OCL |`,
    `| \`out-of-scope\` | ${totals.outOfScope} | метакласса нет ни одной фигурой или связью |`,
    `| **сумма** | **${totals.executable + totals.todo + totals.tautology + totals.gap + totals.noOcl + totals.outOfScope}** | равна числу констрейнтов |`,
    '',
    `Уровни в наборе: error — ${rules.filter((r) => r.level === 'error').length}, warning — ${rules.filter((r) => r.level === 'warning').length}, info — ${rules.filter((r) => r.level === 'info').length}.`,
    '',
    '## Как посчитано',
    '',
    'Счёт не выписан руками: его считает [`material/rules-coverage/build.mjs`](../material/rules-coverage/build.mjs)',
    'по четырём источникам, и каждый шаг можно перепроверить.',
    '',
    `1. **Констрейнты.** Раздел \`Ограничения\` каждого подраздела перевода: ${clauses} подразделов, ${totals.constraints} пунктов.`,
    '   Заголовок `### 11.8.14.7 Port (порт) [Class]` даёт метакласс, заголовок',
    '   `#### … Ограничения` открывает раздел, пункт `- **имя**` — констрейнт.',
    '2. **OCL.** Блок ` ```ocl ` после пункта. В переводе два блока обрезаны посередине',
    '   (`Activity::maximum_two_parameter_nodes`, `ActivityPartition::represents_classifier`) —',
    '   для них берётся английский оригинал из `reference/spec/md/`. Других расхождений нет:',
    '   у остальных 447 длина OCL в переводе и в оригинале совпадает.',
    '3. **Вид.** `KIND_METACLASS` в этом скрипте — вид нотации → метакласс UML;',
    '   ключи сверяются с `app/notation/uml.json` по **обеим** таблицам, `shapes` и',
    '   `connectors`. Это наш собственный выбор, а не таблица профиля:',
    '   `APPLICABILITY` в `app/src/io/stereotypes.js` — таблица Visual Paradigm, в ней',
    '   `state` назван `State2`, заметка — `NOTE`, а `initial`, `fork`, `decision`',
    '   отсутствуют вовсе. Поэтому `APPLICABILITY` — только дополнение для видов,',
    '   которых в `KIND_METACLASS` нет (сейчас таких нет); имена профиля там',
    `   нормализуются: ${aliasRows}.`,
    '   SysML-имена (`SysMLBlock`, `SysMLValueType`, `SysMLParticipantProperty`) не',
    '   нормализуются: это не метаклассы UML.',
    '4. **Поле.** Свойства берутся из OCL: имена после точки, коллекции `x->`, «голые» имена',
    '   вида `isDimension`. Отбрасываются ключевые слова OCL, объявленные `let`, переменные',
    '   итераторов и имена типов. Каждое имя сверяется с таблицей «свойство → поле модели»;',
    '   поля — из `*_KEYS` в `app/src/io/umljson.js`, поэтому выдумать поле нельзя:',
    '   неизвестный путь валит сборку.',
    '5. **Тип.** `oclIsKindOf` / `oclIsTypeOf` / `oclAsType` требуют не поля, а вида.',
    '   Метакласс покрыт, если у какого-нибудь вида он есть в цепочке предков',
    '   (вид `class` → `Class` → `Classifier`), поэтому `oclAsType(Classifier)` покрыт,',
    '   а `oclIsKindOf(ConsiderIgnoreFragment)` — нет: такого вида нет и подтипов у него нет.',
    '6. **Причина.** Ручные причины отброса заморожены в',
    '   [`legacy-reasons.json`](../material/rules-coverage/legacy-reasons.json). Для каждой',
    '   названо, отсутствие какого вида или поля она утверждает; вердикт ставится по факту',
    '   наличия. Причина не сверяется с текстом «на глаз».',
    '',
    '### Сверка со счётом, сделанным до этого аудита',
    '',
    'Прежний счёт: 449 констрейнтов, 70 на покрытых метаклассах, 379 на',
    'непокрытых, 58 отброшенных на покрытых, из них 29 с устаревшей причиной.',
    'Строгий столбец ниже считает так же — по буквальному совпадению имени метакласса',
    'с `APPLICABILITY` — и воспроизводит три первых числа: 449, 70 и 379. Второй',
    'столбец — нынешний каталог `KIND_METACLASS`; он покрывает больше метаклассов,',
    'поэтому расходятся не только вердикты, но и сами множества.',
    '',
    '| Показатель | Строгое совпадение имён | По каталогу `KIND_METACLASS` |',
    '| --- | ---: | ---: |',
    `| Констрейнтов на метаклассах, у которых есть вид | ${strictView.onCovered} | ${normalized.onCovered} |`,
    `| Констрейнтов на метаклассах без вида | ${totals.constraints - strictView.onCovered} | ${normalized.uncovered} |`,
    `| Не исполняемых на покрытых метаклассах | ${strictView.discardedOnCovered} | ${normalized.discarded} |`,
    `| Из них причина устарела (\`stale\`) | **${strictView.stale}** | **${normalized.stale}** |`,
    `| Из них причина верна наполовину (\`partial\`) | ${strictView.partial} | ${normalized.partial} |`,
    `| Из них причина верна (\`valid\`) | ${strictView.valid} | ${normalized.valid} |`,
    `| Из них причина ничего не называет (\`vague\`) | ${strictView.vague} | ${normalized.vague} |`,
    `| Из них исторической причины нет (\`none\`) | ${strictView.none} | ${normalized.none} |`,
    '',
    `**Расхождение с прежними 29.** В прежнем списке ${strictView.priorStale}, у меня ${strictView.stale}.`,
    strictView.priorNotStale.length
      ? `В нём лишнее: ${strictView.priorNotStale.map(code).join(', ')}.`
      : 'Всё, что было в прежнем списке, осталось устаревшим и у меня — прежний список не преувеличил ни одного пункта.',
    strictView.staleNotInPrior.length ? 'Не хватало трёх, и каждая добавляется по факту:' : '',
    '',
  );
  if (strictView.staleNotInPrior.includes('Component::no_packaged_elements')) {
    push(
      '* `Component::no_packaged_elements` — причина «компонент внутри класса не является',
      '  конструкцией нашей модели» больше не верна: вложенность задаётся `ownerId`, и',
      '  правило проверяемо целиком (оно ниже, в списке проверяемого);',
    );
  }
  const slotGain = strictView.staleNotInPrior.filter((key) => key.startsWith('InstanceSpecification::'));
  if (slotGain.length) {
    push(
      `* ${slotGain.map(code).join(' и ')} — причина «слоты не являются элементом нашей модели»`,
      '  больше не верна: слоты есть (`slots` в `ELEMENT_KEYS`, `MEMBER_KEYS` для строки, слоты',
      '  рисуются в примере `app/src/model/sample.js`). Оба правила проверяемы.',
    );
  }
  push(
    '',
    '**Откуда второй столбец.** Строгий столбец считает по буквальному совпадению имени',
    'метакласса с `APPLICABILITY` — так считал прежний аудит. Второй столбец — каталог',
    '`KIND_METACLASS`: 55 метаклассов UML, которым сопоставлены все 78 видов нотации.',
    'Он покрывает больше, потому что таблица профиля — не UML: состояние в ней названо',
    '`State2`, виды `initial`, `choice`, `fork`, `decision`, `join`, `final` отсутствуют',
    'вовсе, `objectFlow` и `controlFlow` сведены к `Connector`, а метаклассов `MergeNode`,',
    '`Profile`, `Stereotype`, `Enumeration` она не называет.',
    `Отсюда +${normalized.onCovered - strictView.onCovered} констрейнтов на покрытых метаклассах, `
      + `из них +${normalized.discarded - strictView.discardedOnCovered} не исполняемых `
      + `и +${normalized.stale - strictView.stale} с устаревшей причиной.`,
    '',
  );

  push(
    '## Применимые правила',
    '',
    `| id | Пункт | Констрейнт | Уровень | Что проверяем |`,
    '| --- | --- | --- | --- | --- |',
  );
  for (const rule of rules) {
    const page = result.pages[`${rule.source.metaclass}::${rule.source.name}`];
    push(`| \`${rule.id}\` | ${rule.source.clause} (с. ${page ?? rule.source.page}) | \`${rule.source.constraint}\` | ${rule.level} | ${esc(rule.message)} |`);
  }
  push('', 'Полные тексты, OCL и подсказки — в [`rules-uml-2.5.1.json`](rules-uml-2.5.1.json).', '');

  /* --- отброшенные --- */
  const discarded = groups.filter((group) => group.items.some((item) => item.status !== 'executable'));
  const discardedCount = discarded.reduce((sum, group) => sum + group.items.filter((i) => i.status !== 'executable').length, 0);
  push(
    '## Не исполняемые констрейнты',
    '',
    `Ниже — все ${discardedCount} неисполняемых, с причиной и статусом для каждого. Группировка по метаклассу; внутри — по номеру пункта.`,
    '',
    'Колонка «причина проверена» отвечает на вопрос, не устарела ли причина:',
    '',
    '* `stale` — причина называет то, чего у нас уже нет в списке отсутствующего: вид или поле появились. Такая причина зачёркнута;',
    '* `partial` — причина верна наполовину: вид есть, конструкции нет (или наоборот);',
    '* `valid` — причина верна и сегодня;',
    '* `vague` — причина не называет ни вида, ни поля, проверить её нечем;',
    '* `none` — правило записано, но функции нет: исторической причины отброса у него нет, причина — в статусе.',
    '',
    'Колонка «чего не хватает» называет то, что мешает **сейчас**, — она может не совпадать со старой причиной. Именно поэтому старую причину не выбрасываем: она объясняет, почему раньше было нельзя.',
    '',
  );
  for (const group of discarded) {
    const rows = group.items.filter((item) => item.status !== 'executable');
    push(`### ${group.metaclass} (${rows.length})`, '');
    push('| Пункт | Констрейнт | Статус | Причина (в старой редакции) | причина проверена | чего не хватает сейчас |', '| --- | --- | --- | --- | --- | --- |');
    for (const item of rows) {
      // Для тавтологии и «вне области» список отсутствующих полей врёт: правило
      // нельзя нарушить не из-за полей. Показываем причину статуса.
      const missing = item.status === 'tautology'
        ? esc(item.reason)
        : item.status === 'out-of-scope'
          ? '— (метакласса нет ни одной фигурой или связью)'
          : item.missing.length
            ? item.missing.map((m) => code(m.property)).join(', ')
            : (item.status === 'todo' ? '— (всё есть, правило не написано или без функции)' : esc(item.reason ?? ''));
      // Устаревшая причина зачёркнута: раздел не должен утверждать то, чего
      // уже нет. Текст остаётся — он объясняет, почему раньше было нельзя.
      const reason = item.legacyReason == null
        ? '— (правило записано без функции)'
        : (item.reasonChecked === 'stale' ? `~~${esc(item.legacyReason)}~~` : esc(item.legacyReason));
      push(`| ${item.clause} (с. ${item.page ?? '—'}) | ${code(item.name)} | ${item.status} | ${reason} | ${item.reasonChecked}${item.appeared?.length ? ` (${esc(item.appeared.join(', '))})` : ''} | ${missing} |`);
    }
    push('');
  }

  /* --- что можно проверить сейчас --- */
  const todo = groups.flatMap((group) => group.items
    .filter((item) => item.status === 'todo')
    .map((item) => ({ ...item, metaclass: group.metaclass })));
  push(
    '## Что можно проверить сейчас',
    '',
    `Констрейнтов со статусом \`todo\`: **${todo.length}**. Всё нужное в модели уже есть;`,
    'часть правил записана, но без функции. Это не «потом», а следующий шаг: ни одной новой',
    'конструкции модели не требуется. Порядок и разбивка на пачки — в',
    '[`material/rules-coverage/TO-IMPLEMENT.md`](../material/rules-coverage/TO-IMPLEMENT.md).',
    '',
  );
  if (!todo.length) push('Сейчас таких нет.', '');
  else {
    push('| Метакласс | Пункт | Констрейнт | OCL | Поля, которые для этого есть |', '| --- | --- | --- | --- | --- |');
    for (const item of todo) {
      push(`| ${item.metaclass} | ${item.clause} | ${code(item.name)} | ${code(item.ocl.split('\n')[0])} | ${fieldsOf(item).map(code).join(', ') || '—'} |`);
    }
    push('');
  }

  /* --- пробелы --- */
  const missingCounter = new Map();
  for (const item of items.filter((i) => i.scope === 'in')) {
    for (const miss of item.missing) {
      if (!missingCounter.has(miss.property)) missingCounter.set(miss.property, { property: miss.property, why: miss.why, count: 0 });
      missingCounter.get(miss.property).count += 1;
    }
  }
  const noKind = groups.filter((group) => !group.kinds.length);
  push(
    '## Что наша модель выразить не может',
    '',
    'Честный список пробелов, посчитанный по данным, а не по памяти. Слева — чего нет,',
    'справа — сколько констрейнтов из-за этого отброшено.',
    '',
    '**Метаклассы без вида.** Их ' + `${noKind.length}` + '; на них приходится ' +
      `${items.filter((i) => i.scope === 'out').length}` +
      ' констрейнтов вне области. Полный перечень — в таблице «По метаклассам» в',
    '[`material/rules-coverage/report.md`](../material/rules-coverage/report.md).',
    '',
  );

  const missingRows = [...missingCounter.values()]
    .sort((a, b) => b.count - a.count || (a.property < b.property ? -1 : 1));
  const explained = missingRows.filter((row) => row.why && row.why !== 'соответствия полю нет');
  const unexplained = missingRows.length - explained.length;
  push(
    '**Поля, которых нет.** Считаны только констрейнты в области:',
    `${totals.inScope} штук. OCL называет в них`,
    `${missingRows.length} свойств, которых модель не хранит; у ${explained.length} из них`,
    'причина названа, ещё у ' + `${unexplained}` + ' — это свойства метаклассов, которых у нас нет вовсе',
    '(пины, регионы, обработчики исключений, клаузы, шаблоны).',
    '',
    '| Свойство OCL | Чего это касается | Констрейнтов |',
    '| --- | --- | ---: |',
  );
  for (const row of explained.slice(0, 40)) {
    push(`| ${code(row.property)} | ${esc(row.why)} | ${row.count} |`);
  }
  push(
    '',
    'Полный список — `missing` у каждого констрейнта в',
    '[`coverage.json`](../material/rules-coverage/coverage.json).',
    '',
  );

  push(
    '## Оговорки к применимым правилам',
    '',
    '- `generalization-compatible-kinds` (9.9.4.8 `Classifier::specialize_type`) — в стандарте правило опирается на операцию `maySpecializeType()`, тело которой задаёт совместимость метаклассов. Наша проверка — структурное приближение: обобщение допустимо между элементами одного вида. Поэтому уровень `warning`, а не `error`.',
    '- `namespace-members-distinguishable` (7.8.10.7) — стандарт различает членов с учётом сигнатур; у нас операции без параметров, поэтому возможны ложные срабатывания на перегрузке. Уровень `warning`.',
    '- `transition-same-container` (14.5.11.8) — в стандарте речь о `containingStateMachine()`; у нас контейнером выступает владелец состояний. Уровень `warning`.',
    '- `usecase-no-association-to-usecase` и `usecase-include-cycle` (18.2.5.6) — в стандарте используются `subject` и `allIncludedUseCases()`; у нас проверка сводится к структурному отношению между вариантами использования. Уровень `warning`.',
    '',
    '## Как это пересобрать',
    '',
    '```sh',
    '# 1. текстовый слой PDF (нужен только для страниц; 1 минута)',
    'pdftotext -layout reference/spec/uml-2.5.1.pdf /tmp/uml.txt',
    'node material/rules-coverage/pages.mjs /tmp/uml.txt',
    '',
    '# 2. сам аудит: coverage.json, report.md и этот файл',
    'node material/rules-coverage/build.mjs',
    '',
    '# 3. проверка, что документ не разошёлся с кодом',
    'node material/rules-coverage/build.mjs --check',
    '```',
    '',
    '`build.mjs` читает `app/src/io/umljson.js` (`*_KEYS`), `app/notation/uml.json` и',
    '`app/notation/rules/uml-2.5.1.json`, а `app/src/io/stereotypes.js` (`APPLICABILITY`) —',
    'только как дополнение к `KIND_METACLASS`. Появление поля меняет счёт без правки',
    'скрипта; новый вид нужно назвать в `KIND_METACLASS` — иначе сборка упадёт и скажет,',
    'какого вида не хватает. Ручные причины отброса заморожены в',
    '[`material/rules-coverage/legacy-reasons.json`](../material/rules-coverage/legacy-reasons.json):',
    'это исторический факт, а не вывод.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

/* ─────────────────────────────────────────────────────── запуск */

function build() {
  const ru = parseConstraints(FILES.specRu, /^Ограничения$/);
  const en = parseConstraints(FILES.specEn, /^Constraints$/);
  const enByKey = new Map(en.map((c) => [`${c.metaclass}::${c.name}`, c]));

  // Английский оригинал — сверка: в переводе два блока OCL обрезаны.
  for (const c of ru) {
    const original = enByKey.get(`${c.metaclass}::${c.name}`);
    if (original && original.ocl.length > c.ocl.length) {
      c.ocl = original.ocl;
      c.oclSource = 'en';
    } else {
      c.oclSource = 'ru';
    }
  }

  const applicability = parseApplicability(read(FILES.stereotypes));
  const model = parseModelFields(read(FILES.umljson));
  assertNoPhantomAbsence(model);
  const { paths, scopes } = model;
  const notation = readJson(FILES.notation);
  const rules = readJson(FILES.rules);
  const legacy = readJson(FILES.legacy).reasons;
  const pages = readJson(FILES.pages).pages;

  const shapeKinds = new Set(Object.keys(notation.shapes));
  const kinds = new Set([...Object.keys(notation.shapes), ...Object.keys(notation.connectors)]);

  // Все виды нотации ключами таблицы: `фигура:class`, `связь:merge`. Вид
  // `merge` есть и среди фигур, и среди связей, и это разные метаклассы.
  const notationKeys = new Set([
    ...Object.keys(notation.shapes).map((k) => `фигура:${k}`),
    ...Object.keys(notation.connectors).map((k) => `связь:${k}`),
  ]);

  // Какой метакласс UML покрыт каким видом: объединение цепочек предков по
  // всем видам нотации.
  const coveredTypes = new Set();
  for (const key of notationKeys) {
    const metaclass = KIND_METACLASS[key];
    if (!metaclass) continue;
    for (const ancestor of metaclassChain(metaclass)) coveredTypes.add(ancestor);
  }
  const unknownKinds = [...notationKeys].filter((k) => !KIND_METACLASS[k]).sort();

  // Вид → метакласс. Основной источник — `KIND_METACLASS`: это наш собственный
  // выбор «вид нотации → метакласс UML», и он покрывает все виды нотации.
  // `APPLICABILITY` — таблица Visual Paradigm, а не UML (`state` там `State2`,
  // `note` — `NOTE`, а `initial`, `fork`, `decision` отсутствуют вовсе), поэтому
  // она годится только как дополнение: для видов, которых в `KIND_METACLASS`
  // нет. Сейчас таких нет, но правило общее, а не отключённое.
  const metaclassToKinds = new Map();
  const addKind = (metaclass, kind) => {
    if (!metaclassToKinds.has(metaclass)) metaclassToKinds.set(metaclass, new Set());
    metaclassToKinds.get(metaclass).add(kind);
  };
  const kindsInTable = new Set();
  for (const space of ['фигура', 'связь']) {
    const list = space === 'фигура' ? notation.shapes : notation.connectors;
    for (const kind of Object.keys(list).sort()) {
      const metaclass = KIND_METACLASS[`${space}:${kind}`];
      if (!metaclass) continue;
      addKind(metaclass, kind);
      kindsInTable.add(kind);
    }
  }
  for (const [kind, metas] of Object.entries(applicability)) {
    if (!kinds.has(kind) || kindsInTable.has(kind)) continue;
    for (const raw of metas) addKind(METACLASS_ALIAS[raw] ?? raw, kind);
  }

  // Сторож против молчаливого расхождения таблицы с нотацией. Ловит три вида
  // опечатки в одной строке: ключ указывает на вид, которого в
  // `app/notation/uml.json` нет; метакласс назван, но не получил ни одного вида;
  // метакласс назван так, что такого метакласса UML нет вовсе (`ForkNodeX`) —
  // тогда он молча получил бы вид, а настоящий `ForkNode` остался бы без вида.
  // Вид, которого нет ни в таблице, ни в `APPLICABILITY`, выпал бы так же.
  const knownMetaclasses = new Set([...Object.keys(SUPERCLASS), ...Object.values(SUPERCLASS)]);
  const kindlessMetaclasses = [...new Set(Object.values(KIND_METACLASS))]
    .filter((metaclass) => !metaclassToKinds.has(metaclass))
    .sort();
  const staleTableKeys = Object.keys(KIND_METACLASS)
    .filter((key) => !notationKeys.has(key))
    .sort();
  const unknownMetaclasses = [...new Set(Object.values(KIND_METACLASS))]
    .filter((metaclass) => !knownMetaclasses.has(metaclass))
    .sort();
  const unhandledKinds = unknownKinds.filter((key) => !applicability[key.split(':')[1]]);
  if (kindlessMetaclasses.length || staleTableKeys.length || unknownMetaclasses.length || unhandledKinds.length) {
    throw new Error(
      'KIND_METACLASS разошлась с нотацией: '
      + (staleTableKeys.length ? `ключи ${staleTableKeys.join(', ')} указывают на виды, которых нет в app/notation/uml.json; ` : '')
      + (unknownMetaclasses.length ? `в SUPERCLASS не найдены: ${unknownMetaclasses.join(', ')} — это не метаклассы UML или опечатка; ` : '')
      + (kindlessMetaclasses.length ? `без единого вида остались: ${kindlessMetaclasses.join(', ')}; ` : '')
      + (unhandledKinds.length ? `ни в таблице, ни в APPLICABILITY не названы виды: ${unhandledKinds.join(', ')}; ` : '')
      + 'сверьте KIND_METACLASS с нотацией.',
    );
  }

  const applicabilityValues = new Set(Object.values(applicability).flat());
  const rulesByKey = new Map(rules.map((r) => [`${r.source.metaclass}::${r.source.name}`, r]));
  const checks = parseChecks(read(FILES.registry));
  const ctx = {
    paths,
    scopes,
    containers: model.containers,
    scopesFor: (metaclass) => {
      const out = new Set();
      for (const kind of metaclassToKinds.get(metaclass) ?? []) {
        out.add(shapeKinds.has(kind) ? 'element' : 'connector');
      }
      return out;
    },
    kinds,
    coveredTypes,
    unknownKinds,
    pages,
    rulesByKey,
    checks,
    kindsFor: (metaclass) => [...(metaclassToKinds.get(metaclass) ?? [])].sort(),
  };

  const byMetaclass = new Map();
  for (const constraint of ru) {
    const item = classify(constraint, ctx);
    if (!byMetaclass.has(constraint.metaclass)) {
      byMetaclass.set(constraint.metaclass, {
        metaclass: constraint.metaclass,
        clause: constraint.clause,
        metaclassClause: constraint.metaclassClause,
        kinds: ctx.kindsFor(constraint.metaclass),
        items: [],
      });
    }
    byMetaclass.get(constraint.metaclass).items.push(item);
  }
  const groups = [...byMetaclass.values()].sort((a, b) => (a.metaclass < b.metaclass ? -1 : a.metaclass > b.metaclass ? 1 : 0));
  for (const group of groups) {
    group.items.sort((a, b) => {
      const ka = `${a.clause}::${a.name}`;
      const kb = `${b.clause}::${b.name}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  for (const group of groups) {
    for (const item of group.items) {
      if (item.status === 'executable') continue;
      const key = `${group.metaclass}::${item.name}`;
      const manual = legacy[key];
      // У правил, записанных без функции, исторической причины отброса нет:
      // они никогда не были «отброшены». Их причина — в самом статусе
      // (тавтология схемы / очередь / отсутствующее поле).
      if (!manual) {
        item.legacyReason = null;
        item.reasonChecked = 'none';
        item.reasonNote = 'правило записано, функции нет — исторической причины отброса нет';
        item.appeared = [];
        continue;
      }
      const verdict = judgeReason(manual.reason, { kinds, paths });
      item.legacyReason = manual.reason;
      item.reasonChecked = verdict.verdict;
      item.reasonNote = verdict.note;
      item.appeared = verdict.appeared;
    }
  }

  const items = groups.flatMap((group) => group.items);
  assertNoPhantomGap(items, model);
  assertManualTables(items, (key) => {
    const rule = rulesByKey.get(key);
    return Boolean(rule && checks.has(rule.check));
  });

  // Строгий вариант: метакласс покрыт, только если он буквально назван в
  // APPLICABILITY. Нужен для сверки с прежним счётом; документ строится по
  // нормализованному.
  const strictGroups = groups.filter((group) => applicabilityValues.has(group.metaclass));
  const strictDiscarded = strictGroups.flatMap((group) => group.items
    .filter((item) => item.status !== 'executable')
    .map((item) => ({ key: `${group.metaclass}::${item.name}`, verdict: item.reasonChecked })));
  const strictStale = strictDiscarded.filter((row) => row.verdict === 'stale').map((row) => row.key).sort();
  const priorStale = [...PRIOR_CLAIM.staleNames].sort();
  const strictView = {
    onCovered: strictGroups.reduce((sum, group) => sum + group.items.length, 0),
    discardedOnCovered: strictDiscarded.length,
    stale: strictStale.length,
    partial: strictDiscarded.filter((row) => row.verdict === 'partial').length,
    valid: strictDiscarded.filter((row) => row.verdict === 'valid').length,
    vague: strictDiscarded.filter((row) => row.verdict === 'vague').length,
    none: strictDiscarded.filter((row) => row.verdict === 'none').length,
    staleNotInPrior: strictStale.filter((key) => !priorStale.includes(key)),
    priorNotStale: priorStale.filter((key) => !strictStale.includes(key)),
    priorStale: priorStale.length,
  };
  // В очередь TO-IMPLEMENT попадают только констрейнты, у которых нет
  // записанного правила: записанное правило — уже не «что добавить в набор»,
  // ему нужна функция, а не строка в наборе.
  const queueNames = items.filter((i) => i.status === 'todo' && !i.ruleId).map((i) => i.name);
  const toImplement = fs.existsSync(FILES.toImplement) ? read(FILES.toImplement) : '';
  const missingInToImplement = queueNames.filter((name) => !new RegExp(`\`${name}\``).test(toImplement));

  const countStatus = (status) => items.filter((i) => i.status === status).length;
  const totals = {
    constraints: items.length,
    inScope: items.filter((i) => i.scope === 'in').length,
    outOfScope: items.filter((i) => i.scope === 'out').length,
    executable: countStatus('executable'),
    todo: countStatus('todo'),
    tautology: countStatus('tautology'),
    gap: countStatus('gap'),
    noOcl: countStatus('no-ocl'),
    rulesWritten: rules.length,
    metaclasses: groups.length,
    metaclassesCovered: groups.filter((g) => g.kinds.length).length,
    metaclassesUncovered: groups.filter((g) => !g.kinds.length).length,
    staleReasons: items.filter((i) => i.reasonChecked === 'stale').length,
    partialReasons: items.filter((i) => i.reasonChecked === 'partial').length,
    vagueReasons: items.filter((i) => i.reasonChecked === 'vague').length,
  };
  assertTotals(totals);

  return { ru, items, groups, totals, rules, pages, kinds, applicabilityValues, strictView, missingInToImplement };
}

/**
 * Сумма статусов обязана сходиться с числом констрейнтов, а область — с 449.
 *
 * Это не украшение отчёта: шесть статусов вводятся ровно для того, чтобы
 * «не проверяемо» перестало быть мешком, в который складывают всё подряд.
 * Если сумма не сходится, значит классификатор потерял ветку, и `--check`
 * обязан упасть, а не напечатать красивое число.
 *
 * @param {object} totals счётчики сборки
 */
function assertTotals(totals) {
  const sum = totals.executable + totals.todo + totals.tautology + totals.gap
    + totals.noOcl + totals.outOfScope;
  if (sum !== totals.constraints) {
    throw new Error(`сумма статусов ${sum} ≠ числу констрейнтов ${totals.constraints}: классификатор потерял ветку`);
  }
  if (totals.inScope + totals.outOfScope !== totals.constraints) {
    throw new Error(`в области ${totals.inScope} + вне ${totals.outOfScope} ≠ ${totals.constraints}`);
  }
  if (totals.executable > totals.rulesWritten) {
    throw new Error(`исполняется ${totals.executable} > записано ${totals.rulesWritten}: у исполняемого нет правила`);
  }
}

/**
 * Ручные таблицы не имеют права разойтись с данными.
 *
 * `TAUTOLOGY` и `NO_CONSTRUCT_CONSTRAINT` — единственные места, где статус
 * ставится человеком. Опечатка в ключе молча не сработала бы: констрейнт
 * остался бы `todo`, а таблица врала бы. Поэтому ключ обязан найтись, а
 * правило из таблицы — не иметь функции (иначе два ответа на один вопрос).
 *
 * @param {Array<object>} items записи coverage.json
 * @param {(key: string) => boolean} hasFunction есть ли у констрейнта функция
 */
function assertManualTables(items, hasFunction) {
  const byKey = new Map(items.map((item) => [`${item.metaclass}::${item.name}`, item]));
  for (const [table, rows] of [['TAUTOLOGY', TAUTOLOGY], ['NO_CONSTRUCT_CONSTRAINT', NO_CONSTRUCT_CONSTRAINT]]) {
    for (const key of Object.keys(rows)) {
      if (!byKey.has(key)) throw new Error(`${table}: ключа «${key}» нет среди констрейнтов — опечатка в таблице`);
      // Проверяется наличие функции, а не выведенный статус: статус таблица и
      // подменяет, поэтому по нему противоречие не поймать.
      if (hasFunction(key)) {
        throw new Error(`${table}: «${key}» записан исполняемым — таблица и реестр проверок противоречат друг другу`);
      }
    }
  }
}

function main() {
  const check = process.argv.includes('--check');
  const result = build();
  const outputs = [
    [FILES.coverage, coverageJson(result)],
    [FILES.report, reportMd(result)],
    [FILES.source, sourceMd(result)],
    [FILES.rulesCoverage, coverageDocMd(result)],
    [FILES.rulesTests, rulesTestsMd(result)],
  ];

  if (check && result.missingInToImplement.length) {
    console.error('TO-IMPLEMENT.md отстал от данных: в нём нет констрейнтов, которые уже можно проверить:');
    for (const name of result.missingInToImplement) console.error(`  ${name}`);
    console.error('\nдопишите их пачкой в material/rules-coverage/TO-IMPLEMENT.md');
    process.exit(1);
  }

  if (check) {
    const problems = [];
    for (const [file, expected] of outputs) {
      const actual = fs.existsSync(file) ? read(file) : null;
      if (actual === expected) continue;
      problems.push(describeDifference(file, actual, expected));
    }
    if (problems.length) {
      console.error('устарело:\n');
      for (const problem of problems) console.error(`${problem}\n`);
      console.error('пересоберите: node material/rules-coverage/build.mjs');
      process.exit(1);
    }
    console.log('coverage.json, report.md, docs/RULES-SOURCE.md, docs/RULES-COVERAGE.md и сводка в docs/RULES-TESTS.md соответствуют входу');
    return;
  }

  for (const [file, text] of outputs) fs.writeFileSync(file, text);
  console.log(`констрейнтов: ${result.totals.constraints}; в области: ${result.totals.inScope}, вне: ${result.totals.outOfScope}`);
  console.log(`правил записано: ${result.totals.rulesWritten}, исполняется: ${result.totals.executable}`);
  console.log(`статусы: executable ${result.totals.executable}, todo ${result.totals.todo}, tautology ${result.totals.tautology}, `
    + `gap ${result.totals.gap}, no-ocl ${result.totals.noOcl}, out-of-scope ${result.totals.outOfScope}`);
  console.log(`метаклассов с видом: ${result.totals.metaclassesCovered}, без вида: ${result.totals.metaclassesUncovered}`);
  console.log(`устаревших причин: ${result.totals.staleReasons}, частично неверных: ${result.totals.partialReasons}`);
}

/** Внятное сообщение о расхождении: где и что именно. */
function describeDifference(file, actual, expected) {
  const rel = path.relative(ROOT, file);
  if (actual == null) return `${rel}: файла нет, ожидался сгенерированный`;
  if (file === FILES.coverage) {
    try {
      const was = JSON.parse(actual);
      const want = JSON.parse(expected);
      const flatten = (doc) => {
        const map = new Map();
        for (const group of doc.byMetaclass ?? []) for (const item of group.items ?? []) map.set(`${group.metaclass}::${item.name}`, item);
        return map;
      };
      const have = flatten(was);
      const need = flatten(want);
      const lines = [];
      for (const [key, item] of need) {
        if (!have.has(key)) lines.push(`  ${key}: записи нет, ожидалось состояние ${item.status}`);
        else if (have.get(key).status !== item.status) lines.push(`  ${key}: состояние ${have.get(key).status}, ожидалось ${item.status}`);
        else if (have.get(key).scope !== item.scope) lines.push(`  ${key}: область ${have.get(key).scope}, ожидалась ${item.scope}`);
      }
      for (const key of have.keys()) if (!need.has(key)) lines.push(`  ${key}: лишняя запись, такого констрейнта нет`);
      for (const field of ['constraints', 'inScope', 'outOfScope', 'executable', 'todo', 'tautology', 'gap', 'noOcl', 'rulesWritten']) {
        if (was.totals?.[field] !== want.totals?.[field]) {
          lines.push(`  totals.${field}: ${was.totals?.[field]}, ожидалось ${want.totals?.[field]}`);
        }
      }
      const inputDrift = Object.keys(want.inputs ?? {}).filter((file) => was.inputs?.[file] !== want.inputs?.[file]);
      if (inputDrift.length) {
        lines.unshift(...inputDrift.map((file) => `  вход изменился: ${file}`));
      }
      if (lines.length) return `${rel}: расходится с данными\n${lines.slice(0, 12).join('\n')}${lines.length > 12 ? `\n  … ещё ${lines.length - 12}` : ''}`;
      return `${rel}: данные те же, отличаются байты (порядок или форматирование)`;
    } catch (error) {
      return `${rel}: не разбирается как JSON — ${error.message}`;
    }
  }
  const was = actual.split('\n');
  const want = expected.split('\n');
  for (let i = 0; i < Math.max(was.length, want.length); i += 1) {
    if (was[i] !== want[i]) {
      return `${rel}: первое расхождение в строке ${i + 1}\n  было: ${(was[i] ?? '(конца файла нет)').slice(0, 200)}\n  надо: ${(want[i] ?? '(конца файла нет)').slice(0, 200)}`;
    }
  }
  return `${rel}: отличается`;
}

main();
