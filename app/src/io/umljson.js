// The native project file: `*.uml.json`. Plain JSON, diffable, canonical —
// every save of the same model produces the same bytes, whatever the edit
// history was.
//
// `uml-model/3` — one model, many diagrams, relationships in the model:
//
//   { schema: "uml-model/3", id, name, created, revised,
//     elements: [ { id, kind, name, stereotype, stereotypeId, documentation,
//                   attributes/operations/literals/slots: [row],
//                   entry/do/exit/extensionPoints: [text],
//                   note, operator, timeline, taggedValues } ],
//     relationships: [ { id, kind, name, stereotype, stereotypeId, documentation,
//                        from: elementId, to: elementId,
//                        fromMultiplicity, toMultiplicity, fromRole, toRole,
//                        taggedValues } ],
//     diagrams: [ { id, name, kind, ownerElementId,
//                   shapes: [{ id, elementId, x, y, w, h, fixedH, fill }],
//                   links:  [{ id, relId, from, to, route, ldx, ldy, y }] } ],
//     currentDiagramId,
//     courseDone: [exerciseId] }   — «пройдено» в курсе; поля нет — не пройдено ничего
//
// Diffability rules (documented in README.md):
//   * members are written in one fixed key order;
//   * empty lists, empty strings and default values are omitted, never null;
//   * positions are integers (snapped to the 10px grid on drop);
//   * elements keep file order = creation order, ids are stable;
//   * no volatile data beyond the two date strings on the model itself.
//
// Reading repairs instead of losing data: an unknown kind becomes a known one,
// a broken link is dropped, a missing id gets a new one, and older files
// (`uml-model/2`, `uml-class-diagram/1`) are migrated on read.

import { SCHEMA, MEMBER_FIELDS, createDiagram, NAVIGABILITIES, AGGREGATIONS, defaultAggregation } from '../model/model.js';
import { NOTATION, SHAPE_KINDS, CONNECTOR_KINDS } from '../model/notation.js';
import { isLineJumps, JUMP_INHERIT } from '../model/line-jumps.js';
import { MECHANICS } from '../mechanics.generated.js';
import { downloadText, slugify, plural } from '../util.js';
// Формат правила проекта живёт в одном месте — в DSL (`rules/dsl.js`): там же
// его проверяет движок и редактор. Здесь только порядок ключей и правило
// «пустой список — это отсутствие поля».
import { canonicalProjectRules, canonicalRule } from '../rules/dsl.js';
import { parseJsonText } from './json-repair.js';

/**
 * Код размера наконечника (§28): целое 0…6 — это словарь самого наконечника
 * (`v/cco/a` держит семь множителей), а не свободное число. Всё прочее —
 * отсутствие значения, и связь рисуется в базовом размере (код 2).
 */
const headSizeValue = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < MECHANICS.headSizeCodes ? n : undefined;
};

// `kind` и `stereotypes` — метки ФАЙЛА ПРОЕКТА (экспорт всего проекта), а не
// данные модели: читатель их не переносит в модель, писатель обычного
// сохранения их не пишет. Иначе обычный `*.uml.json` после открытия проекта
// начинал бы носить чужие поля.
const MODEL_KEYS = ['schema', 'kind', 'stereotypes', 'id', 'name', 'created', 'revised', 'elements', 'relationships',
  'generalizationSets', 'projectRules', 'diagrams', 'currentDiagramId', 'pictograms', 'messageNumbers',
  'courseDone'];
const ELEMENT_KEYS = ['id', 'kind', 'name', 'stereotype', 'stereotypeId', 'documentation', 'abstract',
  'emptyCompartments',
  'ownerId', 'laneId', 'represents', 'behaviorRef', 'classifierId', 'refersTo',
  'multiObject', 'stopped', 'operands', 'regions', 'internals',
  'attributes', 'operations', 'literals', 'slots',
  'entry', 'do', 'exit', 'extensionPoints', 'note', 'operator', 'timeline', 'taggedValues',
  'attachments'];
const REL_KEYS = ['id', 'kind', 'name', 'stereotype', 'stereotypeId', 'documentation', 'from', 'to',
  'fromMultiplicity', 'toMultiplicity', 'fromRole', 'toRole',
  'fromQualifiers', 'toQualifiers',
  'navigable', 'fromAggregation', 'toAggregation', 'setId', 'taggedValues',
  'seq', 'asynchronous', 'signature', 'local', 'abstract'];
const SET_KEYS = ['id', 'name', 'disjoint', 'covering'];
const DIAGRAM_KEYS = ['id', 'name', 'kind', 'ownerElementId', 'shapes', 'links', 'lineJumps', 'lineJumpsSize'];
const SHAPE_KEYS = ['id', 'elementId', 'x', 'y', 'w', 'h', 'fixedH', 'fill'];
const LINK_KEYS = ['id', 'relId', 'from', 'to', 'route', 'waypoints', 'rounded', 'ldx', 'ldy', 'y',
  'entryPerimeter', 'noEdgeStyle', 'arcSize', 'fromAttach', 'toAttach', 'lineJumps', 'lineJumpsSize',
  'headSizeFrom', 'headSizeTo', 'color'];

/** Цвет линии связи — только #rrggbb: запись хранит то, что нарисовано, и
 * другой формат при первом же сохранении стал бы второй правдой. */
const edgeColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
  ? v.toLowerCase() : undefined);
const MEMBER_KEYS = ['vis', 'name', 'type', 'default', 'isStatic', 'isDerived', 'isID', 'isAbstract'];
// `attach` — вложенная форма (её и пишем); `fx…project` — плоская, которую
// тоже надо признать своей, иначе она утекла бы в `extrasOf` дважды.
const END_KEYS = ['shapeId', 'side', 't', 'attach', 'fx', 'fy', 'dx', 'dy', 'project'];
const TV_KEYS = ['name', 'value'];
const OPERAND_KEYS = ['id', 'guard', 'messages'];
const REGION_KEYS = ['id', 'name', 'nodes', 'edges', 'states', 'transitions'];
const INTERNAL_KEYS = ['trigger', 'guard', 'effect'];
const TEXT_FIELDS = ['entry', 'do', 'exit', 'extensionPoints'];

const extrasOf = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Every flag is written only when it is set, so a file that never used the new
// semantics re-saves byte for byte: defaults are absent, not false.
const canonicalMember = (r) => clean({
  vis: r.vis === 'public' ? undefined : (r.vis ?? 'public'),
  name: r.name || undefined,
  type: r.type || undefined,
  default: r.default || undefined,
  isStatic: r.isStatic ? true : undefined,
  isDerived: r.isDerived ? true : undefined,
  isID: r.isID ? true : undefined,
  // BehavioralFeature::isAbstract (§9.9.2). Written only when true, like every
  // other flag here: a file that never used it must re-save byte for byte.
  isAbstract: r.isAbstract ? true : undefined,
  ...extrasOf(r, MEMBER_KEYS),
});

/**
 * «Пройдено» в курсе — список id упражнений (панель «Курс», план Э6).
 * Пишется только когда непусто: модель без отметок пересохраняется
 * побайтово, ровно как до появления поля. Порядок — по возрастанию, чтобы
 * один и тот же набор давал одни и те же байты.
 */
const canonicalCourseDone = (v) => {
  if (!Array.isArray(v)) return undefined;
  const ids = [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))].sort();
  return ids.length ? ids : undefined;
};

const canonicalSet = (s) => clean({
  id: s.id,
  name: s.name || undefined,
  disjoint: s.disjoint ? true : undefined,
  covering: s.covering ? true : undefined,
  ...extrasOf(s, SET_KEYS),
});

const canonicalTV = (t) => clean({ name: t.name ?? '', value: t.value ?? '', ...extrasOf(t, TV_KEYS) });

/** Список ссылок: пустое значение — это отсутствие поля, а не `[]`. */
const idsOf = (v) => {
  if (!Array.isArray(v)) return undefined;
  const kept = v.map((x) => String(x ?? '')).filter((x) => x !== '');
  return kept.length ? kept : undefined;
};

/** Квалификаторы полюса (§11.4.4): строки рядом с ролью, пустых не бывает. */
const canonicalQualifiers = (v) => {
  if (!Array.isArray(v)) return undefined;
  const kept = v.map((x) => String(x ?? '').trim()).filter(Boolean);
  return kept.length ? kept : undefined;
};

/**
 * Операнды фрагмента (§17.6.1). Покрытие живёт ЗДЕСЬ, а не на сообщении:
 * одно сообщение может попасть в два фрагмента (вложенные `alt` в `loop`),
 * и полем на сообщении это невыразимо. Геометрии тут нет — высота и
 * разделитель остаются в фигуре.
 */
