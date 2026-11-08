# Контентная база справочника: структура, связи, индекс, лицензия, пробелы

Что разобрано: корпус спецификации UML 2.5.1, нотация редактора, правила,
стереотипы, корпус моделей и учебное пособие. Что получилось: машиночитаемое
дерево стандарта, нарезка по разделам для браузера, четыре вида связей между
корпусами и поисковый индекс с проверкой. Что выяснилось про права: **текст
стандарта распространять нельзя** — ни целиком, ни в переработанном виде; в
разделе 4 разобрано, почему и что делать вместо этого.

Всё воспроизводится четырьмя командами из
[`material/reference-content/README.md`](../../material/reference-content/README.md):

```sh
python3 material/reference-content/parse_spec.py
python3 material/reference-content/build_crossrefs.py
python3 material/reference-content/build_search_index.py
node    material/reference-content/check_search.mjs
```

Прогон занимает около секунды, зависимостей нет (Python stdlib, Node без
пакетов), повторный прогон даёт побайтово те же файлы.

---

## 1. Дерево спецификации

### 1.1 Что получилось

`material/reference-content/spec-tree.json` — 1,95 МБ, схема `uml-spec-tree/1`.

| Показатель | Значение |
|---|---|
| Разделов верхнего уровня | 25 (22 нормативных + 3 приложения) |
| Узлов всего | **3 690** |
| Уровень 1 / 2 / 3 / 4 / 5 | 25 / 119 / 995 / 2 516 / 35 |
| Символов в источнике | 1 721 620 |
| Подразделов `Constraints` | 157 (плюс 2 именованных: `8.5.4.2 Interval Constraints`, `17.6.3.2 Interaction Constraints`) |
| Узлов, в поддереве которых есть `Constraints` | 184 |
| Блоков `ocl` | 680 |
| Вхождений `inv:` | 456 |
| Таблиц | 9 |
| Разрешённых ссылок «see N.M.K» | 219 |
| Неразрешённых ссылок | 0 |

Расхождение с цифрами брифа: там названо 3 655 заголовков и 160 подразделов
`Constraints`. Измерено 3 690 и 157 (+2 именованных). Первое объясняется точно:
`INDEX.md` считает только `#`/`##`/`###`/`####`: 25 + 119 + 995 + 2 516 =
3 655, то есть он не считает ровно 35 заголовков пятого уровня. Второе —
просто пересчёт: подразделов с заголовком, начинающимся на `Constraints`, в
тексте 159, из них 157 — обычные `N.M.K Constraints` с инвариантами
метакласса.

У каждого узла в дереве:

```json
{
 "id": "11.5-associations",          // устойчивый: номер + слаг заголовка
 "number": "11.5", "title": "Associations", "level": 2,
 "section": "11", "file": "11-structured-classifiers.md",
 "lines": [492, 754],                // 1-based, конец не включается
 "chars": 21, "charsSubtree": 26149, // собственный текст и всё поддерево
 "constraints": false, "constraintNodes": [],
 "oclBlocks": 0, "invLines": 0, "tables": 0,
 "refs": ["9.2.4", "9.5.3", "9.5.4"], "refsUnresolved": [],
 "children": [ … ]
}
```

`chars` (собственный текст, без потомков) — то, чем меряется «что грузить по
частям»: у узла `11.5` своих 21 символ (только заголовок), а всё поддерево —
26 149.

### 1.2 Нарезка

`spec-sections/` — 25 файлов, по одному на раздел верхнего уровня. Имя —
номер и слаг: `11-structured-classifiers.md`, `annex-b-uml-diagram-interchange.md`.

| Раздел | Символов | Байт |
|---|---:|---:|
| 1 Scope | 1 934 | 1 941 |
| 2 Conformance | 2 932 | 2 947 |
| 3 Normative References | 821 | 828 |
| 4 Terms and Definitions | 201 | 208 |
| 5 Notational Conventions | 869 | 876 |
| 6 Additional Information | 31 457 | 31 574 |
| 7 Common Structure | 110 494 | 110 805 |
| 8 Values | 53 787 | 53 878 |
| 9 Classification | 180 625 | 181 328 |
| 10 Simple Classifiers | 35 441 | 35 521 |
| 11 Structured Classifiers | 138 464 | 138 667 |
| 12 Packages | 109 277 | 109 508 |
| 13 Common Behavior | 52 593 | 52 726 |
| 14 StateMachines | 158 016 | 158 385 |
| 15 Activities | 159 176 | 159 455 |
| **16 Actions** | **300 754** | **301 087** |
| 17 Interactions | 153 138 | 153 515 |
| 18 UseCases | 29 579 | 29 680 |
| 19 Deployments | 27 072 | 27 189 |
| 20 InformationFlows | 18 823 | 18 900 |
| 21 Primitive Types | 2 329 | 2 356 |
| 22 Standard Profile | 11 734 | 11 919 |
| Annex A Diagrams | 6 476 | 6 483 |
| Annex B UML Diagram Interchange | 113 427 | 113 504 |
| Annex C Keywords | 22 201 | 22 390 |
| **Итого** | **1 721 620** | |

Шесть разделов тяжелее 120 КБ (9, 11, 14, 15, 16, 17) нарезаны ещё и по
подразделам второго уровня: `spec-sections/units/`, 61 файл, 1,09 МБ. Самая
крупная единица загрузки — `16.14-classifier-descriptions.md` (описания
классов действий, 95,5 КБ); самая мелкая — `9.1-summary.md` (473 байта).

Практический вывод для справочника: открытие раздела 16 целиком — это 301 КБ,
открытие подраздела — от 0,5 до 96 КБ (медиана 11,9 КБ, среднее 17,9 КБ,
тяжелее 50 КБ только 4 файла из 61); разделы 1–5 и 21 отдаются целиком и стоят
меньше 3 КБ каждый.

