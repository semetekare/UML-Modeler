#!/usr/bin/env python3
"""Собрать канонический профиль стереотипов из выгрузки Visual Paradigm.

Читает:

  material/stereotypes.xml       428 записей <Stereotype> (405 Application + 23 Project)
  material/stereotype-icons.json 23 значения iconPath → 15 рисунков
  app/notation/uml.json          умолчания нотации (stereotype/keyword) — только чтение
  app/src/io/stereotypes.js       APPLICABILITY — только чтение

Пишет два файла рядом с собой:

  profile.json       один канонический профиль: 304 стереотипа, 407 расширений
  reachability.json  какие стереотипы приложение сможет показать и почему нет

Правила и их обоснование — docs/STEREOTYPES.md §4.6 и docs/PROFILE-CANONICAL.md.
Коротко:

  1. дедупликация по (каноническое имя, baseType): приоритет у прикладной
     записи, проектная уходит в sources;
  2. варианты написания сводятся к одному; каноническое — то, что пишет
     нотация, иначе написание первой прикладной записи в файле;
  3. одно имя — один стереотип с baseTypes[] (UML 2.5.1 §12.3.3.4), а не N
     записей; tagged-определения, различающиеся по baseType, сохраняются
     отдельно и не теряются;
  4. непустой iconPath любой из схлопнутых записей сохраняется у канонической.

Детерминированность: ни времени, ни абсолютных путей; порядок — порядок файла.
Повторный прогон даёт побайтово тот же profile.json и reachability.json.

Только stdlib. Код возврата 1, если измеренное разошлось с EXPECTED: числа в
документации не могут тихо разъехаться с данными.

    python3 material/profile-canonical/build.py
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

PROFILE = ROOT / "material" / "stereotypes.xml"
ICONS = ROOT / "material" / "stereotype-icons.json"
NOTATION = ROOT / "app" / "notation" / "uml.json"
APPLICABILITY_JS = ROOT / "app" / "src" / "io" / "stereotypes.js"
OUT_PROFILE = HERE / "profile.json"
OUT_REACH = HERE / "reachability.json"

SCOPES = (("ApplicationStereotypes", "application"), ("ProjectStereotypes", "project"))

# Типы tagged-определений в выгрузке VP. 4 — text, как и 0: различие только
# в виджете редактора, для модели это строка.
TV_TYPES = {"0": "text", "1": "int", "2": "enum", "3": "longtext", "4": "text"}

# Опубликованные величины (docs/STEREOTYPES.md, docs/PROFILE-CANONICAL.md).
EXPECTED = {
    "recordsIn": 428,
    "recordsByScope": {"application": 405, "project": 23},
    "definitionsAfterExactDedup": 410,
    "mergedDuplicates": 18,
    "mergedSpellingVariants": 3,
    "after": 407,
    "merged": 21,
    "stereotypes": 304,
    "normalizedNames": 304,
    "iconPaths": 23,
    "drawings": 15,
}


# ------------------------------------------------------------------ утилиты


def normalize(name: str) -> str:
    """Ключ написания: нижний регистр, пробелы/_/- выброшены.

    `executionEnvironment`, `execution environment` и `execution_environment`
    дают один ключ. Это ключ сведения написаний, а не сравнения имён:
    `Default` и `default` тоже схлопываются, но только как одно понятие —
    их `baseType` остаются разными расширениями (§4.6, шаг 5).
    """
    return re.sub(r"[\s_\-]+", "", name or "").lower()


def slug(name: str) -> str:
    """Устойчивый id из имени: нижний регистр, не-буквы в дефисы."""
    text = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return text or "unnamed"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def prefixed(record: dict) -> str:
    """`A:<id>` / `P:<id>` — так источник записи виден в sources."""
    return ("A:" if record["scope"] == "application" else "P:") + record["id"]


def tagged_values(st: ET.Element) -> list[dict]:
    """Tagged-определения в порядке файла: имя, тип, умолчание, значения."""
    out = []
    for td in st.iter("TaggedValueDefinition"):
        out.append(
            {
                "name": td.get("name") or "",
                "type": TV_TYPES.get(td.get("type") or "", "text"),
                "default": td.get("defaultValue") or "",
                "documentation": td.get("documentation") or "",
                "values": [v.get("value") or "" for v in td.iter("ValueSpecification")],
            }
        )
    return out


def tv_signature(values: list[dict]) -> str:
    """Подпись набора: порядок перечислений значим (он и есть потеря)."""
    return json.dumps(values, ensure_ascii=False, sort_keys=True)


def first_app(records: list[dict]) -> dict:
    """Прикладная запись, а если её нет — первая по файлу."""
    apps = [r for r in records if r["scope"] == "application"]
    return min(apps or records, key=lambda r: r["idx"])


# ------------------------------------------------------------------ чтение


def read_profile() -> tuple[ET.Element, list[dict]]:
    root = ET.parse(PROFILE).getroot()
    records: list[dict] = []
    idx = 0
    for tag, scope in SCOPES:
        section = root.find(tag)
        if section is None:
            raise SystemExit(f"material/stereotypes.xml: нет раздела {tag}")
        for st in section.findall("Stereotype"):
            if "id" not in st.attrib:
                raise SystemExit("material/stereotypes.xml: запись без id")
            if "baseType" not in st.attrib:
                raise SystemExit(f"material/stereotypes.xml: {st.get('id')} без baseType")
            records.append(
                {
                    "idx": idx,
                    "scope": scope,
                    "id": st.get("id") or "",
                    "name": st.get("name") or "",
                    "norm": normalize(st.get("name") or ""),
                    "baseType": st.get("baseType") or "",
                    "documentation": st.get("documentation") or "",
                    "iconPath": (st.get("iconPath") or "").strip(),
                    "taggedValues": tagged_values(st),
                    "hasFormats": bool(st.findall("Formats")),
                }
            )
            idx += 1
    return root, records


def read_icons() -> dict[str, dict]:
    raw = json.loads(ICONS.read_text(encoding="utf-8"))
    rows = {}
    for path, row in (raw.get("map") or {}).items():
        if not row.get("asset"):
            continue
        rows[path] = {
            "asset": row["asset"],
            "kind": row.get("kind") or "badge",
            "size": row.get("size") or [16, 16],
            "glyph": row.get("glyph") or row["asset"],
        }
    return rows


def read_notation() -> tuple[dict[str, list[str]], list[str]]:
    """Умолчания нотации: нормализованное имя → написания; и все значения."""
    pkg = json.loads(NOTATION.read_text(encoding="utf-8"))
    by_norm: dict[str, set[str]] = {}
    all_values: set[str] = set()
    for group in ("shapes", "connectors"):
        for defn in (pkg.get(group) or {}).values():
            for field in ("stereotype", "keyword"):
                value = defn.get(field)
                if not value:
                    continue
                all_values.add(value)
                by_norm.setdefault(normalize(value), set()).add(value)
    return {key: sorted(values) for key, values in by_norm.items()}, sorted(all_values)


def read_applicability() -> dict[str, list[str]] | None:
    """`APPLICABILITY` из app/src/io/stereotypes.js: вид → допустимые baseType."""
    if not APPLICABILITY_JS.exists():
        return None
    src = APPLICABILITY_JS.read_text(encoding="utf-8")
    block = re.search(r"export const APPLICABILITY\s*=\s*\{(.*?)\n\};", src, re.S)
    if not block:
        return None
    kinds: dict[str, list[str]] = {}
    for line in block.group(1).splitlines():
        line = line.split("//")[0].strip()
        m = re.match(r"([A-Za-z_$][\w$]*)\s*:\s*\[(.*?)\]\s*,?\s*$", line)
        if m:
            kinds[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))
    return kinds or None


# ------------------------------------------------------------- канонизация


def build_stereotypes(
    records: list[dict],
    icon_rows: dict[str, dict],
    notation_by_norm: dict[str, list[str]],
) -> tuple[list[dict], dict]:
    """Свернуть 428 записей в 304 стереотипа с 407 расширениями."""
    by_norm: dict[str, list[dict]] = {}
    for record in records:
        by_norm.setdefault(record["norm"], []).append(record)

    definitions: dict[str, dict[str, list[dict]]] = {}
    for record in records:
        definitions.setdefault(record["norm"], {}).setdefault(record["baseType"], []).append(record)

    problems: list[str] = []
    used_ids: dict[str, int] = {}
    stereotypes: list[dict] = []
    notation_used: list[dict] = []

    for norm, raw in by_norm.items():
        # --- каноническое написание -----------------------------------------
        notation_spellings = notation_by_norm.get(norm, [])
        if notation_spellings:
            canonical = notation_spellings[0]
            notation_used.append(
                {
                    "normalized": norm,
                    "notation": canonical,
                    "profileSpellings": sorted({r["name"] for r in raw}),
                }
            )
        else:
            canonical = first_app(raw)["name"]

        aliases: list[str] = []
        for record in raw:
            if record["name"] != canonical and record["name"] not in aliases:
                aliases.append(record["name"])

        base_types: list[str] = []
        for record in raw:
            if record["baseType"] not in base_types:
                base_types.append(record["baseType"])

        scope = "application" if any(r["scope"] == "application" for r in raw) else "project"

        # Документация: первая непустая по файлу. Пустая строка — умолчание
        # VP, терять её нечего, а непустую терять нельзя.
        documents = [r["documentation"] for r in raw if r["documentation"]]
        documentation = documents[0] if documents else ""

        # --- рисунок: первый непустой iconPath по файлу ----------------------
        # Все непустые пути схлопнутых записей сохраняются списком: по ним
        # доказывается, что ни одно из 23 значений не потеряно. Сам рисунок
        # выбирается по первому пути — у одного стереотипа все пути ведут на
        # один глиф, это проверяет check.mjs.
        icon_paths: list[str] = []
        for record in raw:
            if not record["iconPath"] or record["iconPath"] in icon_paths:
                continue
            icon_paths.append(record["iconPath"])

        def pictogram_row(icon_path: str | None) -> dict | None:
            """iconPath → строка карты; None, если рисунка нет."""
            if not icon_path:
                return None
            row = icon_rows.get(icon_path)
            if row is None:
                problems.append(
                    f"{icon_path}: нет в material/stereotype-icons.json"
                )
                return None
            return {
                "asset": row["asset"],
                "kind": row["kind"],
                "size": list(row["size"]),
                "glyph": row["glyph"],
                "iconPath": icon_path,
            }

        # По baseType рисунки тоже могут различаться: у `usecase` овал
        # принадлежит записи на Class, а у самой UseCase рисунка нет. Без
        # этой карты Б11 не сможет выбрать рисунок по виду элемента.
        pictogram_by_base = {
            base: pictogram_row(
                next(
                    (r["iconPath"] for r in definitions[norm][base] if r["iconPath"]),
                    "",
                )
            )
            for base in base_types
        }
        pictogram = pictogram_row(icon_paths[0]) if icon_paths else None
        if pictogram is not None:
            pictogram["iconPaths"] = icon_paths

        # --- tagged values ---------------------------------------------------
        # Содержимое берётся у первой прикладной записи группы, а не у записи,
        # чьё написание стало каноническим: имя — это подпись, а объявление
        # одно, и «первая прикладная» — то же правило, что в дедупликации.
        representative = first_app(raw)
        tagged = representative["taggedValues"]

        # По baseType наборы могут различаться (XSDschema: у Package два
        # определения, у Class ни одного). Это не повод плодить стереотипы с
        # одним именем — сохраняем различие явно.
        by_base_rep = {
            base: first_app(items) for base, items in definitions[norm].items()
        }
        base_signatures = {
            base: tv_signature(rep["taggedValues"]) for base, rep in by_base_rep.items()
        }
        tagged_by_base = None
        if len(set(base_signatures.values())) > 1:
            tagged_by_base = {
                base: by_base_rep[base]["taggedValues"] for base in base_types
            }

        # Внутри одного baseType схлопнутые записи тоже могут различаться
        # (usecase × UseCase: смысловой и алфавитный порядок перечислений).
        # Ни один вариант не выбрасываем — перечисляем их с источниками.
        tagged_variants = None
        for base, items in definitions[norm].items():
            buckets: dict[str, dict] = {}
            for item in items:
                key = tv_signature(item["taggedValues"])
                bucket = buckets.setdefault(
                    key, {"taggedValues": item["taggedValues"], "sources": []}
                )
                bucket["sources"].append(prefixed(item))
            if len(buckets) > 1:
                if tagged_variants is None:
                    tagged_variants = []
                tagged_variants.append({"baseType": base, "variants": list(buckets.values())})

        # --- id ---------------------------------------------------------------
        base_id = "st-" + slug(canonical)
        if base_id in used_ids:
            used_ids[base_id] += 1
            base_id = f"{base_id}-{used_ids[base_id]}"
            problems.append(f"id {base_id}: совпал слаг для имени {canonical!r}")
        else:
            used_ids[base_id] = 1

        item = {
            "id": base_id,
            "name": canonical,
            "aliases": aliases,
            "baseTypes": base_types,
            "scope": scope,
            "documentation": documentation,
            "pictogram": pictogram,
            "taggedValues": tagged,
        }
        if pictogram is not None:
            item["pictogramByBaseType"] = pictogram_by_base
        if tagged_by_base is not None:
            item["taggedValuesByBaseType"] = tagged_by_base
        if tagged_variants is not None:
            item["taggedValuesVariants"] = tagged_variants
        item["sources"] = [prefixed(r) for r in raw]
        stereotypes.append(item)

    return stereotypes, {"problems": problems, "notationUsed": notation_used}


def classify_base(base: str) -> tuple[str, str, str]:
    """Классификация недостижимого baseType: (вид, семейство, почему)."""
    if base == "BMMRelationship":
        return (
            "foreign-notation",
            "BMM",
            "Business Motivation Model (BMM) — не UML, вне границ проекта",
        )
    if base.startswith("ArchiMate"):
        return ("foreign-notation", "ArchiMate", "ArchiMate — не UML, вне границ проекта")
    if base.startswith("SysML"):
        return ("foreign-notation", "SysML", "SysML — вне границ проекта")
    if base == "Attribute":
        return (
            "design-not-an-element",
            "Attribute",
            "у нас атрибут — строка члена (member), а не элемент: стереотип на него не надеть",
        )
    if base == "Operation":
        return (
            "design-not-an-element",
            "Operation",
            "у нас операция — строка члена (member), а не элемент: стереотип на неё не надеть",
        )
    if base in {"BindingDependency", "CollaborationOccurrence"}:
        return (
            "notation-gap",
            "UML-связь",
            "метакласс UML: вида связи в нотации нет — можно добавить",
        )
    return (
        "notation-gap",
        "UML-элемент",
        "метакласс UML: вида элемента в нотации нет — можно добавить",
    )


def build_reachability(
    stereotypes: list[dict], records: list[dict], applicability: dict[str, list[str]] | None
) -> dict:
    """Что приложение сможет показать и почему остальное — нет."""
    profile_bases = {base for st in stereotypes for base in st["baseTypes"]}
    base_records = {base: 0 for base in profile_bases}
    for record in records:
        base_records[record["baseType"]] = base_records.get(record["baseType"], 0) + 1
    base_names: dict[str, list[str]] = {base: [] for base in profile_bases}
    for st in stereotypes:
        for base in st["baseTypes"]:
            base_names[base].append(st["name"])

    data: dict = {
        "version": 1,
        "source": "app/src/io/stereotypes.js → APPLICABILITY",
        "notation": "app/notation/uml.json (51 фигура + 27 связей)",
        "applicability": {
            "readable": applicability is not None,
            "kinds": len(applicability or {}),
            "baseTypesDeclared": len({b for v in (applicability or {}).values() for b in v}),
            "profileBaseTypes": len(profile_bases),
        },
    }

    if applicability is None:
        data["note"] = "APPLICABILITY не разобрался — достижимость не считается"
        data["groups"] = []
        return data

    known = {b for values in applicability.values() for b in values}
    reachable_bases = profile_bases & known
    unreachable_bases = profile_bases - known
    data["applicability"]["reachableBaseTypes"] = len(reachable_bases)
    data["applicability"]["unreachableBaseTypes"] = len(unreachable_bases)

    # --- недостижимые записи по семействам ---------------------------------
    groups: dict[tuple[str, str, str], dict] = {}
    for base in sorted(unreachable_bases):
        kind, family, why = classify_base(base)
        group = groups.setdefault(
            (kind, family, why),
            {"kind": kind, "family": family, "why": why, "baseTypes": []},
        )
        group["baseTypes"].append(
            {
                "baseType": base,
                "records": base_records.get(base, 0),
                "stereotypes": sorted(base_names.get(base, [])),
            }
        )
    group_list = []
    for group in groups.values():
        group["baseTypes"].sort(key=lambda row: (-row["records"], row["baseType"]))
        group["records"] = sum(row["records"] for row in group["baseTypes"])
        group["stereotypeNames"] = sorted(
            {name for row in group["baseTypes"] for name in row["stereotypes"]}
        )
        group_list.append(group)
    group_list.sort(key=lambda g: (g["kind"], -g["records"], g["family"]))

    # --- стереотипы целиком и частично недостижимые ------------------------
    entirely = []
    partly = []
    for st in stereotypes:
        ok = [b for b in st["baseTypes"] if b in known]
        bad = [b for b in st["baseTypes"] if b not in known]
        if not ok:
            kinds = sorted({classify_base(b)[0] for b in bad})
            families = sorted({classify_base(b)[1] for b in bad})
            entirely.append(
                {
                    "id": st["id"],
                    "name": st["name"],
                    "baseTypes": st["baseTypes"],
                    "records": len(st["sources"]),
                    "reason": "ни один baseType не объявлен в APPLICABILITY",
                    "kinds": kinds,
                    "families": families,
                }
            )
        elif bad:
            partly.append(
                {
                    "id": st["id"],
                    "name": st["name"],
                    "reachableBaseTypes": ok,
                    "unreachableBaseTypes": bad,
                }
            )

    # --- два направления расхождения ---------------------------------------
    absent = sorted(known - profile_bases)
    kinds_for = {base: sorted(k for k, v in applicability.items() if base in v) for base in absent}
    no_stereotype = sorted(
        k for k, values in applicability.items()
        if values and not (set(values) & profile_bases)
    )

    data["summary"] = {
        "records": len(records),
        "recordsReachable": sum(1 for r in records if r["baseType"] in known),
        "recordsUnreachable": sum(1 for r in records if r["baseType"] not in known),
        "stereotypes": len(stereotypes),
        "stereotypesReachable": sum(
            1 for st in stereotypes if any(b in known for b in st["baseTypes"])
        ),
        "stereotypesEntirelyUnreachable": len(entirely),
        "stereotypesPartlyReachable": len(partly),
        "byDesignRecords": sum(
            1 for r in records
            if r["baseType"] not in known
            and classify_base(r["baseType"])[0] in {"foreign-notation", "design-not-an-element"}
        ),
        "gapRecords": sum(
            1 for r in records
            if r["baseType"] not in known and classify_base(r["baseType"])[0] == "notation-gap"
        ),
    }
    data["summary"]["shareRecordsReachable"] = round(
        data["summary"]["recordsReachable"] / len(records), 4
    ) if records else 0.0

    # Чужие нотации целиком: 104 записи, из них 8 достижимы, потому что
    # APPLICABILITY принимает SysMLBlock, SysMLValueType и
    # SysMLParticipantProperty. Поэтому «104» и «96» — разные числа.
    foreign = [
        r for r in records
        if r["baseType"] == "BMMRelationship"
        or r["baseType"].startswith(("ArchiMate", "SysML"))
    ]
    data["foreignNotation"] = {
        "records": len(foreign),
        "recordsReachable": sum(1 for r in foreign if r["baseType"] in known),
        "recordsUnreachable": sum(1 for r in foreign if r["baseType"] not in known),
        "families": {
            family: sum(
                1 for r in foreign
                if (r["baseType"] == "BMMRelationship" if family == "BMM"
                    else r["baseType"].startswith(family))
            )
            for family in ("BMM", "ArchiMate", "SysML")
        },
        "note": "BMM + ArchiMate + SysML; SysMLBlock, SysMLValueType и "
        "SysMLParticipantProperty приложение принимает через APPLICABILITY",
    }
    data["byDesign"] = {
        "records": data["summary"]["byDesignRecords"],
        "foreignNotationUnreachable": sum(
            1 for r in records
            if r["baseType"] not in known
            and classify_base(r["baseType"])[0] == "foreign-notation"
        ),
        "membersNotElements": sum(
            1 for r in records
            if r["baseType"] not in known
            and classify_base(r["baseType"])[0] == "design-not-an-element"
        ),
        "note": "чужие нотации + атрибуты и операции, которые у нас строки членов",
    }
    data["ourGaps"] = {
        "records": data["summary"]["gapRecords"],
        "baseTypes": sorted(
            b for b in unreachable_bases if classify_base(b)[0] == "notation-gap"
        ),
        "note": "метаклассы UML, вида элемента или связи в нотации нет — это работа Б14",
    }

    data["groups"] = group_list
    data["stereotypesEntirelyUnreachable"] = entirely
    data["stereotypesPartlyReachable"] = partly
    data["declaredButAbsentFromProfile"] = [
        {
            "baseType": base,
            "kinds": kinds_for[base],
            "records": 0,
            "note": (
                "приложение разрешает baseType, но в профиле нет ни одной записи с ним"
                if base != "Property"
                else "в профиле есть стереотип Property, но его baseType — Attribute; "
                "baseType Property не объявлен ни разу"
            ),
        }
        for base in absent
    ]
    data["kindsWithoutApplicableStereotype"] = no_stereotype
    return data


# ------------------------------------------------------------------- отчёт


def duplicate_pairs(records: list[dict]) -> list[dict]:
    """18 пар (имя, baseType), объявленных в обоих профилях."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for record in records:
        groups.setdefault((record["name"], record["baseType"]), []).append(record)
    pairs = []
    for (name, base), items in groups.items():
        if len(items) < 2:
            continue
        kept = first_app(items)
        pairs.append(
            {
                "name": name,
                "baseType": base,
                "kept": prefixed(kept),
                "dropped": [prefixed(r) for r in items if r is not kept],
                "identicalContent": len({tv_signature(r["taggedValues"]) for r in items}) == 1
                and len({r["documentation"] for r in items}) == 1
                and len({r["iconPath"] for r in items}) == 1,
            }
        )
    pairs.sort(key=lambda p: (p["name"], p["baseType"]))
    return pairs


