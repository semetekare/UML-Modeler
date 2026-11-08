// Заливка фигуры: сплошная или градиент — правило самого оригинала,
// прочитанное в Deep mode из vpplatform.jar (адреса — в MECHANICS.md §14).
//
//   v/cmw/i#<init>()V            модель заливки: type=1, gradientStyle=0,
//                                alpha=255; статические a=1, b=2, c=100, d=0
//   v/cmw/aw#a(v.byf.cn;Ljava/awt/Rectangle;)Ljava/awt/Paint;   @0x0000
//       type == 2 и прямоугольник задан → GradientPaint(style, rect, c1, c2)
//       type == 1                      → c1, сплошной цвет
//       иначе                          → null (фигура не залита)
//   v/cmw/aw#a(ILjava/awt/Rectangle;Ljava/awt/Color;Ljava/awt/Color;)
//            Ljava/awt/GradientPaint;                            @0x0000..0x04cf
//       16 направлений; каждая ветка строит две точки и заканчивается
//       `new GradientPaint(p1, color1, p2, color2, true)` — последний
//       аргумент cyclic=true, поэтому градиент на половину фигуры зеркалится.
//
// Точки в оригинале считаются в координатах прямоугольника фигуры
// (x, y, w, h). Здесь те же точки выражены долями 0..1: для
// прямоугольника, выровненного по осям, это то же самое, а SVG
// objectBoundingBox масштабирует их на любую фигуру.

import { MECHANICS } from '../mechanics.generated.js';

/** @type {number} v/cmw/i — a = 1: сплошная заливка. */
export const FILL_SOLID = MECHANICS.fillTypeSolid;
/** @type {number} v/cmw/i — b = 2: градиент. */
export const FILL_GRADIENT = MECHANICS.fillTypeGradient;
/** cyclic=true в конструкторе GradientPaint — в SVG это spreadMethod. */
export const GRADIENT_SPREAD = MECHANICS.gradientCyclic ? 'reflect' : 'pad';

/**
 * 16 направлений из v/cmw/aw#a(I…). `style` — то, что лежит в записи как
 * @gradientStyle; 0 (значение по умолчанию) не рисует градиент вовсе.
 */
export const GRADIENT_STYLES = [
  { style: 1, x1: 0.5, y1: 1, x2: 0.5, y2: 0, label: 'снизу вверх' },
  { style: 2, x1: 0.5, y1: 0, x2: 0.5, y2: 1, label: 'сверху вниз' },
  { style: 3, x1: 0.5, y1: 0.5, x2: 0.5, y2: 0, label: 'из центра вверх' },
  { style: 4, x1: 0.5, y1: 0, x2: 0.5, y2: 0.5, label: 'сверху в центр' },
  { style: 5, x1: 1, y1: 0.5, x2: 0, y2: 0.5, label: 'справа налево' },
  { style: 6, x1: 0, y1: 0.5, x2: 1, y2: 0.5, label: 'слева направо' },
  { style: 7, x1: 0.5, y1: 0.5, x2: 0, y2: 0.5, label: 'из центра влево' },
  { style: 8, x1: 0, y1: 0.5, x2: 0.5, y2: 0.5, label: 'слева в центр' },
  { style: 9, x1: 1, y1: 1, x2: 0, y2: 0, label: 'из правого нижнего в левый верхний' },
  { style: 10, x1: 0, y1: 0, x2: 1, y2: 1, label: 'из левого верхнего в правый нижний' },
  { style: 11, x1: 0.5, y1: 0.5, x2: 0, y2: 0, label: 'из центра в левый верхний' },
  { style: 12, x1: 0, y1: 0, x2: 0.5, y2: 0.5, label: 'из левого верхнего в центр' },
  { style: 13, x1: 0, y1: 1, x2: 1, y2: 0, label: 'из левого нижнего в правый верхний' },
  { style: 14, x1: 1, y1: 0, x2: 0, y2: 1, label: 'из правого верхнего в левый нижний' },
  { style: 15, x1: 0.5, y1: 0.5, x2: 0, y2: 1, label: 'из центра в левый нижний' },
  { style: 16, x1: 0, y1: 1, x2: 0.5, y2: 0.5, label: 'из левого нижнего в центр' },
];

/** Направление по номеру; неизвестный номер даёт первое (снизу вверх). */
export function gradientStyle(style) {
  return GRADIENT_STYLES.find((g) => g.style === style) ?? GRADIENT_STYLES[0];
}

/**
 * Заливка фигуры в одной форме. В модели `fill` — либо строка цвета
 * (сплошная, так его пишут образцы и старые файлы), либо объект
 * { type, color1, color2, style } — ровно те четыре поля, что несёт
 * запись заливки (_fillColor: @type, @color1, @color2,
 * @gradientStyle).
 */
export function fillOf(shape) {
  const raw = shape?.fill;
  if (raw && typeof raw === 'object') {
    const type = raw.type === FILL_GRADIENT ? FILL_GRADIENT : FILL_SOLID;
    return {
      type,
      color1: raw.color1 || null,
      color2: raw.color2 || null,
      style: Number(raw.style) || 0,
    };
  }
  return { type: FILL_SOLID, color1: raw || null, color2: null, style: 0 };
}

/** Градиент рисуется только когда он включён и есть оба цвета. */
export function paintsGradient(f) {
  return f.type === FILL_GRADIENT && !!f.color1 && !!f.color2 && f.style >= 1;
}

/* ---------------------------------------------- подпись на заливке */

/**
 * Относительная яркость цвета в записи (WCAG 2.1, sRGB → linear → Y).
 * Понимает #rgb и #rrggbb: палитра инспектора и `<input type=color>` дают
 * только их. Непонятный цвет — null, и тогда решение принимает тема.
 */
