// Панель «Проверки»: замечания движка правил трёх слоёв модели — стандарта UML
// 2.5.1, практики моделирования и соглашений проекта — и четвёртого слоя,
// который судит не модель, а ЛИСТ: проверки геометрии, перенесённые из archify
// 3.0.1 (пересечения рамок, имя шире рамки, мелкий текст на широком листе).
// Плюс счётчик в статусбаре и переход от замечания к виноватому объекту.
//
// Слои разные по природе, а не по строгости. Замечание стандарта опирается на
// пункт констрейнта: у него есть clause, constraint, страница и дословный текст.
// Замечание практики опирается на объяснение, почему такую модель неудобно
// читать: пункта у него нет вовсе, зато есть rationale. Поэтому у слоёв разные
// разделы и разные кнопки — «п. 7.8.8.8» и чип «практика», — а в диалоге
// практики стоит оговорка, что это не требование стандарта. Один общий список
// выдавал бы совет за нарушение.
//
// Четвёртый слой отделён ещё сильнее: у него нет ни пункта, ни rationale — и
// быть не может. Правило UML не запрещает двум фигурам налезать друг на друга:
// модель при этом верна, нечитаема только картинка. Поэтому такие замечания
// стоят отдельным разделом с оговоркой, в счётчики модели не входят (см.
// `checkCounts`) и не красятся как ошибки стандарта.
//
// Проверки — совет, а не запрет: движок только читает модель, ничего не
// отклоняет и не блокирует, а панель показывает то, что нашлось. Прогон идёт
// при открытии панели и по кнопке «Проверить»; счётчик в статусбаре считается
// по той же модели и по тому же прогону, поэтому цифры не расходятся.
//
// Замечание живёт в МОДЕЛИ (элемент или связь), а видно его на диаграмме —
// поэтому клик ищет вид на текущем листе, а если вида нет, переключает лист.

import { el, clear, svgEl } from '../util.js';
import { store, set, commit, subscribe, modelRevision } from '../state/store.js';
import {
  currentDiagram, findDiagram, findElement, findShape, findRelationship, elementOf, relOf,
} from '../model/model.js';
import { NOTATION } from '../model/notation.js';
import { layoutOf, textWidth } from '../model/geometry.js';
import { renderCanvas, centerOn, setFindingMarks } from './canvas.js';
import { closeLesson } from './course.js';
import { openClause, openRule } from './reference.js';
import { ScDialog } from '../../ui-kit/js/dialog.js';
// Проверки геометрии — перенесённый код archify (см. src/vendor/archify/
// README.md). Импорт сюда, а не в движок правил: это не правило UML, у него нет
// ни пункта стандарта, ни функции в реестре — есть только модель и лист.
import { geometryFindings } from '../vendor/archify/geometry-adapter.mjs';
// Редактор правил проекта — отдельный файл: форма и импорт/экспорт не должны
// раздувать панель, а циклический импорт безопасен: `openProjectRules`
// вызывается по клику, а не при инициализации модуля.
import { openProjectRules } from './project-rules.js';
import { track } from '../telemetry.js';

/**
 * Слой замечания или правила: отсутствующее поле basis — это стандарт.
 * Набор без слоя практики должен работать как раньше, а не падать.
 * `project` — третий слой: соглашения команды из файла модели.
 * `geometry` — четвёртый: проверки раскладки листа (archify).
 */
const basisOf = (x) => (x?.basis === 'practice'
  || x?.basis === 'project'
  || x?.basis === 'geometry'
  ? x.basis
  : 'uml');

let ruleset = null;        // движок из src/rules/index.js
let loadError = '';        // почему набор не загрузился (показывается в панели)
let onlyErrors = false;    // фильтр «только ошибки»
// Какая карточка правила раскрыта: ключ строки или id правила из списка
// «не проверяется». Состояние переживает перерисовку панели (её зовут на
// каждый commit): человек поправил модель — и карточка не должна закрыться
// под руками, иначе он потеряет место, где читал.
let openCard = null;
// Паспорт объекта: какой маркер раскрыт в панели. Хранится не замечание, а вид
// (лист + фигура/связь): после правки модели замечания пересчитываются, и
// паспорт обязан показать НОВЫЙ набор, а не снимок, которого уже нет.
let markPassport = null; // { kind, id, diagramId }
// Модель, для которой открыты карточки: при открытии другой модели их ключи
// (правило + цели, вид) относятся к прошлой, и совпавший ключ показал бы чужое.
let cardsModel = null;
let cache = { model: null, rev: -1, findings: [], ready: false, error: '' };

// Маркеры на листе — состояние ИНТЕРФЕЙСА, а не модели: в файл оно не пишется
// (иначе побайтовый эталон old-v3.json покраснел бы от одной галочки). Поле
// заводится здесь, потому что store.js — не наша зона правки; `set()` ниже
// кладёт его в тот же store.ui, что и остальные интерфейсные поля.
if (!('showMarks' in store.ui)) store.ui.showMarks = true;

/** Показывать ли маркеры замечаний на холсте (по умолчанию — да). */
const marksShown = () => store.ui.showMarks !== false;

// Подпись уже нарисованных маркеров: пересобираем слой только когда изменились
// замечания, лист или переключатель, а не на каждый клик по выделению.
let marksSig = '';

/** Отдать панели собранный движок (main.js зовёт это после загрузки набора). */
export function attachRuleset(rs) {
  ruleset = rs;
  loadError = '';
  cache = { model: null, rev: -1, findings: [], ready: false, error: '' };
  refreshChecks();
}

/** Набор не загрузился: панель говорит об этом, приложение работает дальше. */
export function attachRulesError(message) {
  ruleset = null;
  loadError = String(message ?? 'набор правил не загрузился');
  cache = { model: null, rev: -1, findings: [], ready: false, error: loadError };
  renderFindingMarks({ force: true });
}

/**
 * Результат прогона по текущей модели. Кеш держится за ссылку на модель и её
 * ревизию: правка модели — новый прогон, перерисовка панели — тот же ответ.
 *
 * `findings` — единый список в том порядке, в каком его отдал движок (сначала
 * стандарт, потом практика, потом проект), а в конце — замечания геометрии
 * листа. Кеш ничего не раскладывает по слоям: разделы фильтруют его сами, а
 * счётчику нужны те же цифры без повторного прогона.
 *
 * Геометрия — отдельным try: упавшая проверка листа не имеет права утащить за
 * собой замечания модели. Сбой превращается в запись-сбой той же формы, что у
 * правил (`status: 'failed'`), и честно ложится в раздел «не выполнилось».
 */
export function checkResult({ force = false } = {}) {
  if (!ruleset) return { findings: [], ready: false, error: loadError, rev: -1 };
  const rev = modelRevision();
  if (!force && cache.model === store.model && cache.rev === rev) return cache;
  const startedAt = typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now();
  try {
    const findings = ruleset.run(store.model);
    try {
      // `measure` — настоящее измерение текста из модели, а не приближение
      // archify: на кириллице оно даёт на 5–8 % меньше, и без него проверка
      // «имя шире рамки» шумит на пограничных 1 % (см. README archify).
      findings.push(...geometryFindings(store.model, {
        notation: NOTATION,
        measure: (t) => textWidth(t),
      }));
    } catch (e) {
      findings.push(geometryFailure(e));
    }
    cache = { model: store.model, rev, findings, ready: true, error: '' };
    // `validation.run` — настоящий прогон, а не перерисовка панели: сюда
    // попадает только ветка, где движок действительно считал (кеш выше уже
    // вернулся). Числа — только слой стандарта, как в счётчике статусбара:
    // совет практики и замечания к листу не выдаются за нарушения UML.
    let errors = 0;
    let warnings = 0;
    for (const f of findings) {
      if (f.status === 'failed') continue;
      if (f.basis === 'practice' || f.basis === 'project' || f.basis === 'geometry') continue;
      if (f.level === 'error') errors += 1;
      else if (f.level === 'warning') warnings += 1;
    }
    const endedAt = typeof performance !== 'undefined' && performance.now
      ? performance.now() : Date.now();
    track('validation.run', {
      errors, warnings, ms: Math.round(endedAt - startedAt),
    });
  } catch (e) {
    cache = { model: store.model, rev, findings: [], ready: false, error: e.message };
  }
  return cache;
}

/**
 * Сбой проверки геометрии — в той же форме, в какой `failure()` отдаёт сбой
 * правила. Отдельная функция, а не `failure()`: правила `geometry-pass` в наборе
 * нет, и подсовывать движку фиктивное правило значило бы врать реестру.
 */
function geometryFailure(error) {
  return {
    ruleId: 'geometry-pass',
    status: 'failed',
    level: 'error',
    basis: 'geometry',
    message: 'Проверки геометрии не выполнились',
    detail: error?.message ?? String(error),
    hint: 'Это сбой проверки, а не нарушение модели: раскладка листа не проверена.',
    clause: null,
    constraint: null,
    page: null,
    rationale: null,
    targets: [],
    diagramId: null,
  };
}

/**
 * Счётчики для статусбара. `errors`, `warnings` и `total` — только слой
 * стандарта: его цифры люди читают годами и их сверяют тесты. Практика
 * считается отдельно (`advice`) и в сумму не входит — совет не ошибка.
 *
 * `failed` — сбои проверок (`status: 'failed'`) любого слоя, отдельно от
 * нарушений: упавшее правило ничего не нашло, оно не смогло искать. В `errors`,
 * `warnings`, `advice` и `total` сбой не входит, но и молчать о нём нельзя —
 * «0 нарушений» при упавшем правиле было бы ложью.
 *
 * `layout` — замечания к раскладке листа. В `errors`, `warnings` и `total` они
 * не входят: это свойство картинки, а не модели, и прибавлять их к
 * «предупреждениям UML» значило бы врать о модели.
 */
export function checkCounts() {
  const r = checkResult();
  let errors = 0;
  let warnings = 0;
  let advice = 0;
  let project = 0;
  let layout = 0;
  let failed = 0;
  for (const f of r.findings) {
    if (f.status === 'failed') { failed += 1; continue; }
    if (basisOf(f) === 'practice') { advice += 1; continue; }
    if (basisOf(f) === 'project') { project += 1; continue; }
    if (basisOf(f) === 'geometry') { layout += 1; continue; }
    if (f.level === 'error') errors += 1;
    else if (f.level === 'warning') warnings += 1;
  }
  return {
    errors, warnings, advice, project, layout, failed, total: errors + warnings, ready: r.ready, error: r.error,
  };
}

