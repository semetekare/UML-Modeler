// Прототип движка правил UML 2.5.1 поверх `uml-model/3`.
//
// Каждая проверка написана по дословному тексту констрейнта из
// `docs/rules-uml-2.5.1.json` (поле `source.text`) и его OCL (`source.ocl`), а
// не по тому, что удобно посчитать. Где стандарт допускает толкование, в
// комментарии к проверке сказано, какое толкование выбрано и почему.
//
// Что доказывает прогон:
//   * фикстура `<правило>.json` нарушает ровно своё правило и ничего больше;
//   * `<правило>.ok.json` — та же модель без нарушения — не нарушает ничего;
//   * все фикстуры читаются `deserialize` без замечаний и пересохраняются
//     байт в байт (то есть они канонические, а не «примерно такие»);
//   * 48 моделей корпуса (`tests/corpus/`) не дают ни одного замечания — иначе
//     движок просто красит всё подряд;
//   * для правил, которые в текущей схеме не выразить, печатается причина.
//
//   node tests/rules/check.mjs
//   node tests/rules/check.mjs --verbose   печатать каждое замечание
//
// Код возврата 0 — всё сошлось; 1 — есть падения (они перечислены).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => { if (VERBOSE) console.log('      ', ...a); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

/* ------------------------------------------------- загрузка приложения */

// Приложение грузит нотацию по HTTP (`loadNotation`); здесь пакет берётся с
// диска и применяется тем же `applyPackage`, что и в браузере, — иначе
// `deserialize` не знает ни одного вида элемента.
const { applyPackage } = await import(pathToFileURL(path.join(ROOT, 'app/src/model/notation.js')).href);
applyPackage(JSON.parse(await readFile(path.join(ROOT, 'app/notation/uml.json'), 'utf8')));
const { deserialize, serialize } = await import(pathToFileURL(path.join(ROOT, 'app/src/io/umljson.js')).href);
const { aggregationOf, MEMBER_FIELDS } = await import(pathToFileURL(path.join(ROOT, 'app/src/model/model.js')).href);

const RULES = JSON.parse(await readFile(path.join(ROOT, 'docs/rules-uml-2.5.1.json'), 'utf8'));
const ruleById = (id) => RULES.find((r) => r.id === id) ?? null;

/* ------------------------------------------------------------ утилиты */

const elementById = (m, id) => m.elements.find((e) => e.id === id) ?? null;
const finding = (subject, detail) => ({ subject, detail });
const ASSOCIATION_KINDS = new Set(['association', 'aggregation', 'composition']);

/**
 * Вид элемента нотации → его метакласс UML 2.5.1. Нужен там, где констрейнт
 * спрашивает `oclIsKindOf` (обобщение, цели ассоциаций актёра). Виды, которых
 * в таблице нет (пакет, состояние, объект, заметка…), — не классификаторы;
 * проверки, которым нужен метакласс, такие концы пропускают: типизация
 * метамодели — отдельный разговор, и выдумывать за неё вердикт нельзя.
 */
const METACLASS = {
  class: 'Class',
  component: 'Component',
  node: 'Node',
  device: 'Device',
  executionEnvironment: 'ExecutionEnvironment',
  artifact: 'Artifact',
  interface: 'Interface',
  enumeration: 'Enumeration',
  datatype: 'DataType',
  stereotype: 'Stereotype',
  metaclass: 'Class',
  actor: 'Actor',
  usecase: 'UseCase',
  collaboration: 'BehavioredClassifier',
  activity: 'Activity',
  interaction: 'Interaction',
  state: null,
  package: null,
  model: null,
  profile: null,
  object: null,
  note: null,
};

/** Родители метакласса (UML 2.5.1, разделы 9, 10, 11, 12, 13, 18). */
const SUPERCLASS = {
  Class: 'Classifier',
  Component: 'Class',
  Node: 'Class',
  Device: 'Node',
  ExecutionEnvironment: 'Node',
  Artifact: 'Classifier',
  Interface: 'Classifier',
  Enumeration: 'DataType',
  DataType: 'Classifier',
  Stereotype: 'Class',
  Actor: 'BehavioredClassifier',
  UseCase: 'BehavioredClassifier',
  BehavioredClassifier: 'Classifier',
  Activity: 'Behavior',
  Interaction: 'Behavior',
  Behavior: 'Class',
  Classifier: null,
};

