import uuid

import pytest

from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client
from app.code_graph.cross_repo_impact import (
    extract_contract_changes,
    resolve_cross_repo_impacts,
)
from app.code_graph.http_endpoints import extract_http_endpoints
from app.code_graph.models import Graph, HttpEndpoint


def test_contract_delta_preserves_removed_and_added_provider_as_modified():
    changes = extract_contract_changes(
        [
            {
                "path": "src/projects.controller.ts",
                "baseContent": """
@Controller('v1/projects')
class ProjectsController {
  @Delete(':id')
  remove() {}
}
""",
                "fullContent": """
@Controller('v2/projects')
class ProjectsController {
  @Delete(':id')
  remove() {}
}
""",
            }
        ]
    )

    assert len(changes) == 1
    assert changes[0]["changeType"] == "modified"
    assert changes[0]["before"]["normalizedRoute"] == "/v1/projects/{param}"
    assert changes[0]["after"]["normalizedRoute"] == "/v2/projects/{param}"


def test_contract_delta_marks_unchanged_contract_in_changed_file_as_touched():
    content = "@Controller('health')\nclass Health {\n@Get()\ncheck() {}\n}"
    changes = extract_contract_changes(
        [{"path": "src/health.controller.ts", "baseContent": content, "fullContent": content}]
    )

    assert [(item["changeType"], item["after"]["normalizedRoute"]) for item in changes] == [
        ("touched", "/health")
    ]


class FakeCache:
    def __init__(self, endpoints):
        self.endpoints = endpoints
        self.calls = []

    async def list_endpoints(self, repo_id, sha):
        self.calls.append((repo_id, sha))
        return self.endpoints.get((repo_id, sha), [])


@pytest.mark.asyncio
async def test_removed_provider_finds_frozen_cross_repo_consumer_with_evidence():
    changed_files = [
        {
            "path": "src/projects.controller.ts",
            "baseContent": "@Controller('projects')\nclass Projects {\n@Delete(':id')\nremove() {}\n}",
            "fullContent": "",
        }
    ]
    consumer = HttpEndpoint(
        id="consumer-1",
        role="consumer",
        method="DELETE",
        route="/projects/${id}",
        normalized_route="/projects/{param}",
        path="src/api.ts",
        line=18,
        framework="fetch",
        symbol_name="deleteProject",
    )
    cache = FakeCache({("cast/frontend", "front-sha"): [consumer]})
    scope = {
        "requestedMode": "project",
        "effectiveMode": "project",
        "status": "exact",
        "projectId": "project-1",
        "projectName": "Cast",
        "fallbackReason": None,
        "repositories": [
            {
                "repoId": "cast/backend",
                "indexedSha": "source-index-sha",
                "indexStatus": "indexed",
                "included": True,
                "omissionReason": None,
            },
            {
                "repoId": "cast/frontend",
                "indexedSha": "front-sha",
                "indexStatus": "indexed",
                "included": True,
                "omissionReason": None,
            },
        ],
    }

    result = await resolve_cross_repo_impacts(
        cache=cache,
        source_repo_id="cast/backend",
        source_sha="head-sha",
        changed_files=changed_files,
        impact_scope=scope,
    )

    assert cache.calls == [("cast/frontend", "front-sha")]
    assert result["impacts"][0]["risk"] == "breaking_candidate"
    assert result["impacts"][0]["direction"] == "cast/frontend -> cast/backend"
    evidence = result["evidence"][0]
    assert result["impacts"][0]["evidenceId"] == evidence["id"]
    assert evidence["consumer"]["path"] == "src/api.ts"
    assert evidence["provider"]["path"] == "src/projects.controller.ts"


@pytest.mark.asyncio
async def test_resolver_never_queries_repository_mode():
    cache = FakeCache({})
    result = await resolve_cross_repo_impacts(
        cache=cache,
        source_repo_id="cast/backend",
        source_sha="head-sha",
        changed_files=[],
        impact_scope={"requestedMode": "repository"},
    )

    assert cache.calls == []
    assert result == {"contractChanges": [], "impacts": [], "evidence": [], "budget": None}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_removed_provider_resolves_consumer_from_real_frozen_neo4j_index():
    suffix = uuid.uuid4().hex[:8]
    source_repo_id = f"test/backend-{suffix}"
    consumer_repo_id = f"test/frontend-{suffix}"
    consumer_sha = "frontend-frozen-sha"
    driver = build_neo4j_driver()
    redis_client = build_redis_client()
    cache = IndexCache(driver, redis_client)
    consumer_endpoints = extract_http_endpoints(
        [
            {
                "path": "src/api.ts",
                "content": "export const remove = (id: string) => fetch(`/projects/${id}`, { method: 'DELETE' });",
            }
        ]
    )

    try:
        await cache.build_and_store(
            consumer_repo_id,
            consumer_sha,
            Graph(endpoints=consumer_endpoints),
        )
        result = await resolve_cross_repo_impacts(
            cache=cache,
            source_repo_id=source_repo_id,
            source_sha="backend-head-sha",
            source_base_sha="backend-base-sha",
            changed_files=[
                {
                    "path": "src/projects.controller.ts",
                    "baseContent": "@Controller('projects')\nclass Projects {\n@Delete(':id')\nremove() {}\n}",
                    "fullContent": "",
                }
            ],
            impact_scope={
                "requestedMode": "project",
                "effectiveMode": "project",
                "repositories": [
                    {
                        "repoId": source_repo_id,
                        "indexedSha": "backend-index-sha",
                        "included": True,
                    },
                    {
                        "repoId": consumer_repo_id,
                        "indexedSha": consumer_sha,
                        "included": True,
                    },
                ],
            },
        )

        assert len(result["impacts"]) == 1
        assert result["impacts"][0]["risk"] == "breaking_candidate"
        assert result["impacts"][0]["direction"] == f"{consumer_repo_id} -> {source_repo_id}"
        assert result["evidence"][0]["consumer"] == {
            "repoId": consumer_repo_id,
            "sha": consumer_sha,
            "path": "src/api.ts",
            "line": 1,
            "symbolId": None,
            "symbolName": None,
            "framework": "fetch",
        }
        assert result["evidence"][0]["provider"]["sha"] == "backend-base-sha"
    finally:
        async with driver.session() as session:
            await session.run(
                "MATCH (n) WHERE n.repoId IN $repoIds AND (n:Symbol OR n:ApiEndpoint OR n:RepoIndex) DETACH DELETE n",
                repoIds=[source_repo_id, consumer_repo_id],
            )
        await redis_client.aclose()
        await driver.close()