/** Прогон по кнопке: считаем заново и перерисовываем панель со статусбаром. */
export function refreshChecks() {
  checkResult({ force: true });
  renderChecks();
  renderChecksStatus();
  // Новый прогон — новые маркеры. Без этого кнопка «Проверить» обновляла бы
  // только панель, а лист оставался бы с прошлым набором.
  renderFindingMarks({ force: true });
}

/* ------------------------------------------------------ маркеры на холсте */

/**
 * Вид цели на листе: фигура элемента или связь-вид связи.
 *
 * Порядок тот же, что у `locate` в переходе к замечанию: сначала фигуры по всем
 * целям, потом связи. Иначе замечание с целями [элемент, связь] на листе, где
 * есть только связь, привязалось бы к связи, а на листе с фигурой — к фигуре,
 * и один и тот же маркер означал бы разное на разных листах.
 */
function viewOn(model, diagram, targets) {
  if (!diagram) return null;
  const shapes = diagram.shapes ?? [];
  for (const id of targets ?? []) {
    const sh = shapes.find((s) => s.elementId === id);
    if (sh) return { kind: 'shape', id: sh.id };
  }
  // Внутренний переход (пришёл связью из чужого файла) на листе не рисуется —
  // §14.2.4.9. Маркер у невидимой линии означал бы «смотрите вон туда», где
  // ничего нет: такое замечание честнее отдать бейджем «вне листов».
  const links = (diagram.links ?? []).filter((l) => relOf(model, l)?.internal !== true);
  for (const id of targets ?? []) {
    const l = links.find((x) => x.relId === id);
    if (l) return { kind: 'connector', id: l.id };
  }
  return null;
}

/**
 * Маркеры одного листа. Несколько замечаний на одной фигуре собираются в один
 * бейдж с числом: пять кружков на одном классе читались бы как пять разных
 * объектов, а не как пять причин.
 */
function marksForDiagram(diagram, findings) {
  const byView = new Map();
  for (const f of findings) {
    // Замечание листа — только на своём листе; замечание модели (null) — на
    // каждом листе, где вообще есть вид его цели.
    if (f.diagramId && f.diagramId !== diagram?.id) continue;
    const view = viewOn(store.model, diagram, f.targets);
    if (!view) continue;
    const key = `${view.kind}:${view.id}`;
    let mark = byView.get(key);
    if (!mark) {
      mark = { ...view, findings: [] };
      byView.set(key, mark);
    }
    mark.findings.push(f);
  }
  return [...byView.values()];
}

/**
 * Замечания, у которых нет вида ни на одном листе: элемент не показан нигде,
 * связь не нарисована, или виноватого нет вовсе (правило уровня модели). Такие
 * замечания раньше были видны только в панели; теперь на листе есть тихий
 * бейдж «вне листов», иначе «на холсте видно всё» было бы неправдой.
 */
function offSheetFindings(model, findings) {
  const out = [];
  for (const f of findings) {
    let shown = false;
    for (const d of model.diagrams ?? []) {
      if (f.diagramId && f.diagramId !== d.id) continue;
      if (viewOn(model, d, f.targets)) { shown = true; break; }
    }
    if (!shown) out.push(f);
  }
  return out;
}

/**
 * Пересобрать маркеры текущего листа. Зовётся по commit, смене листа и новому
 * прогону, но НЕ по pointermove: подпись ниже отсекает всё, что не изменило ни
 * замечаний, ни листа, ни переключателя.
 */
function renderFindingMarks({ force = false } = {}) {
  const r = checkResult();
  const d = currentDiagram(store.model);
  const show = marksShown();
  const findings = r.ready ? r.findings.filter((f) => f.status !== 'failed') : [];
  const marks = show && d ? marksForDiagram(d, findings) : [];
  const off = show && d ? offSheetFindings(store.model, findings) : [];
  const sig = show ? [
    r.rev,
    d?.id ?? '',
    findings.length,
    marks.map((m) => `${m.kind}:${m.id}:${m.findings.map((f) => f.ruleId).join(',')}`).join(';'),
    off.map((f) => f.ruleId).join(','),
  ].join('|') : 'off';
  if (!force && sig === marksSig) return;
  marksSig = sig;

  const payload = marks.map((m) => ({ kind: m.kind, id: m.id, findings: m.findings }));
  if (off.length) payload.push({ kind: 'model', id: 'off-sheet', findings: off });
  setFindingMarks(payload, {
    diagramId: d?.id ?? null,
    onClick: (mark) => activateFindingMark(mark),
  });
}

/**
 * Клик по маркеру: паспорт ОБЪЕКТА, если у него больше одного правила.
 *
 * Маркер — это объект, а не замечание: на одном классе висит и «имя занято», и
 * «нет классификатора». Раньше клик открывал первое замечание, и остальные
 * человек искал глазами в списке. Теперь на объекте с несколькими правилами
 * открывается паспорт — все его замечания, сгруппированные по правилам, — а на
 * объекте с одним правилом поведение прежнее: строка списка и её карточка.
 *
 * Переход к объекту не дублируется — это тот же `gotoFinding`, что у строки
 * панели: лист, выделение, вспышка и след в дереве обязаны совпадать.
 *
 * Бейдж «вне листов» паспорта не получает: его замечания — про РАЗНЫЕ объекты,
 * и «все замечания этого объекта» было бы неправдой.
 */
function activateFindingMark(mark) {
  const findings = mark?.findings ?? [];
  if (!findings.length) return;
  const first = findings[0];
  openChecksPanel();
  gotoFinding(first);
  highlightFindingRow(first);
  if (mark.kind !== 'model' && findings.length > 1) {
    // Паспорт — одна карточка на объект: открытая карточка строки закрывается,
    // иначе в панели оказались бы два ответа на один вопрос.
    closeCards();
    markPassport = { kind: mark.kind, id: mark.id, diagramId: store.model.currentDiagramId ?? null };
  } else {
    // Одно замечание — паспорт не нужен: строка списка уже и есть его паспорт.
    markPassport = null;
    openCard = cardKey(first);
  }
  renderChecks();
}

/** Подсветить строку панели, к которой относится маркер: клик по листу и клик
 * по строке должны приводить к одному и тому же месту. */
function highlightFindingRow(finding) {
  requestAnimationFrame(() => {
    const targets = (finding.targets ?? []).join(' ');
    const row = [...document.querySelectorAll('#checks .finding')]
      .find((n) => n.dataset.rule === finding.ruleId && (n.dataset.targets ?? '') === targets);
    if (!row) return;
    row.classList.add('picked');
    row.scrollIntoView({ block: 'nearest' });
    setTimeout(() => row.classList.remove('picked'), 1600);
  });
}

/**
 * Замер покрытия: какие замечания получили маркер. Возвращает и общее число, и
 * разбивку по листам — по ней видно, что маркер не «есть вообще», а стоит на
 * том листе, где цель действительно нарисована. Этим меряет tests/smoke.mjs.
 */
export function markerReport() {
  const r = checkResult();
  const findings = r.ready ? r.findings.filter((f) => f.status !== 'failed') : [];
  const covered = new Set();
  const perDiagram = [];
  let targetMarkers = 0;
  for (const d of store.model.diagrams ?? []) {
    const marks = marksForDiagram(d, findings);
    targetMarkers += marks.length;
    for (const m of marks) for (const f of m.findings) covered.add(f);
    perDiagram.push({
      id: d.id,
      name: d.name,
      markers: marks.length,
      findings: marks.reduce((n, m) => n + m.findings.length, 0),
      rules: marks.flatMap((m) => m.findings.map((f) => f.ruleId)),
    });
  }
  const off = offSheetFindings(store.model, findings);
  for (const f of off) covered.add(f);
  return {
    ready: r.ready,
    error: r.error,
    showMarks: marksShown(),
    findings: findings.length,
    covered: covered.size,
    targetMarkers,
    offSheet: off.length,
    offSheetRules: off.map((f) => f.ruleId),
    undrawn: findings.filter((f) => !covered.has(f)).map((f) => f.ruleId),
    perDiagram,
  };
}

// Перерисовка маркеров по состоянию приложения. `light` — это перетаскивание:
// лист там перерисовывается каждый кадр, а маркеры ждут отпускания кнопки.
//
// Отложено на микрозадачу намеренно: подписчики `emit` идут в порядке
// регистрации, а этот — раньше подписки main.js, которая перерисовывает лист.
// Нарисуй маркеры сразу — и свободный угол под бейдж у мелкой фигуры выберется
// по надписям ПРОШЛОГО листа. Микрозадача, поставленная внутри обработчика,
// выполнится после того, как отработают все подписчики этого emit.
subscribe((_s, meta) => {
  if (meta?.light) return;
  queueMicrotask(() => renderFindingMarks());
});

/* ------------------------------------------------------------- статусбар */

/**
 * Только текст счётчика в статусбаре — его остальные поля рисует panels.js.
 * Хвост «· советов N» появляется лишь тогда, когда советы есть: иначе
 * привычное «проверки: 2 · 1» осталось бы неизменным только наполовину.
 * Хвост «· проект N» — так же: правила проекта не требования стандарта, и
 * при пустом списке строка обязана остаться прежней, байт в байт.
 * Хвост «· не проверено N» — по той же причине и только при сбоях: при
 * `failed === 0` строка обязана остаться прежней, байт в байт.
 *
 * Хвост «· раскладка N» — про лист, а не про модель, поэтому стоит после
 * «проект» и до «не проверено»: сбой — единственное, что значит «проверка не
 * отработала». При `layout === 0` хвоста нет, и строка остаётся прежней.
 *
 * Порядок хвостов задан: совет, проект, раскладка, сбой — от самого частого к
 * самому редкому. Сбой последним, потому что это единственное, что значит
 * «проверка не отработала», а не «нашлось вот это».
 */