### 1.3 Проверка полноты — и что пришлось чинить

Требование «сумма символов в нарезанных файлах должна совпасть с исходником»
выполнено: **1 721 620 = 1 721 620, дельта 0**. Проверяется не арифметикой
нарезки, а чтением записанных файлов с диска: каждый кусок после записи
перечитывается и сравнивается с исходными строками; для подразделов
дополнительно проверяется, что склейка файлов даёт раздел.

С первого раза не сошлось — и это оказалось полезно. Первый прогон дал
−159 336 символов. Причина была не в нарезке, а в разборе:

1. `_find_end` для последнего узла файла возвращал начало последнего
   подраздела вместо конца файла — хвост каждого раздела не попадал ни в один
   узел (в 24 из 25 файлов «покрыто N строк из N+5»).
2. Регулярное выражение ограды требовало ` ``` ` в начале строки, а OCL-блоки
   в спецификации вложены в пункты списка и сдвинуты на два пробела: из 680
   блоков не находился ни один, `oclBlocks` показывал 0.

После исправления обоих — дельта 0 и 680 блоков. Скрипт теперь сам проверяет,
что каждый файл начинается с заголовка и что суммарное покрытие строк равно
длине файла, и падает с кодом 1, если это не так.

Отдельно: ссылки извлекаются только из прозы, а не из ограждённых блоков. В
ASCII-арте абстрактного синтаксиса встречается строка `+ clause 0..1`, и
наивный поиск «clause N» давал ссылку на несуществующий пункт «0». Единственная
неразрешённая ссылка была именно такой; после исключения блоков — 0
неразрешённых из 219.

---

## 2. Связи между корпусами

`material/reference-content/crossrefs.json` — 287 КБ, схема `uml-crossrefs/1`.
Каждая связь записана с `confidence` (`exact` / `derived` / `guess`) и с
полем `basis` — на чём именно она основана, словами. `guess` в интерфейс как
факт попадать не должен; в файле такие записи помечены явно.

### 2.1 Метод: заголовки, а не память

Пункт стандарта для фигуры ищется **поиском по заголовкам дерева**, а не
назначается рукой. В скрипте лежит только список поисковых терминов на каждую
фигуру (`SHAPE_TERMS`, `CONNECTOR_TERMS`) — это вопрос, а ответ даёт текст
стандарта. Найденный заголовок записывается в связь, поэтому любую строку
результата можно проверить глазами: `«11.5 Associations» — точное совпадение
заголовка («Association»)».

Порядок разрешения:

1. точное (или почти точное, с учётом числа) совпадение заголовка понятия —
   `exact`;
2. описание метакласса `X [Class]` — от него берётся раздел-родитель;
3. поиск по тексту подразделов раздела, если заголовка нет (подразделы
   `… Descriptions` исключены: там описан каждый метакласс, и они перетянули
   бы на себя любой термин);
4. последняя попытка — сам ключ нотации; если и он не нашёлся, связь получает
   `guess` и поле `note`.

Для каждой фигуры записаны **два** адреса: `clause` — статья о понятии
(например, `11.5 Associations`), и `metaclass` — сгенерированное описание
метакласса (`11.8.1 Association [Class]`), плюс `notation` — подраздел
нотации, если он есть (`11.5.4`). Это разные вещи: первое читают, второе
используют для сверки правил.

### 2.2 Сколько связей и какой уверенности

| Связь | Всего | exact | derived | guess |
|---|---:|---:|---:|---:|
| Фигура нотации → пункт | 51 | 44 | 6 | 1 |
| Связь нотации → пункт | 27 | 22 | 5 | 0 |
| **Нотация итого** | **78** | **66** | **11** | **1** |
| Правило → пункт → фигура | 23 | 23 | 0 | 0 |
| Стереотип → base-тип → фигура | 428 | 189 | 35 | 204 |
| Рисунок пособия → модель корпуса | 54 | 54 | 0 | 0 |
| Упражнение пособия → модели | 20 | 19 | 1 | 0 |
| **Итого** | **603** | **351** | **47** | **205** |

Единственная `guess` среди нотации — фигура `text` (свободная надпись на
диаграмме): у неё нет элемента модели, а значит и пункта стандарта. Это
свойство самой фигуры, а не пробел разбора.

`derived` среди фигур — те, где точного заголовка нет и адрес получен по
тексту: `deploymentSpec`, `device`, `executionEnvironment` (всё внутри 19.2
Deployments), `metaclass`, `actor`, `systemBoundary` (18.1 Use Cases),
`swimlane` (15.6 Activity Groups), `aggregation`, `composition` (11.5
Associations), `controlFlow`, `communicationPath`, `manifest`. У каждой такой
записи в `basis` написано, сколько раз термин встретился в тексте пункта.

### 2.3 Правила: что проверено

Для каждого из 23 правил проверены четыре вещи, и все 23 прошли:

* `clauseExists` — пункт из поля `source.clause` есть в дереве;
* `clauseIsConstraints` — этот пункт действительно подраздел `Constraints`, а
  не что-то похожее по номеру;
* `constraintNameInClause` — имя ограничения (`not_own_self`,
  `binary_associations`…) буквально встречается в тексте этого пункта;
* `metaclassHasFigure` — у метакласса правила есть фигура в нотации. Прошли 15
  из 23; остальные 8 — это `Element` (1), `MultiplicityElement` (4),
  `Namespace` (1) и `Classifier` (2): абстрактные метаклассы, фигуры у них нет
  и быть не может, поэтому их правила показываются в справочнике от пункта
  стандарта, а не от фигуры.

