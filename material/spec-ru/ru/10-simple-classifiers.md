# 10 Простые классификаторы

> **UML 2.5.1** (formal/2017-12-05) · Раздел 10 · печатные стр. 167–182 · PDF стр. 209–224

## 10.1 Краткое описание

В этом пункте определяются различные виды классификатора, не имеющие сложной внутренней структуры.

## 10.2 Типы данных

### 10.2.1 Краткое описание

Типы данных (DataType) моделируют типы, экземпляры которых различаются только своим значением.

### 10.2.2 Абстрактный синтаксис

```text
                      Classifier
                                                                                {ordered, subsets attribute,
                                        {subsets namespace,
                                                                                subsets ownedMember}
                                        subsets classifier}
                                         + datatype                             + ownedAttribute
                                                                                                      Property
                       DataType
                                           0..1                                                *
                                        {subsets featuringClassifier,       {ordered, subsets feature, subsets
                                        subsets namespace, subsets          redefinableElement, subsets
                                        redefinitionContext}                ownedMember}
                                         + datatype                            + ownedOperation
                                                                                                      Operation
                                           0..1                                                  *
                                                                                                     InstanceSpecification
                                                                                 {ordered, subsets
                                               {subsets namespace}               ownedMember}
   PrimitiveType                   Enumeration    + enumeration                   + ownedLiteral   EnumerationLiteral
                                                        1                                      *
                                                        1
                                                                                                 *
                                                  + /classifier               + enumerationLiteral
                                         {readOnly, redefines classifier}      {redefines instanceSpecification}
Figure 10.1 DataTypes
```

### 10.2.3 Семантика

#### 10.2.3.1 Типы данных

Тип данных — это вид классификатора. Тип данных отличается от класса тем, что экземпляры типа данных идентифицируются только своим значением. Все экземпляры типа данных с одним и тем же значением считаются равными экземплярами.

Если тип данных имеет атрибуты (то есть свойства, которыми он владеет и которые находятся в его пространстве имён), он называется структурированным типом данных. Экземпляры структурированного типа данных содержат значения атрибутов, соответствующие его атрибутам. Экземпляры структурированного типа данных считаются равными тогда и только тогда, когда структура одинакова и значения соответствующих атрибутов равны.

Тип данных может быть параметризован, связан и использован как параметр шаблона.

#### 10.2.3.2 Примитивные типы

Примитивный тип (PrimitiveType) определяет предопределённый тип данных, не имеющий внутренней структуры. Примитивный тип может иметь алгебру и операции, определённые вне UML, например математически. Экземпляры примитивного типа, существующие во время выполнения, — это значения, соответствующие математическим элементам, определённым вне UML (например, целые числа).

#### 10.2.3.3 Перечисления

Перечисление (Enumeration) — это вид типа данных. Каждое значение перечисления соответствует одному из его литералов перечисления (EnumerationLiteral), определённых пользователем.

Как специализация классификатора, перечисление может участвовать в отношениях обобщения. Перечисление, специализирующее другое перечисление, может определять новые литералы перечисления, которых нет в обобщающем перечислении; в таком случае набор применимых литералов состоит из унаследованных литералов плюс определённых локально.

Литерал перечисления определяет элемент расширения перечисления, существующего во время выполнения. Значения, соответствующие литералам перечисления, неизменяемы и могут сравниваться на равенство. Литералы перечисления не могут изменяться в течение своего существования, поэтому любые атрибуты перечисления должны быть доступны только для чтения.

Литерал перечисления имеет имя, которое должно использоваться для его идентификации внутри своего перечисления. Имя литерала перечисления входит в область действия своего перечисления и должно быть в нём уникальным. Имена литералов перечисления должны быть полными для общего использования.

### 10.2.4 Нотация

Тип данных обозначается нотацией классификатора (прямоугольник) с ключевым словом «dataType» или, когда на него ссылаются (например, из атрибута), именем типа данных. Раздел со списком атрибутов помещается под разделом имени. Раздел со списком операций помещается под разделом атрибутов.

Примитивный тип обозначается так же, с ключевым словом «primitive» над именем примитивного типа или перед ним.

