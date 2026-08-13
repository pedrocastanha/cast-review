from app.domain.agents.entities import Finding
from app.domain.agents.scoring import calculate_score

ALLOWED_STATUS = {"fail", "warning", "pass"}

def normalize_findings(raw: object) -> list[Finding]:
    if not isinstance(raw, list):
        return []

    findings: list[Finding] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        status = item.get("status")
        if status not in ALLOWED_STATUS:
            continue
        findings.append(
            Finding(
                status=status,
                title=str(item.get("title") or "Finding"),
                detail=str(item.get("detail") or ""),
                business_rule=_optional_str(item.get("businessRule") or item.get("business_rule")),
                convention_ref=_optional_str(item.get("conventionRef") or item.get("convention_ref")),
            )
        )
    return findings

def review_payload(findings: list[Finding]) -> dict:
    return {
        "score": calculate_score(findings),
        "findings": [finding.to_payload() for finding in findings],
    }

def _optional_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None