export function renderChecksStatus() {
  const btn = document.getElementById('sb-checks');
  if (!btn) return;
  const c = checkCounts();
  const tail = (c.advice ? ` · советов ${c.advice}` : '')
    + (c.project ? ` · проект ${c.project}` : '')
    + (c.layout ? ` · раскладка ${c.layout}` : '')
    + (c.failed ? ` · не проверено ${c.failed}` : '');
  btn.textContent = c.ready ? `проверки: ${c.errors} · ${c.warnings}${tail}` : 'проверки: —';
  // Сбой проверки — не нарушение модели, поэтому и в подсказке он назван
  // отдельно: иначе красный счётчик прочитали бы как «модель плохая».
  const failedNote = c.failed
    ? ` Не выполнено проверок: ${c.failed} — это сбой проверки, а не нарушение модели.`
    : '';
  btn.title = c.ready
    ? `Проверки UML 2.5.1: ${c.errors} ${plural(c.errors, 'ошибка', 'ошибки', 'ошибок')}, `
      + `${c.warnings} ${plural(c.warnings, 'предупреждение', 'предупреждения', 'предупреждений')}. `
      + `Практика моделирования: ${c.advice} ${plural(c.advice, 'совет', 'совета', 'советов')} `
      + `(это не нарушения стандарта). `
      + `Правила проекта: ${c.project} ${plural(c.project, 'замечание', 'замечания', 'замечаний')} `
      + `(это соглашения команды, а не UML). `
      + `Проверки геометрии листа: ${c.layout} ${plural(c.layout, 'замечание', 'замечания', 'замечаний')} `
      + `(это про раскладку листа, а не про модель).${failedNote} Открыть панель.`
    : `Проверки недоступны: ${c.error}`;
  btn.classList.toggle('has-errors', c.errors > 0);
  const badge = document.getElementById('checks-badge');
  // Бейдж считает и сбои, и замечания правил проекта, и замечания к раскладке:
  // «0» на кнопке при упавшем правиле или при нечитаемом листе прятало бы,
  // что панель есть что сказать.
  const badgeCount = c.total + c.project + c.layout + c.failed;
  if (badge) badge.textContent = c.ready && badgeCount ? String(badgeCount) : '';
}

/** Открыть панель «Проверки» (клик по счётчику в статусбаре, Ctrl+K, тесты). */
export function openChecksPanel() {
  const pane = document.getElementById('right');
  const tab = pane?.querySelector('.tab[data-tab="checks"]');
  if (!tab) return;
  for (const t of pane.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
  for (const p of pane.querySelectorAll('.tabpane')) p.classList.toggle('active', p.id === 'checks');
  refreshChecks();
  tab.focus?.();
}

/* --------------------------------------------------------------- панель */

export function renderChecks() {
  const host = document.getElementById('checks');
  if (!host) return;
  clear(host);
  // Открыли другую модель — карточки и паспорт закрываются: их ключи (правило +
  // цели, вид на листе) относятся к прежней модели, и совпавший ключ показал бы
  // замечание, которого в этой модели нет.
  if (cardsModel !== store.model) {
    cardsModel = store.model;
    openCard = null;
    markPassport = null;
  }
  renderChecksStatus();

  const head = el('div', { class: 'checks-head' },
    el('button', {
      type: 'button', class: 'btn on', id: 'checks-run', title: 'Проверить модель заново',
      onclick: () => refreshChecks(),
    }, 'Проверить'),
    el('label', { class: 'checks-filter', title: 'Скрыть предупреждения и советы — оставить только ошибки' },
      el('input', {
        type: 'checkbox', id: 'checks-only-errors', checked: onlyErrors ? true : null,
        onchange: (e) => {
          onlyErrors = !!e.target.checked;
          renderChecks();
          // Панель перерисована — возвращаем фокус на галочку, иначе с
          // клавиатуры её пришлось бы искать заново.
          document.getElementById('checks-only-errors')?.focus();
        },
      }),
      ' только ошибки'),
    // Вход в редактор правил проекта — из панели, а не из меню: правила
    // проекта это третий слой ПРОВЕРОК, и человек ищет их там, где видит
    // замечания этого слоя. Меню «Файл» занято файлами модели, а «Модель» —
    // чужая зона правки (`panels.js`); панель проверок — своя.
    el('button', {
      type: 'button', class: 'btn', id: 'checks-project-rules',
      title: 'Правила проекта: соглашения команды из файла модели — список, форма, импорт и экспорт',
      onclick: () => {
        openProjectRules().catch((e) => set({ hint: `Редактор правил проекта не открылся: ${e.message}` }));
      },
    }, 'Правила проекта…'),
    // Переключатель маркеров (фаза 4.5): состояние — в store.ui, не в модели.
    // Иначе галочка попала бы в сохранённый файл и сломала побайтовый эталон.
    el('label', {
      class: 'checks-filter',
      title: 'Показывать замечания маркерами на листе: ошибка, предупреждение и совет — разными цветами',
    },
    el('input', {
      type: 'checkbox', id: 'checks-show-marks', checked: marksShown() ? true : null,
      onchange: (e) => {
        set({ showMarks: !!e.target.checked });
        renderChecks();
        // Панель перерисована — фокус возвращается на галочку, как у фильтра
        // «только ошибки».
        document.getElementById('checks-show-marks')?.focus();
      },
    }),
    ' маркеры'));
  host.append(head);

  const r = checkResult();

  if (!r.ready) {
    host.append(el('div', { class: 'empty', id: 'checks-empty', text: `Проверки недоступны: ${r.error}` }));
    host.append(coverageSection());
    return;
  }

  // Сбои — не нарушения модели: они не попадают ни в один из разделов и
  // считаются отдельно. Иначе упавшее правило читалось бы как ещё
  // одно замечание к модели, а «все чисто» при нём было бы прямой ложью.
  const failed = r.findings.filter((f) => f.status === 'failed');
  const uml = r.findings.filter((f) => basisOf(f) === 'uml' && f.status !== 'failed');
  const practice = r.findings.filter((f) => basisOf(f) === 'practice' && f.status !== 'failed');
  const project = r.findings.filter((f) => basisOf(f) === 'project' && f.status !== 'failed');
  // Замечания к листу: их «виноватый» — раскладка, а не элемент модели. Сбои
  // проверки геометрии сюда не идут: они уже в `failed`.
  const geometry = r.findings.filter((f) => basisOf(f) === 'geometry' && f.status !== 'failed');
  const projectRules = Array.isArray(store.model.projectRules) ? store.model.projectRules : [];
  const errors = uml.filter((f) => f.level === 'error').length;
  const warnings = uml.length - errors;

  // Сводка — про стандарт: слой, у которого есть пункты и уровни ошибок.
  const sum = el('div', { class: 'checks-sum', id: 'checks-sum' },
    el('b', { text: String(errors) }), ` ${plural(errors, 'ошибка', 'ошибки', 'ошибок')} · `,
    el('b', { text: String(warnings) }), ` ${plural(warnings, 'предупреждение', 'предупреждения', 'предупреждений')}`);
  if (failed.length) {
    sum.append(' · ', el('b', { class: 'checks-failed-count', text: String(failed.length) }), ' не проверено');
  }
  host.append(sum);

  // Паспорт объекта — первой карточкой над списком, а не модалом: модал отнял
  // бы у человека место в списке, к которому он вернётся, и спрятал бы
  // остальные замечания модели. Здесь список остаётся на месте, а все
  // замечания одного объекта читаются одним блоком.
  const passport = passportMark();
  if (passport) host.append(markCard(passport));
  else markPassport = null;

  // Чисто по всем слоям — это результат, а не пустая панель: разделов нет,
  // чтобы не читать «нарушений нет» дважды подряд. Но если при этом упало
  // правило, «все чисто» говорить нельзя: модель проверена не вся. Замечания
  // к раскладке — тоже повод не говорить «все чисто»: лист может быть нечитаем
  // при верной модели.
  if (!uml.length && !practice.length && !project.length && !geometry.length) {
    host.append(failed.length
      ? el('div', { class: 'empty checks-ok', id: 'checks-empty' },
        el('b', { text: 'Нарушений не найдено среди отработавших правил' }),
        el('div', { class: 'mini', text: 'Остальные правила отработали: нарушений среди них нет. '
          + 'Ниже — проверки, которые не выполнились.' }))
      : el('div', { class: 'empty checks-ok', id: 'checks-empty' },
        el('b', { text: 'Нарушений не найдено' }),
        el('div', { class: 'mini', text: `${checkedLayersText()} — все чисто.` })));
    if (failed.length) host.append(failedSection(failed));
    host.append(coverageSection());
    return;
  }

  // «Только ошибки» режет все четыре слоя: у практики уровень всегда
  // «предупреждение», поэтому при включённом фильтре она видна только своей
  // пустой строкой; у проекта уровень задаёт само правило; у геометрии
  // «ошибок» не бывает вовсе.
  const shownUml = onlyErrors ? uml.filter((f) => f.level === 'error') : uml;
  const shownPractice = onlyErrors ? [] : practice;
  // У правил проекта уровень свой (error или warning), поэтому фильтр «только
  // ошибки» режет и их — как стандарт, а не как практику.
  const shownProject = onlyErrors ? project.filter((f) => f.level === 'error') : project;
  // У замечаний геометрии уровень всегда «предупреждение» (это не ошибка
  // модели), поэтому при включённом фильтре они скрыты — но раздел остаётся с
  // объяснением, чтобы человек не решил, будто лист чист.
  const shownGeometry = onlyErrors ? [] : geometry;

  host.append(standardSection(shownUml, uml));
  if (practice.length) host.append(practiceSection(shownPractice));
  // Раздел проекта показывается, когда есть правила в модели или их замечания:
  // пустой раздел у модели без правил только занимал бы место.
  if (projectRules.length || project.length) host.append(projectSection(shownProject, projectRules.length));
  // Геометрия — после правил проекта и до сбоев: она судит лист, а не модель.
  if (geometry.length) host.append(geometrySection(shownGeometry));
  if (failed.length) host.append(failedSection(failed));
  host.append(coverageSection());
  // Открытая карточка переживает перерисовку только если её строка осталась:
  // замечание исчезло (модель поправили) — карточка закрыта, а не висит
  // пустой ссылкой на то, чего уже нет.
  if (openCard && !host.querySelector('.rule-card')) openCard = null;
}

/** Раздел стандарта: замечания с кнопкой пункта и своё пустое состояние. */
function standardSection(shown, all) {
  const sec = el('section', { class: 'checks-section', id: 'checks-standard' });

  // Слой пуст по-настоящему — заголовок сам говорит об этом, без второй строки
  // под ним: две фразы об одном и том же читаются как недоделка.
  if (!shown.length && !all.length) {
    sec.append(el('div', { class: 'checks-section-head', id: 'checks-standard-head' },
      'По спецификации UML 2.5.1 нарушений нет'));
    return sec;
  }

  sec.append(el('div', { class: 'checks-section-head', id: 'checks-standard-head' },
    'По спецификации UML 2.5.1'));
  if (!shown.length) {
    sec.append(el('div', {
      class: 'checks-none',
      text: 'Ошибок нет — только предупреждения. Снимите «только ошибки», чтобы их увидеть.',
    }));
    return sec;
  }

  const list = el('ul', { class: 'findings', id: 'checks-list' });
  for (const f of shown) list.append(findingRow(f, 'uml'));
  sec.append(list);
  return sec;
}

/** Раздел практики: советы с чипом вместо пункта; показывается, только если есть что показать. */
function practiceSection(shown) {
  const sec = el('section', { class: 'checks-section', id: 'checks-practice' });
  sec.append(el('div', { class: 'checks-section-head', id: 'checks-practice-head' },
    'Практика моделирования'));
  sec.append(el('div', { class: 'mini checks-note' },
    'Советы по практике моделирования, а не нарушения стандарта UML 2.5.1: '
    + 'такую модель можно сохранить, но читать её труднее.'));

  if (!shown.length) {
    sec.append(el('div', {
      class: 'checks-none',
      text: 'Советы скрыты фильтром «только ошибки»: у практики нет уровня «ошибка».',
    }));
    return sec;
  }

  const list = el('ul', { class: 'findings' });
  for (const f of shown) list.append(findingRow(f, 'practice'));
  sec.append(list);
  return sec;
}

/**
 * Раздел правил проекта — третий слой.
 *
 * Это не «ещё один список замечаний»: у таких строк нет ни пункта стандарта,
 * ни rationale, и читать их как нарушения UML нельзя. Поэтому своя шапка с
 * оговоркой и своя кнопка: человек, увидевший замечание, должен сразу понять,
 * что это договорённость его команды — и что её можно изменить, в отличие от
 * пункта стандарта.
 */
function projectSection(shown, ruleCount) {
  const sec = el('section', { class: 'checks-section', id: 'checks-project' });
  sec.append(el('div', { class: 'checks-section-head', id: 'checks-project-head' },
    ruleCount ? `Правила проекта — ${ruleCount}` : 'Правила проекта'));
  sec.append(el('div', { class: 'mini checks-note' },
    'Соглашения команды из файла модели, а не требования стандарта UML 2.5.1: '
    + 'их пишет сам проект, и их можно изменить или выключить.'));

  if (!shown.length) {
    sec.append(el('div', {
      class: 'checks-none',
      // Скрытое фильтром и отсутствующее — разные вещи: «нарушений нет» при
      // включённом «только ошибки» было бы неправдой.
      text: !ruleCount ? 'Правил проекта в модели нет.'
        : (onlyErrors ? 'Замечания правил проекта скрыты фильтром «только ошибки».'
          : 'Нарушений правил проекта нет.'),
    }));
    sec.append(el('button', {
      type: 'button', class: 'btn checks-project-edit', id: 'checks-project-edit',
      title: 'Открыть редактор правил проекта',
      onclick: () => {
        openProjectRules().catch((e) => set({ hint: `Редактор правил проекта не открылся: ${e.message}` }));
      },
    }, ruleCount ? 'Изменить правила…' : 'Добавить правило…'));
    return sec;
  }

  const list = el('ul', { class: 'findings', id: 'checks-project-list' });
  for (const f of shown) list.append(projectRow(f));
  sec.append(list);
  return sec;
}

/**
 * Строка правила проекта: уровень, сообщение, что нашлось — и чип «проект»
 * вместо кнопки пункта. Карточки правила у неё нет намеренно: карточка
 * стандарта рассказывает про пункт, а здесь рассказывать нечего, кроме самого
 * правила, — его целиком показывает чип.
 */
function projectRow(f) {
  return el('li', {
    class: `finding project ${f.level}`,
    role: 'button',
    tabindex: '0',
    'data-rule': f.ruleId,
    'data-level': f.level,
    'data-basis': 'project',
    'data-targets': (f.targets ?? []).join(' '),
    title: [f.message, f.hint].filter(Boolean).join('. '),
    // Клик по строке ведёт к виноватому объекту — так же, как у остальных
    // слоёв: строка замечания всегда «где это», а природа правила — чип.
    onclick: (e) => { if (!e.target.closest('.chip-basis')) gotoFinding(f); },
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gotoFinding(f); }
    },
  },
  el('span', {
    class: 'lvl',
    text: f.level === 'error' ? 'ошибка' : 'предупр.',
    'aria-label': f.level === 'error' ? 'ошибка правила проекта' : 'предупреждение правила проекта',
  }),
  el('div', { class: 'msg' },
    el('div', { class: 'mt', text: f.message }),
    f.detail ? el('div', { class: 'det', text: f.detail }) : null,
    f.hint ? el('div', { class: 'hint', text: f.hint }) : null),
  el('div', { class: 'finding-side' }, projectChip(f)));
}

