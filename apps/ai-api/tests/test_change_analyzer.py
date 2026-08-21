import pytest

from app.graph.nodes.change_analyzer import analyze_changes
from app.graph.nodes.change_analyzer.agent import node

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


@pytest.mark.asyncio
async def test_node_related_context_none_when_repo_id_missing():
    state = {"changed_files": [{"path": "src/a.ts"}], "diff": "", "sha": "sha1"}
    result = await node(state)
    assert result["change_analysis"]["relatedContext"] is None


@pytest.mark.asyncio
async def test_node_related_context_none_when_sha_missing():
    state = {"changed_files": [{"path": "src/a.ts"}], "diff": "", "repo_id": "owner/repo"}
    result = await node(state)
    assert result["change_analysis"]["relatedContext"] is None


@pytest.mark.asyncio
async def test_node_related_context_degrades_to_none_on_exception(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("neo4j unreachable")

    monkeypatch.setattr("app.code_graph.context.assemble_related_context", boom)

    state = {
        "changed_files": [{"path": "src/a.ts"}],
        "diff": "",
        "repo_id": "owner/repo",
        "sha": "sha1",
    }
    result = await node(state)
    assert result["change_analysis"]["relatedContext"] is None