const canonicalOperand = (o) => clean({
  id: o.id == null ? undefined : String(o.id),
  guard: String(o.guard ?? '').trim() || undefined,
  messages: idsOf(o.messages),
  ...extrasOf(o, OPERAND_KEYS),
});

const canonicalOperands = (v) => {
  if (!Array.isArray(v)) return undefined;
  const rows = v.filter((o) => o && typeof o === 'object').map(canonicalOperand);
  return rows.length ? rows : undefined;
};

/**
 * Регион: `nodes`/`edges` у деятельности, `states`/`transitions` у состояния.
 * Пишется то имя, которое регион уже носит, — это одно понятие, а не два.
 */
const canonicalRegion = (r) => clean({
  id: r.id == null ? undefined : String(r.id),
  name: String(r.name ?? '').trim() || undefined,
  nodes: idsOf(r.nodes),
  edges: idsOf(r.edges),
  states: idsOf(r.states),
  transitions: idsOf(r.transitions),
  ...extrasOf(r, REGION_KEYS),
});

const canonicalRegions = (v) => {
  if (!Array.isArray(v)) return undefined;
  const rows = v.filter((r) => r && typeof r === 'object').map(canonicalRegion);
  return rows.length ? rows : undefined;
};

/** Внутренний переход (§14.5.10): строка `trigger [guard] / effect` внутри состояния. */
const canonicalInternal = (r) => clean({
  trigger: String(r.trigger ?? '').trim() || undefined,
  guard: String(r.guard ?? '').trim() || undefined,
  effect: String(r.effect ?? '').trim() || undefined,
  ...extrasOf(r, INTERNAL_KEYS),
});

const canonicalInternals = (v) => {
  if (!Array.isArray(v)) return undefined;
  const rows = v.filter((r) => r && typeof r === 'object').map(canonicalInternal)
    .filter((r) => Object.keys(r).length);
  return rows.length ? rows : undefined;
};

const membersOf = (element, field) => {
  const rows = Array.isArray(element[field]) ? element[field] : [];
  return rows.length ? rows.map(canonicalMember) : undefined;
};

const textsOf = (element, field) => {
  const rows = Array.isArray(element[field]) ? element[field] : [];
  const kept = rows.map((v) => String(v ?? '')).filter((v) => v.trim() !== '');
  return kept.length ? kept : undefined;
};

const tvsOf = (o) => {
  const rows = Array.isArray(o.taggedValues) ? o.taggedValues : [];
  return rows.length ? rows.map(canonicalTV) : undefined;
};

/**
 * Вложения элемента — файл рядом с моделью, а не на диске (§3.1).
 *
 * ЗАЧЕМ. Пособие требует «собрать описания в один файл и сохранить в PDF», а
 * работа идёт в браузере без сервера: положить файл рядом с .uml.json некуда.
 * Поэтому файл живёт ВНУТРИ модели, base64 в `data`, и уезжает вместе с ней.
 *
 * ЧТО ПИШЕТСЯ. Только непустой массив, ключи в фиксированном порядке
 * (id, name, mime, size, data), `size` — длина в байтах, пересчитанная из
 * base64. Пересчёт держит каноничность: подправленный руками `size` не
 * переживёт сохранения, поэтому два одинаковых состояния дают побайтово
 * одинаковый файл. Пустой массив не пишется вовсе, поэтому файлы без
 * вложений пересохраняются байт в байт (эталон old-v3.json — среди них).
 *
 * ПОРЯДОК — ПОРЯДОК ПРИЛОЖЕНИЯ, и он же порядок в файле. Сортировать по id
 * нельзя: id выдаёт `uid('a')` (случайный хвост), и после сохранения и
 * открытия список в панели перемешался бы, а «скачать» под именем строки
 * отдал бы чужой файл — панель вложений (ui/panels.js) прямо на это
 * опирается.
 *
 * ЧЕГО НЕ ВЫДУМЫВАЕМ. `mime` пишется только заданным: файл, где его нет, не
 * должен обрастать полем при пересохранении (панель подставляет
 * `application/octet-stream` сама, когда скачивает). `size` — наоборот,
 * всегда: это производная от данных, а не отдельное поле.
 */
const canonicalBase64 = (s) => String(s ?? '').replace(/\s+/g, '');

/** Длина base64 в байтах: 4 символа — 3 байта, минус хвостовые «=». */
const base64Bytes = (b64) => {
  const s = canonicalBase64(b64);
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
};

/** Алфавит base64: «=» только в хвосте, не больше двух. */
const B64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Дополнить base64 до кратности четырём: браузерный `atob` на строке другой
 * длины бросает исключение, поэтому недописанный хвост — это не «почти
 * base64», а нечитаемые данные. `null` — длина, которой в base64 не бывает
 * (4n+1).
 */
function padBase64(data) {
  const rest = data.length % 4;
  if (!rest) return data;
  if (rest === 1) return null;
  return data + '='.repeat(4 - rest);
}

const canonicalAttachment = (a) => {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const name = String(a.name ?? '').trim();
  const data = canonicalBase64(a.data);
  // Без имени файл нечего показывать, без данных он пуст: и то и другое
  // отбрасывается молча — модель важнее вложения.
  if (!name || !data) return null;
  return clean({
    id: String(a.id ?? '').trim() || undefined,
    name,
    mime: String(a.mime ?? '').trim() || undefined,
    size: base64Bytes(data),
    data,
  });
};

const attachmentsOf = (o) => {
  const rows = Array.isArray(o.attachments) ? o.attachments : [];
  const kept = rows.map(canonicalAttachment).filter(Boolean);
  return kept.length ? kept : undefined;
};

/**
 * Чтение вложений: битый base64 и разъехавшийся `size` — не повод терять
 * модель. Всё, что читатель исправил или выбросил, он НАЗЫВАЕТ в `repairs`:
 * молча потерять приложенный человеком файл нельзя.
 *
 *   * запись без имени или данных — не файл, пропускается;
 *   * мусор в base64 или длина 4n+1 — данные нечитаемы, запись пропускается;
 *   * хвост недописан до кратности четырём — дополняется «=» (atob иначе
 *     бросает), и это строка отчёта;
 *   * `size` пересчитывается из данных: размер принадлежит им, а не наоборот;
 *   * `id` без id получает `aN` — по нему панель удаляет строку; выдача
 *     детерминирована и не сталкивается с уже занятыми id (иначе «удалить»
 *     снёс бы две записи).
 */
function readAttachments(rows, repairs) {
  if (!Array.isArray(rows)) return [];
  const note = (m) => { if (repairs) repairs.push(m); };
  // Все явные id известны заранее: выдуманный id не должен совпасть с тем,
  // что лежит ниже в файле.
  const used = new Set(rows
    .filter((a) => a && typeof a === 'object' && a.id != null)
    .map((a) => String(a.id).trim())
    .filter(Boolean));
  const out = [];
  for (const a of rows) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      note('вложение повреждено и пропущено');
      continue;
    }
    const name = str(a.name).trim();
    const raw = canonicalBase64(a.data);
    if (!name || !raw) {
      note('вложение без имени или данных пропущено');
      continue;
    }
    if (!B64_ALPHABET.test(raw)) {
      note(`вложение «${name}»: data не base64, пропущено`);
      continue;
    }
    const data = padBase64(raw);
    if (data == null) {
      note(`вложение «${name}»: длина base64 неверна, пропущено`);
      continue;
    }
    if (data !== raw) note(`вложение «${name}»: base64 дополнен до кратности 4`);
    const size = base64Bytes(data);
    if (a.size != null && Number(a.size) !== size) {
      note(`вложение «${name}»: размер ${a.size} исправлен на ${size}`);
    }
    let id = String(a.id ?? '').trim();
    if (!id) {
      let n = out.length + 1;
      while (used.has(`a${n}`)) n += 1;
      id = `a${n}`;
      used.add(id);
      note(`вложение «${name}» без id получило ${id}`);
    }
    out.push(clean({
      id,
      name,
      mime: str(a.mime).trim() || undefined,
      size,
      data,
    }));
  }
  return out;
}

/**
 * Конец как доля рамки плюс смещение (§3.1): `{ fx, fy, dx, dy, project }`.
 *
 * Читается и пишется БЕЗ округления: в настоящих файлах лежат −0.008 и 1.001,
 * и «приведение к сетке» испортило бы привязку. Значения вне 0…1 законны —
 * конец может висеть снаружи фигуры. Пишется только то, что задано: пустой
 * объект не появляется, поэтому файл без долей пересохраняется байт в байт.
 */
const canonicalAttach = (a) => {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined;
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const out = clean({
    fx: num(a.fx),
    fy: num(a.fy),
    // Смещение и проекция — умолчания 0 и false: они не пишутся.
    dx: num(a.dx) ? num(a.dx) : undefined,
    dy: num(a.dy) ? num(a.dy) : undefined,
    project: a.project === true ? true : undefined,
  });
  return Object.keys(out).length ? out : undefined;
};

