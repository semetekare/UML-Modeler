# Приложение C: Ключевые слова

> **UML 2.5.1** (formal/2017-12-05) · Приложение C · печатные стр. 745–755 · PDF стр. 787–797

Приложение C: Ключевые слова

(нормативное)

Ключевые слова UML — зарезервированные слова, являющиеся неотъемлемой частью нотации UML; обычно они появляются как текстовые аннотации, присоединённые к графическому элементу UML, или как часть текстовой строки на диаграмме UML.

В UML ключевые слова используются для трёх разных целей:

1. Чтобы отличить конкретное понятие UML (метакласс) от других, имеющих ту же общую графическую форму. Например, ключевое слово «interface» в заголовке прямоугольника классификатора используется, чтобы отличить интерфейс от других видов классификаторов.

2. Чтобы отличить конкретный вид связи между понятиями UML (метаассоциацию) от других связей, имеющих ту же общую графическую форму. Например, пунктирные линии между элементами используются для ряда разных связей, включая зависимости, связи между вариантами использования и расширяющими вариантами использования, и т. д.

3. Чтобы задать значение некоторого модификатора, присоединённого к понятию UML (значение метаатрибута). Так, ключевое слово «singleExecution», появляющееся внутри деятельности, означает, что атрибут “isSingleExecution” этой деятельности истинен.

Ключевые слова всегда заключены в кавычки-ёлочки («keyword»), которые служат визуальной подсказкой, позволяющей легче распознать, что используется ключевое слово.

ПРИМЕЧАНИЕ. Кавычки-ёлочки — особый вид кавычек, и их не следует путать с удвоенными символами «больше» (>>) или «меньше» (<<) и не следует ими заменять, кроме ситуаций, когда доступный набор символов может не содержать кавычек-ёлочек.

Помимо идентификации ключевых слов, кавычки-ёлочки используются также для различения применения стереотипов. Это означает, что:

- не все слова, появляющиеся между кавычками-ёлочками, обязательно являются ключевыми словами, и

- слова, появляющиеся в кавычках-ёлочках, не обязательно представляют стереотипы.

Если к одному и тому же элементу модели применяется несколько ключевых слов и/или имён стереотипов, каждый стереотип может быть заключён в отдельную пару кавычек-ёлочек и перечислен один за другим. Либо все они появляются между одной парой кавычек-ёлочек, разделённые запятыми:

“«” <label> [“,” <label>]* “»”, где:

<label> ::= <keyword> | <stereotype-label>

Ключевые слова контекстно-зависимы, и в некоторых случаях одно и то же ключевое слово используется для разных целей в разных контекстах. Например, ключевое слово «create» может появляться рядом с именем операции, указывая, что это операция-конструктор, и может также использоваться для маркировки зависимости использования между двумя классами, указывая, что один класс создаёт экземпляры другого. Это означает, что в принципе можно использовать ключевое слово для определяемого пользователем стереотипа (при условии, что оно используется в контексте, не конфликтующем с контекстом ключевого слова). Однако такие приёмы не рекомендуются, поскольку они, вероятно, приведут к путанице.

Ключевые слова, определённые в настоящее время в составе стандартного UML, перечислены в таблице C.1 в алфавитном порядке. Ниже даётся истолкование отдельных столбцов этой таблицы:

- Ключевое слово даёт точное написание ключевого слова (без кавычек-ёлочек).

- Элемент метамодели указывает элемент метамодели UML (метакласс или характеристику метакласса), который обозначает ключевое слово.

- Семантика даёт краткое описание семантики ключевого слова (дальнейшие пояснения см. ниже); более подробные пояснения даны в подпунктах «Нотация» описания соответствующего метакласса. Используются следующие форматы:

  1   Если запись содержит имя метакласса или характеристики UML, это указывает, что ключевое слово просто используется для идентификации соответствующего метакласса или характеристики.

  2   Если запись является ограничением (обычно, но не обязательно выражением OCL), она задаёт ограничение, применимое к элементам метамодели, помеченным этим ключевым словом.

- Размещение в нотации указывает, где появляется ключевое слово (дальнейшие пояснения см. ниже). Для задания размещения в нотации используются следующие соглашения:

  1   “box header” означает, что ключевое слово появляется в разделе имени прямоугольника классификатора.

  2   “dashed-line label” означает, что ключевое слово используется как метка на некоторой пунктирной линии, например на зависимости.

  3   ‘line label” означает, что ключевое слово используется как метка на некоторой линии.

  4   “inline label” означает, что ключевое слово появляется как часть текстовой строки (обычно в начале), например определения атрибута.

  5   “swimlane header” означает, что ключевое слово появляется как заголовок дорожки на диаграмме деятельности.

  6   “note label” означает, что ключевое слово используется в символе примечания.

  7   “top left corner” означает, что ключевое слово появляется в левом верхнем углу символа.

  8   “after name” означает, что ключевое слово появляется после имени связанного элемента.

