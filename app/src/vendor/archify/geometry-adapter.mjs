// Мост между моделью редактора и проверками геометрии из archify 3.0.1.
//
// Что делает: берёт модель (diagrams[].shapes[] = {x, y, w, h}) и прогоняет
// три проверки archify — пересечение рамок (geometry.rectsOverlap), влезает ли
// имя в рамку (text-fit) и не станет ли текст нечитаемым при вписывании листа в
// окно читателя 960 px (desktop-readability). Результат — замечания в том же
// виде, в каком их ждёт панель «Проверки» (src/rules/finding.js): ruleId,
// level, basis, message, detail, hint, targets, diagramId.
//
// Почему слой отдельный: правила UML 2.5.1 и правила практики судят МОДЕЛЬ
// (кто с кем связан), а эти замечания — про ЛИСТ (что где нарисовано). Одна и
// та же модель с разной раскладкой даёт разные замечания, поэтому `basis`
// здесь свой — 'geometry', и панели нужен четвёртый раздел, а не подмешивание
// в «практику».
//
// Чего здесь нет и почему: проверки пересечений маршрутов (cleanCrossingProblems,
// collectArrowheadCollisions, cleanAmbiguousCorridorProblems) требуют готовых
// точек маршрута, а у связи в модели только {from, to, side} — маршрут
// считается при отрисовке. Чтобы включить их, надо позвать их из места, где
// маршрут уже посчитан (src/model/geometry.js → routeOf), и передать
// {routedRelations: [{relation, points}]}. Проверки готовы, нужен источник точек.
//
// Ничего не импортирует из Node — файл годится для браузера как есть.

import { rectsOverlap } from './renderers/shared/geometry.mjs';
import {
  minimumNodeTextWidth, availableNodeTextWidth, fittedNodeFontSize,
} from './renderers/shared/text-fit.mjs';
import { projectedNodeTextPx, MIN_PROJECTED_NODE_TEXT_PX } from './renderers/shared/desktop-readability.mjs';

/** Размер имени в модели: 11 px Arial (см. app/src/model/geometry.js). */
export const DEFAULT_NAME_FONT_PX = 11;

/** Виды, которые по своей природе лежат ПОВЕРХ содержимого или на его рамке. */
const CONTAINERS = new Set([
  'package', 'model', 'profile', 'systemBoundary', 'swimlane', 'fragment',
  'interaction', 'interactionUse', 'node', 'executionEnvironment', 'deploymentSpec',
  'device', 'timingLane', 'loop', 'opt', 'alt', 'par',
]);
/**
 * Виды-классификаторы: фигура ЦЕЛИКОМ внутри такой — это вложенный
 * классификатор (UML 2.5.1 §9.2, «nested classifier»), а не наложение.
 *
 * Почему отдельно от CONTAINERS: у рамки (пакет, узел, фрагмент) содержимое
 * может торчать за кромку по замыслу, поэтому там достаточно центра внутри.
 * У класса и компонента такого права нет: часть, вылезшая за рамку, — уже
 * нечитаемо, и это настоящая находка. Поэтому здесь требуется ПОЛНОЕ
 * вложение, и только оно.
 *
 * Почему это вообще нужно: в модели владение (`ownerId`) не всегда совпадает
 * с картинкой. На контрольной `component-nested-in-class.ok.json` компонент
 * «Оплата» нарисован внутри класса «Заказ» и принадлежит ему же — до этой
 * правки слой объявлял здоровую диаграмму двумя перекрытиями.
 */
const NESTABLE = new Set([
  'class', 'interface', 'collaboration', 'part', 'datatype', 'enumeration',
  'component', 'artifact',
]);
const ON_BORDER = new Set(['port', 'pin', 'activityParameter', 'activation']);
/** Виды листов взаимодействия: рамка фрагмента НАКРЫВАЕТ линии жизни по замыслу. */
const INTERACTION_KINDS = new Set(['sequence', 'interaction', 'timing']);
const FRAMES = new Set(['fragment', 'interactionUse', 'loop', 'opt', 'alt', 'par', 'break']);
const LIFELINES = new Set(['lifeline', 'actorLifeline', 'activation']);
const NO_TEXT = new Set([
  'port', 'activation', 'fork', 'join', 'merge', 'decision', 'initial', 'final',
  'junction', 'choice', 'historyShallow', 'historyDeep', 'pin', 'activityParameter',
]);

