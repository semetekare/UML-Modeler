// «Чернила» на снимке экрана: доля пикселей, отличных от фона.
//
// Нужен для проверки «снимок содержит интерфейс» (tests/smoke.mjs): пустой
// белый PNG весит 12 КБ и раньше проходил по размеру. Считаем не размер, а
// площадь с содержимым.
//
// Фон — самый частый цвет кадра, а не белый: лист приложения светло-кремовый
// (#fff3ee), и порог «темнее 250» счёл бы фон чернилами. Тот же алгоритм
// реализован в Build/uml-modeler (png_ink_ratio), чтобы свой снимок и снимок
// через CDP сравнивались одной меркой.
//
// Только встроенные модули Node: без зависимостей и без установки пакетов.

import { inflateSync } from 'node:zlib';

export const INK_TOLERANCE = 12;   // отличие канала от фона, считающееся чернилами
export const INK_MIN = 0.03;       // порог приёмки: ≥ 3 % площади
const STEP = 2;                    // фиксированная сетка 2×2 — детерминированно

/** Разобрать PNG (8-бит, RGB/RGBA) в массив строк пикселей. */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG');
  let pos = 8;
  let width = 0; let height = 0; let depth = 0; let colorType = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const chunk = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      depth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') break;
  }
  if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`PNG ${depth} бит, тип ${colorType}: не разбираем`);
  }
  const bpp = colorType === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows = [];
  let prev = Buffer.alloc(stride);
  let off = 0;
  for (let y = 0; y < height; y++) {
    const filt = raw[off];
    off += 1;
    const line = Buffer.from(raw.subarray(off, off + stride));
    off += stride;
    if (filt === 1) {
      for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
    } else if (filt === 2) {
      for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 0xff;
    } else if (filt === 3) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
    } else if (filt === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        line[i] = (line[i] + pr) & 0xff;
      }
    }
    rows.push(line);
    prev = line;
  }
  return { width, height, bpp, rows };
}

/** Доля площади с чернилами (0…1) и самый частый цвет фона. */
export function inkRatio(buf) {
  const { width, height, bpp, rows } = decodePng(buf);
  const counts = new Map();
  for (let y = 0; y < height; y += STEP) {
    const line = rows[y];
    for (let x = 0; x < width; x += STEP) {
      const i = x * bpp;
      const key = (line[i] << 16) | (line[i + 1] << 8) | line[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bgKey = 0;
  let best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bgKey = k; }
  const bg = [(bgKey >> 16) & 0xff, (bgKey >> 8) & 0xff, bgKey & 0xff];
  let ink = 0;
  let total = 0;
  for (let y = 0; y < height; y += STEP) {
    const line = rows[y];
    for (let x = 0; x < width; x += STEP) {
      const i = x * bpp;
      if (bpp === 4 && line[i + 3] === 0) continue;
      total += 1;
      if (Math.abs(line[i] - bg[0]) > INK_TOLERANCE
        || Math.abs(line[i + 1] - bg[1]) > INK_TOLERANCE
        || Math.abs(line[i + 2] - bg[2]) > INK_TOLERANCE) ink += 1;
    }
  }
  return { ratio: total ? ink / total : 0, bg, width, height };
}