Перечисление обозначается так же. Имя перечисления помещается в верхний раздел, а ключевое слово «enumeration» — над именем или перед ним. Список литералов перечисления может быть помещён по одному в строке в раздел с именем “literals” под разделом операций. Разделы атрибутов и операций могут быть скрыты и, как правило, скрыты и пусты.

### 10.2.5 Примеры

**Рисунок 10.2** *иллюстрирует нотацию определения примитивного типа.*

«primitive» Integer

**Рисунок 10.2** *Нотация примитивного типа*

**Рисунок 10.3** *иллюстрирует нотацию определения типов данных. Тип FullName, определённый слева, используется как тип атрибута fullName в типе Person, определённом справа.*

«dataType»                   «dataType»

FullName                     Person firstName : String            fullName : FullName secondName : String initial : String

**Рисунок 10.3** *Нотация типа данных*

**Рисунок 10.4** *иллюстрирует нотацию определения перечислений.*

«enumeration» VisibilityKind public private protected package

**Рисунок 10.4** *Нотация перечисления*

## 10.3 Сигналы

### 10.3.1 Краткое описание

Сигналы и приёмы используются для моделирования асинхронного взаимодействия между объектами.

### 10.3.2 Абстрактный синтаксис

```text
   Classifier                                  BehavioralFeature
     Signal     + signal             + reception   Reception
                    1                         *
           {subsets namespace,
           subsets classifier}
   0..1   + owningSignal
           {ordered, subsets attribute,
           subsets ownedMember}
     *    + ownedAttribute
   Property
Figure 10.5 Signals
```

### 10.3.3 Семантика

#### 10.3.3.1 Сигналы

Сигнал (Signal) — это спецификация вида взаимодействия между объектами, при котором в получателе асинхронно запускается реакция без ответа. Получающий объект обрабатывает сигналы так, как определено в пункте 13.3. Данные, переносимые взаимодействием, представлены как атрибуты сигнала. Сигнал определяется независимо от классификаторов, которые его обрабатывают.

Отправитель сигнала не блокируется в ожидании ответа, а немедленно продолжает выполнение. Объявляя приём, связанный с данным сигналом, классификатор указывает, что его экземпляры смогут принимать этот сигнал или его подтип и отвечать на него назначенным поведением.

Сигнал может быть параметризован, связан и использован как параметр шаблона.

#### 10.3.3.2 Приёмы

Приём (Reception) указывает, что владеющий им класс или интерфейс готов реагировать на получение сигнала. Приём соответствует сигналу, если полученный сигнал является специализацией сигнала этого приёма. Детали того, как объект реагирует на полученный сигнал, зависят от вида поведения, связанного с приёмом, и от владеющего им класса или интерфейса. См. 13.2. Имя приёма совпадает с именем сигнала. Приём может иметь только входные параметры (см. 9.4.3), которые совпадают с атрибутами сигнала по имени, типу и кратности.

### 10.3.4 Нотация

Сигнал изображается символом классификатора с ключевым словом «signal».

Приёмы показываются в разделе приёмов с той же нотацией, что и операции, с ключевым словом «signal».

### 10.3.5 Примеры

**Рисунок 10.6** *показывает интерфейс IAlarm, который определяет два приёма, каждый из которых ссылается на сигнал, также показанный в примере.*

ПРИМЕЧАНИЕ. Имя приёма совпадает с именем сигнала, а параметр приёма совпадает с атрибутом сигнала.

«signal»

«interface»                                        Notify

IAlarm

«signal» Notify()                                      «signal»

«signal» Activate()                                   Activate

**Рисунок 10.6** *Нотация приёма*

## 10.4 Интерфейсы

### 10.4.1 Краткое описание

Интерфейсы объявляют согласованные службы, которые реализуются классификаторами с поведением; последние реализуют эти интерфейсы через реализации интерфейса.

### 10.4.2 Абстрактный синтаксис

