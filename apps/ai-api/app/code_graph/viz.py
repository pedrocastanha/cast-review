from app.code_graph.models import Graph, IndexStats, VizEdge, VizGraph, VizNode

DEFAULT_MAX_NODES = 100

OVERVIEW_EDGE_KINDS = ("references", "imports", "tests")
NEIGHBORHOOD_EDGE_KINDS = ("references", "imports", "tests", "defines")

MODULE_ID_PREFIX = "module::"
SELF_SUFFIX = "::__files__"


def _viz_node(symbol) -> VizNode:
    return VizNode(
        id=symbol.id,
        label=symbol.name,
        kind=symbol.kind,
        path=symbol.path,
        parentId=symbol.parent_id,
    )


def _directory_of(path: str) -> str:
    parts = path.rsplit("/", 1)
    return parts[0] if len(parts) > 1 else "(root)"


def _prefix_at_depth(directory: str, depth: int) -> str:
    parts = directory.split("/")
    return "/".join(parts[:depth]) if len(parts) > depth else directory


def _stats(graph: Graph, truncated: bool = False) -> IndexStats:
    return IndexStats(
        indexed=True,
        indexedFiles=len({s.path for s in graph.nodes.values()}),
        truncated=truncated,
    )


def serialize_overview(graph: Graph, max_nodes: int = DEFAULT_MAX_NODES) -> VizGraph:
    """Full symbol-level graph when it's small enough to render directly; above
    `max_nodes`, returns the WHOLE directory tree as module nodes at every depth
    (CGC-22) — every directory from the repo root down to each leaf directory, all in
    one response, so the frontend can render it as one nested/collapsible tree instead
    of a single flat level. Symbol-level content of a leaf directory is still loaded
    on demand via `expand_neighborhood` (rendered in-place once the user opens that
    leaf) — sending every function/method up front for a repo with thousands of
    symbols would freeze the browser, the original reason aggregation exists at all.

    User feedback testing a real large repo, after the one-level-at-a-time drill-down
    (Decisão E7) still required navigating away per click: "na página inicial, já
    mostrar TUDO, organizado de forma hierárquica" — confirmed with the user that
    "tudo" means the full directory tree, not every symbol (repo this size would
    freeze the layout with hundreds+ of individual functions rendered eagerly)."""
    if len(graph.nodes) <= max_nodes:
        nodes = [_viz_node(s) for s in graph.nodes.values()]
        edges = [
            VizEdge(source=e.from_id, target=e.to_id, kind=e.kind)
            for e in graph.edges
            if e.kind in OVERVIEW_EDGE_KINDS
        ]
        return VizGraph(nodes=nodes, edges=edges, stats=_stats(graph))

    return _serialize_directory_tree(graph)


def _serialize_directory_tree(graph: Graph) -> VizGraph:
    """Every directory in the tree (root down to leaf) as a `module` node — no
    inter-module edges (CGC-22 aggregated overview normally carries cross-directory
    reference edges, but at every nesting level simultaneously the same underlying
    edge would have to be drawn once per level it crosses, which is more clutter than
    signal for a tree meant to convey containment). Real reference/import/test edges
    still show up once a leaf directory is expanded into its actual symbols."""
    own_count: dict[str, int] = {}
    for s in graph.nodes.values():
        d = _directory_of(s.path)
        own_count[d] = own_count.get(d, 0) + 1

    all_dirs: set[str] = set()
    for leaf_dir in own_count:
        parts = leaf_dir.split("/")
        for i in range(1, len(parts) + 1):
            all_dirs.add("/".join(parts[:i]))

    children_of: dict[str, set[str]] = {d: set() for d in all_dirs}
    for d in all_dirs:
        if "/" in d:
            parent = d.rsplit("/", 1)[0]
            children_of[parent].add(d)

    subtree_count_cache: dict[str, int] = {}

    def subtree_count(d: str) -> int:
        if d not in subtree_count_cache:
            subtree_count_cache[d] = own_count.get(d, 0) + sum(subtree_count(c) for c in children_of[d])
        return subtree_count_cache[d]

    nodes: list[VizNode] = []
    for directory in all_dirs:
        has_children = bool(children_of[directory])
        has_own = directory in own_count
        if not has_children:
            nodes.append(
                VizNode(id=f"{MODULE_ID_PREFIX}{directory}", label=directory, kind="module", path=directory, count=own_count.get(directory, 0))
            )
            continue

        nodes.append(
            VizNode(id=f"{MODULE_ID_PREFIX}{directory}", label=directory, kind="module", path=directory, count=subtree_count(directory))
        )
        if has_own:
            nodes.append(
                VizNode(
                    id=f"{MODULE_ID_PREFIX}{directory}{SELF_SUFFIX}",
                    label=directory,
                    kind="module",
                    path=directory,
                    count=own_count[directory],
                )
            )

    return VizGraph(nodes=nodes, edges=[], stats=_stats(graph, truncated=True))


