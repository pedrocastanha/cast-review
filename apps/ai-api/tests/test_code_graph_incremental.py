import uuid

import pytest

from app.code_graph import incremental as incremental_module
from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.incremental import build_incremental

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


BASE_FILES = [
    {"path": "src/a.ts", "content": "import { b } from './b';\nfunction a() { return b(); }\n"},
    {"path": "src/b.ts", "content": "function b() { return 1; }\n"},
    {"path": "src/c.ts", "content": "function c() { return 2; }\n"},
]


async def test_first_build_reparses_everything_nothing_reused(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    result = await build_incremental(cache, repo_id, BASE_FILES)
    await cache.build_and_store(repo_id, "sha1", result.graph)

    assert result.reparsed_files == 3
    assert result.reused_files == 0

    await _cleanup(driver, repo_id)


async def test_reindex_unchanged_content_reuses_all_reparses_none(driver, redis_client, repo_id, monkeypatch):
    cache = IndexCache(driver, redis_client)
    first = await build_incremental(cache, repo_id, BASE_FILES)
    await cache.build_and_store(repo_id, "sha1", first.graph)

    parse_calls = []
    original_index_files = incremental_module.index_files

    def spy_index_files(files):
        parse_calls.append(len(files))
        return original_index_files(files)

    monkeypatch.setattr(incremental_module, "index_files", spy_index_files)

    second = await build_incremental(cache, repo_id, BASE_FILES)
    await cache.build_and_store(repo_id, "sha2", second.graph)

    assert second.reparsed_files == 0
    assert second.reused_files == 3
    assert parse_calls == [0]  # index_files called with an empty list — proves no reparse

    await _cleanup(driver, repo_id)


async def test_reindex_one_changed_file_reparses_only_that_one(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    first = await build_incremental(cache, repo_id, BASE_FILES)
    await cache.build_and_store(repo_id, "sha1", first.graph)

    changed = [
        BASE_FILES[0],
        {"path": "src/b.ts", "content": "function b() { return 999; }\n"},  # content changed
        BASE_FILES[2],
    ]
    second = await build_incremental(cache, repo_id, changed)

    assert second.reparsed_files == 1
    assert second.reused_files == 2

    await _cleanup(driver, repo_id)


async def test_cross_file_resolution_survives_reindex_when_caller_unchanged_callee_changed(
    driver, redis_client, repo_id
):
    """The critical correctness case: `a.ts` (unchanged) calls `b()` in `b.ts`
    (changed). Without seeding reused symbols into `build_graph`'s resolution index,
    this edge would silently vanish on reindex, breaking caller discovery for exactly
    the scenario this whole feature exists to fix."""
    cache = IndexCache(driver, redis_client)
    first = await build_incremental(cache, repo_id, BASE_FILES)
    await cache.build_and_store(repo_id, "sha1", first.graph)

    changed = [
        BASE_FILES[0],  # a.ts unchanged — still calls b()
        {"path": "src/b.ts", "content": "function b() { return 42; }\n"},  # b.ts changed
        BASE_FILES[2],
    ]
    second = await build_incremental(cache, repo_id, changed)
    await cache.build_and_store(repo_id, "sha2", second.graph)

    fn_a = next(n for n in second.graph.nodes.values() if n.name == "a" and n.kind == "function")
    fn_b = next(n for n in second.graph.nodes.values() if n.name == "b" and n.kind == "function")
    assert any(
        e.kind == "references" and e.from_id == fn_a.id and e.to_id == fn_b.id for e in second.graph.edges
    )

    await _cleanup(driver, repo_id)


async def test_reused_caller_edge_into_changed_file_persists_after_store_and_lookup(
    driver, redis_client, repo_id
):
    """Same as above, but verifies through a real `build_and_store` + `lookup`
    round-trip — proves the merged (partly reused, partly fresh) graph persists
    correctly, not just in the in-memory `Graph` object."""
    cache = IndexCache(driver, redis_client)
    first = await build_incremental(cache, repo_id, BASE_FILES)
    await cache.build_and_store(repo_id, "sha1", first.graph)

    changed = [
        BASE_FILES[0],
        {"path": "src/b.ts", "content": "function b() { return 'changed'; }\n"},
        BASE_FILES[2],
    ]
    second = await build_incremental(cache, repo_id, changed)
    await cache.build_and_store(repo_id, "sha2", second.graph)

    reloaded = await cache.lookup(repo_id, "sha2")
    fn_a = next(n for n in reloaded.nodes.values() if n.name == "a" and n.kind == "function")
    fn_b = next(n for n in reloaded.nodes.values() if n.name == "b" and n.kind == "function")
    assert any(
        e.kind == "references" and e.from_id == fn_a.id and e.to_id == fn_b.id for e in reloaded.edges
    )

    await _cleanup(driver, repo_id)


async def test_file_count_truncated_above_configured_limit(driver, redis_client, repo_id, monkeypatch):
    monkeypatch.setattr(incremental_module, "CODE_GRAPH_MAX_FILES", 2)

    files = [{"path": f"src/f{i}.ts", "content": f"function f{i}() {{}}\n"} for i in range(5)]
    cache = IndexCache(driver, redis_client)
    result = await build_incremental(cache, repo_id, files)

    assert result.truncated is True
    assert result.reparsed_files == 2

    await _cleanup(driver, repo_id)


async def test_file_count_not_truncated_within_limit(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    result = await build_incremental(cache, repo_id, BASE_FILES)
    assert result.truncated is False

    await _cleanup(driver, repo_id)
