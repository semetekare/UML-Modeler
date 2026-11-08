// Счётчик пробелов корпуса: сколько кодов `model.*` схема `uml-model/3`
// ещё не выражает (план Э2-бис, §1 и §5 п.4).
//
// Счётчик не верит списку — он ПРОБУЕТ. Каждый код получает пробу: маленькая
// модель с этим полем проходит serialize → deserialize → serialize, и код
// считается закрытым только если поле на месте с тем же значением и байты
// второго прогона совпали. Так «объявить победу, не сдвинув числа» не выйдет:
// убрать чтение поля из загрузчика — и проба падает, а счётчик растёт.
//
//   node tests/gaps.mjs            таблица «партия → закрыто → осталось»
//   import { gapReport } from './gaps.mjs'
//
// Корпус (tests/corpus/MANIFEST.json) — источник частот: `gapVocabulary`
// называет 17 кодов `model.*`, все 17 здесь. Два последних кода — не из
// корпуса: это поля плана 2b (`lifeline.represents`, `message.signature`),
// которых в 48 моделях пособия пока нет. Они всё равно получают пробу: поле,
// объявленное в схеме, но не проверенное кругом, — это обещание, а не работа.
// Партия `2b` отделяет их от корпусных Б1…Б9, чтобы числа корпуса не менялись.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Модель из голых объектов; всё, чего нет, — умолчания читателя. */
const model = (elements, relationships, diagram = {}) => ({
  schema: 'uml-model/3',
  id: 'mGap',
  name: 'Проба',
  created: '2026-11-05',
  elements,
  relationships,
  diagrams: [{ id: 'd1', name: 'D', kind: 'class', shapes: [], links: [], ...diagram }],
  currentDiagramId: 'd1',
});

const el = (id, kind, name, extra = {}) => ({ id, kind, name, ...extra });

const LIFELINES = [
  el('e1', 'lifeline', 'a'), el('e2', 'lifeline', 'b'),
];

/**
 * Каждая проба возвращает true, только когда поле пережило круг.
 * `rt` — общий помощник (см. `makeRt`): он и есть проверка, а не утверждение.
 */