const rectOf = (shape) => ({ x: shape.x, y: shape.y, width: shape.w, height: shape.h });
const inside = (inner, outer) => inner.x >= outer.x
  && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width
  && inner.y + inner.height <= outer.y + outer.height;
const centerInside = (inner, outer) => {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width
    && cy >= outer.y && cy <= outer.y + outer.height;
};

/**
 * `ancestorId` — владелец `childId` на любом уровне вложенности.
 *
 * Предел глубины здесь не украшение: у битого файла `ownerId` может указывать
 * сам на себя, и без счётчика обход завис бы навсегда. 32 уровней хватает
 * любой нотации, которую редактор умеет открыть.
 */
function isAncestor(ancestorId, childId, owners) {
  let cur = owners.get(childId) ?? null;
  let guard = 0;
  while (cur && guard++ < 32) {
    if (cur === ancestorId) return true;
    cur = owners.get(cur) ?? null;
  }
  return false;
}

function finding({ ruleId, level, message, detail, hint, targets, diagramId }) {
  return {
    ruleId,
    level,
    basis: 'geometry',
    message,
    detail: detail ?? '',
    hint,
    clause: null,
    constraint: null,
    page: null,
    rationale: null,
    targets: (Array.isArray(targets) ? targets : [targets]).filter((id) => id != null).map(String),
    diagramId: diagramId ?? null,
  };
}

function elementIndex(model) {
  const byId = new Map();
  for (const el of model.elements ?? []) byId.set(el.id, el);
  return byId;
}

function shapesOf(model, diagram) {
  const elements = elementIndex(model);
  const out = [];
  for (const shape of diagram.shapes ?? []) {
    const element = elements.get(shape.elementId);
    if (!element) continue;
    out.push({ shape, element, kind: String(element.kind ?? ''), rect: rectOf(shape) });
  }
  return out;
}

const labelOf = (element) => (String(element?.name ?? '').trim()
  ? `«${element.name}» (${element.kind})`
  : `элемент вида «${element.kind}» без имени`);

/** 1. Две рамки на одном листе налезают друг на друга. */
export function overlapFindings(model) {
  const findings = [];
  const owners = new Map((model.elements ?? []).map((e) => [e.id, e.ownerId ?? null]));
  for (const diagram of model.diagrams ?? []) {
    const shapes = shapesOf(model, diagram);
    const interaction = INTERACTION_KINDS.has(String(diagram.kind ?? ''));
    for (let i = 0; i < shapes.length; i += 1) {
      for (let j = i + 1; j < shapes.length; j += 1) {
        const a = shapes[i];
        const b = shapes[j];
        if (ON_BORDER.has(a.kind) || ON_BORDER.has(b.kind)) continue;
        if (interaction && ((FRAMES.has(a.kind) && LIFELINES.has(b.kind))
          || (FRAMES.has(b.kind) && LIFELINES.has(a.kind)))) continue;
        if (!rectsOverlap(a.rect, b.rect)) continue;
        // Владение в модели — самый сильный признак: если один элемент
        // принадлежит другому (транзитивно), их фигуры нарисованы друг в
        // друге по замыслу, и «наложение» — это вложенность. Проверка идёт
        // раньше геометрии: у перенесённой фигуры картинка может разъехаться
        // с владением, но виноват тогда не лист.
        if (isAncestor(a.element.id, b.element.id, owners)
          || isAncestor(b.element.id, a.element.id, owners)) continue;
        // Классификатор внутри классификатора — вложение, но только когда
        // фигура целиком внутри рамки: вылезшая за кромку часть — находка.
        if (NESTABLE.has(a.kind) && inside(b.rect, a.rect)) continue;
        if (NESTABLE.has(b.kind) && inside(a.rect, b.rect)) continue;
        // Пакет/фрагмент/дорожка законно содержат фигуры внутри себя: у
        // фрагмента рамка выше и ниже линии жизни, поэтому «целиком внутри»
        // для них не работает — считаем содержимым то, чей центр попал внутрь.
        if (CONTAINERS.has(a.kind) && inside(b.rect, a.rect)) continue;
        if (CONTAINERS.has(b.kind) && inside(a.rect, b.rect)) continue;
        if (CONTAINERS.has(a.kind) && centerInside(b.rect, a.rect)) continue;
        if (CONTAINERS.has(b.kind) && centerInside(a.rect, b.rect)) continue;
        const overlapW = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);
        const overlapH = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);
        findings.push(finding({
          ruleId: 'geometry-shapes-overlap',
          level: 'warning',
          message: 'Две фигуры на одном листе перекрываются',
          detail: `${labelOf(a.element)} и ${labelOf(b.element)} налезают друг на друга на ${Math.round(overlapW)}×${Math.round(overlapH)} px.`,
          hint: 'Разведите фигуры или уменьшите ту, что перекрывает: подпись и порты соседа читаются хуже, чем кажется на большом экране.',
          targets: [a.element.id, b.element.id],
          diagramId: diagram.id,
        }));
      }
    }
  }
  return findings;
}

