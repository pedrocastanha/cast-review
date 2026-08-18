from app.config.settings import MAX_PROMPT_FILE_CHARS
from app.graph.utils.conventions import resolve_conventions
from app.graph.utils.files import files_block, prd_block
from app.graph.utils.findings import normalize_findings, review_payload
from app.graph.utils.loader import build_system_prompt
from langchain_core.runnables import RunnableConfig

from app.graph.state import GraphState
from app.graph.thoughts import emit_thought
from app.graph.utils.usage import skipped_step, step_usage
from app.infrastructure.llm.client import complete_json


async def run_architecture_reviewer(
    *,
    spec: dict,
    changed_files: list[dict],
    conventions: str,
    model: str,
    api_key: str,
    prd: dict | None = None,
    run_id: str | None = None,
) -> dict:
    text, source = resolve_conventions(conventions)
    if not text:
        payload = review_payload([])
        payload["conventionsSource"] = source
        payload["usage"] = skipped_step("architecture_reviewer")
        return payload

    system = build_system_prompt("architecture_reviewer", ["cite-convention"])
    result = await complete_json(
        system=system,
        user=_user_prompt(spec, changed_files, text, source, prd),
        model=model,
        api_key=api_key,
        on_delta=lambda delta: emit_thought("architecture_reviewer", delta, run_id),
    )
    findings = [
        finding
        for finding in normalize_findings(result.data.get("findings"))
        if finding.convention_ref
    ]
    payload = review_payload(findings)
    payload["conventionsSource"] = source
    payload["usage"] = step_usage("architecture_reviewer", model, result.usage)
    return payload


async def node(state: GraphState, config: RunnableConfig) -> dict:
    review = await run_architecture_reviewer(
        spec=state["spec"],
        changed_files=state["changed_files"],
        conventions=state.get("conventions") or "",
        model=state["models"]["architectureReviewer"],
        api_key=config["configurable"]["api_keys"]["openai"],
        prd=state.get("prd"),
        run_id=state.get("run_id"),
    )
    return {"architecture_review": review}


def _user_prompt(
    spec: dict,
    changed_files: list[dict],
    conventions: str,
    source: str,
    prd: dict | None,
) -> str:
    prefix = prd_block(prd)
    head = f"{prefix}\n\n" if prefix else ""
    origin = "repositório" if source == "repo" else "padrão Cast Review (repo sem conventions.md)"
    return (
        f"{head}spec:\n{spec}\n\n"
        f"origem das convenções: {origin}\n"
        f"conventions.md:\n{conventions[:MAX_PROMPT_FILE_CHARS]}\n\n"
        f"changed files:\n{files_block(changed_files)}"
    )
