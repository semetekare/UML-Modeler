#!/usr/bin/env python3
"""Разбор профиля стереотипов Visual Paradigm: что в нём действительно дублируется.

Читает `material/stereotypes.xml` и пишет `material/stereotype-audit/report.json`.

Зачем. В профиле 428 записей `<Stereotype>` и 311 различных имён. «Дубли» — это
три разных явления, которые нельзя смешивать:

  1. одна и та же запись объявлена дважды, в ApplicationStereotypes и в
     ProjectStereotypes (настоящие дубли: элемент один, объявлений два);
  2. одно имя на нескольких baseType (НЕ дубли: UML 2.5.1 §12.3.3.4 разрешает
     стереотипу расширять несколько метаклассов, и VP пишет это N записями);
  3. имена, которых нет в прикладном профиле вовсе (только в проектном).

Пиктограмма крепится к записи через `iconPath`, поэтому дубль = два указателя на
один рисунок. Дедупликация обязана оставить ровно один.

Только stdlib: `xml.etree.ElementTree`, `json`, `hashlib`, `re`, `pathlib`.
Ничего не устанавливается и ни во что не пишется, кроме `report.json`.

Отчёт детерминирован: ни времени, ни абсолютных путей. Два прогона на одном и
том же XML дают побайтово одинаковый файл.

Запуск:

    python3 material/stereotype-audit/audit.py

Код возврата 1, если измеренное не совпало с ожидаемым (см. EXPECTED ниже) —
чтобы числа в документации нельзя было тихо разъехаться с данными.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = ROOT / "material" / "stereotypes.xml"
ICON_MAP = ROOT / "material" / "stereotype-icons.json"
APPLICABILITY_JS = ROOT / "app" / "src" / "io" / "stereotypes.js"
NOTATION_JSON = ROOT / "app" / "notation" / "uml.json"
OUT = Path(__file__).resolve().parent / "report.json"

SCOPES = ("ApplicationStereotypes", "ProjectStereotypes")

# Величины, которые уже опубликованы в документации. Расхождение — ошибка
# прогона, а не «новые данные»: профиль мы не правим, он приходит извне.
EXPECTED = {
    "records": 428,
    "records_by_scope": {"ApplicationStereotypes": 405, "ProjectStereotypes": 23},
    "distinct_names": 311,
    "distinct_name_base_pairs": 410,
    "distinct_base_types": 97,
    "duplicate_pairs": 18,
    "names_with_several_records": 57,
    "names_with_several_base_types": 43,
    "project_only_names": 4,
    "icon_paths_nonempty": 23,
    "normalized_names": 304,
    "spelling_groups": 7,
    "spelling_defect_groups": 3,
    "definitions_after_spelling_merge": 407,
}

TV_TYPES = {"0": "text", "1": "int", "2": "enum", "3": "longtext", "4": "text"}


# --------------------------------------------------------------- утилиты


def canon(elem: ET.Element) -> str:
    """Каноническая строка поддерева: атрибуты по алфавиту, `id` выброшен.

    Нужна как доказательство идентичности: две записи равны тогда и только
    тогда, когда равны их канонические строки. `id` выброшен намеренно —
    у дублей он как раз разный, и именно это надо доказать отдельно.
    """
    attrs = " ".join(
        f'{k}="{v}"' for k, v in sorted(elem.attrib.items()) if k != "id"
    )
    inner = "".join(canon(с) for с in elem)
    return f"<{elem.tag} {attrs}>{inner}</{elem.tag}>"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def strip_ids(elem: ET.Element) -> None:
    """Убирает `id` во всём поддереве — они у дублей разные по определению."""
    for node in elem.iter():
        node.attrib.pop("id", None)


def tagged_defs(st: ET.Element) -> list[dict]:
    """Определения tagged values в порядке файла: имя, тип, умолчание, значения."""
    out = []
    for td in st.iter("TaggedValueDefinition"):
        out.append(
            {
                "name": td.get("name") or "",
                "type": TV_TYPES.get(td.get("type") or "", td.get("type") or ""),
                "default": td.get("defaultValue") or "",
                "documentation": td.get("documentation") or "",
                "values": [v.get("value") or "" for v in td.iter("ValueSpecification")],
            }
        )
    return out


def tagged_signature(st: ET.Element, sort_values: bool = False) -> str:
    """Подпись набора tagged-определений: порядок определений сохраняется.

    `sort_values` сортирует значения перечислений — так отличается «набор
    другой» от «набор тот же, значения перечислены в другом порядке».
    """
    rows = []
    for d in tagged_defs(st):
        values = sorted(d["values"]) if sort_values else d["values"]
        rows.append(
            (d["name"], d["type"], d["default"], d["documentation"], tuple(values))
        )
    return json.dumps(rows, ensure_ascii=False, sort_keys=False)


def formats_of(st: ET.Element) -> list[str]:
    """`<Formats>` — оформление записи в VP (заливка, шрифт). Не UML-смысл, но
    часть объявления: у двух «одинаковых» записей оно тоже должно совпадать."""
    out = []
    for fmt in st.findall("Formats"):
        out.append(canon(fmt))
    return out


def normalize_name(name: str) -> str:
    """Имя без различий написания: нижний регистр, без пробелов и разделителей.

    `executionEnvironment`, `execution environment` и `execution_environment`
    дают одно и то же. Именно этот ключ показывает повторы, которых не видит
    сравнение точных имён, — и именно он опасен: пользователь видит в списке
    два стереотипа, которые означают одно.
    """
    return re.sub(r"[\s_\-]+", "", name or "").lower()


def spelling_variants(
    records: list[tuple[str, ET.Element]], rows: list[dict]
) -> dict:
    """Группы имён, различающихся только написанием (регистр, CamelCase, пробелы).

    Три исхода у каждой группы, и они неравноценны:

    * `same_scope_same_base_type` — один стереотип записан дважды разными
      буквами **в одной области и на одном baseType**. Это дефект профиля:
      сравнение точных имён его не видит, а пользователь видит два пункта;
    * `same_base_type_across_scopes` — вариант написания плюс дубль областей;
    * `different_base_type` — написание совпало случайно, стереотипы разные
      (`default` на `Operation` и `Default` на `State2`).
    """
    groups: dict[str, list[tuple[str, ET.Element]]] = defaultdict(list)
    for scope, st in records:
        groups[normalize_name(st.get("name") or "")].append((scope, st))

    items = []
    for key, group in sorted(groups.items()):
        spellings = sorted({st.get("name") or "" for _, st in group})
        if len(spellings) < 2:
            continue
        # Одна и та же область + один и тот же baseType = настоящий дефект.
        per_scope_base: dict[tuple[str, str], list[str]] = defaultdict(list)
        for scope, st in group:
            per_scope_base[(scope, st.get("baseType") or "")].append(st.get("name") or "")
        defects = {
            f"{scope} / {base}": sorted(set(names))
            for (scope, base), names in per_scope_base.items()
            if len(set(names)) > 1
        }
        bases = sorted({st.get("baseType") or "" for _, st in group})
        kind = (
            "same_scope_same_base_type"
            if defects
            else "different_base_type"
            if len(bases) > 1
            else "same_base_type_across_scopes"
        )
        items.append(
            {
                "normalized": key,
                "spellings": spellings,
                "records": len(group),
                "base_types": bases,
                "scopes": sorted({"application" if s == "ApplicationStereotypes" else "project" for s, _ in group}),
                "defects_same_scope_same_base_type": defects,
                "kind": kind,
                "verdict": {
                    "same_scope_same_base_type": "дефект: один стереотип, два написания в одной области",
                    "same_base_type_across_scopes": "вариант написания плюс дубль прикладного и проектного объявления",
                    "different_base_type": "не дефект: разные baseType, совпадение написания случайно",
                }[kind],
                "entries": [
                    {
                        "spelling": st.get("name") or "",
                        "base_type": st.get("baseType") or "",
                        "scope": "application" if scope == "ApplicationStereotypes" else "project",
                        "id": st.get("id") or "",
                        "icon_path": (st.get("iconPath") or "").strip(),
                        "tagged_defs": len(tagged_defs(st)),
                        "documentation": st.get("documentation") or "",
                    }
                    for scope, st in group
                ],
            }
        )

    defects = [i for i in items if i["kind"] == "same_scope_same_base_type"]
    exact = {r["name"] for r in rows}
    normalized = {normalize_name(r["name"]) for r in rows}
    return {
        "normalization": "нижний регистр, пробелы/_/- удалены",
        "exact_spellings": len(exact),
        "normalized_names": len(normalized),
        "extra_spellings": len(exact) - len(normalized),
        "groups": len(items),
        "defect_groups": len(defects),
        "defect_records": sum(len(i["defects_same_scope_same_base_type"]) for i in defects),
        "meaning": "имена, различающиеся только регистром или разбиением на слова; "
        "дефект — когда совпали и область, и baseType",
        "items": items,
        # Имена внутри одного стереотипа: те же повторы, но в tagged values.
        "tagged_def_name_collisions": tagged_name_collisions(records),
        "enum_value_collisions": enum_value_collisions(records),
    }


def tagged_name_collisions(records: list[tuple[str, ET.Element]]) -> list[dict]:
    """Два tagged-определения с именами, различающимися только написанием."""
    out = []
    for scope, st in records:
        seen: dict[str, list[str]] = defaultdict(list)
        for td in st.iter("TaggedValueDefinition"):
            seen[normalize_name(td.get("name") or "")].append(td.get("name") or "")
        for key, names in seen.items():
            if len(set(names)) > 1:
                out.append(
                    {
                        "stereotype": st.get("name") or "",
                        "base_type": st.get("baseType") or "",
                        "scope": "application" if scope == "ApplicationStereotypes" else "project",
                        "names": sorted(set(names)),
                    }
                )
    return out


def enum_value_collisions(records: list[tuple[str, ET.Element]]) -> list[dict]:
    """Два значения перечисления с написанием, различающимся только регистром."""
    out = []
    for scope, st in records:
        for td in st.iter("TaggedValueDefinition"):
            seen: dict[str, list[str]] = defaultdict(list)
            for v in td.iter("ValueSpecification"):
                seen[normalize_name(v.get("value") or "")].append(v.get("value") or "")
            for key, values in seen.items():
                if len(set(values)) > 1:
                    out.append(
                        {
                            "stereotype": st.get("name") or "",
                            "tagged_def": td.get("name") or "",
                            "values": sorted(set(values)),
                        }
                    )
    return out


def notation_vs_profile(path: Path, profile_names: set[str]) -> dict:
    """Сверить умолчания нотации (`stereotype`/`keyword`) с именами профиля.

    Нотация пишет стереотип в элемент при создании. Если написания разошлись,
    элемент получает имя, которого профиль не знает: подпись `«...»` рисуется,
    а tagged-определения и пиктограмма не находятся.
    """
    if not path.exists():
        return {"readable": False, "note": f"{path.name} не найден"}
    try:
        pkg = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"readable": False, "note": f"{path.name} не разбирается как JSON"}

    by_norm: dict[str, list[str]] = defaultdict(list)
    for name in profile_names:
        by_norm[normalize_name(name)].append(name)

    rows = []
    for group in ("shapes", "connectors"):
        for kind, defn in (pkg.get(group) or {}).items():
            for field in ("stereotype", "keyword"):
                value = defn.get(field)
                if not value:
                    continue
                variants = sorted(by_norm.get(normalize_name(value), []))
                rows.append(
                    {
                        "kind": kind,
                        "group": group,
                        "field": field,
                        "value": value,
                        "in_profile": value in profile_names,
                        # Написание разошлось, но понятие в профиле есть —
                        # ровно та ошибка, которую ищем.
                        "profile_spellings": variants,
                        "spelling_mismatch": value not in profile_names and bool(variants),
                    }
                )
    mismatched = [r for r in rows if r["spelling_mismatch"]]
    missing = [r for r in rows if not r["in_profile"] and not r["profile_spellings"]]
    return {
        "readable": True,
        "source": "app/notation/uml.json → shapes/connectors[].stereotype|keyword",
        "checked": len(rows),
        "in_profile": sum(1 for r in rows if r["in_profile"]),
        "spelling_mismatch": len(mismatched),
        "absent_from_profile": len(missing),
        "mismatched": mismatched,
        "absent": missing,
        "items": rows,
    }


def record_row(scope: str, st: ET.Element) -> dict:
    return {
        "scope": "application" if scope == "ApplicationStereotypes" else "project",
        "container": scope,
        "id": st.get("id") or "",
        "name": st.get("name") or "",
        "base_type": st.get("baseType") or "",
        "documentation": st.get("documentation") or "",
        "icon_path": (st.get("iconPath") or "").strip(),
        "abstract": st.get("abstract") == "true",
        "leaf": st.get("leaf") == "true",
        "root": st.get("root") == "true",
        "tagged_defs": len(tagged_defs(st)),
        "has_formats": bool(formats_of(st)),
    }


# ------------------------------------------------------------ применение


def parse_applicability(path: Path) -> dict | None:
    """`APPLICABILITY` из app/src/io/stereotypes.js — вид элемента → baseType.

    Разбирается регулярным выражением, потому что stdlib Python не умеет JS.
    Если файл переехал или блок переименован — возвращается None, и отчёт
    честно говорит «сверить нельзя», а не печатает ноль.
    """
    if not path.exists():
        return None
    src = path.read_text(encoding="utf-8")
    block = re.search(r"export const APPLICABILITY\s*=\s*\{(.*?)\n\};", src, re.S)
    if not block:
        return None
    kinds: dict[str, list[str]] = {}
    for line in block.group(1).splitlines():
        line = line.split("//")[0].strip()
        m = re.match(r"([A-Za-z_$][\w$]*)\s*:\s*\[(.*?)\]\s*,?\s*$", line)
        if not m:
            continue
        kinds[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))
    return kinds or None


def load_icon_map(path: Path) -> dict | None:
    """`material/stereotype-icons.json`: iconPath → ассет и рисунок (`glyph`).

    `glyph` — машинная запись того, что в docs/PICTOGRAMS.md установлено
    попиксельной сверкой: несколько `iconPath` могут давать один рисунок.
    Сам архив GIF в проект не входит, поэтому «один рисунок» здесь берётся из
    уже проверенной записи, а не измеряется заново.
    """
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    rows = {}
    for icon_path, row in (raw.get("map") or {}).items():
        if not row.get("asset"):
            continue
        rows[icon_path] = {
            "asset": row["asset"],
            "kind": row.get("kind") or "badge",
            "glyph": row.get("glyph") or row["asset"],
            "size": row.get("size") or [16, 16],
        }
    return rows or None


# ------------------------------------------------------------------ main


def main() -> int:
    tree = ET.parse(PROFILE)
    root = tree.getroot()
    problems: list[str] = []

    records: list[tuple[str, ET.Element]] = []
    by_scope: Counter[str] = Counter()
    for scope in SCOPES:
        section = root.find(scope)
        if section is None:
            problems.append(f"в профиле нет раздела {scope}")
            continue
        for st in section.findall("Stereotype"):
            records.append((scope, st))
            by_scope[scope] += 1

    rows = [record_row(scope, st) for scope, st in records]
    by_name: dict[str, list[dict]] = defaultdict(list)
    by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        by_name[row["name"]].append(row)
        by_pair[(row["name"], row["base_type"])].append(row)

    names = set(by_name)
    base_types = {row["base_type"] for row in rows}

    # --- 1. настоящие дубли: одна пара (имя, baseType) объявлена дважды -----
    pair_groups = {k: v for k, v in by_pair.items() if len(v) > 1}
    duplicate_pairs = []
    for (name, base_type), group in sorted(pair_groups.items()):
        # Порядок записей — как в файле: прикладная идёт первой.
        elems = [
            st for scope, st in records
            if st.get("name") == name and st.get("baseType") == base_type
        ]
        digests = [digest(canon(st)) for st in elems]
        docs = [st.get("documentation") or "" for st in elems]
        icons = [(st.get("iconPath") or "").strip() for st in elems]
        tv_sig = [tagged_signature(st) for st in elems]
        tv_sig_sorted = [tagged_signature(st, sort_values=True) for st in elems]
        fmts = [formats_of(st) for st in elems]
        ids = [st.get("id") or "" for st in elems]
        scopes = [
            "application" if scope == "ApplicationStereotypes" else "project"
            for scope, st in records
            if st.get("name") == name and st.get("baseType") == base_type
        ]
        same = {
            "canonical_without_id": len(set(digests)) == 1,
            "documentation": len(set(docs)) == 1,
            "tagged_defs": len(set(tv_sig)) == 1,
            "tagged_defs_ignoring_value_order": len(set(tv_sig_sorted)) == 1,
            "icon_path": len(set(icons)) == 1,
            "formats": len(set(map(tuple, fmts))) == 1,
        }
        differences = []
        if not same["canonical_without_id"]:
            if not same["tagged_defs"] and same["tagged_defs_ignoring_value_order"]:
                differences.append(
                    "порядок значений перечислений в tagged-определениях"
                )
            for field, label in (
                ("documentation", "документация"),
                ("tagged_defs", "набор tagged-определений"),
                ("icon_path", "iconPath"),
                ("formats", "оформление <Formats>"),
            ):
                if not same[field] and not (
                    field == "tagged_defs" and len(differences) == 1
                ):
                    differences.append(label)
            if not differences:
                differences.append("неизвестное расхождение вне проверяемых полей")
        duplicate_pairs.append(
            {
                "name": name,
                "base_type": base_type,
                "records": [
                    {
                        "scope": scopes[i],
                        "id": ids[i],
                        "icon_path": icons[i],
                        "tagged_defs": len(tagged_defs(elems[i])),
                        "canonical_sha256": digests[i],
                    }
                    for i in range(len(elems))
                ],
                "ids_distinct": len(set(ids)) == len(ids),
                "declared_in_both_scopes": sorted(set(scopes))
                == ["application", "project"],
                "identical": same,
                "differences": differences,
                "verdict": (
                    "точный дубль: объявление одно, записей две"
                    if same["canonical_without_id"]
                    else "совпадает во всём, кроме: " + ", ".join(differences)
                    if same["tagged_defs_ignoring_value_order"]
                    else "НЕ дубль: содержимое различается"
                ),
            }
        )

    # --- 2. одно имя на нескольких baseType ---------------------------------
    multi_base = {
        name: group
        for name, group in by_name.items()
        if len({r["base_type"] for r in group}) > 1
    }
    multi_base_items = []
    for name, group in sorted(multi_base.items()):
        per_base = []
        for base_type in sorted({r["base_type"] for r in group}):
            subset = [r for r in group if r["base_type"] == base_type]
            elems = [
                st for scope, st in records
                if st.get("name") == name and st.get("baseType") == base_type
            ]
            # Подпись — множество различных наборов, а не список по записям:
            # дубль прикладного объявления в проектном не делает набор другим.
            sigs = sorted({tagged_signature(st) for st in elems})
            per_base.append(
                {
                    "base_type": base_type,
                    "records": len(subset),
                    "scopes": sorted({r["scope"] for r in subset}),
                    "tagged_defs": max(r["tagged_defs"] for r in subset),
                    "has_tagged_defs": any(r["tagged_defs"] for r in subset),
                    "tagged_sha256": digest("|".join(sigs)),
                    "icon_paths": sorted({r["icon_path"] for r in subset if r["icon_path"]}),
                }
            )
        distinct_tagged = len({row["tagged_sha256"] for row in per_base})
        multi_base_items.append(
            {
                "name": name,
                "base_types": [row["base_type"] for row in per_base],
                "base_type_count": len(per_base),
                "records": len(group),
                "extension": per_base,
                "tagged_defs_distinct_across_base_types": distinct_tagged,
                "tagged_defs_note": (
                    "определения у всех baseType одни и те же"
                    if distinct_tagged == 1 and any(r["has_tagged_defs"] for r in per_base)
                    else "определения различаются по baseType"
                    if distinct_tagged > 1
                    else "определений нет ни у одного baseType"
                ),
            }
        )

    # Сводка по tagged-определениям: сколько имён сливается без потерь.
    with_defs = [i for i in multi_base_items if any(e["has_tagged_defs"] for e in i["extension"])]
    differing = [i for i in multi_base_items if i["tagged_defs_distinct_across_base_types"] > 1]
    multi_base_summary = {
        "names": len(multi_base_items),
        "records": sum(i["records"] for i in multi_base_items),
        "names_without_any_tagged_defs": len(multi_base_items) - len(with_defs),
        "names_with_identical_tagged_defs": len(with_defs) - len(differing),
        "names_with_differing_tagged_defs": len(differing),
        "differing": [i["name"] for i in differing],
        "merge_loses_nothing": len(multi_base_items) - len(differing),
        "note": "слияние N записей в одно определение с baseTypes[] безопасно для "
        "всех, кроме differing: у них наборы tagged-определений различаются",
    }

    # --- 3. имена только в проектном профиле --------------------------------
    project_only = sorted(
        name
        for name, group in by_name.items()
        if all(r["scope"] == "project" for r in group)
    )
    project_only_items = []
    for name in project_only:
        for row in by_name[name]:
            project_only_items.append(
                {
                    "name": name,
                    "base_type": row["base_type"],
                    "id": row["id"],
                    "tagged_defs": row["tagged_defs"],
                    "icon_path": row["icon_path"],
                    # Имя совпадает с собственным baseType: стереотип повторяет
                    # встроенное слово UML, а не добавляет термин.
                    "name_equals_base_type": name.lower() == row["base_type"].lower(),
                    "is_uml_keyword": name.lower()
                    in {
                        "include",
                        "extend",
                        "import",
                        "substitute",
                        "merge",
                        "trace",
                        "refine",
                        "use",
                    },
                }
            )

    # --- 4. варианты написания: регистр и CamelCase --------------------------
    # Третий вид повтора, которого не видно при сравнении точных имён:
    # `executionEnvironment` и `execution environment` — одно понятие, две
    # записи, один и тот же baseType в одной и той же области. Ключ точного
    # имени их разводит, ключ по нормализации — сводит.
    spelling = spelling_variants(records, rows)
    by_norm_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        by_norm_pair[(normalize_name(row["name"]), row["base_type"])].append(row)

    # --- 5. сколько стереотипов после дедупликации --------------------------
    # Правило А: ключ (имя, baseType) — расширения считаются по отдельности.
    # Правило Б: ключ имя — один стереотип с несколькими расширениями.
    dedup = {
        "rule_a_pair_key": {
            "key": "(name, baseType)",
            "definitions": len(by_pair),
            "extensions": len(by_pair),
            "dropped": len(rows) - len(by_pair),
            "note": "стереотип с N расширениями — N определений; так его и применит пользователь",
        },
        "rule_a_normalized_pair_key": {
            "key": "(normalized name, baseType)",
            "definitions": len(by_norm_pair),
            "extensions": len(by_norm_pair),
            "dropped": len(rows) - len(by_norm_pair),
            "note": "то же правило, но варианты написания считаются одним именем; "
            f"на {len(by_pair) - len(by_norm_pair)} определений меньше",
        },
        "rule_b_name_key": {
            "key": "name",
            "definitions": len(names),
            "extensions": len(by_pair),
            "dropped": len(rows) - len(names),
            "note": "стереотип один, расширений N (UML 2.5.1 §12.3.3.4); N>1 у "
            + str(len(multi_base))
            + " имён",
        },
        "rule_b_normalized_name_key": {
            "key": "normalized name",
            "definitions": len({normalize_name(r["name"]) for r in rows}),
            "extensions": len(by_norm_pair),
            "dropped": len(rows) - len({normalize_name(r["name"]) for r in rows}),
            "note": "один стереотип, N расширений, варианты написания слиты",
        },
    }

    # --- 5. пиктограммы ------------------------------------------------------
    icon_rows = [r for r in rows if r["icon_path"]]
    icon_by_path: dict[str, list[dict]] = defaultdict(list)
    for row in icon_rows:
        icon_by_path[row["icon_path"]].append(row)
    icon_map = load_icon_map(ICON_MAP)
    shared_paths = {
        path: group for path, group in icon_by_path.items() if len(group) > 1
    }
    icons = {
        "records_with_nonempty_icon_path": len(icon_rows),
        "distinct_icon_paths": len(icon_by_path),
        "paths_used_by_several_records": [
            {
                "icon_path": path,
                "records": len(group),
                "stereotypes": [
                    {"name": r["name"], "base_type": r["base_type"], "scope": r["scope"], "id": r["id"]}
                    for r in group
                ],
                "reason": (
                    "дубль прикладного и проектного объявления"
                    if len({r["scope"] for r in group}) == 2
                    else "разные стереотипы делят один рисунок"
                ),
            }
            for path, group in sorted(shared_paths.items())
        ],
        "paths_used_by_several_records_after_dedup": [
            {
                "icon_path": path,
                "stereotypes": [
                    {"name": r["name"], "base_type": r["base_type"]}
                    for r in group
                ],
            }
            for path, group in sorted(shared_paths.items())
            if len({(r["name"], r["base_type"]) for r in group}) > 1
        ],
        "map_file": ICON_MAP.name,
        "map_readable": icon_map is not None,
    }
    if icon_map:
        by_glyph: dict[str, list[str]] = defaultdict(list)
        for path, row in icon_map.items():
            by_glyph[row["glyph"]].append(path)
        icons["map_keys"] = len(icon_map)
        icons["distinct_drawings"] = len(by_glyph)
        icons["drawings"] = [
            {
                "glyph": glyph,
                "asset": sorted({icon_map[p]["asset"] for p in paths})[0],
                "icon_paths": sorted(paths),
                "stereotypes": [
                    {"name": r["name"], "base_type": r["base_type"], "scope": r["scope"]}
                    for r in icon_rows
                    if r["icon_path"] in paths
                ],
            }
            for glyph, paths in sorted(by_glyph.items())
        ]
        profile_paths = set(icon_by_path)
        icons["map_covers_profile"] = profile_paths == set(icon_map)
        icons["profile_paths_missing_from_map"] = sorted(profile_paths - set(icon_map))
        icons["map_paths_not_in_profile"] = sorted(set(icon_map) - profile_paths)
        icons["by_kind"] = dict(
            Counter(icon_map[p]["kind"] for p in icon_map)
        )

    # --- 6. умолчания нотации против имён профиля ---------------------------
    # Нотация (`app/notation/uml.json`) сама пишет стереотип в элемент при
    # создании: `executionEnvironment` — CamelCase, `include` — нижним
    # регистром. Если профиль знает другое написание, элемент получает имя,
    # которого в профиле нет, и `s.name === it.stereotype` в инспекторе
    # промахивается.
    notation_defaults = notation_vs_profile(NOTATION_JSON, {r["name"] for r in rows})

    # --- 7. достижимость в приложении ---------------------------------------
    applicability = parse_applicability(APPLICABILITY_JS)
    reach: dict = {"source": "app/src/io/stereotypes.js → APPLICABILITY", "readable": applicability is not None}
    if applicability is None:
        reach["note"] = "APPLICABILITY не разобрался — сверить baseType с приложением нельзя"
    else:
        known = {b for bases in applicability.values() for b in bases}
        reachable_bases = base_types & known
        unreachable_bases = base_types - known
        reachable_rows = [r for r in rows if r["base_type"] in known]
        unreachable_rows = [r for r in rows if r["base_type"] not in known]
        # Вид элемента, к которому приложение не привязывает ни один baseType,
        # не может получить стереотип из «Подходящих» — только из «Все».
        kinds_without_base = sorted(k for k, v in applicability.items() if not v)
        reach.update(
            {
                "applicability_kinds": len(applicability),
                "base_types_declared": len(known),
                "profile_base_types": len(base_types),
                "profile_base_types_reachable": len(reachable_bases),
                "profile_base_types_unreachable": len(unreachable_bases),
                "records_reachable": len(reachable_rows),
                "records_unreachable": len(unreachable_rows),
                "share_reachable": round(len(reachable_rows) / len(rows), 4),
                "declared_but_absent_from_profile": sorted(known - base_types),
                "kinds_with_empty_base_list": kinds_without_base,
                "unreachable_base_types": [
                    {
                        "base_type": base,
                        "records": sum(1 for r in rows if r["base_type"] == base),
                        "stereotypes": sorted(
                            {r["name"] for r in rows if r["base_type"] == base}
                        ),
                    }
                    for base in sorted(unreachable_bases)
                ],
                # Имя может быть достижимо на одном baseType и нет на другом
                # (`bind` есть и на Realization, и на BindingDependency),
                # поэтому «имён без единого достижимого определения» меньше,
                # чем «имён, у которых есть недостижимое определение».
                "names_with_unreachable_definitions": sorted(
                    {r["name"] for r in unreachable_rows}
                ),
                "names_reachable": len({r["name"] for r in reachable_rows}),
                "names_entirely_unreachable": sorted(
                    {r["name"] for r in rows} - {r["name"] for r in reachable_rows}
                ),
                "reachable_after_dedup_rule_a": len(
                    {(r["name"], r["base_type"]) for r in reachable_rows}
                ),
                "reachable_after_dedup_rule_b": len({r["name"] for r in reachable_rows}),
            }
        )

    # --- 7. сводка и самопроверка -------------------------------------------
    totals = {
        "records": len(rows),
        "records_by_scope": dict(sorted(by_scope.items())),
        "distinct_names": len(names),
        "distinct_name_base_pairs": len(by_pair),
        "distinct_base_types": len(base_types),
        "records_with_empty_icon_path": sum(1 for r in rows if not r["icon_path"]),
        "records_without_icon_path_attribute": sum(
            1 for _, st in records if st.get("iconPath") is None
        ),
        "records_with_tagged_defs": sum(1 for r in rows if r["tagged_defs"]),
        "records_with_formats": sum(1 for r in rows if r["has_formats"]),
        "ids_distinct": len({r["id"] for r in rows}) == len(rows),
        "names_with_several_records": sum(
            1 for group in by_name.values() if len(group) > 1
        ),
        "names_with_several_base_types": len(multi_base),
        "names_whose_records_are_all_one_base_type": sum(
            1
            for group in by_name.values()
            if len(group) > 1 and len({r["base_type"] for r in group}) == 1
        ),
    }

    measured = {
        "records": totals["records"],
        "records_by_scope": totals["records_by_scope"],
        "distinct_names": totals["distinct_names"],
        "distinct_name_base_pairs": totals["distinct_name_base_pairs"],
        "distinct_base_types": totals["distinct_base_types"],
        "duplicate_pairs": len(duplicate_pairs),
        "names_with_several_records": totals["names_with_several_records"],
        "names_with_several_base_types": totals["names_with_several_base_types"],
        "project_only_names": len(project_only),
        "icon_paths_nonempty": len(icon_by_path),
        "normalized_names": spelling["normalized_names"],
        "spelling_groups": spelling["groups"],
        "spelling_defect_groups": spelling["defect_groups"],
        "definitions_after_spelling_merge": dedup["rule_a_normalized_pair_key"]["definitions"],
    }
    for key, want in EXPECTED.items():
        got = measured.get(key)
        if got != want:
            problems.append(f"{key}: ожидалось {want!r}, измерено {got!r}")

    report = {
        "source": {
            "file": PROFILE.name,
            "sha256": digest(PROFILE.read_bytes().decode("utf-8")),
            "profile_version": root.get("version") or "",
        },
        "totals": totals,
        "repeats": {
            "duplicate_pairs": {
                "count": len(duplicate_pairs),
                "meaning": "одно имя и один baseType объявлены в обоих профилях; "
                "один и тот же стереотип, две записи",
                "items": duplicate_pairs,
            },
            "names_with_several_base_types": {
                "count": len(multi_base_items),
                "meaning": "НЕ дубли: UML 2.5.1 §12.3.3.4 разрешает стереотипу "
                "расширять несколько метаклассов, VP пишет это N записями",
                "summary": multi_base_summary,
                "items": multi_base_items,
            },
            "project_only_names": {
                "count": len(project_only),
                "meaning": "имя объявлено только в проектном профиле",
                "names": project_only,
                "items": project_only_items,
            },
            "how_the_numbers_relate": {
                "names_with_several_records": totals["names_with_several_records"],
                "of_which_several_base_types": totals["names_with_several_base_types"],
                "of_which_one_base_type_only": totals[
                    "names_whose_records_are_all_one_base_type"
                ],
                "names_in_both_groups": sorted(
                    {item["name"] for item in duplicate_pairs}
                    & {item["name"] for item in multi_base_items}
                ),
                "note": "57 имён имеют больше одной записи; 43 из них — разные "
                "baseType; 14 — один baseType (настоящие дубли). Четыре имени "
                "попадают в обе группы.",
            },
        },
        "dedup": dedup,
        "spelling_variants": spelling,
        "notation_defaults": notation_defaults,
        "icons": icons,
        "reachability": reach,
        "checks": {"problems": problems, "ok": not problems},
    }

    OUT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"{OUT.relative_to(ROOT)}: записей {totals['records']}, "
          f"имён {totals['distinct_names']}, пар {totals['distinct_name_base_pairs']}")
    print(f"  дублей (пара объявлена дважды): {len(duplicate_pairs)}")
    print(f"  имён с несколькими baseType:    {len(multi_base_items)}")
    print(f"  только в проектном профиле:     {len(project_only)} → {', '.join(project_only)}")
    print(f"  вариантов написания:            {spelling['extra_spellings']} лишних "
          f"({spelling['exact_spellings']} → {spelling['normalized_names']}), "
          f"дефектов {spelling['defect_groups']}")
    if reach.get("readable"):
        print(f"  достижимо в приложении:         {reach['records_reachable']} из {totals['records']} "
              f"записей ({reach['profile_base_types_reachable']} из {reach['profile_base_types']} baseType)")
    for p in problems:
        print(f"  РАСХОЖДЕНИЕ: {p}", file=sys.stderr)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