def spelling_report(records: list[dict], stereotypes: list[dict]) -> list[dict]:
    """7 групп, где написание разошлось: что и как сведено."""
    by_norm: dict[str, list[dict]] = {}
    for record in records:
        by_norm.setdefault(record["norm"], []).append(record)
    canonical = {normalize(st["name"]): st["name"] for st in stereotypes}

    out = []
    for norm, raw in by_norm.items():
        spellings = []
        for record in raw:
            if record["name"] not in spellings:
                spellings.append(record["name"])
        if len(spellings) < 2:
            continue
        # Дефект: в одной области на одном baseType два написания.
        defects = {}
        for record in raw:
            key = (record["scope"], record["baseType"])
            defects.setdefault(key, set()).add(record["name"])
        defect_keys = {f"{scope}/{base}": sorted(names) for (scope, base), names in defects.items() if len(names) > 1}
        # Сколько определений (имя, baseType) схлопнулось именно написанием.
        extra = 0
        for base in {r["baseType"] for r in raw}:
            extra += max(0, len({r["name"] for r in raw if r["baseType"] == base}) - 1)
        out.append(
            {
                "normalized": norm,
                "spellings": spellings,
                "canonical": canonical[norm],
                "records": len(raw),
                "defect": bool(defect_keys),
                "defects": defect_keys,
                "collapsedDefinitions": extra,
                "verdict": (
                    "дефект: одно понятие, два написания на одном baseType"
                    if defect_keys
                    else "не дефект: написания случайно совпали, baseType разные"
                ),
            }
        )
    out.sort(key=lambda row: (-1 if row["defect"] else 0, row["normalized"]))
    return out