/** Чип слоя проекта: не ссылка на пункт, а вход в объяснение правила. */
function projectChip(f) {
  return el('button', {
    type: 'button', class: 'chip-basis chip-project', 'data-rule': f.ruleId,
    title: 'Правило проекта: соглашение команды, а не требование стандарта UML',
    onclick: (e) => { e.stopPropagation(); showProject(f); },
  }, 'проект');
}

/**
 * Раздел геометрии — четвёртый слой, и он не про модель.
 *
 * Замечания здесь отвечают не на вопрос «верна ли модель», а на «читается ли
 * лист»: две рамки налезли друг на друга, имя шире фигуры, при вписывании
 * широкого листа в окно текст становится мельче 6 px. Диаграмма может быть
 * безупречной по UML 2.5.1 и при этом нечитаемой — поэтому раздел стоит
 * отдельно и с оговоркой, а не подмешивается в предупреждения стандарта.
 */
function geometrySection(shown) {
  const sec = el('section', { class: 'checks-section', id: 'checks-geometry' });
  sec.append(el('div', { class: 'checks-section-head', id: 'checks-geometry-head' },
    'Геометрия листа'));
  sec.append(el('div', { class: 'mini checks-note' },
    'Проверки вида, а не модели: диаграмма может быть верной по UML и нечитаемой — '
    + 'перекрытия рамок, имя шире рамки, слишком мелкий текст на широком листе.'));

  if (!shown.length) {
    sec.append(el('div', {
      class: 'checks-none',
      // Не путать «скрыто фильтром» с «нарушений нет»: у этого слоя уровень
      // всегда предупреждение, поэтому «только ошибки» прячет его целиком.
      text: 'Замечания к раскладке скрыты фильтром «только ошибки»: '
        + 'у проверок листа нет уровня «ошибка». Снимите фильтр, чтобы их увидеть.',
    }));
    return sec;
  }

  const list = el('ul', { class: 'findings', id: 'checks-geometry-list' });
  for (const f of shown) list.append(findingRow(f, 'geometry'));
  sec.append(list);
  return sec;
}

/**
 * Раздел сбоев: правила, которые не смогли проверить модель.
 *
 * Он отдельный и стоит после слоёв, потому что это не замечание к модели: у
 * такой строки нет ни пункта, ни виноватого элемента, и вести к объекту некуда.
 * Смешать её с нарушениями значило бы сказать «модель плохая» вместо «проверка
 * не отработала».
 */
function failedSection(failed) {
  const sec = el('section', { class: 'checks-section', id: 'checks-failed' });
  sec.append(el('div', { class: 'checks-section-head', id: 'checks-failed-head' },
    'Проверки, которые не выполнились'));
  sec.append(el('div', { class: 'mini checks-note' },
    'Это сбой проверки, а не нарушение модели: правило не смогло прочитать модель, '
    + 'а остальные правила отработали.'));

  const list = el('ul', { class: 'findings', id: 'checks-failed-list' });
  for (const f of failed) list.append(failedRow(f));
  sec.append(list);
  return sec;
}

/**
 * Строка сбоя: метка «сбой», сообщение и текст ошибки. Кнопки пункта и перехода
 * к объекту здесь нет намеренно — `targets` пуст, винить некого; клик лишь
 * открывает диалог с полным текстом ошибки.
 */
function failedRow(f) {
  return el('li', {
    class: 'finding failed',
    role: 'button',
    tabindex: '0',
    'data-rule': f.ruleId,
    'data-level': f.level,
    'data-basis': basisOf(f),
    'data-status': 'failed',
    title: [f.message, f.hint].filter(Boolean).join('. '),
    onclick: () => showFailed(f),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showFailed(f); }
    },
  },
  el('span', { class: 'lvl', text: 'сбой', 'aria-label': 'сбой проверки' }),
  el('div', { class: 'msg' },
    el('div', { class: 'mt', text: f.message }),
    f.detail ? el('div', { class: 'det', text: f.detail }) : null,
    f.hint ? el('div', { class: 'hint', text: f.hint }) : null));
}

/**
 * Одна строка панели. Слои отличаются только третьей колонкой и меткой уровня:
 * у стандарта это кнопка пункта, у практики — чип «практика», у геометрии —
 * чип «раскладка» и метка «вид» (замечание к листу, а не к элементу модели).
 * Клик по строке (но не по ним) ведёт к виноватому объекту одинаково для всех
 * слоёв: «где это» — общий вопрос, а природа правила — чип.
 */
function findingRow(f, basis) {
  const practice = basis === 'practice';
  const geometry = basis === 'geometry';
  const key = cardKey(f);
  const row = el('li', {
    class: `finding ${f.level}${practice ? ' practice' : ''}${geometry ? ' geometry' : ''}`,
    role: 'button',
    tabindex: '0',
    'data-rule': f.ruleId,
    'data-level': f.level,
    'data-basis': basis,
    'data-targets': (f.targets ?? []).join(' '),
    'data-card': key,
    title: [f.message, f.hint].filter(Boolean).join('. '),
    // Клик по строке по-прежнему ведёт к виноватому объекту; карточка —
    // отдельная кнопка. Смешать их значило бы сделать переход к объекту
    // необязательным шагом на пути к тексту.
    onclick: (e) => { if (!e.target.closest('.clause, .chip-basis, .rule-card, .finding-open')) gotoFinding(f); },
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gotoFinding(f); }
    },
  },
  el('span', {
    class: 'lvl',
    text: geometry ? 'вид' : (practice ? 'совет' : (f.level === 'error' ? 'ошибка' : 'предупр.')),
    'aria-label': geometry ? 'замечание к листу'
      : (practice ? 'совет по практике' : (f.level === 'error' ? 'ошибка' : 'предупреждение')),
  }),
  el('div', { class: 'msg' },
    el('div', { class: 'mt', text: f.message }),
    f.detail ? el('div', { class: 'det', text: f.detail }) : null,
    f.hint ? el('div', { class: 'hint', text: f.hint }) : null),
  el('div', { class: 'finding-side' },
    geometry ? geometryChip(f) : (practice ? basisChip(f) : clauseButton(f)),
    el('button', {
      type: 'button',
      class: 'finding-open',
      'data-card': key,
      'aria-expanded': openCard === key ? 'true' : 'false',
      title: 'Карточка правила: что именно нашлось в этой модели, где это и что делать',
      onclick: (e) => { e.stopPropagation(); toggleFindingCard(row, f, basis); },
    }, openCard === key ? '▴' : '▾')));
  if (openCard === key) row.append(ruleCard(f, basis));
  return row;
}

