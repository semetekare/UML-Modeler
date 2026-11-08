// SVG rendering of the diagram — the sheet look, fixed
// light: white fill, 1px black lines, 11px Arial, hollow triangle heads.
//
// The renderer is data-driven: notation/uml.json names a `style` for every
// shape and the heads/dash for every connector. Adding a UML diagram type
// therefore means adding shapes to the package, not a second renderer.
//
// Sequence messages are the one case where the connector is not routed
// between two shape edges: a message is horizontal, its order is its vertical
// position (the reference sorts by y), and its number is derived from that order.

import { NOTATION, visByKey } from '../model/notation.js';
import {
  elementOf, memberText, relOf, navigableOf, aggregationOf, semanticEndOf,
  setOfRelationship, generalizationSetLabel, currentDiagram,
  messageOrder, isMessage, regionsOf, regionMembers, qualifiersOf, findElement,
} from '../model/model.js';
import {
  layoutOf, edgePoint, endPoint, linkPoints, pathD, polylinePath, labelPos, multiPos, LINE_H, PAD_X, PAD_Y, MEMBER_PAD,
  TAB_H, NOTE_FOLD, NOTE_PAD, NOTE_CAP_DELTA, DASH, textWidth, CAPTION_LINE,
  headMetrics, headSizeOf, HEAD_SIZE_DEFAULT,
  LIFELINE_HEAD, ACTOR_LIFELINE_HEAD, MESSAGE_GAP, VIS_ICON, VIS_UML, VIS_OFF,
  curveSamples, samplesPath,
} from '../model/geometry.js';
import { svgEl, clear } from '../util.js';
import { visIcon, icon } from './icons.js';
import { pictogramFor, baseTypeFor } from '../io/stereotypes.js';
import { MECHANICS } from '../mechanics.generated.js';
import {
  fillOf, isLightColor, paintsGradient, gradientStyle, themeEdge, themeFill, GRADIENT_SPREAD,
} from '../model/fill.js';
import { routeOfLink, roundedOfStyle } from '../model/connector-style.js';
import { parallelOffsets, parallelEnds } from '../model/parallel-links.js';
import {
  LINE_JUMPS, resolveJumps, jumpSize, polylineCrossings, jumpedPath,
} from '../model/line-jumps.js';


const ink = () => NOTATION.meta.ink;

/**
 * Пометка источника — не значение.
 *
 * Корпус пособия пишет в поля «не названо в тексте»: это след `source.gaps`,
 * а не кратность и не имя полюса. В файле такая строка честна и полезна —
 * она говорит, что текст пособия этого не называет, — но на листе она
 * встаёт подписью и перекрывает линии связей. Поэтому в начертание она не
 * идёт; в инспекторе поле остаётся как есть, и человек видит, чего нет в
 * источнике.
 */
const PLACEHOLDER = /не назван|не указан|не приведен|не перечисл/i;
const drawn = (v) => (typeof v === 'string' && PLACEHOLDER.test(v) ? '' : v);
const fill = () => NOTATION.meta.fill;
const lw = () => NOTATION.meta.lineWeight;

// Compartments that draw no visibility glyph (literals, slots, text lines).
const NOVIS = new Set(['literals', 'slots']);
// Конечные маркеры, которые начертание объявляет «хвостом» вида связи, хотя
// на самом деле это ромб модели: он приходит из `aggregationOf`, и второй
// такой же рисовать нельзя.
const DIAMOND_TAILS = new Set(['diamond', 'filledDiamond']);

/* ------------------------------------------------------------ the sheet */

/**
 * Build the whole sheet into `root` (a <g>).
 *
 * `opts.exporting` says the caller is building a file, not the screen: theme
 * adaptation of fills is switched off, so a dark window never changes what
 * the SVG/PNG contains.
 */
export function renderDiagram(root, diagram, model, profile = null, opts = {}) {
  clear(root);
  if (!diagram) return;
  const wasExporting = renderingExport;
  renderingExport = opts.exporting === true;
  // Градиентные определения живут в <defs> листа, а не в слое фигур:
  // полная перерисовка начинается с чистки прошлых.
  const svg = root.ownerSVGElement ?? null;
  if (svg) for (const old of [...svg.querySelectorAll('linearGradient[data-fill]')]) old.remove();

  const ctx = {
    diagram,
    model,
    profile,
    numbers: messageNumbers(diagram, model),
    // §3.2: порядок сообщений. `order` считает его по `seq` (если он есть
    // хотя бы у одного сообщения диаграммы) иначе по геометрии; `bySeq`
    // говорит, надо ли раскладывать сообщения без `y` по этому порядку.
    order: messageOrder(diagram, model),
    bySeq: (diagram.links ?? []).some((l) => isMessage(relOf(model, l))
      && Number.isFinite(Number(relOf(model, l)?.seq))),
    // Маршруты считаются один раз на перерисовку: по ним же ищутся
    // пересечения для скачков (§26), и повторный расчёт внутри renderLink
    // дал бы две геометрии для одной линии.
    routes: new Map(),
    jumps: new Map(),
  };
  markJumps(ctx);
  // Lifelines and lanes are the background of an interaction: their dashed
  // tails must run under the messages, not over them. A system boundary and a
  // swimlane are frames too — a filled frame drawn over the links would hide
  // every association that crosses it.
  for (const s of diagram.shapes) {
    const element = elementOf(model, s);
    const style = element && NOTATION.shapes[element.kind]?.style;
    if (style === 'lifeline' || style === 'actorLifeline' || style === 'timingLane'
      || style === 'swimlane' || style === 'boundary' || style === 'activity') {
      renderShape(root, s, element, ctx);
    }
  }
  // Регионы (§3.6, §3.7) — фон для своих узлов и передний план для чужих:
  // рамка региона обводит то, что в нём лежит, и не перекрывает ни линий,
  // ни фигур, поэтому рисуется между фоном и связями.
  renderRegions(root, ctx);
  // Внутренний переход, пришедший связью из чужого файла, остаётся в модели,
  // но на листе не рисуется: §14.2.4.9 — «явно на диаграммах не показываются».
  for (const l of diagram.links) {
    if (relOf(model, l)?.internal === true) continue;
    renderLink(root, ctx, l);
  }
  for (const s of diagram.shapes) {
    const element = elementOf(model, s);
    if (!element) continue;
    const style = NOTATION.shapes[element.kind]?.style;
    if (style === 'lifeline' || style === 'actorLifeline' || style === 'timingLane'
      || style === 'swimlane' || style === 'boundary' || style === 'activity') continue;
    renderShape(root, s, element, ctx);
  }
  renderingExport = wasExporting;
}

/**
 * Message numbers, for the diagrams that need them.
 *
 * A COMMUNICATION diagram has no vertical axis, so the order of messages can
 * only be written out — that is what the numbers are for, and they are derived
 * from the creation order of the link, never stored.
 *
 * A SEQUENCE diagram shows the order by vertical position, so numbering is
 * redundant. It is a presentation option that stays OFF: on all 19
 * sequence diagrams of the tutorial the original shows no numbers. The editor
 * numbered every message anyway, which is the first thing the comparison
 * against 4.3.7 reported. Numbers here are opt-in (`model.messageNumbers`),
 * and a model that never sets the flag looks like the original.
 */
function messageNumbers(diagram, model) {
  const map = new Map();
  // Нумеруются только связи КОММУНИКАЦИИ. Тот же `link` на диаграмме
  // развёртывания — это путь развёртывания, и номера там не значат ничего:
  // сверка 5.1.7 увидела «метки 1…7, которых нет в эталоне».
  if (diagram.kind === 'communication') {
    const numbered = (diagram.links ?? []).map((l, i) => ({ l, rel: relOf(model, l), i }))
      .filter(({ rel }) => rel && NOTATION.connectors[rel.kind]?.numbered);
    numbered.forEach(({ l, i }) => map.set(l.id, String(i + 1)));
    return map;
  }
  if (model?.messageNumbers !== true) return map;
  // Номер — это порядок (§3.2): `seq` главнее геометрии, когда он есть хоть
  // у одного сообщения диаграммы.
  const ordered = [...(messageOrder(diagram, model)?.entries() ?? [])]
    .sort((a, b) => a[1].index - b[1].index);
  ordered.forEach(([linkId, at]) => map.set(linkId, String(at.index + 1)));
  return map;
}

/**
 * Регион (§3.6, §3.7) — часть элемента, но рисуется рамкой на листе.
 *
 * Границы берутся из фигур, а не из модели: план прямо говорит, что
 * геометрия операнда и региона остаётся в фигуре. Регион без членов не
 * рисуется — пустая рамка ничего не значит.
 */
function renderRegions(root, ctx) {
  const { diagram, model } = ctx;
  for (const s of diagram.shapes) {
    const element = elementOf(model, s);
    for (const region of regionsOf(element)) {
      const members = regionMembers(region)
        .map((id) => diagram.shapes.find((x) => x.elementId === id))
        .filter(Boolean);
      if (!members.length) continue;
      const pad = 14;
      const x0 = Math.min(...members.map((m) => m.x)) - pad;
      const y0 = Math.min(...members.map((m) => m.y)) - pad;
      const x1 = Math.max(...members.map((m) => m.x + m.w)) + pad;
      const y1 = Math.max(...members.map((m) => m.y + m.h)) + pad;
      svgEl('rect', {
        x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 10, ry: 10,
        class: 'sh-body dash frame', 'data-region': region.id, 'data-owner': element.id,
      }, root);
      if (String(region.name ?? '').trim()) {
        svgEl('text', {
          x: x0 + 8, y: y0 + 11, class: 'sh-row', text: region.name, 'data-region-name': region.id,
        }, root);
      }
    }
  }
}

/* --------------------------------------------------------------- fill */
// v/cmw/aw#a(v.byf.cn;Ljava/awt/Rectangle;)Ljava/awt/Paint; @0x0000:
// type 2 → градиент из двух цветов, type 1 → один цвет. SVG не знает
// GradientPaint, поэтому то же самое выражается <linearGradient> в
// objectBoundingBox: те же доли прямоугольника, а cyclic=true (последний
// аргумент конструктора в оригинале) — это spreadMethod="reflect".
function gradientId(shape) {
  return `fillgrad-${String(shape.id).replace(/[^\w-]/g, '_')}`;
}

function svgDefs(node) {
  const svg = node.ownerSVGElement ?? node.closest?.('svg') ?? null;
  if (!svg) return null;
  return svg.querySelector('defs') ?? svgEl('defs', {}, svg);
}

/**
 * Тема — свойство ЭКРАНА, а не файла. Пока рисуется экспорт, заливки берутся
 * ровно те, что записаны в модели: SVG и PNG обязаны совпадать с листом
 * независимо от того, что человек включил в интерфейсе.
 */
let renderingExport = false;

const fillThemeDark = () => !renderingExport
  && typeof document !== 'undefined'
  && document.documentElement.dataset.race === 'dark';

