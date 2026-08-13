from app.domain.agents.entities import Finding
from app.domain.agents.scoring import calculate_score

def test_score_starts_at_100_with_no_findings():
    assert calculate_score([]) == 100

def test_fail_and_warning_weights():
    findings = [
        Finding(status="fail", title="a", detail=""),
        Finding(status="fail", title="b", detail=""),
        Finding(status="warning", title="c", detail=""),
        Finding(status="pass", title="d", detail=""),
    ]
    assert calculate_score(findings) == 65

def test_score_clamps_at_zero():
    findings = [Finding(status="fail", title=str(i), detail="") for i in range(10)]
    assert calculate_score(findings) == 0