/* ------------------------------------------------- карточка правила (4.2) */

/*
 * Карточка — НЕ пересказ стандарта. Стандарт целиком живёт в справочнике
 * (полка «Правила», статья `articleRule`): там пункт, дословный текст, OCL и
 * `check`. Вторая копия того же текста в панели означала бы два места, где
 * написано одно и то же, и вопрос «какому верить».
 *
 * Поэтому карточка отвечает на другой вопрос — «что нашлось в ЭТОЙ модели»:
 * `detail` замечания (в нём конкретика: какие границы, какие имена), место
 * (лист и виноватые элементы), совет к этому случаю (`hint` правила) и одна
 * кнопка в справочник. Плюс три случая, которых в справочнике нет вовсе:
 * невыразимое правило («почему не проверяется» и «чего не хватает» — из
 * rules/coverage.js), слой практики (`rationale`) и слой геометрии — у него нет
 * ни правила в наборе, ни статьи UML, только свойство картинки.
 */

/** Ключ строки: правило + его цели. Две находки одного правила — разные карточки. */
function cardKey(f) {
  return `${f.ruleId}|${(f.targets ?? []).join(' ')}`;
}

/** Почему правило не проверяется — из движка (`ruleset.uncovered`), не из текста. */
function gapOf(ruleId) {
  return (ruleset?.uncovered ?? []).find((u) => u.id === ruleId) ?? null;
}

/**
 * Где это: имена виноватых и лист, на котором они нарисованы.
 *
 * Цикл показывается путём `A → B → C → A`: `targets` у него — вершины кольца,
 * и перечисление через запятую читалось бы как «три отдельных нарушения».
 * Признак цикла — id правила (`…-cycle`), а не длина списка: у правила о
 * вложенности целей тоже несколько, но пути у них нет.
 */
function whereOf(model, f) {
  const ids = f.targets ?? [];
  if (!ids.length) {
    // У замечания к листу целиком виноватого нет по природе, а не потому,
    // что данные потерялись: говорить «относится к модели» здесь было бы
    // неправдой — оно относится к листу.
    return {
      text: basisOf(f) === 'geometry'
        ? 'Виноватого элемента нет: замечание относится ко всему листу.'
        : 'Виноватого элемента нет: замечание относится к модели целиком.',
      found: false,
    };
  }
  const names = ids.map((id) => culpritName(model, id));
  // Три правила несут путь: два названы «cycle», третье — владение собой
  // (`element-not-own-self`); у остальных нескольких целей пути нет, и
  // склеивать их стрелкой значило бы выдумать последовательность.
  const cycle = /cycle|own-self/.test(f.ruleId);
  let list = names.join(cycle ? ' → ' : ', ');
  if (cycle && names.length > 1) list += ` → ${names[0]}`;
  const prefer = f.diagramId ?? null;
  const hit = ids.map((id) => locate(model, id, prefer)).find(Boolean);
  const sheet = hit ? findDiagram(model, hit.diagramId)?.name : null;
  return {
    text: sheet ? `${list} — на листе «${sheet}»` : `${list} — в модели, но ни на одной диаграмме не показан`,
    found: !!hit,
  };
}

/** Закрыть все карточки панели: открыта всегда одна — иначе список расползается. */
function closeCards() {
  for (const c of document.querySelectorAll('#checks .rule-card')) c.remove();
  for (const r of document.querySelectorAll('#checks .card-open')) r.classList.remove('card-open');
  for (const b of document.querySelectorAll('#checks .finding-open')) b.setAttribute('aria-expanded', 'false');
  openCard = null;
}

/** Карточка замечания: что нашлось, где, что делать и вход в справочник. */
function ruleCard(f, basis) {
  const rule = ruleOf(f);
  const practice = basis === 'practice';
  // У геометрии правила в наборе нет вовсе: движок его не знает, справочник о
  // нём не слышал. Карточка строится по самому замечанию, а не по правилу.
  const geometry = basis === 'geometry';
  const gap = practice || geometry ? null : gapOf(f.ruleId);
  const where = whereOf(store.model, f);

  const box = el('div', { class: 'rule-card', 'data-rule': f.ruleId });
  box.append(el('div', { class: 'rc-head' },
    el('span', { class: 'rc-id mono', text: f.ruleId }),
    el('span', {
      class: `rc-lvl ${practice ? 'practice' : f.level}`,
      text: geometry ? 'раскладка' : (practice ? 'практика' : (f.level === 'error' ? 'ошибка' : 'предупреждение')),
    })));

  const sec = (title, text, cls = '') => {
    const body = String(text ?? '').trim();
    if (!body) return;
    box.append(el('div', { class: `rc-sec ${cls}` }, el('b', { text: title }), el('div', { class: 'rc-body', text: body })));
  };

  sec('Что нашлось здесь', f.detail || f.message);
  sec('Где', where.text);
  if (practice) sec('Почему это совет', f.rationale ?? rule?.rationale);
  else if (geometry) {
    sec('Почему это про лист', 'Проверка смотрит на раскладку листа, а не на модель: '
      + 'та же модель с другими координатами даст другие замечания. Это не нарушение UML 2.5.1.');
  } else if (gap) { sec('Почему не проверяется', gap.reason); sec('Чего не хватает', gap.missing); }
  // Подсказка правила — общей фразой; здесь она подана как совет к случаю.
  sec('Что делать', f.hint, 'rc-advice');

  const actions = el('div', { class: 'rc-actions' });
  if (where.found) {
    actions.append(el('button', {
      type: 'button', class: 'rc-btn rc-goto',
      title: 'Перейти к виноватому объекту на листе',
      onclick: (e) => { e.stopPropagation(); gotoFinding(f); },
    }, 'Показать на листе'));
  }
  // Кнопки в справочник у геометрии нет: статьи UML о ней не существует, и
  // «правила нет в наборе» здесь было бы неправдой — правило есть, оно в
  // vendor/archify. Вместо мёртвой ссылки называем, где оно живёт.
  actions.append(geometry
    ? el('span', { class: 'mini rc-absent', text: 'Проверка раскладки листа (archify): статьи в справочнике UML нет' })
    : ruleLink(f.ruleId, rule));
  box.append(actions);
  return box;
}

/**
 * Кнопка в справочник. Правило, которого в наборе нет (например, из
 * `planned.json`), кнопки не получает: мёртвая ссылка хуже её отсутствия.
 */
function ruleLink(ruleId, rule) {
  if (!rule) {
    return el('span', { class: 'mini rc-absent', text: 'Правила нет в наборе — статья недоступна' });
  }
  return el('button', {
    type: 'button', class: 'rc-btn rc-rule',
    title: `UML 2.5.1${rule.source?.clause ? `, п. ${rule.source.clause}` : ''}: пункт, дословный текст и OCL — в справочнике`,
    onclick: (e) => {
      e.stopPropagation();
      openRule(ruleId).then((ok) => {
        if (!ok) set({ hint: `Правило «${ruleId}» не открылось: справочнику не хватает места.` });
      }).catch((err) => set({ hint: `Справочник не открылся: ${err.message}` }));
    },
  }, 'Открыть правило в справочнике');
}

/** Раскрыть/свернуть карточку строки. */
function toggleFindingCard(row, f, basis) {
  const key = cardKey(f);
  if (openCard === key) { closeCards(); return; }
  closeCards();
  row.append(ruleCard(f, basis));
  row.classList.add('card-open');
  row.querySelector('.finding-open')?.setAttribute('aria-expanded', 'true');
  openCard = key;
}

/* ------------------------------------------- паспорт объекта (клик по маркеру) */

/*
 * Строка списка (`findingRow` + `ruleCard`) — паспорт ОДНОГО правила: что
 * нашлось / где / что делать / кнопка в справочник. Его структура не меняется.
 *
 * Но маркер стоит на ОБЪЕКТЕ, и у объекта может быть несколько правил. Клик по
 * такому маркеру открывает паспорт объекта: те же группы, но сразу все — по
 * группе на правило. Это ответ на вопрос «что не так с этим объектом», а строка
 * списка отвечает на «что не так по этому правилу».
 */

/** Маркер, раскрытый паспортом, — пересчитанный по текущей модели и листу. */
function passportMark() {
  if (!markPassport) return null;
  const d = currentDiagram(store.model);
  if (!d || d.id !== markPassport.diagramId) return null;
  const r = checkResult();
  if (!r.ready) return null;
  const findings = r.findings.filter((f) => f.status !== 'failed');
  const mark = marksForDiagram(d, findings)
    .find((m) => m.kind === markPassport.kind && m.id === markPassport.id);
  // Замечания поправили — паспорт закрывается, а не висит пустой ссылкой на
  // объект, у которого больше нет ни одного нарушения.
  return mark && mark.findings.length > 1 ? mark : null;
}

/**
 * Закрыть паспорт объекта и убрать его карточку из панели.
 *
 * Убирается ТОЛЬКО карточка, а не весь список. Закрытие приходит на pointerdown
 * (клик вне карточки), и перерисовка панели в этот момент снесла бы строку, по
 * которой человек как раз щёлкнул, — её click уже не дошёл бы до перехода.
 */
function closeMarkPassport() {
  if (!markPassport) return;
  markPassport = null;
  document.getElementById('mark-card')?.remove();
}

/** Модельный id объекта маркера: у фигуры — её элемент, у связи — её связь. */
function markSubjectId(mark) {
  const d = currentDiagram(store.model);
  if (!d) return null;
  if (mark.kind === 'shape') return (d.shapes ?? []).find((s) => s.id === mark.id)?.elementId ?? null;
  if (mark.kind === 'connector') return (d.links ?? []).find((l) => l.id === mark.id)?.relId ?? null;
  return null;
}