Table C.1 Keywords

Keyword               Metamodel Element                         Semantics                Notation Placement abstraction                  Abstraction                       Abstraction                        dashed-line label

access                       PackageImport                     visibility <>                      dashed-line label

VisibilityKind::public

activity                     Activity                          Activity                           box header

actor                        Actor                             Actor                              box header

apply                        ProfileApplication                ProfileApplication                 dashed-line label

artifact                     Artifact                          Artifact                           box header

centralBuffer                CentralBufferNode                 CentralBufferNode                  box header

Keyword            Metamodel Element                 Semantics           Notation Placement bind                    TemplateBinding           TemplateBinding                dashed-line label

collaboration           Collaboration             Collaboration                  box header

component               Component                 Component                      box header

datastore               DataStoreNode             DataStoreNode                  box header

dataType                DataType                  DataType                       box header

decisionInput           Behavior                  DecisionNode::decisionInput    note label

decisionInputFlow       ObjectFlow                DecisionNode::decisionInputFl line label

ow

deploy                  Deployment                Deployment                     dashed-line label

deployment spec         DeploymentSpecification   DeploymentSpecification        box header

device                  Device                    Device                         box header

element access          ElementImport             visibility <>                  dashed-line label

VisibilityKind::public

element import          ElementImport             visibility =                   dashed-line label

VisibilityKind::public

enumeration             Enumeration               Enumeration                    box header

executionEnvironment    ExecutionEnvironment      ExecutionEnvironment           box header

extend                  Extend                    Extend                         dashed-line label

extended                Region                    extendedRegion->notEmpty()     after name

extended                StateMachine              extendedStateMachine-          after name

>notEmpty()

external                ActivityPartition         isExternal = true              swimlane header

final                   State                     State::isLeaf                  After name

flow                    InformationFlow           InformationFlow                dashed-line label

import                  PackageImport             visibility =                   dashed-line label

VisibilityKind::public

include                 Include                   Include                        dashed-line label

information             InformationItem           InformationItem                box header

interface               Interface                 Interface                      box header

iterative               ExpansionRegion           mode =                         top left corner

ExpansionKind::iterative

localPostcondition      Constraint                Action::localPostcondition     box header

localPrecondition       Constraint                Action::localPrecondition      box header

Keyword      Metamodel Element                     Semantics               Notation Placement manifest            Manifestation                  Manifestation                    dashed-line label

merge               PackageMerge                   PackageMerge                     dashed-line label

model               Model                          Model                            box header

multicast           ObjectFlow                     isMulticast =true                line label

multireceive        ObjectFlow                     isMultireceive = true            line label

occurrence          CollaborationUse               CollaborationUse                 dashed-line label

parallel            ExpansionRegion                mode =                           top left corner

ExpansionKind::parallel

postcondition       Constraint                     Behavior::postcondition          box header

protocol            ProtocolStateMachine           ProtocolStateMachine             after name / box header

precondition        Constraint                     Behavior::precondition           box header

primitive           PrimitiveType                  PrimitiveType                    box header

profile             Profile                        Profile                          box header

reference           ElementImport                  Profile::metaclassReference      dashed-line label

reference           PackageImport                  Profile::metamodelReference      dashed-line label

representation      InformationItem::represented   represented                      dashed-line label

selection           Behavior                       ObjectFlow::selection            note label

signal              Signal                         Signal                           box header

singleExecution     Activity                       isSingleExecution = true         inside box

statemachine        StateMachine                   StateMachine                     box header

stream              ExpansionRegion                mode =                           top left corner

ExpansionKind::stream

Stereotype          Stereotype                     Stereotype                       box header

strict              ProfileApplication             isStrict = true                  dashed-line label

structured          StructuredActivityNode         StructuredActivityNode           box header

substitute          Substitution                   Substitution                     dashed-line label

transformation      Behavior                       ObjectFlow::transformation       note label

use                 Usage                          Usage                            dashed-line label

Annex D: Табличная нотация для диаграмм последовательности

(нормативное)

В этом приложении описывается необязательная табличная нотация для диаграмм последовательности. Описания строк таблицы для этой нотации таковы:

1. Класс линии жизни: обозначает имя класса линии жизни. Если на символе линии жизни нет имени класса, это имя класса опускается.

2. Экземпляр линии жизни: обозначает имя экземпляра линии жизни. Если на символе линии жизни нет имени экземпляра, это имя экземпляра опускается.