```text
                                                                                                                                                    {ordered, subsets redefinableElement,
                                                                                                                                                    subsets ownedMember}
                                                                                                                                                     + nestedClassifier
                                                                                                                                  Classifier
                                                                                                                                                    *
                                                                                                                                                          {subsets namespace, subsets
                                                       {ordered, subsets attribute, subsets        {subsets namespace,                                    redefinitionContext}
                                                       ownedMember}                                subsets classifier}                                    + interface
                                                                                                                                  Interface
                                                       + ownedAttribute                                     + interface                                    0..1
                                       Property
                                                       *                                                            0..1
                                                                                                                                                                     {subsets ownedMember}
                                                       {ordered, subsets feature, subsets     {subsets featuringClassifier,                                                     + protocol
                                                                                                                                                          0..1
                                                       redefinableElement, subsets            subsets namespace, subsets                                                                       ProtocolStateMachine
                                                                                                                                                          + interface                   0..1
                                                       ownedMember}                           redefinitionContext}
                                                                                                                                                         {subsets namespace}
                                                        + ownedOperation                                     + interface
                                      Operation
                                                        *                                                           0..1                                {subsets redefinedClassifier}
                                                                                                                                                      + redefinedInterface
                                                         {subsets feature, subsets             {subsets featuringClassifier,
                                                         ownedMember}                          subsets namespace}                                      *
                                                         + ownedReception                                   + interface                                {subsets classifier}
                                      Reception                                                                                                       + interface
                                                         *                                                          0..1                              *
                                                                                                                                          {subsets supplier}
                                                                                                                                    1    + contract
                                                                                                                                          {subsets ownedElement,
                                                                                                                                          subsets clientDependency}
                                                                                                                                     *   + interfaceRealization
                                                         {subsets client, subsets owner}        {subsets supplierDependency}
                                BehavioredClassifier          + implementingClassifier             + interfaceRealization    InterfaceRealization
                                                              1                                                         *
  {redefines behavioredClassifier}                 {subsets namespace}
            + behavioredClassifier   0..1     0..1 + behavioredClassifier
       {subsets ownedBehavior}                        {subsets ownedMember}                                                      Realization
             + classifierBehavior    0..1             + ownedBehavior
                                                  *
                                       Behavior
Figure 10.7 Interfaces
```

### 10.4.3 Семантика

#### 10.4.3.1 Интерфейсы

Интерфейс (Interface) — это вид классификатора, представляющий объявление набора открытых характеристик и обязательств, которые вместе составляют согласованную службу. Интерфейс задаёт контракт; любой экземпляр классификатора, который реализует этот интерфейс, должен выполнять этот контракт. Обязательства, связанные с интерфейсом, имеют форму ограничений (таких как предусловия и постусловия) или спецификаций протокола, которые могут накладывать ограничения на порядок взаимодействий через интерфейс.

Интерфейсы не могут быть созданы. Вместо этого спецификация интерфейса реализуется классификатором с поведением, что означает, что классификатор с поведением предоставляет открытый фасад, соответствующий спецификации интерфейса.

ПРИМЕЧАНИЕ. Данный классификатор с поведением может реализовать более одного интерфейса, и один интерфейс может быть реализован несколькими различными классификаторами с поведением.

Интерфейсы дают способ разделять и характеризовать группы открытых характеристик и обязательств, которыми должны обладать реализующие классификаторы с поведением. Интерфейс не определяет, как его следует реализовать, а лишь то, что должно поддерживаться реализующими классификаторами с поведением. То есть такие классификаторы с поведением должны предоставлять открытый фасад, состоящий из атрибутов, операций и внешне наблюдаемого поведения, который соответствует интерфейсу.

ПРИМЕЧАНИЕ. Если интерфейс объявляет атрибут, это не обязательно означает, что реализующий классификатор с поведением будет иметь такой атрибут в своей реализации, а лишь то, что он будет выглядеть так для внешних наблюдателей.

Набор интерфейсов, реализуемых классификатором с поведением, — это его предоставляемые интерфейсы, которые представляют службы и обязательства, предлагаемые экземплярами этого классификатора с поведением своим клиентам. Интерфейсы могут также использоваться для указания требуемых интерфейсов, которые задаются зависимостью использования между классификатором с поведением и соответствующими интерфейсами. Требуемые интерфейсы задают службы, которые нужны классификатору с поведением, чтобы выполнять свою функцию и исполнять собственные обязательства перед клиентами.

