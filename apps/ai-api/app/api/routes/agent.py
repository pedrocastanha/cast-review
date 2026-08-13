import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.application.dto.schemas import AgentRunRequest
from app.graph.pipeline import run_pipeline

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/agent/run")
async def agent_run(request: AgentRunRequest) -> StreamingResponse:
    return StreamingResponse(
        _sse(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _sse(request: AgentRunRequest) -> AsyncIterator[str]:
    async for event in run_pipeline(request):
        yield f"data: {json.dumps(event.model_dump())}\n\n"
