#!/usr/bin/env python3
"""Подставляет в перевод дословные блоки из оригинала.

В файле перевода блок заменяется строкой-заполнителем:

    @@B:3@@

где 3 — номер ограждённого блока в оригинале (0-based, в порядке появления).
Заполнитель заменяется на строки оригинала от открывающей ограды до
закрывающей включительно, байт в байт. Так OCL и ASCII-арт метамодели не
могут разойтись из-за опечатки при наборе.

Использование:
    python3 material/spec-ru/splice.py 10-simple-classifiers.md
    python3 material/spec-ru/splice.py --check 10-simple-classifiers.md
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = ROOT / "reference" / "spec" / "md"
DST = HERE / "ru"

FENCE = re.compile(r"^\s*```")


def blocks(text):
    """Возвращает список (start, end) — индексы строк ограды, включительно."""
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines):
        if FENCE.match(lines[i]):
            j = i + 1
            while j < len(lines) and not FENCE.match(lines[j]):
                j += 1
            out.append((i, j))
            i = j + 1
        else:
            i += 1
    return lines, out


PLACEHOLDER = re.compile(r"^@@B:(\d+)@@$")


def resync(name):
    """Заменяет n-й ограждённый блок перевода на n-й блок оригинала.

    Нужен, когда заполнители уже подставлены (или перепутаны): структура
    перевода один в один совпадает с оригиналом, поэтому блоки выравниваются
    по порядку. Заодно проверяет, что вид блока (text/ocl) совпадает.
    """
    src = (SRC / name).read_text(encoding="utf-8")
    path = DST / name
    dst = path.read_text(encoding="utf-8")
    slines, sspans = blocks(src)
    dlines, dspans = blocks(dst)
    if len(sspans) != len(dspans):
        print(f"{name}: блоков в переводе {len(dspans)}, в оригинале {len(sspans)} — выравнивание невозможно")
        return 1
    out = []
    pos = 0
    bad = 0
    for k, ((sa, sb), (da, db)) in enumerate(zip(sspans, dspans)):
        skinfo = slines[sa].strip()
        dinfo = dlines[da].strip()
        if skinfo != dinfo:
            print(f"{name}: блок №{k}: вид {dinfo} вместо {skinfo}")
            bad += 1
        out.extend(dlines[pos:da])
        out.extend(slines[sa : sb + 1])
        pos = db + 1
    out.extend(dlines[pos:])
    if bad:
        return 1
    new = "\n".join(out)
    if new != dst:
        path.write_text(new, encoding="utf-8")
        print(f"{name}: выровнено блоков {len(sspans)}")
    else:
        print(f"{name}: блоки уже совпадают ({len(sspans)})")
    return 0


def splice(name, check_only=False):
    src = (SRC / name).read_text(encoding="utf-8")
    dst_path = DST / name
    if not dst_path.exists():
        print(f"{name}: перевода нет")
        return 1
    dst = dst_path.read_text(encoding="utf-8")
    lines, spans = blocks(src)

    out = []
    used = []
    for line in dst.split("\n"):
        m = PLACEHOLDER.match(line.strip())
        if not m:
            out.append(line)
            continue
        n = int(m.group(1))
        if n >= len(spans):
            print(f"{name}: нет блока №{n} (в оригинале {len(spans)})")
            return 1
        a, b = spans[n]
        used.append(n)
        out.extend(lines[a : b + 1])

    if check_only:
        print(f"{name}: блоков {len(spans)}, использовано {len(used)}")
        return 0 if len(used) == len(spans) else 1

    dst_path.write_text("\n".join(out), encoding="utf-8")
    print(f"{name}: подставлено блоков {len(used)} из {len(spans)}")
    return 0 if len(used) == len(spans) else 1


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_only = "--check" in sys.argv
    if "--resync" in sys.argv:
        rc = 0
        for name in args:
            rc |= resync(name)
        return rc
    if not args:
        print(__doc__)
        return 2
    rc = 0
    for name in args:
        rc |= splice(name, check_only)
    return rc


if __name__ == "__main__":
    sys.exit(main())