def main() -> int:
    root, records = read_profile()
    icon_rows = read_icons()
    notation_by_norm, notation_values = read_notation()
    stereotypes, build_notes = build_stereotypes(records, icon_rows, notation_by_norm)

    # --- числа ---------------------------------------------------------------
    by_scope = {
        scope: sum(1 for r in records if r["scope"] == scope)
        for _, scope in SCOPES
    }
    exact_pairs = {(r["name"], r["baseType"]) for r in records}
    normalized_pairs = {(r["norm"], r["baseType"]) for r in records}
    normalized_names = {r["norm"] for r in records}
    icon_paths = {r["iconPath"] for r in records if r["iconPath"]}
    drawings = {icon_rows[p]["glyph"] for p in icon_paths if p in icon_rows}
    extensions = sum(len(st["baseTypes"]) for st in stereotypes)
    with_pictogram = sum(1 for st in stereotypes if st["pictogram"])
    duplicates = duplicate_pairs(records)
    spelling = spelling_report(records, stereotypes)

    report = {
        "recordsIn": len(records),
        "recordsByScope": by_scope,
        "distinctNames": len({r["name"] for r in records}),
        "normalizedNames": len(normalized_names),
        "definitionsAfterExactDedup": len(exact_pairs),
        "mergedDuplicates": len(records) - len(exact_pairs),
        "mergedSpellingVariants": len(exact_pairs) - len(normalized_pairs),
        "after": len(normalized_pairs),
        "merged": len(records) - len(normalized_pairs),
        "stereotypes": len(stereotypes),
        "extensions": extensions,
        "baseTypeExtensionsMerged": extensions - len(stereotypes),
        "aliases": sum(len(st["aliases"]) for st in stereotypes),
        "recordsWithIconPathIn": sum(1 for r in records if r["iconPath"]),
        "iconPaths": len(icon_paths),
        "drawings": len(drawings),
        "stereotypesWithPictogram": with_pictogram,
        "definitionsWithPictogram": sum(
            1
            for st in stereotypes
            for base in st["baseTypes"]
            if st.get("pictogramByBaseType", {}).get(base)
        ),
        "recordsWithFormats": sum(1 for r in records if r["hasFormats"]),
        "projectOnlyStereotypes": sum(1 for st in stereotypes if st["scope"] == "project"),
        "mixedScopeStereotypes": sum(
            1
            for st in stereotypes
            if {("application" if src.startswith("A:") else "project") for src in st["sources"]}
            == {"application", "project"}
        ),
        "taggedValuesDivergent": sorted(
            st["name"] for st in stereotypes if "taggedValuesByBaseType" in st
        ),
        "taggedValuesVariantNames": sorted(
            st["name"] for st in stereotypes if "taggedValuesVariants" in st
        ),
        "byRule": {
            "duplicates": {
                "rule": "(name, baseType) объявлена дважды: прикладная запись остаётся, проектная в sources",
                "removed": len(records) - len(exact_pairs),
                "pairs": duplicates,
            },
            "spelling": {
                "rule": "одно понятие — одно написание; каноническое — из нотации, иначе первая прикладная запись",
                "removed": len(exact_pairs) - len(normalized_pairs),
                "groups": spelling,
            },
            "baseTypes": {
                "rule": "одно имя — один стереотип с baseTypes[] (UML 2.5.1 §12.3.3.4)",
                "mergedExtensions": extensions - len(stereotypes),
            },
        },
        "notation": {
            "source": "app/notation/uml.json",
            "spellings": len(notation_values),
            "usedForCanonicalChoice": build_notes["notationUsed"],
            "renamedFromProfile": [
                row for row in build_notes["notationUsed"]
                if row["notation"] not in row["profileSpellings"]
            ],
        },
        "checks": {"problems": build_notes["problems"], "ok": not build_notes["problems"]},
    }

    measured = {
        "recordsIn": report["recordsIn"],
        "recordsByScope": report["recordsByScope"],
        "definitionsAfterExactDedup": report["definitionsAfterExactDedup"],
        "mergedDuplicates": report["mergedDuplicates"],
        "mergedSpellingVariants": report["mergedSpellingVariants"],
        "after": report["after"],
        "merged": report["merged"],
        "stereotypes": report["stereotypes"],
        "normalizedNames": report["normalizedNames"],
        "iconPaths": report["iconPaths"],
        "drawings": report["drawings"],
    }
    problems = list(build_notes["problems"])
    for key, want in EXPECTED.items():
        got = measured.get(key)
        if got != want:
            problems.append(f"{key}: ожидалось {want!r}, измерено {got!r}")
    if extensions != report["after"]:
        problems.append(
            f"расширений {extensions}, а определений (имя, baseType) {report['after']}"
        )
    if len(stereotypes) != len(normalized_names):
        problems.append(
            f"стереотипов {len(stereotypes)}, а нормализованных имён {len(normalized_names)}"
        )
    report["checks"] = {"problems": problems, "ok": not problems}

    # --- notExpressible ------------------------------------------------------
    applicability = read_applicability()
    known = {b for values in (applicability or {}).values() for b in values}
    base_records: dict[str, int] = {}
    base_names: dict[str, list[str]] = {}
    for record in records:
        base_records[record["baseType"]] = base_records.get(record["baseType"], 0) + 1
    for st in stereotypes:
        for base in st["baseTypes"]:
            base_names.setdefault(base, []).append(st["name"])
    not_expressible = []
    for base in sorted(
        (b for b in base_records if b not in known),
        key=lambda b: (-base_records[b], b),
    ):
        kind, family, why = classify_base(base)
        not_expressible.append(
            {
                "baseType": base,
                "family": family,
                "kind": kind,
                "records": base_records[base],
                "stereotypes": sorted(set(base_names.get(base, []))),
                "why": why,
            }
        )

    profile = {
        "version": 1,
        "source": "material/stereotypes.xml (VP 16.3)",
        "sourceSha256": digest(PROFILE.read_bytes().decode("utf-8")),
        "rules": {
            "record": "одна запись <Stereotype> из ApplicationStereotypes или ProjectStereotypes, в порядке файла",
            "normalization": "нижний регистр, пробелы, _ и - выброшены",
            "dedup": "группы по (нормализованное имя, baseType): остаётся прикладная запись, иначе первая проектная; отброшенные адреса — в sources",
            "spelling": "все написания одного понятия сводятся к одному стереотипу; прочие написания остаются в aliases",
            "canonicalChoice": "1) написание из app/notation/uml.json (stereotype|keyword); 2) написание первой прикладной записи в файле; 3) первой проектной",
            "canonicalSpellingMayBeNew": "два имени (include, extend) нотация пишет иначе, чем профиль; в профиле они остаются с aliases Include/Extend",
            "baseTypes": "один стереотип на каноническое имя, baseTypes[] в порядке первого появления (UML 2.5.1 §12.3.3.4)",
            "taggedValues": "набор записи канонического написания; если наборы различаются по baseType — taggedValuesByBaseType; если внутри одного baseType — taggedValuesVariants",
            "iconPath": "все непустые iconPath схлопнутых записей (iconPaths, по файлу); рисунок выбирается по первому и переводится через material/stereotype-icons.json",
            "scope": "application, если хоть одна схлопнутая запись прикладная, иначе project",
            "documentation": "первая непустая документация схлопнутых записей по файлу",
        },
        "counts": {
            "records": report["recordsIn"],
            "definitions": report["extensions"],
            "stereotypes": report["stereotypes"],
            "aliases": report["aliases"],
            "icons": report["drawings"],
        },
        "stereotypes": stereotypes,
        "notExpressible": not_expressible,
        "report": report,
    }

    reachability = build_reachability(stereotypes, records, applicability)

    OUT_PROFILE.write_text(
        json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    OUT_REACH.write_text(
        json.dumps(reachability, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"profile.json: {report['recordsIn']} записей → {report['after']} определений "
        f"→ {report['stereotypes']} стереотипов; удалено {report['merged']} "
        f"(дублей {report['mergedDuplicates']}, написаний {report['mergedSpellingVariants']})"
    )
    print(
        f"  рисунков: {report['iconPaths']} iconPath → {report['drawings']} глифов, "
        f"стереотипов с рисунком {with_pictogram}"
    )
    if reachability.get("summary"):
        s = reachability["summary"]
        print(
            f"  достижимо: {s['recordsReachable']} из {s['records']} записей; "
            f"стереотипов целиком недостижимо {s['stereotypesEntirelyUnreachable']}, "
            f"частично {s['stereotypesPartlyReachable']}"
        )
        print(
            f"  недостижимо по делу {s['byDesignRecords']}, пробел нотации {s['gapRecords']}"
        )
    for problem in problems:
        print(f"  РАСХОЖДЕНИЕ: {problem}", file=sys.stderr)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())