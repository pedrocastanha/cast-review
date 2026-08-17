import asyncio
from collections.abc import AsyncIterator
from typing import Any

from langgraph.types import Command

from app.application.dto.schemas import (
    AgentEvent,
    AgentRunRequest,
    ApiKeys,
    ApprovalDecision,
    Policies,
    ReviewModels,
)
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

_DONE = object()


def _interrupt_event(update: dict[str, Any]) -> AgentEvent | None:
    """Detect LangGraph's interrupt signal inside an `astream(..., stream_mode="updates")`
    chunk.

    Empirically verified (scratch script run against a 1-node `interrupt()` graph
    compiled with `InMemorySaver`, per design.md's Open Item #1): the chunk is

        {"__interrupt__": (Interrupt(value={...}, id="..."),)}

    — the same `"__interrupt__"` key used by `.ainvoke()`'s return dict, but here the
    value is a *tuple* of `Interrupt` objects rather than a list. `Interrupt.value`
    holds exactly the dict passed to `interrupt(...)` (e.g. `{"stage": "prd",
    "iteration": 1}`).
    """
    interrupts = update.get("__interrupt__")
    if not interrupts:
        return None
    return AgentEvent(type="awaiting_approval", payload=interrupts[0].value)


def _build_config(thread_id: str, api_keys: ApiKeys, policies: Policies) -> dict[str, Any]:
    """`api_keys`/`policies` are run configuration, not domain state — they live only in
    `configurable`, never in the dict passed as `astream`'s state input (so they never
    get checkpointed)."""
    return {
        "configurable": {
            "thread_id": thread_id,
            "api_keys": api_keys.model_dump(),
            "policies": policies.model_dump(),
        }
    }


async def _stream_leg(
    graph, run_id: str, state_input: Any, config: dict[str, Any]
) -> AsyncIterator[AgentEvent]:
    """Shared producer/consumer loop used by both `run_pipeline` and `resume_pipeline`:
    streams `graph.astream(state_input, config, stream_mode="updates")`, dispatches node
    updates to `AgentEvent`s via `EVENT_BY_NODE`, and — the moment an interrupt is
    observed — yields a single `awaiting_approval` event and ends the leg (stops
    iterating; the checkpoint already has everything the next leg needs)."""
    queue: asyncio.Queue[AgentEvent | object] = asyncio.Queue()

    async def emit_thought(step: str, text: str) -> None:
        await queue.put(AgentEvent(type="thought", payload={"step": step, "delta": text}))

    start_run(run_id, emit_thought)

    async def produce() -> None:
        try:
            async for update in graph.astream(state_input, config, stream_mode="updates"):
                interrupt_event = _interrupt_event(update)
                if interrupt_event is not None:
                    await queue.put(interrupt_event)
                    return
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


async def run_pipeline(graph, request: AgentRunRequest) -> AsyncIterator[AgentEvent]:
    initial = {
        "run_id": request.analysisId,
        "diff": request.diff,
        "changed_files": [file.model_dump() for file in request.changedFiles],
        "conventions": request.conventions,
        "models": request.models.model_dump(),
    }
    config = _build_config(request.analysisId, request.apiKeys, request.policies)
    async for event in _stream_leg(graph, request.analysisId, initial, config):
        yield event


async def resume_pipeline(
    graph,
    analysis_id: str,
    api_keys: ApiKeys,
    models: ReviewModels,
    policies: Policies,
    decision: ApprovalDecision | None,
) -> AsyncIterator[AgentEvent]:
    # `models` isn't re-fed as state here: `Command(resume=...)` replaces the state
    # input entirely, and the checkpoint already carries `models` from the leg that
    # started the run. Accepted as a parameter per the AgentResumeRequest contract
    # (kept for interface parity / future crash-recovery use), unused for now.
    del models
    resume_input = Command(resume=decision.model_dump()) if decision is not None else None
    config = _build_config(analysis_id, api_keys, policies)
    async for event in _stream_leg(graph, analysis_id, resume_input, config):
        yield event
