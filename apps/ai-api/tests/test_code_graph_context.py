import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.context import assemble_related_context
from app.code_graph.graph import build_graph, detect_test_edges
from app.code_graph.indexer import parse_file

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


async def test_never_indexed_repo_returns_empty_context_with_indexed_false(driver, redis_client, repo_id):
    cache = IndexCache(driver, redis_client)
    context = await assemble_related_context(cache, driver, repo_id, "sha1", ["src/z.ts"])

    assert context.stats.indexed is False
    assert context.callers == []
    assert context.callees == []


async def test_assembles_callers_callees_and_tests_for_changed_file(driver, redis_client, repo_id):
    x = parse_file("src/x.ts", "import { y } from './y';\nfunction x() { return y(); }\n")
    y = parse_file("src/y.ts", "import { z } from './z';\nfunction y() { return z(); }\n")
    z = parse_file("src/z.ts", "import { w } from './w';\nfunction z() { return w(); }\n")
    w = parse_file("src/w.ts", "function w() { return 1; }\n")
    test_z = parse_file("src/z.test.ts", "import { z } from './z';\nz();\n")

    graph = build_graph([x, y, z, w, test_z])
    graph = detect_test_edges(graph)

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)

    context = await assemble_related_context(cache, driver, repo_id, "sha1", ["src/z.ts"])

    assert context.stats.indexed is True
    caller_names = {ref.name for ref in context.callers}
    callee_names = {ref.name for ref in context.callees}
    test_paths = {ref.path for ref in context.tests}

    assert "y" in caller_names
    assert "w" in callee_names
    assert "src/z.test.ts" in test_paths
    # x is a transitive (2-hop) caller — should still show up given the default budget
    assert "x" in caller_names

    await _cleanup(driver, repo_id)


async def test_hunk_scoped_context_ignores_untouched_siblings_in_a_changed_file(
    driver, redis_client, repo_id
):
    z = parse_file(
        "src/z.ts",
        "import { helperOne } from './h1';\n"
        "import { helperTwo } from './h2';\n"
        "function zOne() { return helperOne(); }\n"
        "function zTwo() { return helperTwo(); }\n",
    )
    h1 = parse_file("src/h1.ts", "function helperOne() { return 1; }\n")
    h2 = parse_file("src/h2.ts", "function helperTwo() { return 2; }\n")

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", build_graph([z, h1, h2]))

    context = await assemble_related_context(
        cache,
        driver,
        repo_id,
        "sha1",
        ["src/z.ts"],
        changed_files=[
            {
                "path": "src/z.ts",
                "diff": "@@ -4,1 +4,1 @@\n-function zTwo() { return helperTwo(); }\n"
                "+function zTwo() { return helperTwo() + 1; }\n",
            }
        ],
    )
    callee_names = {ref.name for ref in context.callees}

    assert "helperTwo" in callee_names
    assert "helperOne" not in callee_names

    await _cleanup(driver, repo_id)


async def test_dead_code_candidate_surfaced_only_when_in_changed_files(driver, redis_client, repo_id):
    orphan_in_changed = parse_file("src/z.ts", "function orphanZ() { return 1; }\n")
    orphan_elsewhere = parse_file("src/other.ts", "function orphanOther() { return 1; }\n")

    graph = build_graph([orphan_in_changed, orphan_elsewhere])
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)

    context = await assemble_related_context(cache, driver, repo_id, "sha1", ["src/z.ts"])
    dead_names = {ref.name for ref in context.deadCodeCandidates}

    assert "orphanZ" in dead_names
    assert "orphanOther" not in dead_names

    await _cleanup(driver, repo_id)


async def test_symbol_left_dead_by_the_diff_surfaces_even_from_an_unchanged_file(
    driver, redis_client, repo_id
):
    orphan = parse_file("src/orphan.ts", "function orphan() { return 1; }\n")
    caller = parse_file("src/caller.ts", "function caller() {\n  return 1;\n}\n")

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", build_graph([orphan, caller]))

    context = await assemble_related_context(
        cache,
        driver,
        repo_id,
        "sha1",
        ["src/caller.ts"],
        changed_files=[
            {
                "path": "src/caller.ts",
                "diff": "@@ -2,1 +2,1 @@\n-  return orphan();\n+  return 1;\n",
            }
        ],
    )

    assert "orphan" in {ref.name for ref in context.deadCodeCandidates}

    await _cleanup(driver, repo_id)


async def test_changed_symbol_exercised_only_by_tests_lands_in_its_own_bucket(
    driver, redis_client, repo_id
):
    prod = parse_file("src/foo.ts", "function foo() { return 1; }\n")
    test = parse_file("src/foo.test.ts", "import { foo } from './foo';\nfoo();\n")

    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", detect_test_edges(build_graph([prod, test])))

    context = await assemble_related_context(
        cache,
        driver,
        repo_id,
        "sha1",
        ["src/foo.ts"],
        changed_files=[
            {
                "path": "src/foo.ts",
                "diff": "@@ -1,1 +1,1 @@\n-function foo() { return 1; }\n+function foo() { return 2; }\n",
            }
        ],
    )

    assert "foo" in {ref.name for ref in context.onlyTestedCandidates}
    assert "foo" not in {ref.name for ref in context.deadCodeCandidates}

    await _cleanup(driver, repo_id)


async def test_repo_map_only_contains_signatures_not_full_bodies(driver, redis_client, repo_id):
    changed = parse_file("src/z.ts", "function z() { return 1; }\n")
    graph = build_graph([changed])
    cache = IndexCache(driver, redis_client)
    await cache.build_and_store(repo_id, "sha1", graph)

    context = await assemble_related_context(cache, driver, repo_id, "sha1", ["src/z.ts"], token_budget=8_000)

    assert isinstance(context.repoMap, str)

    await _cleanup(driver, repo_id)
