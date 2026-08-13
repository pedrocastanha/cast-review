from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int = 0
    cached_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    source: Literal["openai", "missing"] = "missing"


def parse_openai_usage(raw: dict | None) -> TokenUsage:
    """Lê o bloco `usage` do chunk final da OpenAI. Sem bloco → source=missing (não falha a run)."""
    if not raw:
        return TokenUsage(source="missing")

    prompt = _as_int(raw.get("prompt_tokens"))
    completion = _as_int(raw.get("completion_tokens"))
    total = _as_int(raw.get("total_tokens"))
    if total == 0:
        total = prompt + completion

    details = raw.get("prompt_tokens_details")
    cached = 0
    if isinstance(details, dict):
        cached = _as_int(details.get("cached_tokens"))
    # cached ⊆ prompt — a API já inclui o cache em prompt_tokens
    cached = min(cached, prompt)

    return TokenUsage(
        prompt_tokens=prompt,
        cached_tokens=cached,
        completion_tokens=completion,
        total_tokens=total,
        source="openai",
    )


def _as_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(int(value), 0)
