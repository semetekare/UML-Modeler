// Реестр проверок: значение `check` из набора правил → функция.
//
// Одна проверка — одна маленькая функция `(model, rule) => Finding[]`.
// Ключ реестра обязан совпадать с `check` правила: правило, чьего `check` здесь
// нет и которое не записано невыразимым в `coverage.js`, — ошибка загрузки
// набора, а не тихий пропуск (см. `engine.js`).
//
// Реестр общий для трёх слоёв: стандарт, практика и правила проекта различаются
// не функциями, а данными — источником, уровнем и объяснением. Геометрии листа
// здесь нет вовсе: те проверки не читают модель и живут в vendor/archify.

import {
  multUpperGeLower, multLowerNonNegative, multLowerIsInteger,
  multUpperIsUnlimitedNatural, compositeUpperBoundLe1,
} from './multiplicity.js';
import { namespaceMembersDistinguishable, actorMustHaveName, usecaseMustHaveName } from './names.js';
import {
  generalizationCompatibleKinds, generalizationCycle, stereotypeGeneralizesStereotype,
} from './classification.js';
import {
  associationAggregationBinaryOnly, actorAssociationTargets, usecaseNoAssociationToUsecase,
} from './associations.js';
import { interfaceFeatureVisibilityPublic } from './interface.js';
import { usecaseIncludeCycle } from './usecase.js';
import { optLoopBreakNeg, breakCoversEnclosing, messageCrossesFragment } from './fragments.js';
import {
  forkOneIncomingEdge, forkEdges, joinOneOutgoingEdge, joinIncomingObjectFlow,
  mergeOneOutgoingEdge, mergeEdges, decisionIncomingOutgoingEdges, finalNodeNoOutgoingEdges,
  activityParameterNodeNoEdges,
} from './activity.js';
import {
  pseudostateInitialVertex, pseudostateChoiceVertex, pseudostateJunctionVertex,
  pseudostateForkVertex, pseudostateJoinVertex, pseudostateHistoryVertices,
  finalStateNoOutgoingTransitions, finalStateNoRegions, finalStateNoEntry,
  finalStateNoExit, finalStateNoDo,
} from './pseudostates.js';
import { objectFlowNoExecutableNodes } from './flows.js';
import { portEncapsulatedOwner } from './port.js';
import {
  instanceSlotUniqueFeature, instanceSlotDefiningFeature, instanceDeploymentArtifact,
} from './instances.js';
import { transitionForkTargetState, transitionJoinSourceState } from './transitions.js';
import { deploySpecTargetEnvironment, deploySpecDeployedComponents } from './deployment.js';
import { componentNestedInClass, componentNestedClassifier } from './component.js';
import { elementOwnSelf } from './ownership.js';
import { interactionNotNested } from './interaction.js';
import {
  elementIsolated, elementNotOnAnyDiagram, elementUnnamed,
  relationshipDuplicate, relationshipNotOnAnyDiagram, shapeIsolatedOnDiagram,
  stereotypeNameNotClash,
  objectClassifierKind, actionBehaviorIsActivity, swimlaneRepresentsKind,
  interactionUseRefersKind,
} from './practice.js';
import { lifelineRepresentsKind, messageSignatureOperation } from './sequence.js';

