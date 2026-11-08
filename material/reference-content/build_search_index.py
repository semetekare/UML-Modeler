#!/usr/bin/env python3
"""Собрать поисковый индекс по всем корпусам проекта: `search-index.json`.

Что попадает в индекс (запись = один документ):

  вид        что ищется                                  откуда
  ---------  ------------------------------------------  ------------------------------------
  spec-node  заголовки пунктов спецификации               spec-tree.json
  spec-para  абзацы пояснительных подразделов              reference/spec/md
             и проза служебных подзаголовков метакласса
             (документ называется «Description — Class»)
  rule       имена правил и их сообщения                  app/notation/rules/uml-2.5.1.json
                                                          app/notation/rules/practice.json
  stereotype имена стереотипов и их синонимы               material/stereotypes.xml
  shape      названия фигур, label и hint                  app/notation/uml.json
  connector  названия связей, label и hint                 app/notation/uml.json
  exercise   заголовки упражнений пособия                  docs/uml-tutorial.md
  plantuml   конструкции PlantUML                          docs/plantuml-grammar.json

Русский и английский сводятся двумя способами: (1) русские `label`/`hint` фигур
и связей дописываются в постинги того пункта спецификации, к которому фигура
привязана в `crossrefs.json`; (2) `glossary` переводит русский термин в
английские, и запрос расширяется ими на стороне поиска.

Индекс хранит адрес и короткий отрывок, а не текст целиком: полный текст лежит
в `spec-sections/`, поэтому размер индекса не растёт вместе с корпусом.

Только stdlib. Пишет `search-index.json` и печатает разбор размера.
"""

from __future__ import annotations

import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "material" / "reference-content" / "search-index.json"
TREE = ROOT / "material" / "reference-content" / "spec-tree.json"
CROSSREFS = ROOT / "material" / "reference-content" / "crossrefs.json"
NOTATION = ROOT / "app" / "notation" / "uml.json"
# Набор берётся у приложения, а не у его копии в docs/: индекс обязан знать
# ровно те правила, которые грузит движок. Копия в docs/ отстала на 35 правил,
# и поиск честно не находил их (docs/VALIDATOR-PLAN.md §3.4).
RULES = ROOT / "app" / "notation" / "rules" / "uml-2.5.1.json"
PRACTICE = ROOT / "app" / "notation" / "rules" / "practice.json"
STEREOTYPES = ROOT / "material" / "stereotypes.xml"
TUTORIAL = ROOT / "docs" / "uml-tutorial.md"
PLANTUML = ROOT / "docs" / "plantuml-grammar.json"
SPEC_MD = ROOT / "reference" / "spec" / "md"

SCHEMA = "uml-search/1"

KINDS = [
    "spec-node",    # 0
    "spec-para",    # 1
    "rule",         # 2
    "stereotype",   # 3
    "shape",        # 4
    "connector",    # 5
    "exercise",     # 6
    "plantuml",     # 7
]

# Вес вида при ранжировании: правило и фигура важнее абзаца спецификации.
KIND_WEIGHT = {
    0: 1.0,
    1: 0.85,
    2: 1.2,
    3: 1.0,
    4: 1.2,
    5: 1.2,
    6: 1.1,
    7: 0.8,
}

STOPWORDS = {
    # английские
    "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "be", "as", "by", "for",
    "on", "at", "it", "its", "this", "that", "these", "those", "with", "from", "which",
    "may", "can", "shall", "should", "not", "no", "if", "then", "than", "such", "when",
    "where", "all", "any", "each", "one", "two", "has", "have", "was", "were", "will",
    "there", "their", "they", "them", "also", "but", "so", "into", "only", "more", "most",
    # русские
    "и", "в", "во", "не", "на", "что", "с", "со", "как", "это", "по", "к", "из", "от",
    "для", "или", "же", "ли", "бы", "но", "то", "так", "при", "над", "под", "без", "у",
    "о", "об", "за", "до", "если", "чем", "все", "его", "её", "ее", "их", "мы", "вы",
}