3. Ограничение: обозначает некоторого рода ограничение. Например, указание наклонной линии обозначается как “{delay}.” Для представления комбинированных фрагментов их операторы обозначаются индексом в квадратных скобках. В случае использования взаимодействия это показывается как заключённый в скобки “Diagram ID”, который обозначает указанную диаграмму взаимодействия, с тегом “ref”, например “ref(M.sq).”

4. Класс отправки сообщения: обозначает имя класса, отправляющего сообщение, для каждой входящей стрелки.

5. Экземпляр отправки сообщения: обозначает имя экземпляра, отправляющего сообщение, для каждой входящей стрелки. В случае сообщения через шлюз, являющегося исходящим сообщением из использования взаимодействия, оно показывается как заключённый в скобки “Diagram ID”, который обозначает указанную диаграмму взаимодействия, с подчёркиванием, например “_(M.sq).”

6. Diagram ID: идентифицирует документ, описывающий соответствующую диаграмму последовательности или коммуникации, и может быть именем файла, содержащего соответствующую диаграмму последовательности или коммуникации.

7. Имя порождённого экземпляра: идентифицирующее имя, которое даётся каждому символу экземпляра на диаграмме последовательности или коммуникации. Идентифицирующее имя уникально в каждом документе.

8. Номер последовательности: соответствующий номер сообщения на диаграмме последовательности или коммуникации.

9. Слабой порядок: обозначает частичные (относительные) порядки событий, упорядоченные на отдельных линиях жизни и между линиями жизни, при том что событие получения сообщения должно произойти после события его отправки. События показываются как “e” + порядок события + направление события (входящее или исходящее).

10 Имя сообщения: соответствующее имя сообщения на диаграмме последовательности или коммуникации.

11 Параметр: набор имён переменных-параметров и типов параметров соответствующего сообщения на

диаграммах последовательности или коммуникации.

12 Возвращаемое значение: тип возвращаемого значения соответствующего сообщения на диаграмме последовательности или коммуникации.

13 Класс получения сообщения: обозначает имя класса, получающего сообщение, для каждой исходящей стрелки.

14 Экземпляр получения сообщения: обозначает имя экземпляра, получающего сообщение, для каждой исходящей стрелки. В

случае сообщения через шлюз, являющегося исходящим сообщением от обычного символа экземпляра, оно показывается как заключённое в скобки

имя сообщения с тегом “out_”, например “(out_s).”

15 Другой конец: обозначает порядок события на другом конце каждого сообщения.

D.1                       Примеры

Рисунок D.1 Диаграмма последовательности, дополненная идентификацией вхождений событий

Table D.1 Interaction Table describing Figure D.1

Message Receiving   Message Receiving

Sequence Number

Message Sending   Message Sending

Lifeline Instance

Generated

Lifeline Class                          Constraint                                       Diagram ID                                       Weak Order   Message Name   Parameter    Return Value   Class               Instance              Other End

Classs            Instance                       Instance Name

C                                                                    N.sq                                             e1o              t                                                                B               e2i

B                                                       C            N.sq                                             e2i              t                                                                                e1o

A                Ref(M.sq)                                           N.sq                                           e3o(ref)           s                                                                C               e4i

B                Ref(M.sq)                                           N.sq                                           e3o(ref)           s                                                                C               e4i

C                                                  _(M.sq) N.sq                                                       e4i              s                                                                              e3o(ref)

C                alt[1]x==5                                          N.sq                                             e5o             u                                                                 B               e6i

B                alt[1]x==5                                          N.sq                                             e6i             u                                                                                 e5o

C                alt[2]x==0                                          N.sq                                             e7o             v                                                           out_v

Рисунок D.2 Диаграмма последовательности со сторожами, параллельной композицией и альтернативами

Таблица D.2 Таблица взаимодействия для рисунка D.2

Message Receiving   Message Receiving

Sequence Number

Message Sending   Message Sending

Lifeline Instance

Generated

Lifeline Class                           Constraint                                        Diagram ID                                     Weak Order   Message Name   Parameter   Return Value   Class               Instance            Other End

Classs            Instance                        Instance Name

A                   par[1]                                            para.sq                                         e1o             x

A                par[2].alt[1]                        in_y            para.sq                                         e2i             y                                                          out_x

{after e1o}

a>0

A                par[2].alt[2]                        in_z            para.sq                                         e3i             z

else

Annex E: XMI Serialization and Schema

(normative)

E.1       Краткое описание

Модели UML 2 сериализуются в XMI 2 по правилам, указанным в спецификации отображения MOF 2 в XMI.

Как это принято в OMG, нормативным представлением моделей MOF 2 и UML 2 является XMI-файл. Нормативный XMI-документ для самого UML 2 состоит из одного XMI-документа. Есть связанные XMI-документы, задающие StandardProfile и модель обмена диаграммами UML (UML Diagram Interchange). PrimitiveTypes, от которых зависит UML 2 и могут зависеть другие спецификации, задан в отдельном XMI-документе.