Проверка ключей `appliesTo` тоже встроена: если правило ссылается на фигуру,
которой нет в `app/notation/uml.json`, скрипт падает. Сейчас не падает.

### 2.4 Стереотипы: 204 из 428 остались без фигуры, и это не ошибка разбора

428 записей `<Stereotype>`, 97 различных base-типов. Из них 31 base-тип
совпадает с ключом нотации — фигурой или связью (189 записей, `exact`), ещё 35
записей сведены к нотации таблицей соответствий (`NOTE` → `note`,
`InteractionLifeLine` → `lifeline`, `InstanceSpecification` → `object`,
`SubSystem` → `component`, `Collaboration2` → `collaboration` и т. д.) — это
`derived`. Итого фигуру получили 224 стереотипа.

Остальные 204 записи (66 base-типов) — `guess`, и причина у них одна: их
base-тип вообще не является элементом нотации. Крупнейшие: `Attribute` (38),
`BMMRelationship` (37 — Business Motivation Model, вообще не UML),
`Operation` (6), `InputPin` и `OutputPin` (по 4), `SysMLBlock` (4),
`AssociationEnd` (4), `ArchiMateBusinessActor` (4), затем десятки чужих
нотаций: `SysML*`, `ArchiMate*`, `ActivityAction`, `CentralBufferNode`,
`ExpansionNode`, `NodeInstance`, `Requirement`. Атрибут, операция и полюс
ассоциации рисуются строками внутри фигуры, а не отдельными фигурами, —
связывать их с фигурой было бы выдумкой. В справочнике такие стереотипы должны
открываться из строки атрибута, а стереотипы чужих нотаций не показывать
вовсе: из 428 записей 104 относятся к BMM (37), ArchiMate (48) и SysML (19) —
это импортированные библиотеки Visual Paradigm, а не UML-профиль.

### 2.5 Рисунки и упражнения

`tests/corpus/MANIFEST.json` даёт 54 рисунка; `app/reference/vp163/INDEX.md` —
таблицу «номер → файл → тип». Сверены: наличие PNG, совпадение имени файла в
двух источниках, наличие модели в `tests/corpus/`, и арифметика имени файла.
Все 54 — `exact`.

Про арифметику стоит сказать отдельно, потому что указатель её описывает
неточно. В `INDEX.md` написано: «убрать точки из номера рисунка — получить имя
файла». Для `1.1` это даёт `11`, а файл называется `1001.png`. Настоящее
правило — «раздел | подраздел по основанию 100 | номер»: `3.1.2` → `3|01|02` →
`3102`, `5.2.20` → `5|02|20` → `5202`; у номеров из двух частей подраздела нет
и он пишется как `00`: `1.1` → `1|00|01` → `1001`. Скрипт проверяет оба
варианта и засчитывает совпавший; заодно он ловит расхождение, если указатель
и манифест разойдутся в имени файла (сейчас не расходятся).

Моделей нет у 6 рисунков — это снимки интерфейса и деревьев модели: `1.1`,
`1.1a`, `4.1.1`, `5.1.2`, `5.2.9`, `5.2.16`. Отсутствие модели у них записано
как факт манифеста (`group: "ui"` — снимок интерфейса, а не диаграмма),
а не как догадка.

Упражнения: 20 номеров в манифесте, 19 совпали с заголовками «Упражнение …» в
`docs/uml-tutorial.md` (`exact`), один — `1` — с заголовком раздела пособия
(`derived`): рисунки 1.1 и 1.1a относятся к разделу 1, а не к упражнению.
Одно упражнение — 3.3 — не имеет рисунков вовсе: это текстовые описания
вариантов использования, диаграмм в нём нет.

### 2.6 Где я разошёлся с брифом

В задании приведены примеры: `association → 11.5`, `state → 14.5`,
`action → 15.3`. Первый подтвердился. Два других — нет, и вот почему:

* **`action`**: пункт **16.2 Actions** (раздел 16 целиком про действия,
  300 754 символа — самый большой в стандарте). `15.3` — это **Control Nodes**
  (решения, слияния, развилки, соединения), ни одного действия там нет.
  Возможно, в брифе имелось в виду, что действия рисуются на диаграмме
  деятельности (раздел 15), но пункт 15.3 — про узлы управления.
* **`state`**: статья о состоянии — **14.2 Behavior StateMachines** (там
  `14.2.4.4 State` — нотация, `14.2.3.4` — семантика). `14.5` — это
  `Classifier Descriptions`, сгенерированное описание метакласса
  (`14.5.9 State [Class]`). Оба адреса в файле есть: `clause` = 14.2,
  `metaclass` = 14.5.9. Если справочнику нужен именно 14.5, он берётся из
  поля `metaclass`, но по умолчанию открывается статья.

Похожая пара — `merge`: в палитре деятельности это `MergeNode` (15.3), а
одноимённая связь `merge` — это `PackageMerge` (12.2). Это две разные записи
нотации, и они получают разные адреса; в файле у них разные `kind`
(`shape` / `connector`).

---

## 3. Индекс поиска

`material/reference-content/search-index.json` — **400 915 байт**
(108 КБ в gzip), схема `uml-search/1`.

### 3.1 Что за запись

3 496 документов; документ — это массив из пяти полей плюс два словаря:

```json
"docs": [[kind, ref, text, line, weight], …],
"postings": { "association": "1f,2a,3c…" }   // id документов в base36
```

