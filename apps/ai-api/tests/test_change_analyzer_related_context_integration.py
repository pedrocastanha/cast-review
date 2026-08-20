import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file
from app.graph.nodes.change_analyzer.agent import node

pytestmark = pytest.mark.integration


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


async def _cleanup(repo_id):
    driver = build_neo4j_driver()
    async with driver.session() as session:
        await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
    await driver.close()


async def test_node_returns_real_related_context_when_repo_is_indexed(repo_id):
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "function b() { return 1; }\n")
    graph = build_graph([a, b])

    driver = build_neo4j_driver()
    redis_client = build_redis_client()
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)
    await driver.close()
    await redis_client.aclose()

    state = {
        "changed_files": [{"path": "src/b.ts"}],
        "diff": "",
        "repo_id": repo_id,
        "sha": "sha1",
    }
    result = await node(state)
    related = result["change_analysis"]["relatedContext"]

    assert related["stats"]["indexed"] is True
    assert any(c["name"] == "a" for c in related["callers"])

    await _cleanup(repo_id)