WORD_RE = re.compile(r"[0-9a-zа-яё]+")

# Абзацы берутся из пояснительных подразделов: там проза, а не описание
# метаклассов и не OCL.
PROSE_TITLES = {
    "summary", "semantics", "notation", "examples", "overview", "scope",
    "description", "structure", "abstract syntax",
}
SKIP_TITLES = {"constraints", "diagrams", "generalizations", "specializations",
               "attributes", "association ends", "operations"}


# Подзаголовки описания метакласса, которые в индекс не идут как ЗАГОЛОВКИ:
# сами по себе они ничего не значат, а «Constraints» значат — это имена
# инвариантов. Проза под четырьмя из них индексируется отдельно (см.
# SUBTITLE_TITLES): заголовок не ищем, текст под ним — ищем.
DROP_SUB_TITLES = {
    "description", "diagrams", "generalizations", "specializations",
    "attributes", "association ends", "operations", "constraints and semantics",
}

# Служебные подзаголовки, проза под которыми идёт в индекс ИМЕНЕМ РОДИТЕЛЯ:
# документ называется «Description — Class», «Association Ends — Association».
# Заголовок «Description» ничего не значит, а текст под ним объясняет
# метакласс — и запрос «association ends» должен находить концы ассоциации.
# «Diagrams» и «Generalizations» сюда не входят намеренно: под ними таблицы
# и перечисления имён, а не проза. «Specializations» — такой же список.
SUBTITLE_TITLES = {"description", "association ends", "operations", "attributes"}

# Вес абзаца под служебным подзаголовком ниже обычного абзаца (0,85) и любого
# пункта (1,0–1,15): таких документов больше тысячи, и «Description — Class»
# не должен перебивать сам пункт «11.5.4 Notation» только потому, что слово
# «class» встретилось в имени родителя. Но и не настолько низкий, чтобы проза
# метакласса не поднималась выше карточек: 0,75 — ниже базы, выше мусора.
SUBTITLE_WEIGHT = 0.75

ASSOC_DESC_RE = re.compile(r"^A_\w+ \[Association\]$")


def indexable(node: dict) -> bool:
    """Идёт ли ЗАГОЛОВОК пункта в поисковый индекс.

    Отбрасываются: описания метаассоциаций (`A_xxx_yyy [Association]`, 418 шт.)
    и служебные подзаголовки описаний метаклассов (`Attributes`, `Operations`,
    `Diagrams`…, 1 631 шт.). Заголовок «Constraints» остаётся: под ним лежат
    имена инвариантов, по которым ищут. Пункты остаются в дереве — здесь
    решается только, что искать, а не что существует.

    Проза под `SUBTITLE_TITLES` при этом не теряется: её берёт отдельный
    проход ниже и называет именем родителя.
    """
    title = node["title"]
    if ASSOC_DESC_RE.match(title):
        return False
    if title.lower() in DROP_SUB_TITLES:
        return False
    return True


def metaclass_name(title: str) -> str:
    """`Class [Class]` → `Class`: в имени документа хвост вида — шум.

    В дереве хвост `[Class]` / `[Abstract Class]` различает вид метакласса,
    а в названии «Description — Class» он только мешает читать. Имена
    родителей у 600 служебных подзаголовков уникальны, так что скобки не
    нужны и для различения.
    """
    return re.sub(r"\s*\[[^\]]*\]\s*$", "", title).strip()


