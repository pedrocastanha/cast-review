"""HTTP-level tests for `POST /index/build` (T8) — real Neo4j + Redis, real route handler.

Per T13's flag (see `test_agent_routes_http.py`), a bare `TestClient(app)` does not
trigger the lifespan in this codebase's starlette/httpx version, so `with TestClient(app)`
is required here — the route now reads `request.app.state.neo4j_driver`/`.index_redis`,
both set up in `main.py`'s lifespan (Decisão A13).
"""

import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


async def _cleanup_neo4j(repo_id, sha="sha1"):
    driver = build_neo4j_driver()
    async with driver.session() as session:
        await session.run("MATCH (n:Symbol {repoId: $repoId, sha: $sha}) DETACH DELETE n", repoId=repo_id, sha=sha)
    await driver.close()


def test_index_build_http_returns_stats(repo_id):
    with TestClient(app) as client:
        response = client.post(
            "/index/build",
            json={
                "repoId": repo_id,
                "sha": "sha1",
                "files": [
                    {"path": "src/a.ts", "content": "function a() { return 1; }\n"},
                    {"path": "src/weird.rs", "content": "fn main() {}\n"},
                ],
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["indexId"] == f"{repo_id}@sha1"
    assert body["indexedFiles"] == 1
    assert body["skippedFiles"] == 1
    assert body["durationMs"] >= 0


async def test_index_build_persists_queryable_graph(repo_id):
    with TestClient(app) as client:
        client.post(
            "/index/build",
            json={"repoId": repo_id, "sha": "sha1", "files": [{"path": "src/a.ts", "content": "function a() {}\n"}]},
        )

    driver = build_neo4j_driver()
    redis_client = build_redis_client()
    cache = IndexCache(driver, redis_client)
    graph = await cache.lookup(repo_id, "sha1")
    assert graph is not None
    assert any(n.name == "a" for n in graph.nodes.values())

    await _cleanup_neo4j(repo_id)
    await driver.close()
    await redis_client.aclose()


def test_index_build_concurrent_second_call_returns_409(repo_id, monkeypatch):
    from app.code_graph import indexer

    original = indexer.parse_file

    def slow_parse_file(path, content):
        time.sleep(0.3)
        return original(path, content)

    monkeypatch.setattr(indexer, "parse_file", slow_parse_file)

    results = []

    # One shared `with TestClient(app)` — the app's lifespan (Neo4j driver + Redis client
    # singletons) only starts once; both threads hit the same connection-pooled clients,
    # which is also more realistic than two separate app instances racing to start up.
    with TestClient(app) as client:

        def call():
            resp = client.post(
                "/index/build",
                json={"repoId": repo_id, "sha": "sha1", "files": [{"path": "src/a.ts", "content": "function a() {}\n"}]},
            )
            results.append(resp.status_code)

        t1 = threading.Thread(target=call)
        t2 = threading.Thread(target=call)
        t1.start()
        time.sleep(0.05)
        t2.start()
        t1.join()
        t2.join()

    assert 409 in results
    assert 200 in results