export function colorLuminance(color) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/* ------------------------------------------- заливка в тёмной теме */

// sRGB ↔ OKLab (CSS Color 4 §8–9). Нужны ровно для одного: перевести цвет
// заливки в полосу светлоты тёмного листа, сохранив оттенок.
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => Math.max(0, Math.min(255, Math.round(linearToSrgb(c) * 255))));
}

/**
 * Цвет заливки таким, каким он должен быть НА ЭКРАНЕ в тёмной теме.
 *
 * ЗАЧЕМ. Палитра заливок — пастель листа (#ffffe0, #e8f4ff…), и в
 * тёмной теме она превращается в светящиеся пятна: #ffffe0 на листе #1f1d1e
 * даёт 1.05:1 к листу, то есть не подложку, а прожектор, а светлая подпись
 * на ней не читается вовсе. Поэтому заливка переводится в ту же тёмную полосу
 * светлоты, в которой живёт лист, С СОХРАНЕНИЕМ ОТТЕНКА: «жёлтый» остаётся
 * узнаваемо жёлтым, но тёмным; «голубой» — голубым. Насыщенность сверху
 * ограничена, иначе насыщенный цвет-логотип стал бы неоновой полосой.
 *
 * ЧЕГО ЭТО НЕ КАСАЕТСЯ. Экспорта: paint в файле остаётся тем, что человек
 * выбрал (`fill` в модели), и SVG/PNG уходят с исходной пастелью — то же
 * правило, что и у листа («адаптировать всё, кроме экспорта»).
 *
 * Светлота: L' = 0.16 + 0.14·L — от почти чёрного к тёмно-серому. Верхняя
 * граница 0.30 выбрана так, чтобы светлые чернила листа (#ecebe9, L 0.93)
 * давали на самой светлой заливке ≥ 7:1 и подпись не приходилось
 * перекрашивать.
 */
export function themeFill(color, dark) {
  if (!dark || !color) return color;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [L, a, b] = rgbToOklab(rgb);
  const light = Math.max(0, Math.min(1, 0.16 + 0.14 * L));
  const chroma = Math.hypot(a, b);
  const k = chroma > 0.13 ? 0.13 / chroma : 1;
  const out = oklabToRgb([light, a * k, b * k]);
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Цвет ЛИНИИ таким, каким он должен быть на экране в тёмной теме.
 *
 * Правило другое, чем у заливки, и намеренно. Заливка — большая площадь, её
 * надо приглушить; линия — тонкий штрих, ей нужен контраст с листом. Поэтому
 * линия не уводится в темноту, а поднимается в светлую полосу: «чёрная»
 * стрелка в тёмной теме становится светлой (иначе её просто нет), красная —
 * ярко-красной. Оттенок сохраняется, насыщенность ограничена.
 *
 * Порог: L' = 0.62 + 0.16·L. Между 0.62 и 0.78 линия даёт на листе (#1f1d1e,
 * Y 0.011) контраст 5.9–9.6 — с запасом над 3:1 для нетекстовых элементов.
 */
export function themeEdge(color, dark) {
  if (!dark || !color) return color;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [L, a, b] = rgbToOklab(rgb);
  const light = Math.max(0, Math.min(1, 0.62 + 0.16 * L));
  const chroma = Math.hypot(a, b);
  const k = chroma > 0.14 ? 0.14 / chroma : 1;
  const out = oklabToRgb([light, a * k, b * k]);
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Светлая ли заливка фигуры — чтобы знать, какими чернилами писать на ней.
 *
 * ЗАЧЕМ. В светлой теме лист белый и `--sheet-ink` чёрный: любая палитровая
 * пастель подпись не портит. В тёмной теме лист тёмный и подпись светлая —
 * а фигура с ЯВНОЙ заливкой осталась пастельной, и светлые буквы на #ffffe0
 * дают 1.1:1. Поэтому renderShape помечает такую фигуру классом `on-light`,
 * и styles.css возвращает ей листовые чернила светлой темы. Экспорт не
 * затрагивается: в файле всегда чёрное на белом, это его собственное правило.
 *
 * Порог 0.35 лежит между листом тёмной темы (#1b1b1e, Y = 0.011) и самой
 * тёмной палитровой пастелью (#e8f4ff, Y = 0.88): с обеих сторон запас.
 */
export function fillIsLight(shape) {
  const f = fillOf(shape);
  const ys = [f.color1, f.color2]
    .filter(Boolean)
    .map(colorLuminance)
    .filter((y) => y !== null);
  if (!ys.length) return false;
  return ys.reduce((a, b) => a + b, 0) / ys.length > LIGHT_FILL_Y;
}

/** Тот же порог, но для одного цвета: нужен, когда заливка уже приведена к теме. */
export const isLightColor = (color) => (colorLuminance(color) ?? 0) > LIGHT_FILL_Y;

/** Порог «подложка светлая»: между листом тёмной темы (0.011) и самой тёмной
 * палитровой пастелью (0.88), с запасом в обе стороны. */
const LIGHT_FILL_Y = 0.35;

// Лист механики говорит «16 направлений» — таблица ниже обязана иметь
// ровно столько. Расхождение означает, что код и лист разошлись, и это
// ошибка загрузки, а не тихий пропуск (как и у правил в src/rules/).
if (GRADIENT_STYLES.length !== MECHANICS.gradientDirections) {
  throw new Error(
    `fill: ${GRADIENT_STYLES.length} направлений в таблице, `
    + `а лист механики говорит ${MECHANICS.gradientDirections}`,
  );
}
