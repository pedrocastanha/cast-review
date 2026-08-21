from app.code_graph.graph import is_test_path
from app.code_graph.models import DeadCodeResult, Edge, Graph, Symbol

DEFAULT_ENTRYPOINT_DECORATOR_PATTERNS = [
    "Controller",
    "Get",
    "Post",
    "Put",
    "Delete",
    "Patch",
    "route",
    "get",
    "post",
]

INDEX_FILENAMES = ("index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py")
ENTRYPOINT_NAMES = {"main"}

DEAD_CODE_KINDS = ("function", "class", "method")


def find_dead_candidates(
    graph: Graph,
    decorator_patterns: list[str] | None = None,
) -> DeadCodeResult:
    patterns = decorator_patterns if decorator_patterns is not None else DEFAULT_ENTRYPOINT_DECORATOR_PATTERNS
    incoming: dict[str, list[Edge]] = {}
    for edge in graph.edges:
        if edge.kind == "references":
            incoming.setdefault(edge.to_id, []).append(edge)

    dead: list[Symbol] = []
    only_tested: list[Symbol] = []

    for symbol in graph.nodes.values():
        if symbol.kind not in DEAD_CODE_KINDS:
            continue
        refs = incoming.get(symbol.id, [])
        if not refs:
            if not _is_entrypoint(symbol, patterns):
                dead.append(symbol)
            continue
        if _all_callers_are_tests(refs, graph):
            only_tested.append(symbol)

    return DeadCodeResult(dead=dead, only_tested=only_tested)


def _is_entrypoint(symbol: Symbol, decorator_patterns: list[str]) -> bool:
    if symbol.name in ENTRYPOINT_NAMES:
        return True
    basename = symbol.path.rsplit("/", 1)[-1]
    if basename in INDEX_FILENAMES:
        return True
    return any(pattern in decorator for decorator in symbol.decorators for pattern in decorator_patterns)


def _caller_path(from_id: str, graph: Graph) -> str:
    node = graph.nodes.get(from_id)
    return node.path if node is not None else from_id


def _all_callers_are_tests(refs: list[Edge], graph: Graph) -> bool:
    return all(is_test_path(_caller_path(edge.from_id, graph)) for edge in refs)
