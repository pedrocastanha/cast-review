import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file
from app.code_graph.ranker import rank

pytestmark = pytest.mark.integration


@pytest.fixture
async def driver():
    d = build_neo4j_driver()
    yield d
    await d.close()


@pytest.fixture
async def redis_client():
    c = build_redis_client()
    yield c
    await c.aclose()


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


async def _cleanup(driver, repo_id):
    async with driver.session() as session:
        await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)


async def test_rank_ranks_direct_caller_above_transitive_caller(driver, redis_client, repo_id):
    x = parse_file("src/x.ts", "import { y } from './y';\nfunction x() { return y(); }\n")
    y = parse_file("src/y.ts", "import { z } from './z';\nfunction y() { return z(); }\n")
    z = parse_file("src/z.ts", "function z() { return 1; }\n")
    graph = build_graph([x, y, z])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)

    scored = await rank(driver, repo_id, "sha1", ["src/z.ts"])
    scores_by_path_hint = {s.symbol_id: s.score for s in scored}

    fn_x_id = next(sid for sid in scores_by_path_hint if "src/x.ts::x" in sid)
    fn_y_id = next(sid for sid in scores_by_path_hint if "src/y.ts::y" in sid)
    assert scores_by_path_hint[fn_y_id] > scores_by_path_hint[fn_x_id]

    await _cleanup(driver, repo_id)


async def test_rank_returns_empty_when_changed_path_has_no_symbols(driver, redis_client, repo_id):
    a = parse_file("src/a.ts", "function a() {}\n")
    graph = build_graph([a])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)

    scored = await rank(driver, repo_id, "sha1", ["src/nonexistent.ts"])
    assert scored == []

    await _cleanup(driver, repo_id)


async def test_rank_scopes_to_repo_and_sha(driver, redis_client, repo_id):
    other_repo_id = f"{repo_id}-other"
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "function b() {}\n")
    graph = build_graph([a, b])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)
    await cache.build_and_store(other_repo_id, "sha1", graph)

    scored = await rank(driver, repo_id, "sha1", ["src/b.ts"])
    assert len(scored) > 0

    await _cleanup(driver, repo_id)
    await _cleanup(driver, other_repo_id)


async def test_rank_cleans_up_graph_projection(driver, redis_client, repo_id):
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "function b() {}\n")
    graph = build_graph([a, b])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)
    await rank(driver, repo_id, "sha1", ["src/b.ts"])

    async with driver.session() as session:
        result = await session.run("CALL gds.graph.list() YIELD graphName RETURN graphName")
        names = [rec["graphName"] async for rec in result]
    assert not any(name.startswith("rank_") for name in names)

    await _cleanup(driver, repo_id)