/** The attach of an end, from the nested field or from flat fx/fy keys. */
const attachOfEnd = (e) => canonicalAttach(e?.attach
  ?? (e && (e.fx != null || e.fy != null) ? e : null));

const canonicalEnd = (e) => clean({
  shapeId: e.shapeId ?? null,
  side: e.side ?? 'bottom',
  t: Math.abs((e.t ?? 0.5) - 0.5) < 1e-9 ? undefined : Math.round((e.t ?? 0.5) * 1000) / 1000,
  attach: attachOfEnd(e),
  ...extrasOf(e, END_KEYS),
});

function canonicalElement(e) {
  const def = NOTATION.shapes[e.kind] ?? {};
  const out = clean({
    id: e.id,
    kind: e.kind,
    name: e.name ?? '',
    stereotype: e.stereotype || undefined,
    // Ссылка на запись профиля — уточнение к имени, а не замена: элемент без
    // неё (все файлы до Б11) пересохраняется теми же байтами, а имя остаётся
    // тем, что нарисовано на листе.
    stereotypeId: e.stereotypeId || undefined,
    documentation: e.documentation || undefined,
    abstract: e.abstract ? true : undefined,
    // «Пустые отделения» (§20): 0 = «как на диаграмме» — это и значение по
    // умолчанию в реестре оригинала, поэтому ноль не пишется и старый файл
    // остаётся байт в байт.
    emptyCompartments: e.emptyCompartments === 1 || e.emptyCompartments === 2
      ? e.emptyCompartments : undefined,
    // Владение (§3.1): поле есть — значит элемент вложен; нет — верхний уровень.
    ownerId: e.ownerId ? String(e.ownerId) : undefined,
    // Флаги линии жизни пишутся только включёнными (§3.3).
    multiObject: e.multiObject ? true : undefined,
    stopped: e.stopped ? true : undefined,
    // Ссылки на сущности модели (§3.5, §3.6). Пустая строка — не ссылка.
    laneId: e.laneId ? String(e.laneId) : undefined,
    // `represents` один на дорожку деятельности (§15.2.4) и на линию жизни
    // (§17.3.4): оба отвечают на вопрос «чей это участник». Поле пишется
    // только при значении — файл без него остаётся байт в байт.
    represents: e.represents ? String(e.represents) : undefined,
    behaviorRef: e.behaviorRef ? String(e.behaviorRef) : undefined,
    classifierId: e.classifierId ? String(e.classifierId) : undefined,
    refersTo: e.refersTo ? String(e.refersTo) : undefined,
    operands: canonicalOperands(e.operands),
    regions: canonicalRegions(e.regions),
    internals: canonicalInternals(e.internals),
    attributes: membersOf(e, 'attributes'),
    operations: membersOf(e, 'operations'),
    literals: membersOf(e, 'literals'),
    slots: membersOf(e, 'slots'),
    note: def.wrap ? (e.note ?? '') : undefined,
    operator: def.style === 'frame' ? (e.operator || 'ref') : undefined,
    timeline: Array.isArray(e.timeline) && e.timeline.length ? e.timeline.map((s) => ({
      state: s.state ?? '', from: num(s.from, 0), to: num(s.to, 100),
    })) : undefined,
    taggedValues: tvsOf(e),
    attachments: attachmentsOf(e),
    ...extrasOf(e, ELEMENT_KEYS),
  });
  for (const f of TEXT_FIELDS) {
    const v = textsOf(e, f);
    if (v) out[f] = v;
  }
  return out;
}

/**
 * Правила проекта из файла: массив БЕЗ обёртки (обёртка `uml-project-rules/1`
 * живёт в отдельном файле экспорта и читается `dsl.fromRulesFile`).
 *
 * Запись, которая не объект, — ремонт, а не правило: сказать о ней честно
 * лучше, чем молча выбросить и сделать вид, что правило не находило ничего.
 * Само правило не проверяется: битое правило должно доехать до редактора,
 * чтобы человек его починил, а не потерял при открытии.
 */
function readProjectRules(raw, repairs = []) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    repairs.push('Правила проекта: это не список — ключ пропущен.');
    return undefined;
  }
  const rules = raw.filter((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r)) return true;
    repairs.push('Правило проекта: запись не объект и пропущена.');
    return false;
  }).map(canonicalRule);
  return rules.length ? rules : undefined;
}

function canonicalShape(s) {
  return clean({
    id: s.id,
    elementId: s.elementId,
    x: Math.round(s.x), y: Math.round(s.y),
    w: Math.round(s.w), h: Math.round(s.h),
    fixedH: s.fixedH || undefined,
    fill: s.fill || undefined,
    ...extrasOf(s, SHAPE_KEYS),
  });
}

function canonicalRelationship(r) {
  const def = NOTATION.connectors[r.kind] ?? {};
  // Aggregation is stored only when it differs from what the connector kind
  // already means: «Агрегация» is `shared` at its source end by definition, so
  // an untouched one writes nothing and an old file stays byte-identical.
  const agg = (field, end) => {
    const v = r[field];
    if (!AGGREGATIONS.includes(v)) return undefined;
    return v === defaultAggregation(r.kind, end) ? undefined : v;
  };
  return clean({
    id: r.id,
    kind: r.kind,
    name: r.name || undefined,
    stereotype: r.stereotype || undefined,
    stereotypeId: r.stereotypeId || undefined,
    from: r.from ?? null,
    to: r.to ?? null,
    fromMultiplicity: def.multiplicity ? (r.fromMultiplicity || undefined) : undefined,
    toMultiplicity: def.multiplicity ? (r.toMultiplicity || undefined) : undefined,
    fromRole: def.roles ? (r.fromRole || undefined) : undefined,
    toRole: def.roles ? (r.toRole || undefined) : undefined,
    fromQualifiers: canonicalQualifiers(r.fromQualifiers),
    toQualifiers: canonicalQualifiers(r.toQualifiers),
    navigable: NAVIGABILITIES.includes(r.navigable) && r.navigable !== 'none' ? r.navigable : undefined,
    // Association is a Classifier (§11.8.1.3): its abstractness is a real UML
    // flag, not a PlantUML decoration. Written only when true.
    abstract: r.abstract ? true : undefined,
    fromAggregation: agg('fromAggregation', 'from'),
    toAggregation: agg('toAggregation', 'to'),
    // Порядок сообщения (§3.2): разрежённое целое; нет — порядок по геометрии.
    seq: intOrUndefined(r.seq),
    asynchronous: r.asynchronous ? true : undefined,
    // Подпись сообщения (§17.12.18.7, Message::signature) — имя операции с
    // параметрами. Это ТЕКСТ, а не ссылка: отдельное поле нужно потому, что
    // `name` — метка на линии («2: зарегистрировать»), а сигнатура — то, что
    // вызывается (`register(st: Student)`), и правила сверяют её с
    // `operations[]` получателя.
    //
    // Вид связи здесь НЕ проверяется — так же, как у `seq` и `asynchronous`:
    // схема хранит то, что пришло, а «сигнатура бывает только у сообщения» —
    // дело правила и рисования (`def.sequence` в render.js), не загрузчика.
    // Ограничение здесь означало бы потерю текста при чтении чужого файла.
    // Пустая строка — не значение, а отсутствие поля: файл без сигнатуры
    // пересохраняется байт в байт.
    signature: r.signature || undefined,
    local: r.local ? true : undefined,
    setId: r.setId || undefined,
    documentation: r.documentation || undefined,
    taggedValues: tvsOf(r),
    ...extrasOf(r, REL_KEYS),
  });
}

/**
 * Bend points of a link, written only when there are any: a file that never
 * used them re-saves byte for byte. Positions are whole sheet pixels, so the
 * same model always serialises to the same bytes.
 */
