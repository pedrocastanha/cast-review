import json

from fastapi.testclient import TestClient

from app.infrastructure.llm.client import LlmError
from app.main import app

def _payload(**overrides):
    body = {
        "diff": "diff --git a/src/a.ts b/src/a.ts",
        "changedFiles": [
            {
                "path": "src/a.ts",
                "diff": "+export const x = 1",
                "fullContent": "export const x = 1",
                "relatedFiles": [],
            }
        ],
        "conventions": "",
        "models": {
            "testReviewer": "gpt-4o",
            "architectureReviewer": "gpt-4o",
        },
        "apiKeys": {"openai": "sk-test"},
    }
    body.update(overrides)
    return body

def _events(raw: str) -> list[dict]:
    events = []
    for chunk in raw.split("\n\n"):
        line = next((part for part in chunk.split("\n") if part.startswith("data:")), None)
        if line:
            events.append(json.loads(line[5:].strip()))
    return events

def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_rejects_payload_without_openai_key():
    client = TestClient(app)
    body = _payload()
    body["apiKeys"] = {"anthropic": "sk-old"}
    response = client.post("/agent/run", json=body)
    assert response.status_code == 422

def test_run_emits_pipeline_events_with_mocked_llm(monkeypatch):
    async def fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
        assert api_key == "sk-test"
        assert model == "gpt-4o"
        if "Product Requirements" in system or "PRD Writer" in system:
            return {
                "title": "Exporta x",
                "problem": "faltava o export",
                "whatChanged": "adiciona x",
                "goals": ["exportar x"],
                "nonGoals": [],
                "userImpact": "importar x",
                "constraints": [],
            }
        if "Architecture Reviewer" in system:
            return {"findings": []}
        return {
            "summary": "adiciona x",
            "newContracts": ["x"],
            "businessRules": ["exporta x"],
        }

    monkeypatch.setattr(
        "app.graph.agents.prd.agent.complete_json",
        fake_complete_json,
    )
    monkeypatch.setattr(
        "app.graph.agents.implementation_spec.agent.complete_json",
        fake_complete_json,
    )
    monkeypatch.setattr(
        "app.graph.agents.architecture_reviewer.agent.complete_json",
        fake_complete_json,
    )

    client = TestClient(app)
    with client.stream("POST", "/agent/run", json=_payload()) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        events = _events(response.read().decode())

    types = [event["type"] for event in events]
    assert types[0] == "change_analysis_done"
    assert types[1] == "prd_generated"
    assert types[2] == "spec_generated"
    assert set(types[3:5]) == {"test_reviewer_done", "architecture_reviewer_done"}
    assert types[-1] == "report_ready"

    prd = next(event for event in events if event["type"] == "prd_generated")
    assert prd["payload"]["title"] == "Exporta x"
    assert "# Exporta x" in prd["payload"]["markdown"]

    spec = next(event for event in events if event["type"] == "spec_generated")
    assert spec["payload"]["summary"] == "adiciona x"
    assert spec["payload"]["businessRules"] == ["exporta x"]

    test_review = next(event for event in events if event["type"] == "test_reviewer_done")
    assert test_review["payload"]["score"] == 85
    assert test_review["payload"]["findings"][0]["businessRule"] == "exporta x"

    architecture = next(
        event for event in events if event["type"] == "architecture_reviewer_done"
    )
    assert architecture["payload"]["score"] == 100
    assert architecture["payload"]["findings"] == []
    assert architecture["payload"]["conventionsSource"] == "default"

    report = events[-1]["payload"]
    assert report["spec"]["summary"] == "adiciona x"
    assert report["prd"]["title"] == "Exporta x"
    assert report["verdict"] == "comment"
    assert report["overallScore"] == 85
    assert report["conventionsSource"] == "default"
    assert "Relatório Cast Review" in report["markdown"]
    assert "Exporta x" in report["markdown"]

def test_llm_failure_emits_error_and_stops(monkeypatch):
    async def boom(**kwargs):
        raise LlmError("timeout ao chamar o LLM")

    monkeypatch.setattr(
        "app.graph.agents.prd.agent.complete_json",
        boom,
    )

    client = TestClient(app)
    with client.stream("POST", "/agent/run", json=_payload()) as response:
        events = _events(response.read().decode())

    types = [event["type"] for event in events]
    assert types[0] == "change_analysis_done"
    assert types[-1] == "error"
    assert "report_ready" not in types
    assert events[-1]["payload"]["message"] == "timeout ao chamar o LLM"
