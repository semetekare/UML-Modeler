# archify 3.0.1 — перенесённые проверки геометрии

Копия части проекта **archify 3.0.1** (JSON-IR рендереры диаграмм, лицензия MIT,
`renderers/shared/geometry.mjs` и соседи) внутрь visual-paradigm. Здесь лежат
только те файлы, которые нужны проверкам раскладки: пересечения рамок, влезает
ли имя в фигуру, читаем ли текст при вписывании листа в окно.

Это не зависимость: пакетов нет, `package.json` не менялся, рантайм-зависимостей
по-прежнему ноль. Это скопированный исходник под MIT с сохранённым копирайтом
(см. `LICENSE`, `THIRD_PARTY_NOTICES.md`). Удалить папку — значит откатить всё:
ничего в `src/` её пока не импортирует.

## Что скопировано

Полный снимок исходников лежит рядом с проектом:
`~/Документы/Craft Anything/archify-3.0.1-source` (314 файлов, 11 МБ) —
на случай, если понадобится ещё что-то, и потому что оригинал жил в каталоге
pnpm-tmp, который pnpm вправе вычистить.

Внутри папки — 10 файлов archify, 235 КБ, с сохранением путей:

| файл | зачем |
|---|---|
| `renderers/shared/geometry.mjs` (84 КБ) | `rectsOverlap`, `segmentIntersectsRect`, `cleanCrossingProblems`, `collectArrowheadCollisions`, `collectAmbiguousCorridors`, `cleanLabelCanvasContainmentProblems` |
| `renderers/shared/route-quality.mjs` (24 КБ) | `shortestOrthogonalGridRoute`, `cleanRouteDetourProblems` |
| `renderers/shared/text-fit.mjs` (5 КБ) | `fittedNodeFontSize`, `minimumNodeTextWidth`, `availableNodeTextWidth` |
| `renderers/shared/desktop-readability.mjs` (7 КБ) | `projectedNodeTextPx`, `minimumReadableSourceTextPx` |
| `renderers/architecture/routing.mjs` (55 КБ) | ортогональный маршрутизатор с ценой пересечения и портами |
| `renderers/shared/utils.mjs` (13 КБ) | `textUnits` — приближение ширины текста |
| `renderers/shared/i18n.mjs` (43 КБ) | нужен `utils.mjs`; статический каталог строк |
| `renderers/shared/spatial-grid.mjs`, `layout-report.mjs` (3,5 КБ) | вспомогательные для маршрутизации |
| `renderers/shared/diagnostics.mjs` | **замена** (см. ниже), оригинал рядом: `diagnostics.node.mjs` |

Пути сохранены один в один, поэтому относительные импорты внутри archify не
переписаны: `renderers/architecture/routing.mjs` по-прежнему видит
`../shared/geometry.mjs`.

## Две правки относительно upstream

Обе записаны в `UPSTREAM.json` вместе с sha256 «до» и «после».

1. `renderers/shared/diagnostics.mjs` заменён браузерной версией. Оригинал на
   первой строке делает `import fs from 'node:fs'` и `import path from
   'node:path'` — в браузере таких модулей нет, и не загрузился бы весь граф.
   fs/path нужны оригиналу только для CLI-отчёта о сбое рендера. Замена держит
   ту же поверхность (все шесть экспортов) и копит диагностику в памяти:
   `takeDiagnostics()` отдаёт её мосту.
2. В `geometry.mjs` одна строка: `process.env.ARCHIFY_QUALITY_PROFILE` закрыт
   `typeof process !== 'undefined'`. Без этого в браузере `ReferenceError` в
   шести местах — там, где проверка выбирает строгость (`showcase` / `standard`).

## Свои файлы (не archify)

- `geometry-adapter.mjs` — мост: модель (`diagrams[].shapes[] = {x, y, w, h}`) →
  замечания в форме `src/rules/finding.js` (`ruleId`, `level`, `basis`,
  `message`, `detail`, `hint`, `targets`, `diagramId`), `basis: 'geometry'`.
  Три проверки: `geometry-shapes-overlap`, `geometry-text-does-not-fit`,
  `geometry-text-too-small`.
- `selftest.mjs` — самопроверка: `node app/src/vendor/archify/selftest.mjs`.
  Гоняет скопированные функции на прямых входах и мост — на
  `app/material/demo-errors.json`.

## Как это подключено к панели «Проверки»

Слой подключён четвёртым разделом; ниже — что именно сделано, чтобы это можно
было снять или пересмотреть, не разыскивая по файлам.

