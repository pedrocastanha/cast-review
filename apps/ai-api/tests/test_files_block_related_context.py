from app.graph.utils.files import files_block


def test_files_block_without_related_context_unchanged():
    result = files_block([{"path": "a.ts", "diff": "", "fullContent": "x"}])
    assert "Callers" not in result
    assert "Repo map" not in result


def test_files_block_renders_callers_section():
    related = {
        "callers": [{"path": "a.ts", "name": "a", "signature": "function a()", "body": "function a() { b() }"}],
        "callees": [],
        "tests": [],
        "deadCodeCandidates": [],
        "repoMap": "",
    }
    result = files_block([{"path": "b.ts", "diff": "", "fullContent": "x"}], related)
    assert "## Callers" in result
    assert "a.ts::a" in result
    assert "function a() { b() }" in result


def test_files_block_renders_callees_and_tests_and_repo_map():
    related = {
        "callers": [],
        "callees": [{"path": "c.ts", "name": "c", "signature": "function c()", "body": None}],
        "tests": [{"path": "b.test.ts", "name": "b", "signature": "test('b')", "body": "test('b') { ... }"}],
        "deadCodeCandidates": [{"path": "d.ts", "name": "d", "signature": "function d()", "body": None}],
        "repoMap": "function e(): void",
    }
    result = files_block([{"path": "b.ts", "diff": "", "fullContent": "x"}], related)
    assert "## Callees" in result
    assert "function c()" in result  # falls back to signature when body is None
    assert "## Tests" in result
    assert "b.test.ts::b" in result
    assert "## Possível código morto" in result
    assert "d.ts::d" in result
    assert "## Repo map" in result
    assert "function e(): void" in result


def test_files_block_renders_only_tested_candidates_as_their_own_section():
    related = {
        "callers": [],
        "callees": [],
        "tests": [],
        "deadCodeCandidates": [],
        "onlyTestedCandidates": [
            {"path": "src/foo.ts", "name": "foo", "signature": "function foo()", "body": None}
        ],
        "repoMap": "",
    }
    result = files_block([{"path": "src/foo.ts", "diff": "", "fullContent": "x"}], related)

    assert "## Coberto apenas por teste" in result
    assert "src/foo.ts::foo" in result


def test_files_block_skips_related_context_block_when_all_sections_empty():
    related = {"callers": [], "callees": [], "tests": [], "deadCodeCandidates": [], "repoMap": ""}
    result = files_block([{"path": "a.ts", "diff": "", "fullContent": "x"}], related)
    assert "Callers" not in result
    assert "Repo map" not in result


def test_files_block_related_context_none_is_safe():
    result = files_block([{"path": "a.ts", "diff": "", "fullContent": "x"}], None)
    assert "Callers" not in result
