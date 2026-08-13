import json

import pytest

from app.infrastructure.llm.client import LlmError, complete_json, parse_json_object, sanitize_openai_error
from app.infrastructure.llm.tokens import parse_openai_usage

def test_parse_plain_object():
    assert parse_json_object('{"summary": "ok"}') == {"summary": "ok"}

def test_parse_fenced_json():
    raw = """```json
{"summary": "ok", "businessRules": ["r1"]}
```"""
    assert parse_json_object(raw)["businessRules"] == ["r1"]

def test_parse_object_embedded_in_prose():
    raw = 'here you go\n{"summary": "ok"}\nthanks'
    assert parse_json_object(raw) == {"summary": "ok"}

def test_invalid_json_raises():
    with pytest.raises(LlmError):
        parse_json_object("not json at all")

def test_non_object_json_raises():
    with pytest.raises(LlmError):
        parse_json_object('["not", "an", "object"]')

def test_sanitize_openai_error_keeps_message_strips_key():
    body = json.dumps(
        {"error": {"message": "max_tokens not supported. key sk-abc123XYZ"}}
    ).encode()
    message = sanitize_openai_error(400, body)
    assert "HTTP 400" in message
    assert "max_tokens" in message
    assert "sk-" not in message

@pytest.mark.asyncio
async def test_complete_json_streams_openai_and_emits_deltas(monkeypatch):
    captured: dict = {}
    deltas: list[str] = []

    class FakeStream:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def aiter_lines(self):
            yield "data: " + json.dumps({"choices": [{"delta": {"content": '{"ok":'}}]})
            yield "data: " + json.dumps({"choices": [{"delta": {"content": " true}"}}]})
            yield "data: " + json.dumps(
                {
                    "choices": [],
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 4,
                        "total_tokens": 14,
                        "prompt_tokens_details": {"cached_tokens": 3},
                    },
                }
            )
            yield "data: [DONE]"

    class FakeClient:
        def __init__(self, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, method, url, headers=None, json=None):
            captured["method"] = method
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeStream()

    monkeypatch.setattr(
        "app.infrastructure.llm.client.httpx.AsyncClient",
        FakeClient,
    )

    async def collect(piece: str) -> None:
        deltas.append(piece)

    result = await complete_json(
        system="return json",
        user="hi",
        model="gpt-4o",
        api_key="sk-test",
        on_delta=collect,
    )

    assert result.data == {"ok": True}
    assert result.usage.prompt_tokens == 10
    assert result.usage.cached_tokens == 3
    assert result.usage.completion_tokens == 4
    assert result.usage.source == "openai"
    assert "".join(deltas) == '{"ok": true}'
    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer sk-test"
    assert captured["json"]["stream"] is True
    assert captured["json"]["stream_options"] == {"include_usage": True}
    assert captured["json"]["max_tokens"] == 4096

@pytest.mark.asyncio
async def test_gpt5_uses_max_completion_tokens(monkeypatch):
    captured: dict = {}

    class FakeStream:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def aiter_lines(self):
            yield "data: " + json.dumps({"choices": [{"delta": {"content": '{"ok": true}'}}]})
            yield "data: [DONE]"

    class FakeClient:
        def __init__(self, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, method, url, headers=None, json=None):
            captured["json"] = json
            return FakeStream()

    monkeypatch.setattr("app.infrastructure.llm.client.httpx.AsyncClient", FakeClient)
    await complete_json(system="json", user="x", model="gpt-5", api_key="sk-test")
    assert "max_completion_tokens" in captured["json"]
    assert "max_tokens" not in captured["json"]


def test_parse_openai_usage_clamps_cache_and_missing_is_zero():
    usage = parse_openai_usage(
        {
            "prompt_tokens": 10,
            "completion_tokens": 2,
            "total_tokens": 12,
            "prompt_tokens_details": {"cached_tokens": 99},
        }
    )
    assert usage.cached_tokens == 10
    assert parse_openai_usage(None).source == "missing"