const canonicalWaypoints = (v) => {
  if (!Array.isArray(v)) return undefined;
  const pts = v
    .filter((p) => Array.isArray(p) && p.length >= 2
      && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
    .map((p) => [Math.round(Number(p[0])), Math.round(Number(p[1]))]);
  return pts.length ? pts : undefined;
};

const ROUNDED = ['small', 'large'];

function canonicalLink(l) {
  return clean({
    id: l.id,
    relId: l.relId,
    // A free end of a found/lost message is written as `null` (§3.2): it is
    // the meaning, not a missing value — an absent KEY would be indistinguishable
    // from a truncated file.
    from: l.from ? canonicalEnd({ ...l.from, attach: attachOfEnd(l.from) ?? canonicalAttach(l.fromAttach) }) : null,
    to: l.to ? canonicalEnd({ ...l.to, attach: attachOfEnd(l.to) ?? canonicalAttach(l.toAttach) }) : null,
    route: l.route === 'direct' ? 'direct' : undefined,
    waypoints: canonicalWaypoints(l.waypoints),
    // 'off' is the default and is never written — same rule as every other flag.
    rounded: ROUNDED.includes(l.rounded) ? l.rounded : undefined,
    // Три поля импорта (§7.6): пересчёт маршрута, привязка к периметру и
    // радиус скругления числом. Каждое пишется только отличающимся от
    // умолчания, иначе эталон перестал бы пересохраняться побайтово.
    entryPerimeter: l.entryPerimeter === true ? true : undefined,
    noEdgeStyle: l.noEdgeStyle === true ? true : undefined,
    arcSize: Number.isFinite(Number(l.arcSize)) && l.arcSize !== null && l.arcSize !== ''
      ? Number(l.arcSize) : undefined,
    // Скачки на пересечениях (§26): код связи пишется только когда он не
    // «как на диаграмме» (4) — это значение самого реестра, и его отсутствие
    // в файле значит ровно то же. Размер — только не равный умолчанию 0.
    lineJumps: isLineJumps(l.lineJumps) && l.lineJumps !== JUMP_INHERIT ? l.lineJumps : undefined,
    lineJumpsSize: Number.isInteger(Number(l.lineJumpsSize)) && Number(l.lineJumpsSize) > 0
      ? Math.min(Number(l.lineJumpsSize), MECHANICS.lineJumpSizeMax) : undefined,
    // Размер наконечника (§28) пишется только отличающимся от заводского
    // кода 2: файл без поля и файл с двойкой значат одно и то же.
    // Цвет связи пишется только когда он задан: связь без поля означает
    // «чернила листа», и файл, который его не знал, пересохраняется байт в байт.
    color: edgeColor(l.color),
    headSizeFrom: headSizeValue(l.headSizeFrom) === MECHANICS.headSizeDefault
      ? undefined : headSizeValue(l.headSizeFrom),
    headSizeTo: headSizeValue(l.headSizeTo) === MECHANICS.headSizeDefault
      ? undefined : headSizeValue(l.headSizeTo),
    ldx: l.ldx ? Math.round(l.ldx) : undefined,
    ldy: l.ldy ? Math.round(l.ldy) : undefined,
    y: l.y != null ? Math.round(l.y) : undefined,
    ...extrasOf(l, LINK_KEYS),
  });
}

function canonicalDiagram(d) {
  return clean({
    id: d.id,
    name: d.name ?? '',
    kind: d.kind || 'class',
    ownerElementId: d.ownerElementId || undefined,
    shapes: (d.shapes ?? []).map(canonicalShape),
    links: (d.links ?? []).map(canonicalLink),
    // Диаграмма хранит свои скачки отдельно от связей (`connectorLineJumps`
    // и `connectorLineJumpsSize` в строке DIAGRAM): связь со значением 4
    // «как на диаграмме» показывает именно это число.
    lineJumps: isLineJumps(d.lineJumps) && d.lineJumps !== JUMP_INHERIT ? d.lineJumps : undefined,
    lineJumpsSize: Number.isInteger(Number(d.lineJumpsSize)) && Number(d.lineJumpsSize) > 0
      ? Math.min(Number(d.lineJumpsSize), MECHANICS.lineJumpSizeMax) : undefined,
    ...extrasOf(d, DIAGRAM_KEYS),
  });
}

export function serialize(model) {
  return JSON.stringify(modelObject(model), null, 2) + '\n';
}

/**
 * Модель как объект файла — общая часть обычного сохранения и экспорта
 * проекта. Ключи пишутся в одном порядке, поэтому `serialize` и
 * `serializeProject` дают одни и те же байты на одних и тех же данных.
 */
function modelObject(model) {
  const diagrams = (model.diagrams ?? []).map(canonicalDiagram);
  const current = diagrams.some((d) => d.id === model.currentDiagramId)
    ? model.currentDiagramId
    : diagrams[0]?.id;
  const sets = Array.isArray(model.generalizationSets) ? model.generalizationSets.map(canonicalSet) : [];
  return clean({
    schema: SCHEMA,
    id: model.id,
    name: model.name || '',
    created: model.created || undefined,
    revised: model.revised || undefined,
    elements: (model.elements ?? []).map(canonicalElement),
    relationships: (model.relationships ?? []).map(canonicalRelationship),
    generalizationSets: sets.length ? sets : undefined,
    // Правила проекта — в файле МОДЕЛИ, а не в поставке приложения: команда
    // пишет их сама, и переезжают они вместе с моделью. Пустой список — это
    // отсутствие ключа (`undefined`), иначе модель без правил перестала бы
    // сохраняться байт в байт (эталон old-v3.json).
    projectRules: canonicalProjectRules(model.projectRules),
    // On by default: only «показывать пиктограммы» turned off is written, so
    // an untouched model keeps the bytes it had before the switch existed.
    pictograms: model.pictograms === false ? false : undefined,
    // Нумерация сообщений — по умолчанию ВЫКЛючена: на диаграмме
    // последовательности порядок задан вертикалью, и все 19 таких диаграмм
    // пособия нарисованы без номеров. Пишется только включённая.
    messageNumbers: model.messageNumbers === true ? true : undefined,
    courseDone: canonicalCourseDone(model.courseDone),
    diagrams,
    currentDiagramId: current,
    ...extrasOf(model, MODEL_KEYS),
  });
}

/**
 * Стереотипы, которые модель ДЕЙСТВИТЕЛЬНО использует: id из `stereotypeId`
 * элементов и связей, по возрастанию id, с именем записи профиля.
 *
 * В файл проекта идут только они, а не все 304 записи профиля: профиль —
 * поставляемые данные, он лежит рядом с программой и одинаков у всех; файл
 * должен называть те записи, без которых его элементы потеряют вид, и не
 * раздуваться на сотню килобайт копией того, что и так есть на диске.
 */
export function usedStereotypes(model, profile = null) {
  const names = new Map();
  for (const item of [...(model.elements ?? []), ...(model.relationships ?? [])]) {
    if (!item?.stereotypeId) continue;
    const id = String(item.stereotypeId);
    if (!names.has(id) || (!names.get(id) && item.stereotype)) names.set(id, item.stereotype || '');
  }
  const rows = [...names.keys()].sort().map((id) => {
    const record = profile?.byId?.get?.(id) ?? null;
    return clean({ id, name: record?.name ?? names.get(id) ?? undefined });
  });
  return rows.length ? rows : undefined;
}

/**
 * Файл ВСЕГО проекта: та же модель `uml-model/3`, но с явной меткой
 * `kind: 'project'` — по ней «Файл → Открыть» видит, что перед ним проект, а
 * не одна диаграмма, и сообщает, сколько диаграмм загружено.
 *
 * `revised` здесь НЕ обновляется: экспорт — это чтение модели, а не её
 * правка, и круг «экспорт → открыть → экспорт» обязан дать те же байты.
 */
export function serializeProject(model, profile = null) {
  const base = modelObject(model);
  const { schema, id, name, created, revised, elements, relationships, ...tail } = base;
  const out = clean({
    schema,
    kind: 'project',
    id,
    name,
    created,
    revised,
    stereotypes: usedStereotypes(model, profile),
    elements,
    relationships,
    ...tail,
  });
  return JSON.stringify(out, null, 2) + '\n';
}

export function saveModel(model, fileName) {
  model.revised = new Date().toISOString().slice(0, 10);
  const name = fileName || `${slugify(model.name)}.uml.json`;
  downloadText(serialize(model), name, 'application/json');
  return name;
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d = '') => (v == null ? d : String(v));
/** Целое или ничего: `null` и `''` — это отсутствие, а не ноль. */
const intOrUndefined = (v) => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
};
/** Ссылка на сущность модели: пустая строка — не ссылка. */
const refOrUndefined = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s : undefined;
};

const readQualifiers = (v) => {
  if (!Array.isArray(v)) return undefined;
  const kept = v.map((x) => String(x ?? '').trim()).filter(Boolean);
  return kept.length ? kept : undefined;
};

/**
 * Операнды читаются как есть; ссылки на сообщения проверяются позже, когда
 * прочитаны все связи (validateRefs). Пустой `guard` остаётся пустым — это
 * отсутствие сторожа, а не строка «undefined».
 */
function readOperands(rows) {
  if (!Array.isArray(rows)) return undefined;
  const out = rows.filter((o) => o && typeof o === 'object').map((o, i) => ({
    id: o.id == null ? `o${i + 1}` : String(o.id),
    guard: str(o.guard),
    messages: Array.isArray(o.messages) ? o.messages.map((x) => String(x)) : [],
    ...extrasOf(o, OPERAND_KEYS),
  }));
  return out.length ? out : undefined;
}

