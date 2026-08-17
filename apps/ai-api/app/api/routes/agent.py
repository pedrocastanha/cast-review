import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.application.dto.schemas import AgentEvent, AgentResumeRequest, AgentRunRequest
from app.graph.pipeline import resume_pipeline, run_pipeline

router = APIRouter()

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/agent/run")
async def agent_run(body: AgentRunRequest, request: Request) -> StreamingResponse:
    graph = request.app.state.graph
    return StreamingResponse(
        _sse(run_pipeline(graph, body)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/agent/resume")
async def agent_resume(body: AgentResumeRequest, request: Request) -> StreamingResponse:
    graph = request.app.state.graph
    return StreamingResponse(
        _sse(
            resume_pipeline(
                graph,
                body.analysisId,
                body.apiKeys,
                body.models,
                body.policies,
                body.decision,
            )
        ),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


async def _sse(events: AsyncIterator[AgentEvent]) -> AsyncIterator[str]:
    async for event in events:
        yield f"data: {json.dumps(event.model_dump())}\n\n"
