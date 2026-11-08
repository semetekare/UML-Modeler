// «Сборка» — копия сайта в dist/. Приложение собирается само из себя:
// это немодулированные ES-модули и вендоренный ui-kit, бандлить нечего.
// Копия нужна только проверщику (Craft Anything ищет готовый сайт в dist/,
// build/ или out/). Только встроенные модули Node, никаких зависимостей.
//
// ДВА РЕЖИМА, и различаются они ровно одним каталогом — reference/spec/:
//
//   node build.mjs               поставка БЕЗ ПРОЗЫ стандарта OMG: в
//                                reference/spec остаются номера пунктов,
//                                заголовки, имена констрейнтов и OCL. ЭТОТ
//                                вариант можно показывать и публиковать:
//                                условие (2) лицензии OMG запрещает раздавать
//                                текст стандарта по сети.
//
//   node build.mjs --with-spec   локальная сборка С ПОЛНЫМ английским текстом:
//                                для личного чтения, публиковать нельзя.
//
// Остальные файлы справочника от режима не зависят: попарная сверка двух
// сборок показала, что spec/*.json — единственное расхождение (поисковый
// индекс, карточки, связи и словарь побайтово те же).
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WITH_SPEC = process.argv.includes('--with-spec');
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');

// Всё, что сайт отдаёт браузеру, плюс документация и стартёр; build-обвязка
// (package.json, build.mjs) и рабочие папки (dist, shots) не копируются.
// Build/ копируется обязательно: serve.sh --screenshot зовёт
// Build/uml-modeler, и в dist/ он тоже должен быть на месте.
// course/ — данные панели «Курс» (tools/build-course.mjs) и reference/ —
// снимки пособия, на которые она ссылается: без них урок остаётся без
// картинки и без «Оригинала в пособии».
const SITE = ['index.html', 'src', 'ui-kit', 'material', 'notation', 'profile', 'course', 'reference',
  'serve.sh', 'Build', 'README.md', 'CREDITS.md', 'MECHANICS.md', 'mechanics.json'];
// profile/ — данные профиля стереотипов (304 записи), которые приложение
// читает на старте: tools/build-profile.mjs собирает их из
// material/profile-canonical/profile.json. Без папки в dist/ редактор
// открылся бы с пустым списком стереотипов.

