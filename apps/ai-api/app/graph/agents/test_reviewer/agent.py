from app.graph.nodes.change_analyzer.agent import analyze_changes
from app.graph.utils.files import files_block, prd_block
from app.graph.utils.findings import normalize_findings, review_payload
from app.graph.utils.loader import build_system_prompt
from app.graph.state import GraphState
from app.domain.agents.entities import Finding
from langchain_core.runnables import RunnableConfig
from app.graph.thoughts import emit_thought
from app.graph.utils.usage import skipped_step, step_usage
from app.infrastructure.llm.client import complete_json

async def run_test_reviewer(
    *,
    spec: dict,
    changed_files: list[dict],
    model: str,
    api_key: str,
    prd: dict | None = None,
    run_id: str | None = None,
    related_context: dict | None = None,
) -> dict:
    business_rules = [rule for rule in spec.get("businessRules") or [] if isinstance(rule, str)]
    analysis = analyze_changes(changed_files)

    if not business_rules:
        payload = review_payload([])
        payload["usage"] = skipped_step("test_reviewer")
        return payload

    if not analysis["hasTests"]:
        path = _anchor_path(analysis, changed_files)
        payload = review_payload([_missing_test(rule, path) for rule in business_rules])
        payload["usage"] = skipped_step("test_reviewer")
        return payload

    system = build_system_prompt("test_reviewer", ["map-rule-to-test"])
    result = await complete_json(
        system=system,
        user=_user_prompt(business_rules, changed_files, prd, related_context),
        model=model,
        api_key=api_key,
        on_delta=lambda delta: emit_thought("test_reviewer", delta, run_id),
    )
    findings = normalize_findings(result.data.get("findings"))
    findings = _ensure_every_rule_covered(
        business_rules, findings, _anchor_path(analysis, changed_files)
    )
    payload = review_payload(findings)
    payload["usage"] = step_usage("test_reviewer", model, result.usage)
    return payload

async def node(state: GraphState, config: RunnableConfig) -> dict:
    review = await run_test_reviewer(
        spec=state["spec"],
        changed_files=state["changed_files"],
        model=state["models"]["testReviewer"],
        api_key=config["configurable"]["api_keys"]["openai"],
        prd=state.get("prd"),
        run_id=state.get("run_id"),
        related_context=(state.get("change_analysis") or {}).get("relatedContext"),
    )
    return {"test_review": review}

def _missing_test(rule: str, path: str | None = None) -> Finding:
    return Finding(
        status="fail",
        title="Regra sem teste",
        detail=f"Nenhum arquivo de teste na PR cobre: {rule}",
        business_rule=rule,
        path=path,
        line=1 if path else None,
    )


def _anchor_path(analysis: dict, changed_files: list[dict]) -> str | None:
    """Primeiro source da análise; senão o primeiro arquivo da PR."""
    for item in analysis.get("files") or []:
        if item.get("kind") == "source" and item.get("path"):
            return str(item["path"])
    for file in changed_files:
        path = file.get("path")
        if path:
            return str(path)
    return None


def _ensure_every_rule_covered(
    rules: list[str],
    findings: list[Finding],
    path: str | None,
) -> list[Finding]:
    covered = {finding.business_rule for finding in findings if finding.business_rule}
    missing = [_missing_test(rule, path) for rule in rules if rule not in covered]
    return findings + missing

def _user_prompt(
    rules: list[str],
    changed_files: list[dict],
    prd: dict | None,
    related_context: dict | None = None,
) -> str:
    prefix = prd_block(prd)
    head = f"{prefix}\n\n" if prefix else ""
    return (
        f"{head}businessRules:\n"
        + "\n".join(f"- {rule}" for rule in rules)
        + "\n\nchanged files (path, diff, fullContent):\n"
        + files_block(changed_files, related_context)
    )
