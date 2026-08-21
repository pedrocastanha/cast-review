from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file
from app.code_graph.viz import expand_neighborhood, serialize_overview


def test_expand_neighborhood_module_id_drills_through_directory_tree_to_symbols():
    """Regression + hierarchy: clicking an aggregated module node in a real large-repo
    overview returned an empty graph, no error — `module::<dir>` isn't a real
    Symbol.id, so edge-based expansion never found it. Caught live (Chrome, real
    indexed repo), not by the unit suite (every prior expand test used a real
    function/class id). Follow-up user feedback: a flat one-hop drill still dumped
    every leaf directory at once — real drill-down should peel one directory level
    per click (`src` -> `src/mod1` -> symbols), matching the actual folder tree."""
    a = parse_file("src/mod1/a.ts", "function a() { return 1; }\n")
    b = parse_file("src/mod1/b.ts", "import { a } from './a';\nfunction b() { return a(); }\n")
    c = parse_file("src/mod2/c.ts", "function c() { return 1; }\n")
    graph = build_graph([a, b, c])

    # force aggregation to get a real `module::` id from the overview response
    overview = serialize_overview(graph, max_nodes=1)
    top_id = next(n.id for n in overview.nodes if n.label == "src")

    # first click: still a directory with children (mod1, mod2) -> one hop deeper,
    # not straight to symbols
    mid = expand_neighborhood(graph, top_id, depth=1)
    mid_labels = {n.label for n in mid.nodes}
    assert mid_labels == {"src/mod1", "src/mod2"}
    mod1_id = next(n.id for n in mid.nodes if n.label == "src/mod1")

    # second click: mod1 is a leaf directory -> real symbols
    viz = expand_neighborhood(graph, mod1_id, depth=1)
    labels = {n.label for n in viz.nodes}

    assert "a" in labels
    assert "b" in labels
    assert "c" not in labels  # different directory, not pulled in
    assert any(e.kind == "references" for e in viz.edges)


def test_expand_neighborhood_module_id_unknown_directory_returns_empty():
    a = parse_file("src/a.ts", "function a() {}\n")
    graph = build_graph([a])

    viz = expand_neighborhood(graph, "module::src/does-not-exist", depth=1)

    assert viz.nodes == []
    assert viz.edges == []


def test_expand_neighborhood_directory_with_both_files_and_subdirs_gets_a_self_bucket():
    """`apps/ai-api` can have files of its own (e.g. `main.py`) AND subdirectories
    (`app/`) at the same time — the self-bucket node (`::__files__` suffix) is what
    keeps those own-files from vanishing when the directory has children to peel off."""
    own = parse_file("apps/ai-api/main.py", "def main():\n    pass\n")
    nested = parse_file("apps/ai-api/app/core.py", "def core():\n    pass\n")
    graph = build_graph([own, nested])

    overview = serialize_overview(graph, max_nodes=1)
    top_id = next(n.id for n in overview.nodes if n.label == "apps")

    mid = expand_neighborhood(graph, top_id, depth=1)
    ai_api_id = next(n.id for n in mid.nodes if n.label == "apps/ai-api")

    children = expand_neighborhood(graph, ai_api_id, depth=1)
    child_labels = {n.label for n in children.nodes}
    assert "apps/ai-api/app" in child_labels
    assert "apps/ai-api" in child_labels  # self-bucket: main.py's own directory

    self_id = next(n.id for n in children.nodes if n.label == "apps/ai-api" and n.id.endswith("__files__"))
    leaf = expand_neighborhood(graph, self_id, depth=1)
    assert {n.label for n in leaf.nodes} == {"main", "main.py"}
