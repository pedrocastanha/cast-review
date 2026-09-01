from app.code_graph.deadcode import filter_pr_relevant, find_dead_candidates
from app.code_graph.graph import build_graph, detect_test_edges
from app.code_graph.indexer import parse_file


def test_unused_function_is_flagged_dead():
    orphan = parse_file("src/orphan.ts", "function orphan() { return 1; }\n")
    graph = build_graph([orphan])
    result = find_dead_candidates(graph)
    assert any(s.name == "orphan" for s in result.dead)


def test_used_function_is_not_dead():
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "function b() { return 1; }\n")
    graph = build_graph([a, b])
    result = find_dead_candidates(graph)
    assert not any(s.name == "b" for s in result.dead)
    assert not any(s.name == "b" for s in result.only_tested)


def test_decorated_route_is_not_dead_even_without_callers():
    controller = parse_file(
        "src/users.controller.ts",
        "@Controller('users')\nexport class UsersController {\n  @Get()\n  list() {}\n}\n",
    )
    graph = build_graph([controller])
    result = find_dead_candidates(graph)
    dead_names = {s.name for s in result.dead}
    assert "UsersController" not in dead_names
    assert "list" not in dead_names


def test_index_file_export_is_not_dead():
    barrel = parse_file("src/index.ts", "function publicApi() { return 1; }\n")
    graph = build_graph([barrel])
    result = find_dead_candidates(graph)
    assert not any(s.name == "publicApi" for s in result.dead)


def test_main_function_is_not_dead():
    entry = parse_file("src/entry.py", "def main():\n    pass\n")
    graph = build_graph([entry])
    result = find_dead_candidates(graph)
    assert not any(s.name == "main" for s in result.dead)


def test_only_tested_function_is_separate_bucket_not_dead():
    prod = parse_file("src/foo.ts", "function foo() { return 1; }\n")
    test = parse_file("src/foo.test.ts", "import { foo } from './foo';\nfoo();\n")
    graph = build_graph([prod, test])
    graph = detect_test_edges(graph)
    result = find_dead_candidates(graph)
    assert any(s.name == "foo" for s in result.only_tested)
    assert not any(s.name == "foo" for s in result.dead)


def test_filter_pr_relevant_keeps_dead_symbol_whose_last_call_site_the_diff_removed():
    orphan = parse_file("src/orphan.ts", "function orphan() { return 1; }\n")
    graph = build_graph([orphan])
    result = find_dead_candidates(graph)

    filtered = filter_pr_relevant(result, changed_paths={"src/caller.ts"}, removed_names={"orphan"})

    assert any(s.name == "orphan" for s in filtered.dead)


def test_filter_pr_relevant_drops_dead_symbol_untouched_by_the_pull_request():
    orphan = parse_file("src/orphan.ts", "function orphan() { return 1; }\n")
    graph = build_graph([orphan])
    result = find_dead_candidates(graph)

    filtered = filter_pr_relevant(result, changed_paths={"src/other.ts"}, removed_names=set())

    assert filtered.dead == []


def test_filter_pr_relevant_keeps_only_tested_symbol_living_in_a_changed_file():
    prod = parse_file("src/foo.ts", "function foo() { return 1; }\n")
    test = parse_file("src/foo.test.ts", "import { foo } from './foo';\nfoo();\n")
    graph = detect_test_edges(build_graph([prod, test]))
    result = find_dead_candidates(graph)

    filtered = filter_pr_relevant(result, changed_paths={"src/foo.ts"}, removed_names=set())

    assert any(s.name == "foo" for s in filtered.only_tested)


def test_fastapi_style_decorator_recognized_as_entrypoint():
    content = "@router.get('/users')\ndef list_users():\n    pass\n"
    parsed = parse_file("src/routes.py", content)
    graph = build_graph([parsed])
    result = find_dead_candidates(graph)
    assert not any(s.name == "list_users" for s in result.dead)