Свойства, принадлежащие интерфейсам (включая концы ассоциаций), подразумевают, что реализующий классификатор с поведением должен поддерживать информацию, соответствующую типу и кратности этого свойства, и обеспечивать получение и изменение этой информации. Свойство, объявленное в интерфейсе, не обязательно подразумевает, что такое свойство будет у реализующего классификатора с поведением (например, оно может быть реализовано эквивалентными операциями получения и установки). Интерфейсы могут также владеть ограничениями, которые накладывают ограничения на характеристики реализующего классификатора с поведением.

Интерфейсы могут владеть протокольной машиной состояний, которая задаёт последовательности событий и предусловия/постусловия для операций и приёмов, описанных в интерфейсе. Классификатор с поведением, реализующий интерфейс, должен подчиняться протокольной машине состояний, принадлежащей этому интерфейсу.

Интерфейс может быть параметризован, связан и использован как параметр шаблона.

Отношение реализации интерфейса между классификатором с поведением и интерфейсом подразумевает, что классификатор с поведением соответствует контракту, заданному интерфейсом, поддерживая набор характеристик, принадлежащих интерфейсу и любому из его родительских интерфейсов. Для поведенческих характеристик реализующий классификатор с поведением будет иметь операцию или приём для каждой операции или приёма соответственно, определённых интерфейсом. Для свойств реализующий классификатор с поведением предоставляет функциональность, которая поддерживает состояние, представленное свойством. Хотя это может быть сделано прямым отображением на свойство реализующего классификатора с поведением, это может также поддерживаться машиной состояний классификатора с поведением или парой операций, поддерживающих получение информации о состоянии, и операцией, изменяющей информацию о состоянии.

### 10.4.4 Нотация

Интерфейс может быть обозначен нотацией по умолчанию для классификатора (см. 9.2.4) с ключевым словом «interface».

Как вариант, зависимость реализации интерфейса от классификатора с поведением к интерфейсу может быть показана представлением интерфейса в виде круга или шарика, часто также называемого «леденцом» (lollipop), с меткой — именем интерфейса, присоединённого сплошной линией к классификатору с поведением, который реализует этот интерфейс.

Зависимость использования от классификатора к интерфейсу показывается представлением интерфейса в виде полукруга или гнезда с меткой — именем интерфейса, присоединённого сплошной линией к классификатору, которому требуется этот интерфейс.

Интерфейсы, унаследованные от обобщения классификатора с поведением, могут быть показаны на диаграмме с помощью «леденца». Эти интерфейсы обозначаются на диаграмме символом «крышки» (^) перед именем интерфейса. Более ранние версии UML допускали косую черту перед именем для обозначения унаследованных интерфейсов; эта нотация допускается, но не рекомендуется. Если зависимость проведена от использования к реализации интерфейса, представленным гнездом и «леденцом», стрелка зависимости может быть показана соединяющей гнездо с «леденцом»

### 10.4.5 Примеры

Зависимость реализации интерфейса от ProximitySensor к ISensor показана нотацией шарика («леденца») (см. рисунок 10.8).

ProximitySensor

ISensor

**Рисунок 10.8** *ISensor — предоставляемый интерфейс элемента ProximitySensor*

**Рисунок 10.9** *показывает нотацию «леденца» для унаследованного предоставляемого интерфейса.*

ProximitySensor

^ ISensor CapacitiveSensor

**Рисунок 10.9** *ISensor, предоставляемый интерфейс элемента ProximitySensor, показан как унаследованный элементом CapacitiveSensor*

Зависимость использования от TheftAlarm к ISensor показана нотацией гнезда (см. рисунок 10.10).

TheftAlarm

...     Text

Text

**Рисунок 10.10** *ISensor — требуемый интерфейс элемента TheftAlarm*

Как вариант, в случаях, когда интерфейсы представлены нотацией прямоугольника, зависимости реализации интерфейса и использования обозначаются соответствующими стрелками зависимостей (см. рисунок 10.11). Классификатор у хвоста стрелки реализует интерфейс у головы стрелки или соответственно использует этот интерфейс.

