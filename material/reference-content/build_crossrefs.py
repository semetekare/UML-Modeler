#!/usr/bin/env python3
"""Связать корпуса проекта между собой и записать `crossrefs.json`.

Пять связей, у каждой — `confidence` и `basis` (на чём связь основана):

  1. фигура нотации → пункт спецификации   (`app/notation/uml.json` → `spec-tree.json`)
  2. правило → пункт → фигура              (`docs/rules-uml-2.5.1.json`)
  3. стереотип → base-тип → фигура          (`material/stereotypes.xml`)
  4. рисунок пособия → модель корпуса       (`tests/corpus/MANIFEST.json`, `app/reference/vp163/INDEX.md`)
  5. упражнение пособия → модели корпуса    (`docs/uml-tutorial.md` + манифест)

Связь 1 не берётся «с потолка»: в скрипте лежит только список поисковых
терминов на каждую фигуру, а адрес в спецификации находится поиском этого
термина по заголовкам дерева. Найденный заголовок записывается в связь, так
что любую строку результата можно проверить глазами.

Только stdlib. Читает перечисленные файлы, пишет только `crossrefs.json`.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "material" / "reference-content" / "crossrefs.json"
TREE = ROOT / "material" / "reference-content" / "spec-tree.json"
NOTATION = ROOT / "app" / "notation" / "uml.json"
RULES = ROOT / "docs" / "rules-uml-2.5.1.json"
STEREOTYPES = ROOT / "material" / "stereotypes.xml"
MANIFEST = ROOT / "tests" / "corpus" / "MANIFEST.json"
VP163_INDEX = ROOT / "app" / "reference" / "vp163" / "INDEX.md"
VP163_DIR = ROOT / "app" / "reference" / "vp163"
TUTORIAL = ROOT / "docs" / "uml-tutorial.md"
SPEC_MD = ROOT / "reference" / "spec" / "md"

SCHEMA = "uml-crossrefs/1"

# --------------------------------------------------------------------------
# 1. Поисковые термины для фигур и связей нотации.
#
# Это единственная рукописная часть связи «фигура → пункт»: термины задают
# вопрос, ответ даёт поиск по заголовкам спецификации. Порядок терминов —
# приоритет: первый найденный заголовок считается основным, остальные
# попадают в `alsoMatched`.
# --------------------------------------------------------------------------
SHAPE_TERMS = {
    "class": ["Class", "Classes"],
    "interface": ["Interface", "Interfaces"],
    "enumeration": ["Enumeration", "Enumerations"],
    "datatype": ["DataType", "Data Type", "DataTypes"],
    "package": ["Package", "Packages"],
    "model": ["Model", "Models"],
    "profile": ["Profile", "Profiles"],
    "component": ["Component", "Components"],
    "artifact": ["Artifact", "Artifacts"],
    "deploymentSpec": ["DeploymentSpecification", "Deployment Specification"],
    "node": ["Node", "Nodes"],
    "device": ["Device", "Devices"],
    "executionEnvironment": ["ExecutionEnvironment", "Execution Environment"],
    "object": ["InstanceSpecification", "Instance Specification", "Instances", "Instance"],
    "part": ["Parts and Roles", "Part", "Property", "Properties"],
    "port": ["Port", "Ports"],
    "collaboration": ["Collaboration", "Collaborations"],
    "collaborationUse": ["CollaborationUse", "Collaboration Use"],
    "stereotype": ["Stereotype", "Stereotypes"],
    "metaclass": ["Metaclass", "Metaclasses"],
    "actor": ["Actor", "Actors"],
    "usecase": ["UseCase", "Use Case", "Use Cases"],
    "systemBoundary": ["Subject", "System"],
    "note": ["Comment", "Comments"],
    "text": [],
    "state": ["State", "States"],
    "initial": ["InitialNode", "Initial Node", "Initial"],
    "final": ["ActivityFinalNode", "Final Node", "Final Nodes", "FinalState", "Final State", "Final"],
    "choice": ["Choice", "Pseudostate", "Pseudostates"],
    "junction": ["Junction", "Pseudostate", "Pseudostates"],
    "historyShallow": ["ShallowHistory", "Pseudostate"],
    "historyDeep": ["DeepHistory", "Pseudostate"],
    "entryPoint": ["EntryPoint", "Pseudostate"],
    "exitPoint": ["ExitPoint", "Pseudostate"],
    "terminate": ["Terminate", "Pseudostate"],
    "action": ["Action", "Actions"],
    "activity": ["Activity", "Activities"],
    "decision": ["DecisionNode", "Decision Node", "Decision"],
    "merge": ["MergeNode", "Merge Node", "Merge"],
    "fork": ["ForkNode", "Fork Node", "Fork"],
    "join": ["JoinNode", "Join Node", "Join"],
    "objectNode": ["ObjectNode", "Object Node", "Object Nodes"],
    "activityParameter": ["ActivityParameterNode", "Activity Parameter Node"],
    "swimlane": ["ActivityPartition", "Partition", "Partitions"],
    "lifeline": ["Lifeline", "Lifelines"],
    "actorLifeline": ["Lifeline", "Lifelines"],
    "activation": ["ExecutionSpecification", "Execution Specification", "ActionExecutionSpecification"],
    "fragment": ["CombinedFragment", "Combined Fragment", "Fragments"],
    "interactionUse": ["InteractionUse", "Interaction Use", "Interaction Uses"],
    "interaction": ["Interaction", "Interactions"],
    "timingLane": ["Timing Diagram", "Timing Diagrams", "Lifeline"],
}

CONNECTOR_TERMS = {
    "association": ["Association", "Associations"],
    "aggregation": ["Aggregation", "Aggregations"],
    "composition": ["composite aggregation", "Composition"],
    "generalization": ["Generalization", "Generalizations"],
    "realization": ["InterfaceRealization", "Realization", "Realizations"],
    "dependency": ["Dependency", "Dependencies"],
    "usage": ["Usage"],
    "import": ["PackageImport", "Import", "Imports"],
    "merge": ["PackageMerge", "Package Merge"],
    "include": ["Include"],
    "extend": ["Extend"],
    "assembly": ["Connector", "Connectors"],
    "delegation": ["Connector", "Connectors"],
    "connector": ["Connector", "Connectors"],
    "controlFlow": ["ControlFlow", "Control Flow"],
    "objectFlow": ["ObjectFlow", "Object Flow"],
    "transition": ["Transition", "Transitions"],
    "message": ["Message", "Messages"],
    "reply": ["MessageSort", "ReplyMessage", "Message"],
    "createMessage": ["MessageSort", "CreateMessage", "Message"],
    "destroyMessage": ["MessageSort", "DestroyMessage", "Message"],
    "link": ["InstanceSpecification", "Association", "Links"],
    "deployment": ["Deployment", "Deployments"],
    "communicationPath": ["CommunicationPath", "Communication Path"],
    "manifest": ["Manifestation", "Manifest"],
    "trace": ["Trace", "Abstraction"],
    "extension": ["Extension", "Extensions"],
}

# Термины, которые в нотации означают конкретное значение перечисления, а не
# отдельный метакласс: связь ведёт к метаклассу-носителю, и это надо сказать.
VALUE_OF = {
    "choice": "PseudostateKind::choice",
    "junction": "PseudostateKind::junction",
    "historyShallow": "PseudostateKind::shallowHistory",
    "historyDeep": "PseudostateKind::deepHistory",
    "entryPoint": "PseudostateKind::entryPoint",
    "exitPoint": "PseudostateKind::exitPoint",
    "terminate": "PseudostateKind::terminate",
    "final": "ActivityFinalNode / FinalState",
    "reply": "MessageSort::reply",
    "createMessage": "MessageSort::createMessage",
    "destroyMessage": "MessageSort::deleteMessage",
    "assembly": "ConnectorKind::assembly",
    "delegation": "ConnectorKind::delegation",
    "aggregation": "AggregationKind::shared",
    "composition": "AggregationKind::composite",
}

# Ключи, у которых в стандарте больше одного законного адреса: интерфейсу
# нужно показать оба, а не выбирать молча.
AMBIGUOUS = {
    "final": "в нотации два разных элемента: ActivityFinalNode (15.3) и FinalState (14.2); "
             "выбран тот, что соответствует палитре деятельности",
    "merge": "в палитре деятельности это MergeNode (15.3); одноимённая связь merge — "
             "это PackageMerge (12.2), это разные записи нотации",
    "link": "ссылка между экземплярами; отдельного метакласса у неё нет — это экземпляр Association (11.5)",
    "model": "фигура — пакет со стереотипом «model»; пункт 22.2 описывает сам стереотип StandardProfile::Model",
    "metaclass": "понятие профиля: метакласс как элемент нотации профиля; отдельного пункта в стандарте нет",
    "systemBoundary": "рамка системы Visual Paradigm; в стандарте это не элемент нотации, а контекст вариантов использования",
    "text": "свободная надпись на диаграмме; элемента модели у неё нет",
}

# base-тип стереотипа (имя метакласса в профиле Visual Paradigm) → фигура.
BASE_TYPE_ALIASES = {
    "note": "note",
    "interactionlifeline": "lifeline",
    "lifeline": "lifeline",
    "instancespecification": "object",
    "subsystem": "component",
    "collaboration2": "collaboration",
    "activityparameternode": "activityParameter",
    "activityparameter": "activityParameter",
    "deploymentspecification": "deploymentSpec",
    "executionenvironment": "executionEnvironment",
    "usecase": "usecase",
    "actor": "actor",
    "state": "state",
    "transition": "transition",
    "controlflow": "controlFlow",
    "objectflow": "objectFlow",
    "combinedfragment": "fragment",
    "interactionuse": "interactionUse",
    "activitypartition": "swimlane",
    "decisionnode": "decision",
    "mergenode": "merge",
    "forknode": "fork",
    "joinnode": "join",
    "initialnode": "initial",
    "finalstate": "final",
    "objectnode": "objectNode",
    "comment": "note",
}

# Русские термины для поиска по англоязычной спецификации. Это авторский
# глоссарий проекта, а не данные стандарта: каждая пара проверяется тем, что
# английский термин находится в заголовках дерева (иначе пара помечается
# `unresolved`).
RU_EN_GLOSSARY = {
    "квалификатор": "Qualifier",
    "кратность": "Multiplicity",
    "множественность": "Multiplicity",
    "роль": "Property",
    "навигация": "navigability",
    "видимость": "visibility",
    "абстрактный": "isAbstract",
    "статический": "isStatic",
    "производный": "isDerived",
    "ограничение": "Constraint",
    "инвариант": "Constraint",
    "стереотип": "Stereotype",
    "профиль": "Profile",
    "метамодель": "Metamodel",
    "пакет": "Package",
    "импорт": "PackageImport",
    "слияние": "PackageMerge",
    "зависимость": "Dependency",
    "обобщение": "Generalization",
    "реализация": "InterfaceRealization",
    "композиция": "composite aggregation",
    "агрегация": "Aggregation",
    "ассоциация": "Association",
    "атрибут": "Property",
    "операция": "Operation",
    "интерфейс": "Interface",
    "перечисление": "Enumeration",
    "класс": "Class",
    "действующее лицо": "Actor",
    "актор": "Actor",
    "вариант использования": "Use Case",
    "прецедент": "Use Case",
    "состояние": "State",
    "переход": "Transition",
    "действие": "Action",
    "деятельность": "Activity",
    "дорожка": "ActivityPartition",
    "узел": "Node",
    "артефакт": "Artifact",
    "линия жизни": "Lifeline",
    "сообщение": "Message",
    "фрагмент": "CombinedFragment",
    "сторож": "InteractionOperand",
    "сторожевое условие": "InteractionOperand",
    "регион": "Region",
    "порт": "Port",
    "коннектор": "Connector",
    "соединитель": "Connector",
    "часть": "Parts and Roles",
    "экземпляр": "InstanceSpecification",
    "тип данных": "DataType",
    "компонент": "Component",
    "развёртывание": "Deployment",
    "развертывание": "Deployment",
    "включение": "Include",
    "расширение": "Extend",
    "обобщение множества": "Generalization Set",
}


# --------------------------------------------------------------------------
# Дерево
# --------------------------------------------------------------------------
class Tree:
    def __init__(self, payload: dict):
        self.nodes: list[dict] = []
        self.by_number: dict[str, dict] = {}
        self.by_id: dict[str, dict] = {}
        self.parent: dict[str, dict] = {}
        for sec in payload["sections"]:
            self._walk(sec, None)
        self.payload = payload

    def _walk(self, node: dict, parent: dict | None):
        self.nodes.append(node)
        if node["number"]:
            self.by_number.setdefault(node["number"], node)
        self.by_id[node["id"]] = node
        if parent is not None:
            self.parent[node["id"]] = parent
        for child in node["children"]:
            self._walk(child, node)

    def ancestors(self, node: dict) -> list[dict]:
        out = []
        cur = node
        while cur["id"] in self.parent:
            cur = self.parent[cur["id"]]
            out.append(cur)
        return out

    def level2(self, node: dict) -> dict | None:
        """Ближайший предок уровня 2 (или сам узел, если он не глубже)."""
        if node["level"] <= 2:
            return node
        for anc in self.ancestors(node):
            if anc["level"] == 2:
                return anc
        return None

    def text(self, node: dict) -> str:
        """Текст узла из исходного раздела (только чтение)."""
        path = SPEC_MD / node["file"]
        lines = path.read_text(encoding="utf-8").split("\n")
        start, end = node["lines"]
        return "\n".join(lines[start - 1:end])


DESC_SUFFIX_RE = re.compile(r"\s*\[(?:Abstract\s+)?(?:Class|Association|Enumeration|DataType|PrimitiveType)\]$")


def strip_kind(title: str) -> tuple[str, str | None]:
    """«Association [Class]» → («Association», «Class»)."""
    m = DESC_SUFFIX_RE.search(title)
    if not m:
        return title, None
    return title[: m.start()].strip(), m.group(0).strip(" []").replace("Abstract ", "")


def plural_forms(term: str) -> set[str]:
    t = term.lower()
    return {t, t + "s", t + "es", t.rstrip("s"), t.rstrip("e") + "ing"}


class Matcher:
    """Поиск термина по заголовкам дерева с оценкой качества совпадения."""

    def __init__(self, tree: Tree):
        self.tree = tree
        self.heads = [n for n in tree.nodes if n["number"]]

    def best(self, term: str) -> list[tuple[int, dict, str]]:
        """Все совпадения термина: [(score, node, как совпало)].

        Порядок: сначала точные совпадения, при равной оценке — узел, который
        ближе к уровню 2 (это и есть «пункт про понятие»), затем по номеру.
        """
        tl = term.lower()
        tln = tl.replace(" ", "")
        forms = {f.replace(" ", "") for f in plural_forms(term)}
        out = []
        for node in self.heads:
            bare, kind = strip_kind(node["title"])
            bl = bare.lower()
            bln = bl.replace(" ", "")
            if bln == tln:
                out.append((100, node, "точное совпадение заголовка"))
            elif bln in forms:
                out.append((90, node, "совпадение с точностью до числа"))
            elif bln.startswith(tln + " ") or bln.startswith(tln + ":") or bln.startswith(tln + "("):
                out.append((60, node, "заголовок начинается с термина"))
            elif re.search(r"\b" + re.escape(tl) + r"\b", bl):
                out.append((40, node, "термин встречается в заголовке"))
        out.sort(key=lambda x: (-x[0], abs(x[1]["level"] - 2), x[1]["number"]))
        return out

    def text_fallback(self, terms: list[str], section: str) -> dict | None:
        """Искать понятие в тексте подразделов раздела, когда заголовка нет.

        Считается, сколько раз термин встречается в поддереве подраздела
        второго уровня. Подразделы «… Descriptions» исключены: там описан
        каждый метакласс, и они перетянули бы любой термин на себя.
        """
        best = None
        for node in self.tree.nodes:
            if node["level"] != 2 or node["section"] != section:
                continue
            if "Descriptions" in node["title"]:
                continue
            text = self.tree.text(node)
            count = 0
            for term in terms:
                count += len(re.findall(r"\b" + re.escape(term) + r"\b", text, re.I))
            if count < 3:
                continue
            if best is None or count > best[0]:
                best = (count, node)
        if best is None:
            return None
        return {"node": best[1], "count": best[0]}

    def resolve(self, terms: list[str], key: str) -> dict:
        """Разобрать список терминов в адрес спецификации.

        Порядок: (1) точный или почти точный заголовок понятия; (2) описание
        метакласса «X [Class]»; (3) поиск по тексту подразделов раздела.
        """
        concept = None      # подраздел «про понятие»
        metaclass = None    # описание метакласса «X [Class]»
        also = []           # прочие заголовки, где термин нашёлся
        matched = []
        basis = []
        score = 0
        for term in terms:
            hits = self.best(term)
            if not hits:
                continue
            matched.append(term)
            top_score = hits[0][0]
            for s, node, how in hits:
                bare, kind = strip_kind(node["title"])
                if kind is not None:
                    if metaclass is None:
                        metaclass = {"number": node["number"], "title": node["title"], "score": s}
                elif node["level"] <= 4 and s >= 60:
                    if concept is None or s > concept["score"]:
                        concept = {"number": node["number"], "title": node["title"], "score": s}
                elif s >= 40:
                    also.append({"number": node["number"], "title": node["title"], "score": s})
            basis.append(f"«{hits[0][1]['number']} {hits[0][1]['title']}» — {hits[0][2]} («{term}»)")
            score = max(score, top_score)
            # Останавливаться рано нельзя: следующий термин может дать
            # описание метакласса, а оно нужно для проверки правил.
            if concept and concept["score"] >= 90 and metaclass:
                break

        if concept is None and metaclass is None and key and key not in terms:
            # Ни один термин не нашёлся: последняя попытка — сам ключ нотации.
            hits = self.best(key)
            if hits:
                s2, node, how = hits[0]
                matched.append(key)
                bare, kind = strip_kind(node["title"])
                if kind is not None:
                    metaclass = {"number": node["number"], "title": node["title"], "score": s2}
                elif node["level"] <= 4 and s2 >= 60:
                    concept = {"number": node["number"], "title": node["title"], "score": s2}
                basis.append(f"«{node['number']} {node['title']}» — {how} («{key}»)")
                score = max(score, s2)

        target = None
        how_target = None
        if concept:
            node = self.tree.by_number[concept["number"]]
            target = self.tree.level2(node)
            how_target = "пункт найден по заголовку"

        # Заголовок нашёлся, но это «Classifier Descriptions» — понятие описано
        # в подразделе-родителе, там его и надо искать по тексту.
        if target is not None and "Descriptions" in target["title"]:
            target = None
            how_target = None

        if target is None:
            section = self.tree.by_number[metaclass["number"]]["section"] if metaclass else None
            if section is None and concept:
                section = self.tree.by_number[concept["number"]]["section"]
            if section is None:
                # Раздел неизвестен — ищем по всем разделам.
                cand = None
                for sec in sorted({n["section"] for n in self.tree.nodes if n["level"] == 1}):
                    fb = self.text_fallback(terms, sec)
                    if fb and (cand is None or fb["count"] > cand["count"]):
                        cand = fb
            else:
                cand = self.text_fallback(terms, section)
            if cand:
                target = cand["node"]
                how_target = f"пункт найден по тексту: термин встречается {cand['count']} раз"
                basis.append(f"«{target['number']} {target['title']}» — {how_target}")

        if target is None and metaclass:
            target = self.tree.level2(self.tree.by_number[metaclass["number"]])
            how_target = "взят раздел, в котором лежит описание метакласса"

        notation = None
        if target is not None:
            for child in target["children"]:
                if child["title"].lower().startswith("notation"):
                    notation = {"number": child["number"], "title": child["title"]}
                    break

        if concept and concept["score"] >= 90 and how_target == "пункт найден по заголовку":
            confidence = "exact"
        elif target is not None:
            confidence = "derived"
        else:
            confidence = "guess"

        return {
            "target": target,
            "howTarget": how_target,
            "concept": concept,
            "metaclass": metaclass,
            "notation": notation,
            "alsoMatched": also[:3],
            "confidence": confidence,
            "matchedTerms": matched,
            "basis": basis[:3],
            "score": score,
        }


def entry(kind: str, key: str, data: dict, res: dict, tree: Tree) -> dict:
    """Собрать запись связи для одной фигуры/связи нотации."""
    target = res["target"]
    out = {
        "key": key,
        "kind": kind,
        "label": data.get("label"),
        "hint": data.get("hint"),
    }
    if target is not None:
        out["clause"] = {
            "number": target["number"],
            "title": target["title"],
            "id": target["id"],
            "section": target["section"],
            "file": f"spec-sections/{target['number']}-{slug(target['title'])}.md"
            if target["level"] == 1
            else f"spec-sections/{section_file(tree, target['section'])}",
        }
    else:
        out["clause"] = None
    out["howTarget"] = res["howTarget"]
    out["concept"] = res["concept"]
    out["alsoMatched"] = res["alsoMatched"]
    out["metaclass"] = res["metaclass"]
    out["notation"] = res["notation"]
    out["valueOf"] = VALUE_OF.get(key)
    out["ambiguity"] = AMBIGUOUS.get(key)
    out["confidence"] = res["confidence"]
    out["basis"] = res["basis"]
    out["matchedTerms"] = res["matchedTerms"]
    if target is None:
        # Для фигур, у которых пункта нет по устройству (свободная надпись,
        # рамка системы), причина уже записана в ambiguity — не выдаём её за
        # пробел разбора.
        out["note"] = (
            "пункта нет по устройству фигуры — см. ambiguity"
            if key in AMBIGUOUS
            else "в заголовках спецификации нет пункта с таким термином; нужен ручной разбор"
        )
    return out


def slug(text: str) -> str:
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


def section_file(tree: Tree, number: str) -> str:
    node = tree.by_number.get(number)
    if node is None:
        return ""
    while node["level"] > 1:
        node = tree.parent[node["id"]]
    return f"{node['number']}-{slug(node['title'])}.md"


# --------------------------------------------------------------------------
# 4. Рисунки и упражнения
# --------------------------------------------------------------------------
FIG_ROW_RE = re.compile(r"^\|\s*([\d.]+[a-z]?)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]*)\|")


def parse_vp163_index() -> dict[str, dict]:
    """Номер рисунка → файл и тип из таблицы `app/reference/vp163/INDEX.md`."""
    rows = {}
    for line in VP163_INDEX.read_text(encoding="utf-8").split("\n"):
        m = FIG_ROW_RE.match(line)
        if not m:
            continue
        no, fname, kind, alt = m.group(1), m.group(2), m.group(3).strip(), m.group(4).strip()
        if no.lower() in ("№",):
            continue
        rows[no] = {"file": fname, "kind": kind, "alt": alt}
    return rows


EX_RE = re.compile(r"^#{2,4}\s+Упражнение\s+(\d+(?:\.\d+)*(?:\.[A-Z])?)\.\s*(.+?)\s*$")
SECTION_RE = re.compile(r"^#{2,4}\s+(\d+)\.\s+(.+?)\s*$")


def parse_tutorial_exercises() -> dict[str, dict]:
    """Номер упражнения → заголовок и строка в `docs/uml-tutorial.md`."""
    out = {}
    lines = TUTORIAL.read_text(encoding="utf-8").split("\n")
    for i, line in enumerate(lines, 1):
        m = EX_RE.match(line)
        if m:
            out[m.group(1)] = {"title": m.group(2), "line": i, "kind": "exercise"}
            continue
        m = SECTION_RE.match(line)
        if m:
            # Раздел пособия, а не упражнение: рисунки 1.1 и 1.1a относятся к нему.
            out.setdefault(m.group(1), {"title": m.group(2), "line": i, "kind": "section"})
    return out


def main() -> int:
    tree_payload = json.loads(TREE.read_text(encoding="utf-8"))
    tree = Tree(tree_payload)
    matcher = Matcher(tree)
    notation = json.loads(NOTATION.read_text(encoding="utf-8"))
    problems: list[str] = []

    # --- 1. фигура нотации → пункт спецификации ---
    shapes = {}
    for key, data in notation["shapes"].items():
        terms = SHAPE_TERMS.get(key)
        if terms is None:
            problems.append(f"нет поисковых терминов для фигуры «{key}»")
            terms = []
        shapes[key] = entry("shape", key, data, matcher.resolve(terms, key), tree)

    connectors = {}
    for key, data in notation["connectors"].items():
        terms = CONNECTOR_TERMS.get(key)
        if terms is None:
            problems.append(f"нет поисковых терминов для связи «{key}»")
            terms = []
        connectors[key] = entry("connector", key, data, matcher.resolve(terms, key), tree)

    # Обратный указатель «метакласс → фигуры»: нужен для проверки правил.
    metaclass_to_shape: dict[str, list[str]] = {}
    for kind, table in (("shape", shapes), ("connector", connectors)):
        for key, rec in table.items():
            mc = rec.get("metaclass")
            if mc:
                name, _ = strip_kind(mc["title"])
                metaclass_to_shape.setdefault(name, []).append(f"{kind}:{key}")

    # --- 2. правило → пункт → фигура ---
    rules_in = json.loads(RULES.read_text(encoding="utf-8"))
    rules = []
    for rule in rules_in:
        src = rule["source"]
        clause_no = src["clause"]
        node = tree.by_number.get(clause_no)
        applies = rule.get("appliesTo", {})
        element_keys = [k for k in applies.get("element", [])]
        rel_keys = [k for k in applies.get("relationship", [])]
        bad = [k for k in element_keys if k not in notation["shapes"]]
        bad += [k for k in rel_keys if k not in notation["connectors"]]
        if bad:
            problems.append(f"правило {rule['id']}: неизвестные ключи нотации {bad}")

        # Что за пункт на самом деле: должен быть подразделом Constraints.
        clause_title = node["title"] if node else None
        is_constraints = bool(node) and clause_title.lower().startswith("constraints")
        # Название ограничения должно встречаться в тексте этого пункта.
        name_in_text = None
        if node is not None:
            text = tree.text(node)
            name_in_text = src.get("name") in text if src.get("name") else None
        # Метакласс правила → фигуры с тем же метаклассом.
        mc_shapes = metaclass_to_shape.get(src["metaclass"], [])

        checks = {
            "clauseExists": node is not None,
            "clauseIsConstraints": is_constraints,
            "constraintNameInClause": name_in_text,
            "metaclassHasFigure": bool(mc_shapes),
        }
        if node is None:
            problems.append(f"правило {rule['id']}: пункта {clause_no} нет в дереве")
        elif not is_constraints:
            problems.append(
                f"правило {rule['id']}: пункт {clause_no} — «{clause_title}», а не Constraints"
            )
        if name_in_text is False:
            problems.append(
                f"правило {rule['id']}: имени «{src.get('name')}» нет в тексте пункта {clause_no}"
            )

        if checks["clauseExists"] and checks["clauseIsConstraints"] and checks["constraintNameInClause"]:
            confidence = "exact"
        elif checks["clauseExists"] and checks["clauseIsConstraints"]:
            confidence = "derived"
        else:
            confidence = "guess"

        rules.append({
            "id": rule["id"],
            "level": rule.get("level"),
            "message": rule.get("message"),
            "hint": rule.get("hint"),
            "metaclass": src["metaclass"],
            "constraint": src.get("constraint"),
            "page": src.get("page"),
            "clause": {
                "number": clause_no,
                "title": clause_title,
                "id": node["id"] if node else None,
                "file": f"spec-sections/{section_file(tree, clause_no)}" if node else None,
            },
            "appliesToShapes": element_keys,
            "appliesToConnectors": rel_keys,
            "metaclassShapes": mc_shapes,
            "checks": checks,
            "confidence": confidence,
            "basis": [
                f"пункт {clause_no} {'есть в дереве' if node else 'не найден'}"
                + (f" и это «{clause_title}»" if node else ""),
                f"имя ограничения «{src.get('name')}» "
                + ("найдено в тексте пункта" if name_in_text else "не найдено в тексте пункта"),
                f"метакласс {src['metaclass']} → фигуры: {', '.join(mc_shapes) if mc_shapes else 'нет'}",
            ],
        })

    # --- 3. стереотип → base-тип → фигура ---
    root = ET.parse(STEREOTYPES).getroot()
    sts = []
    base_types: dict[str, dict] = {}
    for group in root:
        for st in group.iter("Stereotype"):
            base = st.get("baseType") or ""
            bl = base.lower()
            # base-тип может совпасть и с фигурой, и со связью нотации.
            if bl in notation["shapes"]:
                shape, shape_kind = bl, "shape"
            elif bl in notation["connectors"]:
                shape, shape_kind = bl, "connector"
            else:
                shape, shape_kind = BASE_TYPE_ALIASES.get(bl), "shape"
            if bl in notation["shapes"] or bl in notation["connectors"]:
                conf = "exact"
                why = "имя base-типа совпадает с ключом нотации"
            elif shape:
                conf = "derived"
                why = "base-тип сведён к фигуре таблицей соответствий"
            else:
                conf = "guess"
                why = "фигуры для этого base-типа в нотации нет"
            sts.append({
                "name": st.get("name"),
                "baseType": base,
                "group": group.tag,
                "abstract": st.get("abstract") == "true",
                "shape": shape,
                "shapeKind": shape_kind if shape else None,
                "confidence": conf,
                "basis": why,
            })
            agg = base_types.setdefault(base, {
                "baseType": base,
                "shape": shape,
                "shapeKind": shape_kind if shape else None,
                "confidence": conf,
                "stereotypes": 0,
            })
            agg["stereotypes"] += 1

    # --- 4. рисунок пособия → модель корпуса ---
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    vp = parse_vp163_index()
    figures = []
    for fig in manifest["figures"]:
        no = fig["figureNo"]
        png = VP163_DIR / fig["file"]
        vp_row = vp.get(no)
        model = fig.get("model")
        model_path = ROOT / "tests" / "corpus" / model if model else None
        checks = {
            "pngExists": png.is_file(),
            "indexRow": vp_row is not None,
            "indexFileAgrees": bool(vp_row) and vp_row["file"] == fig["file"],
            "modelExists": bool(model_path) and model_path.is_file(),
        }
        # Арифметика имени файла. Указатель утверждает, что имя — это номер без
        # точек; на деле номер кодируется как «раздел|подраздел|рисунок» с
        # подразделом по основанию 100 (3.1.2 → 3|01|02 → 3102), а у номеров из
        # двух частей подраздела нет (1.1 → 1|00|01 → 1001). Проверяются оба
        # варианта; засчитывается тот, что совпал с настоящим именем файла.
        stem = fig["file"].split(".")[0]
        parts = no.rstrip("ab").split(".")
        candidates = ["".join(parts)]
        if len(parts) == 3:
            candidates.append(f"{parts[0]}{int(parts[1]):02d}{int(parts[2]):02d}")
        elif len(parts) == 2:
            candidates.append(f"{parts[0]}{0:02d}{int(parts[1]):02d}")
        checks["fileNameMatchesNumber"] = any(c + no[len(no.rstrip("ab")):] == stem for c in candidates)
        # У рисунков-снимков интерфейса и деревьев модели модели нет по
        # устройству — это факт манифеста, а не догадка.
        no_model_expected = model is None and fig.get("group") != "diagram"
        checks["noModelExpected"] = no_model_expected
        if checks["pngExists"] and checks["indexFileAgrees"] and (checks["modelExists"] or no_model_expected):
            confidence = "exact"
        elif checks["pngExists"]:
            confidence = "derived"
        else:
            confidence = "guess"
        figures.append({
            "figureNo": no,
            "png": f"app/reference/vp163/{fig['file']}",
            "model": f"tests/corpus/{model}" if model else None,
            "type": fig.get("type"),
            "diagramName": fig.get("diagramName"),
            "group": fig.get("group"),
            "reproducible": fig.get("reproducible"),
            "exercise": fig.get("exercise"),
            "indexKind": vp_row["kind"] if vp_row else None,
            "checks": checks,
            "confidence": confidence,
        })
        if not checks["pngExists"]:
            problems.append(f"рисунок {no}: файла {fig['file']} нет в app/reference/vp163/")
        if not checks["indexFileAgrees"]:
            problems.append(f"рисунок {no}: манифест и INDEX.md расходятся в имени файла")

    # --- 5. упражнение пособия → модели корпуса ---
    ex_headings = parse_tutorial_exercises()
    by_exercise: dict[str, list[dict]] = {}
    for fig in figures:
        by_exercise.setdefault(fig["exercise"], []).append(fig)
    exercises = []
    for ex_no in sorted(by_exercise, key=lambda s: [int(p) for p in re.findall(r"\d+", s)]):
        figs = by_exercise[ex_no]
        head = ex_headings.get(ex_no)
        models = [f["model"] for f in figs if f["model"]]
        # «1» в манифесте — не упражнение, а раздел 1 пособия.
        if head and head["kind"] == "exercise":
            confidence = "exact"
            title = head["title"]
            line = head["line"]
            how = "номер упражнения совпал с заголовком «Упражнение …» в пособии"
        elif head and head["kind"] == "section":
            confidence = "derived"
            title = head["title"]
            line = head["line"]
            how = "номер совпал с заголовком раздела пособия, а не упражнения: рисунок относится к разделу"
        else:
            confidence = "derived"
            title = None
            line = None
            how = "упражнения с таким номером в пособии нет; рисунки отнесены к разделу"
        exercises.append({
            "number": ex_no,
            "title": title,
            "line": line,
            "figures": [f["figureNo"] for f in figs],
            "models": models,
            "confidence": confidence,
            "basis": how,
        })
        if not head:
            problems.append(f"упражнение {ex_no}: нет заголовка в пособии (рисунки {len(figs)})")

    # Упражнения без рисунков — тоже факт.
    orphan_exercises = [
        n for n, h in ex_headings.items() if h["kind"] == "exercise" and n not in by_exercise
    ]

    # --- сводка ---
    def tally(records: list[dict]) -> dict[str, int]:
        out = {"exact": 0, "derived": 0, "guess": 0}
        for r in records:
            out[r["confidence"]] = out.get(r["confidence"], 0) + 1
        return out

    notation_all = list(shapes.values()) + list(connectors.values())
    summary = {
        "shapes": tally(list(shapes.values())),
        "connectors": tally(list(connectors.values())),
        "notation": tally(notation_all),
        "rules": tally(rules),
        "stereotypes": tally(sts),
        "figures": tally(figures),
        "exercises": tally(exercises),
    }

    payload = {
        "schema": SCHEMA,
        "generator": "material/reference-content/build_crossrefs.py",
        "sources": {
            "specTree": {"path": "material/reference-content/spec-tree.json",
                         "sha256": hashlib.sha256(TREE.read_bytes()).hexdigest()},
            "notation": {"path": "app/notation/uml.json",
                         "sha256": hashlib.sha256(NOTATION.read_bytes()).hexdigest()},
            "rules": {"path": "docs/rules-uml-2.5.1.json",
                      "sha256": hashlib.sha256(RULES.read_bytes()).hexdigest()},
            "stereotypes": {"path": "material/stereotypes.xml",
                            "sha256": hashlib.sha256(STEREOTYPES.read_bytes()).hexdigest()},
            "manifest": {"path": "tests/corpus/MANIFEST.json",
                         "sha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest()},
            "vp163Index": {"path": "app/reference/vp163/INDEX.md",
                           "sha256": hashlib.sha256(VP163_INDEX.read_bytes()).hexdigest()},
            "tutorial": {"path": "docs/uml-tutorial.md",
                         "sha256": hashlib.sha256(TUTORIAL.read_bytes()).hexdigest()},
        },
        "confidenceMeaning": {
            "exact": "адрес найден прямым совпадением: заголовок пункта, имя файла, номер упражнения",
            "derived": "адрес получен из проверяемого правила (таблица соответствий, предок узла, сумма)",
            "guess": "прямого подтверждения нет; в интерфейсе показывать нельзя без пометки",
        },
        "summary": summary,
        "notationToClause": {"shapes": shapes, "connectors": connectors},
        "rulesToClause": rules,
        "stereotypeToShape": {
            "byBaseType": base_types,
            "stereotypes": sts,
        },
        "figureToModel": figures,
        "exerciseToModel": exercises,
        "ruEnGlossary": RU_EN_GLOSSARY,
        "problems": problems,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print("фигуры:", summary["shapes"], "связи:", summary["connectors"])
    print("правила:", summary["rules"])
    print("стереотипы:", summary["stereotypes"])
    print("рисунки:", summary["figures"], "упражнения:", summary["exercises"])
    print(f"упражнений без рисунков: {len(orphan_exercises)} {orphan_exercises}")
    print(f"записано: {OUT.relative_to(ROOT)} ({OUT.stat().st_size} Б)")
    if problems:
        print(f"проблем: {len(problems)}", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
