// Modal dialogs, on the kit's <sc-dialog> (ui-kit/js/dialog.js): the head,
// the backdrop, focus trapping and the Esc/✕/Enter handling are the kit's,
// not ours. This file only translates the app's questions into dialog specs.
//
//   confirmDialog(title, message, ok, cancel) → Promise<boolean>
//   chooseDiagramType({ owner })              → Promise<{kind, name}|null>
//   showHelp()                                → the shortcut sheet
//   showError(title, message)                 → an error the person reads
//
// Toasts (save/export feedback) go through ScToast directly in toolbar.js.

import { ScDialog } from '../../ui-kit/js/dialog.js';
import { NOTATION, TYPE_IDS, typeOf } from '../model/notation.js';

const primary = (id, label) => ({ id, label, kind: 'primary' });
const ghost = (id, label) => ({ id, label, kind: 'ghost' });

/**
 * Версия приложения — для справки. Одна константа, а не чтение
 * app/package.json: import JSON в браузере без бандлера не работает, а
 * fetch за версией стоил бы запроса ради одной строки. Значение держится
 * в согласии с package.json («version»: "1.0.0").
 */
export const APP_VERSION = '1.0.0';

/** Исходный код — публичный репозиторий продукта (docs/seo/SEO-PLAN.md §5.1). */
const SOURCE_URL = 'https://github.com/semetekare/UML-Modeler';

/** Yes/no question. Resolves true only when the primary button was pressed. */
export function confirmDialog(title, message, okLabel = 'OK', cancelLabel = 'Отмена') {
  return ScDialog.open({
    heading: title,
    body: `<p>${escapeHtml(message)}</p>`,
    buttons: [ghost('cancel', cancelLabel), primary('ok', okLabel)],
  }).then((id) => id === 'ok');
}

/**
 * Pick one of the 14 UML 2.5 diagram types.
 *
 * Two groups (structural, behavioural), the type's name and a one-line
 * description. The name field is prefilled and can be edited; an empty name
 * falls back to «Диаграмма N».
 */
export async function chooseDiagramType({ owner = null } = {}) {
  const order = TYPE_IDS();
  const groups = [
    { key: 'structural', title: 'Структурные' },
    { key: 'behavioural', title: 'Поведенческие' },
  ];
  const body = `
    <p>${owner
    ? `Диаграмма будет принадлежать элементу «${escapeHtml(owner)}».`
    : 'Тип диаграммы: UML 2.5, все 14 типов.'}</p>
    ${groups.map((g) => `
      <div class="dt-group">${g.title}</div>
      <div class="dt-grid">
        ${order.filter((id) => typeOf(id)?.kind === g.key).map((id) => {
    const t = typeOf(id);
    return `<label class="dt-item">
            <input type="radio" name="dt-kind" value="${id}" ${id === 'class' ? 'checked' : ''}>
            <span class="dt-name">${t.label}</span>
            <span class="dt-what">${escapeHtml(t.what ?? '')}</span>
          </label>`;
  }).join('')}
      </div>`).join('')}
    <label class="dt-label">Имя диаграммы
      <input id="dt-name" type="text" placeholder="Диаграмма" autocomplete="off">
    </label>
  `;
  let kind = 'class';
  let name = '';
  const pending = ScDialog.open({
    heading: 'Новая диаграмма UML',
    body,
    buttons: [ghost('cancel', 'Отмена'), primary('ok', 'Создать')],
  });
  const dlg = document.querySelector('sc-dialog[open]');
  if (dlg) {
    const nameInput = dlg.querySelector('#dt-name');
    dlg.addEventListener('change', (e) => {
      const input = e.target.closest('input[name="dt-kind"]');
      if (input) {
        kind = input.value;
        if (nameInput && !nameInput.dataset.touched) nameInput.placeholder = typeOf(kind)?.label ?? 'Диаграмма';
      }
      if (e.target === nameInput) nameInput.dataset.touched = '1';
    });
    dlg.addEventListener('input', (e) => {
      if (e.target === nameInput) { name = nameInput.value; nameInput.dataset.touched = '1'; }
    });
  }
  const id = await pending;
  if (id !== 'ok') return null;
  if (dlg) {
    const checked = dlg.querySelector('input[name="dt-kind"]:checked');
    if (checked) kind = checked.value;
    const ni = dlg.querySelector('#dt-name');
    if (ni) name = ni.value.trim();
  }
  const type = typeOf(kind);
  return { kind, name: name || `Диаграмма ${type?.label ?? ''}`.trim() };
}

