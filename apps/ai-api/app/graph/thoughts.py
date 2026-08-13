from collections.abc import Awaitable, Callable
from contextvars import ContextVar

EmitThought = Callable[[str, str], Awaitable[None]]

_EMITTERS: dict[str, EmitThought] = {}
_run_id: ContextVar[str | None] = ContextVar("thought_run_id", default=None)

def start_run(run_id: str, emit: EmitThought) -> None:
    _EMITTERS[run_id] = emit
    _run_id.set(run_id)

def end_run(run_id: str) -> None:
    _EMITTERS.pop(run_id, None)
    _run_id.set(None)

async def emit_thought(step: str, text: str, run_id: str | None = None) -> None:
    if not text:
        return
    rid = run_id or _run_id.get()
    emit = _EMITTERS.get(rid) if rid else None
    if emit:
        await emit(step, text)