| `kind` | Что это | Сколько |
|---|---|---:|
| `spec-node` | заголовок пункта стандарта | 1 641 |
| `spec-para` | абзац пояснительного подраздела | 1 137 |
| `rule` | правило: id, имя ограничения, сообщение, подсказка, метакласс | 23 |
| `stereotype` | имя стереотипа, его base-тип и разнесённое по словам имя | 428 |
| `shape` | фигура: ключ, `label`, `hint`, стереотип, заголовок пункта | 51 |
| `connector` | связь: то же | 27 |
| `exercise` | заголовок упражнения пособия | 20 |
| `plantuml` | конструкция PlantUML: синтаксис и пояснение | 169 |

`ref` — адрес, по которому справочник откроет документ (номер пункта, id
правила, ключ фигуры, номер упражнения); `text` — то, что показывается в
выдаче (заголовок или первые ~96 символов абзаца); `line` — строка в файле
раздела, чтобы не искать текст повторно.

В индекс попадают не все 3 690 узлов: выброшены 418 описаний метаассоциаций
(`A_xxx_yyy [Association]`) и 1 631 служебный подзаголовок описаний
метаклассов (`Attributes`, `Operations`, `Diagrams`, `Generalizations`…);
3 690 − 418 − 1 631 = 1 641. Они остаются в дереве — просто не ищутся:
искать «Operations» бессмысленно, под этим заголовком ничего, кроме перечня
операций метакласса. Заголовок `Constraints` оставлен: под ним имена
инвариантов, по которым ищут.

### 3.2 Русский и английский

Два независимых моста:

1. **Русские подписи фигур привязываются к пункту стандарта.** `label` и
   `hint` фигуры (`«Ассоциация»`, `«Ассоциация — структурная связь»`)
   дописываются в постинги того пункта, к которому фигура привязана в
   `crossrefs.json`. Это выведенный мост: он существует ровно потому, что
   связь «фигура → пункт» уже установлена.
2. **Глоссарий** `glossary` — 95 пар «русский термин → английский»: 38
   выведены из русских подписей фигур (подпись ↔ английский метакласс), 57
   написаны рукой для понятий, которых нет в палитре:
   `квалификатор → Qualifier`, `кратность → Multiplicity`,
   `сторожевое условие → InteractionOperand`, `инвариант → Constraint`.
   Каждая ручная пара проверена тем, что английский термин есть в заголовках
   дерева.

Проверка требует, чтобы «квалификатор» и `qualifier` давали один и тот же
первый результат, — оба дают `9.5.3`.

### 3.3 Как ранжировать

Полное описание лежит в самом индексе, в поле `ranking`. Коротко:

```
score = Σ по терминам запроса  idf(t) · weight(документа)
      + бонус за имя записи      (заголовок равен термину +14, начинается +6, содержит +2)
      + якорь понятия            (+20 документам пункта, где понятие определено)
      + бонус за фразу           (+8, если запрос целиком входит в текст)
      × приоритет вида           (пункт стандарта 1.25, правило 1.1, фигура 0.95)
idf(t) = ln(1 + N/df)
```

Два неочевидных решения:

* **Якоря понятий** (`anchors`, 80 записей). Якорь — пункт, где понятие
  *определено*, а не просто упомянуто. Без него запрос «квалификатор» первым
  выдаёт пункт `16.7.3.2 Read Link Object End Qualifier Actions` — там слово
  в заголовке, но это действие чтения квалификатора, а не статья о нём. Якорь
  поднимает документы своего пункта, но только те, где термин уже найден:
  иначе он поднимал бы любой документ пункта, включая служебные
  «Semantics»/«Abstract Syntax».
* **Якорь не срабатывает на многословный запрос.** «class Foo» — это
  конструкция PlantUML, а не понятие «класс»; подтягивать её к статье 11.4
  нельзя.

### 3.4 Проверка

`material/reference-content/check_search.mjs` — 14 запросов, на каждый
ожидаемая первая выдача, и проверка её вида и адреса. Ранжирование в проверке
реализовано по тем же правилам, что записаны в индексе; если индекс
пересоберут с другой схемой, проверка это покажет.

```
$ node material/reference-content/check_search.mjs
индекс: 3496 документов, 3148 терминов

ok    «квалификатор» → spec-para 9.5.3 — A Property that is a memberEnd may itself have other Propert
ok    «qualifier» → spec-para 9.5.3 — A Property that is a memberEnd may itself have other Propert
ok    «композиция» → spec-node 11.5 — Associations
ok    «composite aggregation» → spec-para 9.5.3 — Composite aggregation is a strong form of aggregation that r
ok    «entity» → stereotype entity — entity entity Component Component
ok    «association» → spec-node 11.5 — Associations
ok    «дорожка» → spec-node 15.6 — Activity Groups
ok    «lifeline» → spec-node 17.3.4.1 — Lifeline
ok    «сторожевое условие» → spec-node 17.6.4.1 — InteractionOperand
ok    «element-not-own-self» → rule element-not-own-self — element-not-own-self Element::not_own_self Элемент прямо или
ok    «Упражнение 4.3.B» → exercise 4.3.B — Упражнение 4.3.B Уточнение диаграммы классов VOPC RegisterFo
ok    «class Foo» → plantuml class-decl — class Foo Ключевое слово типа — альтернатива из 8 вариантов.
ok    «стереотип» → spec-node 12.3 — Profiles
ok    «кратность» → spec-node 7.5 — Types and Multiplicity

все запросы дали ожидаемую первую выдачу
```

Запросы подобраны так, чтобы каждый проверял свой механизм: перевод
(«квалификатор»), синоним понятия («композиция» → composite aggregation),
попадание в запись, а не в текст («entity» → стереотип), русскую подпись
фигуры («дорожка»), имя правила, заголовок упражнения, синтаксис PlantUML.

