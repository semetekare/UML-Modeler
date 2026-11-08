// Чтение файла модели, даже если он оборван.
//
// Файл, который закрыли во время записи, диск, на котором кончилось место,
// оборванная передача — всё это даёт JSON, обрезанный на полуслове. Раньше
// такой файл не читался вовсе: `JSON.parse` бросал исключение, и человек
// терял модель целиком. Здесь восстановление: разбор падает — берём
// последнее ЦЕЛОЕ значение до места обрыва и закрываем открытые `{`/`[` в
// обратном порядке.
//
// Правило (одно и то же для всех случаев, без «попробуем так»):
//
//   1. Идём по тексту один раз и запоминаем точки, где значение ЗАКОНЧИЛОСЬ:
//      после `}` и `]`, после закрывающей кавычки строки, после числа или
//      слова (`true`/`false`/`null`). В каждой точке помним, какие скобки
//      тогда были открыты.
//   2. Если `JSON.parse` упал, перебираем эти точки с конца: берём префикс
//      до точки, дописываем закрывающие скобки того места — и пробуем
//      разобрать. Первая удача и есть восстановление: хвост после неё
//      отрезан, скобки закрыты.
//   3. Не вышло ни на одной точке — говорим человеку позицию и что делать,
//      а не показываем стек.
//
// Почему с конца: обрыв почти всегда в самом конце файла, и последняя целая
// точка — это и есть «до последнего целого объекта». Обрыв внутри строки
// отрезает незаконченную пару «ключ: значение» целиком: закрывающая кавычка
// строки в такой точке ещё не встретилась, поэтому точкой она не считается.
//
// Предел 32 МБ: восстановление — это второй проход по тексту и до 32 попыток
// разбора. На файле в сотни мегабайт это минуты работы браузера ради
// результата, который человек всё равно не откроет. Такой файл сразу
// называется слишком большим.

/** Больше этого не восстанавливаем — сразу говорим «слишком большой». */
export const MAX_REPAIR_BYTES = 32 * 1024 * 1024;

/** Сколько точек с конца пробуем, прежде чем сдаться. */
const MAX_ATTEMPTS = 32;

/** Сколько последних точек держим в памяти (кольцевой буфер). */
const MAX_POINTS = 256;

const CLOSER = { '{': '}', '[': ']' };
const TOKEN = /[0-9A-Za-z+\-.]/;

const utf8Bytes = (text) => {
  try { return new TextEncoder().encode(text).length; } catch { return text.length * 2; }
};

/** Закрывающие скобки для стека открытых, в обратном порядке. */
function closers(stack) {
  let out = '';
  for (let i = stack.length - 1; i >= 0; i -= 1) out += CLOSER[stack[i]];
  return out;
}

/**
 * Точки, где значение только что закончилось: `{ at, close }`, по возрастанию
 * `at`. `at` — индекс ПЕРВОГО символа после значения, `close` — скобки,
 * которых не хватает префиксу в этот момент.
 *
 * Строки разбираются по-настоящему: `}` внутри строки точкой не станет,
 * экранированная кавычка строку не закрывает.
 *
 * Хранятся только последние MAX_POINTS точек (кольцевой буфер): дальше
 * MAX_ATTEMPTS от конца мы всё равно не смотрим, а файл в 32 МБ со строками
 * по десять символов даёт миллионы точек — держать их все в памяти незачем.
 * Строка закрывающих скобок не собирается заново на каждой точке: она
 * обновляется на каждом `{`/`[` и каждом закрытии, а точки делят её.
 */
export function commitPoints(text) {
  const ringAt = new Float64Array(MAX_POINTS);
  const ringClose = new Array(MAX_POINTS);
  let count = 0;
  let closeNow = '';

  const push = (at) => {
    const slot = count % MAX_POINTS;
    ringAt[slot] = at;
    ringClose[slot] = closeNow;
    count += 1;
  };

  let inString = false;
  let escaped = false;
  let token = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        inString = false;
        push(i + 1);
      }
      continue;
    }

    // Слово или число (true, false, null, 12.5e3) закончилось на этом символе.
    if (token) {
      if (TOKEN.test(c)) continue;
      push(i);
      token = false;
    }

    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') {
      closeNow = CLOSER[c] + closeNow;
      continue;
    }
    if (c === '}' || c === ']') {
      if (closeNow) closeNow = closeNow.slice(1);
      push(i + 1);
      continue;
    }
    if (TOKEN.test(c)) { token = true; continue; }
    // Пробел, запятая, двоеточие — значение здесь не кончается.
  }
  if (token) push(text.length);

  const size = Math.min(count, MAX_POINTS);
  const out = [];
  for (let n = count - size; n < count; n += 1) {
    out.push({ at: ringAt[n % MAX_POINTS], close: ringClose[n % MAX_POINTS] });
  }
  return out;
}