/** Замечания одного маркера по правилам — в порядке первого появления. */
function groupByRule(findings) {
  const map = new Map();
  for (const f of findings) {
    if (!map.has(f.ruleId)) map.set(f.ruleId, []);
    map.get(f.ruleId).push(f);
  }
  return map;
}

/**
 * Паспорт объекта: ВСЕ замечания одного маркера, сгруппированные по правилам.
 *
 * Заголовок называет объект (имя элемента или связи) и число правил на нём —
 * без этого карточка читалась бы как ещё одно замечание, а не как паспорт всех
 * сразу. Внутри группы — message, detail, where и hint: те же ответы, что у
 * `ruleCard`, но по каждому правилу этого объекта.
 */
function markCard(mark) {
  const findings = mark.findings ?? [];
  const subjectId = markSubjectId(mark);
  const subject = subjectId ? culpritName(store.model, subjectId) : 'объект на листе';
  const rules = new Set(findings.map((f) => f.ruleId)).size;
  const box = el('div', {
    class: 'rule-card mark-card',
    id: 'mark-card',
    'data-mark-view': String(mark.id),
    'data-mark-kind': mark.kind,
  },
  el('div', { class: 'rc-head' },
    el('span', { class: 'rc-id mc-subject', text: subject }),
    el('span', {
      class: 'rc-lvl mc-count',
      text: `${rules} ${plural(rules, 'правило', 'правила', 'правил')} на этом объекте`,
    })),
  el('div', {
    class: 'mini mc-note',
    text: 'Все замечания этого объекта: по группе на правило. Строка списка ниже — паспорт одного правила.',
  }));

  for (const [ruleId, list] of groupByRule(findings)) box.append(ruleGroup(ruleId, list));
  return box;
}

/** Одна группа паспорта: заголовок правила и все его находки на объекте. */
function ruleGroup(ruleId, list) {
  const first = list[0];
  const basis = basisOf(first);
  const rule = ruleOf(first);
  const clause = String(first.clause ?? rule?.source?.clause ?? '').trim();
  const levelText = basis === 'practice' ? 'практика'
    : basis === 'project' ? 'проект'
      : basis === 'geometry' ? 'раскладка'
        : (first.level === 'error' ? 'ошибка' : 'предупреждение');
  const group = el('div', { class: 'mc-group', 'data-rule': ruleId },
    el('div', { class: 'mc-group-head' },
      el('span', { class: 'rc-id mono', text: ruleId }),
      el('span', { class: `rc-lvl ${basis === 'uml' ? first.level : basis === 'geometry' ? 'geometry' : 'practice'}`, text: levelText }),
      clause ? el('span', { class: 'mc-clause', text: `п. ${clause}` }) : null));

  for (const f of list) {
    const where = whereOf(store.model, f);
    group.append(el('div', { class: 'mc-finding' },
      el('div', { class: 'mc-msg', text: f.message }),
      f.detail ? el('div', { class: 'rc-sec' }, el('b', { text: 'Что нашлось здесь' }),
        el('div', { class: 'rc-body', text: f.detail })) : null,
      el('div', { class: 'rc-sec' }, el('b', { text: 'Где' }),
        el('div', { class: 'rc-body', text: where.text })),
      f.hint ? el('div', { class: 'rc-sec rc-advice' }, el('b', { text: 'Что делать' }),
        el('div', { class: 'rc-body', text: f.hint })) : null,
      where.found ? el('div', { class: 'rc-actions' }, el('button', {
        type: 'button', class: 'rc-btn rc-goto',
        title: 'Перейти к виноватому объекту на листе',
        onclick: (e) => { e.stopPropagation(); gotoFinding(f); },
      }, 'Показать на листе')) : null));
  }
  return group;
}

/**
 * Паспорт закрывается тремя путями: Escape, клик вне карточки и смена листа.
 *
 * Клик вне — `pointerdown`, а не `click`: маркер тоже открывает паспорт на
 * pointerdown, и порядок «сначала закрыть старый, потом открыть новый» не
 * оставляет мигания двух карточек.
 */
document.addEventListener('pointerdown', (e) => {
  if (!markPassport) return;
  if (e.target?.closest?.('#mark-card')) return;
  closeMarkPassport();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !markPassport) return;
  // Открытый диалог закрывает себя сам: Esc принадлежит ему, а не паспорту.
  if (document.querySelector('sc-dialog[open]')) return;
  // Событие НЕ гасится: паспорт — верхний слой, но Esc в поле ввода и общий
  // обработчик приложения (main.js) должны отработать как раньше. Гашение
  // здесь сломало бы отмену ввода — а это дороже, чем «Esc закрыл два слоя».
  closeMarkPassport();
}, true);

// Смена листа: паспорт описывает вид на конкретном листе, и на другом листе
// того же объекта может не быть вовсе. Подписка стоит до main.js, поэтому
// паспорт снимается раньше, чем панель перерисуется.
subscribe(() => {
  if (!markPassport) return;
  if ((store.model.currentDiagramId ?? null) === markPassport.diagramId) return;
  closeMarkPassport();
});

/**
 * Карточка правила без функции: почему не проверяется и чего не хватает.
 * Замечания у такого правила быть не может — в карточку замечания оно не
 * попадает никогда, — поэтому вход сюда один: список «не проверяется» внизу
 * панели. Это единственное место, где панель говорит больше справочника:
 * в статье правила `check` просто пуст, и по нему не видно причины.
 */
function gapCard(id) {
  const u = gapOf(id);
  const rule = ruleset?.rules?.find((r) => r.id === id) ?? null;
  const box = el('div', { class: 'rule-card', 'data-rule': id });
  box.append(el('div', { class: 'rc-head' },
    el('span', { class: 'rc-id mono', text: id }),
    el('span', { class: 'rc-lvl', text: 'не проверяется' })));
  if (u) {
    box.append(el('div', { class: 'rc-sec' }, el('b', { text: 'Почему не проверяется' }),
      el('div', { class: 'rc-body', text: u.reason })));
    box.append(el('div', { class: 'rc-sec' }, el('b', { text: 'Чего не хватает' }),
      el('div', { class: 'rc-body', text: u.missing })));
  } else {
    box.append(el('div', { class: 'rc-sec' }, el('b', { text: 'Причина не названа' }),
      el('div', { class: 'rc-body', text: 'Движок не отдал причину для этого правила — это дефект набора, а не ответ.' })));
  }
  box.append(el('div', { class: 'rc-actions' }, ruleLink(id, rule)));
  return box;
}

/** Открыть карточку «не проверяется» из списка покрытия (и вернуть её после перерисовки). */
function toggleGapCard(host, id) {
  const key = `gap:${id}`;
  if (openCard === key) { closeCards(); return; }
  closeCards();
  host.append(gapCard(id));
  host.classList.add('card-open');
  openCard = key;
}

/** Кнопка пункта стандарта: статья пункта в читалке, цитата — запасной путь. */
function clauseButton(f) {
  const src = ruleOf(f)?.source ?? {};
  const clause = String(f.clause ?? src.clause ?? '');
  const constraint = String(f.constraint ?? src.constraint ?? '');
  return el('button', {
    type: 'button',
    class: 'clause',
    'data-clause': clause,
    title: `UML 2.5.1, п. ${clause} — ${constraint}: «${src.text ?? ''}». Откроется статья в справочнике.`.trim(),
    onclick: (e) => { e.stopPropagation(); showClause(f); },
  }, `п. ${clause}`);
}

/** Чип слоя практики: не ссылка на пункт, а вход в объяснение. */
function basisChip(f) {
  return el('button', {
    type: 'button', class: 'chip-basis', 'data-rule': f.ruleId,
    title: 'Почему это совет по практике, а не требование стандарта',
    onclick: (e) => { e.stopPropagation(); showFinding(f); },
  }, 'практика');
}

/**
 * Чип геометрии: «раскладка». Пункта стандарта у этого слоя нет и быть не
 * может — UML не требует, чтобы фигуры не перекрывались, — поэтому чип ведёт не
 * в справочник, а в диалог с оговоркой, что модель может быть верной, а лист
 * нечитаемым. Подпись «раскладка» говорит это без раскрытия диалога.
 */
function geometryChip(f) {
  return el('button', {
    type: 'button', class: 'chip-basis chip-geometry', 'data-rule': f.ruleId,
    title: 'Замечание к раскладке листа, а не к модели',
    onclick: (e) => { e.stopPropagation(); showGeometry(f); },
  }, 'раскладка');
}

/**
 * Низ панели: что набор не проверяет и почему. Это не «мелкий шрифт ради
 * галочки» — у каждого правила названо поле, которого нет в модели, и когда
 * поле появится, правило переедет в реестр.
 */
function coverageSection() {
  const uncovered = ruleset?.uncovered ?? [];
  // «Нужны, но не написаны» — второй знаменатель: правило нужно задаче
  // пособия, но его ещё нет в реестре (W2 кладёт список в `notation/rules/
  // planned.json`, движок отдаёт его как `ruleset.planned`). Без этого раздела
  // «все чисто» означало бы «все чисто среди написанного», а не «модель верна».
  // Код защитный: пока файла нет, `planned` пуст и раздел не появляется.
  const planned = Array.isArray(ruleset?.planned) ? ruleset.planned : [];
  if (!uncovered.length && !planned.length) return el('span', { hidden: true });
  const box = el('div', { class: 'checks-coverage-group' });
  if (uncovered.length) {
    // Раскрытая карточка невыразимого правила живёт внутри свёрнутого
    // <details>: без этого после перерисовки она осталась бы в закрытом
    // списке, и человек решил бы, что карточка пропала.
    const det = el('details', {
      class: 'coverage', id: 'checks-coverage',
      open: String(openCard ?? '').startsWith('gap:') ? true : null,
    });
    det.append(el('summary', { text: `Не проверяется: ${uncovered.length} правил — модель не выражает` }));
    const ul = el('ul');
    for (const u of uncovered) {
      // Строка списка — вход в карточку правила: здесь, а не в статье
      // справочника, видно, почему правила нет. Замечания у такого правила
      // быть не может, поэтому другого пути к его карточке нет.
      const key = `gap:${u.id}`;
      const li = el('li', {
        class: `coverage-rule${openCard === key ? ' card-open' : ''}`,
        role: 'button',
        tabindex: '0',
        'data-gap': u.id,
        title: 'Почему это правило не проверяется и чего не хватает модели',
        onclick: (e) => { if (!e.target.closest('.rule-card')) toggleGapCard(li, u.id); },
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGapCard(li, u.id); }
        },
      },
      el('span', { class: 'mono', text: u.id }),
      el('span', { class: 'mini', text: ` (п. ${u.clause}) — не хватает: ${u.missing}` }));
      if (openCard === key) li.append(gapCard(u.id));
      ul.append(li);
    }
    det.append(ul);
    box.append(det);
  }
  if (planned.length) {
    const det = el('details', { class: 'coverage planned', id: 'checks-planned' });
    det.append(el('summary', {
      text: `Нужны, но не написаны: ${planned.length}`,
      title: 'Правила, которые нужны задачам пособия, но ещё не написаны: модель их выражает, проверки нет',
    }));
    const ul = el('ul');
    for (const p of planned) {
      ul.append(el('li', {},
        el('span', { class: 'mono', text: p.id }),
        el('span', { class: 'mini', text: `${p.clause ? ` (п. ${p.clause})` : ''} — ${p.title ?? ''}${p.why ? `: ${p.why}` : ''}` })));
    }
    det.append(ul);
    box.append(det);
  }
  return box;
}

