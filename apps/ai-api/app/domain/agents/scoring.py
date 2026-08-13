from app.domain.agents.entities import Finding

SEVERITY_WEIGHTS = {"fail": -15, "warning": -5, "pass": 0}

def calculate_score(findings: list[Finding]) -> int:
    score = 100 + sum(SEVERITY_WEIGHTS[finding.status] for finding in findings)
    return max(0, min(100, score))
