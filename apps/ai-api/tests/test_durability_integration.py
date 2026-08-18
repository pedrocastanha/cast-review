"""Integration tests (T15) — real Redis durability.

Requires a real, reachable Redis Stack (`docker compose up -d redis` from the repo
root) at `REDIS_URL`. Marked `@pytest.mark.integration` so the default
`pytest -m "not integration"` gate skips this file entirely.

Two independent tests:

1. `test_kill_and_resume_does_not_reprocess_prd_node` — proves the P1 story
   ("Durable run survives restart"): a run is driven to `awaiting_approval` on
   `prd` against a real `AsyncRedisSaver`, that saver/graph is then discarded
   entirely (simulating the ai-api container being killed), a brand-new
   `AsyncRedisSaver` + brand-new compiled graph is built against the *same* Redis
   instance and the *same* `analysisId`/`thread_id`, and `resume_pipeline` is
   called on the new graph object. The `prd` node's LLM call counter must stay at
   1 — proving the already-generated PRD came from the Redis checkpoint, not from
   any in-memory state that happened to survive.

2. `test_checkpoint_never_persists_api_keys` — proves the "no secrets in
   checkpoint" edge case from spec.md: a full run is driven with a distinctive,
   greppable fake API key. Every checkpoint tuple LangGraph's own `alist`/
   `aget_tuple` readers return for that thread is serialized and checked for the
   secret substring, and (belt-and-suspenders) the raw Redis keys for that thread
   are scanned and dumped directly, bypassing `langgraph-checkpoint-redis`'s own
   (de)serialization path entirely.
"""

import json
import uuid

import pytest
import redis.asyncio as redis_asyncio
from langgraph.checkpoint.redis.aio import AsyncRedisSaver

from app.application.dto.schemas import (
    AgentRunRequest,
    ApiKeys,
    ApprovalDecision,
    Policies,
    ReviewModels,
)
from app.config.settings import REDIS_URL
from app.graph.graph import build_graph
from app.graph.pipeline import resume_pipeline, run_pipeline
from tests.llm_fakes import llm
from tests.test_agent_run import _fake_complete_json, _patch_llm, _payload

pytestmark = pytest.mark.integration

SECRET_API_KEY = "sk-DEFINITELY-SECRET-VALUE-12345"


async def _cleanup_thread(thread_id: str) -> None:
    """Best-effort teardown: delete every Redis key touched by this thread so
    repeated local test runs don't accumulate checkpoint data (Redis here is
    `noeviction`/`appendonly yes` per T1 — nothing expires it for us)."""
    client = redis_asyncio.Redis.from_url(REDIS_URL)
    try:
        cursor = 0
        while True:
            cursor, keys = await client.scan(cursor, match=f"*{thread_id}*", count=1000)
            if keys:
                await client.delete(*keys)
            if cursor == 0:
                break
    finally:
        await client.aclose()


async def _dump_raw_key(client: "redis_asyncio.Redis", key: bytes) -> bytes:
    """Read back whatever Redis actually stored under `key`, regardless of its
    underlying type, as raw bytes suitable for a substring search."""
    key_type = await client.type(key)
    key_type = key_type.decode() if isinstance(key_type, bytes) else key_type

    if key_type == "ReJSON-RL":
        value = await client.execute_command("JSON.GET", key)
    elif key_type == "string":
        value = await client.get(key)
    elif key_type == "hash":
        value = await client.hgetall(key)
    else:
        # Fallback for any other Redis type (list/set/zset/stream/etc.) — DUMP
        # returns the RDB-serialized bytes, which is enough for a substring check.
        value = await client.dump(key)

    if value is None:
        return b""
    if isinstance(value, dict):
        return b"".join(
            (k if isinstance(k, bytes) else str(k).encode())
            + (v if isinstance(v, bytes) else str(v).encode())
            for k, v in value.items()
        )
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    return str(value).encode()


async def _secret_fake_complete_json(*, system: str, user: str, model: str, api_key: str, **_kwargs):
    """Same branching shape as `tests.test_agent_run._fake_complete_json`, but
    checked against `SECRET_API_KEY` instead of the shared suite's `"sk-test"` —
    this test needs a distinctive, greppable key value to search for at the
    storage layer."""
    assert api_key == SECRET_API_KEY
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
        {"summary": "adiciona x", "newContracts": ["x"], "businessRules": ["exporta x"]},
        prompt=60,
        completion=15,
    )


