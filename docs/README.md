# Документация UML Modeler

Точка входа в документацию. Всё, что описывает продукт, его устройство и проверки,
лежит ниже; файлы, которые читает код или которые генерируются скриптами, остаются
в корне `docs/` — им нельзя переезжать (причины в конце страницы).

Основной обзор продукта — [README.md](../README.md).

---

## Где что искать

| Каталог | Про что | Начать с |
| --- | --- | --- |
| [architecture/](architecture/) | Инварианты слоёв, направление зависимостей, модель против вида | [overview.md](architecture/overview.md) |
| [uml/](uml/) | Правила UML, профиль стереотипов, пиктограммы, карточки нотации | [validation.md](uml/validation.md) |
| [user-guide/](user-guide/) | Как работать в собранном приложении, импорт и экспорт PlantUML | [editing.md](user-guide/editing.md) |
| [research/](research/) | Датированные отчёты и исследования: что мерили, что отвергли, какие были варианты | [CONFORMANCE.md](research/CONFORMANCE.md) |

### architecture/

| Файл | О чём |
| --- | --- |
| [overview.md](architecture/overview.md) | Слои, зависимости, дерево `app/`, что нельзя нарушать; проверки перед сдачей |
| [model-view.md](architecture/model-view.md) | Семантическая модель против представления: три состояния элемента, две команды удаления, дерево, вложенные диаграммы, инспектор |

### uml/

| Файл | О чём |
| --- | --- |
| [validation.md](uml/validation.md) | Как читать панель «Проверки»: поля замечания, «правило молчит», «не проверено N», клик к нарушению |
| [stereotypes.md](uml/stereotypes.md) | Дубли в профиле стереотипов, что говорит стандарт, как это устроено в модели |
| [profile.md](uml/profile.md) | 428 записей → 407 расширений → 304 стереотипа: доказательства и сторож на устаревание |
| [pictograms.md](uml/pictograms.md) | 23 `iconPath` → 23 рисунка этой сборки |
| [notation-cards.md](uml/notation-cards.md) | Корпус 78 карточек нотации: откуда взято каждое поле |

### user-guide/

| Файл | О чём |
| --- | --- |
| [editing.md](user-guide/editing.md) | Формат приложения, меню, команды, три слоя проверок, читалка справочника |
| [import-plantuml.md](user-guide/import-plantuml.md) | Что читается из PlantUML, что теряется (115 / 15 / 39 из 169 конструкций) |
| [export-plantuml.md](user-guide/export-plantuml.md) | Карта соответствия: 14 типов, 51 фигура, 27 связей → PlantUML |

### research/

Ссылки на `material/vision/`, `ux-audit/` и `material/drawio-research/` внутри
отчётов указывают на рабочие файлы, которые перенесены в приватную часть и в
репозиторий не входят: отчёт остаётся датированным свидетельством, а не
навигацией по репозиторию.

Датированные отчёты. Их **не переписывают** под текущее состояние: число «41 правило» в
отчёте от 2026-11-06 — это то, что было измерено тогда, а не ошибка.

| Файл | О чём |
| --- | --- |
| [CONFORMANCE.md](research/CONFORMANCE.md) | 23 пункта «инструмент против UML 2.5.1» по запросам к файлу проекта |
| [REFERENCE.md](research/REFERENCE.md), [REFERENCE-SCOPE.md](research/REFERENCE-SCOPE.md), [REFERENCE-CONTENT.md](research/REFERENCE-CONTENT.md) | Проект справочника UML: объём, контентная база, лицензии |
| [SPEC-RU.md](research/SPEC-RU.md) | Перевод спецификации: словарь 288 терминов, 8 проверок |
| [TUTORIAL-ADAPTATION.md](research/TUTORIAL-ADAPTATION.md) | 90 операций пособия: 35 как есть, 18 иначе, 37 никак |
| [OPEN-UML-COURSE.md](research/OPEN-UML-COURSE.md) | Лицензии открытых курсов UML |
| [DRAWIO-CONNECTORS.md](research/DRAWIO-CONNECTORS.md) | Измерения соединителей: формулы, стратегии маршрутизации, стороны привязки |
| [PLANTUML-GRAMMAR.md](research/PLANTUML-GRAMMAR.md) | Грамматика PlantUML из разбора банка |
| [CORPUS-AUDIT.md](research/CORPUS-AUDIT.md), [CORPUS-VISUAL.md](research/CORPUS-VISUAL.md), [CORPUS-LAYOUT.md](research/CORPUS-LAYOUT.md) | Три прохода по корпусу 48 моделей |
| [VALIDATOR-PLAN.md](research/VALIDATOR-PLAN.md) | План валидатора (исторический: считался при 41 правиле) |
| — | Разбор интерфейса и план починки с замерами «до / после» перенесены в приватную часть: их доказательства — снимки стенда приёмки, которые не публикуются |
| [UX-SCENARIOS.md](research/UX-SCENARIOS.md) | 20 приёмочных сценариев по упражнениям |
| [UX-COURSE-LIBRARY.md](research/UX-COURSE-LIBRARY.md) | Курс и библиотека как режимы приложения |
| [ARCHIFY-PORT.md](research/ARCHIFY-PORT.md) | Перенос геометрических проверок |

