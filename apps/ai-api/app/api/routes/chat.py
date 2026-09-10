import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.chat.agent import run_chat
from app.chat.models import ChatEvent, ChatRunRequest
from app.code_graph.cache import IndexCache
from app.code_graph.file_view import distinct_paths, render_file
from app.index_scope import INDEX_SCOPE_HEADER, authorize_index_read

router = APIRouter()

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class IndexFileResponse(BaseModel):
    repoId: str
    sha: str
    path: str
    content: str


class IndexFilesResponse(BaseModel):
    repoId: str
    sha: str
    paths: list[str]


def _get_cache(request: Request) -> IndexCache:
    return IndexCache(request.app.state.neo4j_driver, request.app.state.index_redis)


@router.post("/chat/run")
async def chat_run(body: ChatRunRequest, request: Request) -> StreamingResponse:
    cache = _get_cache(request)
    return StreamingResponse(
        _sse(run_chat(cache, body)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.get("/index/file", response_model=IndexFileResponse)
async def index_file(
    repoId: str,
    sha: str,
    path: str,
    ownerId: str,
    request: Request,
    x_index_scope: str | None = Header(default=None, alias=INDEX_SCOPE_HEADER),
) -> IndexFileResponse:
    # O token de serviço autentica o backend; ele não autoriza conteúdo. O grant
    # carrega o conjunto de repo@sha que o backend já verificou no GitHub.
    authorize_index_read(x_index_scope, ownerId, repoId, sha)
    cache = _get_cache(request)
    graph = await cache.lookup(repoId, sha, ownerId)
    if graph is None:
        raise HTTPException(status_code=404, detail="índice não encontrado para repo@sha")

    content = render_file(graph, path)
    if content is None:
        raise HTTPException(status_code=404, detail="arquivo sem símbolo indexado")

    return IndexFileResponse(repoId=repoId, sha=sha, path=path, content=content)


@router.get("/index/files", response_model=IndexFilesResponse)
async def index_files(
    repoId: str,
    sha: str,
    ownerId: str,
    request: Request,
    query: str | None = None,
    limit: int = 100,
    x_index_scope: str | None = Header(default=None, alias=INDEX_SCOPE_HEADER),
) -> IndexFilesResponse:
    authorize_index_read(x_index_scope, ownerId, repoId, sha)
    cache = _get_cache(request)
    graph = await cache.lookup(repoId, sha, ownerId)
    if graph is None:
        raise HTTPException(status_code=404, detail="índice não encontrado para repo@sha")

    return IndexFilesResponse(
        repoId=repoId,
        sha=sha,
        paths=distinct_paths(graph, query, max(1, min(limit, 500))),
    )


async def _sse(events: AsyncIterator[ChatEvent]) -> AsyncIterator[str]:
    async for event in events:
        yield f"data: {json.dumps(event.model_dump(), ensure_ascii=False)}\n\n"
