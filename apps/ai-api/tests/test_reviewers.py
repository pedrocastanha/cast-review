import pytest

from app.graph.agents.architecture_reviewer import run_architecture_reviewer
from app.graph.nodes.report_builder import build_impact_result, build_report
from app.graph.agents.test_reviewer import run_test_reviewer
from tests.llm_fakes import llm

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
    assert result["usage"]["skipped"] is True
    assert all(item["path"] == "src/interest.ts" for item in result["findings"])
    assert all(item["line"] == 1 for item in result["findings"])

@pytest.mark.asyncio
async def test_tests_known_by_graph_let_llm_run_when_pr_has_no_test_file(monkeypatch):
    captured: dict = {}

    async def fake_llm(**kwargs):
        captured["user"] = kwargs["user"]
        return llm(
            {
                "findings": [
                    {
                        "status": "pass",
                        "title": "coberto",
                        "detail": "teste existente exercita a regra",
                        "businessRule": "cobra juros",
                    }
                ]
            }
        )

    monkeypatch.setattr(
        "app.graph.agents.test_reviewer.agent.complete_json",
        fake_llm,
    )

    result = await run_test_reviewer(
        spec={"businessRules": ["cobra juros"]},
        changed_files=[{"path": "src/interest.ts", "diff": "", "fullContent": ""}],
        model="gpt-4o",
        api_key="sk-test",
        related_context={
            "tests": [
                {
                    "path": "src/interest.spec.ts",
                    "name": "cobraJuros",
                    "signature": "it('cobra juros')",
                    "body": "it('cobra juros', () => expect(interest(100)).toBe(110));",
                }
            ]
        },
    )

    assert "src/interest.spec.ts" in captured["user"]
    assert result["findings"][0]["status"] == "pass"
    assert result["score"] == 100


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
    assert result["score"] == 100
    assert result["findings"] == []
    assert result["usage"]["skipped"] is True

@pytest.mark.asyncio
async def test_covers_rules_the_llm_forgot(monkeypatch):
    async def fake_llm(**kwargs):
        return llm(
            {
                "findings": [
                    {
                        "status": "pass",
                        "title": "ok",
                        "detail": "tem teste",
                        "businessRule": "cobra juros",
                    }
                ]
            }
        )

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
async def test_empty_conventions_uses_default_and_calls_llm(monkeypatch):
    captured: dict = {}

    async def fake_llm(**kwargs):
        captured["user"] = kwargs["user"]
        return llm(
            {
                "findings": [
                    {
                        "status": "warning",
                        "title": "controller gordo",
                        "detail": "validação no controller",
                        "conventionRef": "Controller HTTP é porta fina",
                    }
                ]
            }
        )

    monkeypatch.setattr(
        "app.graph.agents.architecture_reviewer.agent.complete_json",
        fake_llm,
    )

    result = await run_architecture_reviewer(
        spec={"summary": "x", "businessRules": []},
        changed_files=[{"path": "src/a.ts", "diff": "", "fullContent": ""}],
        conventions="   ",
        model="gpt-4o",
        api_key="sk-test",
    )

    assert result["conventionsSource"] == "default"
    assert result["score"] == 95
    assert "padrão Cast Review" in captured["user"]
    assert result["findings"][0]["conventionRef"] == "Controller HTTP é porta fina"

@pytest.mark.asyncio
async def test_architecture_drops_findings_without_convention_ref(monkeypatch):
    async def fake_llm(**kwargs):
        return llm(
            {
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
        )

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
    assert result["conventionsSource"] == "repo"
    assert len(result["findings"]) == 1
    assert result["findings"][0]["conventionRef"] == "nunca usar float para dinheiro"

def test_report_contains_scores_spec_and_verdict():
    report = build_report(
        {"summary": "muda juros", "newContracts": [], "businessRules": ["cobra juros"]},
        [
            {
                "name": "test_reviewer",
                "score": 85,
                "findings": [
                    {
                        "status": "fail",
                        "title": "sem teste",
                        "detail": "falta",
                    }
                ],
            }
        ],
        conventions_source="default",
    )
    assert report["spec"]["summary"] == "muda juros"
    assert report["verdict"] == "comment"
    assert report["overallScore"] == 85
    assert report["conventionsSource"] == "default"
    assert "score 85" in report["markdown"]
    assert "Comentar" in report["markdown"]


def test_impact_result_only_emits_findings_bound_to_existing_evidence():
    related = {
        "crossRepoImpacts": [
            {
                "id": "impact-1",
                "evidenceId": "evidence-1",
                "risk": "breaking_candidate",
                "confidence": "confirmed",
                "direction": "cast/frontend -> cast/backend",
                "method": "DELETE",
                "route": "/projects/{param}",
            },
            {
                "id": "impact-invalid",
                "evidenceId": "missing",
                "risk": "breaking_candidate",
                "confidence": "confirmed",
                "direction": "x -> y",
                "method": "GET",
                "route": "/made-up",
            },
        ],
        "crossRepoEvidence": [
            {
                "id": "evidence-1",
                "consumer": {"repoId": "cast/frontend", "path": "src/api.ts", "line": 18},
                "provider": {
                    "repoId": "cast/backend",
                    "path": "src/projects.controller.ts",
                    "line": 7,
                },
            }
        ],
    }

    result = build_impact_result(related)

    assert result["name"] == "impact_reviewer"
    assert len(result["findings"]) == 1
    assert result["findings"][0]["evidenceId"] == "evidence-1"
    assert result["findings"][0]["path"] == "src/api.ts"
    assert result["findings"][0]["line"] == 18