---

## Почему часть файлов осталась в корне `docs/`

Эти файлы — не тексты для чтения, а **данные и генераты**. Их путь зашит в код,
в тесты или в строки, которые уезжают в браузер; переезд молча ломает сборку
(справочник, курс, поисковый индекс) или заставляет интерфейс ссылаться на
несуществующий адрес. Поэтому они живут по старым путям, и это осознанное решение,
а не недоделка.

| Файл | Кто его читает или пишет | Что сломается при переезде |
| --- | --- | --- |
| [rules-uml-2.5.1.json](rules-uml-2.5.1.json) | `app/tests/rules.mjs` (тест тождества копий), `tests/rules/check.mjs`, `material/notation-cards/check.mjs` | исчезнет сторож «данные и документация не разъехались» |
| [plantuml-grammar.json](plantuml-grammar.json) | `app/tools/build-reference.mjs`, `app/tests/plantuml-import.mjs`, `material/plantuml-export/check.mjs` | сборка справочника падает, набор импорта краснеет |
| [uml-tutorial.md](uml-tutorial.md) | `material/tutorial-adaptation/build.mjs`, `material/reference-content/build_search_index.py`, `build_crossrefs.py` | рвутся сборка курса, справочник и поисковый индекс |
| [RULES-SOURCE.md](RULES-SOURCE.md) | пишет `material/rules-coverage/build.mjs`, читает `app/tools/build-reference.mjs` | генератор воссоздаст файл на старом месте — появится дубль |
| [RULES-COVERAGE.md](RULES-COVERAGE.md), [RULES-TESTS.md](RULES-TESTS.md) | пишет `material/rules-coverage/build.mjs` | то же: дубль и красный `--check` |
| [DIAGRAM-TYPES.md](DIAGRAM-TYPES.md) | 78 карточек `material/notation-cards/*.json` (поле `sources`) → `app/reference/cards.json` | в интерфейсе появится путь, которого нет |
| [MEASUREMENTS-AUDIT.md](MEASUREMENTS-AUDIT.md) | строки `why` в `app/mechanics.json` → `mechanics.generated.js` | интерфейс будет ссылаться на несуществующий адрес |
| [CORPUS.md](CORPUS.md) | `tests/corpus/README.md`, `app/tests/data/corpus/MANIFEST.json` | потеряется связь корпуса с ожидаемыми моделями |

Правило на будущее: **новый документ кладём в подкаталог; существующий файл,
чей путь встречается в коде или в данных, не двигаем.**

Отдельно про текст стандарта: в репозитории его нет. Локально полная английская
сборка лежит в `app/reference/spec/` (в `.gitignore`), а в поставку `node build.mjs` (без флага; `--with-spec` оставляет текст для локального чтения)
кладёт вариант без прозы — условие (2) лицензии OMG. Русский перевод
(`material/spec-ru/`, `app/reference/spec-ru/`) остаётся и в репозитории, и в
поставке.

---

## Чего здесь пока нет

Честно: нескольких страниц из целевой структуры ещё нет — они появятся, когда
будет что сказать, а не для симметрии.

- `architecture/editing-lifecycle.md` — путь изменения: действие → команда → мутация → история → рендер.
- `architecture/serialization.md` — формат `.uml.json`, миграции, детерминированность.
- `user-guide/getting-started.md` — первый проект по шагам.
- `reference/data-schema.md`, `reference/keyboard-shortcuts.md`.

Пока это описано в [README.md](../README.md), [architecture/overview.md](architecture/overview.md)
и [user-guide/editing.md](user-guide/editing.md).