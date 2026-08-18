"""HTTP-level tests for the `/agent/run` and `/agent/resume` routes (T14).

These exercise the *real* route handlers end-to-end — through `app.state.graph`
(a real `AsyncRedisSaver`-backed graph wired up by `main.py`'s lifespan) — rather than
calling `run_pipeline`/`resume_pipeline` directly like `test_agent_run.py` does. Per
T13's flag, a bare `TestClient(app)` does NOT trigger the lifespan in this codebase's
starlette/httpx version, so every test here uses the context-manager form
`with TestClient(app) as client:` to actually get `app.state.graph` populated.

Requires a real, reachable Redis (Redis Stack) at `REDIS_URL` — same requirement as
the rest of the `not integration`-excluded suite per the gate check instructions.
"""

import json
import uuid

from fastapi.testclient import TestClient

from app.main import app
from tests.test_agent_run import _fake_complete_json, _patch_llm, _payload


def _parse_sse(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    return events


def test_agent_run_http_happy_path_reaches_report_ready_with_unchanged_shape(
    monkeypatch,
):
    """Regression check for T14's own Done-when: `/agent/run`'s response/header shape
    must be unchanged for the non-HITL happy path."""
    _patch_llm(monkeypatch, _fake_complete_json)

    analysis_id = f"http-happy-{uuid.uuid4()}"
    body = _payload(
        analysisId=analysis_id, policies={"prd": "auto", "spec": "auto"}
    )

    with TestClient(app) as client:
        response = client.post("/agent/run", json=body)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["connection"] == "keep-alive"
    assert response.headers["x-accel-buffering"] == "no"

    events = _parse_sse(response.text)
    types = [event["type"] for event in events]

    assert types[0] == "change_analysis_done"
    assert "prd_generated" in types
    assert "spec_generated" in types
    assert types[-1] == "report_ready"
    assert "awaiting_approval" not in types

    report = events[-1]["payload"]
    assert report["verdict"] == "comment"


def test_agent_run_http_manual_prd_policy_stops_at_awaiting_approval(monkeypatch):
    _patch_llm(monkeypatch, _fake_complete_json)

    analysis_id = f"http-manual-{uuid.uuid4()}"
    body = _payload(
        analysisId=analysis_id, policies={"prd": "manual", "spec": "auto"}
    )

    with TestClient(app) as client:
        response = client.post("/agent/run", json=body)

    assert response.status_code == 200
    events = _parse_sse(response.text)
    types = [event["type"] for event in events]

    assert types == ["change_analysis_done", "prd_generated", "awaiting_approval"]
    assert events[-1]["payload"] == {"stage": "prd", "iteration": 1}


def test_agent_resume_http_approve_continues_past_interrupt_to_spec_generated(
    monkeypatch,
):
    _patch_llm(monkeypatch, _fake_complete_json)

    analysis_id = f"http-resume-approve-{uuid.uuid4()}"
    run_body = _payload(
        analysisId=analysis_id, policies={"prd": "manual", "spec": "auto"}
    )

    with TestClient(app) as client:
        first = client.post("/agent/run", json=run_body)
        assert first.status_code == 200
        first_types = [event["type"] for event in _parse_sse(first.text)]
        assert first_types[-1] == "awaiting_approval"

        resume_body = {
            "analysisId": analysis_id,
            "models": run_body["models"],
            "apiKeys": run_body["apiKeys"],
            "policies": {"prd": "manual", "spec": "auto"},
            "decision": {"stage": "prd", "action": "approve"},
        }
        second = client.post("/agent/resume", json=resume_body)

    assert second.status_code == 200
    assert second.headers["content-type"].startswith("text/event-stream")
    assert second.headers["cache-control"] == "no-cache"
    assert second.headers["connection"] == "keep-alive"
    assert second.headers["x-accel-buffering"] == "no"

    second_types = [event["type"] for event in _parse_sse(second.text)]
    assert "spec_generated" in second_types
    assert second_types[-1] == "report_ready"
    assert "awaiting_approval" not in second_types


def test_agent_resume_http_garbage_thread_id_documented_behavior(monkeypatch):
    """A `/agent/resume` call against an `analysisId` (thread_id) that was never used
    by a prior `/agent/run` has no checkpoint to resume from.

    Empirically verified (this test): it does NOT raise an HTTP-level error — the
    route still returns 200 with a normal SSE stream (the response has already
    started streaming by the time anything goes wrong). With `decision=None`,
    `resume_pipeline` passes `state_input=None` into `graph.astream`, and on a
    checkpoint-less thread LangGraph raises `InvalidUpdateError: Received no input
    for __start__` (there is nothing checkpointed to resume and no fresh state to
    start from). `_stream_leg`'s catch-all `except Exception` in
    `app/graph/pipeline.py` converts that into a single `error` event
    (`{"step": "pipeline", "message": "Received no input for __start__"}`) rather
    than propagating — so the client sees a graceful SSE `error` event, not a
    connection drop or a 4xx/5xx.
    """
    analysis_id = f"http-resume-garbage-{uuid.uuid4()}"
    resume_body = {
        "analysisId": analysis_id,
        "models": {"testReviewer": "gpt-4o", "architectureReviewer": "gpt-4o"},
        "apiKeys": {"openai": "sk-test"},
        "policies": {"prd": "auto", "spec": "auto"},
        "decision": None,
    }

    with TestClient(app) as client:
        response = client.post("/agent/resume", json=resume_body)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(response.text)
    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert events[0]["payload"]["step"] == "pipeline"
    assert "Received no input for __start__" in events[0]["payload"]["message"]
