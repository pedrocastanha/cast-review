import pytest

from app.graph.agents.architecture_reviewer import run_architecture_reviewer
from app.graph.nodes.report_builder import build_report
from app.graph.agents.test_reviewer import run_test_reviewer

@pytest.mark.asyncio
async def test_no_tests_fails_every_business_rule_without_llm(monkeypatch):
    async def fail_if_called(**kwargs):
        raise AssertionError("LLM não deveria ser chamado")

    monkeypatch.setattr(
        "app.graph.agents.test_reviewer.agent.complete_json",
        fail_if_called,
    )

    result = await run_test_reviewer(
        spec={"businessRules": ["cobra juros", "arredonda half-up"]},
        changed_files=[{"path": "src/interest.ts", "diff": "", "fullContent": ""}],
        model="gpt-4o",
        api_key="sk-test",
    )

    assert result["score"] == 70
    assert {item["businessRule"] for item in result["findings"]} == {
        "cobra juros",
        "arredonda half-up",
    }
    assert all(item["status"] == "fail" for item in result["findings"])

@pytest.mark.asyncio
async def test_empty_rules_scores_100_without_llm(monkeypatch):
    async def fail_if_called(**kwargs):
        raise AssertionError("LLM não deveria ser chamado")

    monkeypatch.setattr(
        "app.graph.agents.test_reviewer.agent.complete_json",
        fail_if_called,
    )

    result = await run_test_reviewer(
        spec={"businessRules": []},
        changed_files=[{"path": "src/a.spec.ts"}],
        model="gpt-4o",
        api_key="sk-test",
    )
    assert result == {"score": 100, "findings": []}

@pytest.mark.asyncio
async def test_covers_rules_the_llm_forgot(monkeypatch):
    async def fake_llm(**kwargs):
        return {
            "findings": [
                {
                    "status": "pass",
                    "title": "ok",
                    "detail": "tem teste",
                    "businessRule": "cobra juros",
                }
            ]
        }

    monkeypatch.setattr(
        "app.graph.agents.test_reviewer.agent.complete_json",
        fake_llm,
    )

    result = await run_test_reviewer(
        spec={"businessRules": ["cobra juros", "arredonda half-up"]},
        changed_files=[{"path": "src/interest.spec.ts", "diff": "", "fullContent": "it('x')"}],
        model="gpt-4o",
        api_key="sk-test",
    )

    by_rule = {item["businessRule"]: item for item in result["findings"]}
    assert by_rule["cobra juros"]["status"] == "pass"
    assert by_rule["arredonda half-up"]["status"] == "fail"
    assert result["score"] == 85

@pytest.mark.asyncio
async def test_empty_conventions_skips_llm_and_scores_100(monkeypatch):
    async def fail_if_called(**kwargs):
        raise AssertionError("LLM não deveria ser chamado")

    monkeypatch.setattr(
        "app.graph.agents.architecture_reviewer.agent.complete_json",
        fail_if_called,
    )

    result = await run_architecture_reviewer(
        spec={"summary": "x", "businessRules": []},
        changed_files=[{"path": "src/a.ts"}],
        conventions="   ",
        model="gpt-4o",
        api_key="sk-test",
    )

    assert result == {"score": 100, "findings": []}

@pytest.mark.asyncio
async def test_architecture_drops_findings_without_convention_ref(monkeypatch):
    async def fake_llm(**kwargs):
        return {
            "findings": [
                {
                    "status": "fail",
                    "title": "float",
                    "detail": "usou float",
                    "conventionRef": "nunca usar float para dinheiro",
                },
                {
                    "status": "warning",
                    "title": "opinião",
                    "detail": "eu não gostei do nome",
                },
            ]
        }

    monkeypatch.setattr(
        "app.graph.agents.architecture_reviewer.agent.complete_json",
        fake_llm,
    )

    result = await run_architecture_reviewer(
        spec={"summary": "x"},
        changed_files=[{"path": "src/a.ts", "diff": "", "fullContent": ""}],
        conventions="nunca usar float para dinheiro",
        model="gpt-4o",
        api_key="sk-test",
    )

    assert result["score"] == 85
    assert len(result["findings"]) == 1
    assert result["findings"][0]["conventionRef"] == "nunca usar float para dinheiro"

def test_report_contains_scores_and_spec():
    report = build_report(
        {"summary": "muda juros", "newContracts": [], "businessRules": ["cobra juros"]},
        [{"name": "test_reviewer", "score": 85, "findings": []}],
    )
    assert report["spec"]["summary"] == "muda juros"
    assert "score 85" in report["markdown"]