export const GAP_CODES = [
  {
    code: 'model.packageOwner',
    party: 'Б1',
    field: 'ownerId',
    probe: (rt) => {
      const r = rt(model([el('e1', 'package', 'P'), el('e2', 'class', 'C', { ownerId: 'e1' })], []));
      return r.m2.elements[1]?.ownerId === 'e1' && r.stable;
    },
  },
  {
    code: 'model.nodeNesting',
    party: 'Б1',
    field: 'ownerId',
    probe: (rt) => {
      const r = rt(model([el('e1', 'node', 'Сервер'), el('e2', 'component', 'Ядро', { ownerId: 'e1' })], []));
      return r.m2.elements[1]?.ownerId === 'e1' && r.stable;
    },
  },
  {
    code: 'model.lostMessage',
    party: 'Б2',
    field: 'to = null',
    probe: (rt) => {
      const r = rt(model(LIFELINES, [{ id: 'r1', kind: 'reply', name: 'c <> NULL', from: 'e1', to: null }],
        { kind: 'sequence' }));
      return r.m2.relationships[0]?.to === null && r.stable;
    },
  },
  {
    code: 'model.messageOrder',
    party: 'Б2',
    field: 'seq',
    probe: (rt) => {
      const r = rt(model(LIFELINES, [
        { id: 'r1', kind: 'message', name: 'a', from: 'e1', to: 'e2', seq: 20 },
        { id: 'r2', kind: 'message', name: 'b', from: 'e2', to: 'e1', seq: 10 },
      ], { kind: 'sequence' }));
      return r.m2.relationships.map((x) => x.seq).join(',') === '20,10' && r.stable;
    },
  },
  {
    code: 'model.async',
    party: 'Б2',
    field: 'asynchronous',
    probe: (rt) => {
      const r = rt(model(LIFELINES, [{ id: 'r1', kind: 'message', name: 'go', from: 'e1', to: 'e2', asynchronous: true }],
        { kind: 'sequence' }));
      return r.m2.relationships[0]?.asynchronous === true && r.stable;
    },
  },
  {
    code: 'model.multiObject',
    party: 'Б3',
    field: 'multiObject',
    probe: (rt) => {
      const r = rt(model([el('e1', 'lifeline', 'studlist[i]:Student', { multiObject: true })], [], { kind: 'sequence' }));
      return r.m2.elements[0]?.multiObject === true && r.stable;
    },
  },
  {
    code: 'model.lifelineState',
    party: 'Б3',
    field: 'stopped',
    probe: (rt) => {
      const r = rt(model([el('e1', 'lifeline', 's', { stopped: true })], [], { kind: 'sequence' }));
      return r.m2.elements[0]?.stopped === true && r.stable;
    },
  },
  {
    code: 'model.fragmentCoverage',
    party: 'Б4',
    field: 'operands[].messages',
    probe: (rt) => {
      const r = rt(model([...LIFELINES, el('e5', 'fragment', 'alt', {
        operator: 'alt', operands: [{ id: 'o1', guard: 'иначе', messages: ['r1'] }],
      })], [{ id: 'r1', kind: 'message', name: 'm', from: 'e1', to: 'e2' }], { kind: 'sequence' }));
      return r.m2.elements[2]?.operands?.[0]?.messages?.join(',') === 'r1' && r.stable;
    },
  },
  {
    code: 'model.fragmentOperands',
    party: 'Б4',
    field: 'operands[]',
    probe: (rt) => {
      const r = rt(model([...LIFELINES, el('e5', 'fragment', 'alt', {
        operator: 'alt',
        operands: [{ id: 'o1', guard: 'a' }, { id: 'o2', guard: 'b' }],
      })], [], { kind: 'sequence' }));
      const ops = r.m2.elements[2]?.operands ?? [];
      return ops.length === 2 && ops[1].guard === 'b' && r.stable;
    },
  },
  {
    code: 'model.interactionRef',
    party: 'Б5',
    field: 'refersTo',
    probe: (rt) => {
      const r = rt({
        ...model([el('e1', 'interactionUse', 'Subflow', { operator: 'ref', refersTo: 'd2' })], []),
        diagrams: [
          { id: 'd1', name: 'Главная', kind: 'sequence', shapes: [], links: [] },
          { id: 'd2', name: 'Подпоток', kind: 'sequence', shapes: [], links: [] },
        ],
      });
      return r.m2.elements[0]?.refersTo === 'd2' && r.stable;
    },
  },
  {
    code: 'model.instanceClassifier',
    party: 'Б5',
    field: 'classifierId',
    probe: (rt) => {
      const r = rt(model([el('e1', 'class', 'Student'), el('e2', 'object', 's:Student', { classifierId: 'e1' })], []));
      return r.m2.elements[1]?.classifierId === 'e1' && r.stable;
    },
  },
  {
    code: 'model.swimlane',
    party: 'Б6',
    field: 'laneId',
    probe: (rt) => {
      const r = rt(model([
        el('e1', 'swimlane', 'Пользователь', { represents: 'e3' }),
        el('e2', 'action', 'Войти', { laneId: 'e1' }),
        el('e3', 'actor', 'Пользователь'),
      ], [], { kind: 'activity' }));
      return r.m2.elements[0]?.represents === 'e3' && r.m2.elements[1]?.laneId === 'e1' && r.stable;
    },
  },
  {
    code: 'model.callBehavior',
    party: 'Б6',
    field: 'behaviorRef',
    probe: (rt) => {
      const r = rt(model([
        el('e1', 'action', 'Войти', { behaviorRef: 'e2' }),
        el('e2', 'activity', 'Авторизация'),
      ], [], { kind: 'activity' }));
      return r.m2.elements[0]?.behaviorRef === 'e2' && r.stable;
    },
  },
  {
    code: 'model.structuredNode',
    party: 'Б7',
    field: 'regions',
    probe: (rt) => {
      const r = rt(model([
        el('e1', 'action', 'Conditional', { regions: [{ id: 'g1', name: 'тело', nodes: ['e2'] }] }),
        el('e2', 'action', 'внутри'),
      ], [], { kind: 'activity' }));
      const reg = r.m2.elements[0]?.regions?.[0];
      return reg?.nodes?.join(',') === 'e2' && reg.name === 'тело' && r.stable;
    },
  },
  {
    code: 'model.stateRegion',
    party: 'Б8',
    field: 'regions',
    probe: (rt) => {
      const r = rt(model([
        el('e1', 'state', 'Active', { regions: [{ id: 'g1', states: ['e2'] }] }),
        el('e2', 'state', 'Open'),
      ], [], { kind: 'state' }));
      return r.m2.elements[0]?.regions?.[0]?.states?.join(',') === 'e2' && r.stable;
    },
  },
  {
    code: 'model.internalTransition',
    party: 'Б8',
    field: 'internals / local',
    probe: (rt) => {
      const r = rt(model([
        el('e1', 'state', 'Active', { internals: [{ trigger: 'тик', guard: 'готов', effect: 'считать' }] }),
        el('e2', 'state', 'Open'),
      ], [{ id: 'r1', kind: 'transition', name: 't', from: 'e1', to: 'e2', local: true }], { kind: 'state' }));
      const row = r.m2.elements[0]?.internals?.[0];
      return row?.trigger === 'тик' && row.effect === 'считать'
        && r.m2.relationships[0]?.local === true && r.stable;
    },
  },
  {
    code: 'model.qualifier',
    party: 'Б9',
    field: 'fromQualifiers / toQualifiers',
    probe: (rt) => {
      const r = rt(model([el('e1', 'class', 'A'), el('e2', 'class', 'B')],
        [{ id: 'r1', kind: 'association', from: 'e1', to: 'e2', fromQualifiers: ['code'], toQualifiers: ['semester'] }]));
      return r.m2.relationships[0]?.fromQualifiers?.join(',') === 'code'
        && r.m2.relationships[0]?.toQualifiers?.join(',') === 'semester' && r.stable;
    },
  },
  {
    code: 'model.messageSignature',
    party: '2b',
    field: 'signature',
    probe: (rt) => {
      // Имя и сигнатура — разные поля: имя остаётся меткой на линии, сигнатура
      // несёт операцию. Проба требует, чтобы пережили ОБА и чтобы сигнатура не
      // подменила имя.
      const r = rt(model(LIFELINES, [
        { id: 'r1', kind: 'message', name: 'зарегистрировать', from: 'e1', to: 'e2', signature: 'register(st: Student)' },
        { id: 'r2', kind: 'reply', from: 'e2', to: 'e1', signature: 'ok: boolean' },
      ], { kind: 'sequence' }));
      const rs = r.m2.relationships;
      return rs[0]?.signature === 'register(st: Student)' && rs[0]?.name === 'зарегистрировать'
        && rs[1]?.signature === 'ok: boolean' && r.stable;
    },
  },
  {
    code: 'model.lifelineRepresents',
    party: '2b',
    field: 'represents',
    probe: (rt) => {
      // Линия жизни — тот же `represents`, что у дорожки деятельности, но
      // проверять надо и её: поле общее, а вид другой. Вторая половина пробы —
      // намеренная поломка: висячая ссылка обязана сниматься с ремонтом, иначе
      // «поле пережило круг» значило бы «читатель тащит в модель что попало».
      const r = rt(model([
        el('e1', 'lifeline', '', { represents: 'e3' }),
        el('e2', 'lifeline', 'curStud', { represents: 'e3' }),
        el('e3', 'class', 'Student'),
      ], [], { kind: 'sequence' }));
      const bad = rt(model([el('e1', 'lifeline', 's', { represents: 'e404' })], [], { kind: 'sequence' }));
      return r.m2.elements[0]?.represents === 'e3' && r.m2.elements[1]?.represents === 'e3'
        && !bad.m1.elements[0]?.represents && bad.repairs.some((x) => /represents e404/.test(x))
        && r.stable;
    },
  },
];

