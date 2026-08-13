import asyncio
from collections.abc import AsyncIterator
from uuid import uuid4

from app.application.dto.schemas import AgentEvent, AgentRunRequest
from app.graph.graph import build_graph
from app.graph.thoughts import end_run, start_run
from app.infrastructure.llm.client import LlmError

EVENT_BY_NODE = {
    "change_analyzer": ("change_analysis_done", "change_analysis"),
    "prd": ("prd_generated", "prd"),
    "implementation_spec": ("spec_generated", "spec"),
    "test_reviewer": ("test_reviewer_done", "test_review"),
    "architecture_reviewer": ("architecture_reviewer_done", "architecture_review"),
    "report_builder": ("report_ready", "report"),
}

_graph = build_graph()
_DONE = object()

async def run_pipeline(request: AgentRunRequest) -> AsyncIterator[AgentEvent]:
    queue: asyncio.Queue[AgentEvent | object] = asyncio.Queue()
    run_id = uuid4().hex

    async def emit_thought(step: str, text: str) -> None:
        await queue.put(AgentEvent(type="thought", payload={"step": step, "delta": text}))

    start_run(run_id, emit_thought)

    async def produce() -> None:
        initial = {
            "run_id": run_id,
            "diff": request.diff,
            "changed_files": [file.model_dump() for file in request.changedFiles],
            "conventions": request.conventions,
            "models": request.models.model_dump(),
            "api_keys": request.apiKeys.model_dump(),
        }
        try:
            async for update in _graph.astream(initial, stream_mode="updates"):
                for node_name, delta in update.items():
                    mapping = EVENT_BY_NODE.get(node_name)
                    if not mapping:
                        continue
                    event_type, payload_key = mapping
                    await queue.put(AgentEvent(type=event_type, payload=delta[payload_key]))
        except LlmError as exc:
            await queue.put(
                AgentEvent(type="error", payload={"step": "llm", "message": exc.message})
            )
        except Exception as exc:
            await queue.put(
                AgentEvent(type="error", payload={"step": "pipeline", "message": str(exc)})
            )
        finally:
            await queue.put(_DONE)

    task = asyncio.create_task(produce())
    try:
        while True:
            item = await queue.get()
            if item is _DONE:
                break
            yield item
    finally:
        end_run(run_id)
        await task