/* ------------------------------------------------------------- диалоги */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ruleOf = (finding) => ruleset?.rules.find((r) => r.id === finding.ruleId) ?? null;

/**
 * Диалог сбоя: что случилось и на каком правиле. Это не пункт стандарта и не
 * совет практики — поэтому у него своя формулировка и нет ссылки на пункт:
 * человеку важно понять, что сломалась проверка, а не модель.
 */
function showFailed(finding) {
  const rule = ruleOf(finding);
  const clause = rule?.source?.clause;
  return ScDialog.open({
    heading: 'Проверка не выполнилась',
    body: `
      <p><b>${esc(finding.message)}</b></p>
      ${finding.detail ? `<p>${esc(finding.detail)}</p>` : ''}
      <p class="mini">Это сбой проверки, а не замечание к модели: остальные правила отработали.
      Правило: <span class="mono">${esc(finding.ruleId)}</span>${clause ? `, п. ${esc(clause)}` : ''}.</p>`,
    buttons: [{ id: 'ok', label: 'Понятно', kind: 'primary' }],
  });
}

/**
 * Диалог замечания: стандарт — пункт и дословный текст констрейнта, практика —
 * объяснение с оговоркой про природу совета. Одна точка входа, чтобы кнопка
 * строки и внешний код не расходились в том, что показывать.
 */
export function showFinding(finding) {
  if (finding?.status === 'failed') return showFailed(finding);
  if (basisOf(finding) === 'practice') return showPractice(finding);
  if (basisOf(finding) === 'project') return showProject(finding);
  // У геометрии нет правила в наборе, поэтому `ruleOf` вернёт null — и это
  // штатно: диалог строится только по самому замечанию.
  if (basisOf(finding) === 'geometry') return showGeometry(finding);
  return showStandardClause(finding);
}

/** Прежнее имя `showClause` — им пользуются тесты; ведёт себя по слою замечания. */
export function showClause(finding) {
  if (basisOf(finding) === 'practice') return showPractice(finding);
  if (basisOf(finding) === 'project') return showProject(finding);
  if (basisOf(finding) === 'geometry') return showGeometry(finding);
  return openStandard(finding);
}

/**
 * Геометрия листа: что нашлось, что делать и главная оговорка слоя — это не
 * нарушение стандарта UML. Пункта, OCL и страницы здесь нет и быть не может:
 * правило перенесено из archify и судит картинку. `ruleId` показываем, потому
 * что по нему замечание ищут в коде и в отчётах.
 */
function showGeometry(finding) {
  return ScDialog.open({
    heading: 'Геометрия листа',
    body: `
      <p><b>${esc(finding.message)}</b></p>
      ${finding.detail ? `<p>${esc(finding.detail)}</p>` : ''}
      ${finding.hint ? `<p class="mini">${esc(finding.hint)}</p>` : ''}
      <p class="mini">Это не нарушение стандарта UML: модель может быть верной, а лист — нечитаемым.
      Правило: <span class="mono">${esc(finding.ruleId)}</span>.</p>`,
    buttons: [{ id: 'ok', label: 'Понятно', kind: 'primary' }],
  });
}

/**
 * Правило проекта: текст правила, что нашлось и оговорка о природе слоя.
 * Ни пункта, ни OCL здесь нет и быть не может — правило написал не стандарт,
 * а команда; единственная «ссылка» — имя правила в файле модели.
 */
function showProject(finding) {
  return ScDialog.open({
    heading: 'Правило проекта',
    body: `
      <p><b>${esc(finding.message)}</b></p>
      ${finding.detail ? `<p>${esc(finding.detail)}</p>` : ''}
      ${finding.hint ? `<p class="mini">${esc(finding.hint)}</p>` : ''}
      <p class="mini">Это не требование стандарта UML 2.5.1 и не совет по практике моделирования,
      а соглашение команды из файла модели. Правило: <span class="mono">${esc(finding.ruleId)}</span>.
      Его можно изменить в «Правилах проекта» на панели проверок.</p>`,
    buttons: [{ id: 'ok', label: 'Понятно', kind: 'primary' }],
  });
}

/**
 * Стандарт — статья пункта в читалке справочника (Б20е). Диалог с цитатой
 * остаётся запасным путём: панель проверок не имеет права зависеть от того,
 * собраны ли данные справочника и доехал ли запрос.
 */
function openStandard(finding) {
  const clause = String(finding.clause ?? ruleOf(finding)?.source?.clause ?? '').trim();
  if (!clause) return showStandardClause(finding);
  openClause(clause)
    .then((ok) => { if (!ok) showStandardClause(finding); })
    .catch(() => showStandardClause(finding));
  return null;
}

/**
 * Ссылка на пункт стандарта: дословный текст констрейнта, OCL и страница.
 *
 * Приложение офлайн, поэтому «пойти в стандарт» здесь значит показать цитату,
 * а не открыть адрес в сети. Когда появится справочник-читалка (Э10, план
 * ¶10.10), эта же кнопка будет вести на пункт в нём — с прокруткой к разделу
 * Constraints и подсветкой констрейнта, а лист останется на экране. Этот
 * диалог останется запасным путём: панель проверок не имеет права зависеть от
 * того, собраны ли данные справочника. Меняется только адрес кнопки, сама
 * кнопка и её место в строке — нет.
 */
function showStandardClause(finding) {
  const src = ruleOf(finding)?.source ?? {};
  return ScDialog.open({
    heading: `UML 2.5.1, п. ${esc(src.clause ?? finding.clause)}`,
    body: `
      <p><b>${esc(src.constraint ?? finding.constraint)}</b>${src.page ? `, с. ${esc(src.page)}` : ''}</p>
      <p>«${esc(src.text ?? '')}»</p>
      ${src.ocl ? `<p class="mono">${esc(src.ocl)}</p>` : ''}
      <p class="mini">Уровень: ${finding.level === 'error' ? 'ошибка' : 'предупреждение'}.
      В этой модели: ${esc(finding.detail || finding.message)}</p>`,
    buttons: [{ id: 'ok', label: 'Понятно', kind: 'primary' }],
  });
}

/** Практика: что нашлось, почему это запах и что это не пункт стандарта. */
function showPractice(finding) {
  const rule = ruleOf(finding);
  const rationale = String(finding.rationale ?? rule?.rationale ?? '').trim();
  return ScDialog.open({
    heading: 'Практика моделирования',
    body: `
      <p><b>${esc(finding.message)}</b></p>
      ${finding.detail ? `<p>${esc(finding.detail)}</p>` : ''}
      ${rationale ? `<p>${esc(rationale)}</p>` : ''}
      ${finding.hint ? `<p class="mini">${esc(finding.hint)}</p>` : ''}
      <p class="mini">Это не требование стандарта UML, а совет по практике моделирования.</p>`,
    buttons: [{ id: 'ok', label: 'Понятно', kind: 'primary' }],
  });
}

/* ------------------------------------------------- переход к виноватому */

/**
 * Листы в порядке поиска вида: названный замечанием, текущий, остальные.
 * Названный лист идёт первым, потому что `shape-isolated-on-diagram` судит
 * фигуру на конкретном листе: у одного элемента может быть несколько фигур, и
 * без этого порядка переход открыл бы первую попавшуюся вместо виноватой.
 */
function diagramOrder(model, preferId) {
  const diagrams = model.diagrams ?? [];
  const list = [];
  const prefer = preferId ? diagrams.find((d) => d.id === preferId) : null;
  if (prefer) list.push(prefer);
  const cur = currentDiagram(model);
  if (cur && !list.includes(cur)) list.push(cur);
  for (const d of diagrams) if (!list.includes(d)) list.push(d);
  return list;
}

/**
 * Вид объекта на каком-нибудь листе: фигура элемента или связь-вид связи.
 * Фигуры ищутся раньше связей по всем листам сразу: id приходит либо из
 * `elements`, либо из `relationships`, и перепутать их нечем, но порядок
 * «сначала фигура» сохраняет прежнее поведение панели.
 */
function locate(model, id, preferId = null) {
  const order = diagramOrder(model, preferId);
  for (const d of order) {
    const shape = (d.shapes ?? []).find((s) => s.elementId === id);
    if (shape) return { diagramId: d.id, view: { kind: 'shape', id: shape.id } };
  }
  for (const d of order) {
    const link = (d.links ?? []).find((l) => l.relId === id);
    if (link) return { diagramId: d.id, view: { kind: 'connector', id: link.id } };
  }
  return null;
}

/**
 * Как назвать виновника словами. Элемент — по имени. Связь — по виду и концам:
 * у неё нет ни строки в дереве, ни имени в большинстве моделей, и «связь «r1»»
 * человеку не говорит ничего, особенно после перехода на другой лист.
 */
function culpritName(model, id) {
  const rel = findRelationship(model, id);
  if (rel) {
    const label = NOTATION.connectors[rel.kind]?.label ?? rel.kind;
    const from = findElement(model, rel.from);
    const to = findElement(model, rel.to);
    const ends = from && to ? `«${from.name || 'без имени'}» — «${to.name || 'без имени'}»` : '';
    const named = String(rel.name ?? '').trim();
    return [named ? `${label} «${named}»` : label, ends].filter(Boolean).join(' ');
  }
  const target = findElement(model, id);
  return target ? `«${target.name || '(без имени)'}»` : `«${id}»`;
}

