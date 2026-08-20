import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.models import Edge, Graph, Symbol

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


def _sample_graph() -> Graph:
    # `from_id`/`to_id` on a `defines` edge must themselves be `:Symbol` nodes in the
    # graph (matches how `graph.py::build_graph` always emits a file-kind Symbol too) —
    # an edge pointing at an id with no matching node silently produces zero rows on
    # `MATCH` in Cypher, so a fixture missing this node under-counts edges after roundtrip.
    file_symbol = Symbol(id="a.ts", kind="file", path="a.ts", name="a.ts", line=1, end_line=1, signature="a.ts")
    foo = Symbol(id="a.ts::foo@0", kind="function", path="a.ts", name="foo", line=1, end_line=1, signature="function foo()")
    bar = Symbol(
        id="a.ts::bar@10",
        kind="function",
        path="a.ts",
        name="bar",
        line=2,
        end_line=2,
        signature="function bar()",
        parent_id=foo.id,
    )
    return Graph(
        nodes={file_symbol.id: file_symbol, foo.id: foo, bar.id: bar},
        edges=[
            Edge(from_id="a.ts", to_id=foo.id, kind="defines"),
            Edge(from_id="a.ts", to_id=bar.id, kind="defines"),
            Edge(from_id=foo.id, to_id=bar.id, kind="references", weight=1.0),
        ],
    )


async def _cleanup(driver, repo_id, sha="sha1"):
    async with driver.session() as session:
        await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)


async def test_build_and_store_then_lookup_roundtrip(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    graph = _sample_graph()
    await cache.build_and_store(repo_id, "sha1", graph)

    recovered = await cache.lookup(repo_id, "sha1")
    assert recovered is not None
    assert recovered.nodes.keys() == graph.nodes.keys()
    assert len(recovered.edges) == 3

    ref_edge = next(e for e in recovered.edges if e.kind == "references")
    assert ref_edge.from_id == "a.ts::foo@0"
    assert ref_edge.to_id == "a.ts::bar@10"
    assert recovered.nodes["a.ts::bar@10"].parent_id == "a.ts::foo@0"

    await _cleanup(driver, repo_id)


async def test_lookup_never_indexed_returns_none(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    result = await cache.lookup(repo_id, "never-indexed-sha")
    assert result is None


async def test_build_and_store_is_idempotent_rebuild(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", _sample_graph())
    await cache.build_and_store(repo_id, "sha1", _sample_graph())

    recovered = await cache.lookup(repo_id, "sha1")
    assert len(recovered.nodes) == 3
    assert len(recovered.edges) == 3

    await _cleanup(driver, repo_id)


async def test_different_repos_do_not_leak_into_each_other(driver, redis_client, repo_id):
    other_repo_id = f"{repo_id}-other"
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", _sample_graph())

    result = await cache.lookup(other_repo_id, "sha1")
    assert result is None

    await _cleanup(driver, repo_id)


async def test_get_latest_sha_never_indexed_returns_none(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    assert await cache.get_latest_sha(repo_id) is None


async def test_get_latest_sha_returns_indexed_sha(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", _sample_graph())
    assert await cache.get_latest_sha(repo_id) == "sha1"

    await _cleanup(driver, repo_id)


async def test_reindex_new_sha_updates_latest_and_drops_old_nodes(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", _sample_graph())
    await cache.build_and_store(repo_id, "sha2", _sample_graph())

    assert await cache.get_latest_sha(repo_id) == "sha2"
    # Old sha's nodes must be gone — a repo has one current graph, not one per commit
    # ever indexed (see the comment on `build_and_store`'s cleanup query).
    assert await cache.lookup(repo_id, "sha1") is None
    assert await cache.lookup(repo_id, "sha2") is not None

    await _cleanup(driver, repo_id)


async def test_acquire_lock_blocks_concurrent_second_call(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    first = await cache.acquire_lock(repo_id, "sha1")
    second = await cache.acquire_lock(repo_id, "sha1")
    assert first is True
    assert second is False

    await cache.release_lock(repo_id, "sha1")


async def test_release_lock_allows_reacquisition(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    await cache.acquire_lock(repo_id, "sha1")
    await cache.release_lock(repo_id, "sha1")
    reacquired = await cache.acquire_lock(repo_id, "sha1")
    assert reacquired is True

    await cache.release_lock(repo_id, "sha1")