def split_entries(text: str) -> list[tuple[str, int]]:
    """Абзацы и перечисления под служебным подзаголовком: [(текст, строка)].

    Отличие от `split_paragraphs`: строка списка («- mapping : OpaqueExpression»)
    не выбрасывается, а начинает абзац. Под «Association Ends», «Attributes»
    и «Operations» имя конца, тип и сигнатура операции стоят именно в строке
    списка, а объяснение — ниже; без этой строки в индекс попадал обрывок
    с середины фразы. Пустая строка внутри перечисления абзац не закрывает —
    его закрывает следующий пункт списка, заголовок или ограда OCL.
    """
    out: list[tuple[str, int]] = []
    buf: list[str] = []
    start = 0
    in_entry = False
    in_fence = False

    def flush() -> None:
        nonlocal buf
        if buf:
            out.append(("\n".join(buf), start))
            buf = []

    for i, line in enumerate(text.split("\n")):
        stripped = line.strip()
        # OCL — не проза: в индекс идут слова, а не тело инварианта.
        if stripped.startswith("```"):
            flush()
            in_entry = False
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.startswith("#") or stripped.startswith("|"):
            flush()
            in_entry = False
            continue
        if stripped.startswith("- ") or stripped.startswith("* "):
            flush()
            in_entry = True
            start = i
            buf.append(stripped[2:].strip())
            continue
        if not stripped:
            if not in_entry:
                flush()
            continue
        if not buf:
            start = i
        buf.append(stripped)
    flush()
    return out


def tokenize(text: str) -> list[str]:
    """Слова в нижнем регистре без стоп-слов; ё и е считаются одной буквой."""
    text = text.lower().replace("ё", "е")
    out = []
    for w in WORD_RE.findall(text):
        if len(w) < 3 and not w.isdigit():
            continue
        if w in STOPWORDS:
            continue
        out.append(w)
    return out


def split_paragraphs(text: str) -> list[tuple[str, int]]:
    """Абзацы текста: [(абзац, номер строки в файле раздела)].

    Разделитель — пустая строка. Заголовки, ограды, таблицы и списки в абзацы
    не попадают: это разметка, а не проза.
    """
    out = []
    buf: list[str] = []
    start = 0
    for i, line in enumerate(text.split("\n")):
        stripped = line.strip()
        if not stripped:
            if buf:
                out.append(("\n".join(buf), start))
                buf = []
            continue
        if stripped.startswith("#") or stripped.startswith("```") or stripped.startswith("|"):
            if buf:
                out.append(("\n".join(buf), start))
                buf = []
            continue
        if stripped.startswith("- ") or stripped.startswith("* "):
            continue
        if not buf:
            start = i
        buf.append(stripped)
    if buf:
        out.append(("\n".join(buf), start))
    return out


# Ручные якоря для понятий, которых нет среди фигур палитры. Формат:
# (английский термин, русское название, пункт, на чём основан выбор).
MANUAL_ANCHORS = [
    ("qualifier", "квалификатор", "9.5",
     "квалификаторы — свойства полюса ассоциации; определены в 9.5 Properties (9.5.3 Semantics)"),
    ("multiplicity", "кратность", "7.5",
     "пункт 7.5 Types and Multiplicity"),
    ("guard", "сторожевое условие", "17.6",
     "сторож операнда комбинированного фрагмента — пункт 17.6 Fragments"),
    ("operation", "операция", "9.6",
     "пункт 9.6 Operations"),
    ("property", "свойство", "9.5",
     "пункт 9.5 Properties"),
    ("attribute", "атрибут", "9.5",
     "атрибут — свойство классификатора; пункт 9.5 Properties"),
    ("namespace", "пространство имён", "7.4",
     "пункт 7.4 Namespaces"),
    ("visibility", "видимость", "7.4",
     "видимость — свойство NamedElement; пункт 7.4 Namespaces"),
    ("constraint", "ограничение", "7.6",
     "пункт 7.6 Constraints"),
    ("invariant", "инвариант", "7.6",
     "инвариант — ограничение без стереотипа; пункт 7.6 Constraints"),
    ("stereotype", "стереотип", "12.3",
     "стереотипы определены в пункте 12.3 Profiles"),
    ("profile", "профиль", "12.3",
     "пункт 12.3 Profiles"),
    ("metaclass", "метакласс", "12.3",
     "метакласс как элемент профиля — пункт 12.3 Profiles"),
    ("generalization", "обобщение", "9.2",
     "обобщение определено среди Classifiers; описание метакласса — 9.9.7"),
    ("realization", "реализация", "10.4",
     "реализация интерфейса — InterfaceRealization; пункт 10.4 Interfaces"),
    ("execution specification", "спецификация выполнения", "17.2",
     "полоса активации — ExecutionSpecification; пункт 17.2 Interactions"),
    ("pseudostate", "псевдосостояние", "14.2",
     "пункт 14.2 Behavior StateMachines"),
    ("region", "регион", "14.2",
     "регион состояния — пункт 14.2 Behavior StateMachines"),
    ("information item", "элемент информации", "20.1",
     "пункт 20.1 Information Flows"),
    ("instance", "экземпляр", "9.8",
     "пункт 9.8 Instances"),
    ("template", "шаблон", "7.3",
     "пункт 7.3 Templates"),
    ("primitive type", "примитивный тип", "21",
     "пункт 21 Primitive Types"),
]


