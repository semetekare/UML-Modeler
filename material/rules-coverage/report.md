# Проверяемость констрейнтов UML 2.5.1 — сводка по данным

Собрано `material/rules-coverage/build.mjs`. Править вручную бессмысленно:
следующий прогон перезапишет файл, а `--check` покажет расхождение.

| Показатель | Значение |
| --- | ---: |
| Констрейнтов в спецификации | 449 |
| **В области** (метакласс выражен фигурой или связью) | **166** |
| Вне области (метакласса нет ни одной фигурой) | 283 |
| **Исполняется** | **52 из 166 в области** |
| **Записано правил** | **58** |
| Метаклассов с видом | 40 |
| Метаклассов без вида | 116 |
| Устаревших причин | 86 |
| Причин, верных наполовину | 13 |
| Причин, которые нечего проверять | 25 |

Разница 58 − 52 = 6: правила записаны, но не исполняются — 3 тавтологии схемы, 0 без функции, хотя всё для проверки есть, 2 упираются в отсутствующее поле или конструкцию модели, 1 невозможно по конструкции схемы.

| Статус | Констрейнтов | Что значит |
| --- | ---: | --- |
| `executable` | 52 | правило записано, функция есть |
| `todo` | 0 | всё нужное в модели есть, правило ещё не написано |
| `tautology` | 3 | в этой схеме нарушить нечем |
| `gap` | 87 | нет поля или конструкции модели |
| `no-ocl` | 24 | в стандарте у констрейнта нет OCL |
| `out-of-scope` | 283 | метакласса нет ни одной фигурой или связью |
| **сумма** | **449** | равна числу констрейнтов |

## Невозможные по конструкции

Таких констрейнтов **2**: нарушить их нечем, потому что ситуацию
нельзя записать в файл модели — загрузчик её выбрасывает. Это не долг и не
очередь; причина названа, поля не хватает не здесь.

| Метакласс | Пункт | Констрейнт | Почему нельзя нарушить |
| --- | --- | --- | --- |
| Association | 11.8.1.8 | `specialized_end_number` | у связи ровно два конца (from/to), n-арности схема не знает: memberEnd->size() = 2 у любой ассоциации, равенство концов выполняется всегда |
| Association | 11.8.1.8 | `specialized_end_types` | концы обобщения не могут указывать на связь: from/to называют элемент, и обобщение с id связи загрузчик выбрасывает («Связь N пропущена: её элемент не найден») |

## Очередь: что можно проверить сейчас

Ни одного: у всех констрейнтов не хватает вида или поля.

## Устаревшие причины

Причина — та, что стоит в старом документе; справа — что с тех пор появилось.

