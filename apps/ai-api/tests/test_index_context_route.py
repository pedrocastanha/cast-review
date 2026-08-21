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


def test_index_context_returns_not_indexed_when_repo_never_built(repo_id):
    with TestClient(app) as client:
        response = client.post(
            "/index/context",
            json={"repoId": repo_id, "sha": "sha1", "changedFiles": ["src/z.ts"]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["stats"]["indexed"] is False


def test_index_context_returns_callers_after_build(repo_id):
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
        response = client.post(
            "/index/context",
            json={"repoId": repo_id, "sha": "sha1", "changedFiles": ["src/b.ts"]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["stats"]["indexed"] is True
    caller_names = {c["name"] for c in body["callers"]}
    assert "a" in caller_names

    _cleanup(repo_id)
