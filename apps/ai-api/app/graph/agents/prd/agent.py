from app.graph.state import GraphState
from app.graph.thoughts import emit_thought
from app.graph.utils.files import clip_diff, files_block
from app.graph.utils.loader import build_system_prompt
from app.infrastructure.llm.client import complete_json

async def generate_prd(
    *,
    diff: str,
    changed_files: list[dict],
    change_analysis: dict,
    model: str,
    api_key: str,
    run_id: str | None = None,
) -> dict:
    system = build_system_prompt("prd", ["describe-shipped-change"])
    raw = await complete_json(
        system=system,
        user=(
            f"CHANGE_ANALYSIS:\n{change_analysis}\n\n"
            f"DIFF:\n{clip_diff(diff)}\n\n"
            f"FILES:\n{files_block(changed_files)}"
        ),
        model=model,
        api_key=api_key,
        on_delta=lambda delta: emit_thought("prd", delta, run_id),
    )
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
    return prd

async def node(state: GraphState) -> dict:

    prd = await generate_prd(
        diff=state["diff"],
        changed_files=state["changed_files"],
        change_analysis=state.get("change_analysis") or {},
        model=state["models"]["testReviewer"],
        api_key=state["api_keys"]["openai"],
        run_id=state.get("run_id"),
    )
    return {"prd": prd}

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