/** Регион: члены и рёбра — списки id, проверяются в validateRefs. */
function readRegions(rows) {
  if (!Array.isArray(rows)) return undefined;
  const out = rows.filter((r) => r && typeof r === 'object').map((r, i) => {
    const region = { id: r.id == null ? `g${i + 1}` : String(r.id), name: str(r.name) };
    for (const key of ['nodes', 'edges', 'states', 'transitions']) {
      if (Array.isArray(r[key])) region[key] = r[key].map((x) => String(x));
    }
    return { ...region, ...extrasOf(r, REGION_KEYS) };
  });
  return out.length ? out : undefined;
}

/** Внутренние переходы: три строки, каждая может быть пустой. */
function readInternals(rows) {
  if (!Array.isArray(rows)) return undefined;
  const out = rows.filter((r) => r && typeof r === 'object').map((r) => ({
    trigger: str(r.trigger),
    guard: str(r.guard),
    effect: str(r.effect),
    ...extrasOf(r, INTERNAL_KEYS),
  }));
  return out.length ? out : undefined;
}

// Заливка в файле — либо строка цвета, либо объект записи заливки
// { type, color1, color2, style } (тип 1 — сплошная, 2 — градиент;
// MECHANICS.md §14). Всё остальное превращается в сплошной цвет.
function readFill(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return null;
  const out = { type: v.type === 2 ? 2 : 1 };
  if (v.color1) out.color1 = str(v.color1);
  if (v.color2) out.color2 = str(v.color2);
  out.style = num(v.style, 0);
  return out;
}

const firstShape = () => SHAPE_KINDS()[0] ?? 'class';
const firstConn = () => CONNECTOR_KINDS()[0] ?? 'association';

/**
 * Parse and repair a project file. Throws on anything unusable; repairs
 * (a missing id, a replaced element) come back in `repairs` for the hint line.
 *
 * `profile` — the loaded stereotype profile, optional. With it the reader
 * checks every `stereotypeId` and drops a reference that answers to no record
 * (the name stays, a line goes to `repairs`); without it nothing is checked —
 * a profile is data the file may legitimately be opened without.
 *
 * A file cut short by a closed tab, a full disk or a broken transfer is
 * recovered to its last whole value and the open brackets are closed
 * (io/json-repair.js); that recovery is a line in `repairs` too, never silent.
 *
 * @param {string|object} text  the file
 * @param {{repairs?: string[], profile?: object|null, meta?: object|null}} options
 *   `meta`, when given, is filled with `{ kind: 'model'|'project',
 *   truncated: null|{position, cutAt} }` — what the file turned out to be.
 * @returns {object} the model
 */
export function deserialize(text, { repairs = [], profile = null, meta = null } = {}) {
  const parsed = parseJsonText(text);
  const raw = parsed.raw;
  if (meta && typeof meta === 'object') {
    meta.kind = raw.kind === 'project' ? 'project' : 'model';
    meta.truncated = parsed.truncated;
  }
  if (!raw || typeof raw !== 'object') throw new Error('В файле нет объекта.');

  const schema = String(raw.schema ?? '');
  if (!schema.startsWith('uml-model/') && !schema.startsWith('uml-class-diagram/')) {
    throw new Error(parsed.truncated
      ? `Файл обрезан на позиции ${parsed.truncated.position}: до целого объекта он не доходит, `
        + 'поля schema в уцелевшем куске нет — восстанавливать не из чего. '
        + 'Откройте исправную копию файла.'
      : `Файл не является моделью UML (нет schema uml-model/3 или uml-class-diagram/1).`);
  }
  if (schema.startsWith('uml-class-diagram/')) {
    const model = migrateV1(raw, repairs);
    repairStereotypeRefs(model, profile, repairs);
    noteTruncation(repairs, parsed.truncated, model);
    return model;
  }
  if (schema === 'uml-model/2') {
    const model = migrateV2(raw, repairs);
    repairStereotypeRefs(model, profile, repairs);
    noteTruncation(repairs, parsed.truncated, model);
    return model;
  }

  const elements = (Array.isArray(raw.elements) ? raw.elements : []).map((v, i) => {
    if (!v || typeof v !== 'object') { repairs.push(`Элемент ${i + 1} повреждён и пропущен.`); return null; }
    const id = v.id == null ? `e${i + 1}` : String(v.id);
    if (v.id == null) repairs.push(`Элемент ${i + 1} без id получил ${id}.`);
    const kind = NOTATION.shapes[v.kind] ? v.kind : firstShape();
    if (kind !== v.kind) repairs.push(`Элемент ${i + 1}: неизвестный тип «${v.kind}», заменён на «${kind}».`);
    const def = NOTATION.shapes[kind] ?? {};
    const element = clean({
      id,
      kind,
      name: str(v.name),
      stereotype: v.stereotype ? str(v.stereotype) : null,
      // Ссылка читается как есть; её существование проверяет
      // repairStereotypeRefs, когда профиль в руках. Нет поля — нет ссылки.
      stereotypeId: v.stereotypeId ? str(v.stereotypeId) : null,
      documentation: str(v.documentation),
      abstract: v.abstract === true,
      // §20: only 1 (Yes) and 2 (No) are stored; anything else means «как на
      // диаграмме» and is not carried (the registry's own default is 0).
      emptyCompartments: v.emptyCompartments === 1 || v.emptyCompartments === 2
        ? v.emptyCompartments : undefined,
      // Читатель не дописывает данные: нет поля — нет владельца, флага или
      // ссылки. Значения проверяются ниже, когда известны все id файла.
      ownerId: refOrUndefined(v.ownerId),
      multiObject: v.multiObject === true ? true : undefined,
      stopped: v.stopped === true ? true : undefined,
      laneId: refOrUndefined(v.laneId),
      represents: refOrUndefined(v.represents),
      behaviorRef: refOrUndefined(v.behaviorRef),
      classifierId: refOrUndefined(v.classifierId),
      refersTo: refOrUndefined(v.refersTo),
      operands: readOperands(v.operands),
      regions: readRegions(v.regions),
      internals: readInternals(v.internals),
      taggedValues: readTVs(v.taggedValues),
      attachments: readAttachments(v.attachments, repairs),
      ...extrasOf(v, ELEMENT_KEYS),
    });
    for (const field of MEMBER_FIELDS) {
      if (Array.isArray(v[field]) || (def.compartments ?? []).some((c) => c.field === field && c.mode !== 'lines')) {
        element[field] = readMembers(v[field]);
      }
    }
    for (const f of TEXT_FIELDS) {
      if (Array.isArray(v[f])) element[f] = v[f].map((x) => str(x));
    }
    if (def.wrap) element.note = str(v.note);
    if (def.style === 'frame') element.operator = str(v.operator, def.operator ?? 'ref');
    if (def.style === 'timingLane') element.timeline = readTimeline(v.timeline);
    return element;
  }).filter(Boolean);

  const elementIds = new Set(elements.map((e) => e.id));

  const relationships = (Array.isArray(raw.relationships) ? raw.relationships : []).map((v, i) => {
    if (!v || typeof v !== 'object') { repairs.push(`Связь ${i + 1} повреждена и пропущена.`); return null; }
    const kind = NOTATION.connectors[v.kind] ? v.kind : firstConn();
    if (kind !== v.kind) repairs.push(`Связь ${i + 1}: неизвестный тип «${v.kind}», заменён на «${kind}».`);
    const from = v.from == null || v.from === '' ? null : String(v.from);
    const to = v.to == null || v.to === '' ? null : String(v.to);
    // Сообщение — единственный вид связи, у которого конец может отсутствовать:
    // найденное сообщение не имеет отправителя, потерянное — получателя
    // (§17.4.4). Раньше такая связь молча выбрасывалась, и файлы 5.2.10 и
    // 5.2.18 теряли по связи. Остальные виды без двух элементов по-прежнему
    // неполны.
    const seqKind = !!NOTATION.connectors[kind]?.sequence;
    if ((from && !elementIds.has(from)) || (to && !elementIds.has(to))) {
      repairs.push(`Связь ${i + 1} пропущена: её элемент не найден.`);
      return null;
    }
    if (!from && !to) {
      repairs.push(`Связь ${i + 1} пропущена: у неё нет ни одного конца.`);
      return null;
    }
    if (!seqKind && (!from || !to)) {
      repairs.push(`Связь ${i + 1} пропущена: у связи «${NOTATION.connectors[kind]?.label ?? kind}» нет второго конца.`);
      return null;
    }
    const def = NOTATION.connectors[kind] ?? {};
    return clean({
      id: v.id == null ? `r${i + 1}` : String(v.id),
      kind,
      name: str(v.name),
      stereotype: v.stereotype ? str(v.stereotype) : null,
      stereotypeId: v.stereotypeId ? str(v.stereotypeId) : null,
      documentation: str(v.documentation),
      from,
      to,
      // No default: a file that never showed a multiplicity keeps none. The
      // reader used to invent '1' here, so `serialize(deserialize(x))` grew a
      // field the file did not have — 24 links across two corpus sheets failed
      // the round trip for exactly this. Nothing downstream needs the default:
      // the renderer skips a falsy end, the rules skip `undefined`, and the
      // inspector shows an empty field.
      fromMultiplicity: def.multiplicity ? str(v.fromMultiplicity) : undefined,
      toMultiplicity: def.multiplicity ? str(v.toMultiplicity) : undefined,
      fromRole: def.roles ? str(v.fromRole) : undefined,
      toRole: def.roles ? str(v.toRole) : undefined,
      // The three association-end properties: a file that never carried them
      // gets the UML default (no arrows, no diamond beyond what the kind means).
      navigable: NAVIGABILITIES.includes(v.navigable) ? v.navigable : 'none',
      // Association is a Classifier: `abstract` is read only when true, so a
      // file without the field keeps no field.
      abstract: v.abstract === true ? true : undefined,
      fromAggregation: AGGREGATIONS.includes(v.fromAggregation) ? v.fromAggregation : defaultAggregation(kind, 'from'),
      toAggregation: AGGREGATIONS.includes(v.toAggregation) ? v.toAggregation : defaultAggregation(kind, 'to'),
      setId: v.setId == null ? undefined : String(v.setId),
      // Сообщение (§3.2): порядок и асинхронность. Оба — необязательные, оба
      // пишутся только когда заданы.
      seq: intOrUndefined(v.seq),
      asynchronous: v.asynchronous === true ? true : undefined,
      // Подпись сообщения — строка как она есть (пробелы внутри `st: Student`
      // значимы), пустая — отсутствие поля.
      signature: v.signature == null ? undefined : str(v.signature),
      // Переход (§3.7): `local` — переход внутри составного состояния.
      local: v.local === true ? true : undefined,
      // Квалификаторы полюсов (§3.8) — строки рядом с ролью.
      fromQualifiers: readQualifiers(v.fromQualifiers),
      toQualifiers: readQualifiers(v.toQualifiers),
      taggedValues: readTVs(v.taggedValues),
      ...extrasOf(v, REL_KEYS),
    });
  }).filter(Boolean);

  const relById = new Map(relationships.map((r) => [r.id, r]));
  let diagrams = (Array.isArray(raw.diagrams) ? raw.diagrams : [])
    .map((v, i) => readDiagram(v, i, elementIds, relById, repairs))
    .filter(Boolean);
  // Сколько диаграмм было в самом файле: созданная ниже пустая — не добыча
  // восстановления, и в отчёте о ремонте её считать нельзя.
  const diagramsFromFile = diagrams.length;
  if (!diagrams.length) {
    diagrams = [createDiagram('Диаграмма 1')];
    repairs.push('В файле не было ни одной диаграммы — создана пустая «Диаграмма 1».');
  }

  const current = diagrams.some((d) => d.id === raw.currentDiagramId)
    ? String(raw.currentDiagramId)
    : diagrams[0].id;

  // Владение, регионы, операнды и ссылки проверяются только здесь: до этого
  // момента в файле могли быть id, которых ещё нет в списках.
  validateRefs({ elements, relationships, diagrams, repairs });
  // Ссылки на записи профиля — тем же правилом: нет записи — ссылки нет, имя
  // остаётся. Проверять нечем, если профиль не загружен, — тогда не трогаем.
  repairStereotypeRefs({ elements, relationships }, profile, repairs);

  // Generalization sets: a set survives only if it is an object; a
  // relationship keeps its `setId` only while that set exists.
  const generalizationSets = (Array.isArray(raw.generalizationSets) ? raw.generalizationSets : [])
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => clean({
      id: s.id == null ? `gs${i + 1}` : String(s.id),
      name: str(s.name),
      disjoint: s.disjoint === true,
      covering: s.covering === true,
      ...extrasOf(s, SET_KEYS),
    }));
  const setIds = new Set(generalizationSets.map((s) => s.id));
  for (const r of relationships) {
    if (r.setId && !setIds.has(r.setId)) {
      repairs.push(`Связь «${r.name || r.kind}»: набор обобщений ${r.setId} не найден — привязка снята.`);
      r.setId = undefined;
    }
  }

  const model = {
    schema: SCHEMA,
    id: raw.id ? String(raw.id) : `m${Date.now().toString(36)}`,
    name: str(raw.name, 'Новая модель'),
    created: str(raw.created),
    revised: str(raw.revised),
    elements,
    relationships,
    generalizationSets,
    pictograms: raw.pictograms === false ? false : true,
    courseDone: canonicalCourseDone(raw.courseDone),
    diagrams,
    currentDiagramId: current,
    ...extrasOf(raw, MODEL_KEYS),
  };
  // Ключ появляется только когда правила есть: `{ projectRules: undefined }`
  // — это уже другое значение объекта, и `'projectRules' in model` начинало бы
  // врать «правила есть» на модели без них.
  const projectRules = readProjectRules(raw.projectRules, repairs);
  if (projectRules) model.projectRules = projectRules;
  noteTruncation(repairs, parsed.truncated, model, diagramsFromFile);
  return model;
}

