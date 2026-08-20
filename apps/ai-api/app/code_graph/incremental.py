import hashlib

from app.code_graph.cache import IndexCache
from app.code_graph.graph import build_graph, detect_test_edges
from app.code_graph.indexer import index_files, load_tsconfig_paths
from app.code_graph.models import Graph, Symbol
from app.config.settings import CODE_GRAPH_MAX_FILES

TSCONFIG_FILENAME = "tsconfig.json"


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class IncrementalResult:
    def __init__(
        self,
        graph: Graph,
        reparsed_files: int,
        reused_files: int,
        skipped_files: int,
        truncated: bool,
    ):
        self.graph = graph
        self.reparsed_files = reparsed_files
        self.reused_files = reused_files
        self.skipped_files = skipped_files
        self.truncated = truncated


async def build_incremental(cache: IndexCache, repo_id: str, files: list[dict]) -> IncrementalResult:
    """Reindexes only files whose content hash differs from the previous build
    (CGC-13) — everything else is carried forward from the old graph without
    re-running tree-sitter. Cross-file resolution (a *changed* file calling into an
    *unchanged* one) still works: unchanged symbols are seeded into `build_graph`'s
    name-resolution index via `reused_symbols`, even though they get no new `defines`
    edge from this pass (that edge already exists, carried forward below).

    CGC-15: caps total file count before anything else runs — a monorepo above the
    limit gets a deterministic (sorted-by-path) subset, not an attempt at the whole
    thing that risks timing out or exhausting memory."""
    file_limit_truncated = len(files) > CODE_GRAPH_MAX_FILES
    if file_limit_truncated:
        files = sorted(files, key=lambda f: f["path"])[:CODE_GRAPH_MAX_FILES]

    old_sha = await cache.get_latest_sha(repo_id)
    old_graph = await cache.lookup(repo_id, old_sha) if old_sha else None

    old_hash_by_path: dict[str, str] = {}
    if old_graph:
        for symbol in old_graph.nodes.values():
            if symbol.kind == "file":
                old_hash_by_path[symbol.path] = symbol.content_hash

    file_hashes = {file["path"]: content_hash(file["content"]) for file in files}

    paths_missing_structure = {
        symbol.path
        for symbol in old_graph.nodes.values()
        if symbol.kind == "method" and symbol.parent_id is None
    } if old_graph else set()
    changed_files = [
        file
        for file in files
        if old_hash_by_path.get(file["path"]) != file_hashes[file["path"]]
        or file["path"] in paths_missing_structure
    ]
    unchanged_paths = {file["path"] for file in files} - {file["path"] for file in changed_files}

    tsconfig_paths: dict[str, list[str]] = {}
    for file in files:
        if file["path"].endswith(TSCONFIG_FILENAME):
            tsconfig_paths = load_tsconfig_paths(file["content"])
            break

    parsed, skipped = index_files(changed_files)

    reused_symbols: list[Symbol] = []
    if old_graph:
        reused_symbols = [s for s in old_graph.nodes.values() if s.path in unchanged_paths]

    graph = build_graph(parsed, tsconfig_paths, file_hashes, reused_symbols)

    if old_graph:
        graph = _merge_reused_edges(graph, old_graph, unchanged_paths)

    graph = detect_test_edges(graph)

    return IncrementalResult(
        graph=graph,
        reparsed_files=len(parsed),
        reused_files=len(unchanged_paths),
        skipped_files=skipped,
        truncated=file_limit_truncated,
    )


def _merge_reused_edges(graph: Graph, old_graph: Graph, unchanged_paths: set[str]) -> Graph:
    """Carries forward `defines`/`references`/`imports` edges owned by unchanged
    files. `tests` edges are NOT carried over directly — `detect_test_edges` (called
    right after this) regenerates them from the merged `references`/`imports` set, so
    copying old `tests` edges here would just double them up."""
    merged_edges = list(graph.edges)
    for edge in old_graph.edges:
        if edge.kind == "tests":
            continue
        source = old_graph.nodes.get(edge.from_id)
        source_path = source.path if source else edge.from_id
        if source_path in unchanged_paths:
            merged_edges.append(edge)
    return Graph(nodes=graph.nodes, edges=merged_edges)
