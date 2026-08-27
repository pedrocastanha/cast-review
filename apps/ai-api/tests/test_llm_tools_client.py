import json

import pytest

from app.infrastructure.llm.client import LlmError, complete_with_tools

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_symbols",
            "description": "busca símbolos",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


def _fake_transport(monkeypatch, lines: list[str], captured: dict, status_code: int = 200):
    class FakeStream:
        def __init__(self):
            self.status_code = status_code

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def aread(self):
            return json.dumps({"error": {"message": "boom"}}).encode()

        async def aiter_lines(self):
            for line in lines:
                yield line

    class FakeClient:
        def __init__(self, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, method, url, headers=None, json=None):
            captured["headers"] = headers
            captured["json"] = json
            return FakeStream()

    monkeypatch.setattr("app.infrastructure.llm.client.httpx.AsyncClient", FakeClient)


@pytest.mark.asyncio
async def test_reassembles_tool_call_fragments_across_chunks(monkeypatch):
    captured: dict = {}
    lines = [
        "data: "
        + json.dumps(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_abc",
                                    "function": {"name": "search_symbols", "arguments": '{"que'},
                                }
                            ]
                        }
                    }
                ]
            }
        ),
        "data: "
        + json.dumps(
            {
                "choices": [
                    {"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'ry": "login"}'}}]}}
                ]
            }
        ),
        "data: "
        + json.dumps(
            {
                "choices": [],
                "usage": {"prompt_tokens": 20, "completion_tokens": 6, "total_tokens": 26},
            }
        ),
        "data: [DONE]",
    ]
    _fake_transport(monkeypatch, lines, captured)

    result = await complete_with_tools(
        system="s",
        messages=[{"role": "user", "content": "quem faz login?"}],
        tools=TOOLS,
        model="gpt-4o",
        api_key="sk-test",
    )

    assert result.content == ""
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].id == "call_abc"
    assert result.tool_calls[0].name == "search_symbols"
    assert result.tool_calls[0].arguments == {"query": "login"}
    assert result.usage.prompt_tokens == 20
    assert captured["json"]["tools"] == TOOLS
    assert captured["json"]["tool_choice"] == "auto"
    assert captured["json"]["messages"][0] == {"role": "system", "content": "s"}


@pytest.mark.asyncio
async def test_parallel_tool_calls_keep_index_order(monkeypatch):
    captured: dict = {}
    lines = [
        "data: "
        + json.dumps(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 1,
                                    "id": "call_b",
                                    "function": {"name": "read_file", "arguments": '{"path":"b.ts"}'},
                                },
                                {
                                    "index": 0,
                                    "id": "call_a",
                                    "function": {"name": "read_file", "arguments": '{"path":"a.ts"}'},
                                },
                            ]
                        }
                    }
                ]
            }
        ),
        "data: [DONE]",
    ]
    _fake_transport(monkeypatch, lines, captured)

    result = await complete_with_tools(
        system="s",
        messages=[{"role": "user", "content": "x"}],
        tools=TOOLS,
        model="gpt-4o",
        api_key="sk-test",
    )

    assert [call.arguments["path"] for call in result.tool_calls] == ["a.ts", "b.ts"]


@pytest.mark.asyncio
async def test_streams_content_deltas_when_no_tool_call(monkeypatch):
    captured: dict = {}
    deltas: list[str] = []
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": "O login "}}]}),
        "data: " + json.dumps({"choices": [{"delta": {"content": "vive em auth.ts"}}]}),
        "data: [DONE]",
    ]
    _fake_transport(monkeypatch, lines, captured)

    async def collect(piece: str) -> None:
        deltas.append(piece)

    result = await complete_with_tools(
        system="s",
        messages=[{"role": "user", "content": "x"}],
        tools=TOOLS,
        model="gpt-4o",
        api_key="sk-test",
        on_delta=collect,
    )

    assert result.content == "O login vive em auth.ts"
    assert result.tool_calls == []
    assert deltas == ["O login ", "vive em auth.ts"]


@pytest.mark.asyncio
async def test_missing_arguments_defaults_to_empty_object(monkeypatch):
    captured: dict = {}
    lines = [
        "data: "
        + json.dumps(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "id": "c1", "function": {"name": "cross_repo_links"}}
                            ]
                        }
                    }
                ]
            }
        ),
        "data: [DONE]",
    ]
    _fake_transport(monkeypatch, lines, captured)

    result = await complete_with_tools(
        system="s",
        messages=[{"role": "user", "content": "x"}],
        tools=TOOLS,
        model="gpt-4o",
        api_key="sk-test",
    )

    assert result.tool_calls[0].arguments == {}


@pytest.mark.asyncio
async def test_invalid_tool_arguments_raise_llm_error(monkeypatch):
    captured: dict = {}
    lines = [
        "data: "
        + json.dumps(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "c1",
                                    "function": {"name": "read_file", "arguments": "{not json"},
                                }
                            ]
                        }
                    }
                ]
            }
        ),
        "data: [DONE]",
    ]
    _fake_transport(monkeypatch, lines, captured)

    with pytest.raises(LlmError, match="read_file"):
        await complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "x"}],
            tools=TOOLS,
            model="gpt-4o",
            api_key="sk-test",
        )


@pytest.mark.asyncio
async def test_empty_response_without_tool_calls_raises(monkeypatch):
    captured: dict = {}
    _fake_transport(monkeypatch, ["data: [DONE]"], captured)

    with pytest.raises(LlmError, match="vazia"):
        await complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "x"}],
            tools=TOOLS,
            model="gpt-4o",
            api_key="sk-test",
        )


@pytest.mark.asyncio
async def test_http_error_is_sanitized(monkeypatch):
    captured: dict = {}
    _fake_transport(monkeypatch, [], captured, status_code=401)

    with pytest.raises(LlmError, match="HTTP 401"):
        await complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "x"}],
            tools=TOOLS,
            model="gpt-4o",
            api_key="sk-bad",
        )