// Лист механики — источник чисел для кода. Здесь он превращается в
// src/mechanics.generated.js, который импортируют theme.js и canvas.js:
// высота тулбара, ширина панелей, высота статусбара, масштаб образца, сетка.
const SHEET_KEYS = {
  'toolbar height': 'toolbarHeight',
  'left panel width': 'leftPanelWidth',
  'right panel width': 'rightPanelWidth',
  'status bar height': 'statusBarHeight',
  'zoom on the sample sheet': 'sampleZoom',
  'grid size': 'gridSize',
  // The program keeps two grid pitches (HorizontalGridSize / VerticalGridSize)
  // and two switches (ShowGrid / AlignToGrid); the build reads the same four
  // fields, so a rectangular grid and a "no snapping" sheet are possible
  // without touching code — v/dap/r#<init>+0x0118/+0x0112/+0x0105/+0x0007.
  'grid width': 'gridWidth',
  'grid height': 'gridHeight',
  'grid visible by default': 'showGrid',
  'align to grid (effective)': 'alignToGrid',
  // Visibility Style is an index into IClassUIModel.VISIBILITY_STYLES
  // ("Icon", "UML", "Off"), so the three codes travel with the value - §16.
  'class visibility style': 'visibilityStyle',
  'visibility style icon': 'visibilityStyleIcon',
  'visibility style uml': 'visibilityStyleUml',
  'visibility style off': 'visibilityStyleOff',
  // «Показывать пустые отделения» — свойство класса (0 как на диаграмме,
  // 1 да, 2 нет), читается из реестра свойств оригинала (§20).
  'show empty compartments: follow diagram': 'emptyCompartmentsFollow',
  'show empty compartments: yes': 'emptyCompartmentsYes',
  'show empty compartments: no': 'emptyCompartmentsNo',
  'show empty compartments: diagram default': 'emptyCompartmentsDefault',
  'default connector style': 'connectorStyle',
  // The six connector styles and the five label orientations are the
  // program's OWN value tables (§22): lib01.jar!v/cni/b#a()V prints
  // "connectorStyle.0 … .5" and "connectorLabelOrientation.0 … .4" as the
  // labels it shows for exactly these numbers.
  'connector style: rectilinear': 'connectorStyleRectilinear',
  'connector style: oblique': 'connectorStyleOblique',
  'connector style: curve': 'connectorStyleCurve',
  'connector style: follow diagram': 'connectorStyleFollowDiagram',
  'connector style: round oblique': 'connectorStyleRoundOblique',
  'connector style: round rectilinear': 'connectorStyleRoundRectilinear',
  'connector style property inherits': 'connectorStyleInherit',
  'label orientation: horizontal only': 'labelOrientationHorizontal',
  'label orientation: horizontal or vertical': 'labelOrientationHorizontalOrVertical',
  'label orientation: follow angle': 'labelOrientationFollowAngle',
  'label orientation: follow angle, keep up right': 'labelOrientationFollowUpright',
  'label orientation: follow diagram': 'labelOrientationFollowDiagram',
  'default label orientation': 'labelOrientation',
  // Пересечения связей (§26). Пять кодов — из таблицы значений самого
  // приложения, размер скачка — из его собственных значков на панели, шаг
  // роста — decision (радиуса в байтах нет, §26c).
  'line jumps: off': 'lineJumpsOff',
  'line jumps: arc': 'lineJumpsArc',
  'line jumps: gap': 'lineJumpsGap',
  'line jumps: square': 'lineJumpsSquare',
  'line jumps: follow diagram': 'lineJumpsFollowDiagram',
  'line jumps property inherits': 'lineJumpsInherit',
  'default line jumps': 'defaultLineJumps',
  'line jump size default': 'lineJumpSizeDefault',
  'line jump size: largest code': 'lineJumpSizeMax',
  'line jump arc: width': 'lineJumpArcWidth',
  'line jump arc: height': 'lineJumpArcHeight',
  'line jump gap: half width': 'lineJumpGapHalf',
  'line jump square: width': 'lineJumpSquareWidth',
  'line jump square: height': 'lineJumpSquareHeight',
  'line jump size step': 'lineJumpSizeStep',
  // The Curve connector and the rounded corners, read out of the router in §27:
  // the spline's sampling step, the nudge that keeps a repeated point apart,
  // and the one cut the program uses for every rounded corner.
  'connector curve sample step': 'connectorCurveStep',
  'connector curve duplicate nudge': 'connectorCurveNudge',
  'connector corner cut': 'connectorCornerCut',
  // Развод параллельных связей (§31): доля стороны между соседними линиями и
  // ближайшее к углу место конца. Оба — решение, а не измерение: в рабочей
  // папке нет ни одного `.vpp` с двумя связями между одной парой, спросить
  // оригинал было не у чего.
  'parallel connector step': 'parallelStep',
  'parallel connector edge margin': 'parallelEdgeMargin',
  'grid colour': 'gridColor',
  'name caption height': 'captionHeight',
  // One line of a name plate: the record stores 14 for a class with no
  // stereotype and 28 with one (MECHANICS §30), so a plate is lines × 14 and
  // carries no padding of its own. The caption model has no constant to copy:
  // its height starts at 0 and is recomputed from the text.
  'caption line height': 'captionLineHeight',
  'note caption side': 'noteCaptionSide',
  'note text inset': 'noteTextInset',
  'note caption width delta': 'noteCaptionWidthDelta',
  'stroke line cap': 'lineCap',
  'multiplicity box offset': 'multiplicityOffset',
  'multiplicity box height': 'multiplicityBoxHeight',
  'lifeline width': 'lifelineWidth',
  'lifeline head height': 'lifelineHead',
  'actor lifeline head height': 'actorLifelineHead',
  'message spacing': 'messageSpacing',
  'lifeline spacing': 'lifelineSpacing',
  'activation width': 'activationWidth',
  // The port square. `v/due/f#a(v.drc.b,v.dvk.i,v.cmo.gj,v.drc.l)` gives a
  // port a 13×13 box when the model carries a position but no size
  // (+0x0202 new Dimension; +0x0206 bipush 13; +0x0208 bipush 13), and
  // `Port` → `v.cnk.ade` in the shape registry (§33).
  'port size': 'portSize',
  'combined fragment caption height': 'fragmentCaption',
  'message caption height': 'messageCaption',
  'interaction actor width': 'interactionActorWidth',
  'part width': 'partWidth',
  // Connector heads and line styles, read out of the painters in §13.
  // The head's size code (0…6) is the arrow's own field, not the diagram's:
  // `v/cco/a` keeps it in `x` and draws `k[x]·a` by `l[x]·b` (§28). Code 2 is
  // the factory default and both tables are 1.0 there, which is why the base
  // sizes above are what a fresh connector shows.
  'arrow head size codes': 'headSizeCodes',
  'arrow head size default': 'headSizeDefault',
  'connector dash pattern': 'dashPattern',
  'connector dash on': 'dashOn',
  'connector dash off': 'dashOff',
  'arrow head hollow length': 'headHollowLength',
  'arrow head hollow width': 'headHollowWidth',
  'arrow head open length': 'headOpenLength',
  'arrow head open width': 'headOpenWidth',
  'arrow head solid length': 'headSolidLength',
  'arrow head solid width': 'headSolidWidth',
  'arrow head diamond length': 'headDiamondLength',
  'arrow head diamond width': 'headDiamondWidth',
  // Sequence spacing ('lifeline spacing' → lifelineSpacing and 'message
  // spacing' → messageSpacing are read by geometry.js too). Both numbers now
  // come from code, not only from a record: v/dal/ak#<init> sets 80 and 30 as
  // the ABSOLUTE distances and leaves the relative ones at 0 (auto), so 80/30
  // are the drawn pitches — §21b.
  // The seed's own numbers. Everything plantuml-layout.js writes now comes from
  // here, so a pitch can only exist in the sheet with its kind next to it:
  // 'code' / 'record' / 'decision' (§21c). A decision is a number the original
  // does not have — the original never places shapes by itself.
  'member row height': 'memberRowHeight',
  // A member compartment is rows × lineHeight + 2 in the original
  // (v/due/f#a(v.dvk.i,v.dvk.i,v.cmo.gj,v.drc.l)+0x0342) — the 2 is the
  // compartment's own padding, not two times the caption's text inset (§32).
  'member compartment padding': 'memberBlockPadding',
  'seed sibling gap': 'seedSiblingGap',
  'seed frame inset': 'seedFrameInset',
  'seed activity step': 'seedActivityStep',
  'seed state step': 'seedStateStep',
  'seed lane width': 'seedLaneWidth',
  'seed sheet width': 'seedSheetWidth',
  'seed sheet height': 'seedSheetHeight',
  'seed wrap width': 'seedWrapWidth',
  // Shape fill, read out of the fill model and its paint factory in §14.
  'fill type solid': 'fillTypeSolid',
  'fill type gradient': 'fillTypeGradient',
  'gradient directions': 'gradientDirections',
  'gradient cyclic': 'gradientCyclic',
};
const sheet = JSON.parse(await readFile(path.join(root, 'mechanics.json'), 'utf8'));
const metrics = {};
const rejected = {};
// A rejected value is kept in mechanics.json (so the refusal is recorded, not
// erased) but it is NOT a metric: nothing may read it as if it were measured.
// Emitting it under MECHANICS would make "78 is used in the code" true by the
// mere presence of the number in a generated file — the false green this whole
// provenance pass exists to remove.
for (const row of sheet.values) {
  const key = SHEET_KEYS[row.name];
  if (!key) continue;
  if (row.rejected) rejected[key] = { value: row.value, why: row.source ?? '' };
  else metrics[key] = row.value;
}
const missing = Object.values(SHEET_KEYS)
  .filter((k) => !(k in metrics) && !(k in rejected));
