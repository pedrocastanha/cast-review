from app.graph.nodes.change_analyzer import analyze_changes

def test_classifies_tests_migrations_and_source():
    result = analyze_changes(
        [
            {"path": "src/offers/offers.service.ts"},
            {"path": "src/offers/offers.service.spec.ts"},
            {"path": "src/shared/database/migrations/001-Init.ts"},
        ]
    )

    kinds = {item["path"]: item["kind"] for item in result["files"]}
    assert kinds["src/offers/offers.service.ts"] == "source"
    assert kinds["src/offers/offers.service.spec.ts"] == "test"
    assert kinds["src/shared/database/migrations/001-Init.ts"] == "migration"
    assert result["hasTests"] is True
    assert result["hasMigration"] is True

def test_no_tests_and_no_migrations():
    result = analyze_changes([{"path": "src/app.module.ts"}])
    assert result["hasTests"] is False
    assert result["hasMigration"] is False

def test_detects_python_and_js_test_filenames():
    result = analyze_changes(
        [
            {"path": "tests/test_scoring.py"},
            {"path": "src/hooks/useRun.test.ts"},
        ]
    )
    assert result["hasTests"] is True
    assert all(item["kind"] == "test" for item in result["files"])
