from app.graph.state import GraphState
from app.graph.thoughts import emit_thought
from app.graph.utils.files import clip_diff, files_block, prd_block
from app.graph.utils.loader import build_system_prompt
from app.graph.utils.usage import step_usage
from app.infrastructure.llm.client import complete_json

async def generate_implementation_spec(
    *,
    diff: str,
    changed_files: list[dict],
    model: str,
    api_key: str,
    prd: dict | None = None,
    run_id: str | None = None,
) -> dict:
    system = build_system_prompt("implementation_spec", ["extract-observable-rules"])
    context = prd_block(prd)
    prefix = f"{context}\n\n" if context else ""
    result = await complete_json(
        system=system,
        user=f"{prefix}DIFF:\n{clip_diff(diff)}\n\nFILES:\n{files_block(changed_files)}",
        model=model,
        api_key=api_key,
        on_delta=lambda delta: emit_thought("implementation_spec", delta, run_id),
    )
    raw = result.data
    return {
        "summary": str(raw.get("summary") or "").strip(),
        "newContracts": _string_list(raw.get("newContracts")),
        "businessRules": _string_list(raw.get("businessRules")),
        "usage": step_usage("implementation_spec", model, result.usage),
    }

async def node(state: GraphState) -> dict:
    spec = await generate_implementation_spec(
        diff=state["diff"],
        changed_files=state["changed_files"],
        model=state["models"]["testReviewer"],
        api_key=state["api_keys"]["openai"],
        prd=state.get("prd"),
        run_id=state.get("run_id"),
    )
    return {"spec": spec}

def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]
