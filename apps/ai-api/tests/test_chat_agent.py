import pytest

from app.chat.agent import (
    MAX_ITERATIONS,
    MAX_TOOL_CONTEXT_CHARS,
    _validate_citations,
    run_chat,
)
from app.chat.models import ChatRunRequest, Citation
from app.chat.tools import MAX_BODY_CHARS, RepoWorkspace, ToolExecutor
from app.code_graph.models import Graph, HttpEndpoint, Symbol
from app.infrastructure.llm.client import LlmError, LlmToolResult, ToolCall
from app.infrastructure.llm.tokens import TokenUsage


def _usage(prompt: int = 10, completion: int = 5) -> TokenUsage:
    return TokenUsage(
        prompt_tokens=prompt,
        cached_tokens=0,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        source="openai",
    )


def _answer(text: str) -> LlmToolResult:
    return LlmToolResult(content=text, tool_calls=[], usage=_usage())


def _calls(*calls: ToolCall) -> LlmToolResult:
    return LlmToolResult(content="", tool_calls=list(calls), usage=_usage())


def _graph() -> Graph:
    return Graph(
        nodes={
            "s1": Symbol(
                id="s1",
                kind="function",
                path="src/auth.ts",
                name="login",
                line=4,
                end_line=12,
                signature="function login()",
                body="function login() {}",
            )
        }
    )


class FakeCache:
    def __init__(self, graph: Graph | None):
        self._graph = graph
        self.calls: list[tuple[str, str]] = []

    async def lookup(self, repo_id: str, sha: str):
        self.calls.append((repo_id, sha))
        return self._graph


def _request(**overrides) -> ChatRunRequest:
    payload = {
        "threadId": "t1",
        "mode": "repository",
        "repositories": [{"repoId": "acme/back", "sha": "sha1"}],
        "question": "quem faz login?",
        "model": "gpt-4o",
        "apiKeys": {"openai": "sk-test"},
    }
    payload.update(overrides)
    return ChatRunRequest(**payload)


def _patch_llm(monkeypatch, responses: list, captured: list | None = None):
    queue = list(responses)

    async def fake(*, system, messages, tools, model, api_key, on_delta=None):
        if captured is not None:
            captured.append(
                {"system": system, "messages": list(messages), "tools": tools, "model": model}
            )
        result = queue.pop(0)
        if isinstance(result, Exception):
            raise result
        if on_delta and result.content:
            await on_delta(result.content)
        return result

    monkeypatch.setattr("app.chat.agent.complete_with_tools", fake)


async def _collect(cache, request) -> list:
    return [event async for event in run_chat(cache, request)]


@pytest.mark.asyncio
async def test_direct_answer_without_tools(monkeypatch):
    _patch_llm(monkeypatch, [_answer("O login vive em src/auth.ts:4")])
    events = await _collect(FakeCache(_graph()), _request())

    types = [event.type for event in events]
    assert types == ["token", "message_done"]
    done = events[-1].payload
    assert done["content"] == "O login vive em src/auth.ts:4"
    assert done["toolCalls"] == []
    assert done["truncated"] is False
    assert done["usage"]["promptTokens"] == 10


@pytest.mark.asyncio
async def test_single_tool_round_emits_call_and_result(monkeypatch):
    _patch_llm(
        monkeypatch,
        [
            _calls(ToolCall(id="c1", name="search_symbols", arguments={"query": "login"})),
            _answer("Login está em src/auth.ts:4"),
        ],
    )
    events = await _collect(FakeCache(_graph()), _request())

    types = [event.type for event in events]
    assert types == ["tool_call", "tool_result", "token", "message_done"]
    assert events[0].payload["name"] == "search_symbols"
    assert events[1].payload["itemCount"] == 1
    done = events[-1].payload
    assert done["citations"][0]["symbolId"] == "s1"
    assert done["toolCalls"][0]["name"] == "search_symbols"


@pytest.mark.asyncio
async def test_usage_accumulates_across_iterations(monkeypatch):
    _patch_llm(
        monkeypatch,
        [
            _calls(ToolCall(id="c1", name="list_files", arguments={})),
            _answer("pronto"),
        ],
    )
    events = await _collect(FakeCache(_graph()), _request())
    assert events[-1].payload["usage"]["promptTokens"] == 20
    assert events[-1].payload["usage"]["completionTokens"] == 10


@pytest.mark.asyncio
async def test_repeated_identical_call_is_not_reexecuted(monkeypatch):
    call = ToolCall(id="c1", name="search_symbols", arguments={"query": "login"})
    _patch_llm(monkeypatch, [_calls(call), _calls(call), _answer("ok")])
    events = await _collect(FakeCache(_graph()), _request())

    results = [event for event in events if event.type == "tool_result"]
    assert len(results) == 2
    assert results[0].payload["itemCount"] == 1
    assert results[1].payload["itemCount"] == 0
    assert "idêntica" in results[1].payload["note"]