«interface»

«use»     ISensor TheftAlarm                                                          ProximitySensor

activate ( )

read ( )

**Рисунок 10.11** *Альтернативная нотация требуемого и предоставляемого интерфейса*

На практике часто бывает, что два или более интерфейсов взаимно связаны зависимостями, специфичными для приложения. В таких ситуациях каждый интерфейс представляет определённую роль в «протоколе» с многими участниками. Такие связывания ролей протокола могут быть отражены ассоциациями между интерфейсами, как показано в примере на рисунке 10.12. Здесь показана спецификация трёх интерфейсов: IAlarm, ISensor и IBuzzer. IAlarm и ISensor показаны как участвующие в двунаправленном протоколе, что означает, что любая реализация ISensor должна поддерживать информацию, необходимую для реализации свойства theAlarm, и аналогично для IAlarm и theSensor. IBuzzer описывает интерфейс, к которому должны иметь доступ реализации IAlarm.

«interface»                                                                     «interface»

IBuzzer          1            *       «interface»   + theAlarm   + theSensor

IAlarm                                  ISensor volume : Integer                                                                  activate ( )

+ theBuzzer          notify ( )       1                 1 start ( )                                                                         read ( ) reset ( )

**Рисунок 10.12** *Набор взаимодействующих интерфейсов*

## 10.5 Описания классификаторов

### 10.5.1 BehavioredClassifier (классификатор с поведением) [Abstract Class]

#### 10.5.1.1 Описание

Классификатор с поведением может иметь реализации интерфейса и владеет набором поведений, одно из которых может задавать поведение самого классификатора с поведением.

#### 10.5.1.2 Диаграммы

Интерфейсы, варианты использования, классы, кооперации, поведения

#### 10.5.1.3 Обобщения

Classifier

#### 10.5.1.4 Специализации

Actor (актёр), UseCase (вариант использования), Class (класс), Collaboration (кооперация)

#### 10.5.1.5 Концы ассоциаций

- classifierBehavior : Behavior [0..1]{subsets BehavioredClassifier::ownedBehavior} (opposite A_classifierBehavior_behavioredClassifier::behavioredClassifier) поведение, которое задаёт поведение самого классификатора с поведением.

- ♦ interfaceRealization : InterfaceRealization [0..*]{subsets Element::ownedElement, subsets NamedElement::clientDependency} (opposite InterfaceRealization::implementingClassifier) набор реализаций интерфейса, принадлежащих классификатору с поведением. Реализации интерфейса ссылаются на интерфейсы, реализацией которых является классификатор с поведением.

- ♦ ownedBehavior : Behavior [0..*]{subsets Namespace::ownedMember} (opposite A_ownedBehavior_behavioredClassifier::behavioredClassifier) поведения, принадлежащие классификатору с поведением.

#### 10.5.1.6 Ограничения

- **class_behavior**

  Если поведение является поведением классификатора, оно не имеет спецификации.

  ```ocl
  inv: classifierBehavior->notEmpty() implies classifierBehavior.specification->isEmpty()
  ```

### 10.5.2 DataType (тип данных) [Class]

#### 10.5.2.1 Описание

Тип данных — это тип, экземпляры которого идентифицируются только своим значением.

#### 10.5.2.2 Диаграммы

Типы данных, свойства, операции

#### 10.5.2.3 Обобщения

Classifier

#### 10.5.2.4 Специализации

Enumeration (перечисление), PrimitiveType (примитивный тип)

#### 10.5.2.5 Концы ассоциаций

- ♦ ownedAttribute : Property [0..*]{ordered, subsets Classifier::attribute, subsets Namespace::ownedMember} (opposite Property::datatype) атрибуты, принадлежащие типу данных.

- ♦ ownedOperation : Operation [0..*]{ordered, subsets Classifier::feature, subsets A_redefinitionContext_redefinableElement::redefinableElement, subsets Namespace::ownedMember} (opposite Operation::datatype) операции, принадлежащие типу данных.

### 10.5.3 Enumeration (перечисление) [Class]

#### 10.5.3.1 Описание