/**
 * Строки дерева, которые подсвечиваются за переход: у элемента — он сам, у
 * связи — оба её конца. Связам в дереве своей строки не положено (дерево
 * перечисляет элементы модели), поэтому «связь участвует» читается по её
 * концам — тем же двум, между которыми она нарисована.
 */
function focusIdsOf(model, id) {
  const rel = findRelationship(model, id);
  if (rel) return [rel.from, rel.to].filter(Boolean).map(String);
  return findElement(model, id) ? [String(id)] : [];
}

/**
 * След замечания в дереве. `at` растёт на каждый переход: дерево прокручивает
 * строку только когда счётчик изменился, иначе оно дёргалось бы на каждой
 * перерисовке, а повторный клик по тому же замечанию ничего бы не показывал.
 */
let findingAt = 0;

/** Левая панель переходит к дереву модели: вкладка «Модель» и никакого урока. */
function showModelTree() {
  closeLesson();
  const group = document.querySelector('.panel-tabs[data-group="left"]');
  const pane = group?.parentElement;
  const tab = pane?.querySelector('.tab[data-tab="model-pane"]');
  if (!tab) return;
  for (const t of group.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
  for (const p of pane.querySelectorAll('.tabpane')) p.classList.toggle('active', p.id === 'model-pane');
}

/* ------------------------------------------------------------- вспышка */

/** Сколько живёт вспышка: одна короткая вспышка, а не мигающая лампочка. */
const FLASH_MS = 1200;

let flashLayer = null;    // <g> поверх листа, свой у каждой вспышки
let flashTimer = null;
let flashDiagramId = null;

/**
 * Снять вспышку: элемент-обводку и её таймер. Зовётся перед новой вспышкой, по
 * таймеру и при смене листа — обводка в координатах старого листа на новом
 * означала бы «виноват вот этот» про совсем другой объект.
 */
function clearFindingFlash() {
  clearTimeout(flashTimer);
  flashTimer = null;
  flashDiagramId = null;
  flashLayer?.remove();
  flashLayer = null;
}

/**
 * Вспышка вокруг вида: обводка акцентным цветом на 1,2 с.
 *
 * Рисуется отдельным слоем поверх листа, а не классом на самом узле листа.
 * Экспорт (`exportSvgString`) строит SVG заново из модели и DOM листа не
 * читает, поэтому такая обводка в файл не попадает вовсе — ни при вспышке, ни
 * после неё. Класс на узле пришлось бы вырезать из экспорта руками, а
 * `render.js` — не наша зона правки.
 *
 * Для связи обводка идёт по самой линии: путь копируется у нарисованной связи,
 * потому что маршрут считает `render.js`, и повторять его здесь значило бы
 * завести второй расчёт того же самого.
 */
function flashView(view) {
  clearFindingFlash();
  const viewport = document.getElementById('viewport');
  if (!viewport) return;
  const layer = svgEl('g', { class: 'finding-flash-layer', 'pointer-events': 'none' }, viewport);
  let drawn = null;

  /**
   * Три слоя одной вспышки. Одна тонкая линия при дробном масштабе попадала на
   * границу пикселя и с одной стороны выходила в 1 px вместо 2 — человек видел
   * «обводка есть, а слева её нет». Поэтому линия всегда идёт с ореолом:
   * широкий полупрозрачный штрих под ней не даёт стороне пропасть, как бы она
   * ни легла на сетку. Фигуру дополнительно подсвечивает заливка — тогда
   * виноватый объект видно даже боковым зрением.
   */
  const outline = (tag, geometry, { wash = false } = {}) => {
    if (wash) svgEl(tag, { ...geometry, class: 'finding-flash-wash' }, layer);
    svgEl(tag, { ...geometry, class: 'finding-flash-halo' }, layer);
    return svgEl(tag, { ...geometry, class: 'finding-flash', 'data-flash': view.id }, layer);
  };

  if (view.kind === 'shape') {
    const sh = findShape(store.model, view.id);
    if (sh) {
      const { w, h } = layoutOf(sh, elementOf(store.model, sh));
      drawn = outline('rect', { x: sh.x - 5, y: sh.y - 5, width: w + 10, height: h + 10 }, { wash: true });
    }
  } else {
    const node = [...viewport.querySelectorAll('[data-kind="conn"]')]
      .find((g) => g.dataset.id === view.id);
    const d = node?.querySelector('path.conn')?.getAttribute('d');
    if (d) drawn = outline('path', { d });
  }
  if (!drawn) { layer.remove(); return; }
  flashLayer = layer;
  flashDiagramId = store.model.currentDiagramId ?? null;
  flashTimer = setTimeout(clearFindingFlash, FLASH_MS);
}

// Вспышка живёт на листе, на котором её поставили: сменился лист — снимаем.
subscribe(() => {
  if (flashLayer && (store.model.currentDiagramId ?? null) !== flashDiagramId) clearFindingFlash();
});

/**
 * Перейти от замечания к объекту: открыть лист, выделить вид, поставить его в
 * центр видимой части, мигнуть обводкой и подсветить строку в дереве.
 *
 * Порядок листов — названный замечанием, текущий, первый подходящий; лист
 * меняется только когда вида на текущем нет. Если вида нет нигде (`элемент не
 * показан ни на одной диаграмме`), лист не трогается, но дерево всё равно
 * показывает элемент: модель его знает, и человеку нужно увидеть строку.
 *
 * @param {object} finding замечание движка правил
 * @returns {boolean} true, если вид объекта найден хоть на одном листе
 */
export function gotoFinding(finding) {
  // У сбоя нет виноватого: `targets` пуст, и переход сказал бы «элемент есть в
  // модели, но не показан ни на одной диаграмме» — то есть соврал бы про
  // модель. Такую запись показываем диалогом, как это делает строка панели.
  if (finding?.status === 'failed') { showFailed(finding); return false; }
  // `validation.fix` — человек перешёл от замечания к виноватому объекту,
  // то есть собирается его править. Уходит только id правила: ни текста
  // замечания, ни имени элемента здесь нет и быть не может.
  if (finding?.ruleId) track('validation.fix', { rule: finding.ruleId });
  const model = store.model;
  const prefer = finding.diagramId ?? null;
  const targets = finding.targets ?? [];
  let hit = null;
  let targetId = null;
  for (const id of targets) {
    hit = locate(model, id, prefer);
    if (hit) { targetId = String(id); break; }
  }
  findingAt += 1;

  // Дерево — раньше листа: пока открыт урок курса, листа на экране нет вовсе,
  // и центрировать было бы нечего (ширина нулевая).
  showModelTree();

  if (!hit) {
    const ids = targets.flatMap((id) => focusIdsOf(model, id));
    const rel = targets.map((id) => findRelationship(model, id)).find(Boolean);
    // Пустые `targets` — это не «элемент не показан», а «виноватого нет
    // вовсе»: так у правил уровня модели и у замечаний к листу целиком
    // (например, «лист шире окна читателя»). Прежняя фраза про элемент в
    // модели выдумывала бы элемент, которого замечание не называло.
    const noCulprit = !targets.length
      ? (basisOf(finding) === 'geometry'
        ? 'Замечание относится ко всему листу: виноватого элемента нет, лист назван в тексте замечания.'
        : 'Виноватого элемента нет: замечание относится к модели целиком.')
      : null;
    set({
      findingFocus: ids.length ? { elementIds: ids, at: findingAt } : null,
      hint: noCulprit ?? (rel
        ? `Связь «${NOTATION.connectors[rel.kind]?.label ?? rel.kind}» есть в модели, `
          + 'но не показана ни на одной диаграмме — её концы в дереве слева.'
        : 'Элемент есть в модели, но ни на одной диаграмме не показан — он в дереве слева.'),
    });
    return false;
  }

  // Связь может стоять на другом листе: переход туда без пояснения выглядит как
  // «лист сам перескочил». Поэтому лист называется прямо в подсказке — а
  // «перескочили ли» надо помнить ДО `commit`, иначе сравнение всегда даст
  // «нет»: лист уже сменился.
  const moved = model.currentDiagramId !== hit.diagramId;
  const sheet = moved ? findDiagram(model, hit.diagramId)?.name : null;
  if (moved) {
    commit('Переход к замечанию', (m) => { m.currentDiagramId = hit.diagramId; });
  }
  set({
    selection: [hit.view],
    findingFocus: { elementIds: focusIdsOf(model, targetId), at: findingAt },
    hint: `${finding.message}: ${culpritName(model, targetId)}`
      + (sheet ? ` — на диаграмме «${sheet}»` : ''),
  });
  renderCanvas();
  flashView(hit.view);
  // Центрирование — в микрозадаче, сразу после той, в которой `emit` обновит
  // панели и полосу инструментов: её высота меняется вместе с листом, а от неё
  // зависит высота видимой части. Померяй раньше — и объект встанет в центр
  // старой, уже не существующей рамки (на 24 px мимо).
  queueMicrotask(() => centerOn(hit.view, { diagramId: hit.diagramId }));
  return true;
}

/* ---------------------------------------------------------------- утилиты */

/** Сколько каких правил проверено — для подписи пустого состояния.
 *
 * Перечисление собирается списком с одним «и» перед последним пунктом: слоёв
 * теперь четыре, и склейка через `join(' и ')` дала бы «и … и … и …». Слой
 * геометрии назван последним и без числителя правил: он проверяет не набор
 * правил, а лист, и «по 0 из 0 правил» здесь читалось бы как поломка.
 */
function checkedLayersText() {
  const rules = ruleset?.rules ?? [];
  const uml = rules.filter((r) => basisOf(r) === 'uml');
  const practice = rules.filter((r) => basisOf(r) === 'practice');
  const parts = [`по ${uml.filter((r) => r.fn).length} из ${uml.length} правил UML 2.5.1`];
  if (practice.length) parts.push(`по ${practice.filter((r) => r.fn).length} правилам практики моделирования`);
  // Правила проекта — из модели, а не из набора: считаем то, что модель несёт.
  const project = Array.isArray(store.model.projectRules) ? store.model.projectRules.length : 0;
  if (project) parts.push(`по ${project} ${plural(project, 'правилу', 'правилам', 'правилам')} проекта`);
  parts.push('по проверкам геометрии листа');
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`
    : parts[0];
  return `Модель проверена ${list}`;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
