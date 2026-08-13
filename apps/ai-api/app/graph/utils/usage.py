from __future__ import annotations

from app.infrastructure.llm.pricing import PRICING_AS_OF, estimate_cost_usd
from app.infrastructure.llm.tokens import TokenUsage

STEP_ORDER = (
    "change_analyzer",
    "prd",
    "implementation_spec",
    "test_reviewer",
    "architecture_reviewer",
    "report_builder",
)

STEP_LABELS = {
    "change_analyzer": "Change Analyzer",
    "prd": "PRD",
    "implementation_spec": "Implementation Spec",
    "test_reviewer": "Test Reviewer",
    "architecture_reviewer": "Architecture",
    "report_builder": "Relatório",
}


def skipped_step(step: str) -> dict:
    """Etapa sem chamada ao LLM (atalho determinístico ou node de código)."""
    return {
        "step": step,
        "label": STEP_LABELS[step],
        "model": None,
        "promptTokens": 0,
        "cachedTokens": 0,
        "completionTokens": 0,
        "totalTokens": 0,
        "costUsd": 0.0,
        "skipped": True,
        "source": "openai",
    }


def step_usage(step: str, model: str, usage: TokenUsage) -> dict:
    cost = estimate_cost_usd(
        model,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.cached_tokens,
    )
    return {
        "step": step,
        "label": STEP_LABELS[step],
        "model": model,
        "promptTokens": usage.prompt_tokens,
        "cachedTokens": usage.cached_tokens,
        "completionTokens": usage.completion_tokens,
        "totalTokens": usage.total_tokens,
        "costUsd": cost,
        "skipped": False,
        "source": usage.source,
    }


def aggregate_usage(steps: list[dict]) -> dict:
    """Soma tokens e custos conhecidos. costComplete=false se alguma etapa LLM ficou sem preço ou sem usage."""
    ordered = _order_steps(steps)
    prompt = sum(int(item.get("promptTokens") or 0) for item in ordered)
    cached = sum(int(item.get("cachedTokens") or 0) for item in ordered)
    completion = sum(int(item.get("completionTokens") or 0) for item in ordered)
    total = sum(int(item.get("totalTokens") or 0) for item in ordered)

    known_costs = [
        item["costUsd"]
        for item in ordered
        if isinstance(item.get("costUsd"), (int, float))
    ]
    cost_usd = float(sum(known_costs)) if known_costs else 0.0

    incomplete = any(
        not item.get("skipped")
        and (item.get("costUsd") is None or item.get("source") == "missing")
        for item in ordered
    )

    return {
        "currency": "USD",
        "promptTokens": prompt,
        "cachedTokens": cached,
        "completionTokens": completion,
        "totalTokens": total,
        "costUsd": None if incomplete and not known_costs else cost_usd,
        "costComplete": not incomplete,
        "pricingAsOf": PRICING_AS_OF,
        "steps": ordered,
    }


def collect_steps_from_state(state: dict) -> list[dict]:
    """Puxa o `usage` que cada node deixou no próprio payload."""
    mapping = (
        ("change_analysis", "change_analyzer"),
        ("prd", "prd"),
        ("spec", "implementation_spec"),
        ("test_review", "test_reviewer"),
        ("architecture_review", "architecture_reviewer"),
    )
    steps: list[dict] = []
    for key, step in mapping:
        blob = state.get(key)
        usage = blob.get("usage") if isinstance(blob, dict) else None
        if isinstance(usage, dict) and usage.get("step"):
            steps.append(usage)
        elif blob is not None:
            steps.append(skipped_step(step))
    steps.append(skipped_step("report_builder"))
    return steps


def without_usage(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "usage"}


def _order_steps(steps: list[dict]) -> list[dict]:
    rank = {name: index for index, name in enumerate(STEP_ORDER)}
    return sorted(steps, key=lambda item: rank.get(str(item.get("step")), 99))
