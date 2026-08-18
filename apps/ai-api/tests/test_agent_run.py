from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from app.application.dto.schemas import (
    AgentRunRequest,
    ApiKeys,
    ApprovalDecision,
    Policies,
    ReviewModels,
)
from app.graph.graph import build_graph
from app.graph.pipeline import resume_pipeline, run_pipeline
from app.infrastructure.llm.client import LlmError
from app.main import app
from tests.llm_fakes import llm

def _payload(**overrides):
    body = {
        "analysisId": "test-analysis-id",
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

def _auto_policies() -> dict:
    """Policies that let a run flow straight to completion without any interrupt —
    used by tests that exercise the fresh-run happy path / error path, unrelated to
    the HITL gate mechanics themselves."""
    return {"prd": "auto", "spec": "auto"}

def _patch_llm(monkeypatch, fake_complete_json):
    monkeypatch.setattr("app.graph.agents.prd.agent.complete_json", fake_complete_json)
    monkeypatch.setattr(
        "app.graph.agents.implementation_spec.agent.complete_json", fake_complete_json
    )
    monkeypatch.setattr(
        "app.graph.agents.architecture_reviewer.agent.complete_json", fake_complete_json
    )

async def _fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
    assert api_key == "sk-test"
    assert model == "gpt-4o"
    if "Product Requirements" in system or "PRD Writer" in system:
        return llm(
            {
                "title": "Exporta x",
                "problem": "faltava o export",
                "whatChanged": "adiciona x",
                "goals": ["exportar x"],
                "nonGoals": [],
                "userImpact": "importar x",
                "constraints": [],
            },
            prompt=100,
            completion=20,
        )
    if "Architecture Reviewer" in system:
        return llm({"findings": []}, prompt=80, completion=10)
    return llm(
        {
            "summary": "adiciona x",
            "newContracts": ["x"],
            "businessRules": ["exporta x"],
        },
        prompt=60,
        completion=15,
    )

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

async def test_run_emits_pipeline_events_with_mocked_llm(monkeypatch):
    _patch_llm(monkeypatch, _fake_complete_json)

    graph = build_graph(InMemorySaver())
    request = AgentRunRequest(**_payload(policies=_auto_policies()))

    events = [event async for event in run_pipeline(graph, request)]
    types = [event.type for event in events]

    assert types[0] == "change_analysis_done"
    assert types[1] == "prd_generated"
    assert types[2] == "spec_generated"
    assert set(types[3:5]) == {"test_reviewer_done", "architecture_reviewer_done"}
    assert types[-1] == "report_ready"

    prd = next(event for event in events if event.type == "prd_generated")
    assert prd.payload["title"] == "Exporta x"
    assert "# Exporta x" in prd.payload["markdown"]

    spec = next(event for event in events if event.type == "spec_generated")
    assert spec.payload["summary"] == "adiciona x"
    assert spec.payload["businessRules"] == ["exporta x"]

    test_review = next(event for event in events if event.type == "test_reviewer_done")
    assert test_review.payload["score"] == 85
    assert test_review.payload["findings"][0]["businessRule"] == "exporta x"

    architecture = next(
        event for event in events if event.type == "architecture_reviewer_done"
    )
    assert architecture.payload["score"] == 100
    assert architecture.payload["findings"] == []
    assert architecture.payload["conventionsSource"] == "default"

    report = events[-1].payload
    assert report["spec"]["summary"] == "adiciona x"
    assert report["prd"]["title"] == "Exporta x"
    assert report["verdict"] == "comment"
    assert report["overallScore"] == 85
    assert report["conventionsSource"] == "default"
    assert "Relatório Cast Review" in report["markdown"]
    assert "Exporta x" in report["markdown"]

    usage = report["usage"]
    steps = {item["step"]: item for item in usage["steps"]}
    assert set(steps) == {
        "change_analyzer",
        "prd",
        "implementation_spec",
        "test_reviewer",
        "architecture_reviewer",
        "report_builder",
    }
    assert steps["change_analyzer"]["skipped"] is True
    assert steps["test_reviewer"]["skipped"] is True
    assert steps["report_builder"]["skipped"] is True
    assert steps["prd"]["promptTokens"] == 100
    assert steps["implementation_spec"]["promptTokens"] == 60
    assert steps["architecture_reviewer"]["promptTokens"] == 80
    assert usage["promptTokens"] == 240
    assert usage["completionTokens"] == 45
    assert usage["costComplete"] is True
    assert "Custo:" in report["markdown"]

async def test_llm_failure_emits_error_and_stops(monkeypatch):
    async def boom(**kwargs):
        raise LlmError("timeout ao chamar o LLM")

    monkeypatch.setattr("app.graph.agents.prd.agent.complete_json", boom)

    graph = build_graph(InMemorySaver())
    request = AgentRunRequest(**_payload(policies=_auto_policies()))

    events = [event async for event in run_pipeline(graph, request)]
    types = [event.type for event in events]

    assert types[0] == "change_analysis_done"
    assert types[-1] == "error"
    assert "report_ready" not in types
    assert events[-1].payload["message"] == "timeout ao chamar o LLM"

async def test_run_pipeline_manual_policy_stops_at_awaiting_approval_after_prd(
    monkeypatch,
):
    """Manual policy on `prd` must pause the leg right after `prd_generated` — no
    `spec_generated` (or anything past it) may appear in the same leg."""
    _patch_llm(monkeypatch, _fake_complete_json)

    graph = build_graph(InMemorySaver())
    request = AgentRunRequest(**_payload())  # default policies: prd=manual, spec=manual

    events = [event async for event in run_pipeline(graph, request)]
    types = [event.type for event in events]

    assert types == ["change_analysis_done", "prd_generated", "awaiting_approval"]

    awaiting = events[-1]
    assert awaiting.payload == {"stage": "prd", "iteration": 1}

async def test_resume_pipeline_decision_none_re_emits_same_awaiting_approval(
    monkeypatch,
):
    """Per design.md's confirmed LangGraph behavior: a node containing `interrupt()`
    re-executes from its own top on every resume. Reconnecting with `decision=None`
    (no Command(resume=...)) must therefore re-fire the *same* interrupt/payload,
    not silently continue past it."""
    _patch_llm(monkeypatch, _fake_complete_json)

    graph = build_graph(InMemorySaver())
    request = AgentRunRequest(**_payload())

    first_leg = [event async for event in run_pipeline(graph, request)]
    assert first_leg[-1].type == "awaiting_approval"

    second_leg = [
        event
        async for event in resume_pipeline(
            graph,
            analysis_id=request.analysisId,
            api_keys=ApiKeys(openai="sk-test"),
            models=ReviewModels(testReviewer="gpt-4o", architectureReviewer="gpt-4o"),
            policies=Policies(prd="manual", spec="manual"),
            decision=None,
        )
    ]

    assert [event.type for event in second_leg] == ["awaiting_approval"]
    assert second_leg[0].payload == first_leg[-1].payload == {"stage": "prd", "iteration": 1}

async def test_resume_pipeline_approve_decision_proceeds_past_interrupt(monkeypatch):
    """Approving the `prd` gate must let the graph continue on to the next node(s)
    rather than staying parked at the interrupt."""
    _patch_llm(monkeypatch, _fake_complete_json)

    graph = build_graph(InMemorySaver())
    # spec stays "auto" so the run proceeds all the way to report_ready without a
    # second interrupt getting in the way of observing "past the interrupt" behavior.
    request = AgentRunRequest(**_payload(policies={"prd": "manual", "spec": "auto"}))

    first_leg = [event async for event in run_pipeline(graph, request)]
    assert first_leg[-1].type == "awaiting_approval"

    second_leg = [
        event
        async for event in resume_pipeline(
            graph,
            analysis_id=request.analysisId,
            api_keys=ApiKeys(openai="sk-test"),
            models=ReviewModels(testReviewer="gpt-4o", architectureReviewer="gpt-4o"),
            policies=Policies(prd="manual", spec="auto"),
            decision=ApprovalDecision(stage="prd", action="approve"),
        )
    ]

    types = [event.type for event in second_leg]
    assert "spec_generated" in types
    assert types[-1] == "report_ready"
    assert "awaiting_approval" not in types

async def test_resume_pipeline_reject_decision_reenters_prd_and_awaits_again(
    monkeypatch,
):
    _patch_llm(monkeypatch, _fake_complete_json)

    graph = build_graph(InMemorySaver())
    request = AgentRunRequest(**_payload())

    first_leg = [event async for event in run_pipeline(graph, request)]
    assert first_leg[-1].type == "awaiting_approval"

    second_leg = [
        event
        async for event in resume_pipeline(
            graph,
            analysis_id=request.analysisId,
            api_keys=ApiKeys(openai="sk-test"),
            models=ReviewModels(testReviewer="gpt-4o", architectureReviewer="gpt-4o"),
            policies=Policies(prd="manual", spec="manual"),
            decision=ApprovalDecision(
                stage="prd",
                action="reject",
                annotations=[{"excerpt": "Exporta x", "note": "precisa de mais contexto"}],
            ),
        )
    ]

    types = [event.type for event in second_leg]
    assert types == ["prd_generated", "awaiting_approval"]
    assert second_leg[-1].payload == {"stage": "prd", "iteration": 1}

async def test_run_pipeline_never_puts_api_keys_in_astream_state_input(monkeypatch):
    """api_keys must live only in config["configurable"], never as a top-level key in
    the dict passed as astream's actual state input (that dict gets checkpointed)."""
    graph = build_graph(InMemorySaver())
    request = AgentRunRequest(**_payload(policies=_auto_policies()))

    async def fake_astream(state_input, config, stream_mode=None):
        assert isinstance(state_input, dict)
        assert "api_keys" not in state_input
        assert "policies" not in state_input
        assert config["configurable"]["api_keys"] == {"openai": "sk-test"}
        return
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(graph, "astream", fake_astream)

    events = [event async for event in run_pipeline(graph, request)]
    assert events == []
