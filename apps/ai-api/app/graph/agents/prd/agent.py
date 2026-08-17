from langchain_core.runnables import RunnableConfig

from app.graph.state import GraphState
from app.graph.thoughts import emit_thought
from app.graph.utils.files import clip_diff, files_block
from app.graph.utils.loader import build_system_prompt
from app.graph.utils.usage import step_usage, without_usage
from app.infrastructure.llm.client import complete_json

async def generate_prd(
    *,
    diff: str,
    changed_files: list[dict],
    change_analysis: dict,
    model: str,
    api_key: str,
    run_id: str | None = None,
    prior_prd: dict | None = None,
    revision_notes: list[dict] | None = None,
) -> dict:
    system = build_system_prompt("prd", ["describe-shipped-change"])
    user = (
        _build_revision_prompt(diff, changed_files, change_analysis, prior_prd, revision_notes)
        if revision_notes
        else (
            f"CHANGE_ANALYSIS:\n{change_analysis}\n\n"
            f"DIFF:\n{clip_diff(diff)}\n\n"
            f"FILES:\n{files_block(changed_files)}"
        )
    )
    result = await complete_json(
        system=system,
        user=user,
        model=model,
        api_key=api_key,
        on_delta=lambda delta: emit_thought("prd", delta, run_id),
    )
    raw = result.data
    prd = {
        "title": str(raw.get("title") or "Mudança na PR").strip(),
        "problem": str(raw.get("problem") or "").strip(),
        "whatChanged": str(raw.get("whatChanged") or "").strip(),
        "goals": _string_list(raw.get("goals")),
        "nonGoals": _string_list(raw.get("nonGoals")),
        "userImpact": str(raw.get("userImpact") or "").strip(),
        "constraints": _string_list(raw.get("constraints")),
    }

    prd["markdown"] = _to_markdown(prd)
    prd["usage"] = step_usage("prd", model, result.usage)
    return prd

async def node(state: GraphState, config: RunnableConfig) -> dict:

    prd = await generate_prd(
        diff=state["diff"],
        changed_files=state["changed_files"],
        change_analysis=without_usage(state.get("change_analysis") or {}),
        model=state["models"]["testReviewer"],
        api_key=config["configurable"]["api_keys"]["openai"],
        run_id=state.get("run_id"),
        prior_prd=state.get("prd"),
        revision_notes=state.get("revision_notes"),
    )
    return {"prd": prd}

def _build_revision_prompt(
    diff: str,
    changed_files: list[dict],
    change_analysis: dict,
    prior_prd: dict | None,
    revision_notes: list[dict],
) -> str:
    notes_block = "\n\n".join(
        f"- Trecho: {note.get('excerpt', '')}\n  Observação: {note.get('note', '')}"
        for note in revision_notes
    )
    prior_content = (prior_prd or {}).get("markdown") or ""
    return (
        f"PRD_ANTERIOR:\n{prior_content}\n\n"
        f"FEEDBACK_DE_REVISAO:\n{notes_block}\n\n"
        f"CHANGE_ANALYSIS:\n{change_analysis}\n\n"
        f"DIFF:\n{clip_diff(diff)}\n\n"
        f"FILES:\n{files_block(changed_files)}\n\n"
        "Instrução: revise o PRD anterior incorporando o feedback de revisão listado "
        "acima, mantendo o formato JSON definido no system prompt."
    )

def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]

def _to_markdown(prd: dict) -> str:
    def bullets(items: list[str], empty: str) -> list[str]:
        return [f"- {item}" for item in items] or [f"- {empty}"]

    lines = [
        f"# {prd['title']}",
        "",
        "## Problema",
        prd["problem"] or "_não descrito_",
        "",
        "## O que mudou",
        prd["whatChanged"] or "_não descrito_",
        "",
        "## Objetivos",
        *bullets(prd["goals"], "nenhum"),
        "",
        "## Fora de escopo",
        *bullets(prd["nonGoals"], "nada declarado"),
        "",
        "## Impacto",
        prd["userImpact"] or "_não descrito_",
        "",
        "## Restrições",
        *bullets(prd["constraints"], "nenhuma"),
        "",
    ]
    return "\n".join(lines)
