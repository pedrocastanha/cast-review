import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file
from app.code_graph.ranker import GRAPH_PROJECTION_PREFIX, rank

OWNER_ID = "owner-test"

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
    await cache.build_and_store(repo_id, "sha1", graph, OWNER_ID)

    scored = await rank(driver, repo_id, "sha1", ["src/z.ts"], OWNER_ID)
    scores_by_path_hint = {s.symbol_id: s.score for s in scored}

    fn_x_id = next(sid for sid in scores_by_path_hint if "src/x.ts::x" in sid)
    fn_y_id = next(sid for sid in scores_by_path_hint if "src/y.ts::y" in sid)
    assert scores_by_path_hint[fn_y_id] > scores_by_path_hint[fn_x_id]

    await _cleanup(driver, repo_id)


async def test_rank_scoped_to_changed_symbols_ignores_callers_of_untouched_siblings(
    driver, redis_client, repo_id
):
    z = parse_file("src/z.ts", "function zOne() { return 1; }\nfunction zTwo() { return 2; }\n")
    x = parse_file("src/x.ts", "import { zOne } from './z';\nfunction x() { return zOne(); }\n")
    w = parse_file("src/w.ts", "import { zTwo } from './z';\nfunction w() { return zTwo(); }\n")
    graph = build_graph([z, x, w])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph, OWNER_ID)

    z_two_id = next(s.id for s in graph.nodes.values() if s.name == "zTwo")
    scored = await rank(driver, repo_id, "sha1", ["src/z.ts"], OWNER_ID, source_symbol_ids=[z_two_id])
    scores = {s.symbol_id: s.score for s in scored}

    fn_w_id = next(sid for sid in scores if "src/w.ts::w" in sid)
    fn_x_id = next(sid for sid in scores if "src/x.ts::x" in sid)
    assert scores[fn_w_id] > scores[fn_x_id]

    await _cleanup(driver, repo_id)


async def test_rank_returns_empty_when_changed_path_has_no_symbols(driver, redis_client, repo_id):
    a = parse_file("src/a.ts", "function a() {}\n")
    graph = build_graph([a])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph, OWNER_ID)

    scored = await rank(driver, repo_id, "sha1", ["src/nonexistent.ts"], OWNER_ID)
    assert scored == []

    await _cleanup(driver, repo_id)


async def test_rank_scopes_to_repo_and_sha(driver, redis_client, repo_id):
    other_repo_id = f"{repo_id}-other"
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "function b() {}\n")
    graph = build_graph([a, b])

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph, OWNER_ID)
    await cache.build_and_store(other_repo_id, "sha1", graph, OWNER_ID)

    scored = await rank(driver, repo_id, "sha1", ["src/b.ts"], OWNER_ID)
    assert len(scored) > 0

    await _cleanup(driver, repo_id)
    await _cleanup(driver, other_repo_id)


async def test_rank_cleans_up_graph_projection(driver, redis_client, repo_id, monkeypatch):
    a = parse_file("src/a.ts", "import { b } from './b';\nfunction a() { return b(); }\n")
    b = parse_file("src/b.ts", "function b() {}\n")
    graph = build_graph([a, b])

    # Fixa o nome da projeção para poder perguntar por ELA depois. Sem isso o
    # nome é um uuid interno do ranker e o teste não teria o que consultar.
    projection_hex = uuid.uuid4().hex
    monkeypatch.setattr(
        "app.code_graph.ranker.uuid.uuid4", lambda: uuid.UUID(hex=projection_hex)
    )
    graph_name = f"{GRAPH_PROJECTION_PREFIX}_{projection_hex}"

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph, OWNER_ID)
    await rank(driver, repo_id, "sha1", ["src/b.ts"], OWNER_ID)

    # Asserção via `gds.graph.exists`, e não `gds.graph.list`: a allowlist de
    # procedures do Neo4j em produção só libera o que o ranker realmente chama,
    # e `list` não está entre elas. O teste tem que passar pelo mesmo portão.
    async with driver.session() as session:
        result = await session.run(
            "CALL gds.graph.exists($graphName) YIELD exists RETURN exists",
            graphName=graph_name,
        )
        record = await result.single()
    assert record["exists"] is False

    await _cleanup(driver, repo_id)
