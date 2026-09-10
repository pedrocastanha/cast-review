import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.chat.models import ChatEvent
from app.main import app

OWNER_ID = "owner-test"
SERVICE_TOKEN = "t" * 48


@pytest.fixture(autouse=True)
def _service_token(monkeypatch):
    """Escopado ao módulo de teste: definir AI_SERVICE_TOKEN no import vazaria
    para os outros testes e ligaria a autenticação de serviço neles."""
    monkeypatch.setenv("AI_SERVICE_TOKEN", SERVICE_TOKEN)


def _client() -> TestClient:
    """Client já autenticado como serviço.

    Definir AI_SERVICE_TOKEN liga o ServiceAuthentication middleware, então todo
    request precisa do bearer — o grant de escopo é uma camada ADICIONAL sobre
    ele, não um substituto.
    """
    return TestClient(app, headers={"authorization": f"Bearer {SERVICE_TOKEN}"})


def _scope_headers(repo_id: str, sha: str = "sha1", owner_id: str = OWNER_ID) -> dict:
    """Grant que o backend emitiria para este repo@sha."""
    from app.index_scope import INDEX_SCOPE_HEADER

    return {INDEX_SCOPE_HEADER: _issue_grant(owner_id, [(repo_id, sha)])}


def _issue_grant(owner_id: str, repositories: list[tuple[str, str]], ttl_ms: int = 300_000) -> str:
    import base64
    import hashlib
    import hmac
    import json as _json
    import time

    payload = base64.urlsafe_b64encode(
        _json.dumps(
            {
                "ownerId": owner_id,
                "repositories": [{"repoId": r, "sha": s} for r, s in repositories],
                "expiresAt": time.time() * 1000 + ttl_ms,
            }
        ).encode()
    ).rstrip(b"=").decode()
    key = hmac.new(
        SERVICE_TOKEN.encode(), b"index-scope-grant-v1", hashlib.sha256
    ).digest()
    signature = (
        base64.urlsafe_b64encode(hmac.new(key, payload.encode(), hashlib.sha256).digest())
        .rstrip(b"=")
        .decode()
    )
    return f"{payload}.{signature}"

pytestmark = pytest.mark.integration

FILES = [
    {
        "path": "src/auth.ts",
        "content": "function login() { return validate(); }\nfunction validate() { return true; }\n",
    },
    {"path": "src/other.ts", "content": "function other() { return 2; }\n"},
]


@pytest.fixture
def repo_id():
    return f"test-repo-{uuid.uuid4().hex[:8]}"


def _cleanup(repo_id):
    import asyncio

    from app.code_graph.cache import build_neo4j_driver

    async def go():
        driver = build_neo4j_driver()
        async with driver.session() as session:
            await session.run("MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
            await session.run("MATCH (n:RepoIndex {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
            await session.run("MATCH (n:ApiEndpoint {repoId: $repoId}) DETACH DELETE n", repoId=repo_id)
        await driver.close()

    asyncio.run(go())


def _build(client, repo_id):
    client.post("/index/build", json={"ownerId": OWNER_ID, "repoId": repo_id, "sha": "sha1", "files": FILES})


def test_index_file_renders_from_graph(repo_id):
    with _client() as client:
        _build(client, repo_id)
        response = client.get(
            "/index/file",
            params={"ownerId": OWNER_ID, "repoId": repo_id, "sha": "sha1", "path": "src/auth.ts"},
            headers=_scope_headers(repo_id),
        )

    assert response.status_code == 200
    body = response.json()
    assert "function login" in body["content"]
    assert "function validate" in body["content"]
    _cleanup(repo_id)


def test_index_file_unknown_path_returns_404(repo_id):
    with _client() as client:
        _build(client, repo_id)
        response = client.get(
            "/index/file",
            params={"ownerId": OWNER_ID, "repoId": repo_id, "sha": "sha1", "path": "README.md"},
            headers=_scope_headers(repo_id),
        )

    assert response.status_code == 404
    _cleanup(repo_id)


def test_index_file_unknown_index_returns_404(repo_id):
    with _client() as client:
        response = client.get(
            "/index/file",
            params={"ownerId": OWNER_ID, "repoId": repo_id, "sha": "nope", "path": "src/auth.ts"},
            headers=_scope_headers(repo_id, sha="nope"),
        )

    assert response.status_code == 404


def test_index_files_lists_and_filters_paths(repo_id):
    with _client() as client:
        _build(client, repo_id)
        every = client.get("/index/files", params={"ownerId": OWNER_ID, "repoId": repo_id, "sha": "sha1"}, headers=_scope_headers(repo_id)).json()
        filtered = client.get(
            "/index/files",
            params={"ownerId": OWNER_ID, "repoId": repo_id, "sha": "sha1", "query": "auth"},
            headers=_scope_headers(repo_id),
        ).json()

    assert set(every["paths"]) == {"src/auth.ts", "src/other.ts"}
    assert filtered["paths"] == ["src/auth.ts"]
    _cleanup(repo_id)


def test_chat_run_streams_tool_and_message_events(repo_id, monkeypatch):
    from app.infrastructure.llm.client import LlmToolResult, ToolCall
    from app.infrastructure.llm.tokens import TokenUsage

    usage = TokenUsage(
        prompt_tokens=8, cached_tokens=0, completion_tokens=3, total_tokens=11, source="openai"
    )
    responses = [
        LlmToolResult(
            content="",
            tool_calls=[ToolCall(id="c1", name="search_symbols", arguments={"query": "login"})],
            usage=usage,
        ),
        LlmToolResult(content="login está em src/auth.ts", tool_calls=[], usage=usage),
    ]

    async def fake(*, system, messages, tools, model, api_key, on_delta=None):
        result = responses.pop(0)
        if on_delta and result.content:
            await on_delta(result.content)
        return result

    monkeypatch.setattr("app.chat.agent.complete_with_tools", fake)

    with _client() as client:
        _build(client, repo_id)
        response = client.post(
            "/chat/run",
            json={
                "ownerId": OWNER_ID,
                "threadId": "t1",
                "mode": "repository",
                "repositories": [{"repoId": repo_id, "sha": "sha1"}],
                "question": "quem faz login?",
                "model": "gpt-4o",
                "apiKeys": {"openai": "sk-test"},
            },
        )

        assert response.status_code == 200
        events = [
            ChatEvent(**json.loads(chunk[len("data: ") :]))
            for chunk in response.text.split("\n\n")
            if chunk.startswith("data: ")
        ]

    assert [event.type for event in events] == [
        "tool_call",
        "tool_result",
        "token",
        "message_done",
    ]
    done = events[-1].payload
    assert done["content"] == "login está em src/auth.ts"
    assert done["citations"][0]["path"] == "src/auth.ts"
    _cleanup(repo_id)


def test_chat_run_on_unindexed_repo_emits_error(repo_id, monkeypatch):
    with _client() as client:
        response = client.post(
            "/chat/run",
            json={
                "ownerId": OWNER_ID,
                "threadId": "t1",
                "mode": "repository",
                "repositories": [{"repoId": repo_id, "sha": "nope"}],
                "question": "e aí?",
                "model": "gpt-4o",
                "apiKeys": {"openai": "sk-test"},
            },
        )

    assert response.status_code == 200
    assert '"type": "error"' in response.text or '"type":"error"' in response.text