Перечисление — это тип данных, значения которого перечислены в модели как литералы перечисления.

#### 10.5.3.2 Диаграммы

Типы данных

#### 10.5.3.3 Обобщения

DataType (тип данных)

#### 10.5.3.4 Концы ассоциаций

- ♦ ownedLiteral : EnumerationLiteral [0..*]{ordered, subsets Namespace::ownedMember} (opposite EnumerationLiteral::enumeration) упорядоченный набор литералов, принадлежащих этому перечислению.

#### 10.5.3.5 Ограничения

- **immutable**

  ```ocl
  inv: ownedAttribute->forAll(isReadOnly)
  ```

### 10.5.4 EnumerationLiteral (литерал перечисления) [Class]

#### 10.5.4.1 Описание

Литерал перечисления — это определённое пользователем значение данных для перечисления.

#### 10.5.4.2 Диаграммы

Типы данных

#### 10.5.4.3 Обобщения

InstanceSpecification (спецификация экземпляра)

#### 10.5.4.4 Концы ассоциаций

- /classifier : Enumeration [1..1]{redefines InstanceSpecification::classifier} (opposite A_classifier_enumerationLiteral::enumerationLiteral) классификатор этого литерала перечисления, производный так, чтобы быть равным его перечислению.

- enumeration : Enumeration [1..1]{subsets NamedElement::namespace} (opposite Enumeration::ownedLiteral) перечисление, членом которого является этот литерал перечисления.

#### 10.5.4.5 Операции

- classifier() : Enumeration — вывод свойства Enumeration::/classifier

  ```ocl
  body: enumeration
  ```

### 10.5.5 Interface (интерфейс) [Class]

#### 10.5.5.1 Описание

Интерфейсы объявляют согласованные службы, которые реализуются классификаторами с поведением; последние реализуют эти интерфейсы через реализации интерфейса.

#### 10.5.5.2 Диаграммы

Интерфейсы, инкапсулированные классификаторы, компоненты, свойства, операции

#### 10.5.5.3 Обобщения

Classifier

#### 10.5.5.4 Концы ассоциаций

- ♦ nestedClassifier : Classifier [0..*]{ordered, subsets A_redefinitionContext_redefinableElement::redefinableElement, subsets Namespace::ownedMember} (opposite A_nestedClassifier_interface::interface) ссылается на все классификаторы, определённые (вложенные) внутри интерфейса.

- ♦ ownedAttribute : Property [0..*]{ordered, subsets Classifier::attribute, subsets Namespace::ownedMember} (opposite Property::interface) атрибуты (то есть свойства), принадлежащие интерфейсу.

- ♦ ownedOperation : Operation [0..*]{ordered, subsets Classifier::feature, subsets A_redefinitionContext_redefinableElement::redefinableElement, subsets Namespace::ownedMember} (opposite Operation::interface) операции, принадлежащие интерфейсу.

- ♦ ownedReception : Reception [0..*]{subsets Classifier::feature, subsets Namespace::ownedMember} (opposite A_ownedReception_interface::interface) приёмы, которые готовы принимать объекты, предоставляющие этот интерфейс.

- ♦ protocol : ProtocolStateMachine [0..1]{subsets Namespace::ownedMember} (opposite A_protocol_interface::interface) ссылается на протокольную машину состояний, задающую допустимые последовательности вызовов поведенческих характеристик, описанных в интерфейсе.

- redefinedInterface : Interface [0..*]{subsets Classifier::redefinedClassifier} (opposite A_redefinedInterface_interface::interface) ссылается на все интерфейсы, переопределённые этим интерфейсом.

#### 10.5.5.5 Ограничения

- **visibility**

  Видимость всех характеристик, принадлежащих интерфейсу, должна быть public.

  ```ocl
  inv: feature->forAll(visibility = VisibilityKind::public)
  ```

### 10.5.6 InterfaceRealization (реализация интерфейса) [Class]

#### 10.5.6.1 Описание

Реализация интерфейса — это специализированное отношение реализации между классификатором с поведением и интерфейсом. Это отношение означает, что реализующий классификатор с поведением соответствует контракту, заданному интерфейсом.