/** 2. Имя не влезает в рамку даже минимальным кеглем.
 *
 * Две поправки под нашу нотацию (без них проверка шумит на здоровых листах):
 *   - у актёра имя нарисовано ПОД фигурой и может быть шире её, поэтому рамка
 *     актёра о ширине текста ничего не говорит;
 *   - у видов с `wrap: true` (примечание, текст) строка переносится по словам,
 *     и «шире рамки» для них — норма.
 * `notation` — это NOTATION.shapes из src/model/notation.js; `measure` —
 * функция (text, fontPx) → px, чтобы в браузере считать настоящим
 * measureText из src/model/geometry.js, а не приближением archify.
 */
export function textFitFindings(model, { fontPx = DEFAULT_NAME_FONT_PX, measure = null, notation = null } = {}) {
  const findings = [];
  const defs = notation?.shapes ?? null;
  const widthOf = typeof measure === 'function'
    ? (text) => measure(text, fontPx)
    : (text) => minimumNodeTextWidth(text, fontPx);
  for (const diagram of model.diagrams ?? []) {
    for (const { shape, element, kind } of shapesOf(model, diagram)) {
      if (NO_TEXT.has(kind)) continue;
      const def = defs?.[kind];
      if (def?.nameless || def?.wrap || def?.style === 'actor') continue;
      const name = String(element.name ?? '').trim();
      if (!name) continue;
      const needs = widthOf(name);
      const available = availableNodeTextWidth(shape.w);
      if (needs <= available) continue;
      const fitted = fittedNodeFontSize(name, shape.w, fontPx, 1);
      findings.push(finding({
        ruleId: 'geometry-text-does-not-fit',
        level: 'warning',
        message: 'Имя элемента шире своей рамки',
        detail: `${labelOf(element)}: имя «${name}» нужно ${Math.round(needs)} px, внутри рамки ${Math.round(available)} px; чтобы влезло, кегль придётся уронить до ${fitted} px.`,
        hint: 'Расширьте фигуру или сократите имя: текст в фигуре не переносится и вылезает на соседей.',
        targets: [element.id],
        diagramId: diagram.id,
      }));
    }
  }
  return findings;
}

/** 3. Лист шире окна читателя — текст ужмётся ниже 6 px. */
export function readabilityFindings(model, { fontPx = DEFAULT_NAME_FONT_PX } = {}) {
  const findings = [];
  for (const diagram of model.diagrams ?? []) {
    const shapes = (diagram.shapes ?? []).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.w));
    if (!shapes.length) continue;
    const left = Math.min(...shapes.map((s) => s.x));
    const right = Math.max(...shapes.map((s) => s.x + s.w));
    const width = right - left;
    const projected = projectedNodeTextPx(fontPx, width);
    if (!Number.isFinite(projected) || projected >= MIN_PROJECTED_NODE_TEXT_PX) continue;
    findings.push(finding({
      ruleId: 'geometry-text-too-small',
      level: 'warning',
      message: 'На узком окне подписи листа станут нечитаемыми',
      detail: `Лист шириной ${Math.round(width)} px при вписывании в окно читателя 960 px даёт кегль ${projected.toFixed(1)} px — ниже порога ${MIN_PROJECTED_NODE_TEXT_PX} px.`,
      hint: 'Разделите лист на два или разложите его компактнее: иначе читатель увидит текст мельче 6 px.',
      targets: [],
      diagramId: diagram.id,
    }));
  }
  return findings;
}

/** Все три проверки за один проход — то, что зовёт панель «Проверки». */
export function geometryFindings(model, options = {}) {
  if (!model || typeof model !== 'object') throw new Error('нужна модель');
  return [
    ...overlapFindings(model, options),
    ...textFitFindings(model, options),
    ...readabilityFindings(model, options),
  ];
}

export const GEOMETRY_RULE_IDS = [
  'geometry-shapes-overlap',
  'geometry-text-does-not-fit',
  'geometry-text-too-small',
];