Проверка не «подогнана»: три запроса из четырёх, где первая выдача сначала
расходилась с ожиданием, оказались случаями, где правильной была выдача, а не
ожидание (`композиция` → статья 11.5, `дорожка` → 15.6, `сторожевое условие`
→ 17.6.4.1 InteractionOperand), и ожидание было исправлено с объяснением.
Единственный настоящий провал — «квалификатор» → действие вместо статьи — был
исправлен якорями.

### 3.5 Ограничения

* Индекс хранит адрес и отрывок, а не текст: полный текст абзаца берётся из
  `spec-sections/` по `ref` и `line`. Поэтому размер индекса не растёт вместе с
  корпусом.
* Морфология не стеммится: работает префиксное совпадение при длине ≥ 4 и
  разнице длин ≤ 3 (`квалификатор`/`квалификаторы`, `class`/`classes`). Этого
  хватает для русских окончаний, но не для супплетива (`человек`/`люди`).
* Абзацы индексируются только в пояснительных подразделах (`Summary`,
  `Semantics`, `Notation`, `Examples`, `Overview`, `Description`,
  `Abstract Syntax`). Ограждённые блоки, OCL, таблицы и пункты списков в
  абзацы не попадают — они отсекаются ещё при разбиении. Текст описаний
  метаклассов (`Classifier Descriptions`, 1 641 заголовок и их содержимое) в
  индекс не входит: иначе он вырос бы в разы, а искали бы по нему всё равно
  заголовки.
* Опечатки не прощаются.

---

## 4. Лицензия

### 4.1 Что сказано в самом документе

Права описаны **не в тексте разделов**, а в начале PDF: страницы i–v,
`reference/spec/uml-2.5.1.pdf`. В markdown-корпусе `reference/spec/md/` этого
текста **нет вообще** — конвертация началась с раздела 1, выходные данные
отброшены. Проверено: слово `Copyright` не встречается ни в одном из 26 файлов
`reference/spec/md/`. Это первое, что нужно знать: распространяя `.md`-файлы
как есть, мы распространяем копии спецификации **без обязательного
уведомления**.

Титул и выходные данные:

> An OMG® Unified Modeling Language ® Publication
>
> OMG® Unified Modeling Language® (OMG UML®)
> Version 2.5.1
>
> OMG Document Number: formal/2017-12-05
>
> Date: December 2017
>
> Normative URL: https/www.omg.org/spec/UML/

Список правообладателей — 38 строк, от `Copyright © 2009-2013 88Solutions` до
`Copyright © 1997-2017 Object Management Group, Inc`.

**LICENSES:**

> The companies listed above have granted to the Object Management Group, Inc. (OMG) a nonexclusive, royalty-free, paid up, worldwide license to copy and distribute this document and to modify this document and distribute copies of the modified version. Each of the copyright holders listed above has agreed that no person shall be deemed to have infringed the copyright in the included material of any such copyright holder by reason of having used the specification set forth herein or having conformed any computer software to the specification.

**Условия использования (главный абзац):**

> Subject to all of the terms and conditions below, the owners of the copyright in this specification hereby grant you a fully-paid up, non-exclusive, nontransferable, perpetual, worldwide license (without the right to sublicense), to use this specification to create and distribute software and special purpose specifications that are based upon this specification, and to use, copy, and distribute this specification as provided under the Copyright Act; provided that: (1) both the copyright notice identified above and this permission notice appear on any copies of this specification; (2) the use of the specifications is for informational purposes and will not be copied or posted on any network computer or broadcast in any media and will not be otherwise resold or transferred for commercial purposes; and (3) no modifications are made to this specification. This limited permission automatically terminates without notice if you breach any of these terms or conditions. Upon termination, you will destroy immediately any copies of the specifications in your possession or control.

**PATENTS** (в том же блоке):

> This specification is published under the “RF on Limited Terms” IPR mode listed in the OMG Intellectual Property Rights Policy Statement, OMG Document ipr/12-09-02, available at: http://doc.omg.org/ipr/12-09-02

**GENERAL USE RESTRICTIONS:**

> Any unauthorized use of this specification may violate copyright laws, trademark laws, and communications regulations and statutes. This document contains information which is protected by copyright. All Rights Reserved. No part of this work covered by copyright herein may be reproduced or used in any form or by any means--graphic, electronic, or mechanical, including photocopying, recording, taping, or information storage and retrieval systems--without permission of the copyright owner.

**DISCLAIMER OF WARRANTY:**

> WHILE THIS PUBLICATION IS BELIEVED TO BE ACCURATE, IT IS PROVIDED "AS IS" AND MAY CONTAIN ERRORS OR MISPRINTS. THE OBJECT MANAGEMENT GROUP AND THE COMPANIES LISTED ABOVE MAKE NO WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, WITH REGARD TO THIS PUBLICATION, INCLUDING BUT NOT LIMITED TO ANY WARRANTY OF TITLE OR OWNERSHIP, IMPLIED WARRANTY OF MERCHANTABILITY OR WARRANTY OF FITNESS FOR A PARTICULAR PURPOSE OR USE.
>
> IN NO EVENT SHALL THE OBJECT MANAGEMENT GROUP OR ANY OF THE COMPANIES LISTED ABOVE BE LIABLE FOR ERRORS CONTAINED HEREIN OR FOR DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, RELIANCE OR COVER DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA OR USE, INCURRED BY ANY USER OR ANY THIRD PARTY IN CONNECTION WITH THE FURNISHING, PERFORMANCE, OR USE OF THIS MATERIAL, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
>
> The entire risk as to the quality and performance of software developed using this specification is borne by you. This disclaimer of warranty constitutes an essential part of the license granted to you to use this specification.

**TRADEMARKS:**

