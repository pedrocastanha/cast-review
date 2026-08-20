import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.code_graph.cache import IndexCache
from app.code_graph.graph import build_graph, detect_test_edges
from app.code_graph.indexer import index_files, load_tsconfig_paths
from app.code_graph.models import IndexResult

router = APIRouter()

TSCONFIG_FILENAME = "tsconfig.json"


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
        tsconfig_paths: dict[str, list[str]] = {}
        for file in files:
            if file["path"].endswith(TSCONFIG_FILENAME):
                tsconfig_paths = load_tsconfig_paths(file["content"])
                break

        parsed, skipped = index_files(files)
        graph = build_graph(parsed, tsconfig_paths)
        graph = detect_test_edges(graph)
        await cache.build_and_store(body.repoId, body.sha, graph)

        return IndexResult(
            indexId=f"{body.repoId}@{body.sha}",
            indexedFiles=len(parsed),
            skippedFiles=skipped,
            durationMs=int((time.monotonic() - start) * 1000),
        )
    finally:
        await cache.release_lock(body.repoId, body.sha)


@router.get("/index/status", response_model=IndexStatusResponse)
async def index_status(repoId: str, request: Request) -> IndexStatusResponse:
    cache = _get_cache(request)
    sha = await cache.get_latest_sha(repoId)
    return IndexStatusResponse(indexed=sha is not None, sha=sha)