function ensureGradient(node, shape, dark) {
  const f = fillOf(shape);
  if (!paintsGradient(f)) return null;
  const defs = svgDefs(node);
  if (!defs) return null;
  const id = gradientId(shape);
  const old = document.getElementById(id);
  if (old) old.remove();
  const dir = gradientStyle(f.style);
  const g = svgEl('linearGradient', {
    id,
    gradientUnits: 'objectBoundingBox',
    x1: dir.x1, y1: dir.y1, x2: dir.x2, y2: dir.y2,
    spreadMethod: GRADIENT_SPREAD,
    'data-fill': '1',
  }, defs);
  svgEl('stop', { offset: '0', 'stop-color': themeFill(f.color1, dark) }, g);
  svgEl('stop', { offset: '1', 'stop-color': themeFill(f.color2, dark) }, g);
  return id;
}

/**
 * Залить узел так, как это делает оригинал: цвет или градиент.
 *
 * В тёмной теме цвет перед покраской приводится к полосе светлоты листа
 * (fill.js#themeFill): пастель листа иначе светит из темноты, а
 * подпись на ней не читается. Формула одна для сплошной и для обоих стопов
 * градиента, поэтому градиент не распадается на «светлую половину».
 */
function applyFill(node, shape) {
  const f = fillOf(shape);
  const dark = fillThemeDark();
  if (paintsGradient(f)) {
    const id = ensureGradient(node, shape, dark);
    if (id) {
      node.style.fill = `url(#${id})`;
      return;
    }
  }
  const painted = themeFill(f.color1, dark);
  if (painted) node.style.fill = painted;
}

/** Каким цветом заливка реально нарисована сейчас (для выбора чернил). */
function paintedFillColor(shape) {
  const f = fillOf(shape);
  if (!f.color1) return null;
  return themeFill(f.color1, fillThemeDark());
}

/* ------------------------------------------------------------- shapes */

/**
 * Подложка под рисунком: невидимый прямоугольник во всю рамку фигуры.
 *
 * ЗАЧЕМ. Актёр нарисован четырьмя линиями и кругом, линия жизни — головой и
 * пунктиром: заливки у них нет, и попадание мышью считалось только по
 * нарисованному. Замер аудита (сетка 40×40 по рамке): актёр — 9,1 % рамки,
 * линия жизни — 12,5 %, ромб решения — 52,5 %, начальное состояние — 84,8 %.
 * Клик по телу, рукам или ногам актёра не выделял фигуру, а актёров в
 * упражнениях десятки. Подложка делает кликабельной всю рамку.
 *
 * ПОЧЕМУ ТАК. `fill="transparent"` — это краска: элемент остаётся невидимым,
 * но попадание в него считается (fill="none" не считается). `data-hit` уже
 * снимает такие узлы с экспорта SVG — тот же признак, что у пути захвата
 * связи, второй механизм не нужен. Кладётся ПЕРВЫМ ребёнком группы, под
 * рисунком, чтобы не закрывать собственные линии и подписи фигуры.
 *
 * Контейнерам (boundary, package, component, swimlane) подложка не нужна и
 * вредна: она перекрыла бы детей, которые лежат в той же группе.
 */
function hitRect(g, x, y, w, h) {
  return svgEl('rect', {
    x, y, width: w, height: h, class: 'sh-hit', 'data-hit': '1', fill: 'transparent',
  }, g);
}

function renderShape(root, shape, element, ctx) {
  const def = NOTATION.shapes[element.kind];
  if (!def) return;
  const g = svgEl('g', { 'data-kind': 'shape', 'data-id': shape.id, class: 'sh' }, root);
  const layout = layoutOf(shape, element);
  const fn = RENDERERS[def.style] ?? renderClassifier;
  fn(g, shape, element, layout, def, ctx);
  // Если заливка осталась светлой (нестандартная запись цвета, которую не
  // разобрал themeFill), подпись на ней берёт тёмные чернила: класс не несёт
  // цвета сам, правило живёт в styles.css и включено только в тёмной теме.
  // В экспорт класс попадает, но там такого правила нет — файл остаётся
  // чёрным на белом (fill.js#themeFill объясняет, почему это нормально).
  if (!renderingExport && isLightColor(paintedFillColor(shape))) g.classList.add('on-light');
  // Every stereotype drawing is a mark in the corner, figures included. The
  // shape keeps its own body, so a «sea level usecase» is still an ellipse
  // with a wave in its corner — not a wave instead of the ellipse.
  renderBadge(g, shape, element, def.style === 'ellipse' ? { ...ctx, shapeStyle: 'ellipse' } : ctx, layout.w);
  return g;
}

const RENDERERS = {
  classifier: renderClassifier,
  package: renderPackage,
  note: renderNote,
  text: renderText,
  ellipse: renderEllipse,
  actor: renderActor,
  node: renderNode,
  component: renderComponent,
  artifact: renderArtifact,
  part: renderPart,
  port: renderPort,
  state: renderState,
  initial: renderInitial,
  final: renderFinal,
  diamond: renderDiamond,
  junction: renderJunction,
  history: renderHistory,
  point: renderPoint,
  terminate: renderTerminate,
  action: renderAction,
  activity: renderActivity,
  objectnode: renderObjectNode,
  bar: renderBar,
  swimlane: renderSwimlane,
  lifeline: renderLifeline,
  actorLifeline: renderActorLifeline,
  activation: renderActivation,
  frame: renderFrame,
  boundary: renderBoundary,
  timingLane: renderTimingLane,
};

/* ------------------------------------------------ stereotype drawings */

/**
 * The drawing as a <g> with a scale transform, fitted into the box it is
 * given and centred there.
 *
 * A nested <svg> with width/height/viewBox would be the obvious way, and it
 * is not what this does: measured in Chromium, a nested 150×80 svg with a
 * 148×47 viewBox came out 134×21 — neither the box nor the aspect. The
 * transform below has no such ambiguity, and the paths are the same nodes
 * `icon()` already inlines, so colour still comes from currentColor.
 */
function pictogramNode(pict, k) {
  const src = icon(pict.asset, 16);
  const g = svgEl('g', { class: 'sh-pict', transform: `scale(${round(k)})` });
  for (const child of [...src.children]) g.append(child.cloneNode(true));
  return g;
}

/**
 * Put a drawing in a shape's top-right corner, its ink flush with the frame.
 *
 * The files are drawn on a grid with a margin of their own (1.25 px of stroke
 * on a 16 grid, 1.5 on the figures), so scaling the file and aligning its box
 * leaves the ink a few pixels short of the corner — on a 120 px shape that is
 * a visible gap. The ink bounds are measured with getBBox once the node is in
 * the document and the transform is corrected by the difference, which works
 * for all fifteen drawings without touching them.
 */
