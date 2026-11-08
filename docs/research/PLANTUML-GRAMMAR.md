# PlantUML: грамматика, извлечённая из jar

Документ собран **из байткода** `plantuml.jar`, а не из документации и не по памяти.
Каждый шаблон ниже — строка, реально лежащая в классе; полные шаблоны без обрезки — в
[plantuml-grammar.json](../plantuml-grammar.json).

## 1. Источник и версия

| Параметр | Значение |
|---|---|
| Файл | `~/.vscode-oss/extensions/jebbs.plantuml-2.18.1-universal/plantuml.jar` |
| Размер | 8 124 689 байт |
| Версия | **1.2021.00** (в задаче указана как 1.2021.0) |
| Дата сборки | Sun Jan 10 17:25:05 NOVT 2021 |
| JVM | OpenJDK 17.0.20.1 |

Проверка версии:

```sh
java -jar plantuml.jar -version
# PlantUML version 1.2021.00 (Sun Jan 10 17:25:05 NOVT 2021)
```

## 2. Как извлекалось

Первое, что выяснилось: **констант `PATTERN`, передаваемых в `Pattern.compile`, в командных
классах нет.** Начиная с этой ветки PlantUML собирает регулярки композиционно, из DSL
`net.sourceforge.plantuml.command.regex`:

- `RegexLeaf(name, pattern)` — именованная группа;
- `RegexConcat` / `RegexOr` / `RegexOptional` — узлы композиции;
- `IRegex.getPattern()` — метод, возвращающий **итоговую** строку регулярного выражения.

Поэтому вместо `strings` по классу был написан Java-экстрактор, который через рефлексию
создаёт каждый командный объект, достаёт поле `pattern` (тип `IRegex`) и вызывает
`getPattern()`. Это даёт ту же строку, которую PlantUML сам компилирует, — без ручной
реконструкции и без ошибок экранирования.

Для классов, чей шаблон зависит от аргумента конструктора (`CommandLinkClass(UmlDiagramType)`,
`CommandCreateElementFull2(Mode)`, `CommandCreateElementMultilines(int)`), экземпляр создавался
для каждого значения аргумента. Для шаблонов, собираемых фабриками (`note ...`), вызывались
`createSingleLine()` / `createMultiLine()` соответствующих фабрик.

### Замена плейсхолдеров

`RegexLeaf` подставляет в шаблоны два макроса; в извлечённых строках они уже раскрыты:

| Макрос | Во что раскрывается |
|---|---|
| `%s` | `[\s\u00A0]` — пробел **и неразрывный пробел** |
| `%g` | `["“”«»]` — прямые кавычки и три вида типографских |

Это важное практическое следствие для парсера: PlantUML принимает `U+00A0` там, где ждёт
пробел, и четыре разных вида кавычек.

## 3. Число классов по типам диаграмм

| Диаграмма | Пакет | Файлов `.class` | Реализуют `Command` | Конструкций описано |
|---|---|---|---|---|
| Class-диаграммы | `classdiagram/command` | 21 | 17 | 55 |
| Sequence-диаграммы | `sequencediagram/command` | 34 | 34 | 42 |
| Activity-диаграммы (новый движок, activitydiagram3) | `activitydiagram3/command` | 45 | 45 | 46 |
| Use Case (descdiagram) | `descdiagram/command` | 11 | 8 | 13 |
| State-диаграммы | `statediagram/command` | 7 | 7 | 13 |

Ожидания из задания совпали точно: 21 / 34 / 45 / 11. Пакет `statediagram/command`
(в задании не был указан) содержит 7 файлов. Разница «файлов» и «команд» — это вложенные
`enum Mode`, `$1`-анонимные классы и интерфейс `GenericRegexProducer`, которые не являются
командами.

## 4. Таблицы конструкций

В колонке «шаблон» — точная извлечённая строка, обрезанная по 100 символов для читаемости;
полная версия — в JSON. Если шаблон не помещается, он приведён целиком в разделе 5.

Символ `|` внутри шаблонов в таблицах экранирован как `\|` — это требование Markdown,
а не часть регулярного выражения. Неэкранированные строки — в JSON и в разделе 5.

### 4.1. Class-диаграммы

