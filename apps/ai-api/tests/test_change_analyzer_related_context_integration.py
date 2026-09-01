import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.graph import build_graph
from app.code_graph.indexer import parse_file
from app.graph.nodes.change_analyzer import agent as agent_module
from app.graph.nodes.change_analyzer.agent import node

pytestmark = pytest.mark.integration


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
async def reset_change_analyzer_singletons():
    yield
    if agent_module._cache is not None:
        await agent_module._cache._redis.aclose()
    if agent_module._driver is not None:
        await agent_module._driver.close()
    agent_module._driver = None
    agent_module._cache = None


async def _cleanup(repo_id):
    driver = build_neo4j_driver()
    async with driver.session() as session:
        await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
    await driver.close()


TWO_SYMBOL_FILE = (
    "import { helperOne } from './h1';\n"
    "import { helperTwo } from './h2';\n"
    "function zOne() { return helperOne(); }\n"
    "function zTwo() { return helperTwo(); }\n"
)

TOUCHES_ZTWO_ONLY = (
    "@@ -4,1 +4,1 @@\n"
    "-function zTwo() { return helperTwo(); }\n"
    "+function zTwo() { return helperTwo() + 1; }\n"
)


async def _store_two_symbol_repo(repo_id):
    graph = build_graph(
        [
            parse_file("src/z.ts", TWO_SYMBOL_FILE),
            parse_file("src/h1.ts", "function helperOne() { return 1; }\n"),
            parse_file("src/h2.ts", "function helperTwo() { return 2; }\n"),
        ]
    )
    driver = build_neo4j_driver()
    redis_client = build_redis_client()
    await IndexCache(driver, redis_client).build_and_store(repo_id, "sha1", graph)
    await driver.close()
    await redis_client.aclose()


async def test_node_scopes_related_context_to_the_symbols_the_diff_touches(repo_id):
    await _store_two_symbol_repo(repo_id)

    state = {
        "changed_files": [{"path": "src/z.ts", "diff": TOUCHES_ZTWO_ONLY}],
        "diff": TOUCHES_ZTWO_ONLY,
        "repo_id": repo_id,
        "sha": "sha1",
    }
    result = await node(state)
    callee_names = {c["name"] for c in result["change_analysis"]["relatedContext"]["callees"]}

    assert "helperTwo" in callee_names
    assert "helperOne" not in callee_names

    await _cleanup(repo_id)


async def test_snapshot_marks_only_the_touched_symbols_as_changed(repo_id):
    await _store_two_symbol_repo(repo_id)

    state = {
        "changed_files": [{"path": "src/z.ts", "diff": TOUCHES_ZTWO_ONLY}],
        "diff": TOUCHES_ZTWO_ONLY,
        "repo_id": repo_id,
        "sha": "sha1",
    }
    result = await node(state)
    snapshot = result["change_analysis"]["graphSnapshot"]
    changed_names = {n["name"] for n in snapshot["selected"]["changedSymbols"]}

    assert "zTwo" in changed_names
    assert "zOne" not in changed_names
    assert snapshot["graph"]["queryVersion"] == "related-context-v2"

    await _cleanup(repo_id)


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