async def test_kill_and_resume_does_not_reprocess_prd_node(monkeypatch):
    thread_id = f"durability-kill-resume-{uuid.uuid4()}"
    prd_call_count = 0

    async def counting_fake_complete_json(*, system, user, model, api_key, **kwargs):
        nonlocal prd_call_count
        if "Product Requirements" in system or "PRD Writer" in system:
            prd_call_count += 1
        return await _fake_complete_json(
            system=system, user=user, model=model, api_key=api_key, **kwargs
        )

    _patch_llm(monkeypatch, counting_fake_complete_json)

    try:
        # --- Leg 1: real AsyncRedisSaver, run to awaiting_approval on `prd`. -----
        async with AsyncRedisSaver.from_conn_string(REDIS_URL) as saver1:
            await saver1.asetup()
            graph1 = build_graph(saver1)

            request = AgentRunRequest(
                **_payload(
                    analysisId=thread_id,
                    policies={"prd": "manual", "spec": "auto"},
                )
            )
            first_leg = [event async for event in run_pipeline(graph1, request)]

        # `async with` has now exited: saver1's own __aexit__ closed its Redis
        # connection. Simulate "container killed and restarted" by dropping the
        # in-process references entirely — nothing below may reuse them.
        del saver1, graph1

        first_types = [event.type for event in first_leg]
        assert first_types == ["change_analysis_done", "prd_generated", "awaiting_approval"]
        assert first_leg[-1].payload == {"stage": "prd", "iteration": 1}
        assert prd_call_count == 1

        # --- Leg 2: brand-new AsyncRedisSaver + brand-new compiled graph, same --
        # --- Redis instance, same thread_id (= analysisId). ---------------------
        async with AsyncRedisSaver.from_conn_string(REDIS_URL) as saver2:
            await saver2.asetup()
            graph2 = build_graph(saver2)

            second_leg = [
                event
                async for event in resume_pipeline(
                    graph2,
                    analysis_id=thread_id,
                    api_keys=ApiKeys(openai="sk-test"),
                    models=ReviewModels(testReviewer="gpt-4o", architectureReviewer="gpt-4o"),
                    policies=Policies(prd="manual", spec="auto"),
                    decision=ApprovalDecision(stage="prd", action="approve"),
                )
            ]

        second_types = [event.type for event in second_leg]

        # The core assertion: the `prd` node's LLM call counter did NOT increase
        # across the "restart" + resume, on a brand-new graph object — proving the
        # already-generated PRD came from the Redis checkpoint, not from any
        # in-memory object that happened to survive.
        assert prd_call_count == 1

        # And the run actually proceeded past the gate: straight through to
        # report_ready, since `spec` policy is "auto" (no second interrupt).
        assert "spec_generated" in second_types
        assert second_types[-1] == "report_ready"
        assert "awaiting_approval" not in second_types
    finally:
        await _cleanup_thread(thread_id)


async def test_checkpoint_never_persists_api_keys(monkeypatch):
    thread_id = f"durability-no-secrets-{uuid.uuid4()}"
    _patch_llm(monkeypatch, _secret_fake_complete_json)

    try:
        async with AsyncRedisSaver.from_conn_string(REDIS_URL) as saver:
            await saver.asetup()
            graph = build_graph(saver)

            request = AgentRunRequest(
                **_payload(
                    analysisId=thread_id,
                    apiKeys={"openai": SECRET_API_KEY},
                    policies={"prd": "auto", "spec": "auto"},
                )
            )
            events = [event async for event in run_pipeline(graph, request)]
            assert events[-1].type == "report_ready"

            # --- LangGraph-level inspection: every persisted checkpoint tuple for
            # --- this thread, read back through the saver's own methods.
            config = {"configurable": {"thread_id": thread_id}}

            checkpoint_tuples = [tup async for tup in saver.alist(config)]
            assert len(checkpoint_tuples) > 0, "expected at least one checkpoint for this thread"

            for tup in checkpoint_tuples:
                blob = json.dumps(
                    {
                        "checkpoint": tup.checkpoint,
                        "metadata": tup.metadata,
                        "pending_writes": tup.pending_writes,
                    },
                    default=str,
                )
                assert SECRET_API_KEY not in blob

            single = await saver.aget_tuple(config)
            assert single is not None
            single_blob = json.dumps(
                {
                    "checkpoint": single.checkpoint,
                    "metadata": single.metadata,
                    "pending_writes": single.pending_writes,
                },
                default=str,
            )
            assert SECRET_API_KEY not in single_blob

        # --- Belt-and-suspenders: connect a raw redis.asyncio client and dump the
        # --- actual bytes Redis holds for this thread, independent of
        # --- langgraph-checkpoint-redis's own (de)serialization path. Key pattern
        # --- confirmed by reading langgraph/checkpoint/redis/base.py:
        # --- "checkpoint:{thread_id}:{checkpoint_ns}:{checkpoint_id}",
        # --- "checkpoint_blob:{thread_id}:{checkpoint_ns}:{channel}:{version}",
        # --- "checkpoint_write:{thread_id}:{checkpoint_ns}:{checkpoint_id}:{task_id}[:{idx}]"
        # --- (separator ":"), all stored as RedisJSON ("ReJSON-RL") values.
        raw_client = redis_asyncio.Redis.from_url(REDIS_URL)
        try:
            cursor = 0
            raw_keys: list[bytes] = []
            while True:
                cursor, keys = await raw_client.scan(cursor, match=f"*{thread_id}*", count=1000)
                raw_keys.extend(keys)
                if cursor == 0:
                    break
            assert raw_keys, "expected at least one raw Redis key for this thread"

            secret_bytes = SECRET_API_KEY.encode()
            for key in raw_keys:
                raw_blob = await _dump_raw_key(raw_client, key)
                assert secret_bytes not in raw_blob, f"secret leaked in raw Redis key {key!r}"
        finally:
            await raw_client.aclose()
    finally:
        await _cleanup_thread(thread_id)
