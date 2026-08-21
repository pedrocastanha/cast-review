import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


def test_index_status_never_indexed(repo_id):
    with TestClient(app) as client:
        response = client.get("/index/status", params={"repoId": repo_id})

    assert response.status_code == 200
    assert response.json() == {"indexed": False, "sha": None}


def test_index_status_after_build(repo_id):
    with TestClient(app) as client:
        client.post(
            "/index/build",
            json={"repoId": repo_id, "sha": "sha1", "files": [{"path": "src/a.ts", "content": "function a() {}\n"}]},
        )
        response = client.get("/index/status", params={"repoId": repo_id})

    assert response.status_code == 200
    assert response.json() == {"indexed": True, "sha": "sha1"}

    from app.code_graph.cache import build_neo4j_driver

    import asyncio

    async def cleanup():
        driver = build_neo4j_driver()
        async with driver.session() as session:
            await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
            await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await driver.close()

    asyncio.run(cleanup())
