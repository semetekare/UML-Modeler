// Самопроверка приложения: `?selftest=1` прогоняет три шага в настоящем окне и
// кладёт отчёт в `<pre id="self-test-report">`.
//
// Зачем это здесь. Приложение — статические ES-модули: у него нет ни `main()`,
// который можно позвать из консоли, ни сборки, которую можно прогнать. Единственный
// способ проверить его «как игрока» — открыть страницу в headless-браузере и
// посмотреть, что получилось. Этим и пользуется `Build/uml-modeler --self-test FILE`:
// он поднимает сайт, просит браузер отдать DOM и забирает отчёт из этого `<pre>`.
//
// Шаги названы так же, как у проверки Craft Anything (move · act · hud): фигуру
// можно поставить и сдвинуть, главное действие (прогон правил) даёт замечание,
// а счётчик в статусбаре показывает те же числа.
//
// Модуль грузится только по `?selftest=1` — обычная работа его не касается.

/** Модель с одним нарушением: кратность «2..1» на конце ассоциации (§7.8.8.8). */
const VIOLATION = {
  schema: 'uml-model/3',
  id: 'm-selftest',
  name: 'Самопроверка',
  elements: [
    { id: 'e1', kind: 'class', name: 'Заказ' },
    { id: 'e2', kind: 'class', name: 'Клиент' },
  ],
  relationships: [{
    id: 'r1', kind: 'association', from: 'e1', to: 'e2',
    fromMultiplicity: '1', toMultiplicity: '2..1',
  }],
  diagrams: [{
    id: 'd1', name: 'Диаграмма 1', kind: 'class',
    shapes: [
      { id: 's1', elementId: 'e1', x: 80, y: 80, w: 190, h: 120 },
      { id: 's2', elementId: 'e2', x: 420, y: 80, w: 190, h: 120 },
    ],
    links: [{
      id: 'l1', relId: 'r1',
      from: { shapeId: 's1', side: 'right', t: 0.5 },
      to: { shapeId: 's2', side: 'left', t: 0.5 },
    }],
  }],
  currentDiagramId: 'd1',
};

const EMPTY = {
  schema: 'uml-model/3', id: 'm-selftest-empty', name: 'Пустая',
  elements: [], relationships: [], diagrams: [], currentDiagramId: null,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Run the steps and return `{ version, steps: [{ step, passed, detail }] }`.
 * Never throws: a broken step is a failed step with the reason in `detail`.
 */
export async function runSelfTest(U) {
  const steps = [];
  const step = (name, passed, detail) => steps.push({ step: name, passed: !!passed, detail: String(detail) });

  /* move — поставить фигуру и сдвинуть её: лист живой, геометрия меняется. */
  try {
    U.loadModel(U.deserialize(JSON.stringify(EMPTY)));
    const made = U.commit('самопроверка', (m) => U.placeElement(m, 'class', 120, 120));
    const before = made.shape.x;
    U.commit('самопроверка', (m) => { U.currentDiagram(m).shapes[0].x += 40; });
    await tick();
    const shape = U.currentDiagram(U.store.model)?.shapes?.[0];
    const drawn = document.querySelectorAll('#canvas [data-kind="shape"]').length;
    step('move', !!shape && shape.x === before + 40 && drawn === 1,
      `фигура сдвинута ${before} → ${shape ? shape.x : '?'}, на листе фигур ${drawn}`);
  } catch (e) {
    step('move', false, e.message);
  }

  /* act — прогон правил на модели с нарушением: замечание есть, пункт назван. */
  try {
    U.loadModel(U.deserialize(JSON.stringify(VIOLATION)));
    U.refreshChecks();
    U.openChecksPanel();
    await tick();
    const rows = [...document.querySelectorAll('#checks .finding')];
    const clause = rows[0]?.querySelector('.clause')?.textContent ?? '';
    step('act', rows.length === 1 && /7\.8\.8\.8/.test(clause),
      `замечаний ${rows.length}, пункт «${clause.trim() || '—'}»`);
  } catch (e) {
    step('act', false, e.message);
  }

  /* hud — счётчик в статусбаре показывает те же числа, что и панель.
     Считает по тому же прогону, что и панель: ошибки и предупреждения — слой
     стандарта, советы практики — хвостом и только когда они есть. */
  try {
    const list = U.checkResult().findings;
    const uml = list.filter((f) => (f.basis ?? 'uml') !== 'practice');
    const errors = uml.filter((f) => f.level === 'error').length;
    const warnings = uml.length - errors;
    const advice = list.length - uml.length;
    const shown = document.getElementById('sb-checks')?.textContent ?? '';
    const want = `проверки: ${errors} · ${warnings}${advice ? ` · советов ${advice}` : ''}`;
    step('hud', shown === want, `статусбар «${shown}», ожидалось «${want}»`);
  } catch (e) {
    step('hud', false, e.message);
  }

  /* clean — пустая модель: панель говорит «нарушений не найдено», а не пуста. */
  try {
    U.loadModel(U.deserialize(JSON.stringify(EMPTY)));
    U.refreshChecks();
    U.openChecksPanel();
    await tick();
    const text = document.getElementById('checks')?.textContent ?? '';
    step('clean', /Нарушений не найдено/.test(text), text.replace(/\s+/g, ' ').trim().slice(0, 60));
  } catch (e) {
    step('clean', false, e.message);
  }

  return { version: 1, steps };
}
