from app.graph.utils.conventions import resolve_conventions
from app.graph.utils.verdict import decide_verdict


def test_resolve_conventions_uses_repo_when_present():
    text, source = resolve_conventions("nunca usar float")
    assert source == "repo"
    assert text == "nunca usar float"


def test_resolve_conventions_falls_back_to_default():
    text, source = resolve_conventions("  ")
    assert source == "default"
    assert "Controller HTTP é porta fina" in text


def test_verdict_approve_when_clean():
    decision = decide_verdict(
        [{"name": "test_reviewer", "score": 100, "findings": [{"status": "pass"}]}]
    )
    assert decision["verdict"] == "approve"
    assert decision["overallScore"] == 100


def test_verdict_comment_on_single_fail():
    decision = decide_verdict(
        [{"name": "test_reviewer", "score": 85, "findings": [{"status": "fail"}]}]
    )
    assert decision["verdict"] == "comment"


def test_verdict_request_changes_on_two_fails():
    decision = decide_verdict(
        [
            {
                "name": "test_reviewer",
                "score": 70,
                "findings": [{"status": "fail"}, {"status": "fail"}],
            }
        ]
    )
    assert decision["verdict"] == "request_changes"
    assert decision["overallScore"] == 70
