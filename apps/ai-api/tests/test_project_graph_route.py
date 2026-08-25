import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.integration


def _cleanup(repo_ids: list[str], project_id: str):
    from app.code_graph.cache import build_neo4j_driver

    async def go():
        driver = build_neo4j_driver()
        async with driver.session() as session:
            await session.run(
                "MATCH (n) WHERE n.repoId IN $repoIds AND (n:Symbol OR n:ApiEndpoint) DETACH DELETE n",
                repoIds=repo_ids,
            )
            await session.run("MATCH (n:RepoIndex) WHERE n.repoId IN $repoIds DETACH DELETE n", repoIds=repo_ids)
            await session.run("MATCH ()-[r:CONSUMES {projectId: $projectId}]->() DELETE r", projectId=project_id)
        await driver.close()

    asyncio.run(go())


def test_project_graph_materializes_cross_repo_endpoint_matches():
    suffix = uuid.uuid4().hex[:8]
    frontend = f"test/frontend-{suffix}"
    backend = f"test/backend-{suffix}"
    project_id = f"project-{suffix}"

    with TestClient(app) as client:
        frontend_build = client.post(
            "/index/build",
            json={
                "repoId": frontend,
                "sha": "front-sha",
                "files": [
                    {
                        "path": "src/api.ts",
                        "content": "request(`/repositories/${repo}/graph?owner=cast`);",
                    }
                ],
            },
        )
        backend_build = client.post(
            "/index/build",
            json={
                "repoId": backend,
                "sha": "back-sha",
                "files": [
                    {
                        "path": "src/repositories.controller.ts",
                        "content": """
@Controller('repositories')
export class RepositoriesController {
  @Get(':repo/graph')
  getGraph() { return {}; }
}
""",
                    }
                ],
            },
        )
        response = client.post(
            "/index/project/graph",
            json={
                "projectId": project_id,
                "repositories": [
                    {"repoId": frontend, "sha": "front-sha"},
                    {"repoId": backend, "sha": "back-sha"},
                    {"repoId": f"test/not-indexed-{suffix}", "sha": None},
                ],
            },
        )

    assert frontend_build.status_code == 200
    assert backend_build.status_code == 200
    assert response.status_code == 200
    body = response.json()
    assert len(body["nodes"]) == 3
    assert body["stats"] == {
        "repositories": 3,
        "indexedRepositories": 2,
        "links": 1,
        "endpoints": 2,
    }
    assert len(body["edges"]) == 1
    edge = body["edges"][0]
    assert edge["source"] == f"repo::{frontend}"
    assert edge["target"] == f"repo::{backend}"
    assert edge["kind"] == "consumes"
    assert edge["confidence"] == "confirmed"
    assert edge["count"] == 1
    assert edge["matches"][0]["method"] == "GET"
    assert edge["matches"][0]["route"] == "/repositories/{param}/graph"
    assert edge["matches"][0]["consumer"]["path"] == "src/api.ts"
    assert edge["matches"][0]["provider"]["path"] == "src/repositories.controller.ts"

    _cleanup([frontend, backend], project_id)


def test_project_graph_does_not_match_different_http_methods():
    suffix = uuid.uuid4().hex[:8]
    frontend = f"test/frontend-method-{suffix}"
    backend = f"test/backend-method-{suffix}"
    project_id = f"project-method-{suffix}"

    with TestClient(app) as client:
        client.post(
            "/index/build",
            json={
                "repoId": frontend,
                "sha": "front-sha",
                "files": [{"path": "src/api.ts", "content": "request('/health', { method: 'POST' });"}],
            },
        )
        client.post(
            "/index/build",
            json={
                "repoId": backend,
                "sha": "back-sha",
                "files": [
                    {
                        "path": "src/health.controller.ts",
                        "content": "@Controller()\nclass Health {\n@Get('health')\nhealth() {}\n}",
                    }
                ],
            },
        )
        response = client.post(
            "/index/project/graph",
            json={
                "projectId": project_id,
                "repositories": [
                    {"repoId": frontend, "sha": "front-sha"},
                    {"repoId": backend, "sha": "back-sha"},
                ],
            },
        )

    assert response.status_code == 200
    assert response.json()["edges"] == []

    _cleanup([frontend, backend], project_id)


def test_project_graph_isolated_by_sha_and_removes_previous_project_links():
    suffix = uuid.uuid4().hex[:8]
    frontend = f"test/frontend-sha-{suffix}"
    backend = f"test/backend-sha-{suffix}"
    project_id = f"project-sha-{suffix}"
    repositories = [
        {"repoId": frontend, "sha": "front-current"},
        {"repoId": backend, "sha": "back-current"},
    ]

    with TestClient(app) as client:
        client.post(
            "/index/build",
            json={
                "repoId": frontend,
                "sha": "front-current",
                "files": [{"path": "src/api.ts", "content": "request('/health');"}],
            },
        )
        client.post(
            "/index/build",
            json={
                "repoId": backend,
                "sha": "back-current",
                "files": [
                    {
                        "path": "src/health.controller.ts",
                        "content": "@Controller()\nclass Health {\n@Get('health')\nhealth() {}\n}",
                    }
                ],
            },
        )

        first = client.post(
            "/index/project/graph",
            json={"projectId": project_id, "repositories": repositories},
        )
        stale = client.post(
            "/index/project/graph",
            json={
                "projectId": project_id,
                "repositories": [
                    {"repoId": frontend, "sha": "front-stale"},
                    {"repoId": backend, "sha": "back-current"},
                ],
            },
        )

    assert len(first.json()["edges"]) == 1
    assert stale.status_code == 200
    assert stale.json()["edges"] == []
    assert stale.json()["stats"]["links"] == 0
    assert stale.json()["stats"]["endpoints"] == 0

    _cleanup([frontend, backend], project_id)
