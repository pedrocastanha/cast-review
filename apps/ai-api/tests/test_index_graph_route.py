import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


def _cleanup(repo_id):
    import asyncio

    from app.code_graph.cache import build_neo4j_driver

    async def go():
        driver = build_neo4j_driver()
        async with driver.session() as session:
            await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
            await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await driver.close()

    asyncio.run(go())


def test_index_graph_not_indexed_returns_empty_with_indexed_false(repo_id):
    with TestClient(app) as client:
        response = client.get("/index/graph", params={"repoId": repo_id, "sha": "sha1"})

    assert response.status_code == 200
    body = response.json()
    assert body["stats"]["indexed"] is False
    assert body["nodes"] == []


def test_index_graph_overview_after_build(repo_id):
    with TestClient(app) as client:
        client.post(
            "/index/build",
            json={
                "repoId": repo_id,
                "sha": "sha1",
                "files": [
                    {"path": "src/a.ts", "content": "import { b } from './b';\nfunction a() { return b(); }\n"},
                    {"path": "src/b.ts", "content": "function b() { return 1; }\n"},
                ],
            },
        )
        response = client.get("/index/graph", params={"repoId": repo_id, "sha": "sha1"})

    assert response.status_code == 200
    body = response.json()
    assert body["stats"]["indexed"] is True
    labels = {n["label"] for n in body["nodes"]}
    assert "a" in labels
    assert "b" in labels

    _cleanup(repo_id)


def test_index_graph_focus_expands_neighborhood(repo_id):
    with TestClient(app) as client:
        client.post(
            "/index/build",
            json={
                "repoId": repo_id,
                "sha": "sha1",
                "files": [
                    {"path": "src/a.ts", "content": "import { b } from './b';\nfunction a() { return b(); }\n"},
                    {"path": "src/b.ts", "content": "function b() { return 1; }\n"},
                    {"path": "src/unrelated.ts", "content": "function unrelated() { return 1; }\n"},
                ],
            },
        )
        overview = client.get("/index/graph", params={"repoId": repo_id, "sha": "sha1"}).json()
        fn_b_id = next(n["id"] for n in overview["nodes"] if n["label"] == "b")

        response = client.get(
            "/index/graph", params={"repoId": repo_id, "sha": "sha1", "focus": fn_b_id, "depth": 1}
        )

    assert response.status_code == 200
    body = response.json()
    labels = {n["label"] for n in body["nodes"]}
    assert "b" in labels
    assert "a" in labels
    assert "unrelated" not in labels

    _cleanup(repo_id)
