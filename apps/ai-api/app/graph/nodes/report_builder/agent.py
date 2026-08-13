from app.graph.state import GraphState

def build_report(spec: dict, results: list[dict], prd: dict | None = None) -> dict:
    lines = [
        "# Relatório Cast Review",
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
        if not findings:
            lines.append("- nenhum finding")
            continue
        for finding in findings:
            ref = f" (`{finding['conventionRef']}`)" if finding.get("conventionRef") else ""
            lines.append(
                f"- **{finding['status']}** {finding['title']}: {finding['detail']}{ref}"
            )
        lines.append("")

    return {
        "prd": prd,
        "spec": spec,
        "results": results,
        "markdown": "\n".join(lines).strip() + "\n",
    }

async def node(state: GraphState) -> dict:
    results = [
        {"name": "test_reviewer", **state["test_review"]},
        {"name": "architecture_reviewer", **state["architecture_review"]},
    ]
    return {"report": build_report(state["spec"], results, state.get("prd"))}
