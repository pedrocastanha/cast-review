from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable

import httpx

from app.config.settings import LLM_MAX_TOKENS, LLM_TIMEOUT_SECONDS, OPENAI_URL

OnDelta = Callable[[str], Awaitable[None]]

class LlmError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

async def complete_json(
    *,
    system: str,
    user: str,
    model: str,
    api_key: str,
    on_delta: OnDelta | None = None,
) -> dict:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "stream": True,
        **_token_limit_field(model),
    }

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT_SECONDS) as client:
            async with client.stream(
                "POST",
                OPENAI_URL,
                headers={
                    "authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    raw = await response.aread()
                    raise LlmError(sanitize_openai_error(response.status_code, raw))

                pieces: list[str] = []
                async for line in response.aiter_lines():
                    delta = _delta_from_sse_line(line)
                    if delta is None:
                        continue
                    pieces.append(delta)
                    if on_delta:
                        await on_delta(delta)

                text = "".join(pieces)
    except LlmError:
        raise
    except httpx.TimeoutException as exc:
        raise LlmError("timeout ao chamar o LLM") from exc
    except httpx.HTTPError as exc:
        raise LlmError("falha de rede ao chamar o LLM") from exc

    if not text.strip():
        raise LlmError("LLM devolveu resposta vazia")
    return parse_json_object(text)

def sanitize_openai_error(status: int, body: bytes) -> str:
    try:
        parsed = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return f"LLM respondeu HTTP {status}"

    message = ""
    if isinstance(parsed, dict):
        err = parsed.get("error")
        if isinstance(err, dict):
            message = str(err.get("message") or "")
        elif isinstance(err, str):
            message = err
        else:
            message = str(parsed.get("message") or "")

    message = re.sub(r"sk-[A-Za-z0-9_-]+", "[redacted]", message).strip()
    if not message:
        return f"LLM respondeu HTTP {status}"
    return f"LLM HTTP {status}: {message[:400]}"

def parse_json_object(text: str) -> dict:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)

    try:
        value = json.loads(stripped)
    except json.JSONDecodeError:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start == -1 or end == -1:
            raise LlmError("resposta do LLM não é JSON") from None
        try:
            value = json.loads(stripped[start : end + 1])
        except json.JSONDecodeError as exc:
            raise LlmError("resposta do LLM não é JSON") from exc

    if not isinstance(value, dict):
        raise LlmError("JSON do LLM não é um objeto")
    return value

def _token_limit_field(model: str) -> dict:

    lowered = model.lower()
    if lowered.startswith(("o1", "o3", "o4", "gpt-5")):
        return {"max_completion_tokens": LLM_MAX_TOKENS}
    return {"max_tokens": LLM_MAX_TOKENS}

def _delta_from_sse_line(line: str) -> str | None:
    if not line.startswith("data:"):
        return None
    data = line[5:].strip()
    if not data or data == "[DONE]":
        return None
    try:
        chunk = json.loads(data)
    except json.JSONDecodeError:
        return None
    choices = chunk.get("choices") or []
    if not choices:
        return None
    delta = (choices[0].get("delta") or {}).get("content")
    return delta if isinstance(delta, str) and delta else None
