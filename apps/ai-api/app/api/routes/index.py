import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.code_graph.budget import DEFAULT_TOKEN_BUDGET
from app.code_graph.cache import IndexCache
from app.code_graph.context import assemble_related_context
from app.code_graph.http_endpoints import extract_http_endpoints
from app.code_graph.incremental import build_incremental
from app.code_graph.models import (
    IndexResult,
    IndexStats,
    ProjectGraph,
    ProjectRepositoryRef,
    RelatedContext,
    VizGraph,
)
from app.code_graph.viz import DEFAULT_MAX_NODES, expand_neighborhood, serialize_overview

router = APIRouter()


class FileInput(BaseModel):
    path: str
    content: str


class IndexBuildRequest(BaseModel):
    repoId: str
    sha: str
    files: list[FileInput]


class IndexStatusResponse(BaseModel):
    indexed: bool
    sha: str | None


class IndexRepositoryResponse(BaseModel):
    repoId: str
    sha: str


class IndexRepositoriesResponse(BaseModel):
    repositories: list[IndexRepositoryResponse]
    nextCursor: str | None = None


class IndexContextRequest(BaseModel):
    repoId: str
    sha: str
    changedFiles: list[str]
    tokenBudget: int = DEFAULT_TOKEN_BUDGET


class ProjectGraphRequest(BaseModel):
    projectId: str
    repositories: list[ProjectRepositoryRef]


def _get_cache(request: Request) -> IndexCache:
    return IndexCache(request.app.state.neo4j_driver, request.app.state.index_redis)


@router.post("/index/build", response_model=IndexResult)
async def build_index(body: IndexBuildRequest, request: Request) -> IndexResult:
    cache = _get_cache(request)
    start = time.monotonic()

    locked = await cache.acquire_lock(body.repoId, body.sha)
    if not locked:
        raise HTTPException(status_code=409, detail="indexing already in progress for this repo@sha")

    try:
        files = [{"path": f.path, "content": f.content} for f in body.files]

        result = await build_incremental(cache, body.repoId, files)
        result.graph.endpoints = extract_http_endpoints(files, result.graph)
        await cache.build_and_store(body.repoId, body.sha, result.graph)

        return IndexResult(
            indexId=f"{body.repoId}@{body.sha}",
            indexedFiles=result.reparsed_files,
            skippedFiles=result.skipped_files,
            reusedFiles=result.reused_files,
            truncated=result.truncated,
            durationMs=int((time.monotonic() - start) * 1000),
        )
    finally:
        await cache.release_lock(body.repoId, body.sha)


@router.get("/index/status", response_model=IndexStatusResponse)
async def index_status(repoId: str, request: Request) -> IndexStatusResponse:
    cache = _get_cache(request)
    sha = await cache.get_latest_sha(repoId)
    return IndexStatusResponse(indexed=sha is not None, sha=sha)


@router.get("/index/repositories", response_model=IndexRepositoriesResponse)
async def index_repositories(
    request: Request,
    query: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> IndexRepositoriesResponse:
    bounded_limit = min(max(limit, 1), 200)
    repositories, next_cursor = await _get_cache(request).list_repositories(
        query,
        bounded_limit,
        cursor,
    )
    return IndexRepositoriesResponse(
        repositories=repositories,
        nextCursor=next_cursor,
    )


@router.post("/index/context", response_model=RelatedContext)
async def index_context(body: IndexContextRequest, request: Request) -> RelatedContext:
    cache = _get_cache(request)
    return await assemble_related_context(
        cache,
        request.app.state.neo4j_driver,
        body.repoId,
        body.sha,
        body.changedFiles,
        body.tokenBudget,
    )


@router.get("/index/graph", response_model=VizGraph)
async def index_graph(
    repoId: str,
    sha: str,
    request: Request,
    focus: str | None = None,
    depth: int = 1,
) -> VizGraph:
    """P6 (CGC-21/22/23) — `focus` present means "expand this node's neighborhood"
    (symbol-level, never aggregated); omitted means the default aggregated overview.
    Same read-only `cache.lookup`, no build/lock involved."""
    cache = _get_cache(request)
    graph = await cache.lookup(repoId, sha)
    if graph is None:
        return VizGraph(nodes=[], edges=[], stats=IndexStats(indexed=False))

    if focus:
        return expand_neighborhood(graph, focus, depth)
    return serialize_overview(graph, DEFAULT_MAX_NODES)


@router.post("/index/project/graph", response_model=ProjectGraph)
async def project_graph(body: ProjectGraphRequest, request: Request) -> ProjectGraph:
    cache = _get_cache(request)
    return await cache.materialize_project_graph(body.projectId, body.repositories)