/**
 * Строка в `repairs` о восстановленном обрыве: где файл кончился, сколько
 * целого удалось спасти и что хвост отрезан. Числа — из уже прочитанной
 * модели, поэтому «восстановлено» значит именно то, что человек увидит.
 */
function noteTruncation(repairs, truncated, model, diagramsFromFile) {
  if (!truncated) return;
  const elements = model.elements?.length ?? 0;
  const diagrams = diagramsFromFile ?? model.diagrams?.length ?? 0;
  repairs.push(`Файл обрезан на позиции ${truncated.position}: восстановлено `
    + `${elements} ${plural(elements, 'элемент', 'элемента', 'элементов')}, `
    + `${diagrams} ${plural(diagrams, 'диаграмма', 'диаграммы', 'диаграмм')} `
    + `(хвост после ${truncated.cutAt} отрезан, открытые скобки закрыты).`);
}

function readDiagram(v, i, elementIds, relById, repairs) {
  if (!v || typeof v !== 'object') { repairs.push(`Диаграмма ${i + 1} повреждена и пропущена.`); return null; }
  const id = v.id == null ? `d${i + 1}` : String(v.id);
  const shapes = (Array.isArray(v.shapes) ? v.shapes : []).map((s, j) => {
    if (!s || typeof s !== 'object') { repairs.push(`Диаграмма ${i + 1}, фигура ${j + 1} повреждена и пропущена.`); return null; }
    if (s.elementId == null || !elementIds.has(String(s.elementId))) {
      repairs.push(`Диаграмма ${i + 1}, фигура ${j + 1}: нет элемента — пропущена.`);
      return null;
    }
    return clean({
      id: s.id == null ? `s${i + 1}-${j + 1}` : String(s.id),
      elementId: String(s.elementId),
      x: num(s.x, 40), y: num(s.y, 40), w: num(s.w, 190), h: num(s.h, 120),
      fixedH: s.fixedH ? true : undefined,
      fill: readFill(s.fill),
      ...extrasOf(s, SHAPE_KEYS),
    });
  }).filter(Boolean);

  const ids = new Set(shapes.map((s) => s.id));
  const links = (Array.isArray(v.links) ? v.links : []).map((l, j) => {
    if (!l || typeof l !== 'object') { repairs.push(`Связь ${j + 1} повреждена и пропущена.`); return null; }
    const rel = relById.get(String(l.relId));
    if (!rel) { repairs.push(`Связь ${j + 1} пропущена: нет связи в модели.`); return null; }
    // Конец вида может отсутствовать только у сообщения — и только если сама
    // связь его не имеет: найденное и потерянное сообщение (§17.4.4) рисуются
    // «кружком» на свободном конце.
    const free = { from: rel.from == null, to: rel.to == null };
    const from = free.from ? null : readEnd(l.from, ids);
    const to = free.to ? null : readEnd(l.to, ids);
    // Доля конца читается и в двух других записях, которые встречаются в
    // чужих файлах: плоско (`fx`/`fy` рядом со `side`) и объектом на САМОЙ
    // связи (`fromAttach`/`toAttach`). В модели остаётся одна форма — внутри
    // конца, — иначе две правды разъедутся при первом сохранении.
    if (from && !from.attach && l.fromAttach) {
      const a = canonicalAttach(l.fromAttach);
      if (a) from.attach = a;
    }
    if (to && !to.attach && l.toAttach) {
      const a = canonicalAttach(l.toAttach);
      if (a) to.attach = a;
    }
    if ((!free.from && !from) || (!free.to && !to)) {
      repairs.push(`Связь ${j + 1} пропущена: нет фигуры на конце.`);
      return null;
    }
    return clean({
      id: l.id == null ? `l${i + 1}-${j + 1}` : String(l.id),
      relId: String(l.relId),
      from,
      to,
      route: l.route === 'direct' ? 'direct' : 'rect',
      waypoints: canonicalWaypoints(l.waypoints),
      rounded: ROUNDED.includes(l.rounded) ? l.rounded : 'off',
      // Три поля импорта (§7.6): маршрут фиксирован, конец приколот к
      // периметру, радиус скругления задан числом.
      entryPerimeter: l.entryPerimeter === true ? true : undefined,
      noEdgeStyle: l.noEdgeStyle === true ? true : undefined,
      arcSize: l.arcSize == null || l.arcSize === '' || !Number.isFinite(Number(l.arcSize))
        ? undefined : Number(l.arcSize),
      // Скачки на пересечениях (§26). Код вне 0…4 не принимается вовсе:
      // пять значений — это словарь программы, а не свободное число. 4
      // («как на диаграмме») не пишется, чтобы файл не хранил двух правд.
      lineJumps: isLineJumps(Number(l.lineJumps)) && Number(l.lineJumps) !== JUMP_INHERIT
        ? Number(l.lineJumps) : undefined,
      lineJumpsSize: Number.isInteger(Number(l.lineJumpsSize))
        && Number(l.lineJumpsSize) > 0 && Number(l.lineJumpsSize) <= MECHANICS.lineJumpSizeMax
        ? Number(l.lineJumpsSize) : undefined,
      color: edgeColor(l.color),
      headSizeFrom: headSizeValue(l.headSizeFrom),
      headSizeTo: headSizeValue(l.headSizeTo),
      ldx: num(l.ldx, 0),
      ldy: num(l.ldy, 0),
      y: l.y == null ? undefined : num(l.y, 0),
      ...extrasOf(l, LINK_KEYS),
    });
  }).filter(Boolean);

  return clean({
    id,
    name: str(v.name, `Диаграмма ${i + 1}`),
    kind: NOTATION.types[v.kind] ? String(v.kind) : 'class',
    ownerElementId: v.ownerElementId && elementIds.has(String(v.ownerElementId)) ? String(v.ownerElementId) : null,
    shapes,
    links,
    lineJumps: isLineJumps(Number(v.lineJumps)) && Number(v.lineJumps) !== JUMP_INHERIT
      ? Number(v.lineJumps) : undefined,
    lineJumpsSize: Number.isInteger(Number(v.lineJumpsSize))
      && Number(v.lineJumpsSize) > 0 && Number(v.lineJumpsSize) <= MECHANICS.lineJumpSizeMax
      ? Number(v.lineJumpsSize) : undefined,
    ...extrasOf(v, DIAGRAM_KEYS),
  });
}