/** Общий помощник круга — тот же, что в smoke.mjs и types.mjs. */
export function makeRt(deserialize, serialize) {
  return (obj) => {
    const text = `${JSON.stringify(obj, null, 2)}\n`;
    const repairs = [];
    const m1 = deserialize(text, { repairs });
    const out = serialize(m1);
    const m2 = deserialize(out, { repairs: [] });
    return { m1, m2, text, out, repairs, stable: serialize(m2) === out };
  };
}

/** Отчёт: у каждого кода — закрыт ли он и каким полем. */
export function gapReport(rt) {
  return GAP_CODES.map((g) => {
    let closed = false;
    try { closed = g.probe(rt) === true; } catch { closed = false; }
    return { code: g.code, party: g.party, field: g.field, closed };
  });
}

/** Сколько кодов осталось открытыми и какие. */
export const stillOpen = (report) => report.filter((r) => !r.closed).map((r) => r.code);

/** Таблица «партия → закрыто кодов → осталось», как её просят в задании. */
export function gapTable(report) {
  const parties = [...new Set(report.map((r) => r.party))];
  const total = report.length;
  let closedSoFar = 0;
  const rows = [];
  for (const party of parties) {
    const closed = report.filter((r) => r.party === party && r.closed).length;
    closedSoFar += closed;
    rows.push({ party, closed, total: total - closedSoFar });
  }
  return rows;
}

/* ------------------------------------------------------------------ CLI */

if (process.argv[1] && process.argv[1].endsWith('gaps.mjs')) {
  const { readFile: read } = await import('node:fs/promises');
  const { applyPackage } = await import('../src/model/notation.js');
  const { deserialize, serialize } = await import('../src/io/umljson.js');
  applyPackage(JSON.parse(await read(path.join(ROOT, 'notation', 'uml.json'), 'utf8')));
  const report = gapReport(makeRt(deserialize, serialize));
  const rows = gapTable(report);
  const width = Math.max(...rows.map((r) => r.party.length));
  console.log('партия → закрыто кодов → осталось');
  for (const r of rows) {
    console.log(`  ${r.party.padEnd(width)}  +${r.closed}  → осталось ${r.total}`);
  }
  const open = stillOpen(report);
  console.log(`\nвсего кодов: ${report.length}, осталось: ${open.length}${open.length ? ` (${open.join(', ')})` : ''}`);
  process.exit(open.length ? 1 : 0);
}
