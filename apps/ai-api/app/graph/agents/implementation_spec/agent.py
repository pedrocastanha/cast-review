from langchain_core.runnables import RunnableConfig

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
    revision_notes: list[dict] | None = None,
    previous_spec: dict | None = None,
    related_context: dict | None = None,
) -> dict:
    system = build_system_prompt("implementation_spec", ["extract-observable-rules"])
    context = prd_block(prd)
    prefix = f"{context}\n\n" if context else ""
    if revision_notes:
        user = (
            f"{prefix}REVISION REQUEST — refine the previous spec below using the reviewer notes.\n\n"
            f"PREVIOUS SPEC:\n{_spec_block(previous_spec)}\n\n"
            f"REVIEWER NOTES:\n{_revision_notes_block(revision_notes)}\n\n"
            f"DIFF:\n{clip_diff(diff)}\n\nFILES:\n{files_block(changed_files, related_context)}"
        )
    else:
        user = f"{prefix}DIFF:\n{clip_diff(diff)}\n\nFILES:\n{files_block(changed_files, related_context)}"
    result = await complete_json(
        system=system,
        user=user,
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

async def node(state: GraphState, config: RunnableConfig) -> dict:
    spec = await generate_implementation_spec(
        diff=state["diff"],
        changed_files=state["changed_files"],
        model=state["models"]["testReviewer"],
        api_key=config["configurable"]["api_keys"]["openai"],
        prd=state.get("prd"),
        run_id=state.get("run_id"),
        revision_notes=state.get("revision_notes"),
        previous_spec=state.get("spec"),
        related_context=(state.get("change_analysis") or {}).get("relatedContext"),
    )
    return {"spec": spec}

def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]

def _spec_block(spec: dict | None) -> str:
    if not spec:
        return ""
    lines = [f"Summary: {spec.get('summary') or ''}"]
    contracts = spec.get("newContracts") or []
    if contracts:
        lines.append("New contracts:")
        lines.extend(f"- {item}" for item in contracts)
    rules = spec.get("businessRules") or []
    if rules:
        lines.append("Business rules:")
        lines.extend(f"- {item}" for item in rules)
    return "\n".join(lines)

def _revision_notes_block(notes: list[dict]) -> str:
    lines = []
    for note in notes:
        excerpt = str(note.get("excerpt") or "").strip()
        text = str(note.get("note") or "").strip()
        lines.append(f'- On "{excerpt}": {text}')
    return "\n".join(lines)
