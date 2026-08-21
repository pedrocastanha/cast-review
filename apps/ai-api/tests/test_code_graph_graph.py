from app.code_graph.graph import build_graph, detect_test_edges
from app.code_graph.indexer import parse_file


def test_build_graph_transitive_call_chain_a_b_c():
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "import { c } from './c';\nfunction b() { return c(); }\n")
    c = parse_file("src/c.ts", "function c() { return 1; }\n")

    graph = build_graph([a, b, c])

    fn_a = next(n for n in graph.nodes.values() if n.name == "a" and n.kind == "function")
    fn_b = next(n for n in graph.nodes.values() if n.name == "b" and n.kind == "function")
    fn_c = next(n for n in graph.nodes.values() if n.name == "c" and n.kind == "function")

    ref_edges = {(e.from_id, e.to_id) for e in graph.edges if e.kind == "references"}
    assert (fn_a.id, fn_b.id) in ref_edges
    assert (fn_b.id, fn_c.id) in ref_edges
    # a and c have no direct relationship — proves transitive reachability, not just 1-hop
    assert (fn_a.id, fn_c.id) not in ref_edges


def test_build_graph_defines_edges_per_file():
    parsed = parse_file("src/foo.ts", "function foo() {}\n")
    graph = build_graph([parsed])
    file_symbol = next(n for n in graph.nodes.values() if n.kind == "file")
    fn = next(n for n in graph.nodes.values() if n.kind == "function")
    assert edge_exists(graph, file_symbol.id, fn.id, "defines")


def test_build_graph_imports_edge_when_resolvable():
    a = parse_file("src/a.ts", "import { b } from './b';\n")
    b = parse_file("src/b.ts", "export function b() {}\n")
    graph = build_graph([a, b])
    assert edge_exists(graph, "src/a.ts", "src/b.ts", "imports")


def test_build_graph_skips_unresolvable_bare_import():
    a = parse_file("src/a.ts", "import React from 'react';\n")
    graph = build_graph([a])
    assert not any(e.kind == "imports" for e in graph.edges)


def test_build_graph_ambiguous_callee_name_no_edge():
    a = parse_file("src/a.ts", "function a() { return helper(); }\n")
    x = parse_file("src/x.ts", "function helper() { return 1; }\n")
    y = parse_file("src/y.ts", "function helper() { return 2; }\n")
    graph = build_graph([a, x, y])
    assert not any(e.kind == "references" for e in graph.edges)


def test_detect_test_edges_adds_parallel_tests_edge():
    prod = parse_file("src/foo.ts", "function foo() { return 1; }\n")
    test = parse_file("src/foo.test.ts", "import { foo } from './foo';\nfoo();\n")
    graph = build_graph([prod, test])
    graph = detect_test_edges(graph)

    fn_foo = next(n for n in graph.nodes.values() if n.name == "foo" and n.kind == "function")
    tests_edges = [e for e in graph.edges if e.kind == "tests" and e.to_id == fn_foo.id]
    assert len(tests_edges) >= 1


def test_detect_test_edges_keeps_original_edges():
    prod = parse_file("src/foo.ts", "function foo() { return 1; }\n")
    test = parse_file("src/foo.test.ts", "import { foo } from './foo';\nfoo();\n")
    graph = build_graph([prod, test])
    edges_before = len(graph.edges)
    graph = detect_test_edges(graph)
    assert len(graph.edges) > edges_before
    assert any(e.kind == "imports" for e in graph.edges)


def edge_exists(graph, from_id, to_id, kind) -> bool:
    return any(e.from_id == from_id and e.to_id == to_id and e.kind == kind for e in graph.edges)