#### 10.5.6.2 Диаграммы

Интерфейсы

#### 10.5.6.3 Обобщения

Realization (реализация)

#### 10.5.6.4 Концы ассоциаций

- contract : Interface [1..1]{subsets Dependency::supplier} (opposite A_contract_interfaceRealization::interfaceRealization) ссылается на интерфейс, задающий контракт соответствия.

- implementingClassifier : BehavioredClassifier [1..1]{subsets Dependency::client, subsets Element::owner} (opposite BehavioredClassifier::interfaceRealization) ссылается на классификатор с поведением, которому принадлежит эта реализация интерфейса, то есть на классификатор с поведением, который реализует интерфейс, на который она ссылается.

### 10.5.7 PrimitiveType (примитивный тип) [Class]

#### 10.5.7.1 Описание

Примитивный тип определяет предопределённый тип данных, не имеющий внутренней структуры. Примитивный тип может иметь алгебру и операции, определённые вне UML, например математически.

#### 10.5.7.2 Диаграммы

Типы данных

#### 10.5.7.3 Обобщения

DataType (тип данных)

### 10.5.8 Reception (приём) [Class]

#### 10.5.8.1 Описание

Приём — это объявление того, что классификатор готов реагировать на получение сигнала.

#### 10.5.8.2 Диаграммы

Сигналы, интерфейсы, классы

#### 10.5.8.3 Обобщения

BehavioralFeature (поведенческая характеристика)

#### 10.5.8.4 Концы ассоциаций

- signal : Signal [1..1] (opposite A_signal_reception::reception) сигнал, который обрабатывает этот приём.

#### 10.5.8.5 Ограничения

- **same_name_as_signal**

  Приём имеет то же имя, что и его сигнал (signal)

  ```ocl
  inv: name = signal.name
  ```

- **same_structure_as_signal**

  Параметры приёма совпадают с ownedAttributes его сигнала по имени, типу и кратности

  ```ocl
  inv: signal.ownedAttribute->size() = ownedParameter->size() and
  Sequence{1..signal.ownedAttribute->size()}->forAll( i |
  ownedParameter->at(i).direction = ParameterDirectionKind::_'in' and
  ownedParameter->at(i).name = signal.ownedAttribute->at(i).name and
  ownedParameter->at(i).type = signal.ownedAttribute->at(i).type and
  ownedParameter->at(i).lowerBound() = signal.ownedAttribute->at(i).lowerBound() and
  ownedParameter->at(i).upperBound() = signal.ownedAttribute->at(i).upperBound()
  )
  ```

### 10.5.9 Signal (сигнал) [Class]

#### 10.5.9.1 Описание

Сигнал — это спецификация вида взаимодействия между объектами, при котором в получателе асинхронно запускается реакция без ответа.

#### 10.5.9.2 Диаграммы

Сигналы, события, действия вызова

#### 10.5.9.3 Обобщения

Classifier

#### 10.5.9.4 Концы ассоциаций

- ♦ ownedAttribute : Property [0..*]{ordered, subsets Classifier::attribute, subsets Namespace::ownedMember} (opposite A_ownedAttribute_owningSignal::owningSignal) атрибуты, принадлежащие сигналу.

## 10.6 Описания ассоциаций

### 10.6.1 A_classifierBehavior_behavioredClassifier [Association]

#### 10.6.1.1 Диаграммы

Интерфейсы, поведения

#### 10.6.1.2 Обобщения

A_ownedBehavior_behavioredClassifier

#### 10.6.1.3 Принадлежащие концы

- behavioredClassifier : BehavioredClassifier [0..1]{redefines A_ownedBehavior_behavioredClassifier::behavioredClassifier} (opposite BehavioredClassifier::classifierBehavior)

### 10.6.2 A_classifier_enumerationLiteral [Association]

#### 10.6.2.1 Диаграммы

Типы данных

#### 10.6.2.2 Обобщения

A_classifier_instanceSpecification

#### 10.6.2.3 Принадлежащие концы

- enumerationLiteral : EnumerationLiteral [0..*]{redefines A_classifier_instanceSpecification::instanceSpecification} (opposite EnumerationLiteral::classifier)