if (missing.length) {
  console.error(`build: в mechanics.json нет значений для ${missing.join(', ')}`);
  process.exit(1);
}
// The port square is the one shape size the original states in code (§33), so
// the notation file may not hold a number of its own: if the two disagree the
// build stops instead of drawing a port that no address supports.
{
  const notation = JSON.parse(await readFile(path.join(root, 'notation', 'uml.json'), 'utf8'));
  const port = notation?.shapes?.port?.defaultSize;
  if (!port || port.w !== metrics.portSize || port.h !== metrics.portSize) {
    console.error(
      `build: notation/uml.json#shapes.port.defaultSize = ${JSON.stringify(port)}, `
      + `а лист механики говорит ${metrics.portSize}×${metrics.portSize} (§33)`,
    );
    process.exit(1);
  }
}
// The multiplicity label is not offset by a hand-picked number: the record
// places a box `multiplicityARectangle=(-1,-20,39,15)` 20 px above the anchor,
// so the text centre sits at 20 − 15/2 = 12.5 px off the line (MECHANICS §5d).
metrics.multiOffset = metrics.multiplicityOffset - metrics.multiplicityBoxHeight / 2;
await writeFile(
  path.join(root, 'src', 'mechanics.generated.js'),
  '// Сгенерировано build.mjs из mechanics.json — руками не править.\n'
  + '//\n'
  + '// Здесь только те числа из листа механики, которые код действительно\n'
  + '// использует: раскладка окна, сетка и стартовый масштаб листа. Источник\n'
  + '// каждого — app/MECHANICS.md (адрес функции/поля в оригинале).\n'
  + `export const MECHANICS = ${JSON.stringify(metrics, null, 2)};\n`
  + '\n// Rejected in docs/MEASUREMENTS-AUDIT.md: the reference frame shows\n'
  + '// something else. Kept as a record of the refusal; never read as a metric.\n'
  + `export const REJECTED = ${JSON.stringify(rejected, null, 2)};\n`,
);

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const item of SITE) {
  await cp(path.join(root, item), path.join(dist, item), { recursive: true });
}

