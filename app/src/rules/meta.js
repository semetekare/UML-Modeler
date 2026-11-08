// Вид элемента нотации → метакласс UML 2.5.1 и его предки.
//
// Нужно там, где констрейнт спрашивает `oclIsKindOf` (обобщение, цели
// ассоциаций актёра). Виды, которых в таблице нет (пакет, состояние, объект,
// заметка…), — не классификаторы: проверки, которым нужен метакласс, такие
// концы пропускают. Типизация метамодели — отдельный разговор, и выдумывать
// за неё вердикт нельзя.

export const METACLASS = {
  class: 'Class',
  component: 'Component',
  node: 'Node',
  device: 'Device',
  executionEnvironment: 'ExecutionEnvironment',
  artifact: 'Artifact',
  interface: 'Interface',
  enumeration: 'Enumeration',
  datatype: 'DataType',
  stereotype: 'Stereotype',
  metaclass: 'Class',
  actor: 'Actor',
  usecase: 'UseCase',
  collaboration: 'BehavioredClassifier',
  activity: 'Activity',
  interaction: 'Interaction',
  state: null,
  package: null,
  model: null,
  profile: null,
  object: null,
  note: null,
};

/** Родители метакласса (UML 2.5.1, разделы 9, 10, 11, 12, 13, 18). */
export const SUPERCLASS = {
  Class: 'Classifier',
  Component: 'Class',
  Node: 'Class',
  Device: 'Node',
  ExecutionEnvironment: 'Node',
  Artifact: 'Classifier',
  Interface: 'Classifier',
  Enumeration: 'DataType',
  DataType: 'Classifier',
  Stereotype: 'Class',
  Actor: 'BehavioredClassifier',
  UseCase: 'BehavioredClassifier',
  BehavioredClassifier: 'Classifier',
  Activity: 'Behavior',
  Interaction: 'Behavior',
  Behavior: 'Class',
  Classifier: null,
};

/** Метаклассы вида и все его предки; null — вид не классификатор. */
export function metaclassesOf(kind) {
  const own = METACLASS[kind] ?? null;
  if (!own) return null;
  const chain = [];
  for (let c = own; c; c = SUPERCLASS[c] ?? null) chain.push(c);
  return chain;
}

/** Элемент модели по id; null, если его нет (битые концы связей). */
export const elementById = (model, id) => (model.elements ?? []).find((e) => e.id === id) ?? null;