def tree_title(tree: dict, number: str) -> str | None:
    """Заголовок пункта по номеру (для якорей, заданных номером)."""
    stack = list(tree["sections"])
    while stack:
        node = stack.pop()
        if node["number"] == number:
            return node["title"]
        stack.extend(node["children"])
    return None


def base36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(digits[r])
    return "".join(reversed(out))


def normalize_spaces(name: str) -> str:
    """`executionEnvironment` → `execution Environment`: синоним для поиска."""
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", name)


def main() -> int:
    tree = json.loads(TREE.read_text(encoding="utf-8"))
    xref = json.loads(CROSSREFS.read_text(encoding="utf-8"))
    notation = json.loads(NOTATION.read_text(encoding="utf-8"))
    rules = json.loads(RULES.read_text(encoding="utf-8"))
    practice = json.loads(PRACTICE.read_text(encoding="utf-8"))
    plantuml = json.loads(PLANTUML.read_text(encoding="utf-8"))

    docs: list[list] = []          # [вид, адрес, заголовок/отрывок, строка, вес]
    postings: dict[str, set[int]] = {}
    problems: list[str] = []

    def add_doc(kind: int, ref: str, text: str, line: int = 0, weight: float | None = None) -> int:
        idx = len(docs)
        docs.append([kind, ref, text, line, KIND_WEIGHT[kind] if weight is None else weight])
        for tok in set(tokenize(text)):
            postings.setdefault(tok, set()).add(idx)
        return idx

    def add_alias(doc_id: int, text: str) -> None:
        """Дописать постинги в существующий документ (синоним, перевод)."""
        for tok in set(tokenize(text)):
            postings.setdefault(tok, set()).add(doc_id)

    # --- spec-node: заголовки всех пунктов ---
    node_doc: dict[str, int] = {}
    flat: list[dict] = []
    # Родитель по номеру пункта: `11.8.3.1` → `11.8.3 Class [Class]`. Нужен
    # служебным подзаголовкам: их документ называется именем родителя.
    parent_of: dict[str, dict] = {}

    def walk(node: dict, parent: dict | None = None):
        flat.append(node)
        if parent is not None and node["number"]:
            parent_of[node["number"]] = parent
        for child in node["children"]:
            walk(child, node)

    for sec in tree["sections"]:
        walk(sec)
    for node in flat:
        if not node["number"] or not indexable(node):
            continue
        title = node["title"]  # номер уже лежит в ref, в тексте он не нужен
        # Пункт про понятие (уровень 2–3) весит больше глубокого подпункта.
        w = KIND_WEIGHT[0] * (1.15 if node["level"] <= 3 else 1.0)
        node_doc[node["number"]] = add_doc(0, node["number"], title, node["lines"][0], w)

    # --- spec-para: абзацы пояснительных подразделов ---
    para_count = 0
    for node in flat:
        if not node["number"] or node["level"] > 4:
            continue
        # Служебные подзаголовки идут отдельным проходом ниже: у них другое
        # имя документа и другой вес, иначе «Description» попал бы в индекс
        # дважды — голым абзацем и абзацем с именем родителя.
        if node["title"].lower() in SUBTITLE_TITLES:
            continue
        if "Descriptions" in (node.get("section") or "") or "Descriptions" in node["title"]:
            continue
        base_title = node["title"].lower().split("(")[0].strip()
        if base_title in SKIP_TITLES:
            continue
        if base_title not in PROSE_TITLES:
            continue
        path = SPEC_MD / node["file"]
        lines = path.read_text(encoding="utf-8").split("\n")
        start, end = node["lines"]
        # Только собственный текст узла: до первого дочернего заголовка.
        first_child = min((c["lines"][0] for c in node["children"]), default=end + 1)
        own = "\n".join(lines[start - 1:first_child - 1])
        for para, off in split_paragraphs(own):
            if len(para) < 60:
                continue
            snippet = para.replace("\n", " ")
            if len(snippet) > 96:
                snippet = snippet[:93].rstrip() + "…"
            add_doc(1, node["number"], snippet, start + off, KIND_WEIGHT[1])
            para_count += 1

    # --- spec-para: проза служебных подзаголовков ИМЕНЕМ РОДИТЕЛЯ ---
    #
    # «Description», «Association Ends», «Operations», «Attributes» — не
    # заголовки, а разделы описания метакласса: сам заголовок ничего не
    # значит, поэтому документа с ним нет (indexable его отбрасывает), а
    # проза под ним объясняет метакласс. Документ называется именем
    # родителя: «Description — Class», «Association Ends — Association» —
    # так запрос «association ends» находит концы ассоциации, а не слово
    # «description», и в выдаче видно, о каком метаклассе речь.
    subtitle_count = 0
    for node in flat:
        if not node["number"] or node["title"].lower() not in SUBTITLE_TITLES:
            continue
        parent = parent_of.get(node["number"])
        if parent is None:
            continue
        name = metaclass_name(parent["title"])
        path = SPEC_MD / node["file"]
        lines = path.read_text(encoding="utf-8").split("\n")
        start, end = node["lines"]
        first_child = min((c["lines"][0] for c in node["children"]), default=end + 1)
        own = "\n".join(lines[start - 1:first_child - 1])
        for para, off in split_entries(own):
            if len(para) < 60:
                continue
            snippet = para.replace("\n", " ")
            if len(snippet) > 96:
                snippet = snippet[:93].rstrip() + "…"
            # Имя — в тексте документа, а не в отдельном поле: строку выдачи
            # читалка рисует из text, и «Description — Class: …» читается без
            # правок reference.js (чужая зона). Вес ниже обычного абзаца —
            # см. SUBTITLE_WEIGHT.
            add_doc(1, node["number"], f"{node['title']} — {name}: {snippet}",
                    start + off, SUBTITLE_WEIGHT)
            subtitle_count += 1

    # --- rule ---
    for rule in rules:
        text = " ".join(filter(None, [
            rule["id"],
            rule["source"].get("constraint", ""),
            rule.get("message", ""),
            rule.get("hint", ""),
            rule["source"]["metaclass"],
        ]))
        add_doc(2, rule["id"], text)
    # Слой практики — тем же видом `rule`: на полке он открывается той же
    # статьёй, только без пункта. Пункта у совета нет вовсе, поэтому в текст
    # идёт rationale — по нему совет и ищут («почему это запах»).
    for rule in practice:
        text = " ".join(filter(None, [
            rule["id"],
            rule.get("message", ""),
            rule.get("hint", ""),
            rule.get("rationale", ""),
        ]))
        add_doc(2, rule["id"], text)

    # --- stereotype ---
    root = ET.parse(STEREOTYPES).getroot()
    for group in root:
        for st in group.iter("Stereotype"):
            name = st.get("name") or ""
            base = st.get("baseType") or ""
            text = " ".join([name, normalize_spaces(name), base, normalize_spaces(base)])
            add_doc(3, name, text)

    # --- shape / connector ---
    for kind, table, kind_id in (("shape", notation["shapes"], 4), ("connector", notation["connectors"], 5)):
        for key, data in table.items():
            rec = xref["notationToClause"]["shapes" if kind == "shape" else "connectors"].get(key, {})
            clause = rec.get("clause")
            parts = [key, normalize_spaces(key), data.get("label") or "", data.get("hint") or ""]
            if data.get("stereotype"):
                parts.append(data["stereotype"])
            if clause:
                parts.append(clause["title"])
            doc_id = add_doc(kind_id, key, " ".join(parts))
            # Русский label и hint привязывают фигуру к пункту стандарта.
            if clause and rec.get("confidence") in ("exact", "derived"):
                target = node_doc.get(clause["number"])
                if target is not None:
                    add_alias(target, " ".join([data.get("label") or "", data.get("hint") or ""]))
                else:
                    problems.append(f"{kind} {key}: пункта {clause['number']} нет среди spec-node")

    # --- exercise ---
    ex_re = re.compile(r"^#{2,4}\s+Упражнение\s+(\d+(?:\.\d+)*(?:\.[A-Z])?)\.\s*(.+?)\s*$")
    for i, line in enumerate(TUTORIAL.read_text(encoding="utf-8").split("\n"), 1):
        m = ex_re.match(line)
        if m:
            add_doc(6, m.group(1), f"Упражнение {m.group(1)} {m.group(2)}", i)

    # --- plantuml ---
    for diagram, data in plantuml["diagrams"].items():
        for c in data["constructs"]:
            # Ищут по синтаксису («class Foo»), а не по внутреннему id;
            # id лежит в ref, подпись диаграммы — в тексте для контекста.
            text = " ".join(filter(None, [
                c.get("syntax", ""), c.get("note", "") or "", data.get("title", ""),
            ]))
            add_doc(7, c.get("id", ""), text)

    # --- якоря понятий ---
    #
    # Якорь — это пункт, где понятие ОПРЕДЕЛЕНО (а не просто упомянуто), и его
    # русское название. Якоря двух родов:
    #   * из нотации: пункт берётся из crossrefs.json (там он найден поиском по
    #     заголовкам, а не назначен рукой);
    #   * ручные, для понятий, которых нет среди фигур палитры (квалификатор,
    #     кратность, сторож…). У каждого ручного якоря записано основание.
    # Поиск по якорю поднимает документы этого пункта: справочник должен
    # открывать статью о понятии, а не первое упоминание слова.
    anchors = []
    seen_anchor = set()
    anchor_by_term: dict[str, dict] = {}
    for kind, table in (("shape", "shapes"), ("connector", "connectors")):
        for key, rec in xref["notationToClause"][table].items():
            clause = rec.get("clause")
            if not clause or rec.get("confidence") == "guess":
                continue
            term = (rec.get("metaclass") or {}).get("title") or key
            term = re.sub(r"\s*\[(?:Abstract\s+)?[A-Za-z]+\]$", "", term).strip().lower()
            # Один метакласс может стоять за несколькими фигурами: Lifeline —
            # это и lifeline, и actorLifeline, и шкала времени. Якорь у них
            # один, у первой по порядку нотации; остальные перечисляются в
            # alsoFrom, чтобы поздняя фигура не перебивала адрес ранней.
            if term in anchor_by_term:
                anchor_by_term[term]["alsoFrom"].append(key)
                continue
            rec_anchor = {
                "term": term,
                "ru": rec.get("label") or "",
                "aliases": sorted({key.lower(), rec.get("label", "").lower()} - {""}),
                "clause": clause["number"],
                "confidence": rec.get("confidence"),
                "alsoFrom": [],
                "basis": "crossrefs.json: пункт найден по заголовку спецификации",
            }
            anchor_by_term[term] = rec_anchor
            anchors.append(rec_anchor)
            seen_anchor.add(term)

    for term, ru, clause, why in MANUAL_ANCHORS:
        if term in seen_anchor:
            continue
        anchors.append({
            "term": term,
            "ru": ru,
            "aliases": [],
            "clause": clause,
            "confidence": "derived",
            "alsoFrom": [],
            "basis": why,
        })

    # --- глоссарий ---
    glossary = dict(xref.get("ruEnGlossary", {}))
    # Русские названия фигур — тоже мост между языками, и он выведен, а не
    # написан рукой: русская подпись фигуры и её английский метакласс.
    for a in anchors:
        if a["ru"] and a["term"] and a["ru"].lower() not in glossary:
            glossary[a["ru"].lower()] = a["term"]

    # --- сериализация ---
    total = len(docs)
    df = {tok: len(ids) for tok, ids in postings.items()}
    post_out = {tok: ",".join(base36(i) for i in sorted(ids)) for tok, ids in sorted(postings.items())}

    payload = {
        "schema": SCHEMA,
        "generator": "material/reference-content/build_search_index.py",
        "kinds": KINDS,
        "docFields": ["kind", "ref", "text", "line", "weight"],
        "ranking": {
            "idf": "ln(1 + N/df): N — документов, df — документов с термином",
            "base": "сумма по терминам запроса idf(термин) * weight документа",
            "nameBonus": "документ-запись (не абзац): заголовок равен термину +14*weight, начинается с него +6, содержит +2",
            "anchorBonus": "если запрос называет понятие из anchors: +20*weight документам его пункта и подпунктов, но только тем, где термин уже найден; на запрос из нескольких слов не срабатывает",
            "phraseBonus": "если запрос целиком входит в текст документа: +8*weight",
            "subtitleName": "абзац с составным именем «Description — Class: …»: запрос совпал с именем +14*weight, начал его +6, вошёл в него +2; считается один раз на запрос",
            "prefix": "термин запроса и термин индекса совпадают по началу при длине >= 4 и разнице длин <= 3 (русские окончания)",
            "expand": "термин расширяется по glossary (русский → английский) и по anchors",
            "kindPriority": "множитель вида: пункт стандарта 1.25, правило 1.1, фигура 0.95, PlantUML 0.9",
        },
        "stats": {
            "docs": total,
            "docsByKind": {KINDS[k]: sum(1 for d in docs if d[0] == k) for k in range(len(KINDS))},
            # `paragraphs` — все документы вида spec-para, как и раньше: читалка
            # показывает это число на полке «Спецификация», и менять его смысл
            # (только пояснительные подразделы) значило бы врать в интерфейсе.
            "paragraphs": para_count + subtitle_count,
            # Из них проза служебных подзаголовков — отдельным числом, чтобы
            # было видно, откуда взялся прирост.
            "subtitleParagraphs": subtitle_count,
            "terms": len(post_out),
            "postings": sum(len(v) for v in postings.values()),
            "idfSample": round(math.log(1 + total / max(1, df.get("association", 1))), 3),
        },
        "glossary": glossary,
        "anchors": anchors,
        "docs": docs,
        "postings": post_out,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    size = OUT.stat().st_size
    # Разбор размера: что сколько занимает.
    docs_json = len(json.dumps(docs, ensure_ascii=False, separators=(",", ":")))
    post_json = len(json.dumps(post_out, ensure_ascii=False, separators=(",", ":")))
    gl_json = len(json.dumps(glossary, ensure_ascii=False, separators=(",", ":")))
    print(f"документов: {total} {payload['stats']['docsByKind']}")
    print(f"проза служебных подзаголовков: {subtitle_count} документов (абзацы пояснительных: {para_count})")
    print(f"терминов: {len(post_out)}, постингов: {payload['stats']['postings']}")
    print(f"размер: {size} Б (docs {docs_json} Б, postings {post_json} Б, glossary {gl_json} Б)")
    if problems:
        print(f"проблем: {len(problems)}", file=sys.stderr)
        for p in problems[:20]:
            print("  -", p, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
