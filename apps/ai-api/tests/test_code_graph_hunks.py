from app.code_graph.graph import build_graph
from app.code_graph.hunks import changed_symbol_ids, parse_added_ranges, removed_identifiers
from app.code_graph.indexer import parse_file

TWO_FUNCTIONS = (
    "function alpha() {\n"
    "  return 1;\n"
    "}\n"
    "\n"
    "function beta() {\n"
    "  return 2;\n"
    "}\n"
)


def test_parse_added_ranges_reads_new_side_of_hunk_header():
    diff = "@@ -1,3 +5,4 @@\n context\n+added\n"

    assert parse_added_ranges(diff) == [(5, 8)]


def test_parse_added_ranges_treats_missing_count_as_single_line():
    diff = "@@ -1 +7 @@\n+added\n"

    assert parse_added_ranges(diff) == [(7, 7)]


def test_parse_added_ranges_anchors_pure_deletion_hunk_at_its_start():
    diff = "@@ -4,2 +3,0 @@\n-removed\n"

    assert parse_added_ranges(diff) == [(3, 3)]


def test_removed_identifiers_ignores_the_file_header_line():
    diff = "--- a/src/x.ts\n+++ b/src/x.ts\n-  return legacyHelper();\n+  return 1;\n"

    names = removed_identifiers(diff)

    assert "legacyHelper" in names
    assert "src" not in names


def test_changed_symbol_ids_keeps_only_symbols_overlapping_a_hunk():
    graph = build_graph([parse_file("src/x.ts", TWO_FUNCTIONS)])
    changed_files = [{"path": "src/x.ts", "diff": "@@ -5,3 +5,3 @@\n-  return 2;\n+  return 3;\n"}]

    ids = changed_symbol_ids(graph, changed_files)
    names = {graph.nodes[symbol_id].name for symbol_id in ids}

    assert "beta" in names
    assert "alpha" not in names


def test_changed_symbol_ids_always_includes_the_file_symbol():
    graph = build_graph([parse_file("src/x.ts", TWO_FUNCTIONS)])
    changed_files = [{"path": "src/x.ts", "diff": "@@ -5,3 +5,3 @@\n-  return 2;\n+  return 3;\n"}]

    assert "src/x.ts" in changed_symbol_ids(graph, changed_files)


def test_changed_symbol_ids_falls_back_to_whole_file_when_diff_is_unusable():
    graph = build_graph([parse_file("src/x.ts", TWO_FUNCTIONS)])

    ids = changed_symbol_ids(graph, [{"path": "src/x.ts", "diff": ""}])
    names = {graph.nodes[symbol_id].name for symbol_id in ids}

    assert "alpha" in names
    assert "beta" in names


def test_changed_symbol_ids_ignores_files_outside_the_pull_request():
    graph = build_graph(
        [parse_file("src/x.ts", TWO_FUNCTIONS), parse_file("src/other.ts", "function gamma() {}\n")]
    )
    changed_files = [{"path": "src/x.ts", "diff": "@@ -1,3 +1,3 @@\n-  return 1;\n+  return 9;\n"}]

    names = {graph.nodes[symbol_id].name for symbol_id in changed_symbol_ids(graph, changed_files)}

    assert "gamma" not in names