def _build_module_graph(graph: Graph, bucket_of: dict[str, str]) -> VizGraph:
    """Shared aggregation: one `module` node per distinct bucket in `bucket_of`, one
    edge per pair of buckets connected by an `OVERVIEW_EDGE_KINDS` edge (same-bucket
    edges dropped — they'd be a self-loop carrying no information, CGC-22 style)."""
    counts: dict[str, int] = {}
    for bucket in bucket_of.values():
        counts[bucket] = counts.get(bucket, 0) + 1

    nodes = [
        VizNode(id=f"{MODULE_ID_PREFIX}{bucket}", label=bucket.removesuffix(SELF_SUFFIX), kind="module", path=bucket, count=count)
        for bucket, count in counts.items()
    ]

    edge_set: set[tuple[str, str, str]] = set()
    for edge in graph.edges:
        if edge.kind not in OVERVIEW_EDGE_KINDS:
            continue
        src_bucket = bucket_of.get(edge.from_id)
        dst_bucket = bucket_of.get(edge.to_id)
        if src_bucket is None or dst_bucket is None or src_bucket == dst_bucket:
            continue
        edge_set.add((f"{MODULE_ID_PREFIX}{src_bucket}", f"{MODULE_ID_PREFIX}{dst_bucket}", edge.kind))

    edges = [VizEdge(source=source, target=target, kind=kind) for source, target, kind in edge_set]
    return VizGraph(nodes=nodes, edges=edges, stats=_stats(graph))


def expand_neighborhood(graph: Graph, focus_id: str, depth: int = 1) -> VizGraph:
    """Symbol-level (never aggregated) subgraph within `depth` hops of `focus_id`,
    either direction — how a user drills from an overview module node (or another
    symbol) into what's actually connected to it (CGC-23).

    `focus_id` starting with `module::` (an aggregated overview node, CGC-22) is a
    special case, not a real `Symbol.id` — edge-based traversal below would never find
    it in `graph.nodes` and silently return an empty graph (caught live: clicking a
    module node in a real large-repo overview returned nothing, no error, just blank).
    Drills one directory level deeper instead of walking edges."""
    if focus_id.startswith(MODULE_ID_PREFIX):
        return _expand_module(graph, focus_id[len(MODULE_ID_PREFIX) :])

    adjacency: dict[str, list[str]] = {}
    for edge in graph.edges:
        if edge.kind not in NEIGHBORHOOD_EDGE_KINDS:
            continue
        adjacency.setdefault(edge.from_id, []).append(edge.to_id)
        adjacency.setdefault(edge.to_id, []).append(edge.from_id)

    if focus_id not in graph.nodes:
        return VizGraph(nodes=[], edges=[], stats=_stats(graph))

    visited = {focus_id}
    frontier = {focus_id}
    for _ in range(depth):
        next_frontier: set[str] = set()
        for node_id in frontier:
            for neighbor in adjacency.get(node_id, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    next_frontier.add(neighbor)
        frontier = next_frontier

    nodes = [_viz_node(symbol) for symbol_id, symbol in graph.nodes.items() if symbol_id in visited]
    edges = [
        VizEdge(source=edge.from_id, target=edge.to_id, kind=edge.kind)
        for edge in graph.edges
        if edge.kind in NEIGHBORHOOD_EDGE_KINDS and edge.from_id in visited and edge.to_id in visited
    ]
    return VizGraph(nodes=nodes, edges=edges, stats=_stats(graph))


def _expand_module(graph: Graph, directory: str) -> VizGraph:
    """Drill-down for an aggregated module node. Two cases:

    1. `directory` still has subdirectories beneath it in the real tree -> descend one
       level: one module node per immediate child directory, plus (if this directory
       also has files of its own, not just subdirs) one more node for those, tagged
       `SELF_SUFFIX` so a second click on it doesn't re-run this same branch forever.
    2. `directory` is a leaf (no subdirectories left) -> show its actual symbols
       (`_expand_leaf_directory`), same as before this directory had children to peel off."""
    if directory.endswith(SELF_SUFFIX):
        return _expand_leaf_directory(graph, directory.removesuffix(SELF_SUFFIX))

    depth = directory.count("/") + 1
    child_depth = depth + 1

    bucket_of: dict[str, str] = {}
    has_own_symbols = False
    for sid, s in graph.nodes.items():
        leaf_dir = _directory_of(s.path)
        if leaf_dir == directory:
            has_own_symbols = True
            bucket_of[sid] = f"{directory}{SELF_SUFFIX}"
        elif leaf_dir.startswith(f"{directory}/"):
            bucket_of[sid] = _prefix_at_depth(leaf_dir, child_depth)

    has_children = any(not bucket.endswith(SELF_SUFFIX) for bucket in bucket_of.values())
    if not has_children:
        return _expand_leaf_directory(graph, directory)

    if not has_own_symbols:
        bucket_of = {sid: bucket for sid, bucket in bucket_of.items() if not bucket.endswith(SELF_SUFFIX)}

    return _build_module_graph(graph, bucket_of)


def _expand_leaf_directory(graph: Graph, directory: str) -> VizGraph:
    """Every symbol physically inside `directory` (a leaf — no subdirectories left to
    peel off), plus edges between them. Doesn't show edges leaving the directory (a
    symbol here calling one in a different, still-collapsed module) — acceptable for a
    drill-down leaf: the user goes back up and into the neighboring branch separately
    rather than this view trying to show everything connected at once."""
    symbol_ids_in_dir = {sid for sid, s in graph.nodes.items() if _directory_of(s.path) == directory}

    nodes = [_viz_node(symbol) for symbol_id, symbol in graph.nodes.items() if symbol_id in symbol_ids_in_dir]
    edges = [
        VizEdge(source=edge.from_id, target=edge.to_id, kind=edge.kind)
        for edge in graph.edges
        if edge.kind in NEIGHBORHOOD_EDGE_KINDS
        and edge.from_id in symbol_ids_in_dir
        and edge.to_id in symbol_ids_in_dir
    ]
    return VizGraph(nodes=nodes, edges=edges, stats=_stats(graph))