/**
 * `stereotypeId` — ссылка на запись профиля, и ссылка проверяемая.
 *
 * Нет такой записи — ссылка снимается, имя остаётся, в `repairs` идёт строка:
 * «стереотип st-xxx не найден, оставлено имя interface». Элемент и связь не
 * теряются никогда: профиль может быть другим, выгрузка может быть старой, а
 * молча удалить чужое поле из файла хуже, чем показать его без уточнения.
 *
 * Без профиля проверять нечем — тогда функция ничего не трогает и ничего не
 * выдумывает: модель открывается без уточнения по id и живёт по имени.
 *
 * @param {{elements?: object[], relationships?: object[]}} model
 * @param {object|null} profile  from `parseProfileJson`
 * @param {string[]} repairs     collector the caller already holds
 * @returns {string[]} `repairs`
 */
export function repairStereotypeRefs(model, profile, repairs = []) {
  if (!profile?.byId?.has) return repairs;
  const label = (o) => (String(o?.name ?? '').trim() ? `«${o.name}»` : `«${o?.id ?? '?'}»`);
  for (const [kind, rows] of [['Элемент', model?.elements], ['Связь', model?.relationships]]) {
    for (const item of Array.isArray(rows) ? rows : []) {
      if (!item?.stereotypeId) continue;
      if (profile.byId.has(item.stereotypeId)) continue;
      repairs.push(`${kind} ${label(item)}: стереотип ${item.stereotypeId} не найден — `
        + `оставлено имя «${item.stereotype ?? ''}».`);
      delete item.stereotypeId;
    }
  }
  return repairs;
}

/**
 * Ссылки модели, которые можно проверить только на целом файле.
 *
 * Ни одно поле здесь не переживает пустоту молча: снятая ссылка — это строка
 * в `repairs`, а не тихо опустевшее поле. Единственное исключение — `refersTo`
 * (см. ниже): ссылка на взаимодействие вне файла законна и записана именем.
 */
function validateRefs({ elements, relationships, diagrams, repairs }) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const relById = new Map(relationships.map((r) => [r.id, r]));
  const name = (e) => (String(e?.name ?? '').trim() ? `«${e.name}»` : `«${e?.id ?? '?'}»`);

  // 1. Владение: владелец существует и не он сам.
  for (const e of elements) {
    if (!e.ownerId) continue;
    if (e.ownerId === e.id || !byId.has(e.ownerId)) {
      repairs.push(`Элемент ${name(e)}: владелец ${e.ownerId} не найден — владение снято.`);
      delete e.ownerId;
    }
  }
  // 2. Цикл владения: дерево модели по нему ходит, петля его повесила бы.
  for (const e of elements) {
    if (!e.ownerId) continue;
    const seen = new Set([e.id]);
    let cur = e;
    let loop = false;
    while (cur?.ownerId) {
      if (seen.has(cur.ownerId)) { loop = true; break; }
      seen.add(cur.ownerId);
      cur = byId.get(cur.ownerId);
    }
    if (loop) {
      repairs.push(`Элемент ${name(e)}: владение образует цикл — связь снята.`);
      delete e.ownerId;
    }
  }
  // 3. Ссылки на элементы и диаграммы.
  const diagramIds = new Set(diagrams.map((d) => d.id));
  const diagramByName = new Map(diagrams.map((d) => [String(d.name ?? '').trim(), d.id]));
  for (const e of elements) {
    // Один список на все виды: `represents` дорожки деятельности (§15.2.4) и
    // `represents` линии жизни/шкалы времени (§17.3.4, Lifeline::represents) —
    // это одна и та же ссылка «на что смотрит фигура», и висячая снимается у
    // всех одинаково.
    // `message.signature` здесь НЕТ намеренно: это текст операции, а не
    // ссылка. Загрузчик не имеет права терять текст, которого не понял, —
    // сверку сигнатуры с `operations[]` делает правило, а не чтение файла.
    for (const field of ['laneId', 'represents', 'behaviorRef', 'classifierId']) {
      if (e[field] && !byId.has(e[field])) {
        repairs.push(`Элемент ${name(e)}: ${field} ${e[field]} не найден — ссылка снята.`);
        delete e[field];
      }
    }
    if (e.refersTo && !diagramIds.has(e.refersTo)) {
      const byName = diagramByName.get(String(e.refersTo).trim());
      if (byName) {
        repairs.push(`Элемент ${name(e)}: refersTo «${e.refersTo}» уточнён по имени диаграммы — ${byName}.`);
        e.refersTo = byName;
      } else if (/^d[\w-]*$/.test(e.refersTo)) {
        // Похоже на id и такого id нет — это битая ссылка.
        repairs.push(`Элемент ${name(e)}: refersTo ${e.refersTo} не найден — ссылка снята.`);
        delete e.refersTo;
      }
      // Имя без такой диаграммы остаётся: формат разрешает ссылку на подпоток,
      // которого в этом файле нет, и снять её значило бы потерять данные.
    }
  }
  // 4. Регионы: члены и рёбра существуют, себя регион не содержит.
  for (const e of elements) {
    if (!Array.isArray(e.regions)) continue;
    e.regions = e.regions.map((r) => {
      const out = { id: r.id, name: r.name };
      for (const [key, pool] of [['nodes', byId], ['states', byId], ['edges', relById], ['transitions', relById]]) {
        if (!Array.isArray(r[key])) continue;
        const kept = r[key].filter((x) => pool.has(x) && x !== e.id);
        if (kept.length !== r[key].length) {
          repairs.push(`Элемент ${name(e)}, регион ${r.id}: ${r[key].length - kept.length} ссылок не найдено — сняты.`);
        }
        if (kept.length) out[key] = kept;
      }
      for (const [k, v] of Object.entries(extrasOf(r, REGION_KEYS))) out[k] = v;
      return out;
    });
  }
  // 5. Операнды: покрытие ссылается только на связи вида «сообщение».
  for (const e of elements) {
    if (!Array.isArray(e.operands)) continue;
    e.operands = e.operands.map((o) => {
      const kept = (o.messages ?? []).filter((id) => {
        const rel = relById.get(id);
        return rel && NOTATION.connectors[rel.kind]?.sequence;
      });
      if (kept.length !== (o.messages ?? []).length) {
        repairs.push(`Элемент ${name(e)}, операнд ${o.id}: ${(o.messages ?? []).length - kept.length} ссылок не на сообщения — сняты.`);
      }
      const out = { id: o.id, guard: o.guard, messages: kept };
      for (const [k, v] of Object.entries(extrasOf(o, OPERAND_KEYS))) out[k] = v;
      return out;
    });
  }
}