function placePictogram(g, node, rightEdge, topEdge) {
  g.append(node);
  const k = Number((node.getAttribute('transform') || '').match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
  const bb = inkBox(node, k);
  if (!bb) return;
  const tx = rightEdge - (bb.x + bb.width) * k;
  const ty = topEdge - bb.y * k;
  node.setAttribute('transform', `translate(${round(tx)} ${round(ty)}) scale(${round(k)})`);
}

/** Блокнот для измерения иконок вне документа: создаётся один раз. */
let inkRuler = null;

/**
 * Границы чернил группы, в её собственных единицах (до собственного scale).
 *
 * `getBBox()` работает только в документе: на detached-узле — а экспорт
 * рисует именно в detached `<svg>` — он отдаёт нули, и тогда трансформация
 * теряла `translate`, все рисунки уезжали в точку (0,0) и пропадали с листа.
 * Здесь узел на мгновение кладётся в скрытый SVG в документе, измеряется и
 * возвращается обратно; результат кэшируется по содержимому пути.
 */
function inkBox(node, k) {
  try {
    const own = node.getBBox();
    if (own && own.width && own.height) return own;
  } catch { /* узел ещё не в документе — меряем ниже */ }

  if (typeof document === 'undefined') return null;
  if (!inkRuler) {
    inkRuler = svgEl('svg', { width: '0', height: '0', 'aria-hidden': 'true',
      style: 'position:absolute;left:-9999px;top:-9999px;overflow:hidden' });
    document.body.append(inkRuler);
  }
  const probe = svgEl('g', {});
  for (const child of [...node.children]) probe.append(child.cloneNode(true));
  inkRuler.append(probe);
  let box = null;
  try {
    const b = probe.getBBox();
    if (b && b.width && b.height) box = { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch { /* пустая иконка */ }
  probe.remove();
  return box;
}

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * The stereotype drawing, in the top-right corner of the shape.
 *
 * Both kinds go here. `badge` is a 16×16 glyph (`«entity»`, `«control»`,
 * `«boundary»` — robustness icons) and is drawn at its own
 * size. `figure` — the fish, the waves, the big ellipse — keeps its own
 * proportions and is fitted into a corner box instead: the drawing marks the
 * shape, it does not become the shape.
 *
 * The mark sits inside the frame and is capped against the shape's own size,
 * so a small shape gets a small mark and a neighbour is never covered.
 */
const FIG_BOX_W = 72;
const FIG_BOX_H = 32;
const MARK_INSET = 4;

function renderBadge(g, shape, element, ctx, w) {
  // Рисунок принадлежит расширению, а не имени: baseType берётся у вида
  // элемента, иначе вариант использования получил бы овал, объявленный для
  // класса. Id — уточнение, имя — то, что есть в старых файлах; обе дороги
  // ведут к одной записи (`pictogramFor`).
  const pict = pictogramFor(
    ctx?.profile,
    element?.stereotypeId || element?.stereotype,
    baseTypeFor(element?.kind),
  );
  if (!pict || ctx?.model?.pictograms === false) return;
  const width = w ?? layoutOf(shape, element).w;
  const [pw, ph] = pict.size;
  let bw;
  let bh;
  let k;
  if (pict.kind === 'figure') {
    const boxW = Math.min(width * 0.55, FIG_BOX_W);
    const boxH = Math.min(layoutOf(shape, element).h * 0.55, FIG_BOX_H);
    k = Math.min(boxW / pw, boxH / ph);
    bw = Math.max(12, pw * k);
    bh = Math.max(8, ph * k);
  } else {
    bw = pw || 16;
    bh = ph || 16;
    k = 1;
  }
  const node = pictogramNode(pict, k);
  if (!node) return;
  node.setAttribute('class', `sh-pict ${pict.kind === 'figure' ? 'sh-figure' : 'sh-badge'}`);
  // An ellipse has no corner: the bounding box's top-right point lies outside
  // the oval, so a mark anchored there floats past the outline (the visual
  // comparison against 3.1.2 reported exactly that). Inside an oval the mark
  // is anchored on the ellipse instead — at 45°, pulled in far enough that its
  // far corner still lands inside.
  if (ctx?.shapeStyle === 'ellipse') {
    placeInEllipse(g, node, shape, width, element, bw, bh, k);
    return;
  }
  placePictogram(g, node, shape.x + width - MARK_INSET, shape.y + MARK_INSET);
}

/**
 * The mark inside an oval: its top-right corner lands on the ellipse at 45°,
 * then the whole box is pulled in until the opposite corner is inside too.
 * Returns without drawing when the oval is too small to hold the mark — an
 * invisible mark is better than one drawn across the outline.
 */
function placeInEllipse(g, node, shape, width, element, bw, bh, k) {
  const rx = width / 2;
  const ry = layoutOf(shape, element).h / 2;
  const cx = shape.x + rx;
  const cy = shape.y + ry;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  // Не 45°: у овала угол рамки почти пуст, а подпись и стереотип стоят по
  // центру. Знак уходит в правый верхний край — туда, где у овала ещё есть
  // место, но не поверх строк имени.
  let ax = cx + rx * 0.92;
  let ay = cy - ry * 0.55;
  for (let step = 0; step < 14; step++) {
    if (inside(ax, ay) && inside(ax - bw, ay + bh)) break;
    ax = cx + (ax - cx) * 0.92;
    ay = cy + (ay - cy) * 0.92;
  }
  if (!inside(ax, ay)) return;
  node.setAttribute('transform', `translate(${round(ax - bw)} ${round(ay)}) scale(${round(k)})`);
  g.append(node);
}

/* -------------------------------------------------------- classifiers */

/**
 * The class list of a classifier's name. UML 2.5.1 §9.2.4: the name of an
 * abstract classifier is shown in italics (and `{abstract}` may be added, but
 * the standard puts italics first). Every shape that draws a classifier name
 * goes through here, so «abstract» cannot work on a class and silently do
 * nothing on an actor.
 */
const nameClass = (element, extra = '') =>
  `sh-name${extra}${element?.underline ? ' underline' : ''}${element?.abstract ? ' italic' : ''}`;

function renderClassifier(g, shape, element, layout, def, ctx) {
  const { w, h, boxes } = layout;
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body', rx: 0,
  }, g);
  applyFill(body, shape);

  let y = shape.y;
  for (const box of boxes) {
    if (box.id === 'name') {
      // The plate is box.h = lines × 14 (§30): each line is centred in its own
      // 14 px band, so a stereotype line sits at y+7 and the name at y+21.
      let lineY = y + CAPTION_LINE / 2;
      if (element.stereotype) {
        svgEl('text', {
          x: shape.x + w / 2, y: lineY, class: 'sh-stereo', text: `«${element.stereotype}»`,
        }, g);
        lineY += CAPTION_LINE;
      }
      if (String(element.name ?? '').trim() || !element.stereotype) {
        // UML 2.5.1 §9.2.4: the name of an abstract classifier is set in
        // italics. One class, not a second renderer.
        svgEl('text', {
          x: shape.x + w / 2, y: lineY,
          class: nameClass(element),
          text: element.name,
        }, g);
      }
    } else if (box.rows?.length || box.blank) {
      // Перегородка отделения — линия ФИГУРЫ, поэтому её цвет берётся из
      // --sheet-ink через класс, а не из ink(): иначе в тёмной теме она
      // остаётся чёрной и отделения исчезают. Толщина и цвет класса в
      // экспорте описаны тем же .sh-line (см. exportDiagramSvgString).
      svgEl('line', {
        x1: shape.x, y1: y, x2: shape.x + w, y2: y, class: 'sh-line',
      }, g);
      (box.rows ?? []).forEach((row, i) => {
        const ry = y + MEMBER_PAD + i * LINE_H + LINE_H / 2;
        if (!NOVIS.has(box.id) && box.mode !== 'lines') {
          renderVisibilityIcon(g, row.vis, shape.x + PAD_X + 4, ry, row);
        }
        const text = box.mode === 'lines' ? `${box.prefix}${row}` : memberText(row);
        // A static feature is underlined (UML 2.5.1 §9.4.4). An abstract
        // operation is set in italics — the same mark the standard names for
        // an abstract classifier (§9.2.4); §9.6.4 gives the operation string
        // and does not repeat the rule, so this is the convention, not a
        // quoted clause. The `/` and `{id}` marks come from memberText.
        svgEl('text', {
          x: shape.x + (box.mode === 'members' ? PAD_X + 14 : PAD_X),
          y: ry, class: `sh-row${row?.isStatic ? ' static' : ''}`, text,
          'font-style': row?.isAbstract ? 'italic' : undefined,
        }, g);
      });
    }
    y += box.h;
  }
}

function renderPackage(g, shape, element, layout) {
  const { w, h } = layout;
  const tabW = Math.max(40, Math.min(w, textWidth(element.name) + 18));
  svgEl('rect', { x: shape.x, y: shape.y, width: tabW, height: TAB_H, class: 'sh-tab' }, g);
  const body = svgEl('rect', {
    x: shape.x, y: shape.y + TAB_H, width: w, height: h - TAB_H, class: 'sh-body',
  }, g);
  applyFill(body, shape);
  const cx = shape.x + w / 2;
  let cy = shape.y + TAB_H + (h - TAB_H) / 2;
  if (element.stereotype) {
    svgEl('text', { x: cx, y: cy - LINE_H / 2, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    cy += LINE_H / 2;
  }
  svgEl('text', { x: cx, y: cy, class: 'sh-name', text: element.name }, g);
}

function renderNote(g, shape, element, layout) {
  const x = shape.x;
  const y = shape.y;
  const { w, h, boxes } = layout;
  // У примечания «ушко» — срезанный угол: внутри него рисунка нет, и клик по
  // углу раньше уходил мимо. Подложка закрывает всю рамку, включая срез.
  hitRect(g, x, y, w, h);
  // The record's caption is width − 15 wide: the cut corner plus a 3 px gap.
  const fold = Math.min(NOTE_FOLD, Math.max(0, w - NOTE_CAP_DELTA));
  svgEl('path', {
    class: 'sh-note',
    d: `M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + h} L ${x} ${y + h} Z`,
  }, g);
  svgEl('path', {
    class: 'sh-line',
    d: `M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold}`,
  }, g);
  (boxes[0]?.lines ?? []).forEach((line, i) => {
    svgEl('text', {
      x: x + NOTE_PAD, y: y + PAD_Y + 4 + i * LINE_H + LINE_H / 2, class: 'sh-note-text', text: line,
    }, g);
  });
}

function renderText(g, shape, element, layout) {
  (layout.boxes[0]?.lines ?? []).forEach((line, i) => {
    svgEl('text', {
      x: shape.x, y: shape.y + 4 + i * LINE_H + LINE_H / 2, class: 'sh-note-text', text: line,
    }, g);
  });
}

/* ----------------------------------------------------------- ellipses */

function renderEllipse(g, shape, element, layout, def) {
  const { w, h, boxes } = layout;
  const cx = shape.x + w / 2;
  const cy = shape.y + h / 2;
  const el = svgEl('ellipse', {
    cx, cy, rx: w / 2, ry: h / 2,
    class: `sh-body${def.dashed ? ' dash' : ''}`,
  }, g);
  applyFill(el, shape);
  const lines = [];
  for (const b of boxes) {
    if (b.mode === 'lines' && b.rows?.length) for (const r of b.rows) lines.push(`${b.prefix}${r}`);
  }
  let ty = cy - ((element.stereotype ? 1 : 0) + (lines.length ? 1 : 0)) * LINE_H / 2;
  if (element.stereotype) {
    svgEl('text', { x: cx, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    ty += LINE_H;
  }
  svgEl('text', { x: cx, y: ty, class: nameClass(element), text: element.name }, g);
  if (lines.length) {
    ty += LINE_H;
    for (const line of lines) {
      svgEl('text', { x: cx, y: ty, class: 'sh-row', text: line }, g);
      ty += LINE_H;
    }
  }
}

/* --------------------------------------------------------------- actor */

function renderActor(g, shape, element, layout) {
  const { w, h } = layout;
  hitRect(g, shape.x, shape.y, w, h);
  const cx = shape.x + w / 2;
  const top = shape.y + 2;
  const H = Math.max(30, h - 2 * LINE_H - 4);
  const headR = Math.min(8, H / 6);
  svgEl('circle', {
    cx, cy: top + headR, r: headR, class: 'sh-body',
  }, g);
  const bodyTop = top + headR * 2;
  const bodyBottom = top + H * 0.68;
  svgEl('line', { x1: cx, y1: bodyTop, x2: cx, y2: bodyBottom, class: 'sh-line' }, g);
  const armY = top + H * 0.36;
  const arm = Math.min(14, shape.w / 3);
  svgEl('line', { x1: cx - arm, y1: armY, x2: cx + arm, y2: armY, class: 'sh-line' }, g);
  svgEl('line', { x1: cx, y1: bodyBottom, x2: cx - arm, y2: top + H * 0.92, class: 'sh-line' }, g);
  svgEl('line', { x1: cx, y1: bodyBottom, x2: cx + arm, y2: top + H * 0.92, class: 'sh-line' }, g);
  renderNameBelow(g, shape, element, layout);
}

function renderNameBelow(g, shape, element, layout) {
  const box = layout.boxes.find((b) => b.id === 'name');
  const cx = shape.x + layout.w / 2;
  let ty = shape.y + (box?.y ?? layout.h - 2 * LINE_H) + LINE_H / 2;
  if (element.stereotype) {
    svgEl('text', { x: cx, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    ty += LINE_H;
  }
  svgEl('text', { x: cx, y: ty, class: nameClass(element), text: element.name }, g);
}

/* ---------------------------------------------------------------- node */

function renderNode(g, shape, element, layout) {
  const { w, h } = layout;
  const d = 8;
  const x = shape.x;
  const y = shape.y;
  svgEl('path', {
    class: 'sh-body',
    d: `M ${x} ${y + d} L ${x + d} ${y} L ${x + w} ${y} L ${x + w} ${y + h - d} L ${x + w - d} ${y + h} L ${x} ${y + h} Z`,
  }, g);
  svgEl('path', {
    class: 'sh-line',
    d: `M ${x} ${y + d} L ${x + w - d} ${y + d} L ${x + w - d} ${y + h} M ${x + w - d} ${y + d} L ${x + w} ${y}`,
  }, g);
  renderNameTop(g, shape, element, layout, x + w / 2, y + 6);
}

function renderNameTop(g, shape, element, layout, cx, top) {
  let ty = top + LINE_H / 2;
  if (element.stereotype) {
    svgEl('text', { x: cx, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    ty += LINE_H;
  }
  svgEl('text', { x: cx, y: ty, class: nameClass(element), text: element.name }, g);
}

/* ----------------------------------------------------------- component */

function renderComponent(g, shape, element, layout) {
  const { w, h, boxes } = layout;
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body',
  }, g);
  applyFill(body, shape);
  // The component icon: two small tabs on the right edge.
  const ix = shape.x + w - 16;
  svgEl('rect', { x: ix, y: shape.y + 8, width: 10, height: 6, class: 'sh-body' }, g);
  svgEl('rect', { x: ix - 4, y: shape.y + 12, width: 10, height: 6, class: 'sh-body' }, g);

  let y = shape.y;
  for (const box of boxes) {
    if (box.id === 'name') {
      let ty = y + CAPTION_LINE / 2;
      if (element.stereotype) {
        svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
        ty += CAPTION_LINE;
      }
      svgEl('text', { x: shape.x + w / 2, y: ty, class: nameClass(element), text: element.name }, g);
    } else if (box.rows?.length) {
      svgEl('line', { x1: shape.x, y1: y, x2: shape.x + w, y2: y, class: 'sh-line' }, g);
      box.rows.forEach((row, i) => {
        const ry = y + MEMBER_PAD + i * LINE_H + LINE_H / 2;
        renderVisibilityIcon(g, row.vis, shape.x + PAD_X + 4, ry, row);
        svgEl('text', {
          x: shape.x + PAD_X + 14, y: ry,
          class: `sh-row${row?.isStatic ? ' static' : ''}`, text: memberText(row),
          'font-style': row?.isAbstract ? 'italic' : undefined,
        }, g);
      });
    }
    y += box.h;
  }
}

function renderArtifact(g, shape, element, layout) {
  const { w, h } = layout;
  const body = svgEl('rect', { x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body' }, g);
  applyFill(body, shape);
  // The document icon in the top-right corner.
  const ix = shape.x + w - 22;
  const iy = shape.y + 8;
  svgEl('path', {
    class: 'sh-line',
    d: `M ${ix} ${iy} h 10 l 4 4 v 10 h -14 Z M ${ix + 10} ${iy} v 4 h 4`,
  }, g);
  let ty = shape.y + 14;
  if (element.stereotype) {
    svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    ty += LINE_H;
  }
  svgEl('text', { x: shape.x + w / 2, y: ty, class: nameClass(element), text: element.name }, g);
}

function renderPart(g, shape, element, layout) {
  const { w, h } = layout;
  const body = svgEl('rect', { x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body' }, g);
  applyFill(body, shape);
  const cx = shape.x + w / 2;
  const cy = shape.y + h / 2;
  if (element.stereotype) {
    svgEl('text', { x: cx, y: cy - LINE_H / 2, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    svgEl('text', { x: cx, y: cy + LINE_H / 2, class: 'sh-name', text: element.name }, g);
  } else {
    svgEl('text', { x: cx, y: cy, class: 'sh-name', text: element.name }, g);
  }
}

function renderPort(g, shape, element, layout) {
  svgEl('rect', {
    x: shape.x, y: shape.y, width: layout.w, height: layout.h, class: 'sh-body',
  }, g);
}

/* --------------------------------------------------------------- state */

function renderState(g, shape, element, layout) {
  const { w, h, boxes } = layout;
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: h, rx: 12, ry: 12, class: 'sh-body',
  }, g);
  applyFill(body, shape);
  let y = shape.y;
  for (const box of boxes) {
    if (box.id === 'name') {
      let ty = y + CAPTION_LINE / 2;
      if (element.stereotype) {
        svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
        ty += CAPTION_LINE;
      }
      // `State` is not a Classifier (§14.5.9: Namespace, Vertex), so a state
      // name is never italic: it goes through the plain name class.
      svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-name', text: element.name }, g);
    } else if (box.rows?.length) {
      svgEl('line', { x1: shape.x, y1: y, x2: shape.x + w, y2: y, class: 'sh-line' }, g);
      box.rows.forEach((row, i) => {
        svgEl('text', {
          x: shape.x + PAD_X, y: y + MEMBER_PAD + i * LINE_H + LINE_H / 2,
          class: 'sh-row', text: `${box.prefix}${row}`,
        }, g);
      });
    }
    y += box.h;
  }
}

function renderInitial(g, shape, element, layout) {
  // 18×18 — круг в рамке занимает π/4, остальное раньше было «мимо».
  hitRect(g, shape.x, shape.y, layout.w, layout.h);
  const cx = shape.x + layout.w / 2;
  const cy = shape.y + layout.h / 2;
  const r = Math.min(layout.w, layout.h) / 2;
  svgEl('circle', { cx, cy, r, class: 'sh-fill' }, g);
}

function renderFinal(g, shape, element, layout) {
  hitRect(g, shape.x, shape.y, layout.w, layout.h);
  const cx = shape.x + layout.w / 2;
  const cy = shape.y + layout.h / 2;
  const r = Math.min(layout.w, layout.h) / 2;
  svgEl('circle', { cx, cy, r, class: 'sh-body' }, g);
  svgEl('circle', { cx, cy, r: r * 0.6, class: 'sh-fill' }, g);
}

function renderDiamond(g, shape, element, layout) {
  const { w, h } = layout;
  // Ромб занимает половину своей рамки: углы пустые, и клик по ним уходил
  // сквозь фигуру. Подложка прямоугольная — как и рамка, к которой цепляются
  // связи и которую видит аудит.
  hitRect(g, shape.x, shape.y, w, h);
  const cx = shape.x + w / 2;
  const cy = shape.y + h / 2;
  svgEl('polygon', {
    class: 'sh-body',
    points: `${cx},${shape.y} ${shape.x + w},${cy} ${cx},${shape.y + h} ${shape.x},${cy}`,
  }, g);
  if (String(element.name ?? '').trim()) {
    svgEl('text', { x: cx, y: cy, class: 'sh-name small', text: element.name }, g);
  }
}

function renderJunction(g, shape, element, layout) {
  const r = Math.min(layout.w, layout.h) / 2;
  svgEl('circle', {
    cx: shape.x + layout.w / 2, cy: shape.y + layout.h / 2, r, class: 'sh-fill',
  }, g);
}

function renderHistory(g, shape, element, layout, def) {
  const cx = shape.x + layout.w / 2;
  const cy = shape.y + layout.h / 2;
  const r = Math.min(layout.w, layout.h) / 2;
  svgEl('circle', { cx, cy, r, class: 'sh-body' }, g);
  svgEl('text', {
    x: cx, y: cy, class: 'sh-name small', text: def.deep ? 'H*' : 'H',
  }, g);
}

function renderPoint(g, shape, element, layout, def) {
  const cx = shape.x + layout.w / 2;
  const cy = shape.y + layout.h / 2;
  const r = Math.min(layout.w, layout.h) / 2;
  svgEl('circle', { cx, cy, r, class: 'sh-body' }, g);
  if (def.cross) {
    const k = r * 0.55;
    svgEl('path', {
      class: 'sh-line', d: `M ${cx - k} ${cy - k} L ${cx + k} ${cy + k} M ${cx + k} ${cy - k} L ${cx - k} ${cy + k}`,
    }, g);
  }
}

function renderTerminate(g, shape, element, layout) {
  const x = shape.x;
  const y = shape.y;
  const w = layout.w;
  const h = layout.h;
  svgEl('path', { class: 'sh-line', d: `M ${x} ${y} L ${x + w} ${y + h} M ${x + w} ${y} L ${x} ${y + h}` }, g);
}

/* ----------------------------------------------------------- activity */

function renderAction(g, shape, element, layout, def, ctx) {
  const { w, h } = layout;
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: h, rx: 10, ry: 10, class: 'sh-body',
  }, g);
  applyFill(body, shape);
  svgEl('text', {
    x: shape.x + w / 2, y: shape.y + h / 2, class: 'sh-name', text: element.name,
  }, g);
  // Действие вызова деятельности (§15.3.2, `behaviorRef`): под именем стоит
  // имя вызываемой деятельности — иначе узел не отличить от обычного действия.
  const called = element.behaviorRef ? findElement(ctx?.model, element.behaviorRef) : null;
  if (called) {
    svgEl('text', {
      x: shape.x + w / 2, y: shape.y + h / 2 + LINE_H, class: 'sh-row',
      text: `«${called.name || called.id}»`, 'data-behavior-ref': called.id,
    }, g);
  }
}

function renderActivity(g, shape, element, layout) {
  const { w, h } = layout;
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: h, rx: 16, ry: 16, class: 'sh-body',
  }, g);
  applyFill(body, shape);
  svgEl('text', {
    x: shape.x + PAD_X + 4, y: shape.y + CAPTION_LINE / 2, class: nameClass(element, ' left'), text: element.name,
  }, g);
}

function renderObjectNode(g, shape, element, layout) {
  const { w, h } = layout;
  const body = svgEl('rect', { x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body' }, g);
  applyFill(body, shape);
  svgEl('text', { x: shape.x + w / 2, y: shape.y + h / 2, class: 'sh-name', text: element.name }, g);
}

function renderBar(g, shape, element, layout) {
  svgEl('rect', {
    x: shape.x, y: shape.y, width: layout.w, height: layout.h, class: 'sh-fill',
  }, g);
}

function renderSwimlane(g, shape, element, layout, def, ctx) {
  const { w, h } = layout;
  const body = svgEl('rect', { x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body' }, g);
  applyFill(body, shape);
  svgEl('rect', { x: shape.x, y: shape.y, width: w, height: 28, class: 'sh-tab' }, g);
  svgEl('text', { x: shape.x + w / 2, y: shape.y + 14, class: 'sh-name', text: element.name }, g);
  // Дорожка представляет элемент модели (§15.2.4, `represents`): его имя
  // стоит в шапке справа, потому что имя самой дорожки — раздел деятельности,
  // а не классификатор.
  const target = element.represents ? findElement(ctx?.model, element.represents) : null;
  if (target) {
    svgEl('text', {
      x: shape.x + w - 8, y: shape.y + 14, class: 'sh-row', 'text-anchor': 'end',
      text: `: ${target.name || target.id}`, 'data-represents': target.id,
    }, g);
  }
}

/* -------------------------------------------------------- interactions */

/**
 * Подпись линии жизни (§17.3.4, `Lifeline::represents`): `имя : Класс`,
 * `: Класс` — когда имени нет, и просто `имя` — когда классификатора нет.
 *
 * Классификатор на листе не хранится: он берётся из модели по ссылке, поэтому
 * переименование класса меняет подпись на всех листах сразу. Это то же
 * правило, по которому дорожка деятельности подписывает `: Элемент`
 * (`data-represents` ниже), только у линии жизни имя экземпляра своё.
 */
function lifelineLabel(element, ctx) {
  const target = element.represents ? findElement(ctx?.model, element.represents) : null;
  if (!target) return element.name;
  const name = String(element.name ?? '').trim();
  const cls = String(target.name || target.id).trim();
  // Корпус пособия пишет имя уже в форме `curStud:Student`. Если классификатор
  // тот же, второй раз не дописываем — `curStud:Student : Student` читается
  // как два разных класса. Если другой — дописываем: расхождение должно быть
  // видно на листе, его и ловит правило `lifeline-same-classifier`.
  if (name.endsWith(`:${cls}`) || name.endsWith(`: ${cls}`)) return element.name;
  return name ? `${name} : ${cls}` : `: ${cls}`;
}

function renderLifeline(g, shape, element, layout, def, ctx) {
  const { w, h } = layout;
  // Пунктир линии жизни тянется на 260 px: без подложки попадала только
  // голова (12,5 % рамки). Подложка — во всю рамку, включая хвост.
  hitRect(g, shape.x, shape.y, w, h);
  // Множественная линия жизни (§17.3.4, `multiObject`): за головой стоит
  // вторая рамка, сдвинутая вниз-вправо, и две наклонные черты соединяют
  // углы. Это стандарт.
  if (element.multiObject) {
    const off = 6;
    svgEl('path', {
      class: 'sh-line',
      d: `M ${shape.x} ${shape.y} L ${shape.x + off} ${shape.y + off}`
        + ` M ${shape.x + w} ${shape.y} L ${shape.x + w + off} ${shape.y + off}`
        + ` M ${shape.x + off} ${shape.y + off} L ${shape.x + w + off} ${shape.y + off}`
        + ` L ${shape.x + w + off} ${shape.y + LIFELINE_HEAD + off}`
        + ` L ${shape.x + off} ${shape.y + LIFELINE_HEAD + off} Z`,
    }, g);
  }
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: LIFELINE_HEAD, class: 'sh-body',
  }, g);
  applyFill(body, shape);
  let ty = shape.y + (LIFELINE_HEAD - (element.stereotype ? 2 : 1) * LINE_H) / 2 + LINE_H / 2;
  if (element.stereotype) {
    svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    ty += LINE_H;
  }
  svgEl('text', {
    x: shape.x + w / 2, y: ty, class: 'sh-name',
    text: lifelineLabel(element, ctx),
    'data-represents': element.represents ? element.represents : undefined,
  }, g);
  svgEl('line', {
    x1: shape.x + w / 2, y1: shape.y + LIFELINE_HEAD,
    x2: shape.x + w / 2, y2: shape.y + h, class: 'sh-dash',
  }, g);
  // Завершённая линия (`stopped`, §17.3.4): крест на конце линии.
  if (element.stopped) {
    const cx = shape.x + w / 2;
    const cy = shape.y + h;
    const k = 6;
    svgEl('path', {
      class: 'sh-line',
      d: `M ${cx - k} ${cy - k} L ${cx + k} ${cy + k} M ${cx + k} ${cy - k} L ${cx - k} ${cy + k}`,
    }, g);
  }
}

function renderActorLifeline(g, shape, element, layout, def, ctx) {
  const { w, h } = layout;
  hitRect(g, shape.x, shape.y, w, h);
  const cx = shape.x + w / 2;
  const top = shape.y;
  const H = ACTOR_LIFELINE_HEAD - 20;
  const headR = 7;
  svgEl('circle', { cx, cy: top + headR, r: headR, class: 'sh-body' }, g);
  const bodyTop = top + headR * 2;
  const bodyBottom = top + H * 0.7;
  svgEl('line', { x1: cx, y1: bodyTop, x2: cx, y2: bodyBottom, class: 'sh-line' }, g);
  svgEl('line', { x1: cx - 12, y1: top + H * 0.35, x2: cx + 12, y2: top + H * 0.35, class: 'sh-line' }, g);
  svgEl('line', { x1: cx, y1: bodyBottom, x2: cx - 12, y2: top + H * 0.95, class: 'sh-line' }, g);
  svgEl('line', { x1: cx, y1: bodyBottom, x2: cx + 12, y2: top + H * 0.95, class: 'sh-line' }, g);
  svgEl('text', {
    x: cx, y: top + ACTOR_LIFELINE_HEAD - 8, class: 'sh-name',
    text: lifelineLabel(element, ctx),
    'data-represents': element.represents ? element.represents : undefined,
  }, g);
  svgEl('line', {
    x1: cx, y1: shape.y + ACTOR_LIFELINE_HEAD, x2: cx, y2: shape.y + h, class: 'sh-dash',
  }, g);
}

function renderActivation(g, shape, element, layout) {
  svgEl('rect', {
    x: shape.x, y: shape.y, width: layout.w, height: layout.h, class: 'sh-body',
  }, g);
}

function renderFrame(g, shape, element, layout) {
  const { w, h } = layout;
  const op = element.operator || 'ref';
  const tabW = Math.max(34, textWidth(op) + 16);
  const tabH = MECHANICS.fragmentCaption;
  const body = svgEl('rect', {
    x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body frame',
  }, g);
  body.style.fill = 'none';
  svgEl('path', {
    class: 'sh-body',
    d: `M ${shape.x} ${shape.y} L ${shape.x + tabW - 10} ${shape.y} L ${shape.x + tabW} ${shape.y + tabH - 2} L ${shape.x + tabW} ${shape.y + tabH - 2} L ${shape.x} ${shape.y + tabH - 2} Z`,
  }, g);
  svgEl('text', {
    x: shape.x + 8, y: shape.y + tabH / 2 - 1, class: 'sh-name left small', text: op,
  }, g);

  // Операнды (§3.4). Модель знает только сторож и покрытие; высота операнда и
  // разделитель — геометрия фигуры, поэтому делится поровну. Без `operands`
  // фрагмент ведёт себя по-старому: один операнд на всё поле.
  const operands = Array.isArray(element.operands) ? element.operands : [];
  // Имя фрагмента носит сторожа в тех файлах, где операндов ещё не было: так
  // пишет и корпус, и импорт PlantUML (`alt [a] / [else]`). Когда операнды
  // записаны, тот же текст стоит в теле рамки — и второй раз в шапке он
  // читается как ошибка. Рисуем его один раз.
  const guardsText = operands.map((o) => guardText(o.guard)).filter(Boolean).join(' / ');
  const nameText = String(element.name ?? '').trim();
  const nameIsGuards = guardsText && nameText.replace(/\s+/g, ' ') === guardsText.replace(/\s+/g, ' ');
  if (nameText && !nameIsGuards) {
    // `interaction` is a Classifier (Behavior → Class → Classifier), so its
    // name follows the same italics rule; `fragment`/`interactionUse` are not
    // and simply never carry `abstract`.
    svgEl('text', {
      x: shape.x + tabW + 8, y: shape.y + tabH / 2 - 1,
      class: nameClass(element, ' left small'), text: element.name,
    }, g);
  }
  if (operands.length < 2) {
    const guard = operands.length === 1 ? guardText(operands[0].guard) : '';
    if (guard) {
      svgEl('text', {
        x: shape.x + 8, y: shape.y + tabH + LINE_H / 2 + 1, class: 'sh-row', text: guard,
      }, g);
    }
    return;
  }
  const top = shape.y + tabH - 2;
  const bodyH = Math.max(1, h - (tabH - 2));
  const step = bodyH / operands.length;
  operands.forEach((operand, i) => {
    const y = top + i * step;
    if (i > 0) {
      svgEl('line', {
        x1: shape.x, y1: y, x2: shape.x + w, y2: y,
        class: 'sh-line', 'data-operand-sep': String(i),
      }, g);
    }
    const guard = guardText(operand.guard);
    if (guard) {
      svgEl('text', {
        x: shape.x + 8, y: y + (i === 0 ? tabH / 2 + 3 : LINE_H / 2 + 3),
        class: 'sh-row', text: guard, 'data-operand-guard': operand.id ?? String(i),
      }, g);
    }
  });
}

/** Сторож рисуется в скобках; скобки, уже набранные в тексте, не удваиваются. */
const guardText = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^[[(]/.test(s) ? s : `[${s}]`;
};

function renderBoundary(g, shape, element, layout) {
  const { w, h } = layout;
  const body = svgEl('rect', { x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body' }, g);
  applyFill(body, shape);
  // Рамка системы — это Subject; её подписывают стереотипом «subject»
  // над именем. Без него рамка на листе ничем не отличается от прямоугольника,
  // и сверка с оригиналом 3.1.2 каждый раз сообщала одно и то же.
  let ty = shape.y + CAPTION_LINE / 2;
  if (element.stereotype) {
    svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-stereo', text: `«${element.stereotype}»` }, g);
    ty += CAPTION_LINE;
  }
  svgEl('text', { x: shape.x + w / 2, y: ty, class: 'sh-name', text: element.name }, g);
}

function renderTimingLane(g, shape, element, layout, def, ctx) {
  const { w, h } = layout;
  const body = svgEl('rect', { x: shape.x, y: shape.y, width: w, height: h, class: 'sh-body' }, g);
  applyFill(body, shape);
  svgEl('line', {
    x1: shape.x, y1: shape.y + 24, x2: shape.x + w, y2: shape.y + 24,
    class: 'sh-line',
  }, g);
  svgEl('text', {
    x: shape.x + PAD_X, y: shape.y + 12, class: 'sh-name left',
    text: lifelineLabel(element, ctx),
    'data-represents': element.represents ? element.represents : undefined,
  }, g);

  const segs = Array.isArray(element.timeline) ? element.timeline : [];
  if (!segs.length) return;
  const states = [...new Set(segs.map((s) => s.state || '—'))];
  const laneTop = shape.y + 30;
  const laneH = Math.max(20, h - 38);
  const rowH = laneH / Math.max(1, states.length);
  const levelY = (state) => laneTop + states.indexOf(state || '—') * rowH + rowH / 2;
  const xOf = (t) => shape.x + 70 + ((w - 80) * Math.max(0, Math.min(100, Number(t) || 0))) / 100;

  states.forEach((st, i) => {
    svgEl('text', {
      x: shape.x + 6, y: laneTop + i * rowH + rowH / 2, class: 'sh-row', text: st,
    }, g);
  });

  let d = '';
  let prevY = null;
  for (const s of segs) {
    const y = levelY(s.state);
    const x1 = xOf(s.from);
    const x2 = xOf(s.to);
    if (prevY === null) d += `M ${x1} ${y}`;
    else d += ` L ${x1} ${prevY} L ${x1} ${y}`;
    d += ` L ${x2} ${y}`;
    prevY = y;
  }
  svgEl('path', { class: 'conn', d }, g);

  // Time axis: 0/25/50/75/100 with a tick, as a timing diagram reads left to
  // right in percentages of the observation window.
  const axisY = shape.y + h - 16;
  svgEl('line', {
    x1: xOf(0), y1: axisY, x2: xOf(100), y2: axisY, class: 'sh-line',
  }, g);
  for (const t of [0, 25, 50, 75, 100]) {
    const x = xOf(t);
    svgEl('line', { x1: x, y1: axisY - 3, x2: x, y2: axisY + 2, class: 'sh-line' }, g);
    svgEl('text', {
      x, y: axisY + 8, class: 'sh-row', 'text-anchor': 'middle', text: `${t}`,
    }, g);
  }
}

/* ---------------------------------------------- visibility + name bits */

function renderVisibilityIcon(g, vis, cx, cy, row) {
  if (row?._novis) return null;
  const key = visByKey[vis]?.key ?? 'public';
  // Visibility Style is an index into IClassUIModel.VISIBILITY_STYLES —
  // {"Icon", "UML", "Off"} — read out of the shipped interface in MECHANICS §16:
  //   VS_ICON = 0 → the painted glyph,
  //   VS_UML  = 1 → the notation's own character (+ - # ~),
  //   VS_OFF  = 2 → nothing at all.
  // The factory default (v/dap/r#<init>+0x0030) and every class record in the
  // samples store 1, so the sheet draws characters. An earlier build had the
  // 0 and 1 branches swapped and drew glyphs at the default.
  if (MECHANICS.visibilityStyle === VIS_OFF) return null;
  if (MECHANICS.visibilityStyle !== VIS_ICON) {
    return svgEl('text', {
      x: cx, y: cy, class: 'sh-row vis-txt',
      text: visByKey[key]?.symbol ?? '+',
    }, g);
  }
  const ic = svgEl('g', { class: 'vis-ic', transform: `translate(${cx} ${cy})` }, g);
  const glyph = visIcon(key, 16);
  glyph.setAttribute('x', '-8');
  glyph.setAttribute('y', '-8');
  ic.append(glyph);
  return ic;
}

/* ---------------------------------------------------------- connectors */

/* ------------------------------------------- маршрут связи и пересечения */

/**
 * Точки связи. Один расчёт на перерисовку: маршрут нужен и рисованию, и
 * поиску пересечений (§26), а второй расчёт — это вторая геометрия для одной
 * и той же линии.
 */
function routeFor(ctx, link) {
  if (ctx.routes?.has(link.id)) return ctx.routes.get(link.id);
  const { diagram, model } = ctx;
  const rel = relOf(model, link);
  const def = NOTATION.connectors[rel.kind];
  const from = link.from ? diagram.shapes.find((s) => s.id === link.from.shapeId) : null;
  const to = link.to ? diagram.shapes.find((s) => s.id === link.to.shapeId) : null;
  let pts;
  if (def.sequence) {
    pts = messagePoints(link, from, to, model, ctx);
  } else {
    const lf = layoutOf(from, elementOf(model, from));
    const lt = layoutOf(to, elementOf(model, to));
    // Концы (§3.1): доля+смещение, если файл её принёс, иначе прежняя
    // сторона+доля. `entryPerimeter` — просьба проекта на границу.
    // Вторая связь между той же парой отходит от кромки на своё место: две
    // законные ассоциации не должны выглядеть одной линией (parallel-links.js).
    ctx.parallelOffsets ??= parallelOffsets(diagram, model);
    const ends = parallelEnds(diagram, link, ctx.parallelOffsets);
    const p1 = endPoint(from, lf, ends.from, link.entryPerimeter === true);
    const p2 = endPoint(to, lt, ends.to, link.entryPerimeter === true);
    // Hand-placed bends sit between the two attached ends; without them this
    // is the automatic route, unchanged.
    pts = linkPoints(p1, p2, routeOfLink(link), link.waypoints, link.noEdgeStyle === true);
  }
  ctx.routes?.set(link.id, pts);
  return pts;
}

/**
 * Пересечения связей — заранее, до рисования: каждая связь со своим кодом
 * скачка получает список точек, где её пересекает другая (§26). Считаются
 * только связи между двумя фигурами: у сообщения на диаграмме
 * последовательности пересечение — не пересечение линий, а такт.
 */
function markJumps(ctx) {
  const { diagram, model } = ctx;
  const links = (diagram.links ?? []).filter((l) => {
    const rel = relOf(model, l);
    const def = rel && NOTATION.connectors[rel.kind];
    if (!rel || !def || def.sequence || rel.internal === true) return false;
    if (resolveJumps(l.lineJumps, diagram.lineJumps) === LINE_JUMPS.off) return false;
    const from = l.from ? diagram.shapes.find((s) => s.id === l.from.shapeId) : null;
    const to = l.to ? diagram.shapes.find((s) => s.id === l.to.shapeId) : null;
    return Boolean(from && to);
  });
  if (!links.length) return;
  // Все маршруты — и прыгающих связей, и тех, что их пересекают: вторая
  // линия не обязана прыгать, но именно она создаёт пересечение.
  const routes = new Map();
  for (const l of diagram.links ?? []) {
    const rel = relOf(model, l);
    const def = rel && NOTATION.connectors[rel.kind];
    if (!rel || !def || def.sequence || rel.internal === true) continue;
    const from = l.from ? diagram.shapes.find((s) => s.id === l.from.shapeId) : null;
    const to = l.to ? diagram.shapes.find((s) => s.id === l.to.shapeId) : null;
    if (from && to) routes.set(l.id, routeFor(ctx, l));
  }
  const ids = [...routes.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const pa = routes.get(ids[i]);
      const pb = routes.get(ids[j]);
      if (!pa || !pb) continue;
      const jumperA = links.find((l) => l.id === ids[i]);
      const jumperB = links.find((l) => l.id === ids[j]);
      if (jumperA) {
        const hits = polylineCrossings(pa, pb);
        if (hits.length) ctx.jumps.set(ids[i], hits);
      }
      if (jumperB) {
        const hits = polylineCrossings(pb, pa);
        if (hits.length) ctx.jumps.set(ids[j], hits);
      }
    }
  }
}

function renderLink(root, ctx, link) {
  const { diagram, model } = ctx;
  const rel = relOf(model, link);
  if (!rel) return;
  const def = NOTATION.connectors[rel.kind];
  if (!def) return;
  const from = link.from ? diagram.shapes.find((s) => s.id === link.from.shapeId) : null;
  const to = link.to ? diagram.shapes.find((s) => s.id === link.to.shapeId) : null;
  if (!from && !to) return;
  // Свободный конец (§3.2): найдено — нет отправителя, потеряно — нет
  // получателя. У всех прочих связей второго конца быть не может.
  if ((!from || !to) && !def.sequence) return;
  const freeFrom = !from;
  const freeTo = !to;

  const g = svgEl('g', {
    'data-kind': 'conn', 'data-id': link.id, 'data-rel': rel.id, class: 'conn-g',
  }, root);
  // Свой цвет связи («Connector color»): задаётся на группе
  // одной переменной — линия и оба наконечника читают её через CSS. В тёмной
  // теме цвет приводится к светлой полосе так же, как заливка фигуры, иначе
  // выбранный «чёрный» на тёмном листе исчезает. Экспорт берёт исходный.
  if (link.color) {
    g.style.setProperty('--conn-ink', themeEdge(link.color, fillThemeDark()));
  }

  const pts = routeFor(ctx, link);

  // One path function for the sheet and for the SVG export: a rounded corner
  // must land in the file exactly as it stands on screen.
  //
  // Скачок на пересечении (§26) — та же геометрия, но с разрывом/дугой в
  // точке, где линию пересекает другая связь. Скачок принадлежит связи:
  // линия без своего кода не прыгает, даже если её пересекают.
  const jumpMode = def.sequence ? LINE_JUMPS.off : resolveJumps(link.lineJumps, diagram.lineJumps);
  const hits = jumpMode === LINE_JUMPS.off ? [] : (ctx.jumps?.get(link.id) ?? []);
  const sizeCode = link.lineJumpsSize != null ? link.lineJumpsSize : diagram.lineJumpsSize;
  // The route is asked for once: `curve` is a shape of the line, and the same
  // `pathD` call serves the sheet and exportSvgString (renderDiagram is one
  // renderer for both), so the curve cannot drift between them.
  const route = routeOfLink(link);
  // A curve is sampled ONCE and the same points feed the path and the heads:
  // the original's arrow follows the spline's own end tangent (it stores an
  // extrapolated point at v/cct/ba#l()+0x01a7 for exactly that), not the chord
  // between the last two route points (§27a).
  const curvePts = route === 'curve' ? curveSamples(pts) : null;
  const d = hits.length
    ? jumpedPath(pts, hits, jumpMode, jumpSize(sizeCode))
    : (curvePts ? samplesPath(curvePts) : pathD(pts, link.rounded ?? roundedOfStyle(link.style), link.arcSize, false));
  svgEl('path', { class: 'conn-hit', d: polylinePath(pts) }, g);
  svgEl('path', {
    class: `conn${def.dash ? ' dash' : ''}${def.sequence ? ' msg' : ''}`,
    d,
  }, g);

  // Маркеры концов: СПИСОК на каждый конец, а не «одно или другое».
  //
  // Ромб агрегации отвечает на вопрос «что это за конец», стрелка навигации —
  // «куда по нему можно прийти»; UML требует их ОДНОВРЕМЕННО на одном конце
  // (ромб «является частью» + навигация), поэтому слоты независимы. Порядок от
  // фигуры внутрь: сначала ромб, затем головка связи, затем стрелка — каждая
  // следующая сдвинута по последнему сегменту на длину уже нарисованной, иначе
  // они лягут друг на друга.
  //
  // `navigable: 'from'` читается «от `from` к `to`» (tests/corpus/README.md),
  // значит остриё у конца `to`. Но `from`/`to` вида — это лишь то, откуда
  // потянули линию: семантический конец берётся из МОДЕЛИ через
  // `semanticEndOf`, поэтому ромб остаётся там, где его задала модель, даже
  // если линию рисовали в обратную сторону.
  const assoc = def.kind === 'association' || def.kind === 'aggregation' || def.kind === 'composition';
  const nav = navigableOf(rel);
  const diamond = (v) => (v === 'shared' ? 'diamond' : 'filledDiamond');
  // Асинхронное сообщение рисуется ОТКРЫТОЙ стрелкой, синхронное — залитой
  // (§3.2, §17.4.3). Крест «уничтожить» остаётся крестом.
  const head = rel.asynchronous && def.head === 'filledTriangle' ? 'open' : def.head;
  const semFrom = semanticEndOf(diagram, link, rel, 'from');
  const semTo = semanticEndOf(diagram, link, rel, 'to');
  const aggAt = (sem) => (sem ? aggregationOf(rel, sem) : 'none');
  const navAt = (sem) => (sem === 'from'
    ? nav === 'to' || nav === 'both'
    : sem === 'to' ? nav === 'from' || nav === 'both' : false);

  const ends = { from: [], to: [] };
  if (!freeFrom) {
    if (aggAt(semFrom) !== 'none') ends.from.push(diamond(aggAt(semFrom)));
    // Ромб вида «Агрегация»/«Композиция» объявлен и в начертании полем `tail`,
    // но он уже пришёл из модели строкой выше: второй такой — не второй слот.
    if (def.tail && !DIAMOND_TAILS.has(def.tail)) ends.from.push(def.tail);
    if (assoc && navAt(semFrom)) ends.from.push('open');
  }
  if (!freeTo) {
    if (aggAt(semTo) !== 'none') ends.to.push(diamond(aggAt(semTo)));
    if (head && head !== 'none') ends.to.push(head);
    if (assoc && navAt(semTo)) ends.to.push('open');
  }
  // Размер наконечника — свойство КОНЦА (§28): у связи он хранится отдельно
  // для источника и цели, и отсутствие поля значит код 2, то есть базовый
  // размер. Оба конца читают один и тот же `headSizeOf`, поэтому мусор в файле
  // не растянет стрелку.
  drawHeads(g, curvePts ?? pts, ends.from, 'from', headSizeOf(link.headSizeFrom));
  drawHeads(g, curvePts ?? pts, ends.to, 'to', headSizeOf(link.headSizeTo));

  // Кружок на свободном конце (§17.4.4): найденное сообщение начинается им,
  // потерянное — им заканчивается. Стрелки туда не ставятся: стрелять некуда.
  if (freeFrom) {
    svgEl('circle', {
      cx: pts[0][0], cy: pts[0][1], r: 4, class: 'sh-fill', 'data-free-end': 'from',
    }, g);
  }
  if (freeTo) {
    const tip = pts[pts.length - 1];
    svgEl('circle', {
      cx: tip[0], cy: tip[1], r: 4, class: 'sh-fill', 'data-free-end': 'to',
    }, g);
  }

  const label = labelOf(rel, def, ctx.numbers.get(link.id));
  if (label.lines.length || label.signature) {
    const mid = def.sequence
      ? { x: (pts[0][0] + pts[pts.length - 1][0]) / 2, y: Math.min(...pts.map((p) => p[1])) - (MECHANICS.messageCaption / 2 + 2), angle: 0 }
      : labelPos(pts, link.ldx, link.ldy, link.labelOrientation);
    const box = svgEl('g', {
      class: 'conn-label-g',
      transform: `translate(${mid.x} ${mid.y}) rotate(${mid.angle})`,
      'data-angle': Math.round(mid.angle),
    }, g);
    // An Association is a Classifier (§11.8.1.3), so an abstract one carries
    // its NAME in italics; the «stereotype» line above it is a keyword, not
    // the classifier's name, and stays upright. `font-style` is a presentation
    // attribute: the stylesheet has no `.conn-lbl.italic` rule and
    // `styles.css` is outside this iteration's files.
    //
    // Подпись сообщения (§17.12.18.7) — отдельная строка ПОД именем, то есть
    // ближе к линии. Поэтому при сигнатуре блок прижат низом к прежнему месту
    // подписи: имя поднимается на строку вверх, сигнатура встаёт на старое
    // место. Без сигнатуры смещение прежнее — подписи не сдвинулись ни на
    // пиксель, и замеры `tests/connectors.mjs` не меняются.
    const rows = label.lines.length + (label.signature ? 1 : 0);
    label.lines.forEach((line, i) => {
      svgEl('text', {
        x: 0,
        y: label.signature
          ? (i - (rows - 1)) * LINE_H
          : (i - (label.lines.length - 1) / 2) * LINE_H - (def.sequence ? 0 : 12),
        class: 'conn-lbl', text: line, 'data-angle': Math.round(mid.angle),
        'font-style': rel.abstract && !line.startsWith('«') ? 'italic' : undefined,
      }, box);
    });
    // Мелкий кегль — атрибутом, а не классом: `styles.css` править нельзя, а
    // `exportDiagramSvgString` собирает собственный <style>; атрибут работает
    // и в редакторе, и в экспорте.
    if (label.signature) {
      svgEl('text', {
        x: 0, y: 0, class: 'conn-lbl sig', text: label.signature,
        'data-signature': '1', 'font-size': 9, 'data-angle': Math.round(mid.angle),
      }, box);
    }
  }

  if (def.multiplicity) {
    const fromMulti = drawn(rel.fromMultiplicity);
    const toMulti = drawn(rel.toMultiplicity);
    if (fromMulti) {
      const mp = multiPos(pts, 'from', 0.2);
      svgEl('text', { x: mp.x, y: mp.y, class: 'conn-multi', text: fromMulti }, g);
    }
    if (toMulti) {
      const mp = multiPos(pts, 'to', 0.2);
      svgEl('text', { x: mp.x, y: mp.y, class: 'conn-multi', text: toMulti }, g);
    }
  }
  // The role name of an end (UML 2.5.1 §11.5.3): a plain label at that end,
  // closer to the classifier than the multiplicity box. Two labels on one
  // shared position would collide, so the role sits lower and nearer.
  if (def.roles) {
    const fromRole = drawn(rel.fromRole);
    const toRole = drawn(rel.toRole);
    if (fromRole) {
      const mp = multiPos(pts, 'from', 0.12);
      svgEl('text', { x: mp.x, y: mp.y + LINE_H, class: 'conn-multi role', text: fromRole }, g);
    }
    if (toRole) {
      const mp = multiPos(pts, 'to', 0.12);
      svgEl('text', { x: mp.x, y: mp.y + LINE_H, class: 'conn-multi role', text: toRole }, g);
    }
  }
  // Квалификатор полюса (§11.4.4, §3.8): маленький прямоугольник у конца
  // ассоциации, ближе к классификатору, чем кратность и роль. Несколько
  // строк ставятся друг под другом — это список, а не подпись.
  if (def.roles) {
    for (const end of ['from', 'to']) {
      if (freeFrom && end === 'from') continue;
      if (freeTo && end === 'to') continue;
      const list = qualifiersOf(rel, end);
      if (!list.length) continue;
      const qw = Math.max(...list.map((q) => textWidth(q))) + 10;
      const qh = list.length * LINE_H + 4;
      const qp = multiPos(pts, end, 0.06);
      const qy = end === 'from' ? qp.y - qh - 6 : qp.y + 6;
      svgEl('rect', {
        x: qp.x - qw / 2, y: qy, width: qw, height: qh, class: 'sh-body', 'data-qualifier': end,
      }, g);
      list.forEach((q, i) => {
        svgEl('text', {
          x: qp.x - qw / 2 + 5, y: qy + LINE_H * (i + 0.5) + 2, class: 'sh-row', text: q,
        }, g);
      });
    }
  }
  // {complete, disjoint} of the generalization set this arrow belongs to.
  const set = setOfRelationship(model, rel);
  const setText = set ? generalizationSetLabel(set) : '';
  if (setText) {
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2] ?? tip;
    const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
    const bx = tip[0] - ((tip[0] - prev[0]) / len) * 26;
    const by = tip[1] - ((tip[1] - prev[1]) / len) * 26;
    svgEl('text', {
      x: bx, y: by, class: 'conn-multi set', 'text-anchor': 'middle', text: setText,
    }, g);
  }
  return g;
}

/**
 * A message is horizontal: it starts and ends on the lifeline's centre.
 *
 * Один из концов может отсутствовать (§3.2): потерянное сообщение обрывается
 * в пустоте, найденное начинается из неё. Длина свободного хвоста постоянная,
 * чтобы «кружок» не уезжал от линии при перерисовке.
 *
 * Порядок. `link.y` — геометрия и главнее всего; если его нет, а `seq` на
 * диаграмме есть, сообщения раскладываются по порядку через интервал из
 * листа механики. Без `seq` всё как раньше: все на одной высоте.
 */
function messagePoints(link, from, to, model, ctx = null) {
  const FREE = 96;
  const lf = from ? layoutOf(from, elementOf(model, from)) : null;
  const lt = to ? layoutOf(to, elementOf(model, to)) : null;
  const anchorY = (s) => (s ? s.y + LIFELINE_HEAD + MESSAGE_GAP : 0);
  let y = link.y;
  if (y == null) {
    const order = ctx?.order?.get(link.id);
    if (ctx?.bySeq && order) {
      const top = Math.min(...[from, to].filter(Boolean).map(anchorY));
      y = top + order.index * MESSAGE_GAP;
    } else {
      y = Math.max(...[from, to].filter(Boolean).map(anchorY));
    }
  }
  const cx1 = from ? from.x + lf.w / 2 : null;
  const cx2 = to ? to.x + lt.w / 2 : null;
  if (from && to && from.id === to.id) {
    // Self message: a loop on the right of the LIFELINE. The line itself runs
    // down the centre of the head box, so anchoring at `from.x + lf.w` put the
    // loop on the right edge of the header — visibly detached from the dashed
    // line it belongs to.
    const x = cx1;
    return [[x, y], [x + 40, y], [x + 40, y + 20], [x, y + 20]];
  }
  if (from && to) return [[cx1, y], [cx2, y]];
  if (from) return [[cx1, y], [cx1 + FREE, y]];
  return [[cx2 - FREE, y], [cx2, y]];
}

function labelOf(rel, def, number) {
  const lines = [];
  if (rel.stereotype) lines.push(`«${rel.stereotype}»`);
  const name = rel.name || '';
  if (number && name) lines.push(`${number}: ${name}`);
  else if (number) lines.push(number);
  else if (name) lines.push(name);
  // Переход состояния (§14.5.10): `событие [сторож] / действие`. Без этого
  // поля, которые человек задал в инспекторе, жили бы только в файле —
  // а в пособии (упр. 5.2) сторож и действие читаются именно на линии.
  if (rel.kind === 'transition') {
    const trigger = String(rel.trigger ?? '').trim();
    const guard = String(rel.guard ?? '').trim();
    const effect = String(rel.effect ?? '').trim();
    if (trigger || guard || effect) {
      lines.push(`${trigger}${guard ? ` ${guard}` : ''}${effect ? ` / ${effect}` : ''}`.trim());
    }
  }
  // Подпись сообщения (§17.12.18.7, `Message::signature`) — ОТДЕЛЬНАЯ строка,
  // а не часть `name`: имя связи остаётся меткой на линии, сигнатура — тем,
  // что вызывается. Только у сообщений: у ассоциации сигнатуры в UML нет.
  const signature = def.sequence ? String(rel.signature ?? '').trim() : '';
  return { lines, signature };
}

// Re-exported for canvas.js and the tests: the path helpers live in geometry.js
// next to the routing they belong to.
export { polylinePath };

function segOf(pts, which) {
  const n = pts.length;
  const a = which === 'to' ? pts[n - 2] ?? pts[0] : pts[1] ?? pts[n - 1];
  const b = which === 'to' ? pts[n - 1] : pts[0];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return { dx: dx / l, dy: dy / l, px: -dy / l, py: dx / l, tip: b };
}

/**
 * Насколько маркер уходит вглубь от острия — на это сдвигается следующий.
 * У маркеров со своим размером это ДЛИНА при текущем коде (§28), поэтому
 * соседние ромб и стрелка не наезжают друг на друга ни на коде 0, ни на 6.
 */
function headExtent(type, size) {
  if (type === 'cross') return 0;
  if (type === 'ball') return 10;
  if (type === 'socket') return 12;
  return headMetrics(type, size)?.len ?? 0;
}

/** Draw every marker of one end, each shifted past the one before it. */
function drawHeads(g, pts, list, which, size = HEAD_SIZE_DEFAULT) {
  let shift = 0;
  for (const type of list) {
    renderHead(g, pts, type, which, shift, size);
    shift += headExtent(type, size);
  }
}

function renderHead(g, pts, type, which, offset = 0, size = HEAD_SIZE_DEFAULT) {
  const { dx, dy, px, py, tip: end } = segOf(pts, which);
  // `v/cco/a#b()`/`#c()`: длина = k[код]·a, ширина = l[код]·b (§28). Код 2 —
  // заводское умолчание — даёт ровно базовые размеры, поэтому связь без
  // сохранённого кода рисуется как раньше, байт в байт.
  const m = headMetrics(type, size);
  // Каждый следующий маркер конца начинается там, где кончился предыдущий:
  // сдвиг идёт по последнему сегменту, поэтому на вертикальном ребре маркеры
  // остаются вертикальными.
  const tip = [end[0] - dx * offset, end[1] - dy * offset];
  const base = (len) => [tip[0] - dx * len, tip[1] - dy * len];
  if (type === 'triangle') {
    const [bx, by] = base(m.len);
    svgEl('polygon', {
      class: 'head-tri',
      points: [
        [tip[0], tip[1]],
        [bx + (px * m.wid) / 2, by + (py * m.wid) / 2],
        [bx - (px * m.wid) / 2, by - (py * m.wid) / 2],
      ].map((p) => p.join(',')).join(' '),
    }, g);
  } else if (type === 'filledTriangle') {
    const [bx, by] = base(m.len);
    svgEl('polygon', {
      class: 'head-fill',
      points: [
        [tip[0], tip[1]],
        [bx + (px * m.wid) / 2, by + (py * m.wid) / 2],
        [bx - (px * m.wid) / 2, by - (py * m.wid) / 2],
      ].map((p) => p.join(',')).join(' '),
    }, g);
  } else if (type === 'open') {
    svgEl('path', {
      class: 'head-open',
      d: `M ${tip[0] - dx * m.len + (px * m.wid) / 2} ${tip[1] - dy * m.len + (py * m.wid) / 2}`
        + ` L ${tip[0]} ${tip[1]}`
        + ` L ${tip[0] - dx * m.len - (px * m.wid) / 2} ${tip[1] - dy * m.len - (py * m.wid) / 2}`,
    }, g);
  } else if (type === 'diamond' || type === 'filledDiamond') {
    const [bx, by] = base(m.len);
    const mx = (tip[0] + bx) / 2;
    const my = (tip[1] + by) / 2;
    svgEl('polygon', {
      class: type === 'diamond' ? 'head-tri' : 'head-fill',
      points: [
        [tip[0], tip[1]],
        [mx + px * (m.wid / 2), my + py * (m.wid / 2)],
        [bx, by],
        [mx - px * (m.wid / 2), my - py * (m.wid / 2)],
      ].map((p) => p.join(',')).join(' '),
    }, g);
  } else if (type === 'cross') {
    const k = 6;
    svgEl('path', {
      class: 'sh-line',
      d: `M ${tip[0] - k} ${tip[1] - k} L ${tip[0] + k} ${tip[1] + k} M ${tip[0] + k} ${tip[1] - k} L ${tip[0] - k} ${tip[1] + k}`,
    }, g);
  } else if (type === 'ball') {
    svgEl('circle', { cx: tip[0] - dx * 5, cy: tip[1] - dy * 5, r: 5, class: 'sh-body' }, g);
  } else if (type === 'socket') {
    svgEl('path', {
      class: 'sh-line',
      d: `M ${tip[0] - dx * 10 - px * 6} ${tip[1] - dy * 10 - py * 6}`
        + ` A 6 6 0 0 1 ${tip[0] - dx * 10 + px * 6} ${tip[1] - dy * 10 + py * 6}`,
    }, g);
  }
}

/* ------------------------------------------------------------- exports */

/** Bounds of everything drawn on the diagram (for the standalone export). */
export function modelBounds(diagram, model, pad = 24) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const s of diagram?.shapes ?? []) {
    const { w, h } = layoutOf(s, elementOf(model, s));
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + w); y1 = Math.max(y1, s.y + h);
  }
  for (const l of diagram?.links ?? []) {
    if (l.y == null) continue;
    y0 = Math.min(y0, l.y - 20); y1 = Math.max(y1, l.y + 20);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 400, h: 300 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/**
 * Границы нарисованного, вместе с тем, что вышло за габариты фигур.
 *
 * `getBBox()` работает только в документе, поэтому `svg` на время измерения
 * ставится в скрытый контейнер. Подложка и служебные слои исключаются: они
 * либо фон, либо взаимодействие, и в габарит содержания не входят.
 *
 * Возвращает `null`, если измерить не удалось — тогда остаются границы по
 * фигурам, как раньше.
 */
function measureInk(svg, fallback) {
  if (typeof document === 'undefined' || !document.body) return null;
  const holder = svgEl('div', {
    'aria-hidden': 'true',
    style: 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden',
  });
  const parent = svg.parentNode;
  const next = svg.nextSibling;
  holder.append(svg);
  document.body.append(holder);
  let box = null;
  try {
    for (const child of svg.children) {
      if (child.tagName === 'style' || child.tagName === 'defs') continue;
      // Подложка — это фон листа, а не содержание.
      if (child === svg.firstElementChild) continue;
      const b = child.getBBox();
      if (!b || (!b.width && !b.height)) continue;
      box = box
        ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y),
            x1: Math.max(box.x1, b.x + b.width), y1: Math.max(box.y1, b.y + b.height) }
        : { x: b.x, y: b.y, x1: b.x + b.width, y1: b.y + b.height };
    }
  } catch { box = null; }
  holder.remove();
  if (parent) parent.insertBefore(svg, next);
  if (!box) return null;
  const pad = 16;
  const w = Math.max(1, box.x1 - box.x);
  const h = Math.max(1, box.y1 - box.y);
  return { x: box.x - pad, y: box.y - pad, w: w + 2 * pad, h: h + 2 * pad, fallback };
}

/**
 * A standalone SVG export of the current diagram: same drawing code, explicit
 * sheet colours and Arial so the file reads the same anywhere offline.
 */
/**
 * The diagram as a PNG, at its own size — one pixel of the sheet per pixel of
 * the file. `scale` multiplies that (2 gives a retina copy); no dependence on
 * the editor's zoom, so an export from a 40 % view is the same file as one
 * from 150 %.
 *
 * Rasterising goes through the SVG the app already produces: the string is
 * loaded as an <img> from a data URL and drawn once onto a canvas. That keeps
 * ONE renderer — whatever exportSvgString draws is what the PNG contains, and
 * a fix there fixes both. The canvas is required for PNG: `toDataURL` of an
 * SVG is not a PNG in any browser.
 *
 * Fonts are the one thing an <img> cannot fetch: Arial is named in the SVG and
 * is present on every target machine, so the text lands without embedding.
 */
export function exportPngBlob(model, profile = null, scale = 1) {
  const svg = exportSvgString(model, profile);
  const box = modelBounds(currentDiagram(model), model);
  const w = Math.max(1, Math.ceil(box.w * scale));
  const h = Math.max(1, Math.ceil(box.h * scale));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      // The SVG already paints its own backdrop; white is the belt to that
      // brace for a viewer that ignori it.
      g.fillStyle = fill();
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve({ blob, width: w, height: h });
        else reject(new Error('canvas.toBlob вернул пусто'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('SVG для PNG не загрузился'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export function exportSvgString(model, profile = null) {
  return exportDiagramSvgString(model, currentDiagram(model), profile);
}

/**
 * SVG ОДНОЙ диаграммы модели — та же отрисовка, что у текущего листа.
 * Экспорт всего проекта зовёт это для каждой диаграммы: один рисунок на
 * файл, один и тот же рендерер, никакой второй реализации.
 */
export function exportDiagramSvgString(model, diagram, profile = null) {
  const b = modelBounds(diagram, model);
  const svg = svgEl('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: Math.ceil(b.w), height: Math.ceil(b.h),
    viewBox: `${b.x} ${b.y} ${b.w} ${b.h}`,
  });
  // Стили и фон добавляются ПОСЛЕ отрисовки: renderDiagram начинается с
  // clear(root) и стирал их — экспорт уходил без <style> и без подложки, а
  // значит и без заливок, обводок и шрифта (в самом приложении классы
  // подхватывал styles.css, поэтому в редакторе это не было видно).
  const style = svgEl('style', {
    text: `text{font-family:Arial,Helvetica,sans-serif;font-size:${NOTATION.meta.fontSize}px;fill:${ink()}}`
      + '.sh-name{font-weight:700;text-anchor:middle;dominant-baseline:middle}'
      + '.sh-name.left{text-anchor:start}.sh-name.small{font-weight:400;font-size:10px}'
      + '.sh-name.underline{text-decoration:underline}'
      + '.sh-name.italic{font-style:italic}'
      + '.sh-row.static{text-decoration:underline}'
      + '.sh-stereo{text-anchor:middle;dominant-baseline:middle}'
      + '.sh-row{dominant-baseline:middle}.sh-note-text{dominant-baseline:middle}'
      + `.sh-body,.sh-tab,.sh-note{fill:${fill()};stroke:${ink()};stroke-width:${lw()};stroke-linecap:butt}`
      + `.sh-body.dash{stroke-dasharray:${DASH}}`
      + `.sh-fill{fill:${ink()};stroke:${ink()};stroke-width:${lw()}}`
      + `.sh-line{fill:none;stroke:${ink()};stroke-width:${lw()};stroke-linecap:butt}`
      + `.sh-dash{fill:none;stroke:${ink()};stroke-width:${lw()};stroke-dasharray:${DASH}}`
      + `.conn{fill:none;stroke:var(--conn-ink,${ink()});stroke-width:${lw()};stroke-linejoin:round;stroke-linecap:butt}`
      + `.conn.dash{stroke-dasharray:${DASH}}`
      + `.head-tri{fill:${fill()};stroke:var(--conn-ink,${ink()});stroke-width:${lw()};stroke-linejoin:round;stroke-linecap:butt}`
      + `.head-fill{fill:var(--conn-ink,${ink()});stroke:var(--conn-ink,${ink()});stroke-width:${lw()};stroke-linejoin:round}`
      + `.head-open{fill:none;stroke:var(--conn-ink,${ink()});stroke-width:${lw()};stroke-linecap:butt}`
      + `.conn-lbl,.conn-multi,.stereo-tag{paint-order:stroke;stroke:${fill()};stroke-width:3.5;stroke-linejoin:round}`
      + '.conn-multi{dominant-baseline:middle}.conn-lbl{dominant-baseline:middle;text-anchor:middle}'
      // These two came from styles.css and were missing here: pictograms
      // paint with `currentColor`, and the click-catcher must stay invisible
      // even if a stray one survives the strip above.
      + `.sh-pict{color:${ink()}}`
      + `.conn-hit{fill:none;stroke:transparent;stroke-width:12}`
      // Подложка хитбокса снимается ниже, но если уцелеет — не должна стать
      // чёрным прямоугольником поверх фигуры.
      + `.sh-hit{fill:transparent;stroke:none}`
      + `.vis-ic{color:${ink()}}`,
  });
  const backdrop = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: fill() });
  renderDiagram(svg, diagram, model, profile, { exporting: true });
  // `modelBounds` считает только габариты фигур и `y` связей. Петля
  // само-сообщения, маршрут, ушедший вбок, подпись под актёром и полоса
  // комментария выходят за эти числа — экспорт их обрезал. Поэтому после
  // отрисовки меряем настоящие чернила: узел на мгновение кладётся в
  // документ (вне его getBBox() пуст) и возвращается обратно.
  // The sheet carries interaction scaffolding that must not reach the file:
  // `.conn-hit` is a 12 px transparent stroke that catches clicks, and with
  // no export rule for it the viewer fell back to `fill: black` — every
  // connector printed as a fat black wedge. Measured on 3.1.2: 19.8 % of the
  // canvas was ink with them, 2.0 % without.
  //
  // Снимаются ДО измерения чернил: подложка хитбокса (`.sh-hit`) — тоже
  // `[data-hit]`, и она шире рисунка актёра (рамка 40×64 против чернил
  // 38×46). Оставленная, она раздула бы габарит экспорта на пустое поле под
  // подписью. getBBox пути не учитывает толщину обводки, поэтому снятие
  // `.conn-hit` до замера границ не меняет.
  for (const n of [...svg.querySelectorAll('.conn-hit, [data-hit]')]) n.remove();
  const bounds = measureInk(svg, b);
  if (bounds) {
    svg.setAttribute('width', Math.ceil(bounds.w));
    svg.setAttribute('height', Math.ceil(bounds.h));
    svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    backdrop.setAttribute('x', bounds.x);
    backdrop.setAttribute('y', bounds.y);
    backdrop.setAttribute('width', bounds.w);
    backdrop.setAttribute('height', bounds.h);
  }
  // Порядок в документе = порядок отрисовки: стили, подложка, фигуры.
  svg.insertBefore(backdrop, svg.firstChild);
  svg.insertBefore(style, svg.firstChild);
  return new XMLSerializer().serializeToString(svg);
}