> CORBA®, CORBA logos®, FIBO®, Financial Industry Business Ontology®, FINANCIAL INSTRUMENT GLOBAL IDENTIFIER®, IIOP®, IMM®, Model Driven Architecture®, MDA®, Object Management Group®, OMG®, OMG Logo®, SoaML®, SOAML®, SysML®, UAF®, Unified Modeling Language®, UML®, UML Cube Logo®, VSIPL®, and XMI® are registered trademarks of the Object Management Group, Inc.
>
> For a complete list of trademarks, see: http://www.omg.org/legal/tm_list.htm. All other products or company names mentioned are used for identification purposes only, and may be trademarks of their respective owners.

**COMPLIANCE:**

> The copyright holders listed above acknowledge that the Object Management Group (acting itself or through its designees) is and shall at all times be the sole entity that may authorize developers, suppliers and sellers of computer software to use certification marks, trademarks or other special designations to indicate compliance with these materials.
>
> Software developed under the terms of this license may claim compliance or conformance with this specification if and only if the software compliance is of a nature fully matching the applicable compliance points as stated in the specification. Software developed only partially matching the applicable compliance points may claim only that the software was based on this specification, but may not claim compliance or conformance with this specification.

**RESTRICTED RIGHTS LEGEND** (для поставок госструктурам США):

> Use, duplication or disclosure by the U.S. Government is subject to the restrictions set forth in subparagraph (c) (1) (ii) of The Rights in Technical Data and Computer Software Clause at DFARS 252.227-7013 or in subparagraph (c)(1) and (2) of the Commercial Computer Software - Restricted Rights clauses at 48 C.F.R. 52.227-19 or as specified in 48 C.F.R. 227-7202-2 of the DoD F.A.R. Supplement and its successors, or as specified in 48 C.F.R. 12.212 of the Federal Acquisition Regulations and its successors, as applicable. The specification copyright owners are as indicated above and may be contacted through the Object Management Group, 109 Highland Avenue, Needham, MA 02494, U.S.A.

### 4.2 Можно ли распространять текст внутри приложения

**Нет.** И это не осторожность, а прямой текст лицензии: три условия
разрешения, и наш корпус нарушает все три.

1. **Условие (2) — «will not be copied or posted on any network computer».**
   Справочник в веб-редакторе отдаёт текст разделов браузеру по сети. Это
   ровно «posted on any network computer». Разрешение дано на использование
   «for informational purposes», но с этим ограничением, и ограничение
   снимается только вместе с разрешением.
2. **Условие (3) — «no modifications are made to this specification».**
   Корпус `reference/spec/md/` — уже не копия, а переработка: сняты колонтитулы
   и разрывы страниц, рисунки заменены ASCII-артом, таблицы пересобраны
   заново, добавлены заголовки Markdown и строка атрибуции. Распространять
   такое нельзя даже как «фрагменты».
3. **Условие (1) — уведомление должно быть на каждой копии.** В `.md` его нет.

Дополнительно `GENERAL USE RESTRICTIONS` прямо запрещает воспроизведение
«in any form or by any means--graphic, electronic, or mechanical … without
permission of the copyright owner», а `COMPLIANCE` оставляет за OMG
исключительное право разрешать ссылки на соответствие.

Отдельно про рисунки стандарта: в PDF настоящие изображения есть (первое —
на 56-й странице PDF, это диаграммы-иллюстрации), но в markdown они не
переносились, вместо них ASCII-арт. То есть **ни рисунков, ни логотипов OMG в
нашем корпусе нет**, и это единственная хорошая новость раздела. Знаков `®` и
`™` в тексте разделов тоже нет: они остались только на титуле, которого в
markdown нет.

### 4.3 Что обязаны приложить — дословно

Блок ниже можно вставлять в файл как есть. Он собран из лицензии UML 2.5.1 без
изменений формулировок; менять в нём нельзя ничего, кроме собственных строк
проекта, которые отделены.

```text
UML 2.5.1 — Unified Modeling Language, version 2.5.1
OMG Document Number: formal/2017-12-05, December 2017
Normative URL: https://www.omg.org/spec/UML/2.5.1/

Copyright © 1997-2017 Object Management Group, Inc.
Правообладатели перечислены в разделе «LICENSES» документа
formal/2017-12-05 (38 строк, от 88Solutions до Object Management Group, Inc).

The companies listed above have granted to the Object Management Group, Inc. (OMG) a
nonexclusive, royalty-free, paid up, worldwide license to copy and distribute this document
and to modify this document and distribute copies of the modified version. Each of the
copyright holders listed above has agreed that no person shall be deemed to have infringed
the copyright in the included material of any such copyright holder by reason of having used
the specification set forth herein or having conformed any computer software to the
specification.

WHILE THIS PUBLICATION IS BELIEVED TO BE ACCURATE, IT IS PROVIDED "AS IS" AND MAY CONTAIN
ERRORS OR MISPRINTS. THE OBJECT MANAGEMENT GROUP AND THE COMPANIES LISTED ABOVE MAKE NO
WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, WITH REGARD TO THIS PUBLICATION, INCLUDING BUT NOT
LIMITED TO ANY WARRANTY OF TITLE OR OWNERSHIP, IMPLIED WARRANTY OF MERCHANTABILITY OR
WARRANTY OF FITNESS FOR A PARTICULAR PURPOSE OR USE.
IN NO EVENT SHALL THE OBJECT MANAGEMENT GROUP OR ANY OF THE COMPANIES LISTED ABOVE BE LIABLE
FOR ERRORS CONTAINED HEREIN OR FOR DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
RELIANCE OR COVER DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA OR USE, INCURRED BY ANY
USER OR ANY THIRD PARTY IN CONNECTION WITH THE FURNISHING, PERFORMANCE, OR USE OF THIS
MATERIAL, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
The entire risk as to the quality and performance of software developed using this
specification is borne by you. This disclaimer of warranty constitutes an essential part of
the license granted to you to use this specification.

CORBA®, CORBA logos®, FIBO®, Financial Industry Business Ontology®, FINANCIAL INSTRUMENT
GLOBAL IDENTIFIER®, IIOP®, IMM®, Model Driven Architecture®, MDA®, Object Management Group®,
OMG®, OMG Logo®, SoaML®, SOAML®, SysML®, UAF®, Unified Modeling Language®, UML®, UML Cube
Logo®, VSIPL®, and XMI® are registered trademarks of the Object Management Group, Inc.
For a complete list of trademarks, see: http://www.omg.org/legal/tm_list.htm. All other
products or company names mentioned are used for identification purposes only, and may be
trademarks of their respective owners.

--- строки проекта ---
Настоящее приложение не является копией спецификации OMG UML 2.5.1 и не
воспроизводит её текст. Оно содержит производные данные: номера и названия
пунктов, имена ограничений, перекрёстные ссылки и краткие цитаты, приведённые
для пояснения. Полный текст спецификации доступен по адресу
https://www.omg.org/spec/UML/2.5.1/
Приложение не заявляет о соответствии (compliance/conformance) спецификации
OMG UML 2.5.1; оно основано на этой спецификации.
```