E.2       Сериализация метамодели UML 2 в XMI

XMI допускает использование тегов для настройки порождаемых схем и порождаемых документов. Ниже приведены настройки тегов, которые используются в метамодели UML 2 для XMI-обмена моделями UML 2:

- тег “org.omg.xmi.nsPrefix” со значением “uml”

Другие теги явно не устанавливаются, что означает, что они принимают значения по умолчанию, документированные в спецификации отображений MOF 2 в XMI.

Значения xmi:ids для элементов метамодели в UML 2.5 совпадают с таковыми для эквивалентных элементов в UML 2.4.1, кроме идентификаторов, соответствующих ассоциациям и свойствам, имя которых изменилось между UML 2.4.1 и UML 2.5. Метаклассы и ассоциации в UML 2.5 организованы в структуру пакетов, соответствующую структуре пунктов спецификации. Все эти пакеты импортируются в пакет верхнего уровня UML, так что все элементы метамодели можно упоминать неквалифицированно в пакете верхнего уровня.

Изменения, внесённые в метамодель по сравнению с 2.4.1, включают: описанную выше организацию пакетов; объединение StandardProfileL2 и StandardProfileL3 в единый StandardProfile; ослабление (до 0) некоторых нижних кратностей для представления значений по умолчанию; введение ordered у некоторых свойств для уточнения семантики; переименование некоторых свойств, принадлежащих ассоциациям, и соответствующих ассоциаций; придание NamedElement::clientDependency производности; и определение LoopNodes как владельцев своих loopVariables. Как следствие, файлы моделей UML 2.5 и UML 2.4.1 взаимозаменяемы при замене номеров версий, за исключением:

- loopVariables у LoopNodes (которые нельзя было обменять стандартным способом в UML 2.4.1);

- NamedElements, являющихся клиентами зависимостей, которые в UML 2.4.1 содержали бы атрибут clientDependency;

- ссылок на StandardProfile.

Кроме LoopNodes, инструмент UML 2.4.1 должен уметь загрузить XMI модели UML 2.5, если номера версий исправлены обратно на 20110701 и всем NamedElements, являющимся клиентами зависимостей, вставлен атрибут clientDependency. Кроме того, если в модели UML 2.5 есть ссылки на StandardProfile, то вместо них придётся использовать ссылки на http://www.omg.org/spec/UML/20110701/StandardProfileL2 или http://www.omg.org/spec/UML/20110701/StandardProfileL3, либо на оба.

Соответствующий инструмент UML 2.5 должен уметь загружать и сохранять модели как UML 2.5, так и UML 2.4.1.

ПРИМЕЧАНИЕ. Поскольку в UML 2.5 формализовано гораздо больше ограничений OCL, возможно, что модель, проходящая проверку в инструменте UML 2.4.1, не пройдёт её в инструменте UML 2.5.

E.3       XMI-сериализация библиотеки моделей PrimitiveTypes

Ниже приведены настройки тегов, которые используются в библиотеке моделей PrimitiveTypes для XMI-обмена моделями, импортирующими эту библиотеку прямо или косвенно:

- тег “org.omg.xmi.nsPrefix” со значением “primitives”

- для PrimitiveTypes::Boolean тег “org.omg.xmi.schemaType” со значением “http://www.w3.org/2001/XMLSchema#boolean”

- для PrimitiveTypes::Integer тег “org.omg.xmi.schemaType” со значением “http://www.w3.org/2001/XMLSchema#integer”

- для PrimitiveTypes::Real тег “org.omg.xmi.schemaType” со значением “http://www.w3.org/2001/XMLSchema#double”

- для PrimitiveTypes::String тег “org.omg.xmi.schemaType” со значением “http://www.w3.org/2001/XMLSchema#string”

- для PrimitiveTypes::UnlimitedNatural тег “org.omg.xmi.schemaType” со значением “http://www.w3.org/2001/XMLSchema#string”

Неограниченное значение UnlimitedNatural, нотацией которого является “*”, должно сериализоваться как “*”, тогда как все числовые значения UnlimitedNatural должны сериализоваться как строковое представление числа в виде целого.

E.4        XMI-сериализация StandardProfile

Ниже приведены настройки тегов, которые используются в профиле StandardProfile для XMI-обмена моделями, импортирующими этот профиль прямо или косвенно:

- тег “org.omg.xmi.nsPrefix” со значением “StandardProfile”

E.5        XMI-сериализация UMLDI

Ниже приведены настройки тегов, которые используются в расширении метамодели UMLDI для XMI-обмена моделями диаграмм:

- тег “org.omg.xmi.nsPrefix” со значением “umldi”