@pytest.mark.asyncio
async def test_three_identical_calls_stop_the_investigation(monkeypatch):
    call = ToolCall(id="c1", name="search_symbols", arguments={"query": "login"})
    _patch_llm(
        monkeypatch,
        [_calls(call), _calls(call), _calls(call), _answer("resposta parcial")],
    )
    events = await _collect(FakeCache(_graph()), _request())

    done = events[-1].payload
    assert done["truncated"] is True
    assert done["content"] == "resposta parcial"


@pytest.mark.asyncio
async def test_iteration_ceiling_forces_final_answer(monkeypatch):
    responses = [
        _calls(ToolCall(id=f"c{index}", name="search_symbols", arguments={"query": f"q{index}"}))
        for index in range(MAX_ITERATIONS)
    ]
    responses.append(_answer("respondendo com o que achei"))
    captured: list = []
    _patch_llm(monkeypatch, responses, captured)

    events = await _collect(FakeCache(_graph()), _request())

    assert events[-1].payload["truncated"] is True
    assert captured[-1]["tools"] == []


@pytest.mark.asyncio
async def test_tool_exception_becomes_note_and_loop_continues(monkeypatch):
    _patch_llm(
        monkeypatch,
        [
            _calls(ToolCall(id="c1", name="read_symbol", arguments={})),
            _answer("segui em frente"),
        ],
    )
    events = await _collect(FakeCache(_graph()), _request())

    result = next(event for event in events if event.type == "tool_result")
    assert result.payload["itemCount"] == 0
    assert "symbolId" in result.payload["note"]
    assert events[-1].payload["content"] == "segui em frente"


@pytest.mark.asyncio
async def test_unindexed_repo_yields_error_event(monkeypatch):
    _patch_llm(monkeypatch, [_answer("nunca chamado")])
    events = await _collect(FakeCache(None), _request())

    assert [event.type for event in events] == ["error"]
    assert "nenhum repositório indexado" in events[0].payload["message"]


@pytest.mark.asyncio
async def test_llm_failure_yields_error_event(monkeypatch):
    _patch_llm(monkeypatch, [LlmError("LLM HTTP 401: chave inválida")])
    events = await _collect(FakeCache(_graph()), _request())

    assert [event.type for event in events] == ["error"]
    assert "401" in events[0].payload["message"]


@pytest.mark.asyncio
async def test_mentions_and_history_enter_the_first_prompt(monkeypatch):
    captured: list = []
    _patch_llm(monkeypatch, [_answer("ok")], captured)

    request = _request(
        history=[{"role": "user", "content": "e antes?"}, {"role": "assistant", "content": "antes isso"}],
        mentions=[{"repoId": "acme/back", "path": "src/auth.ts", "content": "conteudo do arquivo"}],
    )
    await _collect(FakeCache(_graph()), request)

    messages = captured[0]["messages"]
    assert "acme/back @ sha1" in messages[0]["content"]
    assert messages[1]["content"] == "e antes?"
    assert messages[2]["content"] == "antes isso"
    assert "conteudo do arquivo" in messages[3]["content"]
    assert "quem faz login?" in messages[3]["content"]


@pytest.mark.asyncio
async def test_global_scope_exposes_dynamic_catalog_without_loading_graph(monkeypatch):
    captured: list = []
    _patch_llm(monkeypatch, [_answer("ok")], captured)

    request = _request(
        mode="global",
        repositories=[],
        repositoryHint={"repoId": "acme/back", "sha": "sha1"},
        catalog={"url": "http://backend/internal/chat/catalog", "grant": "grant"},
    )
    cache = FakeCache(_graph())
    await _collect(cache, request)

    names = {tool["function"]["name"] for tool in captured[0]["tools"]}
    assert "list_indexed_repositories" in names
    assert "cross_repo_links" not in names
    assert "acme/back" in captured[0]["messages"][0]["content"]
    assert "sha1" not in captured[0]["messages"][0]["content"]
    assert "histórico não substitui evidência" in captured[0]["system"].lower()
    assert cache.calls == []


@pytest.mark.asyncio
async def test_global_scope_can_investigate_two_repositories(monkeypatch):
    class FakeCatalogClient:
        def __init__(self, access):
            self.access = access

        async def resolve(self, repo_id: str):
            return {"repoId": repo_id, "sha": f"sha-{repo_id.split('/')[-1]}", "stale": False}

        async def list(self, query=None, limit=20, cursor=None):
            return {"repositories": [], "nextCursor": None}

    monkeypatch.setattr("app.chat.agent.CatalogClient", FakeCatalogClient)
    _patch_llm(
        monkeypatch,
        [
            _calls(
                ToolCall(
                    id="c1",
                    name="search_symbols",
                    arguments={"repoId": "acme/back", "query": "login"},
                )
            ),
            _calls(
                ToolCall(
                    id="c2",
                    name="search_symbols",
                    arguments={"repoId": "acme/front", "query": "login"},
                )
            ),
            _answer("Os dois repositórios têm login."),
        ],
    )
    request = _request(
        mode="global",
        repositories=[],
        catalog={"url": "http://backend/internal/chat/catalog", "grant": "grant"},
    )

    events = await _collect(FakeCache(_graph()), request)

    done = events[-1].payload
    assert {citation["repoId"] for citation in done["citations"]} == {
        "acme/back",
        "acme/front",
    }
    assert [record["args"]["repoId"] for record in done["toolCalls"]] == [
        "acme/back",
        "acme/front",
    ]


