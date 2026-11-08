#!/usr/bin/env python3
"""Собрать машиночитаемое дерево спецификации UML 2.5.1 и нарезать её по разделам.

Вход — `reference/spec/md/` (25 файлов разделов + INDEX.md), выход — два
продукта в `material/reference-content/`:

  spec-tree.json           дерево «раздел → подраздел → …» с номерами,
                           заголовками, объёмом, признаками Constraints/OCL/
                           таблиц и разрешёнными перекрёстными ссылками;
  spec-sections/*.md       каждый раздел верхнего уровня отдельным файлом
                           (побайтово те же строки, что в источнике);
  spec-sections/units/*.md подраздел второго уровня отдельным файлом — для
                           разделов, которые целиком грузить в браузер дорого.

Полнота проверяется, а не предполагается: скрипт режет текст на интервалы
строк, требует, чтобы интервалы покрывали файл без дыр и наложений, и
сравнивает сумму символов нарезки с суммой символов источника. Расхождение —
ошибка с кодом возврата 1.

Только stdlib. Ничего не устанавливает, кроме перечисленных файлов ничего не
пишет.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC_DIR = ROOT / "reference" / "spec" / "md"
OUT_DIR = ROOT / "material" / "reference-content"
SECTIONS_DIR = OUT_DIR / "spec-sections"

# INDEX.md — карта самого корпуса, а не раздел стандарта: в дерево не входит.
SKIP_FILES = {"INDEX.md"}

SCHEMA = "uml-spec-tree/1"

HEADING_RE = re.compile(r"^(#{1,6})\s+(\S.*?)\s*$")
NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)\s+(.*)$")
ANNEX_RE = re.compile(r"^Annex\s+([A-Z])\s*:\s*(.*)$")
FENCE_RE = re.compile(r"^\s*```\s*([A-Za-z0-9_-]*)\s*$")
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
# Инварианты: `inv:` в начале строки OCL-блока, но встречается и в строку
# с контекстом («context C inv: …»), поэтому якоря нет.
INV_RE = re.compile(r"\binv\s*:")

# Перекрёстные ссылки. Разделители внутри номера — точка; «11.5.3» без слова
# «see» тоже ссылка, но только в скобках или после «clause», иначе это
# нумерация списка, а не ссылка.
REF_PATTERNS = [
    re.compile(r"\bsee\s+(?:sub\s*clause\s+|Sub\s*Clause\s+|subclause\s+)?(\d+(?:\.\d+)*)", re.I),
    re.compile(r"\b(?:sub\s*clause|Sub\s*Clause|subclause)\s+(\d+(?:\.\d+)*)", re.I),
    re.compile(r"\b(?:Clause|clause)\s+(\d+(?:\.\d+)*)"),
    re.compile(r"\((\d+(?:\.\d+)+)\)"),
]

def slugify(text: str) -> str:
    """Устойчивый слаг: строчные буквы, цифры, дефисы."""
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "node"


def node_id(number: str | None, title: str, used: set[str]) -> str:
    """id из номера и слага; при совпадении добавляется счётчик."""
    base = f"{number}-{slugify(title)}" if number else slugify(title)
    candidate = base
    n = 2
    while candidate in used:
        candidate = f"{base}-{n}"
        n += 1
    used.add(candidate)
    return candidate


class Node:
    """Узел дерева спецификации. Поля заполняются в два прохода: разбор
    заголовков, затем признаки (Constraints, OCL, таблицы, ссылки)."""

    def __init__(self, **kw):
        self.has_constraints = False
        self.constraint_nodes = []
        self.ocl_blocks = 0
        self.inv_lines = 0
        self.tables = 0
        self.refs = []
        self.refs_unresolved = []
        self.chars_subtree = 0
        self.lines = 0
        for k, v in kw.items():
            setattr(self, k, v)


def split_blocks(text: str):
    """Разбить текст на блоки: (kind, start, end) по строкам-заголовкам.

    kind — 'heading' или 'body'. Возвращает список интервалов строк (0-based,
    [start, end)) и признак конца файла.
    """
    lines = text.split("\n")
    blocks = []
    cur_start = 0
    cur_kind = "body"
    in_fence = False
    for i, line in enumerate(lines):
        fence = FENCE_RE.match(line)
        if fence:
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(line)
        if m:
            if i > cur_start:
                blocks.append((cur_kind, cur_start, i))
            blocks.append(("heading", i, i + 1))
            cur_start = i + 1
            cur_kind = "body"
    if cur_start < len(lines):
        blocks.append((cur_kind, cur_start, len(lines)))
    return blocks, lines


def parse_file(path: Path, used_ids: set[str]) -> list[Node]:
    """Разобрать один файл раздела в лес узлов (обычно одно дерево)."""
    text = path.read_text(encoding="utf-8")
    blocks, lines = split_blocks(text)
    nodes: list[Node] = []
    stack: list[Node] = []
    # Открытые узлы: закрываем по достижении заголовка с level <= текущего.
    for kind, start, end in blocks:
        if kind != "heading":
            continue
        raw = lines[start]
        m = HEADING_RE.match(raw)
        assert m, raw
        level = len(m.group(1))
        title = m.group(2).strip()
        number = None
        annex = ANNEX_RE.match(title)
        if annex:
            number = f"Annex {annex.group(1)}"
            title = annex.group(2).strip()
        else:
            nm = NUMBER_RE.match(title)
            if nm:
                number = nm.group(1)
                title = nm.group(2).strip()
        node = Node(
            id=node_id(number, title, used_ids),
            number=number,
            title=title,
            level=level,
            file=path.name,
            section=None,
            start=start,
            end=None,
            own_chars=0,
            children=[],
            parent=None,
            own_text="",
            kind="annex" if annex else "clause",
        )
        while stack and stack[-1].level >= level:
            closed = stack.pop()
            closed.end = start
        if stack:
            node.parent = stack[-1]
            stack[-1].children.append(node)
        nodes.append(node)
        stack.append(node)
    for node in stack:
        node.end = len(lines)
    # Обрезаем end у всех: конец = начало следующего узла любого уровня после
    # его поддерева; для этого достаточно «до первого заголовка с level <= мой».
    for node in nodes:
        node.end = _find_end(node, nodes, len(lines))
    # Собственный текст = от заголовка до начала первого ребёнка (или до end).
    for node in nodes:
        first_child = min((c.start for c in node.children), default=node.end)
        node.own_text = "\n".join(lines[node.start:first_child])
        node.own_chars = len(node.own_text)
    return nodes


def _find_end(node: Node, nodes: list[Node], total_lines: int) -> int:
    """Строка сразу после последней строки поддерева узла."""
    idx = nodes.index(node)
    end = node.start + 1
    for other in nodes[idx + 1:]:
        if other.level <= node.level:
            return other.start
        end = max(end, other.start + 1)
    return max(end, total_lines)


def descendants(node: Node) -> list[Node]:
    out = []
    stack = list(node.children)
    while stack:
        n = stack.pop()
        out.append(n)
        stack.extend(n.children)
    return out


def body_text(node: Node, lines: list[str]) -> str:
    """Весь текст поддерева узла, включая заголовки потомков."""
    return "\n".join(lines[node.start:node.end])


def strip_fences(text: str) -> str:
    """Текст без содержимого огороженных блоков.

    В блоках ```` ```text ```` лежит ASCII-арт диаграмм абстрактного синтаксиса:
    строки вида «+ clause 0..1» не являются ссылками на пункты, и искать
    ссылки по ним нельзя.
    """
    out = []
    in_fence = False
    for line in text.split("\n"):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence:
            out.append(line)
    return "\n".join(out)


def count_ocl(text: str) -> int:
    """Сколько блоков ```ocl в тексте."""
    n = 0
    in_ocl = False
    for line in text.split("\n"):
        m = FENCE_RE.match(line)
        if m:
            if in_ocl:
                in_ocl = False
            elif m.group(1).lower() == "ocl":
                in_ocl = True
                n += 1
    return n


def count_tables(text: str) -> int:
    """Сколько Markdown-таблиц: группы подряд идущих строк `| … |` с
    разделителем `|---|` во второй строке группы."""
    lines = text.split("\n")
    tables = 0
    i = 0
    while i < len(lines):
        if TABLE_ROW_RE.match(lines[i]):
            j = i
            while j < len(lines) and TABLE_ROW_RE.match(lines[j]):
                j += 1
            group = lines[i:j]
            if len(group) >= 2 and re.match(r"^\s*\|[\s:|-]+\|\s*$", group[1]):
                tables += 1
            i = j
        else:
            i += 1
    return tables


def extract_refs(text: str, known: set[str]) -> tuple[list[str], list[str]]:
    """Ссылки на другие пункты: (разрешённые, неразрешённые)."""
    found = []
    for pat in REF_PATTERNS:
        for m in pat.finditer(text):
            found.append(m.group(1))
    resolved = []
    unresolved = []
    seen = set()
    for num in found:
        if num in seen:
            continue
        seen.add(num)
        if num in known:
            resolved.append(num)
        else:
            unresolved.append(num)
    return sorted(resolved, key=_num_key), sorted(unresolved, key=_num_key)


def _num_key(num: str):
    return [int(p) for p in re.findall(r"\d+", num)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--spec-dir", type=Path, default=SPEC_DIR)
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR)
    ap.add_argument("--no-slice", action="store_true", help="не писать spec-sections/")
    ap.add_argument("--units-min-bytes", type=int, default=120_000,
                    help="раздел больше этого размера режется ещё и по подразделам")
    args = ap.parse_args()

    spec_dir: Path = args.spec_dir
    out_dir: Path = args.out_dir
    sections_dir = out_dir / "spec-sections"
    units_dir = sections_dir / "units"

    files = sorted(p for p in spec_dir.glob("*.md") if p.name not in SKIP_FILES)
    if not files:
        print(f"нет разделов в {spec_dir}", file=sys.stderr)
        return 1

    used_ids: set[str] = set()
    all_nodes: list[Node] = []
    file_texts: dict[str, str] = {}
    file_lines: dict[str, list[str]] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        file_texts[path.name] = text
        nodes = parse_file(path, used_ids)
        file_lines[path.name] = text.split("\n")
        for n in nodes:
            n.section = nodes[0].number or nodes[0].id
        all_nodes.extend(nodes)

    known_numbers = {n.number for n in all_nodes if n.number}

    # --- проверка разбора: каждый файл начинается с заголовка и покрыт ---
    problems: list[str] = []
    for path in files:
        text = file_texts[path.name]
        lines = file_lines[path.name]
        nodes = [n for n in all_nodes if n.file == path.name]
        tops = [n for n in nodes if n.parent is None]
        if not tops:
            problems.append(f"{path.name}: нет заголовков верхнего уровня")
            continue
        if tops[0].start != 0:
            problems.append(f"{path.name}: текст до первого заголовка, строк {tops[0].start}")
        covered = 0
        for n in tops:
            covered += n.end - n.start
        if covered != len(lines):
            problems.append(
                f"{path.name}: покрыто {covered} строк из {len(lines)}"
            )

    # --- Constraints / OCL / таблицы / ссылки ---
    for node in all_nodes:
        lines = file_lines[node.file]
        text = body_text(node, lines)
        node.own_chars = len(node.own_text)
        desc = descendants(node)
        cons = [d for d in desc if d.title.lower().startswith("constraints")]
        node.has_constraints = bool(cons)
        node.constraint_nodes = [c.id for c in cons]
        node.ocl_blocks = count_ocl(text)
        node.inv_lines = len(INV_RE.findall(text))
        node.tables = count_tables(text)
        resolved, unresolved = extract_refs(strip_fences(text), known_numbers)
        # Ссылка на самого себя и на предков — шум: убираем.
        ancestors = set()
        p = node.parent
        while p:
            ancestors.add(p.number)
            p = p.parent
        node.refs = [r for r in resolved if r != node.number and r not in ancestors]
        node.refs_unresolved = [u for u in unresolved if u != node.number]
        node.chars_subtree = len(text)
        node.lines = node.end - node.start

    # --- сборка JSON ---
    def to_json(node: Node) -> dict:
        return {
            "id": node.id,
            "number": node.number,
            "title": node.title,
            "level": node.level,
            "section": node.section,
            "file": node.file,
            "lines": [node.start + 1, node.end],
            "chars": node.own_chars,
            "charsSubtree": node.chars_subtree,
            "constraints": node.has_constraints,
            "constraintNodes": node.constraint_nodes,
            "oclBlocks": node.ocl_blocks,
            "invLines": node.inv_lines,
            "tables": node.tables,
            "refs": node.refs,
            "refsUnresolved": node.refs_unresolved,
            "children": [to_json(c) for c in node.children],
        }

    tops = [n for n in all_nodes if n.parent is None]
    tree_sections = [to_json(n) for n in tops]

    total_chars = sum(len(t) for t in file_texts.values())
    total_lines = sum(len(t.split("\n")) for t in file_texts.values())
    subtree_sum = sum(n.chars_subtree for n in tops)

    # --- нарезка по разделам верхнего уровня ---
    #
    # Текст файла режется по строкам. Соседние куски соединяются переводом
    # строки, поэтому склейка кусков обязана дать ровно исходный файл, а
    # сумма символов кусков — совпасть с суммой символов источника. Оба
    # равенства проверяются по прочитанным с диска файлам, а не по длинам,
    # посчитанным при нарезке.
    slice_report = []
    unit_report = []
    if not args.no_slice:
        sections_dir.mkdir(parents=True, exist_ok=True)
        units_dir.mkdir(parents=True, exist_ok=True)
        for name in sorted(units_dir.glob("*.md")):
            name.unlink()  # нарезка детерминирована: старые куски не копятся
        for n in tops:
            lines = file_lines[n.file]
            chunk = "\n".join(lines[n.start:n.end])
            name = f"{n.number.replace(' ', '-').lower()}-{slugify(n.title)}.md"
            target = sections_dir / name
            target.write_text(chunk, encoding="utf-8")
            written = target.read_text(encoding="utf-8")
            if written != chunk:
                problems.append(f"{name}: файл на диске не совпал с куском источника")
            slice_report.append({
                "file": f"spec-sections/{name}",
                "number": n.number,
                "title": n.title,
                "chars": len(written),
                "bytes": target.stat().st_size,
            })

            # Подразделы второго уровня — для разделов, которые целиком
            # грузить в браузер дорого.
            if len(chunk.encode("utf-8")) < args.units_min_bytes:
                continue
            children = sorted(n.children, key=lambda c: c.start)
            pieces: list[str] = []
            pieces.append("\n".join(lines[n.start:children[0].start if children else n.end]))
            for c in children:
                pieces.append("\n".join(lines[c.start:c.end]))
            if "\n".join(pieces) != chunk:
                problems.append(f"{n.number}: подразделы не восстанавливают раздел")
                continue
            unit_names = []
            for c, piece in zip(children, pieces[1:]):
                uname = f"{c.number}-{slugify(c.title)}.md"
                (units_dir / uname).write_text(piece + "\n", encoding="utf-8")
                unit_names.append(uname)
            # Файлы подразделов, склеенные подряд, дают раздел плюс один
            # завершающий перевод строки.
            glued = "".join((units_dir / u).read_text(encoding="utf-8") for u in unit_names)
            if glued != "\n".join(pieces[1:]) + "\n":
                problems.append(f"{n.number}: файлы подразделов не склеиваются в раздел")
            unit_report.append({
                "section": n.number,
                "units": len(unit_names),
                "chars": sum(len((units_dir / u).read_text(encoding="utf-8")) for u in unit_names),
            })

    # --- отчёт о полноте ---
    sliced_chars = sum(s["chars"] for s in slice_report)
    completeness = {
        "sourceFiles": len(files),
        "sourceChars": total_chars,
        "sourceLines": total_lines,
        "treeCharsSubtreeSum": subtree_sum,
        "slicedChars": sliced_chars,
        "match": sliced_chars == total_chars,
        "delta": sliced_chars - total_chars,
    }
    if not args.no_slice and sliced_chars != total_chars:
        problems.append(
            f"сумма символов нарезанных разделов {sliced_chars} != источника {total_chars}"
        )

    flat = [n for n in all_nodes]
    stats = {
        "nodes": len(flat),
        "levelCounts": {
            str(lv): sum(1 for n in flat if n.level == lv) for lv in sorted({n.level for n in flat})
        },
        "sections": len(tops),
        "nodesWithConstraints": sum(1 for n in flat if n.has_constraints),
        "constraintSections": sum(1 for n in flat if n.title.lower().startswith("constraints")),
        "oclBlocks": sum(n.ocl_blocks for n in tops),
        "invLines": sum(n.inv_lines for n in tops),
        "tables": sum(n.tables for n in tops),
        "refsResolved": sum(len(n.refs) for n in tops),
        "refsUnresolved": sum(len(n.refs_unresolved) for n in tops),
        "largestSection": max(slice_report, key=lambda s: s["chars"])["number"] if slice_report else None,
        "largestSectionChars": max((s["chars"] for s in slice_report), default=0),
    }

    payload = {
        "schema": SCHEMA,
        "generator": "material/reference-content/parse_spec.py",
        "source": {
            "dir": "reference/spec/md",
            "spec": "UML 2.5.1",
            "documentNumber": "formal/2017-12-05",
            "files": [p.name for p in files],
            "sha256": hashlib.sha256(
                "".join(file_texts[p.name] for p in files).encode("utf-8")
            ).hexdigest(),
        },
        "stats": stats,
        "completeness": completeness,
        "problems": problems,
        "sections": tree_sections,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "spec-tree.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    (out_dir / "spec-sections.json").write_text(
        json.dumps(
            {
                "schema": "uml-spec-sections/1",
                "sourceChars": total_chars,
                "slicedChars": sliced_chars,
                "match": completeness["match"],
                "sections": slice_report,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"разделов: {stats['sections']}, узлов: {stats['nodes']}, уровни: {stats['levelCounts']}")
    print(f"символов в источнике: {total_chars}, в нарезке: {sliced_chars}, "
          f"совпало: {completeness['match']} (дельта {completeness['delta']})")
    print(f"Constraints-подразделов: {stats['constraintSections']}, "
          f"OCL-блоков: {stats['oclBlocks']}, таблиц: {stats['tables']}, "
          f"ссылок: {stats['refsResolved']} разрешено / {stats['refsUnresolved']} нет")
    if problems:
        print("ПРОБЛЕМЫ:", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
