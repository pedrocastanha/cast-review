from app.graph.state import GraphState
from app.graph.utils.conventions import resolve_conventions
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
) -> dict:
    decision = decide_verdict(results)
    headline = (prd or {}).get("title") or spec.get("summary") or "Review da PR"
    lines = [
        "# Relatório Cast Review",
        "",
        f"**Veredito:** {VERDICT_LABEL.get(decision['verdict'], decision['verdict'])}",
        f"**Nota geral:** {decision['overallScore']}",
        f"**Convenções:** {'do repositório' if conventions_source == 'repo' else 'padrão Cast Review'}",
        "",
    ]

    if prd:
        lines.extend(
            [
                "## PRD",
                prd.get("title") or "_sem título_",
                "",
                prd.get("whatChanged") or prd.get("problem") or "_sem resumo_",
                "",
            ]
        )

    lines.extend(
        [
            "## Implementation Spec",
            spec.get("summary") or "_sem summary_",
            "",
            "### Contratos novos",
            *([f"- {item}" for item in spec.get("newContracts") or []] or ["- nenhum"]),
            "",
            "### Regras de negócio",
            *([f"- {item}" for item in spec.get("businessRules") or []] or ["- nenhuma"]),
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

    return {
        "prd": prd,
        "spec": spec,
        "results": results,
        "verdict": decision["verdict"],
        "overallScore": decision["overallScore"],
        "failCount": decision["failCount"],
        "warningCount": decision["warningCount"],
        "headline": headline,
        "conventionsSource": conventions_source,
        "markdown": "\n".join(lines).strip() + "\n",
    }


async def node(state: GraphState) -> dict:
    results = [
        {"name": "test_reviewer", **state["test_review"]},
        {"name": "architecture_reviewer", **state["architecture_review"]},
    ]
    _text, source = resolve_conventions(state.get("conventions") or "")
    return {"report": build_report(state["spec"], results, state.get("prd"), source)}