/** Позиция, на которой разбор сломался, из сообщения движка. */
function failurePoint(text, error) {
  const msg = String(error?.message ?? '');
  const pos = /position (\d+)/.exec(msg);
  if (pos) return Math.min(Number(pos[1]), text.length);
  const lineCol = /line (\d+) column (\d+)/i.exec(msg);
  if (lineCol) {
    const line = Number(lineCol[1]);
    const col = Number(lineCol[2]);
    let at = 0;
    for (let n = 1; n < line; n += 1) {
      const nl = text.indexOf('\n', at);
      if (nl < 0) return text.length;
      at = nl + 1;
    }
    return Math.min(at + col - 1, text.length);
  }
  const tok = /Unexpected token '(.+?)'/.exec(msg);
  if (tok) {
    const at = text.indexOf(tok[1]);
    if (at >= 0) return at;
  }
  const first = text.search(/\S/);
  if (first >= 0 && text[first] !== '{' && text[first] !== '[') return first;
  return text.length;
}

const lineColumn = (text, position) => {
  const at = Math.max(0, Math.min(position, text.length));
  const before = text.slice(0, at);
  const nl = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: at - nl };
};

const snippet = (text) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return s ? `«${s}${String(text ?? '').trim().length > 40 ? '…' : ''}»` : '';
};

const megabytes = (bytes) => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');

/**
 * Разобрать текст файла модели; если он обрезан — восстановить до последнего
 * целого значения.
 *
 * @param {string|object} text  содержимое файла (объект принимается как есть —
 *                              так миграция v2 передаёт уже разобранный файл)
 * @returns {{raw: object, truncated: null|{position: number, cutAt: number}}}
 * @throws {Error} внятная ошибка, когда восстановить нечего
 */
export function parseJsonText(text) {
  if (text && typeof text === 'object') return { raw: text, truncated: null };
  const s = String(text ?? '');
  if (!s.trim()) throw new Error('Файл пуст — в нём нет модели.');

  try {
    return { raw: JSON.parse(s), truncated: null };
  } catch (error) {
    const position = failurePoint(s, error);

    const bytes = utf8Bytes(s);
    if (bytes > MAX_REPAIR_BYTES) {
      const { line, column } = lineColumn(s, position);
      throw new Error(
        `Файл слишком большой для восстановления: ${megabytes(bytes)} МБ при пределе `
        + `${MAX_REPAIR_BYTES / (1024 * 1024)} МБ, и JSON в нём повреждён (позиция ${position}, `
        + `строка ${line}, столбец ${column}). Такой файл не чиним — откройте исправную копию `
        + 'или сохраните модель заново.',
      );
    }

    const points = commitPoints(s);
    const from = Math.max(0, points.length - MAX_ATTEMPTS);
    for (let k = points.length - 1; k >= from; k -= 1) {
      const { at, close } = points[k];
      if (at <= 0) continue;
      let raw;
      try { raw = JSON.parse(s.slice(0, at) + close); } catch { continue; }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return { raw, truncated: { position, cutAt: at } };
      }
    }

    const { line, column } = lineColumn(s, position);
    const head = snippet(s.slice(0, 40));
    if (position === 0 && head && !/^\{|^\[/.test(s.trim())) {
      throw new Error(
        `Это не JSON: файл начинается с ${head} (позиция 0, строка 1, столбец 1). `
        + 'Модель — это файл *.uml.json, он начинается с «{».',
      );
    }
    throw new Error(
      `Файл повреждён на позиции ${position} (строка ${line}, столбец ${column}): `
      + 'до этого места нет ни одного целого значения, восстановить нечего. '
      + 'Проверьте, что файл не обрезан и сохранён как JSON, а не как страница.',
    );
  }
}