/**
 * «Разложить автоматически» — вопрос ДО применения.
 *
 * Три вещи, которые человек обязан увидеть до нажатия: что раскладывается
 * (лист или выделение), сколько ручных изгибов будет потеряно (счёт по
 * модели, а не «на глаз»), и что сохранить их нельзя — точки заданы в старой
 * системе координат, а фигуры переезжают. Строка «ручных изгибов нет» стоит
 * на месте предупреждения всегда: иначе человек не знает, проверяли ли.
 *
 * Возвращает `{ gap }` или `null` (отмена).
 */
export async function confirmLayout(plan) {
  const c = plan.counts;
  // Считаем не «все связи с точками», а только те, чьи точки пропадут
  // насовсем: изгибы, поставленные прошлой раскладкой, она воспроизведёт
  // теми же числами, и пугать ими второй раз нельзя.
  const bent = c.lostLinks ?? c.bentLinks;
  const pts = c.points;
  const warn = pts > 0 && bent > 0;
  const what = plan.scope === 'selection'
    ? `выделение — ${c.shapes} ${plural(c.shapes, 'фигура', 'фигуры', 'фигур')}`
    : `весь лист — ${c.shapes} ${plural(c.shapes, 'фигура', 'фигуры', 'фигур')}`;
  const lost = warn
    ? `<b>Ручные изгибы:</b> ${bent} ${plural(bent, 'связь', 'связи', 'связей')} `
      + `с ручными точками, ${pts} ${plural(pts, 'точка', 'точки', 'точек')} — будут потеряны.`
    : '<b>Ручные изгибы:</b> ручных изгибов нет — терять нечего.';
  const body = `
    <p><b>Что раскладывается:</b> ${what}.</p>
    <p>${lost}</p>
    <p class="dt-what">Связи заново прикрепятся к ближайшим сторонам фигур и, где есть место,
    обойдут чужие рамки.</p>
    ${warn ? '<p class="dt-what">Сохранить изгибы нельзя: они заданы в старых координатах, '
    + 'а фигуры переезжают. Точки будут удалены, а связи проложатся заново.</p>' : ''}
    ${c.grown ? `<p class="dt-what">Контейнеры увеличатся, чтобы содержимое поместилось: ${c.grown}.</p>` : ''}
    <label class="dt-label">Зазор между фигурами, px
      <input id="lay-gap" type="number" min="8" max="200" step="1" value="${plan.gap}">
    </label>`;
  const pending = ScDialog.open({
    heading: 'Разложить автоматически',
    body,
    buttons: [
      ghost('cancel', 'Отмена'),
      primary('ok', warn ? 'Разложить и потерять изгибы' : 'Разложить'),
    ],
  });
  let gap = plan.gap;
  const dlg = document.querySelector('sc-dialog[open]');
  const readGap = () => {
    const input = dlg?.querySelector('#lay-gap');
    const n = Number(input?.value);
    if (Number.isFinite(n) && n > 0) gap = Math.min(200, Math.max(8, Math.round(n)));
  };
  if (dlg) {
    dlg.addEventListener('input', (e) => {
      if (e.target?.id === 'lay-gap') readGap();
    });
  }
  const id = await pending;
  if (id !== 'ok') return null;
  readGap();
  return { gap };
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** The shortcut / how-to sheet (toolbar «?»). */
export function showHelp() {
  return ScDialog.open({
    heading: 'Подсказка',
    body: `
      <p><b>Типы диаграмм.</b> «+» у списка диаграмм создаёт любую из 14 диаграмм UML 2.5.
      Диаграмма может принадлежать элементу модели — тогда она видна в дереве под ним
      и открывается оттуда.</p>
      <p><b>Модель и вид.</b> Элемент живёт в модели, диаграмма — вид на него: один класс
      может стоять на нескольких листах, и переименование видно на всех. Связь тоже живёт
      в модели: <b>Delete</b> снимает её с листа, <b>Shift+Delete</b> удаляет из модели.</p>
      <p><b>Инструменты.</b> Они — в полосе над листом и зависят от типа диаграммы:
      кликните фигуру и место на листе; для связи кликните исходную, затем целевую фигуру.
      <b>V</b> — стрелка, <b>Esc</b> — вернуть стрелку, <b>Ctrl+K</b> — палитра команд.</p>
      <p><b>Правка.</b> Двойной клик — имя фигуры, строка атрибута/операции, строка
      entry/do/exit или подпись связи. Члены и tagged values правятся и в инспекторе справа.
      В таблице членов три галочки: <b>S</b> — статический (подчёркнут), <b>/</b> — производный,
      <b>id</b> — идентификатор (на листе «/имя» и «{id}»). У класса есть галочка
      «Абстрактный» — имя рисуется курсивом.</p>
      <p><b>PlantUML.</b> «Файл → Импорт PlantUML…» читает <span class="mono">.puml</span>
      в модель и кладёт его на <b>новый лист</b> — существующее не заменяется. Второй пункт
      импортирует текст из буфера, без файла. Раскладку импорт не придумывает: фигуры встают
      сеткой в порядке объявления, двигать их — ваша работа. Что не прочиталось, показано
      в тосте кнопкой «Подробности».</p>
      <p><b>Копирование.</b> <b>Ctrl+C</b> / <b>Ctrl+X</b> / <b>Ctrl+V</b> / <b>Ctrl+D</b>.
      Вставка на том же листе создаёт новые элементы, вставка на другом — вид уже существующего;
      <b>Ctrl+D</b> всегда создаёт новый элемент со сдвигом на шаг сетки.</p>
      <p><b>Группа.</b> Рамка-лассо на пустом месте листа выделяет фигуры, <b>Shift+клик</b>
      добавляет или убирает одну. Выделение перетаскивается и удаляется целиком, стрелки
      сдвигают его на шаг сетки (<b>Shift</b> — на пиксель). При двух и более фигурах в
      инспекторе появляются шесть выравниваний и два распределения — они же в меню «Правка».
      Панорама листа — средняя кнопка мыши или <b>Alt</b>+перетаскивание.</p>
      <p><b>Дерево.</b> Двойной щелчок или перетаскивание строки на лист ставит вид элемента;
      если вид уже есть — он подсвечивается, второй не создаётся.</p>
      <p><b>Сообщения.</b> В диаграмме последовательности сообщение тянется вверх-вниз:
      порядок — это высота, номера пересчитываются сами.</p>
      <p><b>Масштаб.</b> Колесо мыши; в статусбаре масштаб — это меню: 50 / 75 / 100 / 125 / 150 %
      и «Вписать в окно». <b>Ctrl+0</b> — вписать, <b>Ctrl+=</b>/<b>Ctrl+-</b> — по списку пресетов,
      <b>Ctrl+1</b> — 100 %. «Вид» → «Сетка» — показать шаг 10 px.</p>
      <p><b>Файл.</b> Модель хранится в <span class="mono">*.uml.json</span>. Профиль
      стереотипов (304) с поиском — на вкладке «Профиль» справа.</p>
      <p><b>Версия и исходники.</b> UML Modeler <span class="mono">v${APP_VERSION}</span> —
      <a href="${SOURCE_URL}" target="_blank" rel="noopener"
         style="color:var(--accent);text-decoration:underline;text-underline-offset:2px">исходный
      код на GitHub</a>. Приложение работает офлайн: модель, файлы и текст не уходят
      никуда. В сборке со счётчиком — только по вашему явному согласию и только
      имена нажатых команд.</p>
    `,
    buttons: [primary('ok', 'Понятно')],
  });
}

/** An error the person should read, not a silent console line. */
export function showError(title, message) {
  return ScDialog.open({
    heading: title,
    body: `<p>${escapeHtml(message)}</p>`,
    buttons: [primary('ok', 'Понятно')],
  });
}

/**
 * «Подробности» о прочитанном файле: что именно пришлось исправить при
 * чтении. Это не ошибка — модель уже открыта, — поэтому список, а не
 * красная рамка: человек читает, что спасено, и решает, сохранять ли.
 */
export function showRepairs(title, repairs = []) {
  const items = repairs.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  return ScDialog.open({
    heading: title,
    body: `<p>Файл открыт, но часть данных пришлось восстановить: `
      + `${repairs.length}. Модель на листе уже с этими исправлениями — `
      + 'сохраните её, чтобы файл стал целым.</p>'
      + `<ul class="repairs">${items}</ul>`,
    buttons: [primary('ok', 'Понятно')],
  });
}

/** Is a modal (kit dialog or the command palette) on screen right now? */
export function modalOpen() {
  return !!document.querySelector('sc-dialog[open], sc-command-palette[open]');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** The type list, exposed for the toolbar menu (one line per type). */
export const DIAGRAM_TYPES = () => TYPE_IDS().map((id) => ({ id, ...NOTATION.types[id] }));