1. `src/rules/finding.js`: `basisOf` знает `geometry`; замечания слоя идут в
   свой счётчик `countByLevel().layout` и НЕ попадают в `errors`/`warnings`/
   `total`. Причина: цифры стандарта люди сверяют годами — они не должны
   шевелиться от того, что лист перерисовали.
2. `src/ui/checks.js`: `checkResult()` прогоняет `geometryFindings` вместе с
   движком правил, четвёртый раздел `#checks-geometry` («Геометрия листа») с
   чипом `chip-geometry` «раскладка», свой хвост статусбара `· раскладка N` и
   `showGeometry` для карточки. Сбой моста показывается записью `geometry-pass`
   в разделе сбоев, а не прячется.
3. Клик от замечания к фигуре работает по `targets` + `diagramId` — правок не
   потребовалось.
4. Текст меряется настоящим `textWidth` из `model/geometry.js`, а не
   приближением archify: на корпусе приближение давало 11 ложных «не влезает».

Вложенность наложением не считается: у пары фигур проверяется владение
(`ownerId`, транзитивно) и полное вложение в фигуру-классификатор. Без этого
контрольная `component-nested-in-class.ok.json` давала 2 ложных замечания, а
`demo-errors.json` — 3: компонент внутри своего класса и заметка внутри
компонента это норма UML (§9.2), а не дефект раскладки.

## Что проверено (и что нет)

Запуск `selftest.mjs` на `material/demo-errors.json` (106 элементов, 95 связей,
9 листов): замечаний 0 — и это верно: всё, что похоже на наложение, нарисовано
вложенным по владению. Скопированные функции отвечают: `rectsOverlap` →
true/false как ожидалось, `shortestOrthogonalGridRoute` строит маршрут из 6
точек в обход препятствия. Настоящее наложение ловит фикстура
`tests/data/geometry/overlap-unrelated.json` (1 замечание с целями `e1,e2`), а
ложных на вложенности — 0 на `tests/data/rules/component-nested-in-class.ok.json`.
Без `notation` появляется ложное «имя не влезает» у актёра «Преподаватель»: имя
нарисовано ПОД фигурой, а не в её рамке — поэтому нотацию надо передавать
всегда.

Калибровка на 48 разложенных учебных моделях (`material/corpus-layout`, здоровые
листы): пересечений рамок — 0 (после того как перестали считать налезание рамки
фрагмента на линию жизни ошибкой: на листах взаимодействия это норма). Имён,
которые не влезают, — 11 из 48 листов, и все они на границе: 224 px нужно против
222 px в рамке. Это цена приближения `textUnits` (0,6 px на единицу на 1 px
кегля) — настоящее `measureText` даёт на 5–8 % меньше для кириллицы. Отсюда
правило: в браузере мерить настоящим `textWidth`, иначе проверка шумит на 1 %.

Листов, которые при вписывании в окно 960 px дают кегль меньше 6 px, — 5 из 48
(ширина 1760–2020 px). Это не ложные срабатывания, а настоящий факт о широких
листах; порог 6 px взят из archify и под наш лист не калибровался.

Проверено и в браузере: `tests/geometry-panel.mjs` поднимает headless-Chromium,
открывает панель и сверяет раздел, счётчик, чип, клик к фигуре и фильтр
«только ошибки» (26 проверок). Панель работает на настоящем `measureText`.

## Чего здесь нет и почему

- `renderers/shared/atomic-output.mjs`, `delivery-lock`, `provenance` — запись
  файлов на диск из CLI; в браузере нечего защищать.
- `brand-marks.mjs` (27 КБ + 164 КБ сгенерированных логотипов) — иконки вендоров.
- `generated-validators.mjs` (531 КБ) — валидаторы JSON Schema для IR archify.
- `repository-evidence.mjs`, `output-path.mjs`, `cli.mjs`, `recipes` — CLI.
- `i18n` как переводы интерфейса: файл скопирован только потому, что его
  импортирует `utils.mjs`; строки вьюера archify не используются.

## Обновление до новой версии archify

Взять снимок, сравнить `sha256` из `UPSTREAM.json`, скопировать те же десять
путей, повторить две правки (диагностика, `process.env`) и прогнать
`selftest.mjs`. Если `geometry.mjs` вырос в зависимостях — проверить импорты
`node:` тем же поиском, что описан в отчёте (`grep -rn "node:" renderers`).
