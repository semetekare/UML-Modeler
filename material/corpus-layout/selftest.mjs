// Самопроверка check.mjs: каждый вид замечания должен действительно
// срабатывать. Берём готовые листы, портим по одному признаку и убеждаемся,
// что проверка это называет своим кодом. Без этого «0 замечаний» ничего не
// доказывает.
//
// Запуск: node material/corpus-layout/selftest.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSheet } from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-layout-'));

const read = (figure) => JSON.parse(fs.readFileSync(path.join(HERE, `${figure}.uml.json`), 'utf8'));
const put = (figure, model) => {
  fs.writeFileSync(path.join(tmp, `${figure}.uml.json`), `${JSON.stringify(model, null, 2)}\n`);
  return tmp;
};
const codesOf = (figure, audit = false) => checkSheet(figure, { layoutDir: tmp, audit }).fails.map((f) => f.code);

const cases = [];
// `audit: true` — случай про проверки за флагом `--audit`; `absent` — код,
// которого быть НЕ должно (проверка обязана молчать на здоровой серии).
const add = (name, expect, figure, mutate, opts = {}) => cases.push({
  name, expect, figure, mutate, audit: opts.audit === true, absent: opts.absent ?? [],
});

// 1. потерян элемент
add('элемент выброшен', 'состав', '4103', (m) => {
  m.elements.pop();
  m.diagrams[0].shapes.pop();
  return m;
});

// 2. выдуман элемент
add('лишний элемент', 'состав', '4103', (m) => {
  m.elements.push({ id: 'e999', kind: 'class', name: 'Выдуманный' });
  return m;
});

// 3. потеряна связь
add('связь выброшена из модели', 'состав', '4403', (m) => {
  m.relationships.pop();
  return m;
});

// 4. фигура за листом
add('фигура за листом', 'лист', '4203', (m) => {
  m.diagrams[0].shapes[0].x = -100;
  return m;
});

// 5. фигуры наложены
add('фигуры наложены', 'пересечение', '4203', (m) => {
  const [a, b] = m.diagrams[0].shapes;
  b.x = a.x;
  b.y = a.y;
  return m;
});

// 6. связь смотрит на несуществующую фигуру
add('конец связи в пустоту', 'связь', '4203', (m) => {
  m.diagrams[0].links[0].to.shapeId = 's999';
  return m;
});

// 7. связь проходит сквозь чужую фигуру
add('связь сквозь фигуру', 'сквозь', '4403', (m) => {
  const shapes = m.diagrams[0].shapes;
  const byId = new Map(shapes.map((s) => [s.id, s]));
  // Ставим «Лишний» класс ровно посередине длинной связи, не задевая концов.
  const link = m.diagrams[0].links.find((l) => l.from.side === 'bottom' && l.to.side === 'top');
  const a = byId.get(link.from.shapeId);
  const b = byId.get(link.to.shapeId);
  m.elements.push({ id: 'e999', kind: 'class', name: 'Помеха' });
  shapes.push({
    id: 's999', elementId: 'e999',
    x: Math.round(((a.x + a.w / 2 + b.x + b.w / 2) / 2) / 10) * 10 - 20,
    y: Math.round(((a.y + a.h + b.y) / 2) / 10) * 10 - 20,
    w: 40, h: 40,
  });
  return m;
});

// 8. файл не в канонической форме
add('файл не канонический', 'схема', '4203', (m) => {
  // `serialize` не пишет пустую документацию — файл перестаёт быть каноническим.
  m.elements[0].documentation = '';
  return m;
});

// 9. у связи нет вида на листе
add('связь без вида', 'связь', '4403', (m) => {
  m.diagrams[0].links.pop();
  return m;
});

// 10. фигура не по сетке
add('фигура не по сетке', 'сетка', '4203', (m) => {
  m.diagrams[0].shapes[0].x += 3;
  return m;
});

// 11. размер листа не совпадает с содержимым
add('лист не по содержимому', 'лист', '4203', (m) => {
  m.sheet.w += 200;
  return m;
});

// 12. зазор меньше 40 px
add('соседи сдвинуты', 'зазор', '4203', (m) => {
  const shapes = m.diagrams[0].shapes;
  shapes[1].y = shapes[0].y + shapes[0].h + 10;
  return m;
});

// 13. рамка наехала на другую рамку
add('рамка на рамке', 'пересечение', '4303', (m) => {
  const frames = m.diagrams[0].shapes.filter((s) => ['fragment', 'interactionUse'].includes(
    m.elements.find((e) => e.id === s.elementId)?.kind,
  ));
  frames[1].y = frames[0].y + 20;
  return m;
});

// 14. рамка накрыла шапку линии жизни
add('рамка на шапке линии жизни', 'пересечение', '4303', (m) => {
  const lifeline = m.diagrams[0].shapes.find((s) => m.elements.find((e) => e.id === s.elementId)?.kind === 'lifeline');
  const frame = m.diagrams[0].shapes.find((s) => m.elements.find((e) => e.id === s.elementId)?.kind === 'fragment');
  frame.y = lifeline.y;
  return m;
});

// 15. сообщение ушло выше шапки линии жизни
add('сообщение вне линии жизни', 'связь', '4202', (m) => {
  m.diagrams[0].links[0].y = 10;
  return m;
});

// 16. Две законные связи между одной парой больше не рисуются одной ломаной:
//     редактор разводит концы по кромке (parallel-links.js), и проверка
//     «совпадение» на здоровой 4103 обязана молчать.
add('две связи одной пары разведены', null, '4103', (m) => m, {
  audit: true, absent: ['совпадение'],
});

// 17. А вот если концы заданы явно (`attach`), двигать нечем: две связи с
//     одинаковыми концами действительно слиплись — и проверка обязана это
//     назвать. Без этого случая «0 совпадений» ничего не доказывало бы.
add('слипшиеся концы названы', 'совпадение', '4103', (m) => {
  for (const id of ['l7', 'l8']) {
    const link = m.diagrams[0].links.find((l) => l.id === id);
    link.from.attach = { fx: 0.5, fy: 0.5 };
    link.to.attach = { fx: 0.5, fy: 0.5 };
    delete link.from.t;
    delete link.to.t;
  }
  return m;
}, { audit: true });

let bad = 0;
console.log('самопроверка check.mjs');
console.log('─'.repeat(60));
for (const c of cases) {
  const model = c.mutate(read(c.figure));
  put(c.figure, model);
  const codes = codesOf(c.figure, c.audit);
  const ok = (c.expect ? codes.includes(c.expect) : true)
    && c.absent.every((code) => !codes.includes(code));
  if (!ok) bad += 1;
  const want = [c.expect ? `[${c.expect}]` : 'ни одного', ...c.absent.map((x) => `без [${x}]`)].join(' ');
  console.log(`${ok ? 'ok  ' : 'ПЛОХО'} ${c.name.padEnd(32)} ждали ${want}${ok ? '' : `, получили [${[...new Set(codes)].join(', ') || '—'}]`}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('─'.repeat(60));
console.log(bad ? `самопроверка провалена: ${bad}` : `самопроверка пройдена: ${cases.length}/${cases.length}`);
process.exit(bad ? 1 : 0);