Если же решено показывать цитаты (а не только номера пунктов), к каждой цитате
нужна ссылка на пункт и на документ `formal/2017-12-05`, а к приложению —
весь блок выше целиком, включая отказ от ответственности. Выбрасывать отказ
нельзя: лицензия называет его «essential part of the license».

### 4.4 Чего делать нельзя

* Показывать в приложении текст разделов стандарта — целиком или нарезанный,
  как сейчас лежит в `spec-sections/`.
* Распространять `reference/spec/md/` в составе поставки: это переработка без
  уведомления об авторских правах.
* Использовать логотипы OMG, UML, UML Cube Logo и знаки `®`/`™`; использовать
  название «OMG UML» как часть названия продукта.
* Писать «соответствует UML 2.5.1» / «UML-compliant» / «сертифицировано OMG».
  Разрешённая формулировка при неполном соответствии — только «основано на
  этой спецификации» (`COMPLIANCE`).
* Вставлять текст стандарта в обучающие материалы, посты и документацию
  продукта.

### 4.5 Рисунки пособия (`app/reference/vp163/`, 22 МБ)

Это 54 снимка интерфейса Visual Paradigm 16.3 из учебного пособия ВМК МГУ
(автор — Малышко В. В.). Здесь пересекаются два чужих права: на интерфейс
программы (Visual Paradigm) и на само пособие.

Пособие говорит об этом прямо, и текст перенесён в `docs/uml-tutorial.md`
дословно:

> Размещение на других ресурсах, а также коммерческое использование материалов, опубликованных в данном разделе, возможно только с разрешения автора. По всем вопросам пишите: notice@kunni-course.site
>
> © Кафедра системного программирования ВМК МГУ.
> (адрес автора в цитате заменён на проектный notice@kunni-course.site)

**Что с ними делать в справочнике: не показывать.** Ни в справочнике, ни в
обучающих экранах, ни в поставке. Обоснование и что вместо:

1. **Снимки остаются тем, чем они и были, — доказательством для обмеров.**
   Сейчас `app/` ссылается на них только так: `docs/MEASUREMENTS-AUDIT.md` и
   поля `source` в `app/mechanics.json` («измерено по `reference/vp163/1001.png`»).
   Это законное использование внутри разработки; в поставку они не идут.
2. **Описания рисунков у нас свои.** `app/reference/vp163/INDEX.md` содержит
   русские описания того, что показано на каждом рисунке, написанные по тексту
   упражнения, а не скопированные alt-тексты. Именно они и должны попасть в
   справочник — как «что показывает рис. 4.3.6», без самой картинки.
3. **Вместо картинок — своя графика.** У нас есть `app/notation/uml.json`
   (51 фигура, 27 связей) и 48 моделей корпуса в `tests/corpus/`: любой пример
   из пособия рисуется нашим редактором и выглядит как наш продукт. Это и
   честнее, и полезнее для читателя.
4. **Если снимок нужен как историческая справка** — только с письменного
   разрешения автора пособия и с подписью «© ВМК МГУ, использовано с
   разрешения». Пока такого разрешения нет, вопрос закрыт.

То же относится к `docs/uml-tutorial.md`: это перенос текста пособия «без
изменения содержания» (296 КБ), то есть копия, а не пересказ. Показывать его
в приложении нельзя; в справочнике допустимы собственные формулировки
упражнений и ссылки на номера.

### 4.6 Что нужно уточнить у человека

Из текста лицензии **не следует** ответ на три вопроса, и я не буду делать вид,
что следует:

1. **Считаются ли «копией спецификации» номера и названия пунктов.** Наша
   позиция: заголовки и номера — это факты о структуре документа, а дерево
   `spec-tree.json` — производные данные, а не воспроизведение. Но формально
   заголовки — авторский текст, и это вопрос к юристу, а не к инженеру.
2. **Меняет ли что-то локальный, непубличный экземпляр.** Условие (2)
   запрещает «posted on any network computer»; если справочник работает только
   на машине пользователя, без сервера, формулировка читается иначе. Для
   веб-редактора это не наш случай, но для настольной сборки — вопрос.
3. **Можно ли перепечатать отдельные инварианты OCL.** 456 строк `inv:` —
   это код на OCL, и именно они нужны правилам. Мы уже переносим 23 из них в
   `docs/rules-uml-2.5.1.json` дословно. Пока это внутренний материал; для
   поставки нужно либо разрешение, либо переписанные своими словами проверки
   без цитаты.

