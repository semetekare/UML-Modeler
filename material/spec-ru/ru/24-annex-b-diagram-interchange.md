# Annex B: UML Diagram Interchange

> **UML 2.5.1** (formal/2017-12-05) · Annex B · printed pp. 687–744 · PDF pp. 729–786

Приложение B: Обмен диаграммами UML

(normative)

B.1       Summary

Это приложение обеспечивает обмен чисто графическими аспектами моделей UML, которыми управляют моделировщики, — например, положением фигур на диаграмме и точками излома линий (UML DI). Эти сведения необходимо передавать между инструментами, чтобы надёжно воспроизводить диаграммы UML. Приложение не касается тех графических аспектов моделей UML, которые определяются самим UML, а не моделировщиком, — например, большинства геометрических форм и стилей линий для различных видов элементов модели. Эти сведения одинаковы для всех диаграмм, соответствующих UML, и передавать их не нужно. Инструменты могут определять, какая часть UML задаёт непередаваемые графические аспекты, по ссылкам между передаваемыми сведениями диаграммы и передаваемыми экземплярами абстрактного синтаксиса.

UML DI основан на спецификации Diagram Definition (DD, http://www.omg.org/spec/DD), а именно на её пакетах Diagram Interchange (DI) и Diagram Common (DC). Как неформально показано на рисунке B.1, UML DI специализирует классы и ассоциации из DI и ссылается на элементы абстрактного синтаксиса UML, чтобы задать обмен диаграммами для этих элементов. Диаграммы UML передаются созданием экземпляров классов и ассоциаций в абстрактном синтаксисе UML и в UML DI с последующим связыванием их ссылками. На рисунке B.1 внизу слева показан экземпляр UseCase из абстрактного синтаксиса UML и экземпляр UMLShape из UMLDI, ссылающийся на него. Экземпляр фигуры задаёт положение графики на диаграмме и содержащуюся в нём метку. Отметим, что экземпляров времени выполнения из-за UML DI не возникает, так как диаграммы — элементы только времени проектирования. Стереотипы могут основываться на элементах UML DI и применяться к экземплярам этих элементов. Соответствующие инструменты должны давать применениям стереотипов семантику, эквивалентную MOF, и XMI-сериализацию, как указано в подпункте 12.3.3.

Рисунок B.1 Архитектура обмена диаграммами UML

Получатели файлов обмена, содержащих экземпляры элементов UML DI, отображают эти экземпляры визуально так, как задано UML. В большинстве случаев отображение можно определить, используя только положение и размеры, заданные экземплярами UML DI, указанные экземпляры абстрактного синтаксиса UML и спецификацию нотации UML. Там, где UML даёт несколько нотаций на выбор для одного и того же абстрактного синтаксиса, UML DI содержит дополнительные сведения, указывающие, какую нотацию следует использовать.

B.2           Generic B.2.1         Summary

Общая часть UML DI фиксирует графические аспекты, общие для нескольких видов диаграмм UML.

B.2.2         UML Diagrams and Diagram Elements

DI::DiagramElement {redefines owningElement}

+ owningElement                                    {subsets diagramElement}

UMLDiagramElement         + umlDiagramElement           *

UML::CommonStructure::Element

0..1    isIcon : Boolean = false   *                + modelElement

+ ownedElement *                          {redefines modelElement}

{ordered, redefines

ownedElement}                           UML::CommonStructure::PackageableElement

DI::Diagram

UMLDiagram                                                    + heading

*

isFrame : Boolean = true                                                                                   UMLLabel

isIso : Boolean = true                                                       + headedDiagram        0..1

isInheritedLighter : Boolean = false

Рисунок B.2 Диаграммы UML и элементы диаграмм

Модель на рисунке B.2 специализирует DI::Diagram и DI::DiagramElement в UMLDiagram и UMLDiagramElement соответственно, чтобы сделать UMLDiagram конкретным, добавить свойства и ассоциации и переопределить унаследованные свойства.

UMLDiagramElement — самый общий класс для UML DI. Он переопределяет modelElement из DI::DiagramElement, чтобы ограничить UMLDiagramElement нотацией для элементов UML, а не для иных элементов языка. Он также переопределяет ownedElement из DI::DiagramElement, чтобы ограничить UMLDiagramElement владением только UMLDiagramElement и сделать его упорядоченным (о том, как элементы диаграммы скрывают друг друга, см. спецификацию DD). Он вводит isIcon для modelElements, которые могут показываться геометрическими фигурами, отличными от прямоугольников, например актёры, или линиями, отличными от сплошной с открытым наконечником, например реализация. Значение true для isIcon указывает, что следует отображать альтернативную нотацию. UMLShape могут использовать обе нотации одновременно, причём маленькая альтернативная нотация отображается внутри обычной. Это передаётся как два UMLShape с одним и тем же modelElement: у одного значение isIcon равно false, у другого true, причём первый имеет второй в качестве ownedElement и имеет значительно большие границы, чем второй.

Несколько замечаний о UMLDiagramElement:

- ownedElements элементов UMLDiagramElement могут иметь границы, не пересекающиеся (визуально находящиеся вне) с границами своих owningElements.

- modelElements принадлежащих элементов (ownedElements) элементов UMLDiagramElement могут иметь иных владельцев, чем modelElements элементов owningElements.

UMLDiagram — самый общий класс для диаграмм UML и корень таксономии диаграмм, определённой в этом приложении (см. также рисунок A.5 в Приложении A). Он специализирован от PackageableElement, чтобы принадлежать пакетам. UMLDiagram вводит isFrame, указывающий, следует ли показывать рамки диаграмм (см. Приложение A). Если isFrame имеет значение true, heading должен задавать строку, показываемую в пятиугольном заголовке рамки (о UMLLabel см. подпункт B.2.4). У heading должен быть тот же modelElement, что и у его headedDiagram, если таковой есть. Вид диаграммы в заголовке следует отображать полужирным шрифтом. UMLDiagram также вводит isIso, указывающий, следует ли придерживаться правил нотации ISO. Он вводит isInheritedLighter, указывающий, следует ли показывать унаследованные элементы более светлым цветом.

B.2.3         UML Shapes and Edges

DI::Edge

UMLDiagramElement

+ source     1       1

+ target

{redefines source}                {redefines target}

+ sourceEdge

UMLEdge

{redefines sourceEdge}

* DI::Shape       UMLDiagramElement

+ targetEdge

{redefines targetEdge}

UMLShape

*

Рисунок B.3 Фигуры и рёбра UML

Модель на рисунке B.3 специализирует DI::Shape и DI::Edge в UMLShape и UMLEdge соответственно, чтобы сделать их конкретными и переопределить унаследованные свойства.

UMLShape — самый общий класс для элементов UMLDiagramElement, которые никогда не отображаются линиями. Несколько замечаний о UMLShape:

- UMLShape, не являющиеся UMLLabel, не имеющие modelElements и имеющие единственным ownedElement одну UMLLabel (включая специализации) хотя бы с одним modelElement, следует отображать как символы примечаний. UMLEdge между такими UMLShape и другими UMLDiagramElement следует отображать пунктирными линиями.

- Стрелки, показывающие зависимость более чем с двумя концами, передаются как UMLEdge, у которых modelElement — эта зависимость, а источник или цель — UMLShape с этой зависимостью в качестве modelElement. Если границы этого UMLShape дают площадь больше нуля, его следует отображать как точку, иначе для UMLShape ничего не отображается. Все UMLLabel, аннотирующие эту зависимость, должны принадлежать этому UMLShape.

UMLEdge — самый общий класс для элементов UMLDiagramElement, которые всегда отображаются линиями. Он переопределяет source и target из DI::Edge, чтобы ограничить UMLEdge связыванием элементов UMLDiagramElement.

B.2.4         Labels

UMLShape

UMLLabel

text : String

{redefines umlDiagramElement}

+ umlDiagramElement

UMLKeywordLabel                      UMLNameLabel

*             {redefines modelElement}

+ modeElement

1 UMLTypedElementLabel          UMLRedefinesLabel

UML::CommonStructure::NamedElement {redefines umlDiagramElement} *          {redefines modelElement}

+ umlDiagramElement                       + modelElement

UML::Classification::RedefinableElement

1

Figure B.4 Labels

Модель на рисунке B.4 специализирует UMLShape в самый общий класс для фигур, которые следует отображать только как символьные строки (UMLLabel), и специализирует его в различные виды меток, используемые во многих видах диаграмм UML. Специализации UMLLabel позволяют получателям файлов обмена определять, какие части modelElements предполагается показывать, что даёт им возможность обновлять отображение при изменении частей modelElements. Например, получателям нужно знать, когда UMLLabel предназначена для показа имени своего modelElement, чтобы обновлять отображаемую строку

при изменении имени modelElement. В этом случае следует использовать UMLNameLabel, чтобы указать намерение. Специализации UMLLabel вводятся только тогда, когда неоднозначно или затруднительно определить разбором текста, какие части modelElements предполагается показывать, как задаёт UML. Многие строки передаются с экземплярами UMLLabel, не являющимися экземплярами её специализаций. Все UMLLabel должны иметь хотя бы один modelElement, кроме тех, что классифицированы только UMLLabel и ни одной из её специализаций, — у них modelElements может не быть (большинство UMLLabel ограничены ровно одним modelElement). modelElements должны совпадать с таковыми у помечаемого UMLDiagramElement, если они есть, кроме случаев, оговорённых в этом приложении, и должны быть ownedElements этого UMLDiagramElement, в том числе когда UMLLabel расположена вне UMLDiagramElement (не все UMLLabel располагаются рядом с UMLDiagramElement с теми же modelElements — например, UMLLabel в UMLCompartment, показывающих свойства классификаторов). Это позволяет получателям файлов обмена определять, где размещать отображения UMLLabel при изменении положений отображений помечаемого UMLDiagramElement, в частности когда несколько UMLDiagramElement на одной UMLDiagram имеют тот же modelElement, что и UMLLabel. Все UMLLabel должны иметь значение false для isIcon. UMLLabel всегда должны задавать отображаемый текст, соответствующий спецификациям UML для маркировки каждого вида modelElement, включая BNF, если она есть.

Специализации UMLLabel служат для показа сведений о тех частях их modelElements, которые определены типом modelElement Property. Например, modelElement у UMLNameLabel ограничен NamedElement, у которых есть свойства name и visibility, и именно эти части modelElement показывает UMLNameLabel. Если ни одна специализация не показывает всех нужных сведений, используйте UMLLabel напрямую. Например, широкий диапазон сведений о свойствах показывается текстом в UMLCompartment, включая переопределение и значения по умолчанию. Текст для этих свойств следует передавать напрямую с UMLLabel (см. подпункт B.3.3), даже если он содержит только имя и видимость.

UMLNameLabel служат для показа сведений об именованных элементах, что всегда включает их имя, или nameExpression, или псевдоним ElementImport, если именованный элемент импортирован, и может также включать принадлежность пакету (полные имена) и видимость.

UMLKeywordLabel служат для показа различных видов сведений о modelElements с использованием формулировок и пунктуации, заданных UML, в кавычках-ёлочках (см. Приложение C). UMLKeyword должны иметь ровно один modelElement. Текст должен включать только кавычки-ёлочки и ключевое слово.

UMLTypedElementLabel служит для показа сведений об имени, типе и роли ровно одного Slot, InstanceSpecification, InstanceValue или элемента с типом, например TypedElement или Connector. Несколько других замечаний о передаче UMLTypedElementLabel:

- Если modelElement — Slot, текст может включать имя definingFeature, имя типа definingFeature и значение modelElement.

- Если modelElement — InstanceSpecification или InstanceValue, текст может включать имя InstanceSpecification или экземпляра InstanceValue и имена классификаторов этого InstanceSpecification или экземпляра InstanceValue.

- Если modelElement — InstanceSpecification, у которого есть specification, текст может включать эту спецификацию.

- Если modelElement — InstanceValue, являющийся значением слота InstanceSpecification, классификатор которого — StructuredClassifier, и UMLTypedElementLabel находится в фигуре с этим InstanceValue в качестве modelElement, на UMLCompositeStructureDiagram, у которой modelElement — этот InstanceSpecification (см. подпункт 11.2.4), текст может включать имя Property, являющегося определяющим definingFeature слота, которому принадлежит InstanceValue, являющийся modelElement этой UMLTypedElementLabel.

- Если у modelElement есть тип, как у TypedElement или Connector, текст может включать имя modelElement и имя типа modelElement.

UMLRedefinesLabel служит для показа сведений ровно об одном RedefinableElement, что может включать имя redefinedElement.

B.2.5      Compartmentable Shapes

*

UMLDiagramElement

+ elementInCompartment

{ordered, subsets ownedElement}

{subsets owningElement}

UMLShape                                                                               + owningCompartment

{ordered, subsets                   0..1

{subsets owningElement}

ownedElement}

+ compartmentedShape           + compartment            UMLCompartment UMLCompartmentableShape

1. *

Рисунок B.5 Фигуры с разделами

Модель на рисунке B.5 специализирует UMLDiagramElement и UMLShape в UMLCompartmentableShape и UMLCompartment соответственно, чтобы сделать их конкретными, добавить свойства и переопределить унаследованные свойства для фигур с разделённым содержимым.

UMLCompartmentableShape — самый общий класс для элементов UML, которые могут показывать сведения в отдельных частях внутри своих фигур, обычно расположенных линейно и разделённых сплошными линиями (разделами). Он задаёт подмножество ownedElement из UMLDiagramElement, чтобы указать разделы, располагаемые вертикально по порядку (первый по порядку показывается сверху); они фиксируются с помощью UMLCompartment. UMLCompartment задаёт подмножество ownedElement из UMLDiagramElement, чтобы указать содержимое разделов, располагаемое вертикально по порядку (первый по порядку показывается сверху). У UMLCompartment нет modelElements.

Заголовки разделов следует передавать как UMLLabel без modelElements и как первый orderedElement в UMLCompartment.

B.2.6      Stereotype Applications

UMLLabel

{redefines umlDiagramElement}

+ umlDiagramElement                      1 UMLStereotypePropertyValueLabel                                                       UML::Classification::Property

*                        + modelElement

{redefines modelElement}

+ labelShowingStereotypeValue         1

UML::CommonStructure::Element

*             + stereotypedElement

Рисунок B.6 Метки применения стереотипов

Модель на рисунке B.6 специализирует UMLLabel в UMLStereotypePropertyValueLabel, вводя ассоциации для показа значений свойств стереотипов, применённых к элементам абстрактного синтаксиса UML. О передаче нотации определений стереотипов см. подпункты B.3.2–B.3.4. У UMLStereotypePropertyValueLabel modelElements — атрибуты стереотипов, и они дают элемент, к которому применён стереотип. UMLStereotypePropertyValueLabel следует отображать как строки, показывающие значения применённых стереотипов, в синтаксисе, заданном UML (см. подпункт 12.3.4). UMLStereotypePropertyValueLabel являются ownedElements

- UMLShape без modelElements (отображаемых как символы примечаний, см. подпункт B.2.3), являющихся источником или целью UMLEdge без modelElements, где другой конец этих UMLEdge — UMLShape с modelElements, являющимися stereotypedElements.

- UMLCompartment, у которых все UMLStereotypePropertyValueLabel имеют в качестве stereotypedElement o    modelElement элемента-владельца этого UMLCompartment, и

  o    в качестве modelElements — свойства того же стереотипа, который применён к modelElement элемента-владельца этого UMLCompartment.

Несколько других замечаний о передаче применений стереотипов:

- Стереотипы, применённые к элементам абстрактного синтаксиса UML, могут показываться: o    текстом — передаются как UMLLabel, у которых modelElements — определяемые моделировщиком стереотипы, и которые являются ownedElements элементов UMLDiagramElement, чьи modelElements имеют применённые стереотипы. Эти UMLLabel следует отображать строками, дающими имена стереотипов в кавычках-ёлочках. У UMLLabel может быть несколько стереотипов в качестве modelElements, и тогда их следует отображать разделённым запятыми списком имён стереотипов в одной паре кавычек-ёлочек.

  o    графикой с определяемыми моделировщиком значками. Значки задаются у стереотипов и передаются вместе с абстрактным синтаксисом UML, а не с UML DI. Правила отображения значка заданы в подпункте 12.3.4, а ниже — в терминах UML DI.

- UMLShape, которые o    имеют modelElement ровно с одним применённым стереотипом, имеющим значение для icon, и

  o    имеют значение true для isIcon, и

  o    отображаются прямоугольниками, когда у них значение isIcon равно false,

следует отображать как значок. Любые значки, отображаемые при неприменённых стереотипах, в этом случае не отображаются.

- UMLShape, которые o    имеют стереотип в качестве modelElement, имеющий значение для icon, и

  o    являются ownedElements элементов UMLDiagramElement, чьи modelElements имеют применённый стереотип (их modelElement), и

  o    имеют значение true для isIcon,

  следует отображать как значок стереотипа. Эти UMLShape следует отображать либо o    внутри геометрических фигур, отображаемых для UMLShape, являющихся их owningElements, у которых должно быть значение false для isIcon; либо

  o    рядом с линиями, отображаемыми для UMLEdge, являющихся их owningElements;

  o    слева от строк, отображаемых для UMLLabel, являющихся их owningElements.

B.2.7       UML Styles

UML::CommonStructure::PackageableElement

DI::DiagramElement

DI::Style

{redefines styledElement}

+ styledElement                                 0..1

UMLDiagramElement                                                                       UMLStyle

0..1                             + localStyle

fontName : String [0..1]

{redefines styledElement} {redefines localStyle} fontSize : Real [0..1]

+ styledElement                           0..1

*                                   + sharedStyle

{redefines sharedStyle}

Figure B.7 UML Styles

Модель на рисунке B.7 специализирует DI::Style в самый общий класс для стилей в UML (UMLStyle), чтобы сделать его конкретным, добавить свойства и переопределить унаследованные свойства, связанные со стилем, у UMLDiagramElement. UMLStyle вводит свойства, задающие имя и размер шрифтов, используемых при отображении UMLDiagramElement. fontSize задаётся в типографских пунктах.

B.3         Structure B.3.1       Summary

Часть UML DI, посвящённая структуре, фиксирует графические аспекты диаграмм структуры и их содержимого.

B.3.2       Structure Diagrams

UMLDiagram

UMLDiagramWithAssociations

isAssociationDotShown : Boolean = false

navigabilityNotation : UMLNavigabilityNotationKind = oneWay

nonNavigabilityNotation : UMLNavigabilityNotationKind = never               «enumeration»

UMLNavigabilityNotationKind

always

UMLStructureDiagram                                oneWay

never

UMLClassDiagram           UMLPackageDiagram               UMLComponentDiagram               UMLProfileDiagram

UMLCompositeStructureDiagram              UMLObjectDiagram              UMLDeploymentDiagram

Figure B.8 Structure Diagrams

Модель на рисунке B.8 косвенно специализирует UMLDiagram в самый общий класс для диаграмм, изображающих структурные элементы (UMLStructureDiagram), и специализирует его в различные виды диаграмм структуры (см. Приложение A). У всех UMLStructureDiagram нет modelElements, кроме UMLCompositeStructureDiagram, у которых он ровно один, и все они имеют графические параметры для ассоциаций (UMLDiagramWithAssociations), как объясняется ниже.

Несколько замечаний о содержимом UMLDiagramWithAssociations:

- Эти диаграммы могут использовать или не использовать нотацию точки для ассоциаций, как указано в isAssociationDotShown. Они могут показывать навигабельность (открытым наконечником) или ненавигабельность (знаком X) всегда, только для однонаправленных ассоциаций (oneWay) или никогда — как указано в navigabilityNotation и nonnavigabilityNotation соответственно.

- Нотация навигабельности, определяемая navigabilityNotation и nonnavigabilityNotation, применяется к UMLEdge, у которых modelElements — ассоциации, InstanceSpecification с ассоциацией в качестве классификатора, свойства или слоты.

- Стрелки обобщения между линиями ассоциаций передаются как UMLEdge с обобщениями в качестве modelElements и источниками и целями, являющимися UMLEdge с ассоциациями (включая классы ассоциаций, показанные линиями) в качестве modelElements.

- Пунктирные линии, показывающие наборы обобщений, передаются как UMLShape с наборами обобщений в качестве modelElements. UMLLabel, связанные с наборами обобщений (UMLNameLabel с наборами обобщений в качестве modelElements, UMLLabel с powerTypes в качестве modelElements и UMLLabel, показывающие ограничения набора обобщений), появляющиеся на диаграммах без UMLShape для своего набора обобщений, принадлежат UMLEdge, у которого modelElement — одно из обобщений этого набора обобщений. Иначе они принадлежат UMLShape, у которого modelElement — их набор обобщений.

- Нотация квалифицированных концов-членов ассоциации передаётся как UMLShape с концом-членом в качестве modelElement, принадлежащие UMLEdge с ассоциацией в качестве modelElement и владеющие UMLLabel с квалификаторами (UMLProperty) в качестве modelElements.

- UMLEdge между UMLShape, у которых modelElements — InstanceSpecification и которые предназначены для показа связей, имеют modelElements — InstanceSpecification с ассоциацией, классифицирующей эту связь. UMLLabel, показывающие имена концов-членов ассоциации, имеют слоты в качестве modelElements.

Несколько замечаний о содержимом UMLStructureDiagram:

- Свойства или слоты, показанные линиями, передаются как UMLEdge со свойствами или слотами в качестве modelElements соответственно.

- UMLShape с пакетами в качестве modelElements, внутри которых не отображаются UMLShape, показывают имя пакета в большом прямоугольнике, а не в язычке. Иначе имя пакета показывается в язычке. То же относится к ключевым словам и украшениям-значкам.

- UMLEdge без modelElements между UMLShape, у которых modelElements — пространство имён и именованный элемент, показываются перекрестием в круге на конце пространства имён.

- UMLClassifierShape с интерфейсами в качестве modelElements, отображаемые нотацией шарика или гнезда (см. замечания о UMLClassDiagram и UMLCompositeStructureDiagram выше), могут быть источником или целью UMLEdge, у которых modelElements — зависимости, между:

  o    порты, требующие или предоставляющие эти интерфейсы;

  o    InterfaceRealization or Usage Dependencies with the Interfaces as suppliers.

- Нотация шарика и гнезда для требуемых и предоставляемых интерфейсов передаётся как UMLClassifierShape со значением true для isIcon. Линии между этой нотацией и прямоугольниками портов передаются как UMLEdge с реализациями интерфейса или зависимостями использования в качестве modelElements с этими интерфейсами в качестве suppliers, что определяет, следует ли отображать UMLClassifierShape как шарик или гнездо (используемые интерфейсы требуются, реализуемые предоставляются).

У UMLCompositeStructureDiagram modelElements — структурированные классификаторы или InstanceSpecification с классификатором, являющимся StructuredClassifier (см. UMLTypedElementLabel в подпункте B.2.4, предпоследний пункт).

Несколько замечаний именно о содержимом UMLCompositeStructureDiagram:

- UMLClassifierShape с интерфейсами в качестве modelElements, отображаемые нотацией шарика или гнезда (см. замечания о UMLClassDiagram и UMLCompositeStructureDiagram выше), могут быть источником или целью UMLEdge, у которых modelElements — коннекторы, имеющие концы коннектора с ролями, являющимися портами, требующими или предоставляющими эти интерфейсы.

- UMLEdge с коннекторами в качестве modelElements могут иметь источником и/или целью UMLClassifierShape с интерфейсами в качестве modelElements, отображаемые нотацией шарика или гнезда (см. подпункт B.3.3), когда роли концов коннектора — порты со значением partWithPort, требующие или предоставляющие ровно один интерфейс (простые порты).

- UMLClassifierShape с интерфейсами в качестве modelElements, отображаемые нотацией шарика или гнезда (см. подпункт B.3.3), могут отображаться рядом друг с другом (шарик «в» гнезде, без линии между ними), показывая коннекторы, роли концов которых — порты со значением partWithPort, требующие или предоставляющие ровно один интерфейс (простые порты). Эти UMLClassifierShape могут быть источником или целью нескольких UMLEdge, у которых modelElements — все реализации интерфейса или все зависимости использования, когда у коннектора более двух концов.

Несколько замечаний о UMLProfileDiagram:

- Определения стереотипов следует показывать с UMLClassifierShape (см. подпункт B.3.3; стереотипы — классы и показываются так же).

- UMLEdge с расширениями в качестве modelElements следует отображать сплошными линиями с заполненными наконечниками, без стрелок навигабельности и иных украшений ассоциации. О метках концов расширения на этих UMLEdge см. подпункт B.3.4.

- UMLEdge с применениями профиля в качестве modelElements следует отображать пунктирными линиями с открытыми наконечниками.

Прямоугольники сигнатур шаблонов следует передавать как UMLShape с сигнатурами шаблонов в качестве modelElements, содержащие либо одну UMLLabel с сигнатурой шаблона в качестве modelElement, либо несколько UMLLabel с одним параметром шаблона на каждую UMLLabel в качестве modelElement.

B.3.3         Classifier Shapes

UMLCompartmentableShape

{redefines umlDiagramElement}

UMLClassifierShape             + umlDiagramElement             1 isIndentForVisibility : Boolean = false                                    UML::Classification::Classifier isDoubleSided : Boolean = false         *                + modelElement

{redefines modelElement}

Figure B.9 Classifier Shapes

Модель на рисунке B.9 специализирует UMLCompartmentableShape в UMLClassifierShape, чтобы добавить свойства и ограничить их показом ровно одного классификатора. UMLClassifierShape вводит isIndentForVisibility для modelElements, показываемых с разделами характеристик, чтобы указать, что характеристики показываются с отступом под заголовками видимости. Он также вводит isDoubleSided для modelElements, являющихся классами со значением true для isActive и показываемых прямоугольниками, чтобы указать, следует ли отображать вертикальные стороны двойными линиями. Несколько замечаний о UMLClassifierShape:

- UMLLabel, являющиеся ownedElements UMLClassifierShape, имеющие классификаторы в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, заданный UML и дающий сведения о классификаторе.

- Характеристики классификатора, показанные по порядку текстом в разделах UMLClassifierShape, следует передавать как UMLLabel, каждая с одной характеристикой в качестве modelElement.

- Многоточие, появляющееся под характеристиками классификатора, показанными по порядку текстом в разделах UMLClassifierShape, следует передавать как UMLLabel без modelElements и как последний orderedElement в UMLCompartment.

- UMLClassifierShape с компонентами в качестве modelElements могут иметь ownedElements — UMLCompartment, у которых ownedElements — UMLLabel с требуемыми и предоставляемыми интерфейсами компонентов в качестве modelElements, где UMLLabel показывают имена интерфейсов. У этих UMLLabel должны быть modelElements — реализации интерфейса или зависимости использования с интерфейсами в качестве suppliers, что определяет, требуются и/или предоставляются ли эти интерфейсы (используемые интерфейсы требуются, реализуемые предоставляются).

- Дополнительные замечания о передаче UMLClassifierShape см. в подпункте B.3.3.

B.3.4         Multiplicity and Association End Labels

UMLLabel

{redefines umlDiagramElement}

+ umlDiagramElement              1

UMLAssociationEndLabel

UML::Classification::Property

*                    + modelElement

{redefines modelElement}

{redefines umlDiagramElement} UMLMultiplicityLabel   + umlDiagramElement             1

UML::CommonStructure::MultiplicityElement

*                 + modelElement

{redefines modelElement}

Рисунок B.10 Метки кратности и концов ассоциации

Модель на рисунке B.10 специализирует UMLLabel в UMLMultiplicityLabel и UMLAssociationEndLabel, чтобы ограничить их показом сведений ровно об одном элементе кратности или ровно об одном конце-члене ассоциации соответственно.

Несколько замечаний о UMLMultiplicityLabel и UMLAssociationEndLabel:

- Сведения о свойствах, показанные текстом в UMLCompartment, следует передавать напрямую с UMLLabel (см. подпункт B.3.3), а не с UMLMultiplicityLabel или UMLAssociationEndLabel, даже когда свойство — конец-член ассоциации или когда показывается кратность (о том, когда вообще использовать специализации UMLLabel, см. подпункт B.2.4).

- UMLMultiplicityLabel следует использовать для показа сведений о тех частях их modelElements, которые определены элементом кратности, а не другими специализациями элемента кратности, которые могут классифицировать modelElements, например Property (о том, когда вообще использовать специализации UMLLabel, см. подпункт B.2.4).

- Концы коннекторов следует показывать с UMLMultiplicityLabel (единственное непроизводное свойство, вводимое концами коннектора, — role — показывается целями UMLEdge с коннекторами в качестве modelElements, а единственное обобщение конца коннектора — элемент кратности). Сведения о definingEnd концов коннектора показываются UMLAssociationEndLabel (definingEnd — это свойства).

- UMLAssociationEndLabel следует использовать для показа сведений о концах-членах ассоциации, помимо показываемых UMLMultiplicityLabel (свойства — элементы кратности). Несколько UMLAssociationEndLabel могут иметь один и тот же modelElement, каждая показывая свой аспект modelElement.

- UMLAssociationEndLabel с концами расширения в качестве modelElements можно использовать, только когда у modelElements значение lower равно 1; в этом случае UMLAssociationEndLabel должны иметь текст “{required}” (концы расширения — ownedEnd расширения, вид конца-члена, а расширения — ассоциации).

B.3.5         Association, Connector, and Link Shapes

UMLShape

«enumeration»

UMLAssociationOrConnectorOrLinkShapeKind UMLAssociationOrConnectorOrLinkShape                    diamond kind : UMLAssociationOrConnectorOrLinkShapeKind          triangle

Рисунок B.11 Фигуры ассоциаций, коннекторов и связей

Модель на рисунке B.11 специализирует UMLShape в UMLAssociationOrConnectorOrLinkShape, чтобы добавить свойство и ограничить их показом ровно одной ассоциации, коннектора или InstanceSpecification с классификатором-ассоциацией. Он вводит kind, указывающий, как следует показывать modelElement.

UMLAssociationOrConnectorOrLinkShape со значением diamond для kind следует отображать ромбами; у него должен быть modelElement — либо ассоциация с двумя концами-членами, либо коннектор с двумя концами, либо InstanceSpecification с классификатором-ассоциацией, имеющей два конца-члена (когда концов больше двух, эти элементы всегда показываются так, и нотацию следует передавать как UMLShape). Независимо от числа концов, ровно две линии от ромба следует передавать как UMLEdge, у которых modelElements — либо свойства (концы-члены ассоциации, являющейся modelElement этого UMLAssociationOrConnectorOrLinkShape, либо концы-члены ассоциации, являющейся классификатором InstanceSpecification — modelElement этого UMLAssociationOrConnectorOrLinkShape), либо концы коннектора (концы коннектора, являющегося modelElement этого UMLAssociationOrConnectorOrLinkShape).

UMLAssociationOrConnectorOrLinkShape со значением triangle для kind следует отображать заполненным треугольником, аннотирующим UMLEdge с тем же modelElement, что и у этого UMLAssociationOrConnectorOrLinkShape.

B.4           Behavior B.4.1         Summary

Часть UML DI, посвящённая поведению, фиксирует графические аспекты диаграмм поведения и их содержимого.

B.4.2         Behavior Diagrams

UMLDiagram

{redefines umlDiagramElement}                         {redefines modelElement}

UMLBehaviorDiagram         + umlDiagramElement                                            + modelElement

*                                                                                 UML::CommonBehavior::Behavior

0..1 UMLDiagramWithAssociations

{redefines umlDiagramElement}

UMLStateMachineDiagram

+ umlDiagramElement                   1     UML::StateMachines::StateMachine

UMLUseCaseDiagram           isCollapseStateIcon : Boolean = true

isInheritedDashed : Boolean = false       *                      + modelElement

isTransitionOriented : Boolean = false                           {redefines modelElement}

«enumeration»                                                          {redefines umlDiagramElement} UMLInteractionDiagramKind

UMLActivityDiagram              + umlDiagramElement                                            1

isActivityFrame : Boolean = false                                                                        UML::Activities::Activity sequence                                                                      *                                          + modelElement communication overview

{redefines umlDiagramElement} {redefines modelElement} timing                                     UMLInteractionDiagram                   + umlDiagramElement                               1

UML::Interactions::Interaction table                               kind : UMLInteractionDiagramKind = sequence

*                                {redefines modelElement}

isLifelineDashed : Boolean = false                                                    + modelElement

Figure B.12 Behavior Diagrams

Модель на рисунке B.12 специализирует UMLDiagram в самый общий класс для диаграмм, изображающих поведенческие элементы (UMLBehaviorDiagram), и специализирует его в различные виды диаграмм поведения (см. Приложение A). UMLBehaviorDiagram ограничены не более чем одним modelElement, который должен быть поведением.

У UMLUseCaseDiagram нет modelElements. Несколько замечаний о содержимом UMLUseCaseDiagram:

- Нотацию вариантов использования следует передавать как UMLClassifierShape, отображаемые овалами, когда значение isIcon — true, и прямоугольниками, когда false.

- Нотацию актёров следует передавать как UMLClassifierShape, отображаемые фигурками человечков, когда значение isIcon — true, и прямоугольниками, когда false.

- Определяемые моделировщиком значки, показывающие актёров, могут задаваться значками стереотипов.

- Нотацию расширения и включения следует передавать как UMLEdge с расширениями и включениями в качестве modelElements.

- UMLShape с расширениями в качестве modelElements следует отображать как символы примечаний, и у них должны быть UMLLabel (не специализации) как единственные два ownedElements. У этих UMLLabel должны быть modelElements — условие или extensionLocation расширения, и текст, дающий соответственно спецификацию условия или имена extensionLocation, в синтаксисе, заданном UML. UMLEdge между такими UMLShape и другими UMLDiagramElement не должны иметь modelElements и отображаются пунктирными линиями.

UMLStateMachineDiagram ограничены ровно одним modelElement, который должен быть машиной состояний. UMLStateMachineDiagram вводит isCollapseStateIcon, указывающий, должны ли UMLShape составных состояний содержать маленький значок, отличающий их от несоставных состояний. Он также вводит isInheritedDashed, указывающий, должны ли границы UMLShape с унаследованным состоянием в качестве modelElement быть пунктирными. Это свойство и isInheritedLighter из UMLDiagram не могут одновременно иметь значение true, и для UMLStateMachineDiagram, показывающих унаследованные состояния, одно из них должно иметь значение true.

Машины состояний могут показываться в «блок-схемном» стиле (UMLStateMachineDiagram со значением true для isTransitionOriented), где триггеры переходов показываются вогнутыми пятиугольниками, а исполняемые узлы в узлах последовательности в эффектах переходов — прямоугольниками со скруглёнными углами, кроме случаев, когда это действия отправки сигнала, которые показываются выпуклыми пятиугольниками (эти сведения о переходах показываются только текстом в UMLStateMachineDiagram со значением false для isTransitionOriented). Ориентированные на переходы UMLStateMachineDiagram могут иметь ownedElements — UMLShape с триггерами или исполняемыми узлами в качестве modelElements (другие UMLStateMachineDiagram не должны иметь таких UMLShape). У UMLEdge, имеющих такие UMLShape источником или целью, modelElements должны быть переходы, и эти modelElements должны совпадать у UMLEdge с общим UMLShape в качестве источника или цели. В ориентированных на переходы UMLStateMachineDiagram, если у UMLEdge modelElements — переходы, а источником или целью являются UMLShape с состояниями в качестве modelElements со значением true для isSubmachineState, и соответствующий источник или цель перехода — ссылка на точку соединения, эту ссылку на точку соединения следует показывать текстом поверх линии, отображаемой этим UMLEdge, с полуокружностями на обоих концах текста. Текст следует передавать как UMLLabel с этой ссылкой на точку соединения в качестве modelElement.

Несколько замечаний о содержимом UMLStateMachineDiagram:

- UMLShape с регионами в качестве modelElements, соседствующие друг с другом, следует отображать с пунктирной линией между ними.

- Регионы, являющиеся единственными в своих машинах состояний или состояниях, не показываются.

UMLActivityDiagram ограничены ровно одним modelElement, который должен быть деятельностью. UMLActivityDiagram вводит isActivityFrame, указывающий, должна ли рамка диаграммы быть прямоугольником со скруглёнными углами без пятиугольного заголовка (isFrame должен иметь значение false, когда isActivityFrame имеет значение true). Когда значение isActivityFrame — true, имя деятельности показывается UMLNameLabel в левом верхнем углу диаграммы без указания вида диаграммы.

Несколько замечаний о содержимом UMLActivityDiagram:

- UMLShape с действиями вызова поведения в качестве modelElements и деятельностями в качестве поведений следует отображать со значком грабель внутри, когда он свёрнут (когда у UMLShape нет ownedElements — UMLShape с узлами деятельности в качестве modelElements). Когда он развёрнут, поведение следует показывать нотацией рамки деятельности, включая UMLEdge с рёбрами деятельности в качестве modelElements и UMLShape в качестве источников или целей, у которых modelElements — эта деятельность или её узлы параметров деятельности.

- Некоторые сведения о входных и выходных выводах могут показываться графически, а именно: o   UMLShape с единственным входным или выходным выводом в качестве modelElement и значением true для isIcon следует отображать маленькой стрелкой в прямоугольнике, направленной к прямоугольнику, рядом с которым они находятся (для входных выводов), или от него (для выходных). Если входной или выходной вывод соответствует параметру со значением true для isStream, UMLShape следует отображать залитым, с перевёрнутой стрелкой, если она есть.

  o   UMLShape с единственным входным или выходным выводом в качестве modelElement, соответствующим параметру со значением true для isStream, и со значением true для isIcon следует отображать залитым, с перевёрнутой стрелкой внутри.

- Потоки объектов между выходными и входными выводами могут показываться сокращёнными нотациями, а именно: o   UMLEdge должны иметь одно и то же ребро деятельности в качестве modelElement, когда их источник или цель — один и тот же UMLShape с несколькими выводами в качестве modelElements (а именно входной и выходной выводы, являющиеся соответственно источником и целью ребра деятельности). UMLShape может отображаться маленьким квадратом, рядом с которым отображается UMLLabel. Эти UMLEdge следует показывать заполненными наконечниками, когда у них modelElements — потоки объектов, значение true для isIcon, а источником или целью являются UMLShape с несколькими выводами в качестве modelElements (а именно входной и выходной выводы), и все выводы соответствуют параметрам со значением true для isStream.

  o   UMLEdge с потоками объектов в качестве modelElements, у которых источник и цель — один и тот же UMLShape с действиями в качестве modelElements, следует отображать маленьким квадратом рядом с линией. Этот квадрат следует передавать как UMLShape с теми же потоками объектов в качестве modelElement, что и у UMLEdge (у одного UMLEdge может быть несколько потоков объектов в качестве modelElement).

- Один UMLShape может использоваться как сокращение для двух узлов управления, являющихся целью и источником ребра деятельности, следующим образом:

  o   Один UMLShape может иметь в качестве modelElements узел слияния, ребро деятельности и узел решения, причём узел слияния и узел решения являются соответственно источником и целью этого ребра деятельности. У UMLEdge, целью которых является такой UMLShape, modelElement — ребро деятельности с узлом слияния в качестве цели. У UMLEdge, источником которых является такой UMLShape, modelElement — ребро деятельности с узлом решения в качестве источника.

  o   Один UMLShape может иметь в качестве modelElements узел объединения, ребро деятельности и узел разделения, причём узел объединения и узел разделения являются соответственно источником и целью этого ребра деятельности. У UMLEdge, целью которых является такой UMLShape, modelElement — ребро деятельности с узлом объединения в качестве цели. У UMLEdge, источником которых является такой UMLShape, modelElement — ребро деятельности с узлом разделения в качестве источника.

- UMLEdge могут иметь целями UMLShape, у которых modelElement — handlerBody обработчика исключений. Эти UMLEdge со значением true для isIcon следует отображать зигзагообразными линиями, а со значением false — зигзагообразной графикой рядом с линией.

- Области расширения, имеющие ровно один inputElement, outputElement и узел-действие и два ребра потока объектов (одно с inputElement в качестве источника и inputValue узла в качестве цели, другое с outputValue узла в качестве источника и outputElement в качестве цели), могут показываться одной из двух разновидностей сокращённой нотации, обе из которых включают UMLShape с областью расширения в качестве modelElement, содержащий UMLLabel с узлом-действием в качестве modelElement, отображаемую в центре UMLShape:

  o    Одна нотация должна иметь на границе UMLShape два других UMLShape с inputElement и outputElement области расширения в качестве modelElements, причём эти два UMLShape должны быть ownedElements первого UMLShape и быть соответственно целью и источником двух UMLEdge с потоками объектов в качестве modelElements, где у этих потоков объектов соответственно target и source — inputElement и outputElement. У UMLShape с областью расширения в качестве modelElement должен быть дополнительный ownedElement — UMLKeywordLabel с этой областью расширения в качестве modelElement, показывающий режим области расширения в левом верхнем углу.

  o    Другая нотация — только для областей расширения в параллельном режиме. Она может не показывать inputElement и outputElement. UMLShape с областью расширения в качестве modelElement должен быть соответственно целью и источником двух описанных выше UMLEdge с потоками объектов в качестве modelElements, а в правом верхнем углу у него должен быть дополнительный ownedElement — UMLLabel с этой областью расширения в качестве modelElement и текстом “*”.

- Прерывающие рёбра деятельности определяются прерываемыми областями. UMLEdge с рёбрами деятельности в качестве modelElements, являющимися прерывающими рёбрами прерываемой области, и со значением true для isIcon показываются зигзагообразными линиями. Когда у этих UMLEdge значение isIcon равно false, UMLShape с этим ребром деятельности в качестве modelElement следует отображать зигзагообразной графикой рядом с линиями.

- Внешние отрезки линий UMLShape с разделами деятельности в качестве modelElements, являющихся ownedElements деятельности — modelElement диаграммы UMLActivityDiagram со значением true для isActivityFrame, могут объединяться с рамкой деятельности.

- Нотацию коннекторов рёбер деятельности следует передавать как UMLShape с тем же ребром деятельности в качестве modelElements и с ownedElements — UMLLabel с этим ребром деятельности в качестве modelElement.

- О UMLLabel в UMLActivityDiagram см. подпункт B.4.3.

UMLInteractionDiagram ограничены ровно одним modelElement, который должен быть взаимодействием. UMLInteractionDiagram вводит kind, что в некоторых случаях влияет на отображение содержимого диаграммы. Например, UMLShape с комбинированными фрагментами alt в качестве modelElements на UMLInteractionDiagram со значением overview для kind следует отображать ромбами. Когда значение kind — table, ownedElements, являющиеся UMLShape, а не UMLLabel, следует отображать прямоугольниками (см. подпункт B.4.5). UMLInteractionDiagram также вводит isLifelineDashed, указывающий, следует ли отображать линии жизни на диаграмме пунктирными.

Несколько замечаний о содержимом UMLInteractionDiagram:

- Свойства взаимодействий (как классов) могут показываться текстом под левым верхним углом диаграммы (под пятиугольником заголовка) и передаваться UMLLabel так же, как нотация свойств в классах. Эти UMLLabel могут появляться в других UMLShape, являющихся источником или целью UMLEdge. Такие UMLShape следует отображать как примечания, а UMLEdge — пунктирными линиями.

- UMLEdge с общими упорядочениями в качестве modelElements следует отображать заполненными наконечниками в середине линий. Наконечники не следует передавать как отдельные UMLShape.

- UMLEdge с сообщениями в качестве modelElements, у которых значение messageKind — lost или found, следует отображать маленькими заполненными кружками на целевом или исходном конце соответственно. Кружки не следует передавать как отдельные UMLShape.

- UMLShape с комбинированными фрагментами в качестве modelElements со значением par для interactionOperand и со значением true для isIcon следует отображать скобками сверху и снизу фигуры (нотация корегиона).

- Все комбинированные фрагменты, независимо от interactionOperand, следует показывать текстом в пятиугольниках в левых верхних углах их UMLShape, где текст передаётся UMLLabel с комбинированными фрагментами в качестве modelElements, возможно по несколько меток на пятиугольник. У дополнительных меток modelElements — непосредственно вложенные комбинированные фрагменты.

- UMLShape со спецификациями выполнения в качестве modelElements и значением true для isIcon следует отображать затенёнными узорами заливки.

B.4.3     Activity Diagram Labels Some notes about UMLLabels in UMLActivityDiagrams are:

- UMLLabel, являющиеся ownedElements UMLActivityDiagram, имеющие деятельности в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, начинающийся с ключевых слов, заданных UML в кавычках-ёлочках и указывающих вид сведений, которые они показывают о деятельности.

- UMLLabel, являющиеся ownedElements UMLShape с узлами параметров деятельности в качестве modelElements, имеющие параметры в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, дающий сведения о параметре в синтаксисе, заданном UML.

- UMLLabel, являющиеся ownedElements UMLShape с действиями вызова операции в качестве modelElements, имеющие классы или операции в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, дающий имя класса, операции или того и другого, в синтаксисе, заданном UML.

- UMLLabel, являющиеся ownedElements UMLShape с действиями в качестве modelElements, имеющие разделы деятельности в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, дающий имена разделов деятельности в синтаксисе, заданном UML.

- UMLLabel, являющиеся ownedElements UMLShape без modelElements, имеющие узлы деятельности в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, начинающийся с ключевых слов, заданных UML в кавычках-ёлочках и указывающих вид сведений, которые они показывают об узле деятельности (такие UMLShape отображаются как символы примечаний, см. подпункт B.2.3).

- UMLLabel, являющиеся ownedElements UMLShape с узлами объектов в качестве modelElements, имеющие состояния в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, следует отображать как разделённые запятыми списки имён modelElements этой UMLLabel, заключённые в квадратные скобки.

- UMLLabel, текст которых начинается и заканчивается фигурными скобками и которые не классифицированы ни одной специализацией UMLLabel, должны иметь узлы деятельности или рёбра деятельности в качестве modelElements, а текст должен давать значения свойств этих modelElements в синтаксисе, заданном UML.

- UMLLabel, текст которых начинается и заканчивается квадратными скобками и которые не классифицированы ни одной специализацией UMLLabel, должны иметь рёбра деятельности в качестве modelElements, а текст между квадратными скобками должен показывать сторож ребра деятельности.

- UMLLabel могут иметь параметры в качестве modelElements и размещаться рядом с UMLShape, у которых modelElements — входные или выходные выводы действий вызова (либо рядом с местом, где были бы выводы, если они опущены), чтобы показывать параметры поведений или операций действий вызова.

- UMLLabel рядом с UMLShape, показывающими входные или выходные выводы, могут использоваться для передачи сокращённых нотаций следующим образом:

  o       Действия, у которых входной вывод является целью потока объектов с узлом параметра деятельности в качестве источника, могут показываться сокращённой нотацией, показывающей только действие, его входной вывод и рядом имя параметра узла параметра деятельности, передаваемое как UMLLabel с этим параметром в качестве modelElement (см. рисунок 15-52 в подпункте 15.4.4).

  o       Действия, у которых выходной вывод является источником потока объектов с узлом параметра деятельности в качестве цели, могут показываться сокращённой нотацией, показывающей только действие, его выходной вывод и рядом имя параметра узла параметра деятельности, передаваемое как UMLLabel с этим параметром в качестве modelElement (см. рисунок 15-52 в подпункте 15.4.4).

  o       Действия добавления значения переменной, у которых входной вывод является целью потока объектов с выходным выводом другого действия в качестве источника и у которых выходной вывод является источником потока объектов с конечным узлом потока в качестве цели, могут показываться сокращённой нотацией, показывающей только другое действие, его выходной вывод и рядом имя переменной этого действия добавления значения переменной, показанное UMLLabel с этой переменной в качестве modelElement (см. рисунок 16-38 в подпункте 16.9.4).

  o       Входные выводы действия, у которых fromActions — действия чтения переменной, могут показываться сокращённой нотацией, показывающей только входной вывод действия и рядом имя переменной действия чтения переменной, передаваемое как UMLNameLabel с этой переменной в качестве modelElement.

  o       Входные выводы действия, у которых fromActions — действия чтения объекта self, могут показываться сокращённой нотацией, показывающей только входной вывод действия и рядом строку “self”, передаваемую как UMLLabel с этим действием чтения объекта self в качестве modelElement.

  o        Входные выводы действия, у которых fromActions — действия спецификации значения, могут показываться сокращённой нотацией, показывающей только входной вывод действия и рядом значение действия спецификации значения, передаваемое как UMLLabel с этим значением в качестве modelElement.

- Заголовки разделов деятельности следует передавать как UMLLabel с их разделом деятельности в качестве modelElement.

B.4.4          State Shapes

UMLCompartmentableShape

{redefines umlDiagramElement}

+ umlDiagramElement        1..*

UMLStateShape

UML::StateMachines::State isTabbed : Boolean = false *       {redefines modelElement}

+ modelElement

Figure B.13 State Shapes

Модель на рисунке B.13 специализирует UMLCompartmentableShape в UMLStateShape, чтобы добавить свойство и ограничить их показом одного или нескольких состояний. Он вводит isTabbed, указывающий, следует ли добавлять язычок наверх фигуры для показа имени состояния. UMLStateShape могут иметь несколько modelElements при передаче нотации списка состояний, см. подпункт 14.2.4. В этом случае имена modelElements показываются UMLLabel с теми же modelElements, с UMLStateShape в качестве owningElement, и эта UMLLabel должна отображаться как разделённый запятыми список имён своих modelElements.

Несколько замечаний о содержимом UMLStateShape:

- UMLLabel, показывающие поведения при входе, do и при выходе, должны иметь эти поведения в качестве modelElements и текст в синтаксисе, заданном UML.

- UMLLabel, показывающие внутренние или локальные переходы, имеют переходы в качестве modelElements и текст в синтаксисе, заданном UML.

- UMLLabel, являющиеся ownedElements UMLStateShape, имеющие состояния в качестве modelElements и не классифицированные ни одной специализацией UMLLabel, должны иметь текст, заданный UML и дающий сведения о состоянии.

B.4.5         Interaction Tables

«enumeration»

UMLLabel                     UMLInteractionTableLabelKind

lifelineClass

lifelineInstance UMLInteractionTableLabel            constraint kind : UMLInteractionTableLabelKind   messageSendingClass

messageSendingInstance

diagramIdentifier

generatedInstanceName

sequenceNumber

weakOrder

messageName

parameter

returnValue

messageReceivingClass

messageReceivingInstance

otherEnd

Figure B.14 Interaction Shapes

Модель на рисунке B.14 специализирует UMLLabel в UMLInteractionTableLabel, чтобы добавить свойство для меток в табличном формате UMLInteractionDiagram.

UMLInteractionTableLabel должны быть ownedElements UMLShape, являющихся ownedElements единственного UMLShape, который является ownedElement UMLInteractionDiagram со значением table для kind. Все эти UMLShape следует отображать прямоугольниками: один для всей таблицы (ownedElement этой UMLInteractionDiagram) и по одному для каждой ячейки таблицы (второй уровень ownedElements). UMLShape для всей таблицы должен иметь modelElement — InteractionDiagram, совпадающий с modelElement его owningElement. UMLShape для ячеек должны быть ownedElements в UMLShape таблицы и иметь не более одного ownedElement, который должен быть UMLInteractionTableLabel. UMLShape для ячеек верхней строки должны иметь один ownedElement без modelElement, а все UMLShape для ячеек и их ownedElements должны иметь ровно один modelElement, совпадающий для каждого UMLShape и его ownedElement. UMLInteractionTableLabel для ячеек в одном столбце должны иметь одно и то же значение kind.

B.5           Information Flows

Несколько замечаний об UMLDiagramElement, связанных с информационными потоками:

- UMLLabel с информационными потоками в качестве modelElements показывают имена видов передаваемых вещей. Несколько переданных имён для информационных потоков следует показывать одной UMLLabel, отображаемой как разделённый запятыми список имён; это может быть следствием нескольких modelElements у одной UMLLabel, нескольких переданных имён у одного modelElement или того и другого.

- UMLShape с информационными потоками в качестве modelElements и значением true для isIcon следует отображать заполненными треугольниками, наложенными на UMLEdge с теми же информационными потоками в качестве modelElements и выровненными с ними, указывающими на informationTarget. Должен быть один треугольник для всех информационных потоков, идущих в одном направлении и реализуемых одним элементом (не более двух треугольников для одного реализующего элемента).

B.6       UML Notations and UML DI Representations

В этом подпункте Приложение B резюмируется показом того, как нотации UML следует моделировать средствами UML DI. Он не охватывает всё Приложение B и не все нотации предыдущих пунктов. Таблицы B.1 и B.2 охватывают соответственно фигуры и рёбра. Левый столбец показывает пример нотации UML. Таблица пытается охватить как можно больше вариантов, но не задаёт, обязательны элементы или необязательны. Средний столбец показывает элементы UML DI, соответствующие нотации. Эти элементы представлены иерархией вложенности. Элементы с одним контейнером упорядочены согласно нотации, показанной в левом столбце, при чтении слева направо и сверху вниз. Для каждого элемента указан вид элемента диаграммы, затем вид modelElement и иногда другие ограничения, применимые к элементу диаграммы, в скобках. За видом modelElement ставится «+», когда одному элементу диаграммы можно назначить несколько modelElements этого вида. Правый столбец ссылается на пункты «Нотация» и рисунки, где определена нотация, а также на подпункты Приложения B, где определено представление в UML DI. Таблица B.1 Фигуры UML


> **Примечание к таблице B.1.** Таблица B.1 (ниже и до конца файла) состоит из технических идентификаторов UML DI (`UMLShape`, `UMLEdge`, `isIcon=true`), ссылок на пункты (`10.4.4, B.2.2`) и номеров рисунков; переводить в ней нечего, поэтому она сохранена дословно, как OCL и ASCII-арт. Построчная структура таблицы (соответствие «нотация → элементы диаграммы → ссылки») **утрачена в самом источнике**: файл сгенерирован из PDF, и ячейки рассыпались на отдельные строки вроде `UMLShape (Interface+, isIcon=true,` / `10.4.4, B.2.2,`. Это дефект источника, а не перевода.

Notation                                     Diagram elements                       Ref.

UMLDiagram (Element,                      A, B.2.2

isFrame=true)                             Fig. A.1, A.2,

- UMLLabel (Element)                      A.3, A.4

UMLShape                                  7.2.4, B.2.3

- UMLLabel (Comment)                      Fig 7.2

UMLEdge

UMLShape (TemplateSignature)              7.3.4, B.2.3

- UMLLabel (TemplateSignature)            Fig 9.5, 9.7

UMLShape (TemplateSignature)              B.2.3

- UMLLabel (TemplateParameter)            Fig 7.6

- UMLLabel (TemplateParameter)

UMLShape                                  7.6.4, B.2.3

- UMLKeywordLabel (Constraint)            Fig 7.14

- UMLLabel (Constraint)

UMLEdge

Notation            Diagram elements                   Ref.

UMLClassifierShape (Classifier)      9.2.4, B.2.3,

- UMLKeywordLabel (Classifier)       B.2.5, B.3.3

- UMLNameLabel (Classifier)          Fig 7.11, 7.15,

- UMLLabel (Classifier)              9.11, 10.2, 10.3,

- UMLCompartment                     10.6, 11.16,

--- UMLLabel                         11.17, 15.3

--- UMLLabel (Property)

--- UMLLabel (Property, inherited)

--- UMLLabel

- UMLCompartment

--- UMLLabel

--- UMLLabel (Operation)

UMLClassifierShape (Class,           9.2.4, B.3.3

modelElement.isActive=true,          Fig. 11.18

isDoubleSided=true)

- UMLNameLabel (Class)

UMLClassifierShape (Class)           11.4.4, B.3.3

- UMLNameLabel (Class)               Fig. 11.19, 11.20,

- UMLCompartment                     11.50, 11.52,

--- UMLLabel                         11.54

--- UMLShape (Property)

----- UMLTypedElementLabel

(Property)

--- UMLEdge (Connector)

----- UMLTypedElementLabel

(Connector)

--- UMLShape (Property)

----- UMLTypedElementLabel

(Property)

UMLEdge                              11.5.4, B.3.3

UMLClassifierShape                   Fig 11.35, 11.36

(AssociationClass)

- UMLNameLabel (AssociationClass)

UMLCompartmentableShape              9.8.4, B.2.4

(InstanceSpecification)              Fig. 9.28, 9.29,

- UMLTypedElementLabel               9.31, 11.21

(InstanceSpecification)

- UMLCompartment

--- UMLTypedElementLabel (Slot)

- UMLCompartment

--- UMLLabel

--- UMLCompartmentableShape

(InstanceSpecification)

----- UMLTypedElementLabel

(InstanceSpecification)

Notation           Diagram elements                       Ref.

UMLShape (InstanceValue)               B.2.4

- UMLTypedElementLabel

(InstanceValue)

UMLClassifierShape (Enumeration)       10.2.4, B.3.3

- UMLKeywordLabel (Enumeration)        Fig. 10.4

- UMLNameLabel (Enumeration)

- UMLCompartment

--- UMLNameLabel

(EnumerationLiteral)

UMLShape (Interface+, isIcon=true,     10.4.4, B.2.2,

provided)                              Fig. 10.8, 10.9,

- UMLNameLabel (Interface+)            11.40

UMLEdge (InterfaceGeneralization)

UMLShape (Interface, isIcon=true,      10.4.4, B.2.2

required)                              Fig. 10.10, 11.40

- UMLNameLabel (Interface)

UMLEdge (Usage)

UMLCompartmentableShape                11.2.4, B.2.4

(Property,                             Fig. 11.2, 11.3,

modelElement.isComposite=true)         11.19, 11.20,

- UMLMultiplicityLabel (Property)

- UMLTypedElementLabel (Property)

UMLCompartmentableShape                11.2.4, B.2.3

(Property,                             Fig 11.2, 11.3

modelElement.isComposite=false)

- UMLTypedElementLabel (Property)

UMLShape (Port)                        11.2.4, 11.3.4,

- UMLTypedElementLabel (Port)          B.2.3

Fig. 11.3, 11.4,

11.11, 11.12,

11.13, 11.14

UMLShape (Port)                        10.4.4, B.3.2

UMLEdge                                Fig 11.3, 11.4,

UMLShape (Interface+, isIcon=true,     11.11, 11.12,

provided)                              11.13, 11.14

UMLShape (Port)                        10.4.4, B.3.2

UMLEdge                                Fig 11.3, 11.4,

UMLShape (Interface+, isIcon=true,     11.11, 11.12,

required)                              11.13, 11.14

Notation            Diagram elements                    Ref.

UMLClassifierShape (Component)        11.6.4, B.3.3

- UMLNameLabel (Component)            Fig. 11.39, 11.40,

- UMLCompartment                      11.41, 11.42,

--- UMLLabel                          11.43, 11.45,

--- UMLLabel (Interface, provided)    11.45, 11.46,

- UMLCompartment                      11.47, 11.48,

--- UMLLabel                          19.10

--- UMLLabel (Interface, required)

UMLClassifierShape (Collaboration,    11.7.4, B.3.3

isIcon=true)                          Fig 11.50, 11.52

- UMLNameLabel (Collaboration)

- UMLCompartment

--- UMLClassifierShape (Classifier)

----- UMLNameLabel (Classifier)

--- UMLEdge (Property)

----- UMLLabel (Property)

--- UMLShape (CollaborationUse)

----- UMLTypedElementLabel

(CollaborationUse)

--- UMLEdge (Property)

----- UMLLabel (Property)

--- UMLClassifierShape (Classifier)

----- UMLNameLabel (Classifier)

UMLCompartmentableShape               12.2.4, B.2.5

(Package, with no contained shapes)   Fig 12.4, 12.5,

- UMLNameLabel (Package)              12.8, 12.23

UMLCompartmentableShape               12.2.4, B.2.5

(Package, with contained shapes)      Fig. 12.2, 12.3,

- UMLNameLabel (Package)              12.5, 12.6, 12.7,

- UMLShape (PackageableElement)       12.9, 12.13,

--- UMLNameLabel                      12.14, 12.21,

(PackageableElement)                  12.22

UMLCompartmentableShape (Model)       12.2.4, B.2.5

- UMLNameLabel (Model)                Fig. 12.10,

12.11, 12.14

UMLShape                              12.3.4, B.2.6

- UMLLabel (Stereotype)               Fig. 12.29, 12.30

- UMLStereotypePropertyValueLabel

(Element)

- UMLStereotypePropertyValueLabel

(Element)

UMLEdge

Notation           Diagram elements                      Ref.

UMLClassifierShape (Classifier)         12.3.4, B.2.6

- UMLNameLabel (Classifier)             Fig. 12.31

- UMLCompartment

--- UMLLabel

---

UMLStereotypePropertyValueLabel

(Classifier)

UMLLabel (Stereotype+)                  12.3.4, B.2.6

UMLShape (Stereotype, isIcon=true)      12.3.4, B.2.6

UMLShape (Region)                       14.2.4, B.4.2

- UMLNameLabel (Region)                 Fig. 14.3, 14.9

UMLShape (Region)

- UMLNameLabel (Region)

UMLStateShape (State)                   14.2.4, B.4.4

- UMLNameLabel (State)                  Fig. 14.4, 14.6,

- UMLLabel (Constraint)                 14.7, 14.9, 14.10,

- UMLKeywordLabel (State)               14.45

- UMLCompartment

--- UMLStateShape (State, owned)

----- UMLNameLabel (State)

- UMLCompartment

--- UMLLabel (Behavior)

- UMLCompartment

--- UMLLabel (Transition)

UMLStateShape (State,diagram.           14.2.4, B.4.2

diagram.isInheritedLighter=false,       Fig. 14.39, 14.40

diagram.isInheritedDashed=true)

- UMLNameLabel (State)

UMLStateShape (State,                   14.2.4, B.4.2

diagram.isInheritedLighter=true,

diagram.isInheritedDashed=false)

- UMLNameLabel (State)

UMLStateShape (State)                   14.2.4, B.4.4

- UMLNameLabel (State)                  Fig. 14.3, 14.5

UMLStateShape (State+)                  14.2.4, B.4.4

- UMLNameLabel (State+)                 Fig 14.15

Notation            Diagram elements                    Ref.

UMLStateShape (State,                 14.2.4, B.4.2

modelElement.isComposite=true,        Fig. 14.8

diagram.isCollapseStateIcon=true)

- UMLNameLabel (State)

UMLStateShape (State)                 14.2.4, B.4.4

- UMLNameLabel (State)                Fig. 14.11, 14.28

- UMLShape

(ConnectionPointReference, entry

point)

--- UMLNameLabel

(ConnectionPointReference)

UMLStateShape (State)                 14.2.4, B.4.4

- UMLNameLabel (State)                Fig. 14.11,

- UMLShape                            14.14, 14.29

(ConnectionPointReference, exit

point)

--- UMLNameLabel

(ConnectionPointReference)

UMLShape (Pseudostate, initial)       14.2.4, B.2.3

Fig. 14.18

UMLShape (FinalState)                 14.2.4, B.2.3

Fig 14.17

UMLShape (Pseudostate,                14.2.4, B.2.3

shallowHistory)                       Fig. 14.19

UMLShape (Pseudostate, deepHistory)   14.2.4, B.2.3

Fig 14.20

UMLShape (Pseudostate, entryPoint)    14.2.4, B.2.3

Fig 14.21, 14.23

UMLShape (Pseudostate, exitPoint)     14.2.4, B.2.3

Fig. 14.12,

14.13, 14.14,

14.22, 14.23

UMLShape (Pseudostate, junction)      14.2.4, B.2.3

Fig. 14.24

UMLShape (Pseudostate, choice)        14.2.4, B.2.3

Fig 14.25

UMLShape (Pseudostate, terminate)     14.2.4, B.2.3

Fig 14.26

Notation           Diagram elements                     Ref.

UMLShape (Pseudostate, join/fork)      14.2.4, B.2.3

Fig 14.27

UMLShape (OpaqueAction, in             14.2.4, B.4.2

StateMachine diagrams when             Fig. 14.32

isTransitionOriented=true)

- UMLLabel (OpaqueAction)

UMLShape (Trigger, in StateMachine     14.2.4, B.4.2

diagrams when                          Fig. 14.32

isTransitionOriented=true )

- UMLNameLabel (Trigger)

UMLShape (SendSignalAction, in         14.2.4, B.4.2

StateMachine diagrams when             Fig. 14.32

isTransitionOriented=true )

- UMLNameLabel (SendSignalAction)

UMLActivityDiagram (Activity,          15.2.4, B.4.3

isActivityFrame=true)                  Fig 15.2

- UMLKeywordLabel (Activity)

UMLShape (ObjectNode)                  15.2.4, B.4.3

- UMLLabel (Parameter)                 Fig 15.52, 15.56,

- UMLShape (ObjectNode, exception,     16.19, 16.27

isIcon=true)

UMLShape (Action)                      15.2.4, B.2.3

- UMLNameLabel (Action)                Fig. 15.4, 15.61,

16.14

UMLShape (Action)                      15.6.4, B.2.3

- UMLKeywordLabel                      Fig. 15.67,

(ActivityPartition)                    15.71, 16.2, 16.7,

- UMLNameLabel (Action)                16.8

- UMLLabel (ActivityPartition)

UMLShape (ObjectNode not typed by      15.2.4, B.4.3

Signal)                                Fig. 15.4, 15.49,

- UMLTypedElementLabel                 15.50, 15.54,

(ObjectNode)                           15.55, 15.58,

- UMLLabel (State+)                    15.59, 16.20,

- UMLLabel (ObjectNode)                16.21, 16.26,

16.28

Notation           Diagram elements                    Ref.

UMLShape (ActivityParameterNode)     15.4.4, B.4.2

- UMLLabel (Parameter)               Fig. 15.22,

- UMLLabel (ActivityParameterNode)   15.52, 15.56,

15.57

UMLShape (ObjectNode, typed by       15.2.4, B.4.2

signal)

- UMLTypedElementLabel

(ObjectNode)

UMLShape                             15.2.4, B.2.3

- UMLKeywordLabel (Behavior,         Fig 15.10, 15.16,

selection/                           15.33, 15.41,

transformation/decisionInput)        15.51, 16.11

- UMLLabel (Behavior)

UMLEdge

UMLShape (InitialNode)               15.3.4, B.2.3

Fig. 15.4, 15.27,

15.35

UMLShape (ActivityFinalNode)         15.3.4, B.2.3

Fig. 15.4, 15.28,

15.42, 15.43,

15.44

UMLShape (FlowFinalNode)             15.3.4, B.2.3

Fig. 15.4, 15.28,

15.45, 15.46

UMLShape (JoinNode)                  15.3.4, B.4.3

- UMLLabel (JoinNode)                Fig. 15.4, 15.29,

15.30, 15.37,

15.38

UMLShape (ForkNode)                  15.3.4, B.2.3

Fig. 15.4, 15.29,

15.36

UMLShape                             15.3.4, B.4.2

(JoinNode+ActivityEdge+ForkNode)     Fig. 15.4, 15.32

Notation           Diagram elements                      Ref.

UMLShape (MergeNode)                    15.3.4, B.2.3

Fig. 15.4, 15.32,

15.39

UMLShape (DecisionNode)                 15.3.4, B.2.3

Fig. 15.4, 15.33,

15.40

UMLShape                                15.3.4, B.4.2

(MergeNode+ActivityEdge+Decision        Fig. 15.4, 15.34

Node)

UMLShape (ActivityPartition,            15.6.4, B.4.3

modelElement.isDimension=true)          Fig. 15.66,

- UMLNameLabel (ActivityPartition)      15.67, 15.70,

- UMLShape (ActivityPartition)          15.72

--- UMLNameLabel

(ActivityPartition)

- UMLShape (ActivityPartition)

--- UMLNameLabel

(ActivityPartition)

UMLShape (ActivityPartition,

isDimension=true)

- UMLShape (ActivityPartition)

--- UMLNameLabel

(ActivityPartition)

- UMLShape (ActivityPartition)

--- UMLNameLabel

(ActivityPartition)

UMLShape                                15.6.4, B.2.3

(InterruptibleActivityRegion)           Fig. 15.68,

15.69, 15.73

UMLShape                                16.2.4, B.2.3

- UMLKeywordLabel (Constraint,          Fig. 16.3, 16.9

precondition, postcondition)

- UMLLabel (Constraint)

UMLEdge

UMLShape (Pin)                          B.4.3

- UMLNameLabel (Pin)                    Fig. 16.4, 16.6

- UMLLabel (State+)

- UMLLabel (Pin)

- UMLLabel (Parameter)

UMLEdge (ObjectFlow)                    B.4.2

UMLShape (InputPin, OutputPin)          Fig. 16.6

UMLEdge (ObjectFlow)

Notation            Diagram elements                      Ref.

UMLShape (Pin, isIcon=true,           16.2.4, B.4.2

streaming parameter)                  Fig. 16.22

UMLShape (InputPin)                   16.2.4, B.4.2

UMLShape (InputPin, isIcon=true,      Fig. 16.5

streaming parameter)

UMLShape (OutputPin)                  16.2.4, B.4.2

UMLShape (OutputPin, isIcon=true,     Fig. 16.5

streaming parameter)

UMLShape (CallBehaviorAction, with    16.3.4, B.4.2

an Activity as behavior)              Fig. 16.15, 16.24

- UMLNameLabel

(CallBehaviorAction)

UMLShape (CallOperationAction)        16.3.4, B.4.3

- UMLNameLabel                        Fig. 16.16, 16.17

(CallOperationAction)

- UMLNameLabel (Operation)

UMLShape                              16.4.4, B.4.3

(ValueSpecificationAction)            Fig. 16.31, 16.32

- UMLLabel (ValueSpecification)

UMLShape (Action)                     B.4.3

- UMLNameLabel (Action)

- UMLShape (OutputPin)

--- UMLLabel (Variable)

UMLShape (ReadVariableAction)         B.4.3

- UMLNameLabel

(ReadVariableAction)

- UMLShape (ActionInputPin)

--- UMLLabel (Variable)

UMLShape (ReadSelfObjectAction)       B.4.3

- UMLNameLabel

(ReadSelfObjectAction)

- UMLShape (ActionInputPin)

--- UMLLabel (ReadSelfObjectAction)

UMLShape                              B.4.3

(ValueSpecificationAction)

- UMLNameLabel

(ValueSpecificationAction)

- UMLShape (ActionInputPin)

--- UMLLabel

(ValueSpecificationAction)

UMLShape (SendSignalAction)           16.3.4, B.4.2

- UMLNameLabel (SendSignalAction)     Fig. 16.18,

16.25, 16.42

Notation           Diagram elements                    Ref.

UMLShape (SendObjectAction with       16.3.4, B.4.2

signal type)

- UMLNameLabel

(SendObjectAction)

UMLShape (AcceptEventAction           16.10.4, B.2.3

without TimeEvent trigger)            Fig. 16.40, 16.41,

- UMLNameLabel                        16.42

(AcceptEventAction)

UMLShape (AcceptEventAction with      16.10.4, B.2.3

TimeEvent trigger)                    Fig. 16.40, 16.43

UMLShape (Action)                     16.3.4, B.2.3

- UMLNameLabel (Action)               Fig. 16.23, 16.29

- UMLShape (ParameterSet)

--- UMLShape (Parameter)

--- UMLShape (Parameter)

UMLShape (StructuredActivityNode)     16.11.4, B.4.2

- UMLKeywordLabel                     Fig. 16.46

(StructuredActivityNode)

UMLShape (ExpansionRegion)            16.12.4, B.4.2

- UMLShape (ExpansionNode)            Fig. 16.48,

- UMLKeywordLabel                     16.50, 16.52,

(ExpansionRegion)                     16.53

- UMLShape (ExpansionNode)

UMLShape (ExecutionRegion, parallel   16.12.4, B.4.2

mode, with one action)                Fig. 16.51, 16.55

- UMLNameLabel (Action)

- UMLLabel (ExecutionRegion)

UMLShape (ExecutionRegion, with       16.12.4, B.4.2

one action)                           Fig. 16.49, 16.54

- UMLShape (ExecutionNode)

- UMLNameLabel

(CallBehaviorAction)

- UMLShape (ExecutionNode)

Notation             Diagram elements                    Ref.

UMLInteractionDiagram (Interaction)    17.2.4, B.4.2

- UMLLabel (heading)                   Fig. 17.3

- UMLLabel (Property)

- UMLShape ()

--- UMLLabel (Property)

UMLShape (Lifeline, line)              17.3.4, B.2.3

- UMLLabel (Lifeline, rectangle)       Fig. 17.3

UMLShape (Lifeline, line)

- UMLLabel (Lifeline, rectangle)

UMLShape (Lifeline, dashed line)       17.3.4, B.4.2

- UMLLabel (Lifeline, rectangle)       Fig. 17.2

UMLShape (ExecutionSpecification)

UMLShape (Lifeline, line)

- UMLLabel (Lifeline, rectangle)

UMLShape (ExecutionSpecification,

isIcon=true)

UMLShape (Lifeline, dashed line)       17.4.4, B.2.3

- UMLLabel (Lifeline, rectangle)       Fig. 17.8

UMLShape

(DestructionOccurrenceSpecification)

Notation           Diagram elements                     Ref.

UMLShape (CombinedFragment)            17.6.4, B.2.3

- UMLLabel (CombinedFragment)          Fig. 17.12,

- UMLShape (InteractionOperand)        17.13, 17.14

--- UMLLabel (InteractionConstraint)

- UMLShape (InteractionOperand)

--- UMLLabel (InteractionConstraint)

UMLShape (Lifeline)                    17.6.4, B.2.3

- UMLLabel (Lifeline)                  Fig. 17.14

UMLShape (Lifeline)

- UMLLabel (Lifeline)

UMLShape (Continuation)

- UMLLabel (Continuation)

UMLShape (Lifeline)                    17.2.4, B.2.3

- UMLLabel (Lifeline)                  Fig. 17.17

- UMLShape (StateInvariant)

--- UMLLabel (StateInvariant)

- UMLLabel (StateInvariant)

UMLShape (InteractionUse)              17.10.1, B.2.3

- UMLLabel (InteractionUse)            Fig. 17.19, 17.20

- UMLNameLabel (InteractionUse)

UMLShape (Lifeline)                    17.6.4, B.4.2

- UMLLabel (Lifeline)

UMLShape (CombinedFragment,

isIcon=true, mode=parallel)

Notation            Diagram elements                 Ref.

UMLClassifierShape (Classifier)    17.7.5, B.3.3

- UMLCompartment                   Fig. 17.23

--- UMLShape (Interaction)

----- UMLLabel (Interaction)

----- UMLNameLabel (Interaction)

UMLEdge                            B.2.3

UMLLabel (Observation)             Fig 8.5, 17.5

UMLEdge                            B.2.3

UMLLabel (TimeConstraint)          Fig 8.5, 17.5

UMLLabel (DurationConstraint)      B.2.3

UMLEdge (DurationConstraint)       Fig 8.5, 17.5

UMLClassifierShape (UseCase,       18.1.4, B.4.2

isIcon=true)                       Fig. 18.2, 18.3,

- UMLNameLabel (UseCase)           18.11

- UMLCompartment

--- UMLLabel

--- UMLLabel (ExtensionPoint)

UMLClassifierShape (UseCase,       18.1.4, B.4.2

isIcon=false)                      Fig. 18.5, 18.12

- UMLNameLabel (UseCase)

- UMLCompartment

--- UMLLabel

--- UMLLabel (ExtensionPoint)

UMLShape (Actor, isIcon=true)      18.1.4, B.4.2

Fig. 18.2, 18.6

UMLClassifierShape (Actor)         18.1.4, B.4.2

- UMLKeywordLabel (Actor)          Fig. 18.7

- UMLNameLabel (Actor)

UMLShape                           18.1.4, B.4.2

- UMLLabel (Extend)

- UMLLabel (ExtensionPoint)

UMLEdge

Notation           Diagram elements                       Ref.

UMLShape (DeploymentTarget, in           19.2.4, B.2.3

UMLDeploymentDiagram)                    Fig. 19.2, 19.3,

- UMLNameLabel                           19.4, 19.6, 19.7,

(DeploymentTarget)                       19.12, 19.13,

- UMLShape (Node)                        19.14

--- UMLNameLabel (Node)

UMLClassifierShape                       19.2.4, B.3.3

(DeploymentSpecification)                Fig. 19.5, 19.6,

- UMLKeywordLabel                        19.7

(DeploymentSpecification)

- UMLNameLabel

(DeploymentSpecification)

UMLClassifierShape (Artifact)            19.3.4, B.3.3

- UMLKeywordLabel (Artifact)             Fig. 19.2, 19.3,

- UMLNameLabel (Artifact)                19.6, 19.7, 19.9,

19.10

UMLShape (InformationItem)               20.1.4, B.2.3

- UMLNameLabel (InformationItem)         Fig. 20.3, 20.4

UMLEdge

Table B.2 UML Edges

Notation           Diagram elements                       Ref.

UMLEdge (TemplateBinding)                7.3.4, B.2.3

- UMLKeywordLabel                        Fig 7.6, 9.5

(TemplateBinding)

- UMLLabel (TemplateBinding)

UMLEdge (between Namespace and           7.4.4, B.3.2

NamedElement shapes)                     Fig. 12.5

UMLEdge (ElementImport)                  7.4.4, B.2.3

- UMLKeywordLabel                        Fig 7.7, 7.8

(ElementImport)

UMLEdge (PackageImport)                  7.4.4, B.2.3

- UMLKeywordLabel                        Fig 7.9

(PackageImport)

UMLEdge (Constraint)                     7.6.4, B.2.3

- UMLLabel (Constraint)                  Fig 7.16

Notation            Diagram elements                      Ref.

UMLEdge (Dependency)                    7.7.4, B.2.3

- UMLKeywordLabel (Dependency)          Fig 7.18, 7.19,

- UMLNameLabel (Dependency)             7.20, 11.22,

11.23, 12.14

UMLEdge (Dependency)                    7.7.4, B.2.3

UMLEdge (Dependency)

UMLShape (Dependency)

- UMLKeywordLabel (Dependency)

- UMLNameLabel (Dependency)

UMLEdge (Dependency)

UMLEdge (Dependency)

UMLEdge (Realization)                   7.7.4, B.2.3

Fig 7.21, 10.11

UMLEdge (Substitution)                  9.2.4, B.2.3

- UMLKeywordLabel (Substitution)        Fig 9.3

UMLEdge (Generalization)                9.2.4, B.2.3

- UMLNameLabel (GeneralizationSet)      Fig 9.2, 9.15,

- UMLLabel (Classifier)                 9.16, 9.18, 9.20,

- UMLLabel (GeneralizationSet)          9.22, 9.23, 9.24,

9.25, 9.26

UMLShape (GeneralizationSet)            9.7.4, B.2.3

- UMLNameLabel (GeneralizationSet)      Fig 9.17, 9.19,

- UMLLabel (Classifier)                 9.22, 9.22

- UMLLabel (GeneralizationSet)

UMLEdge                                 11.5.4, B.2.3

(Association/Connector/InstanceSpecif

ication/Property/ConnectorEnd)

UMLEdge                                 11.5.4, B.3.2

(Association/Connector/InstanceSpecif   Fig 11.29

ication/Property/ConnectorEnd ,

navigabilityNotation enabled)

UMLEdge                                 11.5.4, B.3.2

(Association/Connector/InstanceSpecif   Fig. 11.30

ication/Property/ConnectorEnd ,

isAssociationDotShown enabled)

UMLEdge                                 11.5.4, B.3.2

(Association/Connector/InstanceSpecif   Fig 11.29

ication/Property/ConnectorEnd,

nonNavigabilityNotation enabled)

Notation           Diagram elements                      Ref.

UMLEdge                                 11.5.4, B.2.3

(Association/Connector/InstanceSpecif

ication/Property/ConnectorEnd, shared

associationEnd)

UMLEdge                                 11.5.4, B.2.3

(Association/Connector/InstanceSpecif   Fig 11.33, 11.34

ication/Property/ConnectorEnd,

composite associationEnd)

UMLEdge (Property/ConnectorEnd)         11.5.4, B.3.5

UMLAssociationOrConnectorLinkSha        Fig. 11.27, 11.36

pe

(Association/InstanceSpecification/Co

nnector, kind=Diamond)

UMLEdge (Property/ConnectorEnd)

UMLEdge                                 11.5.4, B.3.5

(Association/Connector/InstanceSpecif

ication)

-

UMLAssociationOrConnectorLinkSha

pe

(Association/Connector/InstanceSpecif

ication, kind=Triangle)

UMLEdge (Association)                   11.5.4, B.3.4

- UMLAssociationEndLabel                Fig 7.12, 9.12,

(Property)                              11.5, 11.26,

- UMLNameLabel (Association)            11.28, 11.32

- UMLMultiplicityLabel (Property)

- UMLRedefinesLabel (Property)

- UMLLabel (Property)

UMLEdge (Association)                   9.5.4, B.3.2

- UMLShape (Property)                   Fig 11.37

--- UMLLabel (Property)

UMLEdge (Connector)                     11.2.4, B.2.4,

- UMLAssociationEndLabel                B.3.4

(Property)                              Fig 11.5, 11.6,

- UMLTypedElementLabel                  11.7, 11.19,

(Connector)                             11.20,

- UMLMultiplicityLabel

(ConnectorEnd)

Notation            Diagram elements                     Ref.

UMLEdge (InterfaceGeneralization)    10.4.4, B.3.2

UMLShape (Interface, isIcon=true,    Fig 11.4, 11.8,

provided)                            11.9

UMLEdge (Connector)

UMLShape (Interface, isIcon=true,

required)

UMLEdge (InterfaceGeneralization)

UMLEdge (InstanceSpecification)      9.8.4, B.3.2

- UMLNameLabel (StructuralFeature)   Fig. 9.30, 9.32,

11.21

UMLClassifierShape (Classifier)      10.4.4, B.3.3

UMLEdge (Usage)

UMLClassifierShape (Interface,

isIcon=true)

UMLClassifierShape (Collaboration)   11.7.4, B.2.3

- UMLNameLabel (Collaboration)

UMLEdge (ConnectableElement)

- UMLNameLabel

(ConnectableElement)

UMLClassifierShape (Classifier)

- UMLNameLabel (Classifier)

UMLEdge (CollaborationUse)           11.7.4, B.2.3

- UMLKeywordLabel

(CollaborationUse)

UMLEdge (PackageMerge)               12.2.4, B.2.3

- UMLLabel (PackageMerge)            Fig. 12.2, 12.3,

12.4, 12.6, 12.8

UMLEdge (Extension)                  B.3.4

- UMLAssociationEndLabel

(ExtensionEnd)

UMLEdge (ProfileApplication)         B.2.3

UMLKeywordLabel

(ProfileApplication)

UMLEdge (Transition)                 14.2.4, B.2.3

- UMLLabel (Transition)              Fig. 14.30,

- UMLLabel                           14.31, 14.34,

(ConnectionPointReference)           14.35, 14.42,

14.43, 14.46

UMLEdge (ActivityEdge)               15.2.4, B.4.3

- UMLNameLabel (ActivityEdge)        Fig. 15.5, 15.7,

- UMLLabel (ActivityEdge)            15.9, 15.13,

- UMLLabel (ActivityEdge)            15.14, 15.21

Notation            Diagram elements                      Ref.

UMLEdge (ControlFlow)                    15.2.4, B.2.3

- UMLKeywordLabel (ControlFlow)          Fig 15.8, 15.18

UMLShape (Action)                        15.2.4, B.4.2

UMLEdge (ObjectFlow+)                    Fig 15.11, 15.15

- UMLShape (ObjectFlow+,

isIcon=true)

UMLShape (Action)

UMLEdge (ObjectFlow, isIcon=true)        16.3.4, B.2.3

UMLShape (ObjectNode, streaming

parameter)

UMLEdge (ActivityEdge)                   15.2.4, B.4.2

UMLShape (ActivityEdge)                  Fig. 15.6, 15.13,

UMLShape (ActivityEdge)                  15.19

UMLEdge (ActivityEdge)

UMLEdge (ActivityEdge, isIcon=true,      15.6.4, B.4.2

interruptible or going to an             Fig. 15.5, 15.7,

ExceptionHandler body)                   15.62, 15.64,

15.68

UMLEdge (ActivityEdge)                   15.6.4, B.4.2

- UMLShape (ActivityEdge,                Fig. 15.63, 15.69

isIcon=true, interruptible or going to

an ExceptionHandler body)

UMLEdge (Message, asynchronous           17.4.4, B.2.3

signal/call)                             Fig. 17.3

- UMLLabel (Message)

UMLEdge (Message, synchronous            17.4.4, B.2.3

call)

UMLEdge (Message, reply)                 17.4.4, B.2.3

UMLEdge (Message, createMessage)         17.4.4, B.2.3

UMLEdge (Message, lost)                  17.4.4, B.4.2

UMLEdge (Message, found)                 17.4.4, B.4.2

UMLEdge (GeneralOrdering)                17.5.4, B.4.2

Fig. 17.10

Notation           Diagram elements                   Ref.

UMLShape (Lifeline, line)           17.2.4, B.2.3

- UMLLabel (Lifeline, rectangle)    Fig. 17.4

UMLShape (Gate)

UMLEdge (Message)

UMLShape (ExecutionSpecification)

UMLEdge (Message)                   17.11.1, B.2.3

UMLShape (Message)

- UMLLabel (Message)

UMLShape (Message)

- UMLLabel (Message)

UMLEdge (Message)

UMLEdge (Extend)                    18.1.4, B.4.2

- UMLKeywordLabel (Extend)          Fig. 18.3

UMLEdge (Include)                   18.1.4, B.4.2

- UMLKeywordLabel (Include)         Fig. 18.4

UMLEdge (Deployment)                19.2.4, B.2.3

- UMLKeywordLabel (Deployment)      Fig. 19.15, 19.16

UMLEdge (InformationFlow)           20.1.4, B.5

- UMLKeywordLabel                   Fig. 20.2, 20.5,

(InformationFlow)                   20.6

- UMLShape (InformationFlow,

isIcon=true)

B.7           Описания классификаторов B.7.1         UMLActivityDiagram [Class] B.7.1.1       Описание

Показывает деятельность и её элементы. См. также Приложение A.

B.7.1.2       Обобщения

UMLBehaviorDiagram

B.7.1.3       Атрибуты

- isActivityFrame : Boolean [1..1] = false

  Указывает, следует ли показывать UMLActivityDiagram с рамкой — прямоугольником со скруглёнными углами без пятиугольного заголовка.

B.7.1.4       Концы ассоциаций

- modelElement : Activity [1..1]{redefines UMLBehaviorDiagram::modelElement} (opposite

  A_UMLActivityDiagram_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLActivityDiagram показом деятельностей.

B.7.1.5       Ограничения

- **frame**

  isFrame и isActivityFrame не должны быть истинны одновременно.

  ```ocl
  inv: not (isActivityFrame and isFrame)
  ```

B.7.2         UMLAssociationEndLabel [Class] B.7.2.1       Описание

Показывает текст о свойствах, являющихся концами ассоциаций.

B.7.2.2       Обобщения

UMLLabel

B.7.2.3       Концы ассоциаций

- modelElement : Property [1..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLAssociationEndLabel_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLAssociationEndLabel показом только свойств (являющихся концами ассоциаций, см. ограничение).

B.7.2.4       Ограничения

- **modelElement_type**

  modelElement должен быть концом ассоциации.

  ```ocl
  inv: not modelElement->forAll(association->isEmpty())
  ```

B.7.3         UMLAssociationOrConnectorOrLinkShape [Class] B.7.3.1       Описание

Показывает фигуры для бинарных связей.

B.7.3.2       Обобщения

UMLShape

B.7.3.3       Атрибуты

- kind : UMLAssociationOrConnectorOrLinkShapeKind [1..1]

B.7.3.4       Ограничения

- **modelElement_mult**

  У UMLAssociationOrConnectorOrLinkShape должен быть ровно один modelElement.

  ```ocl
  inv: modelElement->size()=1
  ```

- **modelElement_type**

  modelElement должен быть ассоциацией, коннектором или InstanceSpecification с классификатором-ассоциацией.

  ```ocl
  inv: modelElement->asSequence()->first().oclIsKindOf(Association) or modelElement-
  >asSequence()->first().oclIsKindOf(Connector)
  or (       modelElement->asSequence()->first().oclIsKindOf(InstanceSpecification)
  and (modelElement->asSequence()->first().oclAsType(InstanceSpecification).classifier-
  >select(oclIsKindOf(Association))->size() > 0))
  ```

- **edge_association**

  Для kind со значением diamond и modelElement-ассоциации у ассоциации ровно два конца-члена, и ровно у двух UMLEdge, связанных с этой фигурой, эти концы-члены являются modelElements.

  ```ocl
  inv: (kind=UMLAssociationOrConnectorOrLinkShapeKind::diamond and modelElement-
  >forAll(oclIsKindOf(Association))) implies
  let association : Association = modelElement->any(true).oclAsType(Association) in
  ((association.memberEnd->size() = 2) and
  (sourceEdge.modelElement->union(targetEdge.modelElement)->select(em |
  association.memberEnd->includes(em))->size()=2))
  ```

- **edge_instancespec**

  Для kind со значением diamond и modelElement — InstanceSpecification ровно один классификатор-ассоциация этого InstanceSpecification имеет ровно два конца-члена, и ровно у двух UMLEdge, связанных с этой фигурой, эти концы-члены являются modelElements.

  ```ocl
  inv: (kind=UMLAssociationOrConnectorOrLinkShapeKind::diamond and modelElement-
  >forAll(oclIsKindOf(InstanceSpecification))) implies
  let instanceSpecification : InstanceSpecification = modelElement-
  >any(true).oclAsType(InstanceSpecification) in
  (instanceSpecification.classifier->select(a | a.oclIsKindOf(Association) and
  (a.oclAsType(Association).memberEnd->size() = 2) and
  (sourceEdge.modelElement->union(targetEdge.modelElement)
  ->select(e | a.oclAsType(Association).memberEnd->includes(e.modelElement))
  ->size()=2))
  ->size()=1)
  ```

- **edge_connector**

  Для kind со значением diamond и modelElement-коннектора у коннектора ровно два конца, и ровно у двух UMLEdge, связанных с этой фигурой, definingEnd этих концов являются modelElements.

  ```ocl
  inv: (kind=UMLAssociationOrConnectorOrLinkShapeKind::diamond and modelElement-
  >forAll(oclIsKindOf(Connector))) implies
  let connector : Connector = modelElement->any(true).oclAsType(Connector) in
  ((connector.end->size() = 2) and
  (sourceEdge.modelElement->union(targetEdge.modelElement)->select(em |
  connector.end.definingEnd->includes(em))->size()=2))
  ```

B.7.4         UMLAssociationOrConnectorOrLinkShapeKind [Enumeration] B.7.4.1       Описание

B.7.4.2       Литералы

- **diamond**

- **triangle**

B.7.5         UMLBehaviorDiagram [Abstract Class] B.7.5.1       Описание

Самый общий класс для UMLDiagram, изображающих поведенческие элементы.

B.7.5.2       Обобщения

UMLDiagram

B.7.5.3       Специализации

UMLActivityDiagram, UMLInteractionDiagram, UMLStateMachineDiagram, UMLUseCaseDiagram

B.7.5.4       Концы ассоциаций

- modelElement : Behavior [0..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLBehaviorDiagram_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLBehaviorDiagram показом поведений.

B.7.6         UMLClassDiagram [Class] B.7.6.1       Описание

See Annex A.

B.7.6.2       Обобщения

UMLStructureDiagram

B.7.6.3       Ограничения

- **no_modelElement**

  У UMLClassDiagram не должно быть modelElements.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.7         UMLClassifierShape [Class] B.7.7.1       Описание

Показывает классификаторы фигурами, которые могут иметь разделы.

B.7.7.2       Обобщения

UMLCompartmentableShape

B.7.7.3       Атрибуты

- isIndentForVisibility : Boolean [1..1] = false

  Для modelElements, показываемых с разделами характеристик, указывает, показываются ли характеристики с отступом под заголовками видимости.

- isDoubleSided : Boolean [1..1] = false

  Для modelElements, являющихся классами со значением true для isActive и показываемых прямоугольниками, указывает, следует ли отображать вертикальные стороны двойными линиями.

B.7.7.4       Концы ассоциаций

- modelElement : Classifier [1..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLClassifierShape_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLClassifierShape показом ровно одного классификатора.

B.7.7.5       Ограничения

- **doubleSided_isActive**

  isDoubleSided может быть истинно, только когда modelElement — активный класс.

  ```ocl
  inv: isDoubleSided implies (modelElement->forAll(oclIsKindOf(Class)) and
  modelElement.oclAsType(Class)->forAll(isActive))
  ```

B.7.8         UMLCompartment [Class] B.7.8.1       Описание

Отделённая часть UMLCompartmentableShape.

B.7.8.2       Обобщения

UMLDiagramElement

B.7.8.3       Концы ассоциаций

- ♦ elementInCompartment : UMLDiagramElement [0..*]{ordered, subsets DiagramElement::ownedElement}

  (opposite A_UMLCompartment_elementInCompartment_owningCompartment::owningCompartment) Содержимое раздела.

B.7.8.4       Ограничения

- **no_modelElement**

  У UMLCompartment нет modelElements.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.9         UMLCompartmentableShape [Class] B.7.9.1       Описание

Самый общий класс для элементов UML, содержимое которых может показываться отделёнными частями внутри фигуры.

B.7.9.2       Обобщения

UMLShape

B.7.9.3       Специализации

UMLClassifierShape, UMLStateShape

B.7.9.4       Концы ассоциаций

- ♦ compartment : UMLCompartment [0..*]{ordered, subsets DiagramElement::ownedElement} (opposite

  A_UMLCompartmentableShape_compartmentedShape_shape::compartmentedShape) Отделённые части фигуры.

B.7.10        UMLComponentDiagram [Class] B.7.10.1      Описание

See Annex A.

B.7.10.2      Обобщения

UMLStructureDiagram

B.7.10.3      Ограничения

- **no_modelElement**

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.11        UMLCompositeStructureDiagram [Class] B.7.11.1      Описание

Показывает внутреннюю структуру структурированного классификатора. См. также Приложение A.

B.7.11.2      Обобщения

UMLStructureDiagram

B.7.11.3      Ограничения

- **modelElement_mult**

  У UMLCompositeStructureDiagram должен быть ровно один modelElement.

  ```ocl
  inv: modelElement->size() = 1
  ```

- **modelElement_type**

  modelElement должен быть структурированным классификатором или InstanceSpecification с классификатором, являющимся структурированным классификатором.

  ```ocl
  inv: modelElement->asSequence()->first().oclIsKindOf(StructuredClassifier)
  or (       modelElement->asSequence()->first().oclIsKindOf(InstanceSpecification)
  and (modelElement->asSequence()->first().oclAsType(InstanceSpecification).classifier-
  >select(c | c.oclIsKindOf(StructuredClassifier))->size() > 0))
  ```

B.7.12       UMLDeploymentDiagram [Class] B.7.12.1     Описание

See Annex A.

B.7.12.2     Обобщения

UMLStructureDiagram

B.7.12.3     Ограничения

- **no_modelElement**

  У UMLDeploymentDiagram не должно быть modelElement.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.13       UMLDiagram [Abstract Class] B.7.13.1     Описание

Самый общий класс для диаграмм UML.

B.7.13.2     Обобщения

Diagram, PackageableElement, UMLDiagramElement

B.7.13.3     Специализации

UMLDiagramWithAssociations, UMLBehaviorDiagram

B.7.13.4     Атрибуты

- isFrame : Boolean [1..1] = true

  Указывает, когда следует показывать рамки диаграмм.

- isIso : Boolean [1..1] = true

  Указывает, когда следует придерживаться правил нотации ISO.

- isInheritedLighter : Boolean [1..1] = false

B.7.13.5     Концы ассоциаций

- heading : UMLLabel [0..1] (opposite A_UMLDiagram_heading_headedDiagram::headedDiagram)

B.7.13.6      Ограничения

- no-frame-no-heading: у UMLDiagram не может быть заголовков без рамок, и наоборот.

  ```ocl
  inv: (isFrame = false) = (heading->isEmpty())
  ```

- **heading_modelElement**

  modelElement заголовка совпадает с modelElement диаграммы, которую он возглавляет.

  ```ocl
  inv: (heading->isEmpty()) or (heading.modelElement = modelElement)
  ```

B.7.14        UMLDiagramElement [Abstract Class] B.7.14.1      Описание

Самый общий класс для обмена диаграммами UML.

B.7.14.2      Обобщения

DiagramElement

B.7.14.3      Специализации

UMLCompartment, UMLDiagram, UMLEdge, UMLShape

B.7.14.4      Атрибуты

- isIcon : Boolean [1..1] = false

  Для modelElements, которые могут показываться фигурами, отличными от прямоугольников, например актёры, или с другими опознавательными фигурами внутри, например стрелками, различающими входные и выходные выводы, либо рёбрами, которые могут показываться линиями, отличными от сплошной с открытым наконечником, например реализация. Значение true для isIcon указывает, что следует показывать альтернативную нотацию.

B.7.14.5      Концы ассоциаций

- modelElement : Element [0..*]{redefines DiagramElement::modelElement} (opposite

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLDiagramElement показом элементов UML, а не иных элементов языка.

- sharedStyle : UMLStyle [0..1]{redefines DiagramElement::sharedStyle} (opposite

  A_UMLDiagramElement_sharedStyle_styledElement::styledElement) Ограничивает общие стили стилями UML.

- ♦ localStyle : UMLStyle [0..1]{redefines DiagramElement::localStyle} (opposite

  A_UMLDiagramElement_localStyle_styledElement::styledElement) Ограничивает принадлежащие стили стилями UML.

- owningElement : UMLDiagramElement [0..1]{redefines DiagramElement::owningElement} (opposite

  UMLDiagramElement::ownedElement) Ограничивает принадлежность UMLDiagramElement только UMLDiagramElement.

- ♦ ownedElement : UMLDiagramElement [0..*]{ordered, redefines DiagramElement::ownedElement}

  (opposite UMLDiagramElement::owningElement) Ограничивает UMLDiagramElement владением только UMLDiagramElement.

B.7.15       UMLDiagramWithAssociations [Abstract Class] B.7.15.1     Описание

Задаёт общие аспекты диаграмм, показывающих ассоциации.

B.7.15.2     Обобщения

UMLDiagram

B.7.15.3     Специализации

UMLStructureDiagram, UMLUseCaseDiagram

B.7.15.4     Атрибуты

- isAssociationDotShown : Boolean [1..1] = false

  Указывает, следует ли использовать точечную нотацию для ассоциаций.

- navigabilityNotation : UMLNavigabilityNotationKind [1..1] = oneWay

  Указывает, когда показывать навигабельность ассоциаций или коннекторов, типизированных ассоциациями.

- nonNavigabilityNotation : UMLNavigabilityNotationKind [1..1] = never

  Указывает, когда показывать ненавигабельность ассоциаций или коннекторов, типизированных ассоциациями.

B.7.16       UMLEdge [Class] B.7.16.1     Описание

Самый общий класс для элементов диаграмм UML, отображаемых линиями.

B.7.16.2     Обобщения

Edge, UMLDiagramElement

B.7.16.3     Концы ассоциаций

- source : UMLDiagramElement [1..1]{redefines Edge::source} (opposite

  A_UMLEdge_source_sourceEdge::sourceEdge) Ограничивает источники UMLEdge элементами UMLDiagramElement.

- target : UMLDiagramElement [1..1]{redefines Edge::target} (opposite

  A_UMLEdge_target_targetEdge::targetEdge) Ограничивает цели UMLEdge элементами UMLDiagramElement.

B.7.17       UMLInteractionDiagram [Class] B.7.17.1     Описание

Показывает взаимодействие и его элементы. См. также Приложение A.

B.7.17.2      Обобщения

UMLBehaviorDiagram

B.7.17.3      Атрибуты

- kind : UMLInteractionDiagramKind [1..1] = sequence

  Указывает, как следует показывать взаимодействие.

- isLifelineDashed : Boolean [1..1] = false

  Указывает, следует ли отображать линии жизни на диаграмме пунктирными.

B.7.17.4      Концы ассоциаций

- modelElement : Interaction [1..1]{redefines UMLBehaviorDiagram::modelElement} (opposite

  A_UMLInteractionDiagram_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLInteractionDiagram показом взаимодействий.

B.7.18        UMLInteractionDiagramKind [Enumeration] B.7.18.1      Описание

Альтернативы изображения взаимодействий на диаграмме.

B.7.18.2      Литералы

- **sequence**

  See sub clause 17.8.

- **communication**

  See sub clause 17.9.

- **overview**

  See sub clause 17.10.

- **timing**

  See sub clause 17.11.

- **table**

  See Annex D.

B.7.19        UMLInteractionTableLabel [Class] B.7.19.1      Описание

B.7.19.2      Обобщения

UMLLabel

B.7.19.3      Атрибуты

- kind : UMLInteractionTableLabelKind [1..1]

B.7.20       UMLInteractionTableLabelKind [Enumeration] B.7.20.1     Описание

B.7.20.2     Литералы

- **lifelineClass**

- **lifelineInstance**

- **constraint**

- **messageSendingClass**

- **messageSendingInstance**

- **diagramIdentifier**

- **generatedInstanceName**

- **sequenceNumber**

- **weakOrder**

- **messageName**

- **parameter**

- **returnValue**

- **messageReceivingClass**

- **messageReceivingInstance**

- **otherEnd**

B.7.21       UMLKeywordLabel [Class] B.7.21.1     Описание

Для показа ключевых слов modelElement.

B.7.21.2     Обобщения

UMLLabel

B.7.21.3     Ограничения

- **modeElement_mult**

  У UMLKeyword должен быть ровно один modelElement.

  ```ocl
  inv: modelElement->size() = 1
  ```

B.7.22        UMLLabel [Class] B.7.22.1      Описание

Самый общий класс для фигур UML, отображаемых только текстом.

B.7.22.2      Обобщения

UMLShape

B.7.22.3      Специализации

UMLAssociationEndLabel, UMLMultiplicityLabel, UMLKeywordLabel, UMLNameLabel,

UMLRedefinesLabel, UMLStereotypePropertyValueLabel, UMLTypedElementLabel,

UMLInteractionTableLabel

B.7.22.4      Атрибуты

- text : String [1..1]

  Строка для отображения.

B.7.22.5      Ограничения

- **modelElement_mult**

  У UMLLabel должно быть не более одного modelElement.

  ```ocl
  inv: modelElement->size() <= 1
  ```

- **no_icon**

  У UMLLabel должно быть значение false для isIcon.

  ```ocl
  inv: isIcon=false
  ```

B.7.23        UMLMultiplicityLabel [Class] B.7.23.1      Описание

Показывает текст об элементах кратности.

B.7.23.2      Обобщения

UMLLabel

B.7.23.3      Концы ассоциаций

- modelElement : MultiplicityElement [1..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLMultiplicityElement_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLMultiplicityLabel показом только элементов кратности.

B.7.24        UMLNameLabel [Class] B.7.24.1      Описание

Для показа текста об именованных элементах.

B.7.24.2     Обобщения

UMLLabel

B.7.24.3     Концы ассоциаций

- modeElement : NamedElement [1..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLNameLabel_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLNameLabel нотацией для именованных элементов.

B.7.25       UMLNavigabilityNotationKind [Enumeration] B.7.25.1     Описание

Альтернативы показа навигабельности или ненавигабельности ассоциаций и коннекторов, типизированных ассоциациями.

B.7.25.2     Литералы

- **always**

  Всегда показывать навигабельность или ненавигабельность.

- **oneWay**

  Показывать навигабельность или ненавигабельность только для однонаправленных ассоциаций и коннекторов, типизированных однонаправленными ассоциациями.

- **never**

  Никогда не показывать навигабельность или ненавигабельность.

B.7.26       UMLObjectDiagram [Class] B.7.26.1     Описание

See Annex A.

B.7.26.2     Обобщения

UMLStructureDiagram

B.7.26.3     Ограничения

- **no_modelElement**

  У UMLObjectDiagram не должно быть modelElement.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.27       UMLPackageDiagram [Class] B.7.27.1     Описание

See Annex A.

B.7.27.2     Обобщения

UMLStructureDiagram

B.7.27.3      Ограничения

- **no_modelElement**

  У UMLPackageDiagram не должно быть modelElement.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.28        UMLProfileDiagram [Class] B.7.28.1      Описание

See Annex A.

B.7.28.2      Обобщения

UMLStructureDiagram

B.7.28.3      Ограничения

- **no_modelElement**

  У UMLProfileDiagram не должно быть modelElement.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.7.29        UMLRedefinesLabel [Class] B.7.29.1      Описание

For showing redefinition.

B.7.29.2      Обобщения

UMLLabel

B.7.29.3      Концы ассоциаций

- modelElement : RedefinableElement [1..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLRedefines_modelElement_umlDiagramElement::umlDiagramElement) Ограничивает UMLRedefinesLabel нотацией для переопределяемых элементов.

B.7.30        UMLShape [Class] B.7.30.1      Описание

Самый общий класс для элементов диаграмм UML, которые не отображаются линиями.

B.7.30.2      Обобщения

Shape, UMLDiagramElement

B.7.30.3      Специализации

UMLAssociationOrConnectorOrLinkShape, UMLCompartmentableShape, UMLLabel

B.7.31       UMLStateMachineDiagram [Class] B.7.31.1     Описание

Показывает машину состояний и её элементы. См. также Приложение A.

B.7.31.2     Обобщения

UMLBehaviorDiagram

B.7.31.3     Атрибуты

- isCollapseStateIcon : Boolean [1..1] = true

  Указывает, должны ли UMLShape составных состояний содержать маленький значок, отличающий их от несоставных состояний.

- isInheritedDashed : Boolean [1..1] = false

  Указывает, как следует отображать границы UMLShape, у которых унаследованное состояние является modelElement.

- isTransitionOriented : Boolean [1..1] = false

  Указывает, следует ли показывать свойства переходов графически.

B.7.31.4     Концы ассоциаций

- modelElement : StateMachine [1..1]{redefines UMLBehaviorDiagram::modelElement} (opposite

  A_UMLStateMachine_modelElement_umlDiagramElement::umlDiagramElement)

B.7.31.5     Ограничения

- **isd_isl_xor**

  isInheritedDashed и isInheritedLighter не могут оба иметь значение true.

  ```ocl
  inv: not (isInheritedDashed and isInheritedLighter)
  ```

- **isd_isl_req**

  Если диаграмма показывает унаследованные состояния, то либо isInheritedDashed, либо isInheritedLighter должно иметь значение true.

  ```ocl
  inv: 
  ```

B.7.32       UMLStateShape [Class] B.7.32.1     Описание

B.7.32.2     Обобщения

UMLCompartmentableShape

B.7.32.3     Атрибуты

- isTabbed : Boolean [1..1] = false

B.7.32.4        Концы ассоциаций

- modelElement : State [1..*]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLStateShape_modelElement_umlDiagramElement::umlDiagramElement)

B.7.32.5        Ограничения

- **state_list**

  У UMLStateShape может быть несколько modelElements, только когда их исходящие переходы не имеют триггеров и эффектов и ведут в одно и то же состояние-соединение, имеющее один исходящий переход.

  ```ocl
  inv: (modelElement->size() > 1) implies
  (         modelElement->forAll(outgoing->forAll(trigger->isEmpty() and
  effect->isEmpty()
  and
  target.oclIsKindOf(Pseudostate) and
  target.oclAsType(Pseudostate).kind = PseudostateKind::junction and
  target.outgoing-
  >size() = 1))
  and modelElement.outgoing.target->asSet()->size()=1)
  ```

B.7.33          UMLStereotypePropertyValueLabel [Class] B.7.33.1        Описание

Для показа значений свойств стереотипов, применённых к элементам абстрактного синтаксиса UML.

B.7.33.2        Обобщения

UMLLabel

B.7.33.3        Концы ассоциаций

- modelElement : Property [1..1]{redefines UMLDiagramElement::modelElement} (opposite

  A_UMLStereotypePropertyValueLabel_modelElement_umlDiagramElement::umlDiagramElement) Свойство стереотипа, применённого к stereotypedElement.

- stereotypedElement : Element [1..1] (opposite

  A_UMLStereotypePropertyValueLabel_stereotypedElement_labelShowingStereotypeValue::labelShowingSter eotypeValue) Элемент, к которому применён стереотип, имеющий modelElement (свойство).

B.7.33.4        Ограничения

- **prop_on_stereotype**

  modelElement — свойство стереотипа.

  ```ocl
  inv: modelElement->forAll(classifier.oclIsKindOf(Stereotype))
  ```

- **stereotypedElement**

  Свойство должно принадлежать стереотипу, применённому к stereotypedElement.

  ```ocl
  inv: 
  ```

B.7.34       UMLStructureDiagram [Abstract Class] B.7.34.1     Описание

Самый общий класс для UMLDiagram, изображающих структурные элементы.

B.7.34.2     Обобщения

UMLDiagramWithAssociations

B.7.34.3     Специализации

UMLClassDiagram, UMLComponentDiagram, UMLCompositeStructureDiagram, UMLDeploymentDiagram,

UMLObjectDiagram, UMLPackageDiagram, UMLProfileDiagram

B.7.35       UMLStyle [Class] B.7.35.1     Описание

Самый общий класс для стилей в UML.

B.7.35.2     Обобщения

Style, PackageableElement

B.7.35.3     Атрибуты

- fontName : String [0..1]

  Имя шрифта, используемого для отображения строк.

- fontSize : Real [0..1]

  Размер шрифта для отображения строк, в типографских пунктах.

B.7.35.4     Ограничения

- **fontsize_positive**

  fontSize должно быть больше нуля.

  ```ocl
  inv: fontSize > 0
  ```

B.7.36       UMLTypedElementLabel [Class] B.7.36.1     Описание

Для показа текста о слотах, InstanceSpecification, InstanceValue или элементах с типом, например о типизированных элементах или коннекторах.

B.7.36.2     Обобщения

UMLLabel

B.7.36.3     Ограничения

- **modelElement_mult**

  У UMLTypedElementLabel должен быть ровно один modelElement.

  ```ocl
  inv: modelElement->size() = 1
  ```

- **modelElement_type**

  modelElement должен быть слотом, InstanceSpecification, InstanceValue или элементом с типом, например типизированным элементом или коннектором.

  Не выражается в OCL

B.7.37        UMLUseCaseDiagram [Class] B.7.37.1      Описание

See Annex A.

B.7.37.2      Обобщения

UMLBehaviorDiagram, UMLDiagramWithAssociations

B.7.37.3      Ограничения

- **no_modelElement**

  У UMLUseCaseDiagram не должно быть modelElements.

  ```ocl
  inv: modelElement->isEmpty()
  ```

B.8           Описания ассоциаций B.8.1         A_UMLActivityDiagram_modelElement_umlDiagramElement [Association] B.8.1.1       Принадлежащие концы

- umlDiagramElement : UMLActivityDiagram [0..*]{redefines

  A_UMLBehaviorDiagram_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLActivityDiagram::modelElement)

B.8.2         A_UMLAssociationEndLabel_modelElement_umlDiagramElement

[Association] B.8.2.1       Owned Ends

- umlDiagramElement : UMLAssociationEndLabel [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLAssociationEndLabel::modelElement)

B.8.3         A_UMLBehaviorDiagram_modelElement_umlDiagramElement

[Association] B.8.3.1       Owned Ends

- umlDiagramElement : UMLBehaviorDiagram [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLBehaviorDiagram::modelElement)

B.8.4         A_UMLClassifierShape_modelElement_umlDiagramElement [Association] B.8.4.1       Принадлежащие концы

- umlDiagramElement : UMLClassifierShape [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLClassifierShape::modelElement)

B.8.5         A_UMLCompartment_elementInCompartment_owningCompartment

[Association] B.8.5.1       Owned Ends

- owningCompartment : UMLCompartment [0..1]{subsets DiagramElement::owningElement} (opposite

  UMLCompartment::elementInCompartment)

B.8.6         A_UMLCompartmentableShape_compartmentedShape_shape

[Association] B.8.6.1       Owned Ends

- compartmentedShape : UMLCompartmentableShape [1..1]{subsets DiagramElement::owningElement}

  (opposite UMLCompartmentableShape::compartment)

B.8.7         A_UMLDiagramElement_localStyle_styledElement [Association] B.8.7.1       Принадлежащие концы

- styledElement : UMLDiagramElement [0..*]{redefines A_sharedStyle_styledElement::styledElement}

  (opposite UMLDiagramElement::localStyle)

B.8.8         A_UMLDiagramElement_modelElement_umlDiagramElement [Association] B.8.8.1       Принадлежащие концы

- umlDiagramElement : UMLDiagramElement [0..*]{subsets

  A_modelElement_diagramElement::diagramElement} (opposite UMLDiagramElement::modelElement)

B.8.9         A_UMLDiagramElement_ownedElement_owningElement [Association] B.8.9.1       Концы-члены

- UMLDiagramElement::ownedElement

- UMLDiagramElement::owningElement

B.8.10        A_UMLDiagramElement_sharedStyle_styledElement [Association] B.8.10.1      Принадлежащие концы

- styledElement : UMLDiagramElement [0..*]{redefines A_sharedStyle_styledElement::styledElement}

  (opposite UMLDiagramElement::sharedStyle)

B.8.11        A_UMLDiagram_heading_headedDiagram [Association] B.8.11.1      Принадлежащие концы

- headedDiagram : UMLDiagram [0..*] (opposite UMLDiagram::heading)

B.8.12        A_UMLEdge_source_sourceEdge [Association] B.8.12.1      Принадлежащие концы

- sourceEdge : UMLEdge [0..*]{redefines A_source_sourceEdge::sourceEdge} (opposite UMLEdge::source)

B.8.13        A_UMLEdge_target_targetEdge [Association] B.8.13.1      Принадлежащие концы

- targetEdge : UMLEdge [0..*]{redefines A_target_targetEdge::targetEdge} (opposite UMLEdge::target)

B.8.14        A_UMLInteractionDiagram_modelElement_umlDiagramElement

[Association] B.8.14.1      Owned Ends

- umlDiagramElement : UMLInteractionDiagram [0..*]{redefines

  A_UMLBehaviorDiagram_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLInteractionDiagram::modelElement)

B.8.15        A_UMLMultiplicityElement_modelElement_umlDiagramElement

[Association] B.8.15.1      Owned Ends

- umlDiagramElement : UMLMultiplicityLabel [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLMultiplicityLabel::modelElement)

B.8.16        A_UMLNameLabel_modelElement_umlDiagramElement [Association] B.8.16.1      Принадлежащие концы

- umlDiagramElement : UMLNameLabel [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLNameLabel::modeElement)

B.8.17       A_UMLRedefines_modelElement_umlDiagramElement [Association] B.8.17.1     Принадлежащие концы

- umlDiagramElement : UMLRedefinesLabel [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLRedefinesLabel::modelElement)

B.8.18       A_UMLStateMachine_modelElement_umlDiagramElement [Association] B.8.18.1     Принадлежащие концы

- umlDiagramElement : UMLStateMachineDiagram [0..*]{redefines

  A_UMLBehaviorDiagram_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLStateMachineDiagram::modelElement)

B.8.19       A_UMLStateShape_modelElement_umlDiagramElement [Association] B.8.19.1     Принадлежащие концы

- umlDiagramElement : UMLStateShape [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLStateShape::modelElement)

B.8.20       A_UMLStereotypePropertyValueLabel_modelElement_umlDiagramElement

[Association] B.8.20.1     Owned Ends

- umlDiagramElement : UMLStereotypePropertyValueLabel [0..*]{redefines

  A_UMLDiagramElement_modelElement_umlDiagramElement::umlDiagramElement} (opposite UMLStereotypePropertyValueLabel::modelElement)

B.8.21       A_UMLStereotypePropertyValueLabel_stereotypedElement_labelShowing

StereotypeValue [Association] B.8.21.1     Owned Ends

- labelShowingStereotypeValue : UMLStereotypePropertyValueLabel [0..*] (opposite

  UMLStereotypePropertyValueLabel::stereotypedElement)