| Метакласс | Констрейнт | Старая причина | Появилось | Вердикт |
| --- | --- | --- | --- | --- |
| ActionExecutionSpecification | `action_referenced` | Наша модель не хранит спецификации выполнения | вид `activation` | stale |
| Activity | `maximum_one_parameter_node` | Наша модель не хранит активности как элементы | вид `activity` | stale |
| Activity | `maximum_two_parameter_nodes` | Наша модель не хранит активности как элементы | вид `activity` | stale |
| ActivityEdge | `source_and_target` | Наша модель не хранит рёбра активностей | вид `controlFlow`, вид `objectFlow` | stale |
| ActivityGroup | `nodes_and_edges` | Наша модель не хранит группы активностей | вид `swimlane`, поле `regions` | stale |
| ActivityGroup | `not_contained` | Наша модель не хранит группы активностей | вид `swimlane`, поле `regions` | stale |
| ActivityParameterNode | `has_parameters` | Наша модель не хранит узлы параметров активности | вид `activityParameter` | stale |
| ActivityParameterNode | `no_incoming_edges` | Наша модель не хранит узлы параметров активности | вид `activityParameter` | stale |
| ActivityParameterNode | `no_outgoing_edges` | Наша модель не хранит узлы параметров активности | вид `activityParameter` | stale |
| ActivityParameterNode | `same_type` | Наша модель не хранит узлы параметров активности | вид `activityParameter` | stale |
| ActivityPartition | `dimension_not_contained` | Наша модель не хранит разделы (partitions) | вид `swimlane` | stale |
| ActivityPartition | `represents_classifier` | Наша модель не хранит разделы (partitions) | вид `swimlane` | stale |
| ActivityPartition | `represents_property` | Наша модель не хранит разделы (partitions) | вид `swimlane` | stale |
| ActivityPartition | `represents_property_and_is_contained` | Наша модель не хранит разделы (partitions) | вид `swimlane` | stale |
| Association | `association_ends` | Требует различения владельца конца ассоциации (класс или ассоциация) | поле `ownerId` | stale |
| Behavior | `feature_of_context_classifier` | Наша модель не хранит поведения как элементы | вид `activity`, вид `interaction` | stale |
| Behavior | `most_one_behavior` | Наша модель не хранит поведения как элементы | вид `activity`, вид `interaction` | stale |
| Behavior | `parameters_match` | Наша модель не хранит поведения как элементы | вид `activity`, вид `interaction` | stale |
| CollaborationUse | `client_elements` | Наша модель не хранит коллаборации и их использования | вид `collaboration`, вид `collaborationUse` | stale |
| CollaborationUse | `connectors` | Наша модель не хранит коллаборации и их использования | вид `collaboration`, вид `collaborationUse` | stale |
| CollaborationUse | `every_role` | Наша модель не хранит коллаборации и их использования | вид `collaboration`, вид `collaborationUse` | stale |
| CombinedFragment | `consider_and_ignore` | Операнды фрагментов не являются элементом нашей модели | поле `operands` | stale |
| CommunicationPath | `association_ends` | Пути связи не являются элементом нашей модели | вид `communicationPath` | stale |
| ConnectionPointReference | `entry_pseudostates` | Наша модель не хранит точки подключения состояний | вид `entryPoint`, вид `exitPoint` | stale |
| ConnectionPointReference | `exit_pseudostates` | Наша модель не хранит точки подключения состояний | вид `entryPoint`, вид `exitPoint` | stale |
| Connector | `roles` | Коннекторы не являются элементом нашей модели | вид `connector` | partial |
| Connector | `types` | Коннекторы не являются элементом нашей модели | вид `connector` | partial |
| ConnectorEnd | `multiplicity` | Наша модель не хранит коннекторы внутренней структуры | вид `connector` | partial |
| ConnectorEnd | `part_with_port_empty` | Наша модель не хранит коннекторы внутренней структуры | вид `connector` | partial |
| ConnectorEnd | `role_and_part_with_port` | Наша модель не хранит коннекторы внутренней структуры | вид `connector` | partial |
| ConnectorEnd | `self_part_with_port` | Наша модель не хранит коннекторы внутренней структуры | вид `connector` | partial |
| ControlFlow | `object_nodes` | Узлы объектов не являются элементом нашей модели | вид `objectNode` | stale |
| DecisionNode | `decision_input_flow_incoming` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| DecisionNode | `edges` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| DecisionNode | `incoming_control_one_input_parameter` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| DecisionNode | `incoming_object_one_input_parameter` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| DecisionNode | `parameters` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| DecisionNode | `two_input_parameters` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| DecisionNode | `zero_input_parameters` | Наша модель не хранит узлы решений | вид `decision`, вид `merge` | stale |
| ElementImport | `imported_element_is_public` | Наша модель не хранит импорт элементов как элементы | вид `import` | partial |
| ElementImport | `visibility_public_or_private` | Наша модель не хранит импорт элементов как элементы | вид `import` | partial |
| Enumeration | `immutable` | У перечисления в нашей модели нет ownedAttribute | поле `attributes` | stale |
| ExecutionSpecification | `same_lifeline` | Наша модель не хранит спецификации выполнения | вид `activation` | stale |
| Extend | `extension_points` | Extend не является элементом нашей модели | вид `extend` | stale |
| FinalState | `cannot_reference_submachine` | Наша модель не хранит псевдосостояния (final) | вид `final` | stale |
| FunctionBehavior | `one_output_parameter` | Наша модель не хранит поведения как элементы | вид `activity`, вид `interaction` | stale |
| FunctionBehavior | `types_of_parameters` | Наша модель не хранит поведения как элементы | вид `activity`, вид `interaction` | stale |
| InitialNode | `control_edges` | Наша модель не хранит узлы активностей | вид `initial`, вид `final`, вид `fork`, вид `join`, вид `merge` | stale |
| InitialNode | `no_incoming_edges` | Наша модель не хранит узлы активностей | вид `initial`, вид `final`, вид `fork`, вид `join`, вид `merge` | stale |
| InstanceSpecification | `deployment_target` | Требует развёртывания | вид `deployment` | partial |
| InteractionOperand | `guard_contain_references` | Наша модель не хранит операнды фрагментов | поле `operands` | stale |
| InteractionOperand | `guard_directly_prior` | Наша модель не хранит операнды фрагментов | поле `operands` | stale |
| InteractionUse | `all_lifelines` | Наша модель не хранит ссылки на взаимодействия | вид `interactionUse` | stale |
| InteractionUse | `arguments_are_constants` | Наша модель не хранит ссылки на взаимодействия | вид `interactionUse` | stale |
| InteractionUse | `arguments_correspond_to_parameters` | Наша модель не хранит ссылки на взаимодействия | вид `interactionUse` | stale |
| InteractionUse | `gates_match` | Наша модель не хранит ссылки на взаимодействия | вид `interactionUse` | stale |
| InteractionUse | `returnValueRecipient_coverage` | Наша модель не хранит ссылки на взаимодействия | вид `interactionUse` | stale |
| InteractionUse | `returnValue_type_recipient_correspondence` | Наша модель не хранит ссылки на взаимодействия | вид `interactionUse` | stale |
| Lifeline | `interaction_uses_share_lifeline` | Ссылки на взаимодействия не являются элементом нашей модели | вид `interactionUse` | stale |
| Lifeline | `same_classifier` | Требует внутренней структуры классификатора | вид `part`, поле `ownerId` | stale |
| Namespace | `cannot_import_ownedMembers` | Импорт элементов не является элементом нашей модели | вид `import` | partial |
| Namespace | `cannot_import_self` | Импорт пакетов не является элементом нашей модели | вид `import` | partial |
| Node | `internal_structure` | Требует внутренней структуры узла (parts), которой у нас нет | вид `part`, поле `ownerId` | stale |
| ObjectFlow | `compatible_types` | Узлы объектов не являются элементом нашей модели | вид `objectNode` | stale |
| ObjectFlow | `same_upper_bounds` | Узлы объектов не являются элементом нашей модели | вид `objectNode` | stale |
| ObjectFlow | `target` | Узлы объектов не являются элементом нашей модели | вид `objectNode` | stale |
| ObjectNode | `input_output_parameter` | Наша модель не хранит узлы объектов | вид `objectNode` | stale |
| ObjectNode | `object_flow_edges` | Наша модель не хранит узлы объектов | вид `objectNode` | stale |
| ObjectNode | `selection_behavior` | Наша модель не хранит узлы объектов | вид `objectNode` | stale |
| PackageImport | `public_or_private` | Наша модель не хранит импорт пакетов как элементы | вид `import` | partial |
| Port | `default_value` | Наша модель не хранит порты | вид `port` | stale |
| Port | `port_aggregation` | Наша модель не хранит порты | вид `port` | stale |
| Profile | `metaclass_reference_not_specialized` | Наша модель не хранит профили как контейнеры | вид `profile` | stale |
| Profile | `references_same_metamodel` | Наша модель не хранит профили как контейнеры | вид `profile` | stale |
| Property | `deployment_target` | Требует развёртывания | вид `deployment` | partial |
| Property | `qualified_is_association_end` | Квалификаторы не являются элементом нашей модели | поле `fromQualifiers`, поле `toQualifiers` | stale |
| Property | `type_of_opposite_end` | Требует различения владельца конца ассоциации (класс или ассоциация) | поле `ownerId` | stale |
| Pseudostate | `outgoing_from_initial` | Наша модель не хранит псевдосостояния (initial, fork, join, choice…) | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, вид `historyShallow`, вид `historyDeep`, вид `entryPoint`, вид `exitPoint`, вид `terminate` | stale |
| Pseudostate | `transitions_incoming` | Наша модель не хранит псевдосостояния (initial, fork, join, choice…) | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, вид `historyShallow`, вид `historyDeep`, вид `entryPoint`, вид `exitPoint`, вид `terminate` | stale |
| Pseudostate | `transitions_outgoing` | Наша модель не хранит псевдосостояния (initial, fork, join, choice…) | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, вид `historyShallow`, вид `historyDeep`, вид `entryPoint`, вид `exitPoint`, вид `terminate` | stale |
| QualifierValue | `multiplicity_of_qualifier` | Наша модель не хранит квалификаторы | поле `fromQualifiers`, поле `toQualifiers` | stale |
| QualifierValue | `qualifier_attribute` | Наша модель не хранит квалификаторы | поле `fromQualifiers`, поле `toQualifiers` | stale |
| QualifierValue | `type_of_qualifier` | Наша модель не хранит квалификаторы | поле `fromQualifiers`, поле `toQualifiers` | stale |
| Region | `deep_history_vertex` | Наша модель не хранит регионы | поле `regions` | stale |
| Region | `initial_vertex` | Наша модель не хранит регионы | поле `regions` | stale |
| Region | `owned` | Наша модель не хранит регионы | поле `regions` | stale |
| Region | `shallow_history_vertex` | Наша модель не хранит регионы | поле `regions` | stale |
| State | `composite_states` | Требует псевдосостояний и регионов | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, поле `regions` | stale |
| State | `destinations_or_sources_of_transitions` | Требует псевдосостояний | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, вид `historyShallow`, вид `historyDeep`, вид `entryPoint`, вид `exitPoint`, вид `terminate` | stale |
| State | `entry_or_exit` | Псевдосостояния не являются элементом нашей модели | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, вид `historyShallow`, вид `historyDeep`, вид `entryPoint`, вид `exitPoint`, вид `terminate` | stale |
| State | `submachine_or_regions` | Регионы не являются элементом нашей модели | поле `regions` | stale |
| Stereotype | `associationEndOwnership` | Требует различения владельца конца ассоциации | поле `ownerId` | stale |
| Stereotype | `name_not_clash` | Таблицы ключевых слов UML у нас нет | таблица `UML_KEYWORDS` | stale |
| Transition | `fork_segment_guards` | Требует псевдосостояний fork | вид `fork` | stale |
| Transition | `initial_transition` | Требует псевдосостояний initial | вид `initial` | stale |
| Transition | `join_segment_guards` | Требует псевдосостояний join | вид `join` | stale |
| Transition | `outgoing_pseudostates` | Требует псевдосостояний | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join`, вид `historyShallow`, вид `historyDeep`, вид `entryPoint`, вид `exitPoint`, вид `terminate` | stale |
| Transition | `state_is_external` | Требует вида перехода (kind) и псевдосостояний | вид `initial`, вид `final`, вид `choice`, вид `junction`, вид `fork`, вид `join` | stale |
| Transition | `state_is_local` | Требует вида перехода (kind = local) и точек входа | вид `entryPoint`, вид `exitPoint` | stale |

Всего устаревших причин: **86**; ещё 13 верны наполовину —
вид появился, а конструкции, нужной самому правилу, всё ещё нет.

## Чего не хватает — по частоте

| Свойство OCL | Почему нельзя | Констрейнтов |
| --- | --- | ---: |
| `type` | у элемента нет поля типа; тип хранится только у строки члена (attributes.type) | 20 |
| `direction` | у параметра нет направления (in/out/inout) | 7 |
| `inputParameters` | у поведения нет параметров | 7 |
| `decisionInputFlow` | соответствия полю нет | 6 |
| `memberEnd` | у связи ровно два конца from/to; набора концов (n-арности) нет | 6 |
| `ownedParameter` | у операции и деятельности нет параметров | 6 |
| `parameter` | узел параметра не хранит ссылку на параметр | 6 |
| `decisionInput` | соответствия полю нет | 5 |
| `trigger` | триггер хранится только у внутреннего перехода состояния (internals.trigger), у перехода-связи его нет | 5 |
| `allParents` | предки — цепочка обобщений | 4 |
| `messageSort` | соответствия полю нет | 4 |
| `selection` | у узла объектов нет поведения-выбора | 4 |
| `selector` | соответствия полю нет | 4 |
| `argument` | у сообщения нет аргументов | 3 |
| `end` | конец коннектора не хранится объектом; from/to — элементы, а не концы | 3 |
| `guard` | сторож хранится только у внутреннего перехода состояния (internals.guard), у перехода-связи его нет | 3 |
| `isSubmachineState` | у состояния нет флага состояния-подавтомата | 3 |
| `kind` | у перехода нет вида (external/internal/local); у псевдосостояния вид — это вид элемента | 3 |
| `operand` |  | 3 |
| `outputParameters` | у поведения нет параметров | 3 |
| `part` | части узла не хранят тип, поэтому «часть типа узел» не проверить | 3 |
| `roleBinding` | соответствия полю нет | 3 |
| `stateMachine` | соответствия полю нет | 3 |
| `structuredClassifier` | соответствия полю нет | 3 |
| `subsettedProperty` | отношение subsets не хранится | 3 |
| `supplier` | соответствия полю нет | 3 |
| `visibility` | у элемента нет видимости; видимость есть только у строки члена (vis) | 3 |
| `aggregation` | у порта нет поля агрегации; fromAggregation/toAggregation — у концов связей, а порт не конец связи | 2 |
| `client` | соответствия полю нет | 2 |
| `combinedFragment` | соответствия полю нет | 2 |
| `connection` | у состояния нет ссылок на точки подключения | 2 |
| `connectionPoint` | у состояния нет точек подключения | 2 |
| `importedElement` | соответствия полю нет | 2 |
| `interaction` | соответствия полю нет | 2 |
| `isContainedInRegion` | соответствия полю нет | 2 |
| `isControlType` | у узла объектов нет флага управляющего типа | 2 |
| `isDerivedUnion` | флага union нет | 2 |
| `isExternal` | у дорожки нет флага «внешняя» | 2 |
| `isReadOnly` | флага readOnly нет | 2 |
| `metaclassReference` | соответствия полю нет | 2 |
| `namespace` | соответствия полю нет | 2 |
| `of` | соответствия полю нет | 2 |
| `r2` | соответствия полю нет | 2 |
| `region` | соответствия полю нет | 2 |
| `returnValueRecipient` | соответствия полю нет | 2 |
| `submachine` | у состояния нет ссылки на подмашину | 2 |
| `symbol` | соответствия полю нет | 2 |
| `t2` | соответствия полю нет | 2 |
| `these` | соответствия полю нет | 2 |
| `transitions` | соответствия полю нет | 2 |
| `upperBound` | соответствия полю нет | 2 |
| `value` | соответствия полю нет | 2 |
| `actualGate` | соответствия полю нет | 1 |
| `allFeatures` | полного набора характеристик с учётом предков нет | 1 |
| `allOwningPackages` | соответствия полю нет | 1 |
| `allRoles` | набора ролей классификатора нет | 1 |
| `attribute` | соответствия полю нет | 1 |
| `boundRoles` | соответствия полю нет | 1 |
| `ce2` | соответствия полю нет | 1 |
| `class` | соответствия полю нет | 1 |
| `classifierBehavior` | соответствия полю нет | 1 |
| `collaboration` | соответствия полю нет | 1 |
| `collaborationRole` | соответствия полю нет | 1 |
| `container` | контейнер — ownerId | 1 |
| `containingStateMachine` | соответствия полю нет | 1 |
| `contextClassifier` | соответствия полю нет | 1 |
| `covered` | покрытые линии жизни — сообщения операнда и их концы | 1 |
| `defaultValue` | у элемента нет значения по умолчанию (оно есть только у строки члена) | 1 |
| `elementImport` | соответствия полю нет | 1 |
| `entry` | соответствия полю нет | 1 |
| `events` | у линии жизни нет упорядоченного списка событий | 1 |
| `exit` | соответствия полю нет | 1 |
| `extendedCase` | соответствия полю нет | 1 |
| `extensionPoint` |  | 1 |
| `finish` | соответствия полю нет | 1 |
| `formal` | формальный параметр шаблона не хранится | 1 |
| `formalGate` | соответствия полю нет | 1 |
| `fragment` | соответствия полю нет | 1 |
| `importedPackage` | соответствия полю нет | 1 |
| `inheritedMember` | наследованных членов не выводим | 1 |
| `integerValue` | соответствия полю нет | 1 |
| `interactionUse` | соответствия полю нет | 1 |
| `isActive` | у класса нет флага активности | 1 |
| `isAttribute` | соответствия полю нет | 1 |
| `isComposite` | составное состояние — непустые regions | 1 |
| `isDimension` | у дорожки нет флага «измерение» | 1 |
| `isMulticast` | соответствия полю нет | 1 |
| `isMultireceive` | соответствия полю нет | 1 |
| `isMultivalued` | соответствия полю нет | 1 |
| `lifeline` | соответствия полю нет | 1 |
| `lowerValue` | соответствия полю нет | 1 |
| `maySpecializeType` | соответствия полю нет | 1 |
| `metamodelReference` | соответствия полю нет | 1 |
| `n` | соответствия полю нет | 1 |
| `ne1` | соответствия полю нет | 1 |
| `ne2` | соответствия полю нет | 1 |
| `ordering` | у узла объектов нет порядка | 1 |
| `ownedConnector` | соответствия полю нет | 1 |
| `ownedEnd` | конец ассоциации не хранится отдельным объектом | 1 |
| `ownedReception` | приёмники (reception) не хранятся | 1 |
| `owningAssociation` | владелец конца (класс или ассоциация) не различается | 1 |
| `partWithPort` | у конца коннектора нет части-с-портом | 1 |
| `qualifier` | квалификаторы хранятся у концов связи, а не у свойства | 1 |
| `redefinedProperty` | отношение redefines не хранится | 1 |
| `redefinitionContext` | контекст переопределения не хранится | 1 |
| `relevantBindings` | соответствия полю нет | 1 |
| `returnValue` | соответствия полю нет | 1 |
| `start` | соответствия полю нет | 1 |
| `subject` | соответствия полю нет | 1 |
| `subsettingContext` | отношение subsets не хранится | 1 |
| `targets` | соответствия полю нет | 1 |
| `templateParameterSubstitution` | шаблоны не хранятся | 1 |
| `transformation` | соответствия полю нет | 1 |
| `unlimitedValue` | соответствия полю нет | 1 |
| `upperValue` | соответствия полю нет | 1 |
| `vetices` | соответствия полю нет | 1 |

## По метаклассам

| Метакласс | Виды | Пункт | Всего | В области | Исполняется | Очередь | Тавтологии | Gap | Без OCL | Вне области |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AcceptCallAction | — | 16.14.1.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| AcceptEventAction | — | 16.14.2.7 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| ActionExecutionSpecification | — | 17.12.1.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| ActionInputPin | — | 16.14.4.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| Activity | activity | 15.7.1.6 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| ActivityEdge | — | 15.7.2.8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| ActivityGroup | — | 15.7.4.7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ActivityParameterNode | activityParameter | 15.7.6.5 | 5 | 5 | 1 | 0 | 0 | 4 | 0 | 0 |
| ActivityPartition | swimlane | 15.7.7.6 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| Actor | actor | 18.2.1.4 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| AddStructuralFeatureValueAction | — | 16.14.5.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| AddVariableValueAction | — | 16.14.6.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Association | aggregation, association, communicationPath, composition, link | 11.8.1.8 | 5 | 5 | 1 | 0 | 1 | 3 | 0 | 0 |
| AssociationClass | — | 11.8.2.4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Behavior | — | 13.4.2.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| BehavioralFeature | — | 9.9.2.8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| BehavioredClassifier | — | 10.5.1.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| BroadcastSignalAction | — | 16.14.7.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| CallAction | — | 16.14.8.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| CallBehaviorAction | — | 16.14.9.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| CallOperationAction | — | 16.14.10.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Class | class, metaclass | 11.8.3.8 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| Classifier | — | 9.9.4.8 | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 2 |
| ClassifierTemplateParameter | — | 9.9.5.6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| Clause | — | 16.14.11.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| ClearAssociationAction | — | 16.14.12.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ClearStructuralFeatureAction | — | 16.14.13.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| CollaborationUse | collaborationUse | 11.8.5.5 | 3 | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| CombinedFragment | fragment | 17.12.3.7 | 3 | 3 | 2 | 0 | 0 | 1 | 0 | 0 |
| CommunicationPath | — | 19.5.2.4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Component | component | 11.8.6.7 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| ConditionalNode | — | 16.14.15.7 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| ConnectionPointReference | — | 14.5.1.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Connector | assembly, connector, delegation | 11.8.10.7 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| ConnectorEnd | — | 11.8.11.6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| ConsiderIgnoreFragment | — | 17.12.4.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Constraint | — | 7.8.3.6 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 1 |
| Continuation | — | 17.12.5.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| ControlFlow | controlFlow | 15.7.9.4 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| CreateLinkAction | — | 16.14.16.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| CreateLinkObjectAction | — | 16.14.17.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| CreateObjectAction | — | 16.14.18.5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| DecisionNode | decision | 15.7.12.5 | 8 | 8 | 1 | 0 | 0 | 7 | 0 | 0 |
| DeploymentSpecification | deploymentSpec | 19.5.5.6 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| DestroyObjectAction | — | 16.14.20.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| DestructionOccurrenceSpecification | — | 17.12.6.4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Duration | — | 8.6.1.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| DurationConstraint | — | 8.6.2.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| DurationObservation | — | 8.6.4.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Element | — | 7.8.6.6 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| ElementImport | — | 7.8.7.7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Enumeration | enumeration | 10.5.3.5 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| ExceptionHandler | — | 15.7.13.5 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| ExecutionSpecification | activation | 17.12.8.6 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| ExpansionNode | — | 16.14.22.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Extend | extend | 18.2.2.5 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| Extension | — | 12.4.1.7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ExtensionEnd | — | 12.4.2.7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ExtensionPoint | — | 18.2.3.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| FinalNode | terminate | 15.7.15.5 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| FinalState | final | 14.5.2.5 | 6 | 6 | 5 | 0 | 0 | 1 | 0 | 0 |
| ForkNode | fork | 15.7.17.4 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| FunctionBehavior | — | 13.4.6.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Gate | — | 17.12.9.5 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| GeneralOrdering | — | 17.12.10.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| GeneralizationSet | — | 9.9.8.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| InformationFlow | — | 20.2.1.5 | 3 | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| InformationItem | — | 20.2.2.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| InitialNode | — | 15.7.18.4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| InputPin | — | 16.14.24.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| InstanceSpecification | object | 9.9.9.6 | 4 | 4 | 3 | 0 | 0 | 1 | 0 | 0 |
| Interaction | interaction | 17.12.11.5 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| InteractionConstraint | — | 17.12.12.5 | 6 | 2 | 0 | 0 | 0 | 0 | 2 | 4 |
| InteractionOperand | — | 17.12.14.5 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| InteractionUse | interactionUse | 17.12.16.6 | 6 | 6 | 0 | 0 | 0 | 4 | 2 | 0 |
| Interface | interface | 10.5.5.5 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| InterruptibleActivityRegion | — | 15.7.19.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| JoinNode | join | 15.7.20.6 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| Lifeline | actorLifeline, lifeline, timingLane | 17.12.17.5 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| LinkAction | — | 16.14.26.7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| LinkEndCreationData | — | 16.14.27.7 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| LinkEndData | — | 16.14.28.7 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| LinkEndDestructionData | — | 16.14.29.7 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| LoopNode | — | 16.14.30.7 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| MergeNode | merge | 15.7.21.4 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| Message | createMessage, destroyMessage, message, reply | 17.12.18.7 | 8 | 8 | 1 | 0 | 0 | 5 | 2 | 0 |
| MultiplicityElement | — | 7.8.8.8 | 6 | 6 | 4 | 0 | 0 | 0 | 2 | 0 |
| NamedElement | — | 7.8.9.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| Namespace | — | 7.8.10.7 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 2 |
| Node | node | 19.5.10.6 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| ObjectFlow | objectFlow | 15.7.22.6 | 8 | 8 | 1 | 0 | 0 | 4 | 3 | 0 |
| ObjectNode | objectNode | 15.7.23.7 | 3 | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| OpaqueAction | — | 16.14.31.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| OpaqueExpression | — | 8.6.16.7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| Operation | — | 9.9.11.7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| OperationTemplateParameter | — | 9.9.12.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| OutputPin | — | 16.14.32.4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Package | package, systemBoundary | 12.4.5.8 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| PackageImport | import | 7.8.11.6 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| PackageableElement | — | 7.8.12.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Parameter | — | 9.9.13.7 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| ParameterSet | — | 9.9.16.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| PartDecomposition | — | 17.12.24.4 | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| Pin | — | 16.14.33.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Port | port | 11.8.14.7 | 3 | 3 | 1 | 0 | 0 | 2 | 0 | 0 |
| Profile | profile | 12.4.7.5 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Property | part | 9.9.17.8 | 11 | 11 | 1 | 0 | 0 | 10 | 0 | 0 |
| ProtocolStateMachine | — | 14.5.4.5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| ProtocolTransition | — | 14.5.5.6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| Pseudostate | choice, entryPoint, exitPoint, historyDeep, historyShallow, initial, junction | 14.5.6.7 | 9 | 9 | 6 | 0 | 0 | 3 | 0 | 0 |
| QualifierValue | — | 16.14.34.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| ReadExtentAction | — | 16.14.36.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ReadIsClassifiedObjectAction | — | 16.14.37.6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| ReadLinkAction | — | 16.14.38.6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| ReadLinkObjectEndAction | — | 16.14.39.5 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| ReadLinkObjectEndQualifierAction | — | 16.14.40.5 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| ReadSelfAction | — | 16.14.41.5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| ReadStructuralFeatureAction | — | 16.14.42.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ReadVariableAction | — | 16.14.43.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Reception | — | 10.5.8.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ReclassifyObjectAction | — | 16.14.44.6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| RedefinableElement | — | 9.9.18.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| RedefinableTemplateSignature | — | 9.9.19.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| ReduceAction | — | 16.14.45.6 | 3 | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| Region | — | 14.5.8.6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| RemoveStructuralFeatureValueAction | — | 16.14.46.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| RemoveVariableValueAction | — | 16.14.47.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| ReplyAction | — | 16.14.48.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| SendObjectAction | — | 16.14.49.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| SendSignalAction | — | 16.14.50.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| StartClassifierBehaviorAction | — | 16.14.52.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| StartObjectBehaviorAction | — | 16.14.53.6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| State | state | 14.5.9.8 | 5 | 5 | 0 | 0 | 0 | 5 | 0 | 0 |
| StateMachine | — | 14.5.10.7 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| Stereotype | stereotype | 12.4.9.6 | 7 | 7 | 1 | 0 | 1 | 1 | 4 | 0 |
| StringExpression | — | 8.6.17.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| StructuralFeatureAction | — | 16.14.54.6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| StructuredActivityNode | — | 16.14.55.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| TemplateBinding | — | 7.8.16.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| TemplateParameter | — | 7.8.17.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| TemplateParameterSubstitution | — | 7.8.18.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| TemplateSignature | — | 7.8.19.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| TestIdentityAction | — | 16.14.56.5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| TimeConstraint | — | 8.6.18.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| TimeEvent | — | 13.4.10.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| TimeExpression | — | 8.6.19.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Transition | transition | 14.5.11.8 | 10 | 10 | 2 | 0 | 0 | 8 | 0 | 0 |
| Trigger | — | 13.4.11.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| UnmarshallAction | — | 16.14.57.5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| UseCase | usecase | 18.2.5.6 | 4 | 4 | 3 | 0 | 1 | 0 | 0 | 0 |
| ValuePin | — | 16.14.58.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ValueSpecificationAction | — | 16.14.59.5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| VariableAction | — | 16.14.60.6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| WriteLinkAction | — | 16.14.61.5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| WriteStructuralFeatureAction | — | 16.14.62.6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| WriteVariableAction | — | 16.14.63.6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |

