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


@pytest.mark.asyncio
async def test_node_uses_frozen_context_without_querying_graph(monkeypatch):
    def must_not_query():
        raise AssertionError("frozen context must not query the live graph")

    monkeypatch.setattr(
        "app.graph.nodes.change_analyzer.agent._get_index_cache", must_not_query
    )
    frozen = {
        "schemaVersion": "1",
        "snapshotHash": "hash-1",
        "rendered": {
            "relatedContext": {
                "callers": [{"path": "src/caller.ts", "name": "caller", "signature": "caller()"}],
                "callees": [],
                "tests": [],
                "deadCodeCandidates": [],
                "repoMap": "",
                "stats": {"indexed": True},
            },
            "graphContextBlock": "## Callers",
        },
    }
    state = {
        "changed_files": [{"path": "src/a.ts"}],
        "diff": "",
        "repo_id": "owner/repo",
        "sha": "sha1",
        "frozen_context": {"graphSnapshot": frozen},
    }

    result = await node(state)

    assert result["change_analysis"]["graphSnapshot"] == frozen
    assert result["change_analysis"]["relatedContext"] == frozen["rendered"]["relatedContext"]


@pytest.mark.asyncio
async def test_project_mode_falls_back_to_local_snapshot_when_project_graph_fails(monkeypatch):
    local_snapshot = {
        "schemaVersion": "1",
        "snapshotHash": "local-hash",
        "repository": {"repoId": "cast/backend"},
        "graph": {},
        "input": {"diffHash": "", "diff": "", "changedFiles": [], "conventions": ""},
        "selected": {
            "nodes": [],
            "changedSymbols": [],
            "callers": [],
            "callees": [],
            "tests": [],
            "deadCodeCandidates": [],
            "repoMap": "",
        },
        "edges": [],
        "budget": {},
        "rendered": {"relatedContext": {"callers": []}, "graphContextBlock": ""},
    }

    async def local(_state):
        return {"callers": []}, local_snapshot

    def graph_down():
        raise RuntimeError("neo4j unavailable")

    monkeypatch.setattr("app.graph.nodes.change_analyzer.agent._local_graph_context", local)
    monkeypatch.setattr("app.graph.nodes.change_analyzer.agent._get_index_cache", graph_down)
    state = {
        "run_id": "analysis-1",
        "changed_files": [],
        "diff": "",
        "repo_id": "cast/backend",
        "sha": "head-sha",
        "base_sha": "base-sha",
        "impact_scope": {
            "requestedMode": "project",
            "effectiveMode": "project",
            "status": "exact",
            "projectId": "project-1",
            "projectName": "Cast",
            "fallbackReason": None,
            "repositories": [
                {
                    "repoId": "cast/frontend",
                    "indexedSha": "front-sha",
                    "indexStatus": "indexed",
                    "included": True,
                    "omissionReason": None,
                }
            ],
        },
    }

    result = await node(state)
    snapshot = result["change_analysis"]["graphSnapshot"]

    assert snapshot["schemaVersion"] == "2"
    assert snapshot["scope"]["requestedMode"] == "project"
    assert snapshot["scope"]["effectiveMode"] == "repository"
    assert snapshot["scope"]["status"] == "fallback"
    assert "análise local continuou" in snapshot["scope"]["fallbackReason"]
    assert result["change_analysis"]["relatedContext"]["callers"] == []
