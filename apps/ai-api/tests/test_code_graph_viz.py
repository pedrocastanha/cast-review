from app.code_graph.graph import build_graph, detect_test_edges
from app.code_graph.indexer import parse_file
from app.code_graph.viz import expand_neighborhood, serialize_overview


def _sample_graph():
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "import { c } from './c';\nfunction b() { return c(); }\n")
    c = parse_file("src/c.ts", "function c() { return 1; }\n")
    return build_graph([a, b, c])


def test_serialize_overview_returns_full_graph_when_small():
    graph = _sample_graph()
    viz = serialize_overview(graph, max_nodes=100)

    assert viz.stats.truncated is False
    node_names = {n.label for n in viz.nodes}
    assert {"a", "b", "c"}.issubset(node_names)
    assert any(e.kind == "references" for e in viz.edges)


def test_serialize_overview_excludes_defines_edges():
    graph = _sample_graph()
    viz = serialize_overview(graph, max_nodes=100)
    assert not any(e.kind == "defines" for e in viz.edges)


def test_serialize_overview_returns_the_whole_directory_tree_above_max_nodes():
    """Overview above `max_nodes` returns EVERY directory in the tree at once (root
    down to leaf), not just the top level — the frontend renders it as one nested
    tree; no separate request per level anymore (Decisão E8)."""
    a = parse_file("src/mod1/a.ts", "import { b } from '../mod2/b';\nfunction a() { return b(); }\n")
    b = parse_file("src/mod2/b.ts", "function b() { return 1; }\n")
    graph = build_graph([a, b])

    viz = serialize_overview(graph, max_nodes=1)  # force aggregation with a tiny cap

    assert viz.stats.truncated is True
    kinds = {n.kind for n in viz.nodes}
    assert kinds == {"module"}
    assert {n.id for n in viz.nodes} == {"module::src", "module::src/mod1", "module::src/mod2"}
    # no inter-module edges in the tree view — nesting alone conveys structure
    assert viz.edges == []


def test_expand_neighborhood_still_drills_leaf_modules_from_a_tree_node():
    """The tree already contains every level, but a leaf module node still isn't a
    real `Symbol.id` — `expand_neighborhood` on one of its ids still has to drill into
    real symbols on demand, same as before the full-tree response existed."""
    a = parse_file("src/mod1/a.ts", "import { b } from '../mod2/b';\nfunction a() { return b(); }\n")
    b = parse_file("src/mod2/b.ts", "function b() { return 1; }\n")
    graph = build_graph([a, b])

    viz = expand_neighborhood(graph, "module::src/mod1", depth=1)
    assert {n.label for n in viz.nodes} == {"a", "a.ts"}


def test_serialize_overview_tree_has_no_inter_module_edges():
    """The tree view never carries inter-module edges (Decisão E8) — same-directory
    edges wouldn't be meaningful, and cross-directory edges would have to be drawn
    once per nesting level they cross, which is clutter, not signal."""
    a = parse_file("src/mod/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/mod/b.ts", "function b() { return 1; }\n")
    graph = build_graph([a, b])

    viz = serialize_overview(graph, max_nodes=1)

    assert {n.id for n in viz.nodes} == {"module::src", "module::src/mod"}
    assert viz.edges == []


def test_expand_neighborhood_one_hop():
    graph = _sample_graph()
    fn_b = next(n for n in graph.nodes.values() if n.name == "b" and n.kind == "function")

    viz = expand_neighborhood(graph, fn_b.id, depth=1)
    labels = {n.label for n in viz.nodes}

    assert "b" in labels
    assert "a" in labels  # calls b, 1 hop away
    assert "c" in labels  # b calls c, 1 hop away
    assert "b.ts" in labels  # `defines` included in neighborhood — b's own file
    assert len(labels) == 4


def test_expand_neighborhood_depth_zero_is_just_the_focus_node():
    graph = _sample_graph()
    fn_b = next(n for n in graph.nodes.values() if n.name == "b" and n.kind == "function")

    viz = expand_neighborhood(graph, fn_b.id, depth=0)

    assert len(viz.nodes) == 1
    assert viz.nodes[0].label == "b"
    assert viz.edges == []


def test_expand_neighborhood_class_shows_its_own_methods_at_depth_two():
    """Regression: clicking a class node in the running app expanded to nothing —
    `defines` was excluded from every visualization, and a class only connects to its
    methods *indirectly*, both being `defines`d by the same file (class<-file->method,
    2 hops, not 1 — there's no direct class->method edge in this graph, methods are
    flat siblings under the file, not nested under their class). Caught visually, not
    by a unit test (every prior test focused on a `function`, never a `class`). The
    frontend (`useRepoGraph.ts`) expands at depth=2 for exactly this reason."""
    controller = parse_file(
        "src/controller.ts",
        "class UserController {\n  getUser() { return 1; }\n  createUser() { return 2; }\n}\n",
    )
    graph = build_graph([controller])
    class_symbol = next(n for n in graph.nodes.values() if n.kind == "class")

    viz = expand_neighborhood(graph, class_symbol.id, depth=2)
    labels = {n.label for n in viz.nodes}

    assert "UserController" in labels
    assert "getUser" in labels
    assert "createUser" in labels


def test_leaf_visualization_preserves_method_parent_class():
    controller = parse_file(
        "src/controller.ts",
        "class UserController {\n  getUser() { return 1; }\n}\n",
    )
    graph = build_graph([controller])

    viz = expand_neighborhood(graph, "module::src", depth=1)
    nodes_by_label = {node.label: node for node in viz.nodes}

    assert nodes_by_label["getUser"].parentId == nodes_by_label["UserController"].id


def test_expand_neighborhood_class_alone_at_depth_one_only_reaches_its_file():
    """Documents the 1-hop limitation directly (see test above) — depth=1 from a
    class only reaches its file, not its methods."""
    controller = parse_file(
        "src/controller.ts",
        "class UserController {\n  getUser() { return 1; }\n}\n",
    )
    graph = build_graph([controller])
    class_symbol = next(n for n in graph.nodes.values() if n.kind == "class")

    viz = expand_neighborhood(graph, class_symbol.id, depth=1)
    labels = {n.label for n in viz.nodes}

    assert labels == {"UserController", "controller.ts"}


def test_serialize_overview_still_excludes_defines_edges():
    """`defines` stays excluded from the overview — this is the case E2's original
    reasoning (redundant with directory grouping) actually applies to."""
    graph = _sample_graph()
    viz = serialize_overview(graph, max_nodes=100)
    assert not any(e.kind == "defines" for e in viz.edges)


def test_expand_neighborhood_unknown_focus_returns_empty():
    graph = _sample_graph()
    viz = expand_neighborhood(graph, "ghost-id", depth=1)
    assert viz.nodes == []
    assert viz.edges == []


def test_expand_neighborhood_only_returns_edges_within_visited_set():
    graph = _sample_graph()
    fn_a = next(n for n in graph.nodes.values() if n.name == "a" and n.kind == "function")

    viz = expand_neighborhood(graph, fn_a.id, depth=1)
    node_ids = {n.id for n in viz.nodes}
    for edge in viz.edges:
        assert edge.source in node_ids
        assert edge.target in node_ids


def test_serialize_overview_includes_test_edges():
    prod = parse_file("src/foo.ts", "function foo() { return 1; }\n")
    test = parse_file("src/foo.test.ts", "import { foo } from './foo';\nfoo();\n")
    graph = build_graph([prod, test])
    graph = detect_test_edges(graph)

    viz = serialize_overview(graph, max_nodes=100)
    assert any(e.kind == "tests" for e in viz.edges)