@pytest.mark.asyncio
async def test_citation_pointing_outside_the_index_is_dropped(monkeypatch):
    _patch_llm(
        monkeypatch,
        [
            _calls(ToolCall(id="c1", name="list_endpoints", arguments={})),
            _answer("ok"),
        ],
    )
    graph = _graph()
    graph.endpoints.append(
        HttpEndpoint(
            id="e1",
            role="provider",
            method="GET",
            route="/x",
            normalized_route="/x",
            path="src/fantasma.ts",
            line=1,
            framework="nestjs",
        )
    )
    events = await _collect(FakeCache(graph), _request())

    assert events[-1].payload["citations"] == []


@pytest.mark.asyncio
async def test_citations_are_capped_and_deduplicated(monkeypatch):
    from app.chat.agent import MAX_CITATIONS

    _patch_llm(
        monkeypatch,
        [
            _calls(ToolCall(id="c1", name="list_endpoints", arguments={})),
            _answer("ok"),
        ],
    )
    graph = _graph()
    for index in range(40):
        path = f"src/mod{index}.ts"
        graph.nodes[f"n{index}"] = Symbol(
            id=f"n{index}",
            kind="function",
            path=path,
            name=f"handler{index}",
            line=1,
            end_line=3,
            signature=f"function handler{index}()",
            body="{}",
        )
        for duplicate in range(2):
            graph.endpoints.append(
                HttpEndpoint(
                    id=f"e{index}-{duplicate}",
                    role="provider",
                    method="GET",
                    route=f"/r{index}",
                    normalized_route=f"/r{index}",
                    path=path,
                    line=1,
                    framework="nestjs",
                )
            )

    events = await _collect(FakeCache(graph), _request())
    citations = events[-1].payload["citations"]

    assert len(citations) == MAX_CITATIONS
    keys = [(item["repoId"], item["path"], item["line"]) for item in citations]
    assert len(set(keys)) == len(keys)


def test_citation_cap_balances_multiple_repositories():
    back = Graph(
        nodes={
            f"b{index}": Symbol(
                id=f"b{index}",
                kind="function",
                path=f"src/back-{index}.ts",
                name=f"back{index}",
                line=index + 1,
                end_line=8,
                signature=f"function back{index}()",
                body="function back() {}",
            )
            for index in range(20)
        }
    )
    front = Graph(
        nodes={
            f"f{index}": Symbol(
                id=f"f{index}",
                kind="function",
                path=f"src/front-{index}.ts",
                name=f"front{index}",
                line=index + 1,
                end_line=8,
                signature=f"function front{index}()",
                body="function front() {}",
            )
            for index in range(20)
        }
    )
    executor = ToolExecutor(
        [
            RepoWorkspace("acme/back", "sha-back", back),
            RepoWorkspace("acme/front", "sha-front", front),
        ],
        mode="project",
    )
    citations = [
        *[
            Citation(
                repoId="acme/back",
                path=f"src/back-{index}.ts",
                line=index + 1,
                symbolId=f"b{index}",
            )
            for index in range(20)
        ],
        *[
            Citation(
                repoId="acme/front",
                path=f"src/front-{index}.ts",
                line=index + 1,
                symbolId=f"f{index}",
            )
            for index in range(20)
        ],
    ]

    validated = _validate_citations(citations, executor)

    assert {citation.repoId for citation in validated} == {"acme/back", "acme/front"}


@pytest.mark.asyncio
async def test_tool_payload_budget_stops_large_investigations(monkeypatch):
    reads = (MAX_TOOL_CONTEXT_CHARS // MAX_BODY_CHARS) + 4
    graph = Graph(
        nodes={
            f"s{index}": Symbol(
                id=f"s{index}",
                kind="function",
                path=f"src/f{index}.ts",
                name=f"handler{index}",
                line=1,
                end_line=200,
                signature=f"function handler{index}()",
                body="x" * (MAX_BODY_CHARS * 2),
            )
            for index in range(reads)
        }
    )
    _patch_llm(
        monkeypatch,
        [
            _calls(
                *[
                    ToolCall(
                        id=f"c{index}",
                        name="read_symbol",
                        arguments={"symbolId": f"s{index}"},
                    )
                    for index in range(reads)
                ]
            ),
            _answer("resposta limitada"),
        ],
    )

    events = await _collect(FakeCache(graph), _request())

    done = events[-1].payload
    notes = [record["note"] or "" for record in done["toolCalls"]]
    assert MAX_TOOL_CONTEXT_CHARS > 0
    assert done["truncated"] is True
    assert any("orçamento de contexto" in note for note in notes)
