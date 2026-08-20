from app.code_graph.indexer import resolve_import
from app.code_graph.models import Edge, Graph, ParsedSymbols, Symbol

TEST_DIR_MARKERS = ("/test/", "/tests/", "/__tests__/")
TEST_NAME_MARKERS = (".test.", ".spec.", "_test.", "test_")


def is_test_path(path: str) -> bool:
    lower = path.lower()
    name = lower.rsplit("/", 1)[-1]
    return any(marker in lower for marker in TEST_DIR_MARKERS) or any(
        marker in name for marker in TEST_NAME_MARKERS
    )


def _file_symbol(path: str) -> Symbol:
    name = path.rsplit("/", 1)[-1]
    return Symbol(id=path, kind="file", path=path, name=name, line=1, end_line=1, signature=path)


def build_graph(
    parsed_files: list[ParsedSymbols],
    tsconfig_paths: dict[str, list[str]] | None = None,
) -> Graph:
    known_paths = {p.path for p in parsed_files}
    nodes: dict[str, Symbol] = {}
    edges: list[Edge] = []
    symbol_by_name: dict[str, list[Symbol]] = {}

    for parsed in parsed_files:
        file_symbol = _file_symbol(parsed.path)
        nodes[file_symbol.id] = file_symbol
        for symbol in parsed.symbols:
            nodes[symbol.id] = symbol
            symbol_by_name.setdefault(symbol.name, []).append(symbol)
            edges.append(Edge(from_id=file_symbol.id, to_id=symbol.id, kind="defines"))

    resolved_imports_by_file: dict[str, set[str]] = {}
    for parsed in parsed_files:
        resolved = set()
        for raw_import in parsed.imports:
            target = resolve_import(raw_import, parsed.path, known_paths, tsconfig_paths)
            if target:
                resolved.add(target)
                edges.append(Edge(from_id=parsed.path, to_id=target, kind="imports"))
        resolved_imports_by_file[parsed.path] = resolved

    for parsed in parsed_files:
        preferred_files = resolved_imports_by_file.get(parsed.path, set())
        for call in parsed.calls:
            callee_symbol = _resolve_callee(call.callee_name, symbol_by_name, preferred_files)
            if callee_symbol is None:
                continue
            caller_id = call.caller_symbol_id or parsed.path
            edges.append(Edge(from_id=caller_id, to_id=callee_symbol.id, kind="references", weight=1.0))

    return Graph(nodes=nodes, edges=edges)


def _resolve_callee(
    name: str,
    symbol_by_name: dict[str, list[Symbol]],
    preferred_files: set[str],
) -> Symbol | None:
    candidates = [s for s in symbol_by_name.get(name, []) if s.kind != "file"]
    if not candidates:
        return None
    preferred = [s for s in candidates if s.path in preferred_files]
    if len(preferred) == 1:
        return preferred[0]
    if not preferred and len(candidates) == 1:
        return candidates[0]
    return None


def detect_test_edges(graph: Graph) -> Graph:
    """Adds a parallel `tests` edge for every `references`/`imports` edge whose source
    (caller symbol or file) lives in a test file — kept alongside the original edge
    (not replacing it) so ranking by `references` weight is unaffected."""
    test_edges: list[Edge] = []
    for edge in graph.edges:
        if edge.kind not in ("references", "imports"):
            continue
        source_symbol = graph.nodes.get(edge.from_id)
        source_path = source_symbol.path if source_symbol else edge.from_id
        if is_test_path(source_path):
            test_edges.append(Edge(from_id=edge.from_id, to_id=edge.to_id, kind="tests", weight=edge.weight))
    return Graph(nodes=graph.nodes, edges=graph.edges + test_edges)