// Поставка идёт БЕЗ прозы стандарта OMG. Условие (2) лицензии OMG запрещает
// размещать текст в сети, поэтому в dist подставляется вариант
// `--no-full-text`: номера пунктов, заголовки, имена констрейнтов и OCL.
// Локально в app/reference лежит полный текст — он нужен человеку и в
// репозиторий не входит. От варианта зависит ровно один каталог: попарная
// сверка двух сборок показала, что spec/*.json — единственное расхождение,
// остальные файлы справочника (включая поисковый индекс) побайтово те же.
if (WITH_SPEC) {
  // Локальный режим: dist/reference/spec остаётся тем, что скопировано из
  // app/reference, то есть полным текстом. Человеку — можно, публиковать — нет.
  console.log('build: режим --with-spec — в dist полный английский текст; это локальная сборка');
} else try {
  const noText = path.join(dist, '.reference-no-text');
  execFileSync(process.execPath, [
    path.join(root, 'tools', 'build-reference.mjs'),
    '--lang=en', '--no-full-text', `--out=${noText}`, '--quiet',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  await rm(path.join(dist, 'reference', 'spec'), { recursive: true, force: true });
  await cp(path.join(noText, 'spec'), path.join(dist, 'reference', 'spec'), { recursive: true });
  await rm(noText, { recursive: true, force: true });
} catch {
  // Исходников текста нет (например, свежий клон): полка «Спецификация»
  // соберётся без английских статей. Это ожидаемо, а не повод валить сборку.
  console.log('build: текст стандарта не собран — нет исходников; '
    + 'полка «Спецификация» останется без английских статей');
}
if (!WITH_SPEC) console.log('build: режим поставки — в dist прозы стандарта нет');

// Самопроверка: страница на месте и не пустая, счётчик стереотипов в материале профиля.
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!/<script type="module" src="src\/main.js">/.test(html)) {
  console.error('build: dist/index.html не ссылается на src/main.js');
  process.exit(1);
}
const xml = await readFile(path.join(dist, 'material', 'stereotypes.xml'), 'utf8');
const count = (xml.match(/<Stereotype\b/g) || []).length;
if (count !== 428) {
  console.error(`build: в профиле ${count} стереотипов вместо 428`);
  process.exit(1);
}
// Профиль, который читает приложение, — канонический: 304 стереотипа.
// Два числа живут рядом намеренно: 428 — записей в выгрузке профиля, 304 — то,
// что видит человек; пересборка профиля без пересборки сайта не должна
// проходить молча.
const profile = JSON.parse(await readFile(path.join(dist, 'profile', 'stereotypes.json'), 'utf8'));
if (profile?.stereotypes?.length !== 304) {
  console.error(`build: в profile/stereotypes.json ${profile?.stereotypes?.length} стереотипов вместо 304 — `
    + 'запустите node tools/build-profile.mjs');
  process.exit(1);
}
// Курс должен доехать целиком: 20 упражнений и их тексты — иначе панель
// откроется пустой, а сборка об этом не скажет.
const course = JSON.parse(await readFile(path.join(dist, 'course', 'index.json'), 'utf8'));
const exercises = course.chapters.flatMap((c) => c.exercises);
if (exercises.length !== 20) {
  console.error(`build: в курсе ${exercises.length} упражнений вместо 20`);
  process.exit(1);
}
for (const ex of exercises) {
  const text = await stat(path.join(dist, ex.text)).catch(() => null);
  if (!text) {
    console.error(`build: нет текста упражнения ${ex.id} (${ex.text})`);
    process.exit(1);
  }
}
const bytes = (await stat(path.join(dist, 'index.html'))).size;
// The screenshot starter must survive the copy: serve.sh --screenshot runs it.
const starter = await stat(path.join(dist, 'Build', 'uml-modeler')).catch(() => null);
if (!starter) {
  console.error('build: dist/Build/uml-modeler отсутствует — снимок экрана не заработает');
  process.exit(1);
}
console.log(`build готов: dist/ — копия сайта (${SITE.length} позиций, index.html ${bytes} Б, `
  + `стереотипов 304 из 428 записей профиля)`);
