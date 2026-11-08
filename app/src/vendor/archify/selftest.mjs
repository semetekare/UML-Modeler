// Самопроверка копии: доказывает, что скопированные модули archify грузятся и
// что мост к модели работает. Запуск:
//
//   node app/src/vendor/archify/selftest.mjs [модель.json]
//
// По умолчанию берётся app/material/demo-errors.json — демонстрационный набор,
// где нарушения расставлены намеренно. Печатает счётчики по видам замечаний и
// первые примеры. Это инструмент разработчика (Node), в браузер он не едет.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { geometryFindings, GEOMETRY_RULE_IDS } from './geometry-adapter.mjs';
import { rectsOverlap, cleanCrossingProblems, collectArrowheadCollisions } from './renderers/shared/geometry.mjs';
import { shortestOrthogonalGridRoute } from './renderers/shared/route-quality.mjs';
import { fittedNodeFontSize, minimumNodeTextWidth } from './renderers/shared/text-fit.mjs';
import { projectedNodeTextPx } from './renderers/shared/desktop-readability.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..', '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(APP, 'material', 'demo-errors.json');

const model = JSON.parse(readFileSync(target, 'utf8'));
console.log('модель:', path.relative(APP, target));
console.log('элементов:', (model.elements ?? []).length,
  'связей:', (model.relationships ?? []).length,
  'листов:', (model.diagrams ?? []).length);

// 1. Скопированные функции отвечают на прямых входах.
const boxA = { x: 0, y: 0, width: 100, height: 50 };
const boxB = { x: 50, y: 25, width: 100, height: 50 };
const boxC = { x: 200, y: 0, width: 100, height: 50 };
console.log('\n[1] geometry.rectsOverlap:',
  'перекрытие =', rectsOverlap(boxA, boxB), '(ожидается true),',
  'разнесены =', rectsOverlap(boxA, boxC), '(ожидается false)');
console.log('[1] text-fit: «Оплатить заказ» при 11px нужно',
  Math.round(minimumNodeTextWidth('Оплатить заказ', 11)), 'px; в рамке 180px влезает кеглем',
  fittedNodeFontSize('Оплатить заказ', 180, 11, 1), 'px');
console.log('[1] desktop-readability: 11px на листе 1300px при окне 930px →',
  projectedNodeTextPx(11, 1300).toFixed(1), 'px');
const route = shortestOrthogonalGridRoute({
  start: [0, 0], end: [200, 100], fromSide: 'right', toSide: 'left', clearance: 8,
  points: [[0, 0], [200, 100], [0, 50], [200, 50], [100, 0], [100, 100]],
  obstacles: [{ x: 80, y: 20, width: 40, height: 40 }],
});
console.log('[1] route-quality.shortestOrthogonalGridRoute: точек', route?.points?.length ?? 0,
  route?.points ? JSON.stringify(route.points) : '(нет маршрута)');
console.log('[1] collectArrowheadCollisions на пустом входе:',
  collectArrowheadCollisions({ routedRelations: [] }).length, 'хитов');
console.log('[1] cleanCrossingProblems на пустом входе:',
  cleanCrossingProblems({ relations: [], endpointIds: new Set(), pathFor: () => null, diagramType: 'class', relationCollection: 'relationships' }).length, 'проблем');

// 2. Мост к модели: настоящие замечания по настоящей модели.
// Нотация нужна мосту, чтобы не судить актёров (имя под фигурой) и переносимые
// виды текста; в браузере её передаёт панель, здесь читаем тот же uml.json.
let notation = null;
try { notation = JSON.parse(readFileSync(path.join(APP, 'notation', 'uml.json'), 'utf8')); } catch { notation = null; }
const findings = geometryFindings(model, { notation });
console.log('\n[2] geometryFindings:', findings.length, 'замечаний');
const byRule = new Map();
for (const f of findings) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
for (const id of GEOMETRY_RULE_IDS) console.log('    ', id, '→', byRule.get(id) ?? 0);

const unknown = findings.filter((f) => !GEOMETRY_RULE_IDS.includes(f.ruleId));
if (unknown.length) console.log('    ВНИМАНИЕ: замечания с неизвестным ruleId:', unknown.length);

console.log('\n[3] примеры (до 6):');
for (const f of findings.slice(0, 6)) {
  console.log(`  - ${f.diagramId} ${f.ruleId}: ${f.detail}`);
}

// 4. Каждое замечание должно указывать на существующий элемент и лист.
const elementIds = new Set((model.elements ?? []).map((e) => e.id));
const diagramIds = new Set((model.diagrams ?? []).map((d) => d.id));
const broken = findings.filter((f) => !diagramIds.has(f.diagramId) || f.targets.some((t) => !elementIds.has(t)));
console.log('\n[4] замечаний с несуществующей целью:', broken.length, '(ожидается 0)');
if (broken.length) process.exitCode = 1;
