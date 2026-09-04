from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.architecture.candidates import build_candidates
from app.architecture.dependencies import build_dependencies
from app.architecture.impact import build_impact
from app.architecture.models import (
    ArchitectureRepositoryRef,
    CandidatesResponse,
    ChangedFileRef,
    ComponentRef,
    DependenciesResponse,
    ImpactResponse,
)
from app.code_graph.cache import IndexCache
from app.code_graph.models import Graph

router = APIRouter()


class CandidatesRequest(BaseModel):
    repositories: list[ArchitectureRepositoryRef] = Field(default_factory=list)


class DependenciesRequest(BaseModel):
    repositories: list[ArchitectureRepositoryRef] = Field(default_factory=list)
    components: list[ComponentRef] = Field(default_factory=list)


class ImpactRequest(BaseModel):
    repositories: list[ArchitectureRepositoryRef] = Field(default_factory=list)
    components: list[ComponentRef] = Field(default_factory=list)
    changedFiles: list[ChangedFileRef] = Field(default_factory=list)


def _get_cache(request: Request) -> IndexCache:
    return IndexCache(request.app.state.neo4j_driver, request.app.state.index_redis)


async def _load_graphs(
    request: Request,
    repositories: list[ArchitectureRepositoryRef],
) -> dict[str, Graph | None]:
    cache = _get_cache(request)
    graphs: dict[str, Graph | None] = {}
    for repository in repositories:
        if repository.repoId in graphs:
            continue
        sha = repository.sha or await cache.get_latest_sha(repository.repoId)
        graphs[repository.repoId] = await cache.lookup(repository.repoId, sha) if sha else None
    return graphs


@router.post("/architecture/candidates", response_model=CandidatesResponse)
async def architecture_candidates(body: CandidatesRequest, request: Request) -> CandidatesResponse:
    graphs = await _load_graphs(request, body.repositories)
    return build_candidates(body.repositories, graphs)


@router.post("/architecture/dependencies", response_model=DependenciesResponse)
async def architecture_dependencies(
    body: DependenciesRequest,
    request: Request,
) -> DependenciesResponse:
    graphs = await _load_graphs(request, body.repositories)
    return build_dependencies(body.repositories, body.components, graphs)


@router.post("/architecture/impact", response_model=ImpactResponse)
async def architecture_impact(body: ImpactRequest, request: Request) -> ImpactResponse:
    graphs = await _load_graphs(request, body.repositories)
    return build_impact(body.repositories, body.components, body.changedFiles, graphs)