| конструкция | пример синтаксиса | командный класс | шаблон | что разбирает |
|---|---|---|---|---|
| `class-decl` | `class Foo` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Ключевое слово типа — альтернатива из 8 вариантов. |
| `class-abstract` | `abstract class Foo` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-interface` | `interface IFoo` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-enum` | `enum Color` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-annotation` | `annotation Ann` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Только в CommandCreateClass, в multilines-варианте отсутствует. |
| `class-entity-circle-diamond` | `entity E / circle C / diamond D` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Три дополнительных ключевых слова. |
| `class-generic` | `class Foo<T>` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Вложенность дженериков до 6 уровней, реализована ручной рекурсией. |
| `class-as` | `class Foo as "F"` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Четыре взаимоисключающие ветви: id as "display", "display" as id, id, "display". |
| `class-stereotype` | `class Foo <<entity>>` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Стереотип в конце строки, группа 5. |
| `class-color` | `class Foo #red` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Полная грамматика цвета/стиля: #color, #color;line.bold и т.п. |
| `class-link-url` | `class Foo [[http://x]]` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-spot` | `class Foo $tag1 $tag2` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element. Споты: $name, через пробел. |
| `class-extends` | `class Foo extends Bar` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-implements` | `class Foo implements IBar` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-empty-body` | `class Foo {}` | `CommandCreateClass` | `^(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity\|circle\|diamond)[\s ]+(?:["“”«» …` | element |
| `class-body-open` | `class Foo {` | `CommandCreateClassMultilines` | `^([-#+~])?(interface\|enum\|abstract[\s ]+class\|abstract\|class\|entity)[\s ]+(?:["“”«»](.+?)(?:\<([^\<\ …` | element. Открывает многострочное тело; закрывается командой end-package (}). |
| `member-attribute` | `+name : String` | `Member` | — (см. 6) | member. Своего шаблона нет: видимость читается первым символом процедурно. Извлекаемая часть — снятие маркеров и url-суффикса. |
| `member-operation` | `+getName() : String` | `Member` | — (см. 6) | member. Своего шаблона нет: разбор процедурный. |
| `member-static` | `{static} +count : int` | `Member.stripStaticAbstract` | `(?i)\{(static\|classifier\|abstract)\}\s*` | member. Модификатор снимается регуляркой (?i)\{(static\|classifier\|abstract)\}\s*. |
| `member-abstract` | `{abstract} +run() : void` | `Member.stripStaticAbstract` | `(?i)\{(static\|classifier\|abstract)\}\s*` | member. Та же регулярка, что и для {static}. |
| `member-field-method-marker` | `{field} -x : int` | `Member.stripFieldMethod` | `(?i)\{(method\|field)\}\s*` | member. Маркер {field}/{method} снимается отдельной регуляркой (?i)\{(method\|field)\}\s*. |
| `member-visibility` | `-x / +x / #x / ~x / *x` | `Member` | — (см. 6) | member. Один символ, проверяется процедурно: - private, + public, # protected, ~ package, * mandatory. |
| `assoc` | `A -- B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link. Тело связи — [-=.]+; декораторы слева и справа отдельными группами. |
| `assoc-directed` | `A --> B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link |
| `assoc-composition` | `A *-- B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link. Декоратор * в левой группе. |
| `assoc-aggregation` | `A o-- B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link |
| `assoc-dependency` | `A ..> B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link. Пунктир — точка в теле связи, стрелка > в правой группе. |
| `generalization` | `A --\|> B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link |
| `realization` | `A ..\|> B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link |
| `assoc-multiplicity` | `A "1" -- "0..*" B : contains` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link. Кратность и роль — две отдельные группы-кавычки по обе стороны связи. |
| `assoc-label` | `A -- B : label` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link |
| `assoc-cardinality-online` | `A "1" -- "n" B` | `CommandLinkClass[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:((?:\.\|::\|\\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.\|::\|\\\|\\\\)[\p{L}0-9_$]+)*\|["“”«»][ …` | link |
| `package` | `package Foo {` | `CommandPackage` | `^(package)[\s ]+(["“”«»][^"“”«»]+["“”«»]\|[^#\s {}]*)(?:[\s ]+as[\s ]+([\p{L}0-9_.]+))?[\s ]*(\<\<.*\ …` | namespace |
| `package-empty` | `package Foo {}` | `CommandPackageEmpty` | `^package[\s ]+(["“”«»][^"“”«»]+["“”«»]\|[^#\s {}]*)(?:[\s ]+as[\s ]+([\p{L}0-9_.]+))?[\s ]*(#[0-9a-fA …` | namespace |
| `package-as` | `package "Long" as P {` | `CommandPackage` | `^(package)[\s ]+(["“”«»][^"“”«»]+["“”«»]\|[^#\s {}]*)(?:[\s ]+as[\s ]+([\p{L}0-9_.]+))?[\s ]*(\<\<.*\ …` | namespace |
| `namespace` | `namespace com.foo {` | `CommandNamespace` | `^namespace[\s ]+([\p{L}0-9_][-\p{L}0-9_.:\\]*)[\s ]*(\<\<.*\>\>)?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»] …` | namespace. Обязателен завершающий {. |
| `namespace-as` | `namespace "N" as com.foo {` | `CommandNamespace2` | `^namespace[\s ]+["“”«»]([^"“”«»]+)["“”«»][\s ]+as[\s ]+([\p{L}0-9_][-\p{L}0-9_.:\\]*)[\s ]*(\<\<.*\> …` | namespace |
| `namespace-empty` | `namespace com.foo {}` | `CommandNamespaceEmpty` | `^namespace[\s ]+([\p{L}0-9_][-\p{L}0-9_.:\\]*)[\s ]*(\<\<.*\>\>)?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»] …` | namespace |
| `block-end` | `}` | `CommandEndPackage` | `^\}$` | namespace. Закрывает пакет/класс. |
| `note-on-entity` | `note right of Foo : text` | `CommandFactoryNoteOnEntity.createSingleLine` | `^note[\s ]+(right\|left\|top\|bottom)(?:[\s ]+of[\s ]+([^\s {}"“”«»<>]+\|["“”«»][^"“”«»]+["“”«»])\|)[\s ] …` | note. Собрана фабрикой из RegexLeaf-частей; извлечена вызовом createSingleLine(). |
| `note-standalone` | `note "text" as N1` | `CommandFactoryNote.createSingleLine` | `^note[\s ]+["“”«»]([^"“”«»]+)["“”«»][\s ]+as[\s ]+([\p{L}0-9_.]+)[\s ]*((\$[^\s {}"“”«»<>$]+)([\s ]+ …` | note |
| `note-on-link` | `note on link : text` | `CommandFactoryNoteOnLink.createSingleLine` | `^note[\s ]+(right\|left\|top\|bottom)?[\s ]*o[nf][\s ]+link[\s ]*((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|ba …` | note |
| `stereotype-command` | `Foo <<entity>>` | `CommandStereotype` | `^([\p{L}0-9_.]+\|["“”«»][^"“”«»]+["“”«»])[\s ]*(\<\<.*\>\>)$` | element. Добавляет стереотип к уже объявленному элементу. |
| `hide-show-members` | `hide members` | `CommandHideShow2` | `^(hide\|hide-class\|show\|show-class)[\s ]+([^\s ]+\|\<\<.*\>\>)$` | directive |
| `hide-show-gender` | `hide empty members` | `CommandHideShowByGender` | `^(hide\|show)[\s ]+(?:(class\|object\|interface\|enum\|annotation\|abstract\|[\p{L}0-9_.]+\|["“”«»][^"“”«»]+ …` | directive. empty + members\|attributes\|fields\|methods\|circles\|stereotypes. |
| `hide-show-visibility` | `hide private members` | `CommandHideShowByVisibility` | `^(hide\|show)[\s ]+((?:public\|private\|protected\|package)?(?:[,\s ]+(?:public\|private\|protected\|packag …` | directive |
| `hide-show-class` | `hide Foo` | `CommandHideShowSpecificClass` | `^(hide\|show)[\s ]+([^\s {}"“”«»<>]+)$` | directive |
| `url` | `url of Foo is [[http://x]]` | `CommandUrl` | `^url[\s ]*(?:of\|for)?[\s ]+([\p{L}0-9_.@]+\|["“”«»][^"“”«»]+["“”«»])[\s ]+(?:is)?[\s ]*(\[\[(["“”«»][ …` | directive |
| `lollipop` | `Foo --() Bar` | `CommandLinkLollipop[CLASS]` | `^(?:@([\d.]+)[\s ]+)?(?:(interface\|enum\|annotation\|abstract[\s ]+class\|abstract\|class\|entity)[\s ]+) …` | link. Разные шаблоны для CLASS и OBJECT; для прочих типов диаграмм — заглушка. |
| `diamond` | `<> Foo` | `CommandDiamondAssociation` | `^\<\>[\s ]*([\p{L}0-9_.]+)$` | element |
| `remove-restore` | `remove Foo` | `CommandRemoveRestore` | `^(remove\|restore)[\s ]+(.+)$` | directive |
| `namespace-separator` | `set separator ::` | `CommandNamespaceSeparator` | `^set[\s ]+(?:separator\|namespaceseparator)[\s ]+(\S+)$` | directive |
| `allow-mixing` | `allow_mixing` | `CommandAllowMixing` | `^allow_?mixing$` | directive |
| `layout-new-line` | `layout_new_line` | `CommandLayoutNewLine` | `^layout_new_line$` | directive |
| `add-member-by-name` | `Foo : +bar()` | `CommandAddMethod` | `^([\p{L}0-9_.]+\|["“”«»][^"“”«»]+["“”«»])[\s ]+:[\s ]+(.*)$` | member. Добавляет член к уже существующему классу по имени. |

### 4.2. Sequence-диаграммы

| конструкция | пример синтаксиса | командный класс | шаблон | что разбирает |
|---|---|---|---|---|
| `participant` | `participant Alice` | `CommandParticipantA` | `^(?:(participant\|actor\|create\|boundary\|control\|entity\|queue\|database\|collections)\|create[\s ](partic …` | participant. Тип: participant\|actor\|boundary\|control\|entity\|queue\|database\|collections. |
| `participant-actor` | `actor Bob` | `CommandParticipantA` | `^(?:(participant\|actor\|create\|boundary\|control\|entity\|queue\|database\|collections)\|create[\s ](partic …` | participant |
| `participant-as-display` | `participant A as "Alice"` | `CommandParticipantA2` | `^(?:(participant\|actor\|create\|boundary\|control\|entity\|queue\|database\|collections)\|create[\s ](partic …` | participant |
| `participant-as-id` | `participant Alice as A` | `CommandParticipantA3` | `^(?:(participant\|actor\|create\|boundary\|control\|entity\|queue\|database\|collections)\|create[\s ](partic …` | participant. Форма id as display; обратная форма — CommandParticipantA2. |
| `participant-display-only` | `participant "Alice"` | `CommandParticipantA4` | `^(?:(participant\|actor\|create\|boundary\|control\|entity\|queue\|database\|collections)\|create[\s ](partic …` | participant |
| `participant-order` | `participant A order 10` | `CommandParticipantA` | `^(?:(participant\|actor\|create\|boundary\|control\|entity\|queue\|database\|collections)\|create[\s ](partic …` | participant. order + целое до 7 цифр, может быть отрицательным. |
| `message` | `Alice -> Bob : hello` | `CommandArrow` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?(([\p{L}0-9_.@]+)\|["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+) …` | message. Самая большая команда: оба конца с 4 вариантами записи, декораторы, длина, цвет, якорь, url. |
| `message-dotted` | `Alice --> Bob : hi` | `CommandArrow` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?(([\p{L}0-9_.@]+)\|["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+) …` | message |
| `message-return` | `Bob --> Alice : hi` | `CommandArrow` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?(([\p{L}0-9_.@]+)\|["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+) …` | message |
| `message-color` | `Alice -[#red]-> Bob : x` | `CommandArrow` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?(([\p{L}0-9_.@]+)\|["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+) …` | message. Цвет/стиль линии в [ ... ]. |
| `message-anchor` | `{a} Alice -> Bob : x` | `CommandArrow` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?(([\p{L}0-9_.@]+)\|["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+) …` | message. Якорь {name} ставится перед участником, не вокруг стрелки. |
| `exo-arrow-left` | `[-> Alice : hi` | `CommandExoArrowLeft` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?([?\[\]][ox]?)?(?:(<<?\|//?\|\\\\?)?(-+)(?:\[((?:#\w+\|dotted\|das …` | message. Внешняя стрелка: участник только с одной стороны. |
| `exo-arrow-right` | `Alice ->] : hi` | `CommandExoArrowRight` | `^(&[\s ]*)?(\{([\p{L}0-9_]+)\}[\s ]+)?([\p{L}0-9_.@]+\|["“”«»][^"“”«»]+["“”«»])[\s ]*([\s ]+[ox])?(?: …` | message |
| `activate` | `activate Alice` | `CommandActivate` | `^(activate\|deactivate\|destroy\|create)[\s ]+([\p{L}0-9_.@]+\|["“”«»][^"“”«»]+["“”«»])[\s ]*(#\w+)?(?:[ …` | lifecycle. activate\|deactivate\|destroy\|create + имя. |
| `deactivate-short` | `deactivate` | `CommandDeactivateShort` | `^deactivate[\s ]*$` | lifecycle |
| `activate-shorthand` | `Alice++ / Alice--` | `CommandActivate2` | `^([\p{L}0-9_.@]+)[\s ]*(\+\+\|--)[\s ]*(#\w+)?$` | lifecycle |
| `return` | `return text` | `CommandReturn` | `^(&[\s ]*)?[\s ]*return[\s ]*(?:(#\w+)[\s ]+)?(.*)$` | message |
| `grouping-alt` | `alt ok` | `CommandGrouping` | `^(&[\s ]*)?(opt\|alt\|loop\|par\|par2\|break\|critical\|else\|end\|also\|group)((?<!else)(?<!also)(?<!end)#\w+ …` | fragment. opt\|alt\|loop\|par\|par2\|break\|critical\|else\|end\|also\|group. |
| `grouping-end` | `end` | `CommandGrouping` | `^(&[\s ]*)?(opt\|alt\|loop\|par\|par2\|break\|critical\|else\|end\|also\|group)((?<!else)(?<!also)(?<!end)#\w+ …` | fragment |
| `note-right` | `note right of Alice : t` | `FactorySequenceNoteCommand.createSingleLine` | `^(&[\s ]*)?(/)?[\s ]*(note\|hnote\|rnote)[\s ]*(\<{2}.*\>{2})?[\s ]*(right\|left\|over)[\s ]+(?:of[\s ]) …` | note. note\|hnote\|rnote, позиция right\|left\|over. |
| `note-over-several` | `note over A, B : t` | `FactorySequenceNoteOverSeveralCommand.createSingleLine` | `^(&[\s ]*)?(/)?[\s ]*(note\|hnote\|rnote)[\s ]*(\<{2}.*\>{2})?[\s ]*over[\s ]+([\p{L}0-9_.@]+\|["“”«»][ …` | note |
| `note-across` | `note across : t` | `FactorySequenceNoteAcrossCommand.createSingleLine` | `^(/)?[\s ]*(note\|hnote\|rnote)[\s ]*(\<{2}.*\>{2})?[\s ]*(accross\|across)[\s ]*((?:#(?:\w+[-\\\|/]?\w+ …` | note. Опечатка accross поддерживается намеренно. |
| `note-on-arrow` | `note right : t` | `FactorySequenceNoteOnArrowCommand.createSingleLine` | `^[\s ]*(note\|hnote\|rnote)[\s ]*(\<{2}.*\>{2})?[\s ]+(right\|left\|bottom\|top)[\s ]*((?:#(?:\w+[-\\\|/]? …` | note |
| `autonumber` | `autonumber` | `CommandAutonumber` | `^autonumber[\s ]*(\d(?:(?:[^\p{L}0-9\s ]+\|\d+)*\d)?)?(?:[\s ]+(\d+))?(?:[\s ]+["“”«»]([^"“”«»]+)["“” …` | directive |
| `autonumber-increment` | `autonumber inc A` | `CommandAutonumberIncrement` | `^autonumber[\s ]+inc(?:[\s ]+([A-Za-z]))?[\s ]*$` | directive |
| `autonumber-resume` | `autonumber resume` | `CommandAutonumberResume` | `^autonumber[\s ]+resume[\s ]*(?:[\s ]+(\d+))?(?:[\s ]+["“”«»]([^"“”«»]+)["“”«»])?$` | directive |
| `autonumber-stop` | `autonumber stop` | `CommandAutonumberStop` | `^autonumber[\s ]+stop[\s ]*$` | directive |
| `autoactivate` | `autoactivate on` | `CommandAutoactivate` | `^autoactivate[\s ]+(off\|on)$` | directive |
| `box` | `box "G"` | `CommandBoxStart` | `^box(?:(?:[\s ]+["“”«»]([^"“”«»]+)["“”«»]\|[\s ]+([^#]+)))?[\s ]*(\<\<.*\>\>)?((?:#(?:\w+[-\\\|/]?\w+; …` | group |
| `box-end` | `end box` | `CommandBoxEnd` | `^end[\s ]*box$` | group |
| `divider` | `== Phase ==` | `CommandDivider` | `^==[\s ]*(.*)[\s ]*==$` | separator |
| `delay` | `...` | `CommandDelay` | `^(?:\.{3}\|…)(?:(.*)(?:\.{3}\|…))?$` | separator. Поддерживается и символ … (U+2026). |
| `ref-over` | `ref over A, B : t` | `CommandReferenceOverSeveral` | `^ref(#\w+)?[\s ]+over[\s ]+(([\p{L}0-9_.@]+\|["“”«»][^"“”«»]+["“”«»])([\s ]*,[\s ]*([\p{L}0-9_.@]+\|[" …` | fragment |
| `newpage` | `newpage` | `CommandNewpage` | `^@?newpage(?:(?:[\s ]*:[\s ]*\|[\s ]+)(.*[\p{L}0-9_.].*))?$` | directive |
| `autonewpage` | `autonewpage 5` | `CommandAutoNewpage` | `^autonewpage[\s ]+(\d+)$` | directive |
| `ignore-newpage` | `ignore newpage` | `CommandIgnoreNewpage` | `^ignore[\s ]*newpage$` | directive |
| `footbox` | `hide footbox` | `CommandFootbox` | `^(hide\|show)?[\s ]*footbox$` | directive |
| `footbox-old` | `footbox on` | `CommandFootboxOld` | `^footbox[\s ]*(on\|off)?[\s ]*$` | directive |
| `skin` | `skin rose` | `CommandSkin` | `^skin[\s ]+([\w.]+)$` | directive |
| `url` | `url of Alice is [[http://x]]` | `CommandUrl` | `^url[\s ]*(?:of\|for)?[\s ]+([\p{L}0-9_.@]+\|["“”«»][^"“”«»]+["“”«»])[\s ]+(?:is)?[\s ]*(\[\[(["“”«»][ …` | directive |
| `hspace` | `\|\|\|` | `CommandHSpace` | `^\\|\\|(\d+)?\\|+$` | separator |
| `link-anchor` | `{a} <-> {b}` | `CommandLinkAnchor` | `^\{([\p{L}0-9_]+)\}[\s ]*\<-\>[\s ]*\{([\p{L}0-9_]+)\}[\s ]*(?::[\s ]*(.*))?$` | directive |

### 4.3. Activity-диаграммы (новый движок, activitydiagram3)

| конструкция | пример синтаксиса | командный класс | шаблон | что разбирает |
|---|---|---|---|---|
| `start` | `start` | `CommandStart3` | `^start;?$` | node. Точка входа. |
| `stop` | `stop` | `CommandStop3` | `^stop;?$` | node |
| `end` | `end` | `CommandEnd3` | `^end;?$` | node |
| `kill` | `kill / detach` | `CommandKill3` | `^kill\|detach;?$` | node |
| `action` | `:Do work;` | `CommandActivity3` | `^(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line …` | action. Терминатор ; или \\ или один из символов / < } ] > \| (с lookbehind-защитой от разметки). |
| `action-long` | `:Do work` | `CommandActivityLong3` | `^((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|line\.dashed\|line\.dotted\|line\.bold\|shadowing …` | action. Длинная форма без терминатора — до конца строки. |
| `action-color` | `#red :Do work;` | `CommandActivity3` | `^(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line …` | action |
| `action-url` | `[[http://x]] :Do work;` | `CommandActivity3` | `^(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line …` | action |
| `arrow` | `->` | `CommandArrow3` | `^(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|single\|thickness=\d+)(?:,#\w+\|,dotted\|,das …` | edge |
| `arrow-label` | `-> label;` | `CommandArrow3` | `^(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|single\|thickness=\d+)(?:,#\w+\|,dotted\|,das …` | edge |
| `arrow-long` | `-> label` | `CommandArrowLong3` | `^(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|single\|thickness=\d+)(?:,#\w+\|,dotted\|,das …` | edge |
| `arrow-color` | `-[#red]->` | `CommandArrow3` | `^(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|single\|thickness=\d+)(?:,#\w+\|,dotted\|,das …` | edge |
| `backward` | `backward :x;` | `CommandBackward3` | `^(?:\((?:(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|single\|thickness=\d+)(?:,#\w+\|,dot …` | edge |
| `if` | `if (ok) then (yes)` | `CommandIf2` | `^(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?(?:(#\w+[-\\\|/]?\w+):)?if[\s ]*\((.*?)\)[\s ]*(?:the …` | control |
| `if-is` | `if (a) is (b) then` | `CommandIf4` | `^(?:(#\w+[-\\\|/]?\w+):)?if[\s ]*\((.*?)\)[\s ]*(is\|equals?)[\s ]*\((.+?)\)[\s ]*then[\s ]*;?$` | control |
| `if-legacy` | `if (a) then when (b)` | `CommandIfLegacy1` | `^if[\s ]*\((.+?)\)[\s ]*then[\s ]+when[\s ]+(.*);?$` | control. Устаревший синтаксис. |
| `else` | `else (no)` | `CommandElse3` | `^else[\s ]*(?:\((?:(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|single\|thickness=\d+)(?: …` | control |
| `elseif` | `else if (x) then (y)` | `CommandElseIf2` | `^(?:(#\w+[-\\\|/]?\w+):)?[\s ]*(?:\((?:(?:->\|-\[((?:#\w+\|dotted\|dashed\|plain\|bold\|hidden\|norank\|singl …` | control |
| `endif` | `endif` | `CommandEndif3` | `^endif;?$` | control |
| `while` | `while (more)` | `CommandWhile3` | `^(?:(#\w+[-\\\|/]?\w+):)?while[\s ]*\((.*?)\)(?:[\s ]*(is\|equals?)[\s ]*\((.+?)\))?;?$` | control |
| `endwhile` | `endwhile` | `CommandWhileEnd3` | `^(?:end[\s ]*while\|while[\s ]*end)[\s ]*(?:\((.+?)\))?;?$` | control |
| `repeat` | `repeat` | `CommandRepeat3` | `^(\<{2}.*\>{2})?(?:(#\w+[-\\\|/]?\w+):)?repeat[\s ]*(?::(.*?))?(?:(;\|\\\\\|(?<![/\|<>}\]])[/<}]\|(?<![/\| …` | control |
| `repeat-while` | `repeat while (x) is (y)` | `CommandRepeatWhile3` | `^repeat[\s ]*while[\s ]*(?:\((.*?)\)[\s ]*(is\|equals?)[\s ]*\((.+?)\)[\s ]*(not)[\s ]*\((.+?)\)\|\((. …` | control |
| `fork` | `fork` | `CommandFork3` | `^fork;?$` | control |
| `fork-again` | `fork again` | `CommandForkAgain3` | `^fork[\s ]*again;?$` | control |
| `end-fork` | `end fork` | `CommandForkEnd3` | `^(end[\s ]*fork\|fork[\s ]*end\|end[\s ]*merge)[\s ]*(\{.+\})?;?$` | control |
| `split` | `split` | `CommandSplit3` | `^split;?$` | control |
| `split-again` | `split again` | `CommandSplitAgain3` | `^split[\s ]*again;?$` | control |
| `end-split` | `end split` | `CommandSplitEnd3` | `^(?:end[\s ]*split\|split[\s ]*end);?$` | control |
| `switch` | `switch (x)` | `CommandSwitch` | `^(?:(#\w+[-\\\|/]?\w+):)?switch[\s ]*\((.*?)\)[\s ]*$` | control |
| `case` | `case (a)` | `CommandCase` | `^case[\s ]*\((.*?)\)[\s ]*$` | control |
| `endswitch` | `endswitch` | `CommandEndSwitch` | `^endswitch[\s ]*$` | control |
| `group` | `group Label` | `CommandGroup3` | `^group[\s ]*(.*);?$` | control |
| `end-group` | `end group` | `CommandGroupEnd3` | `^(end ?group\|group ?end);?$` | control |
| `partition` | `partition P {` | `CommandPartition3` | `^(partition\|package\|rectangle\|card)[\s ]+(?:((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|lin …` | control. partition\|package\|rectangle\|card. |
| `end-partition` | `}` | `CommandEndPartition3` | `^\}$` | control |
| `swimlane` | `\|Lane1\|` | `CommandSwimlane` | `^\\|(?:(#\w+[-\\\|/]?\w+)\\|)?([^\|]+)\\|([^\|]+)?$` | swimlane |
| `swimlane-kw` | `swimlane L` | `CommandSwimlane2` | `^swimlane[\s ]+(?:(#\w+[-\\\|/]?\w+))?[\s ]*([^\|]+)(?:[\s ]+as[\s ]+([^\|]+))?$` | swimlane |
| `note` | `note right : text` | `CommandNote3` | `^(note\|floating note)[\s ]*(left\|right)?[\s ]*((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|l …` | note |
| `note-long` | `note right` | `CommandNoteLong3` | `^(note\|floating note)[\s ]*(left\|right)?[\s ]*((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|l …` | note |
| `break` | `break` | `CommandBreak` | `^break;?$` | control |
| `goto` | `goto label1` | `CommandGoto` | `^goto[\s ]+([\p{L}0-9_.]+);?$` | directive |
| `label` | `label label1` | `CommandLabel` | `^label[\s ]+([\p{L}0-9_.]+);?$` | directive |
| `link` | `link #red` | `CommandLink3` | `^link[\s ]+(#\w+);?$` | directive |
| `nolink` | `nolink` | `CommandNolink` | `^nolink;?$` | directive |
| `circle-spot` | `(A)` | `CommandCircleSpot3` | `^(?:(#\w+[-\\\|/]?\w+):)?\((\S)\);?$` | node |

### 4.4. Use Case (descdiagram)

| конструкция | пример синтаксиса | командный класс | шаблон | что разбирает |
|---|---|---|---|---|
| `element-usecase` | `usecase UC1` | `CommandCreateElementFull` | `^(?:(artifact\|actor/\|actor\|folder\|card\|file\|package\|rectangle\|label\|node\|frame\|cloud\|database\|queue\| …` | element. 25 ключевых слов-символов: actor, usecase, component, node, database, ... |
| `element-actor` | `actor User` | `CommandCreateElementFull` | `^(?:(artifact\|actor/\|actor\|folder\|card\|file\|package\|rectangle\|label\|node\|frame\|cloud\|database\|queue\| …` | element |
| `element-as` | `usecase UC1 as "Use 1"` | `CommandCreateElementFull` | `^(?:(artifact\|actor/\|actor\|folder\|card\|file\|package\|rectangle\|label\|node\|frame\|cloud\|database\|queue\| …` | element |
| `element-stereotype` | `usecase UC1 <<x>>` | `CommandCreateElementFull` | `^(?:(artifact\|actor/\|actor\|folder\|card\|file\|package\|rectangle\|label\|node\|frame\|cloud\|database\|queue\| …` | element |
| `element-paren` | `() :User:` | `CommandCreateElementParenthesis` | `^\(\)[\s ]+((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|line\.dashed\|line\.dotted\|line\.bold …` | element. Форма с явными скобками. Голый :User: разбирает CommandCreateElementFull. |
| `element-multiline` | `usecase UC1 [` | `CommandCreateElementMultilines[0]` | `^(artifact\|actor/\|actor\|folder\|card\|file\|package\|rectangle\|label\|node\|frame\|cloud\|database\|queue\|sta …` | element. Открывает многострочное тело элемента. |
| `link` | `User -- UC1` | `CommandLinkElement` | `^([\p{L}0-9_.]+\|\(\)[\s ]*[\p{L}0-9_.]+\|\(\)[\s ]*["“”«»][^"“”«»]+["“”«»]\|:[^:]+:\|(?!\[\*\])\[[^\[\] …` | link |
| `link-directed` | `User --> UC1` | `CommandLinkElement` | `^([\p{L}0-9_.]+\|\(\)[\s ]*[\p{L}0-9_.]+\|\(\)[\s ]*["“”«»][^"“”«»]+["“”«»]\|:[^:]+:\|(?!\[\*\])\[[^\[\] …` | link |
| `link-multiplicity` | `User "1" -- "n" UC1` | `CommandLinkElement` | `^([\p{L}0-9_.]+\|\(\)[\s ]*[\p{L}0-9_.]+\|\(\)[\s ]*["“”«»][^"“”«»]+["“”«»]\|:[^:]+:\|(?!\[\*\])\[[^\[\] …` | link |
| `package-usymbol` | `package P {` | `CommandPackageWithUSymbol` | `^(package\|rectangle\|node\|artifact\|folder\|file\|frame\|cloud\|database\|storage\|component\|card\|together\|q …` | namespace. package\|rectangle\|node\|artifact\|folder\|file\|frame\|cloud\|database\|storage\|component\|card\|together\|queue\|stack. |
| `archimate` | `archimate #red Server` | `CommandArchimate` | `^archimate[\s ]+((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|line\.dashed\|line\.dotted\|line\ …` | element |
| `archimate-multiline` | `archimate #red Server [` | `CommandArchimateMultilines` | `^archimate[\s ]+((?:#(?:\w+[-\\\|/]?\w+;)?(?:(?:text\|back\|header\|line\|line\.dashed\|line\.dotted\|line\ …` | element. Цвет обязателен в этой ветке шаблона. |
| `newpage` | `newpage` | `CommandNewpage` | `^@?newpage(?:(?:[\s ]*:[\s ]*\|[\s ]+)(.*[\p{L}0-9_.].*))?$` | directive |

### 4.5. State-диаграммы

| конструкция | пример синтаксиса | командный класс | шаблон | что разбирает |
|---|---|---|---|---|
| `state` | `state Foo` | `CommandCreateState` | `^state[\s ]+(?:([\p{L}0-9_.]+)[\s ]+as[\s ]+["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+)["“”«»][\s ] …` | state |
| `state-as` | `state A as "Alpha"` | `CommandCreateState` | `^state[\s ]+(?:([\p{L}0-9_.]+)[\s ]+as[\s ]+["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+)["“”«»][\s ] …` | state |
| `state-description` | `state Foo : text` | `CommandCreateState` | `^state[\s ]+(?:([\p{L}0-9_.]+)[\s ]+as[\s ]+["“”«»]([^"“”«»]+)["“”«»]\|["“”«»]([^"“”«»]+)["“”«»][\s ] …` | state |
| `composite-state` | `state Foo {` | `CommandCreatePackageState` | `^state[\s ]+(?:([\p{L}0-9_.]+)[\s ]+as[\s ]+["“”«»]([^"“”«»]+)["“”«»]\|(?:["“”«»]([^"“”«»]+)["“”«»][\ …` | state |
| `composite-state-begin` | `state Foo begin` | `CommandCreatePackageState` | `^state[\s ]+(?:([\p{L}0-9_.]+)[\s ]+as[\s ]+["“”«»]([^"“”«»]+)["“”«»]\|(?:["“”«»]([^"“”«»]+)["“”«»][\ …` | state |
| `end-state` | `end state` | `CommandEndState` | `^(end[\s ]?state\|\})$` | state. Закрывается также }. |
| `link` | `A --> B` | `CommandLinkState` | `^([\p{L}0-9_.:]+\|[\p{L}0-9_.:]+\[H\*?\]\|\[\*\]\|\[H\*?\]\|(?:==+)(?:[\p{L}0-9_.:]+)(?:==+))[\s ]*(\<\< …` | link |
| `link-start` | `[*] --> A` | `CommandLinkState` | `^([\p{L}0-9_.:]+\|[\p{L}0-9_.:]+\[H\*?\]\|\[\*\]\|\[H\*?\]\|(?:==+)(?:[\p{L}0-9_.:]+)(?:==+))[\s ]*(\<\< …` | link |
| `link-history` | `A[H] --> B` | `CommandLinkState` | `^([\p{L}0-9_.:]+\|[\p{L}0-9_.:]+\[H\*?\]\|\[\*\]\|\[H\*?\]\|(?:==+)(?:[\p{L}0-9_.:]+)(?:==+))[\s ]*(\<\< …` | link |
| `link-description` | `A --> B : text` | `CommandLinkState` | `^([\p{L}0-9_.:]+\|[\p{L}0-9_.:]+\[H\*?\]\|\[\*\]\|\[H\*?\]\|(?:==+)(?:[\p{L}0-9_.:]+)(?:==+))[\s ]*(\<\< …` | link |
| `concurrent` | `--` | `CommandConcurrentState` | `^(--+\|\\|\\|+)$` | separator |
| `add-field` | `A : field` | `CommandAddField` | `^(?:([\p{L}0-9_.]+)\|["“”«»]([^"“”«»]+)["“”«»])[\s ]*:[\s ]*(.*)$` | member |
| `hide-empty-description` | `hide empty description` | `CommandHideEmptyDescription` | `^(hide\|show)[\s ]+empty[\s ]+description$` | directive |

## 5. Полные шаблоны ключевых конструкций

Приведены без обрезки, так как именно они задают основную сложность парсера.

### `class-decl` — `CommandCreateClass`

```regex
^(interface|enum|annotation|abstract[\s ]+class|abstract|class|entity|circle|diamond)[\s ]+(?:["“”«»](.+?)(?:\<([^\<\>/](?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<\>)*\>)*\>)*\>)*\>)*)\>)?["“”«»][\s ]+as[\s ]+([^\s {}"“”«»<>]+)|([^\s {}"“”«»<>]+)[\s ]+as[\s ]+["“”«»](.+?)(?:\<([^\<\>/](?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<\>)*\>)*\>)*\>)*\>)*)\>)?["“”«»]|([^\s {}"“”«»<>]+)|["“”«»]([^"“”«»]+)["“”«»])(?:[\s ]*\<([^\<\>/](?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<\>)*\>)*\>)*\>)*\>)*)\>)?[\s ]*(\<{2}.*\>{2})?[\s ]*((\$[^\s {}"“”«»<>$]+)([\s ]+(\$[^\s {}"“”«»<>$]+))*)?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?[\s ]*((?:#(?:\w+[-\\|/]?\w+;)?(?:(?:text|back|header|line|line\.dashed|line\.dotted|line\.bold|shadowing)(?::\w+[-\\|/]?\w+)?(?:;|(?![\w;:.])))+)|(?:#\w+[-\\|/]?\w+))?[\s ]*(?:##(?:\[(dotted|dashed|bold)\])?(\w+)?)?(?:[\s ]+(extends)[\s ]+((?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*(?:\s*,\s*(?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*)*))?(?:[\s ]+(implements)[\s ]+((?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*(?:\s*,\s*(?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*)*))?(?:[\s ]*\{[\s ]*\})?$
```

### `class-body-open` — `CommandCreateClassMultilines`

```regex
^([-#+~])?(interface|enum|abstract[\s ]+class|abstract|class|entity)[\s ]+(?:["“”«»](.+?)(?:\<([^\<\>/](?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<\>)*\>)*\>)*\>)*\>)*)\>)?["“”«»][\s ]+as[\s ]+([^\s {}"“”«»<>]+)|([^\s {}"“”«»<>]+)[\s ]+as[\s ]+["“”«»](.+?)(?:\<([^\<\>/](?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<\>)*\>)*\>)*\>)*\>)*)\>)?["“”«»]|([^\s {}"“”«»<>]+)|["“”«»]([^"“”«»]+)["“”«»])(?:[\s ]*\<([^\<\>/](?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<(?:[^\<\>/]|\<\>)*\>)*\>)*\>)*\>)*)\>)?[\s ]*(\<\<.+\>\>)?[\s ]*((\$[^\s {}"“”«»<>$]+)([\s ]+(\$[^\s {}"“”«»<>$]+))*)?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?[\s ]*((?:#(?:\w+[-\\|/]?\w+;)?(?:(?:text|back|header|line|line\.dashed|line\.dotted|line\.bold|shadowing)(?::\w+[-\\|/]?\w+)?(?:;|(?![\w;:.])))+)|(?:#\w+[-\\|/]?\w+))?[\s ]*(?:##(?:\[(dotted|dashed|bold)\])?(\w+)?)?(?:[\s ]+(extends)[\s ]+((?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*(?:\s*,\s*(?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*)*))?(?:[\s ]+(implements)[\s ]+((?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*(?:\s*,\s*(?:\.|::|\\|\\\\)?[\p{L}0-9_]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_]+)*)*))?[\s ]*\{[\s ]*$
```

### `assoc` — `CommandLinkClass[CLASS]`

```regex
^(?:@([\d.]+)[\s ]+)?(?:((?:\.|::|\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_$]+)*|["“”«»][^"“”«»]+["“”«»])|\([\s ]*((?:[.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*|["“”«»][.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*["“”«»]))[\s ]*,[\s ]*((?:[.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*|["“”«»][.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*["“”«»]))[\s ]*\))[\s ]*(?:["“”«»]([^"“”«»]+)["“”«»])?[\s ]*([\s ]+[ox]|[)#\[<*+^}]|\<_|\<\|[\:\|]|[<\[]\||\}o|\}\||\|o|\|\|)?([-=.]+)(?:\[((?:#\w+|dotted|dashed|plain|bold|hidden|norank|single|thickness=\d+)(?:,#\w+|,dotted|,dashed|,plain|,bold|,hidden|,norank|,single|,thickness=\d+)*)\])?(left|right|up|down|le?|ri?|up?|do?)?(?:(0|\(0\)|\(0|0\))(?=[-=.~]))?(?:\[((?:#\w+|dotted|dashed|plain|bold|hidden|norank|single|thickness=\d+)(?:,#\w+|,dotted|,dashed|,plain|,bold|,hidden|,norank|,single|,thickness=\d+)*)\])?([-=.]*)([ox][\s ]+|:\>\>?|_\>|[(#\]>*+^\{]|[\|\:]\|\>|\|[>\]]|o\{|\|\{|o\||\|\|)?[\s ]*(?:["“”«»]([^"“”«»]+)["“”«»])?[\s ]*(?:((?:\.|::|\\|\\\\)?[\p{L}0-9_$]+(?:(?:\.|::|\\|\\\\)[\p{L}0-9_$]+)*|["“”«»][^"“”«»]+["“”«»])|\([\s ]*((?:[.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*|["“”«»][.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*["“”«»]))[\s ]*,[\s ]*((?:[.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*|["“”«»][.\\]{0,2}[\p{L}0-9_]+(?:[.\\]{1,2}[\p{L}0-9_]+)*["“”«»]))[\s ]*\))[\s ]*((?:#(?:\w+[-\\|/]?\w+;)?(?:(?:text|back|header|line|line\.dashed|line\.dotted|line\.bold|shadowing)(?::\w+[-\\|/]?\w+)?(?:;|(?![\w;:.])))+)|(?:#\w+[-\\|/]?\w+))?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?[\s ]*(?::[\s ]*(.+))?$
```

### `package` — `CommandPackage`

```regex
^(package)[\s ]+(["“”«»][^"“”«»]+["“”«»]|[^#\s {}]*)(?:[\s ]+as[\s ]+([\p{L}0-9_.]+))?[\s ]*(\<\<.*\>\>)?[\s ]*((\$[^\s {}"“”«»<>$]+)([\s ]+(\$[^\s {}"“”«»<>$]+))*)?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?[\s ]*((?:#(?:\w+[-\\|/]?\w+;)?(?:(?:text|back|header|line|line\.dashed|line\.dotted|line\.bold|shadowing)(?::\w+[-\\|/]?\w+)?(?:;|(?![\w;:.])))+)|(?:#\w+[-\\|/]?\w+))?[\s ]*\{$
```

### `note-on-entity` — `CommandFactoryNoteOnEntity.createSingleLine`

```regex
^note[\s ]+(right|left|top|bottom)(?:[\s ]+of[\s ]+([^\s {}"“”«»<>]+|["“”«»][^"“”«»]+["“”«»])|)[\s ]*(\<{2}.*\>{2})?[\s ]*((\$[^\s {}"“”«»<>$]+)([\s ]+(\$[^\s {}"“”«»<>$]+))*)?[\s ]*((?:#(?:\w+[-\\|/]?\w+;)?(?:(?:text|back|header|line|line\.dashed|line\.dotted|line\.bold|shadowing)(?::\w+[-\\|/]?\w+)?(?:;|(?![\w;:.])))+)|(?:#\w+[-\\|/]?\w+))?[\s ]*(\[\[(["“”«»][^"“”«»]+["“”«»])?([\w\W]*?)\]\])?[\s ]*:[\s ]*(.*)$
```

### `member-static` — `Member.stripStaticAbstract`

```regex
(?i)\{(static|classifier|abstract)\}\s*
```

### `member-field-method-marker` — `Member.stripFieldMethod`

```regex
(?i)\{(method|field)\}\s*
```

## 6. Что не извлекается

| Что | Причина |
|---|---|
| Члены класса (`+name : Type`, `+op() : T`) | Разбираются **не регуляркой**, а процедурно в `net/sourceforge/plantuml/cucadiagram/Member`: смотрится первый символ (видимость), затем строковые операции. Регулярками там являются только снятие маркеров: `(?i)\{(method\|field)\}\s*` и `(?i)\{(static\|classifier\|abstract)\}\s*`. |
| `CommandExoArrowAny`, `CommandParticipant` | Абстрактные базовые классы: шаблон передаётся им конструктором от подклассов (`CommandExoArrowLeft/Right`, `CommandParticipantA/A2/A3/A4`). Своего шаблона у них нет — это не потеря, а устройство. |
| Семантика декораторов связи (`*`, `o`, `\|>`, `..>`) | Регулярка ловит декоратор как символ, а смысл (`LinkDecor.EXTENDS/COMPOSITION/...`) назначается в `switch` внутри `CommandLinkClass.executeArg`, а не таблицей строк. |
| Тексты ошибок и подсказки | Не относятся к грамматике. |
| Диаграммы вне пяти пакетов (mindmap, gantt, salt, json, ...) | Задание ограничило набор; эти типы живут в своих пакетах (`net/sourceforge/plantuml/mindmap/`, ...) и не извлекались. |

## 7. Проверка на эталонных файлах

Пять файлов в `/tmp/pumltest/`, прогнаны двумя способами.

**Существенная поправка к заданию:** в этой версии `-syntax` читает **stdin**, а не путь
к файлу. Вызов `-syntax /tmp/pumltest/X.puml` печатает `No diagram found` для любого файла.
Рабочая форма: `java -jar plantuml.jar -syntax < X.puml`.

| Файл | `-syntax` (stdin) | `-tsvg -pipe` |
|---|---|---|
| `01_class.puml` | CLASS (1 entities) | OK, SVG 4448 байт |
| `02_assoc.puml` | CLASS (2 entities) | OK, SVG 6350 байт |
| `03_generalization.puml` | CLASS (2 entities) | OK, SVG 5592 байт |
| `04_package.puml` | CLASS (2 entities) | OK, SVG 5760 байт |
| `05_sequence.puml` | SEQUENCE (2 participants) | OK, SVG 3094 байт |

Что эти файлы доказывают: объявление класса с членами, ассоциация с кратностями и ролью,
обобщение, пакет с вложенными классами и sequence с двумя участниками принимаются
парсером этой версии и дают корректный SVG.

Дополнительно каждая конструкция из таблиц была прогнана через `regex.match` по
извлечённым шаблонам (Python-модуль `regex`, поддерживает `\p{L}`) — сопоставление
«пример → класс» подтверждено машинно, а не на глаз.

## 8. Сопоставление «пример → класс» (машинная проверка)

Каждый пример из таблиц прогнан через `regex.match` по **всем** извлечённым шаблонам.
Результат: сколько примеров подтвердили свой класс, сколько нет.

| Показатель | Значение |
|---|---|
| Всего конструкций | 169 |
| Пример подтверждён своим классом | 160 |
| Не подтверждён | 0 |
| Без проверки (нет шаблона или пример-перечисление) | 9 |

Ни один пример не разошёлся со своим классом.

Без машинной проверки (и почему):

- `class-entity-circle-diamond` — пример перечисляет несколько альтернатив
- `member-attribute` — нет шаблона — разбор процедурный
- `member-operation` — нет шаблона — разбор процедурный
- `member-static` — шаблон вспомогательный (снятие маркера), а не сопоставление строки
- `member-abstract` — шаблон вспомогательный (снятие маркера), а не сопоставление строки
- `member-field-method-marker` — шаблон вспомогательный (снятие маркера), а не сопоставление строки
- `member-visibility` — нет шаблона — разбор процедурный
- `activate-shorthand` — пример перечисляет несколько альтернатив
- `kill` — пример перечисляет несколько альтернатив

### Неоднозначные сопоставления

Один и тот же текст нередко принимают несколько команд — PlantUML перебирает их по порядку
регистрации, и первая совпавшая выигрывает. Это не ошибка извлечения, а свойство грамматики:

| конструкция | пример | кроме своего класса, совпадают |
|---|---|---|
| `action` | `:Do work;` | `CommandActivityLong3` |
| `arrow` | `->` | `CommandActivityLegacy1`, `CommandArrowLong3` |
| `arrow-color` | `-[#red]->` | `CommandActivityLegacy1`, `CommandArrowLong3` |
| `arrow-label` | `-> label;` | `CommandActivityLegacy1`, `CommandArrowLong3` |
| `arrow-long` | `-> label` | `CommandActivityLegacy1` |
| `box-end` | `end box` | `CommandGrouping` |
| `element-paren` | `() :User:` | `CommandCreateElementFull` |
| `end-partition` | `}` | `CommandEndPackage` |
| `footbox` | `hide footbox` | `CommandFootboxIgnored` |
| `hide-show-class` | `hide Foo` | `CommandHideShow2` |
| `hide-show-members` | `hide members` | `CommandHideShowByGender`, `CommandHideShowSpecificClass` |
| `hide-show-visibility` | `hide private members` | `CommandHideShowByGender` |
| `if-is` | `if (a) is (b) then` | `CommandIf2` |
| `if-legacy` | `if (a) then when (b)` | `CommandIf2` |
| `package-usymbol` | `package P {` | `CommandPackage` |
| `repeat-while` | `repeat while (x) is (y)` | `CommandRepeatWhile3Multilines` |

Практический вывод: порядок команд в фабрике диаграммы **является частью грамматики**.
Парсер, который просто перебирает шаблоны, получит другое дерево, чем PlantUML.

## 9. Оценка реализуемости парсера

По этой таблице парсер реализуем: все шаблоны получены машинно, полные и без потерь.
Но таблица описывает **распознавание строки**, а не построение модели — и это главное
ограничение.

Что будет самым сложным, по убыванию:

1. **Порядок команд и перекрытие шаблонов.** Многие конструкции совпадают текстуально
   (см. раздел 8). Нужно воспроизвести порядок регистрации команд в фабрике каждого типа
   диаграммы, иначе разбор пойдёт по другой ветке.
2. **`CommandLinkClass`.** Шаблон на ~1.8 КБ с 20+ группами: два конца связи, у каждого по
   четыре варианта записи, плюс декораторы, длина, направление, цвет, якорь, url и метка.
   Плоские группы без имени — сопоставлять их с полями модели придётся вручную по номеру.
3. **`CommandCreateClass`.** Ручная рекурсия для дженериков до 6 уровней и четыре
   взаимоисключающие ветви `id as "display"`.
4. **Многострочные команды.** `CommandCreateClassMultilines`, `CommandMultilines2`
   открывают блок и живут до закрывающей строки; грамматика перестаёт быть построчной.
5. **Члены класса.** Единственная часть, где шаблона нет: разбор процедурный
   (`Member`), его придётся переписать по логике, а не перевести регулярку.
6. **Подстановки `%s`/`%g` и `U+00A0`.** Мелочь, но если её пропустить, часть корректных
   файлов перестанет разбираться.

Разумный путь: взять шаблоны из JSON как источник истины, портировать их в целевой
движок регулярных выражений (нужна поддержка `\p{L}` и lookbehind), а порядок команд
восстановить из `ClassDiagramFactory` / `SequenceDiagramFactory` — там же лежит и порядок
регистрации.

