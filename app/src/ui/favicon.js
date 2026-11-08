// Иконка вкладки: официальный знак продукта, собранный из текущих цветов.
//
// ЗАЧЕМ ДИНАМИЧЕСКАЯ. Favicon — отдельный документ: он не наследует ни тему,
// ни акцент страницы, а `var(--brand)` внутри него не разрешается. Поэтому
// вместо матрицы «6 акцентов × 2 темы» собираем data-URI из вычисленных цветов
// прямо в странице и пересобираем, когда меняется data-brand или data-race.
// Файл src/brand/icons/favicon.svg остаётся запасным: он нужен, если скрипты
// выключены, и для вкладок, открытых до первой перерисовки.
//
// ТОЛЬКО ВСТРОЕННЫЕ СРЕДСТВА. Ни одного запроса: картинка — data:image/svg+xml,
// а цвета читаются через getComputedStyle и переводятся в rgb канвасом 1×1
// (color-mix и oklab в строке не годятся для SVG-атрибута).

const LOGO = (plane, sheet, ink) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
  + `<path d="M130 92 L334 92 C343.941 92 352 100.059 352 110 L352 354 C352 363.941 343.941 372 334 372 L130 372 C120.059 372 112 363.941 112 354 L112 110 C112 100.059 120.059 92 130 92 Z" fill="${plane}"/>`
  + `<path d="M178 140 L382 140 C391.941 140 400 148.059 400 158 L400 402 C400 411.941 391.941 420 382 420 L178 420 C168.059 420 160 411.941 160 402 L160 158 C160 148.059 168.059 140 178 140 Z" fill="${sheet}" stroke="${ink}" stroke-width="12" stroke-miterlimit="10"/>`
  + `<line x1="166" y1="210" x2="394" y2="210" stroke="${ink}" stroke-width="8" stroke-miterlimit="10"/>`
  + `<line x1="166" y1="290" x2="394" y2="290" stroke="${ink}" stroke-width="8" stroke-miterlimit="10"/>`
  + '</svg>';

let canvas = null;

/** Любой CSS-цвет → rgb(...) через канвас: color-mix иначе не разобрать. */
function rgb(css) {
  const value = String(css || '').trim();
  if (!value) return '#000000';
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return value;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#010203';
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Пересобрать иконку из текущих токенов страницы. */
export function updateFavicon() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const plane = rgb(cs.getPropertyValue('--brand'));
    const sheet = rgb(cs.getPropertyValue('--surface-paper'));
    const ink = rgb(cs.getPropertyValue('--ink'));
    const uri = `data:image/svg+xml,${encodeURIComponent(LOGO(plane, sheet, ink))}`;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.append(link);
    }
    link.type = 'image/svg+xml';
    link.href = uri;
  } catch {
    /* хранилище и канвас могут быть недоступны — остаётся запасной файл */
  }
}

/**
 * Следить за темой и акцентом. Наблюдатель за атрибутами — одна точка для всех
 * входов: меню акцента, переключатель темы, другое окно, старт страницы.
 */
export function initFavicon() {
  updateFavicon();
  try {
    const mo = new MutationObserver(updateFavicon);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-brand', 'data-race'] });
  } catch {
    /* нет MutationObserver — иконка останется той, что поставили при старте */
  }
  return updateFavicon;
}