**Безопасный вариант по умолчанию**, если ответов не будет: справочник
показывает **номера и названия пунктов, имена ограничений, перекрёстные ссылки
и ссылку на omg.org**, полный текст — только если пользователь сам положил PDF
рядом (или открывает его на omg.org). Никаких цитат из стандарта в интерфейсе.
Это ровно то, что уже готово в `spec-tree.json` и `crossrefs.json`: оба файла
не содержат текста стандарта, кроме заголовков и имён ограничений.

---

## 5. Чего в материале не хватает

Справочник «от А до Я» сейчас собрать не из чего: есть английский стандарт,
номера пунктов и по одной строке на фигуру. Ниже — измеренные пробелы.

| Пробел | Что есть | Что нужно | Оценка |
|---|---|---|---|
| **Описания фигур по-русски** | `label` + `hint` = 2 091 знак на все 51 фигуру, в среднем 41 знак | определение, когда применять, варианты нотации, чем отличается от соседней фигуры — 1 200–1 800 знаков на фигуру | **61–92 тыс. знаков**; самый большой пробел |
| **Семантика связей** | 27 связей, 1 095 знаков `label`+`hint` (41 на связь) | что связь означает в модели, кратности, навигация, направление чтения, отличие агрегации от композиции словами | 16–24 тыс. знаков |
| **Типы диаграмм** | 14 типов, поле `what` — 501 знак на все (36 на тип) | статья на тип: назначение, состав элементов, когда выбирать | 28–42 тыс. знаков |
| **Примеры на фигуру** | 48 моделей корпуса на 54 рисунка, но они про один домен (регистрация на курсы) | по одной минимальной модели на фигуру и связь | **78 моделей** |
| **Правила** | 23 правила; покрывают 9 фигур из 51 и 6 связей из 27 | в стандарте 456 инвариантов; довести до ~80 правил, которые редактор реально умеет проверять | **~57 правил**, каждое: текст, OCL, проверка, тест |
| **Связь PlantUML ↔ нотация** | 169 конструкций с синтаксисом и пояснением | какой фигуре/связи соответствует каждая конструкция | 169 записей, ~8–12 тыс. знаков |
| **Словарь терминов RU↔EN** | 95 пар в глоссарии индекса (38 выведены из подписей фигур, 57 ручных) | 300–400 пар с определениями — основа для поиска и для перевода интерфейса | 25–35 тыс. знаков |
| **Стереотипы: разбор 204 записей** | 428 записей, 224 получили фигуру, 204 — нет (base-тип `Attribute`, `BMMRelationship`, `Operation`…) | решение по каждой: показывать из строки атрибута, не показывать вовсе, или это вообще не UML (BMM, ArchiMate) | таблица решений, 1–2 дня |
| **«См. также» между фигурами** | нет | по 3–5 связей на фигуру: чем отличается, с чем путают | 51 × 5 = ~255 связей |
| **Русские подписи к рисункам стандарта** | нет (в стандарте ASCII-арт) | перерисовать ключевые диаграммы абстрактного синтаксиса своим редактором — 9 рисунков в разделе 11, 6 в 14 и т. д. | ~40 перерисовок |

Порядок, в котором это стоит писать:

1. **Описания фигур** — без них справочник показывает английский пункт и
   русскую строку в 41 знак, то есть не объясняет ничего. Это же и самый
   дорогой пункт.
2. **Правила** — они дают немедленную пользу в редакторе (проверка модели), и
   материал для них уже разобран: пункт, OCL и имя ограничения есть у всех 456
   инвариантов, а механизм проверки — в `docs/rules-uml-2.5.1.json`.
3. **Семантика связей и типы диаграмм** — закрывают «от А до Я» для новичка.
4. **Примеры на фигуру** — после того как есть тексты: пример без объяснения
   бесполезен.

Чего в материале **нет совсем** и что нельзя вывести из имеющегося:

* русского объяснения, чем `aggregation` отличается от `composition` (в
  стандарте это одна строка `AggregationKind::shared` / `composite`);
* семантики связей `trace`, `manifest`, `usage` — они есть в нотации, но не
  описаны ни в одном нашем документе;
* ответа на вопрос «какую диаграмму выбрать» — `docs/DIAGRAM-TYPES.md` (959
  строк) описывает типы, но не сравнивает их;
* связи между 169 конструкциями PlantUML и 51 фигурой;
* русских названий для 97 base-типов стереотипов;
* определений терминов: глоссарий даёт пары «слово ↔ слово», но не
  объясняет, что термин значит.

---

## 6. Ограничения этой работы

* `app/` не изменялся ни одним файлом; всё, что оттуда читалось
  (`app/notation/uml.json`, `app/reference/vp163/INDEX.md`), только читалось.
* `reference/spec/md/`, `docs/*.md` (кроме этого файла), `tests/`,
  `material/corpus-layout/`, `material/pictograms/`,
  `material/stereotype-audit/` — только чтение.
* Скрипты на stdlib Python и на Node без пакетов; ничего не устанавливалось.
* Текст стандарта в `spec-tree.json` не копируется: только номера, заголовки,
  имена ограничений и перекрёстные ссылки. Текст лежит в `spec-sections/`,
  которые, согласно разделу 4, в поставку идти не могут, — это внутренний
  материал для сборки справочника.
* Ссылки «see 11.5.3» извлекаются регулярными выражениями по прозе. Ссылки,
  записанные словами без номера («see the Associations sub clause»), не
  находятся; их в тексте немного, но они есть.
* Раздел `Annex B` (Diagram Interchange, 113 КБ) нарезан и проиндексирован, но
  ни одна фигура нотации на него не ссылается: он описывает обмен диаграммами,
  а не элементы модели. Для справочника он, вероятно, не нужен вовсе.
