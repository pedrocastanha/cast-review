import re

from app.code_graph.models import Graph

HUNK_HEADER = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def parse_added_ranges(diff: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for line in diff.splitlines():
        match = HUNK_HEADER.match(line)
        if match is None:
            continue
        start = int(match.group(1))
        raw_count = match.group(2)
        count = 1 if raw_count is None else int(raw_count)
        ranges.append((start, start if count == 0 else start + count - 1))
    return ranges


def removed_identifiers(diff: str) -> set[str]:
    names: set[str] = set()
    for line in diff.splitlines():
        if not line.startswith("-") or line.startswith("---"):
            continue
        names.update(IDENTIFIER.findall(line))
    return names


def changed_symbol_ids(graph: Graph, changed_files: list[dict]) -> set[str]:
    ranges_by_path: dict[str, list[tuple[int, int]]] = {}
    for item in changed_files:
        path = str(item.get("path") or "")
        if not path:
            continue
        ranges_by_path[path] = parse_added_ranges(str(item.get("diff") or ""))

    ids: set[str] = set()
    for symbol in graph.nodes.values():
        ranges = ranges_by_path.get(symbol.path)
        if ranges is None:
            continue
        if symbol.kind == "file" or not ranges:
            ids.add(symbol.id)
            continue
        if any(symbol.line <= end and symbol.end_line >= start for start, end in ranges):
            ids.add(symbol.id)
    return ids
