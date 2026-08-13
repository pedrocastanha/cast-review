from app.graph.state import GraphState
from app.graph.utils.conventions import resolve_conventions
from app.graph.utils.usage import aggregate_usage, collect_steps_from_state, without_usage
from app.graph.utils.verdict import decide_verdict

VERDICT_LABEL = {
    "approve": "Aprovar",
    "comment": "Comentar",
    "request_changes": "Pedir mudanças",
}


def build_report(
    spec: dict,
    results: list[dict],
    prd: dict | None = None,
    conventions_source: str = "repo",
    usage: dict | None = None,
) -> dict:
    decision = decide_verdict(results)
    clean_prd = without_usage(prd) if prd else None
    clean_spec = without_usage(spec)
    clean_results = [without_usage(item) for item in results]
    headline = (clean_prd or {}).get("title") or clean_spec.get("summary") or "Review da PR"
    lines = [
        "# Relatório Cast Review",
        "",
        f"**Veredito:** {VERDICT_LABEL.get(decision['verdict'], decision['verdict'])}",
        f"**Nota geral:** {decision['overallScore']}",
        f"**Convenções:** {'do repositório' if conventions_source == 'repo' else 'padrão Cast Review'}",
        *_cost_lines(usage),
        "",
    ]

    if clean_prd:
        lines.extend(
            [
                "## PRD",
                clean_prd.get("title") or "_sem título_",
                "",
                clean_prd.get("whatChanged") or clean_prd.get("problem") or "_sem resumo_",
                "",
            ]
        )

    lines.extend(
        [
            "## Implementation Spec",
            clean_spec.get("summary") or "_sem summary_",
            "",
            "### Contratos novos",
            *([f"- {item}" for item in clean_spec.get("newContracts") or []] or ["- nenhum"]),
            "",
            "### Regras de negócio",
            *([f"- {item}" for item in clean_spec.get("businessRules") or []] or ["- nenhuma"]),
            "",
            "## Reviewers",
        ]
    )

    for result in results:
        lines.append(f"### {result['name']} — score {result['score']}")
        findings = result.get("findings") or []
        ordered = sorted(
            findings,
            key=lambda item: {"fail": 0, "warning": 1, "pass": 2}.get(item.get("status"), 3),
        )
        if not ordered:
            lines.append("- nenhum finding")
            continue
        for finding in ordered:
            ref = f" (`{finding['conventionRef']}`)" if finding.get("conventionRef") else ""
            lines.append(
                f"- **{finding['status']}** {finding['title']}: {finding['detail']}{ref}"
            )
        lines.append("")

    report = {
        "prd": clean_prd,
        "spec": clean_spec,
        "results": clean_results,
        "verdict": decision["verdict"],
        "overallScore": decision["overallScore"],
        "failCount": decision["failCount"],
        "warningCount": decision["warningCount"],
        "headline": headline,
        "conventionsSource": conventions_source,
        "markdown": "\n".join(lines).strip() + "\n",
    }
    if usage:
        report["usage"] = usage
    return report


def _cost_lines(usage: dict | None) -> list[str]:
    if not usage:
        return []
    tokens = int(usage.get("totalTokens") or 0)
    billed = sum(1 for step in usage.get("steps") or [] if not step.get("skipped"))
    if usage.get("costComplete") and isinstance(usage.get("costUsd"), (int, float)):
        cost = f"${float(usage['costUsd']):.4f}"
    else:
        cost = "preço não tabelado"
    return [
        f"**Custo:** {cost} · {tokens} tokens · {billed} etapa(s) com LLM",
    ]


async def node(state: GraphState) -> dict:
    results = [
        {"name": "test_reviewer", **state["test_review"]},
        {"name": "architecture_reviewer", **state["architecture_review"]},
    ]
    _text, source = resolve_conventions(state.get("conventions") or "")
    usage = aggregate_usage(collect_steps_from_state(state))
    return {
        "report": build_report(state["spec"], results, state.get("prd"), source, usage),
    }