/** Метаклассы вида и все его предки; null — вид не классификатор. */
function metaclassesOf(kind) {
  const own = METACLASS[kind] ?? null;
  if (!own) return null;
  const chain = [];
  for (let c = own; c; c = SUPERCLASS[c] ?? null) chain.push(c);
  return chain;
}

/**
 * Разобрать кратность, записанную строкой (`n`, `a..b`, `*`, `a..*`), в те
 * числа, которые вернули бы запросы `lowerBound()` и `upperBound()`:
 * `lower` — `integerValue` нижней границы, `upper` — `unlimitedValue` верхней
 * (`Infinity` для «*»). Если значения нет или оно не того вида, запрос по
 * 7.8.8.7 возвращает 1 — так и считаем; `lowerLiteral`/`upperLiteral` говорят,
 * было ли значение настоящим литералом нужного вида, и по ним работают
 * `lower_is_integer` и `upper_is_unlimitedNatural`.
 *
 * Толкование: пустая строка — кратности нет вовсе (`lowerValue` и `upperValue`
 * пусты), а строка без единой цифры (и не «*») кратностью не является. Корпус
 * пособия пишет в это поле «не названо в тексте» — пометку «в тексте не
 * сказано», а не значение; правила кратности такую пометку не судят.
 */
function parseRange(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (s === '*') return { text: s, lower: 0, upper: Infinity, lowerLiteral: true, upperLiteral: true };  // «*» = 0..*
  if (!/\d/.test(s)) return null;                                   // не запись кратности
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

/** Концы связей, у которых вообще есть кратность (association/aggregation/composition). */
function multiplicityEnds(m) {
  const out = [];
  for (const rel of m.relationships) {
    for (const end of ['from', 'to']) {
      const text = rel[end === 'from' ? 'fromMultiplicity' : 'toMultiplicity'];
      if (text === undefined) continue;      // у этой связи кратностей в модели нет
      const range = parseRange(text);
      if (!range) continue;                  // кратность не задана — правило не применяется
      out.push({ rel, end, text, range });
    }
  }
  return out;
}

/** Нарушения, общие для четырёх правил кратности: одно правило — один предикат. */
function multiplicityRule(predicate) {
  return (m) => multiplicityEnds(m)
    .map((end) => ({ ...end, detail: predicate(end) }))
    .filter((end) => end.detail)
    .map((end) => finding(end.rel.id, `${end.end === 'from' ? 'конец «from»' : 'конец «to»'}: ${end.detail}`));
}

/**
 * Обобщение в модели направлено от частного к общему: `from` — specific,
 * `to` — general (так же, как в корпусе и в `sample.js`).
 */
const generalizations = (m) => m.relationships.filter((r) => r.kind === 'generalization');
const parentsOf = (m, id) => generalizations(m).filter((r) => r.from === id).map((r) => r.to);

/** Транзитивное замыкание предков (OCL: `allParents()`). */
function allParents(m, id) {
  const seen = new Set();
  const walk = (from) => {
    for (const p of parentsOf(m, from)) {
      if (seen.has(p)) continue;
      seen.add(p);
      walk(p);
    }
  };
  walk(id);
  return seen;
}

/* -------------------------------------------------------- сами правила */

/**
 * Проверки. Ключ — `id` правила из `docs/rules-uml-2.5.1.json`; значение —
 * функция (модель) → массив замечаний { subject, detail }. `subject` — id
 * элемента или связи, чтобы движок мог подсветить виновника.
 */
const CHECKS = {
  /* 7.8.8.8 — четыре правила кратности.
   *
   * Границы берутся такими, какими их отдают запросы 7.8.8.7: `lowerBound()`
   * и `upperBound()` возвращают значение литерала, а если его нет или оно не
   * того вида — 1. Поэтому «1..1.5» нарушает только `upper_is_unlimitedNatural`
   * (верхняя граница не UnlimitedNatural), а сравнение границ на нём сходится:
   * 1 >= 1. Одна опечатка — одно правило, и фикстуры остаются минимальными.
   */
  'mult-upper-ge-lower': multiplicityRule(({ text, range }) => {
    if (range.upper >= range.lower) return null;
    return `кратность «${text}»: верхняя граница ${range.upper} меньше нижней ${range.lower}`;
  }),

  'mult-lower-non-negative': multiplicityRule(({ text, range }) => {
    if (range.lower >= 0) return null;
    return `кратность «${text}»: нижняя граница ${range.lower} отрицательна`;
  }),

  'mult-lower-is-integer': multiplicityRule(({ text, range }) => {
    if (range.lowerLiteral) return null;
    return `кратность «${text}»: нижняя граница не целочисленный литерал`;
  }),

  'mult-upper-is-unlimited-natural': multiplicityRule(({ text, range }) => {
    if (range.upperLiteral) return null;
    return `кратность «${text}»: верхняя граница не целое число и не «*»`;
  }),

  /* 7.8.10.7 — `members_distinguishable`.
   *
   * OCL: `member->forAll(memb | member->excluding(memb)->forAll(other |
   * memb.isDistinguishableFrom(other, self)))`, а `isDistinguishableFrom`
   * (7.8.9) различает два члена по метаклассу и имени:
   * `(self.oclIsKindOf(n.oclType()) or n.oclIsKindOf(self.oclType())) implies
   *  getNamesOfMember(self)->intersection(getNamesOfMember(n))->isEmpty()`.
   *
   * Толкование: пространство имён — сам элемент (вложенности элементов в
   * `uml-model/3` нет), а «метакласс» члена — его полка: два атрибута — это
   * два Property, атрибут и операция — Property и Operation, они различимы
   * по метаклассу при любых именах. Поэтому дубли ищутся внутри одной полки.
   * Сигнатура операции хранится в её `name` (`updateStudent(st:Student)`),
   * так что перегрузка «одно имя, разные параметры» даёт разные имена и
   * различима — ровно как требует BehavioralFeature::isDistinguishableFrom.
   */
  'namespace-members-distinguishable': (m) => {
    const kinds = ruleById('namespace-members-distinguishable').appliesTo.element;
    const out = [];
    for (const el of m.elements) {
      if (!kinds.includes(el.kind)) continue;
      for (const field of MEMBER_FIELDS) {
        const rows = Array.isArray(el[field]) ? el[field] : [];
        const seen = new Map();
        for (const row of rows) {
          const name = String(row?.name ?? '');
          if (seen.has(name)) {
            out.push(finding(el.id, `«${el.name}», полка ${field}: два члена с именем «${name}»`));
          } else seen.set(name, true);
        }
      }
    }
    return out;
  },

  /* 9.9.4.8 — `specialize_type`: `parents()->forAll(c | self.maySpecializeType(c))`,
   * тело `maySpecializeType`: `self.oclIsKindOf(c.oclType())` — частный вид
   * должен быть видом метакласса общего. Виды вне таблицы метаклассов
   * пропускаются (см. комментарий к METACLASS).
   */
  'generalization-compatible-kinds': (m) => {
    const out = [];
    for (const rel of generalizations(m)) {
      const specific = elementById(m, rel.from);
      const general = elementById(m, rel.to);
      if (!specific || !general) continue;
      const specificKinds = metaclassesOf(specific.kind);
      const generalKinds = metaclassesOf(general.kind);
      if (!specificKinds || !generalKinds) continue;
      if (specificKinds.includes(generalKinds[0])) continue;
      out.push(finding(rel.id,
        `«${specific.name}» (${specific.kind}) обобщает «${general.name}» (${general.kind}): `
        + `${generalKinds[0]} не является видом ${specificKinds[0]}`));
    }
    return out;
  },

  /* 9.9.4.8 — `no_cycles_in_generalization`: `not allParents()->includes(self)`. */
  'generalization-cycle': (m) => {
    const out = [];
    for (const el of m.elements) {
      if (!parentsOf(m, el.id).length) continue;
      if (!allParents(m, el.id).has(el.id)) continue;
      out.push(finding(el.id, `«${el.name}» входит в собственные предки`));
    }
    return out;
  },

  /* 9.9.17.8 — `multiplicity_of_composite`: «A multiplicity on the composing
   * end of a composite aggregation must not have an upper bound greater than 1.»
   *
   * Толкование: констрейнт применяется к тому концу, который помечен
   * `isComposite` (ромб), — это конец `from` у вида «Композиция» (и `from`,
   * и `to` берутся через `aggregationOf`, чтобы явное поле и умолчание вида
   * связи читались одинаково).
   *
   * Расхождение в самом стандарте: OCL рядом с этой фразой говорит
   * `opposite.upperBound() <= 1`, то есть про ПРОТИВОПОЛОЖНЫЙ конец. Буквальное
   * чтение OCL запретило бы обычную композицию «1 ◆—— 0..*», где у части
   * верхняя граница как раз больше 1, — поэтому прозе верим больше, чем OCL,
   * и проверяем конец с ромбом.
   */
  'composite-upper-bound-le-1': (m) => {
    const out = [];
    for (const rel of m.relationships) {
      if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
      for (const end of ['from', 'to']) {
        if (aggregationOf(rel, end) !== 'composite') continue;
        const text = rel[end === 'from' ? 'fromMultiplicity' : 'toMultiplicity'];
        const range = parseRange(text);
        if (!range || range.upper <= 1) continue;
        out.push(finding(rel.id,
          `конец «${end}» с ромбом композиции имеет кратность «${range.text}»: `
          + `верхняя граница ${range.upper === Infinity ? '∞' : range.upper} > 1`));
      }
    }
    return out;
  },

  /* 10.5.5.5 — `Interface::visibility`: `feature->forAll(visibility = public)`.
   * Члены интерфейса — его полки `attributes` и `operations`; отсутствие `vis`
   * в строке члена означает public (так его читает `readMembers`). */
  'interface-feature-visibility-public': (m) => {
    const out = [];
    for (const el of m.elements) {
      if (el.kind !== 'interface') continue;
      for (const field of ['attributes', 'operations']) {
        for (const row of (Array.isArray(el[field]) ? el[field] : [])) {
          const vis = row?.vis ?? 'public';
          if (vis === 'public') continue;
          out.push(finding(el.id, `«${el.name}», член «${row?.name ?? ''}»: видимость ${vis}`));
        }
      }
    }
    return out;
  },

  /* 11.8.1.8 — `binary_associations`:
   * `memberEnd->exists(aggregation <> none) implies (memberEnd->size() = 2 and
   *  memberEnd->exists(aggregation = none))`.
   *
   * В `uml-model/3` у связи ровно два конца (`from` и `to`), поэтому первая
   * половина посылки недостижима — небинарную ассоциацию схема не выражает.
   * Проверяется вторая половина: если агрегация стоит на обоих концах, конца
   * с `aggregation = none` нет.
   */
  'association-aggregation-binary-only': (m) => {
    const out = [];
    for (const rel of m.relationships) {
      if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
      const ends = ['from', 'to'].map((end) => ({ end, aggregation: aggregationOf(rel, end) }));
      if (!ends.some((e) => e.aggregation !== 'none')) continue;   // не агрегация вовсе
      if (ends.length !== 2 || !ends.some((e) => e.aggregation === 'none')) {
        out.push(finding(rel.id, `агрегация на обоих концах: ${ends.map((e) => `${e.end}=${e.aggregation}`).join(', ')}`));
      }
    }
    return out;
  },

  /* 18.2.1.4 — `Actor::associations`: «An Actor can only have Associations to
   * UseCases, Components, and Classes. Furthermore these Associations must be
   * binary.» OCL: `actorEnd.opposite.class.oclIsKindOf(UseCase) or
   * (oclIsKindOf(Class) and not oclIsKindOf(Behavior))`.
   *
   * Компонент — вид класса (Component → Class), поэтому OCL и проза сходятся.
   * Бинарность в схеме всегда выполнена. Виды без метакласса (пакет,
   * состояние…) пропускаются: их типизация — предмет отдельной проверки.
   */
  'actor-association-targets': (m) => {
    const out = [];
    for (const rel of m.relationships) {
      if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
      for (const [actorEnd, otherEnd] of [['from', 'to'], ['to', 'from']]) {
        const actor = elementById(m, rel[actorEnd]);
        const other = elementById(m, rel[otherEnd]);
        if (!actor || !other || actor.kind !== 'actor') continue;
        const kinds = metaclassesOf(other.kind);
        if (!kinds) continue;
        const allowed = kinds.includes('UseCase')
          || (kinds.includes('Class') && !kinds.includes('Behavior'));
        if (allowed) continue;
        out.push(finding(rel.id, `актёр «${actor.name}» связан ассоциацией с «${other.name}» (${other.kind})`));
      }
    }
    return out;
  },

  /* 18.2.1.4 — `must_have_name`: `name->notEmpty()`. */
  'actor-must-have-name': (m) => m.elements
    .filter((e) => e.kind === 'actor' && !String(e.name ?? '').trim())
    .map((e) => finding(e.id, 'у актёра пустое имя')),

  /* 18.2.5.6 — `no_association_to_use_case`:
   * `usecases->size() > 1 implies usecases->collect(subject)->size() > 1`.
   *
   * Толкование: поля `subject` в `uml-model/3` нет (это `Classifier::useCase`,
   * обратная сторона `UseCase::subject`), поэтому `collect(subject)` пуст и
   * `size()` даёт 0. Значит любая ассоциация между двумя вариантами
   * использования — нарушение: субъект у них один и тот же (не задан ни у
   * кого). Когда в схеме появится `subject`, здесь появится и исключение для
   * пары с разными субъектами; сейчас исключать нечего.
   */
  'usecase-no-association-to-usecase': (m) => {
    const out = [];
    for (const rel of m.relationships) {
      if (!ASSOCIATION_KINDS.has(rel.kind)) continue;
      const usecases = ['from', 'to']
        .map((end) => elementById(m, rel[end]))
        .filter((el) => el && el.kind === 'usecase');
      if (usecases.length <= 1) continue;
      out.push(finding(rel.id,
        `ассоциация между вариантами использования ${usecases.map((u) => `«${u.name}»`).join(' и ')}: субъект один (не задан)`));
    }
    return out;
  },

  /* 18.2.5.6 — `cannot_include_self`: `not allIncludedUseCases()->includes(self)`.
   * Включение — связь `include` от включающего (`from`) к включаемому (`to`). */
  'usecase-include-cycle': (m) => {
    const includes = m.relationships.filter((r) => r.kind === 'include');
    const includedOf = (id) => includes.filter((r) => r.from === id).map((r) => r.to);
    const allIncluded = (id) => {
      const seen = new Set();
      const walk = (from) => {
        for (const next of includedOf(from)) {
          if (seen.has(next)) continue;
          seen.add(next);
          walk(next);
        }
      };
      walk(id);
      return seen;
    };
    const out = [];
    for (const el of m.elements) {
      if (el.kind !== 'usecase') continue;
      if (!includedOf(el.id).length) continue;
      if (!allIncluded(el.id).has(el.id)) continue;
      out.push(finding(el.id, `«${el.name}» прямо или косвенно включает сам себя`));
    }
    return out;
  },

  /* 18.2.5.6 — `must_have_name`: `name -> notEmpty ()`. */
  'usecase-must-have-name': (m) => m.elements
    .filter((e) => e.kind === 'usecase' && !String(e.name ?? '').trim())
    .map((e) => finding(e.id, 'у варианта использования пустое имя')),

  /* 12.4.9.6 — `Stereotype::generalize`:
   * `allParents()->forAll(oclIsKindOf(Stereotype)) and
   *  Classifier.allInstances()->forAll(c | c.allParents()->exists(oclIsKindOf(Stereotype))
   *  implies c.oclIsKindOf(Stereotype))`.
   * Оба конъюнкта сводятся к одному: у обобщения, где один конец — стереотип,
   * другой обязан быть стереотипом. Стереотип здесь — ВИД элемента
   * (`kind: "stereotype"`, фигура «Стереотип»), а не прикладная метка в поле
   * `stereotype` у обычного элемента.
   */
  'stereotype-generalizes-stereotype': (m) => {
    const out = [];
    for (const rel of generalizations(m)) {
      const specific = elementById(m, rel.from);
      const general = elementById(m, rel.to);
      if (!specific || !general) continue;
      const specificIsStereotype = specific.kind === 'stereotype';
      const generalIsStereotype = general.kind === 'stereotype';
      if (specificIsStereotype === generalIsStereotype) continue;
      out.push(finding(rel.id, specificIsStereotype
        ? `стереотип «${specific.name}» обобщает «${general.name}» (${general.kind}), а это не стереотип`
        : `«${specific.name}» (${specific.kind}) обобщает стереотип «${general.name}»`));
    }
    return out;
  },
};

/* ------------------------------- правила, которых в схеме не выразить */

/**
 * Правила без фикстуры. Причина — не «не успели», а отсутствие поля в
 * `uml-model/3`; `missing` называет поле и место в плане, где оно описано
 * (сам план — в приватных заметках, в репозиторий не входит).
 */
const NOT_BUILDABLE = {
  'element-not-own-self': {
    reason: 'в схеме нет владения элементами: `elements` — плоский список, у элемента нет `ownerId`, '
      + 'поэтому пакет не может прямо или косвенно содержать сам себя',
    missing: '`ownerId` у элемента (PLAN §3.1, партия Б1)',
  },
  'association-end-typed': {
    reason: 'конец ассоциации типизирован самим фактом связи: его тип — это `from`/`to`; связи без '
      + 'элемента на конце загрузчик выбрасывает с замечанием, так что нетипизированного конца не бывает',
    missing: 'необязательный конец связи (`from`/`to` = null) — в плане он есть только для сообщений (PLAN §3.2)',
  },
  'component-no-nested-classifier': {
    reason: 'компонент не может ничего содержать: вложенность элементов в схеме не выражается',
    missing: '`ownerId` у элемента (PLAN §3.1, партия Б1)',
  },
  'package-element-visibility': {
    reason: 'нужны сразу два отсутствующих поля: владение элементом пакета и видимость самого элемента '
      + '(у элемента `uml-model/3` поля `visibility` нет вовсе — есть только у членов)',
    missing: '`ownerId` (PLAN §3.1) и видимость элемента — второго поля нет и в плане',
  },
  'stereotype-binary-association': {
    reason: 'стереотип как элемент есть (`kind: "stereotype"`), но небинарной ассоциации схема не знает: '
      + 'у связи ровно два конца `from`/`to`, поэтому `memberEnd->size() = 2` выполняется всегда',
    missing: 'список концов ассоциации (`memberEnd`) вместо пары `from`/`to`',
  },
  'transition-same-container': {
    reason: 'сравнивать нечего: у состояния нет содержащей машины состояний, у перехода — тоже; '
      + 'вложенности состояний и регионов в схеме нет',
    missing: '`regions` у состояния и `local` у перехода (PLAN §3.7, партия Б8)',
  },
  'usecase-binary-association': {
    reason: 'небинарную ассоциацию схема не выражает: у связи ровно два конца, `memberEnd->size() = 2` всегда',
    missing: 'список концов ассоциации (`memberEnd`) вместо пары `from`/`to`',
  },
};

/**
 * Второй, отдельный список: правила, которые СХЕМА выражает, но этот прототип
 * не реализует.
 *
 * Зачем отдельно от `NOT_BUILDABLE`: это разные утверждения. «Невыразимо в
 * схеме» — про данные, и оно не изменится, пока в схему не добавят поле.
 * «Не реализовано в прототипе» — про этот файл, и оно снимается работой в нём.
 * Смешать их значило бы записать в «схема не позволяет» правила, которые схема
 * прекрасно позволяет: прототип просто написан раньше их.
 *
 * Поэтому это не список, а ОДНО утверждение на все такие правила: прототип
 * заморожен, а набор правил приложения с тех пор вырос. Перечислять новые
 * правила поимённо значило бы завести второй список, который отстанет на
 * следующем же правиле — и уронил бы этот файл так же, как уронил 2026-11-07,
 * когда в наборе появилось 16 новых, а здесь их не дописали.
 *
 * Граница проведена по вопросу, на который список отвечает: «мешает схема или
 * этот файл?» Схема — поимённо (`NOT_BUILDABLE`, потому что у каждой своя
 * причина и своё недостающее поле). Этот файл — скопом, потому что причина у
 * всех одна.
 */
const PROTOTYPE_FROZEN = {
  reason: 'схема это правило выражает, но прототип его не содержит: прототип '
    + 'заморожен на состоянии 2026-11-05, а набор правил приложения с тех пор вырос',
  missing: 'реализация правила в прототипе и пара фикстур в tests/rules/',
};

/** Причина, по которой правило осталось без фикстуры: схема или этот файл. */
const reasonOf = (id) => NOT_BUILDABLE[id] ?? PROTOTYPE_FROZEN;

/** Правило записано невыразимым в схеме — поимённо. */
const explainedBySchema = (id) => Boolean(NOT_BUILDABLE[id]);

/* ------------------------------------------------------------- прогон */

const RULE_FILES = async () => (await readdir(HERE)).filter((f) => f.endsWith('.json')).sort();

async function loadFixture(file) {
  const text = await readFile(path.join(HERE, file), 'utf8');
  const repairs = [];
  const model = deserialize(text, { repairs });
  return { text, model, repairs };
}

/** Все замечания всех реализованных правил по одной модели. */
function checkModel(model, only = null) {
  const out = [];
  for (const [id, fn] of Object.entries(CHECKS)) {
    if (only && id !== only) continue;
    for (const f of fn(model)) out.push({ rule: id, ...f });
  }
  return out;
}

const describe = (list) => list.map((f) => `${f.rule}@${f.subject}: ${f.detail}`).join('; ');

/**
 * Правила, у которых проверяется только OCL-половина: прозаическая часть
 * («Only binary Associations can be aggregations», «UseCases can only be
 * involved in binary Associations») требует небинарной ассоциации, а её схема
 * не знает — у связи ровно два конца.
 */
const OCL_ONLY = {
  'association-aggregation-binary-only': 'проза про арность невыразима: концов всегда два',
};

const idOf = (file) => file.replace(/\.ok\.json$|\.json$/, '');

async function main() {
  const files = await RULE_FILES();
  console.log(`Правил в наборе: ${RULES.length}. Фикстур в tests/rules/: ${files.length}.`);

  /* 1. Имена файлов — это id правил, и у каждого правила свой набор файлов. */
  const withFixture = new Set();
  const orphans = [];
  for (const file of files) {
    const id = idOf(file);
    if (!ruleById(id)) { orphans.push(file); continue; }
    if (!file.endsWith('.ok.json')) withFixture.add(id);
  }
  await check('имя каждого файла — id правила из набора', async () => {
    assert(!orphans.length, `файлы без правила: ${orphans.join(', ')}`);
    return `${withFixture.size} правил с фикстурой`;
  });

  /* 2. Фикстура валидна по схеме, канонична, минимальна и цитирует стандарт. */
  for (const file of files) {
    await check(`фикстура ${file}`, async () => {
      const { text, model, repairs } = await loadFixture(file);
      assert(!repairs.length, `замечания загрузчика: ${repairs.join(' | ')}`);
      assert(serialize(model) === text, 'файл не канонический: serialize(deserialize(x)) ≠ x');

      const diagram = model.diagrams[0];
      assert(model.elements.length <= 2, `элементов ${model.elements.length}, а фикстура должна быть минимальной`);
      assert(model.relationships.length <= 2, `связей ${model.relationships.length}, а фикстура должна быть минимальной`);
      assert(diagram.shapes.length === model.elements.length, 'на диаграмме не по фигуре на элемент');
      assert(diagram.links.length === model.relationships.length, 'на диаграмме не по связи на связь');

      const rule = ruleById(idOf(file));
      const docs = [
        ...model.elements.map((e) => e.documentation ?? ''),
        ...model.relationships.map((r) => r.documentation ?? ''),
      ].join('\n');
      assert(docs.includes(rule.source.clause), `в documentation нет пункта ${rule.source.clause}`);
      assert(docs.includes(rule.source.constraint), `в documentation нет имени ${rule.source.constraint}`);
      assert(docs.includes(rule.source.text), 'в documentation нет дословного текста констрейнта');
      return `${model.elements.length} эл., ${model.relationships.length} св., цитата на месте`;
    });
  }

  /* 3. Нарушение ловится, контрольный случай чист, чужих замечаний нет. */
  for (const id of [...withFixture].sort()) {
    await check(`${id}: нарушение поймано`, async () => {
      const { model } = await loadFixture(`${id}.json`);
      const hits = checkModel(model, id);
      assert(hits.length, `правило не сработало на ${id}.json`);
      for (const h of hits) log(`↳ ${h.subject}: ${h.detail}`);
      return `${hits.length} зам.: ${hits.map((h) => h.detail).join('; ')}`;
    });

    await check(`${id}: нарушение не задевает другие правила`, async () => {
      const { model } = await loadFixture(`${id}.json`);
      const others = checkModel(model).filter((h) => h.rule !== id);
      assert(!others.length, `кроме своего правила сработало: ${describe(others)}`);
      return `только ${id}`;
    });

    await check(`${id}: контрольный случай чист`, async () => {
      const { model } = await loadFixture(`${id}.ok.json`);
      const hits = checkModel(model);
      assert(!hits.length, `на ${id}.ok.json сработало: ${describe(hits)}`);
      return 'ни одного замечания';
    });
  }

  /* 4. Корпус учебника: правильные диаграммы — ни одного замечания. */
  await check('корпус tests/corpus/: ни одного нарушения', async () => {
    const dir = path.join(ROOT, 'tests/corpus');
    const corpus = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json').sort();
    assert(corpus.length, 'корпус пуст');
    const bad = [];
    let repairsTotal = 0;
    for (const file of corpus) {
      const repairs = [];
      const model = deserialize(await readFile(path.join(dir, file), 'utf8'), { repairs });
      repairsTotal += repairs.length;
      for (const h of checkModel(model)) bad.push(`${file}: ${h.rule}@${h.subject} — ${h.detail}`);
    }
    assert(!bad.length, bad.slice(0, 5).join(' | '));
    return `${corpus.length} моделей, 0 замечаний`
      + (repairsTotal ? ` (загрузчик снял ${repairsTotal} битых конца — долги схемы, не нарушения)` : '');
  });

  /* 5. Правила без фикстуры: причина названа, и она не выдумана. */
  const missing = RULES.filter((r) => !withFixture.has(r.id));
  await check('у каждого правила без фикстуры названа причина', async () => {
    const silent = missing.filter((r) => !reasonOf(r.id));
    assert(!silent.length, `без фикстуры и без причины: ${silent.map((r) => r.id).join(', ')}`);
    return `${missing.length} правил`;
  });
  await check('нет правила, записанного невыразимым, но с фикстурой', async () => {
    const wrong = Object.keys(NOT_BUILDABLE).filter((id) => withFixture.has(id));
    assert(!wrong.length, `фикстура есть: ${wrong.join(', ')}`);
    const unknown = Object.keys(NOT_BUILDABLE).filter((id) => !ruleById(id));
    assert(!unknown.length, `таких правил нет в наборе: ${unknown.join(', ')}`);
    return 'списки согласованы';
  });
  await check('каждая реализованная проверка подтверждена фикстурой', async () => {
    const naked = Object.keys(CHECKS).filter((id) => !withFixture.has(id));
    assert(!naked.length, `проверка без фикстуры: ${naked.join(', ')}`);
    return `${Object.keys(CHECKS).length} проверок`;
  });

  console.log('');
  console.log('Правила без фикстуры:');
  for (const r of missing) {
    const where = explainedBySchema(r.id) ? 'схема' : 'прототип';
    console.log(`  нет  ${r.id} (${r.source.clause}, ${r.source.constraint}) — ${where}`);
    console.log(`       причина: ${reasonOf(r.id).reason}`);
    console.log(`       не хватает: ${reasonOf(r.id).missing}`);
  }

  const covered = RULES.length - missing.length;
  const partial = Object.keys(OCL_ONLY);
  console.log('');
  console.log(`Итог: покрыто фикстурами ${covered} из ${RULES.length}; `
    + `из них ${partial.length} — только по OCL (${partial.map((id) => `${id}: ${OCL_ONLY[id]}`).join('; ')}).`);
  console.log(`Не покрыто ${missing.length}: ${missing.map((r) => r.id).join(', ')}.`);

  const failed = results.filter((r) => r.ok === false);
  console.log('');
  console.log(failed.length
    ? `Провалено ${failed.length} из ${results.length}.`
    : `Проверок пройдено: ${results.length} из ${results.length}.`);
  return failed.length ? 1 : 0;
}

process.exit(await main());