### 10.6.3 A_contract_interfaceRealization [Association]

#### 10.6.3.1 Диаграммы

Интерфейсы

#### 10.6.3.2 Принадлежащие концы

- interfaceRealization : InterfaceRealization [0..*]{subsets A_supplier_supplierDependency::supplierDependency} (opposite InterfaceRealization::contract)

### 10.6.4 A_interfaceRealization_implementingClassifier [Association]

#### 10.6.4.1 Диаграммы

Интерфейсы

#### 10.6.4.2 Концы-члены

- BehavioredClassifier::interfaceRealization

- InterfaceRealization::implementingClassifier

### 10.6.5 A_nestedClassifier_interface [Association]

#### 10.6.5.1 Диаграммы

Интерфейсы

#### 10.6.5.2 Принадлежащие концы

- interface : Interface [0..1]{subsets NamedElement::namespace, subsets RedefinableElement::redefinitionContext} (opposite Interface::nestedClassifier)

### 10.6.6 A_ownedAttribute_datatype [Association]

#### 10.6.6.1 Диаграммы

Типы данных, свойства

#### 10.6.6.2 Концы-члены

- DataType::ownedAttribute

- Property::datatype

### 10.6.7 A_ownedAttribute_interface [Association]

#### 10.6.7.1 Диаграммы

Интерфейсы, свойства

#### 10.6.7.2 Концы-члены

- Interface::ownedAttribute

- Property::interface

### 10.6.8 A_ownedAttribute_owningSignal [Association]

#### 10.6.8.1 Диаграммы

Сигналы

#### 10.6.8.2 Принадлежащие концы

- owningSignal : Signal [0..1]{subsets NamedElement::namespace, subsets A_attribute_classifier::classifier} (opposite Signal::ownedAttribute)

### 10.6.9 A_ownedBehavior_behavioredClassifier [Association]

#### 10.6.9.1 Диаграммы

Интерфейсы, поведения

#### 10.6.9.2 Специализации

A_classifierBehavior_behavioredClassifier

#### 10.6.9.3 Принадлежащие концы

- behavioredClassifier : BehavioredClassifier [0..1]{subsets NamedElement::namespace} (opposite BehavioredClassifier::ownedBehavior)

### 10.6.10 A_ownedLiteral_enumeration [Association]

#### 10.6.10.1 Диаграммы

Типы данных

#### 10.6.10.2 Концы-члены

- Enumeration::ownedLiteral

- EnumerationLiteral::enumeration

### 10.6.11 A_ownedOperation_datatype [Association]

#### 10.6.11.1 Диаграммы

Типы данных, операции

#### 10.6.11.2 Концы-члены

- DataType::ownedOperation

- Operation::datatype

### 10.6.12 A_ownedOperation_interface [Association]

#### 10.6.12.1 Диаграммы

Интерфейсы, операции

#### 10.6.12.2 Концы-члены

- Interface::ownedOperation

- Operation::interface

### 10.6.13 A_ownedReception_interface [Association]

#### 10.6.13.1 Диаграммы

Интерфейсы

#### 10.6.13.2 Принадлежащие концы

- interface : Interface [0..1]{subsets Feature::featuringClassifier, subsets NamedElement::namespace} (opposite Interface::ownedReception)

### 10.6.14 A_protocol_interface [Association]

#### 10.6.14.1 Диаграммы

Интерфейсы

#### 10.6.14.2 Принадлежащие концы

- interface : Interface [0..1]{subsets NamedElement::namespace} (opposite Interface::protocol) задаёт пространство имён, в котором определена протокольная машина состояний.

### 10.6.15 A_redefinedInterface_interface [Association]

#### 10.6.15.1 Диаграммы

Интерфейсы

#### 10.6.15.2 Принадлежащие концы

- interface : Interface [0..*]{subsets A_redefinedClassifier_classifier::classifier} (opposite Interface::redefinedInterface)

### 10.6.16 A_signal_reception [Association]

#### 10.6.16.1 Диаграммы

Сигналы

#### 10.6.16.2 Принадлежащие концы

- reception : Reception [0..*] (opposite Reception::signal)