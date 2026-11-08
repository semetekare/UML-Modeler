// Контраст палитры: светлая и тёмная темы, все шесть акцентов.
//
// ЗАЧЕМ. Тёмная тема — не «инвертировать светлую»: акцент, границы полей и
// производные поверхности считаются, а не подбираются на глаз. Этот скрипт
// повторяет ровно те формулы, которыми браузер считает `color-mix(in oklab, …)`
// и WCAG 2.1, и печатает таблицу «токен × поверхность → контраст».
//
//   node tools/contrast.mjs            таблица по всем темам и пресетам
//   node tools/contrast.mjs --dark     только тёмная
//   node tools/contrast.mjs --brand=teal
//
// Порог: текст ≥ 4.5:1, граница контрола ≥ 3:1 (WCAG 1.4.11). Скрипт не
// правит CSS: он только измеряет и возвращает код 1, если порог нарушен.

const PRESETS = {
  flame: '#fa5d00',
  moss: '#4f6b21',
  teal: '#0e7490',
  violet: '#6b3fd4',
  plum: '#9a1f6e',
  graphite: '#3f3f42',
};

/* ------------------------------------------------------------- sRGB ↔ oklab */
// CSS Color 4, §9 (oklab) и §8 (linear sRGB).

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

function rgbToOklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map((c) => srgbToLinear(c / 255));
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

/** color-mix(in oklab, a p%, b) — доля в процентах у первого цвета. */
export function mixOklab(a, p, b) {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  const t = p / 100;
  return oklabToRgb([0, 1, 2].map((i) => A[i] * t + B[i] * (1 - t)));
}

export const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/* ------------------------------------------------------------------ контраст */

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map((c) => srgbToLinear(c / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrast(a, b) {
  const la = luminance(Array.isArray(a) ? a : hexToRgb(a));
  const lb = luminance(Array.isArray(b) ? b : hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* -------------------------------------------------------------------- темы */
// Ровно то, что написано в src/brand/brand.css. Держать в согласии — иначе
// таблица врёт, а «замер» превращается в пожелание.

const LIGHT = {
  paper: '#ffffff',
  sunken: (k) => toHex(mixOklab(k, 5, '#ffffff')),
  panel: (k) => toHex(mixOklab(k, 10, '#ffffff')),
  desk: (k) => toHex(mixOklab(k, 8, '#ffffff')),
  ink: '#1d1e1c',
  inkSoft: '#5c5a57',
  inkFaint: '#6b6864',
  border: '#84817c',
  borderHover: '#777571',
  accent: (k) => toHex(mixOklab(k, 80, '#000000')),
  strong: (k) => toHex(mixOklab(k, 70, '#000000')),
  onStrong: '#ffffff',
  err: '#b3261e',
  warn: '#8a5a00',
};

const ON_DARK = {
  flame: '#ff8f4d',
  moss: '#a9c078',
  teal: '#4fc3e0',
  violet: '#b09af0',
  plum: '#d98cb8',
  graphite: '#adadb2',
};

const DARK = {
  paper: (k) => toHex(mixOklab(k, 5, '#212124')),
  sunken: (k) => toHex(mixOklab(k, 3, '#121215')),
  panel: (k) => toHex(mixOklab(k, 5, '#18181b')),
  desk: (k) => toHex(mixOklab(k, 3, '#0e0e10')),
  ink: '#ebe9e6',
  inkSoft: '#b3b0ab',
  inkFaint: '#96938e',
  border: '#767370',
  borderHover: '#918e89',
  accent: (k, name) => ON_DARK[name],
  strong: (k, name) => ON_DARK[name],
  onStrong: '#151515',
  err: '#ff8f86',
  warn: '#e8b056',
};

/* ------------------------------------------------------------------- прогон */

const args = process.argv.slice(2);
const onlyDark = args.includes('--dark');
const onlyLight = args.includes('--light');
const brandArg = args.find((a) => a.startsWith('--brand='))?.split('=')[1];

const brands = brandArg ? { [brandArg]: PRESETS[brandArg] } : PRESETS;
let failures = 0;

function row(label, fg, bg, need) {
  const c = contrast(fg, bg);
  const ok = c >= need;
  if (!ok) failures += 1;
  return `${label.padEnd(22)} ${String(c.toFixed(2)).padStart(6)}  ${ok ? 'ok' : 'FAIL'}${need === 4.5 ? '' : ` (≥${need})`}`;
}

for (const [name, brand] of Object.entries(brands)) {
  const themes = onlyDark ? [['dark', DARK]] : onlyLight ? [['light', LIGHT]] : [['light', LIGHT], ['dark', DARK]];
  for (const [themeName, T] of themes) {
    const surf = {
      paper: typeof T.paper === 'function' ? T.paper(brand) : T.paper,
      panel: T.panel(brand),
      desk: T.desk(brand),
      sunken: T.sunken(brand),
    };
    const accent = T.accent(brand, name);
    const strong = T.strong(brand, name);
    console.log(`\n${name} · ${themeName}   brand ${brand}  accent ${accent}  strong ${strong}`);
    console.log(`  surfaces: ${Object.entries(surf).map(([k, v]) => `${k} ${v}`).join('  ')}`);
    for (const [sk, sv] of Object.entries(surf)) {
      console.log(row(`ink / ${sk}`, T.ink, sv, 4.5));
      console.log(row(`ink-soft / ${sk}`, T.inkSoft, sv, 4.5));
      console.log(row(`ink-faint / ${sk}`, T.inkFaint, sv, 4.5));
      console.log(row(`accent / ${sk}`, accent, sv, 4.5));
      console.log(row(`border / ${sk}`, T.border, sv, 3));
      console.log(row(`border-hover / ${sk}`, T.borderHover, sv, 3));
    }
    console.log(row(`on-strong / strong`, T.onStrong, strong, 4.5));
    console.log(row(`err / panel`, T.err, surf.panel, 4.5));
    console.log(row(`err / paper`, T.err, surf.paper, 4.5));
    console.log(row(`warn / panel`, T.warn, surf.panel, 4.5));
    console.log(row(`warn / paper`, T.warn, surf.paper, 4.5));
  }
}

console.log(failures ? `\nнарушений порога: ${failures}` : '\nвсе пороги выполнены');
process.exitCode = failures ? 1 : 0;