export const CHECKS = {
  'multiplicity-upper-ge-lower': multUpperGeLower,
  'multiplicity-lower-non-negative': multLowerNonNegative,
  'multiplicity-lower-integer': multLowerIsInteger,
  'multiplicity-upper-unlimited-natural': multUpperIsUnlimitedNatural,
  'composite-end-upper-bound': compositeUpperBoundLe1,
  'namespace-members-distinguishable': namespaceMembersDistinguishable,
  'element-own-self': elementOwnSelf,
  'generalization-compatible-kinds': generalizationCompatibleKinds,
  'generalization-cycle': generalizationCycle,
  'interface-feature-visibility': interfaceFeatureVisibilityPublic,
  'aggregation-binary-only': associationAggregationBinaryOnly,
  'stereotype-generalizes-stereotype': stereotypeGeneralizesStereotype,
  'actor-association-targets': actorAssociationTargets,
  'actor-must-have-name': actorMustHaveName,
  'usecase-no-association-to-usecase': usecaseNoAssociationToUsecase,
  'usecase-include-cycle': usecaseIncludeCycle,
  'usecase-must-have-name': usecaseMustHaveName,
  'opt-loop-break-neg': optLoopBreakNeg,
  'break-covers-enclosing': breakCoversEnclosing,
  'fork-one-incoming-edge': forkOneIncomingEdge,
  'fork-edges': forkEdges,
  'join-one-outgoing-edge': joinOneOutgoingEdge,
  'join-incoming-object-flow': joinIncomingObjectFlow,
  'merge-one-outgoing-edge': mergeOneOutgoingEdge,
  'merge-edges': mergeEdges,
  'decision-incoming-outgoing-edges': decisionIncomingOutgoingEdges,
  'final-node-no-outgoing-edges': finalNodeNoOutgoingEdges,
  'pseudostate-initial-vertex': pseudostateInitialVertex,
  'pseudostate-choice-vertex': pseudostateChoiceVertex,
  'pseudostate-junction-vertex': pseudostateJunctionVertex,
  'pseudostate-fork-vertex': pseudostateForkVertex,
  'pseudostate-join-vertex': pseudostateJoinVertex,
  'pseudostate-history-vertices': pseudostateHistoryVertices,
  'finalstate-no-outgoing-transitions': finalStateNoOutgoingTransitions,
  'finalstate-no-regions': finalStateNoRegions,
  'finalstate-no-entry': finalStateNoEntry,
  'finalstate-no-exit': finalStateNoExit,
  'finalstate-no-do': finalStateNoDo,
  'objectflow-no-executable-nodes': objectFlowNoExecutableNodes,
  'port-encapsulated-owner': portEncapsulatedOwner,
  'activity-parameter-node-no-edges': activityParameterNodeNoEdges,
  'instance-slot-unique-feature': instanceSlotUniqueFeature,
  'instance-slot-defining-feature': instanceSlotDefiningFeature,
  'instance-deployment-artifact': instanceDeploymentArtifact,
  'transition-fork-target-state': transitionForkTargetState,
  'transition-join-source-state': transitionJoinSourceState,
  'deploy-spec-target-environment': deploySpecTargetEnvironment,
  'deploy-spec-deployed-components': deploySpecDeployedComponents,
  'message-crosses-fragment': messageCrossesFragment,
  'component-nested-in-class': componentNestedInClass,
  'component-nested-classifier': componentNestedClassifier,
  'interaction-not-nested': interactionNotNested,
  'element-isolated': elementIsolated,
  'element-not-on-any-diagram': elementNotOnAnyDiagram,
  'element-unnamed': elementUnnamed,
  'relationship-duplicate': relationshipDuplicate,
  'relationship-not-on-any-diagram': relationshipNotOnAnyDiagram,
  'shape-isolated-on-diagram': shapeIsolatedOnDiagram,
  'stereotype-name-not-clash': stereotypeNameNotClash,
  'object-classifier-kind': objectClassifierKind,
  'action-behavior-is-activity': actionBehaviorIsActivity,
  'swimlane-represents-kind': swimlaneRepresentsKind,
  'interaction-use-refers-kind': interactionUseRefersKind,
  'lifeline-represents-classifier': lifelineRepresentsKind,
  'message-signature-operation': messageSignatureOperation,
};

/** Проверки слоя практики: они не принадлежат набору стандарта. */
export const PRACTICE_CHECKS = new Set([
  'element-isolated',
  'element-not-on-any-diagram',
  'element-unnamed',
  'relationship-duplicate',
  'relationship-not-on-any-diagram',
  'shape-isolated-on-diagram',
  'stereotype-name-not-clash',
  'object-classifier-kind',
  'action-behavior-is-activity',
  'swimlane-represents-kind',
  'interaction-use-refers-kind',
  'lifeline-represents-classifier',
  'message-signature-operation',
]);

export const IMPLEMENTED = Object.keys(CHECKS).sort();