/**
 * `uml-model/2` → `uml-model/3`: every diagram connector becomes a model
 * relationship plus a link view that points at it. A connector that appears
 * on two diagrams therefore becomes TWO relationships (v2 had no identity to
 * merge on) — the honest reading of a file that never stored one.
 */
function migrateV2(raw, repairs) {
  const base = deserialize({ ...raw, schema: 'uml-model/3', relationships: [], diagrams: [] }, { repairs: [] });
  const relationships = [];
  const diagrams = (Array.isArray(raw.diagrams) ? raw.diagrams : []).map((d, i) => {
    const shapes = Array.isArray(d?.shapes) ? d.shapes : [];
    const byShape = new Map(shapes.map((s) => [String(s.id), String(s.elementId)]));
    const links = [];
    for (const c of (Array.isArray(d?.connectors) ? d.connectors : [])) {
      const fromEl = byShape.get(String(c?.from?.shapeId));
      const toEl = byShape.get(String(c?.to?.shapeId));
      if (!fromEl || !toEl) continue;
      const rel = {
        id: `r-${i}-${relationships.length}`,
        kind: c.kind,
        name: c.name ?? '',
        stereotype: c.stereotype ?? null,
        stereotypeId: c.stereotypeId ?? null,
        documentation: c.documentation ?? '',
        from: fromEl,
        to: toEl,
        fromMultiplicity: c.fromMultiplicity,
        toMultiplicity: c.toMultiplicity,
        fromRole: c.fromRole,
        toRole: c.toRole,
        navigable: 'none',
        fromAggregation: defaultAggregation(c.kind, 'from'),
        toAggregation: defaultAggregation(c.kind, 'to'),
        taggedValues: Array.isArray(c.taggedValues) ? c.taggedValues : [],
      };
      relationships.push(rel);
      links.push({
        id: c.id ?? `l-${i}-${links.length}`,
        relId: rel.id,
        from: c.from,
        to: c.to,
        route: c.route,
        ldx: c.ldx,
        ldy: c.ldy,
      });
    }
    return { ...d, connectors: undefined, links };
  });
  repairs.push(`Файл uml-model/2 прочитан как uml-model/3: связи перенесены в модель (${relationships.length}).`);
  return { ...base, relationships, diagrams };
}

/** `uml-class-diagram/1` → `uml-model/3`: shapes become elements + one diagram. */
function migrateV1(raw, repairs) {
  const elements = [];
  const shapes = [];
  (Array.isArray(raw.shapes) ? raw.shapes : []).forEach((v, i) => {
    if (!v || typeof v !== 'object') { repairs.push(`Фигура ${i + 1} повреждена и пропущена.`); return; }
    const shapeId = v.id == null ? `s${i + 1}` : String(v.id);
    const kind = NOTATION.shapes[v.kind] ? v.kind : firstShape();
    if (kind !== v.kind) repairs.push(`Фигура ${i + 1}: неизвестный тип «${v.kind}», заменён на «${kind}».`);
    const element = clean({
      id: `e-${shapeId}`,
      kind,
      name: str(v.name),
      stereotype: v.stereotype ? str(v.stereotype) : null,
      stereotypeId: v.stereotypeId ? str(v.stereotypeId) : null,
      documentation: str(v.documentation),
      taggedValues: readTVs(v.taggedValues),
      attributes: readMembers(v.attributes),
      operations: readMembers(v.operations),
      literals: readMembers(v.literals),
      note: str(v.note),
    });
    elements.push(element);
    shapes.push(clean({
      id: shapeId,
      elementId: element.id,
      x: num(v.x, 40), y: num(v.y, 40), w: num(v.w, 190), h: num(v.h, 120),
      fixedH: v.fixedH ? true : undefined,
      fill: readFill(v.fill),
    }));
  });

  const byShape = new Map(shapes.map((s) => [s.id, s.elementId]));
  const relationships = [];
  const links = [];
  (Array.isArray(raw.connectors) ? raw.connectors : []).forEach((c, j) => {
    if (!c || typeof c !== 'object') return;
    const fromEl = byShape.get(String(c?.from?.shapeId));
    const toEl = byShape.get(String(c?.to?.shapeId));
    if (!fromEl || !toEl) { repairs.push(`Связь ${j + 1} пропущена: нет фигуры на конце.`); return; }
    const rel = {
      id: `r${j + 1}`,
      kind: NOTATION.connectors[c.kind] ? c.kind : firstConn(),
      name: str(c.name),
      stereotype: c.stereotype ? str(c.stereotype) : null,
      stereotypeId: c.stereotypeId ? str(c.stereotypeId) : null,
      documentation: str(c.documentation),
      from: fromEl,
      to: toEl,
      fromMultiplicity: c.fromMultiplicity,
      toMultiplicity: c.toMultiplicity,
      fromRole: c.fromRole,
      toRole: c.toRole,
      navigable: 'none',
      fromAggregation: defaultAggregation(c.kind, 'from'),
      toAggregation: defaultAggregation(c.kind, 'to'),
      taggedValues: readTVs(c.taggedValues),
    };
    relationships.push(rel);
    links.push({ id: `l${j + 1}`, relId: rel.id, from: c.from, to: c.to, route: c.route, ldx: c.ldx, ldy: c.ldy });
  });

  const diagram = { id: 'd1', name: str(raw.name, 'Диаграмма 1'), kind: 'class', shapes, links };
  repairs.push(`Файл ${raw.schema} прочитан как uml-model/3: ${elements.length} элементов, 1 диаграмма.`);

  return {
    schema: SCHEMA,
    id: raw.id ? String(raw.id) : `m${Date.now().toString(36)}`,
    name: str(raw.name, 'Новая модель'),
    created: str(raw.created),
    revised: str(raw.revised),
    elements,
    relationships,
    generalizationSets: [],
    diagrams: [diagram],
    currentDiagramId: diagram.id,
  };
}

function readMembers(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      if (r.text != null && r.name == null) return parseV1Line(str(r.text), r.vis);
      return clean({
        vis: ['public', 'private', 'protected', 'package'].includes(r.vis) ? r.vis : 'public',
        name: str(r.name),
        type: str(r.type),
        default: str(r.default),
        isStatic: r.isStatic === true,
        isDerived: r.isDerived === true,
        isID: r.isID === true,
        isAbstract: r.isAbstract === true,
      });
    });
}

function readTimeline(rows) {
  if (!Array.isArray(rows) || !rows.length) return [{ state: 'Состояние', from: 0, to: 100 }];
  return rows
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ state: str(s.state), from: num(s.from, 0), to: num(s.to, 100) }));
}

function parseV1Line(text, vis) {
  let body = String(text ?? '').trim();
  let key = ['public', 'private', 'protected', 'package'].includes(vis) ? vis : 'public';
  if (!body) return { vis: key, name: '', type: '', default: '' };
  let def = '';
  const eq = body.lastIndexOf(' = ');
  if (eq > 0) { def = body.slice(eq + 3).trim(); body = body.slice(0, eq).trim(); }
  let name = body;
  let type = '';
  const colon = body.lastIndexOf(':');
  if (colon > 0) { name = body.slice(0, colon).trim(); type = body.slice(colon + 1).trim(); }
  return { vis: key, name, type, default: def };
}

function readTVs(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((t) => t && typeof t === 'object' && t.name != null)
    .map((t) => ({ name: str(t.name), value: str(t.value) }));
}

function readEnd(e, ids) {
  if (!e || typeof e !== 'object' || e.shapeId == null) return null;
  if (!ids.has(String(e.shapeId))) return null;
  const side = ['top', 'right', 'bottom', 'left'].includes(e.side) ? e.side : 'bottom';
  const end = { shapeId: String(e.shapeId), side, t: Math.min(1, Math.max(0, num(e.t, 0.5))) };
  // Доля+смещение главнее стороны: она переживает ресайз и умеет висеть вне
  // рамки. Обрезать её значения нельзя — это координата, а не множитель 0…1.
  const attach = attachOfEnd(e);
  if (attach) end.attach = attach;
  return end;
}
