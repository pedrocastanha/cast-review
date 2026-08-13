from __future__ import annotations

PRICING_AS_OF = "2026-08-13"

_PRICES: tuple[tuple[str, float, float, float], ...] = (
    ("gpt-4o-mini", 0.15, 0.075, 0.60),
    ("gpt-4o", 2.50, 1.25, 10.00),
    ("gpt-4.1-nano", 0.10, 0.025, 0.40),
    ("gpt-4.1-mini", 0.40, 0.10, 1.60),
    ("gpt-4.1", 2.00, 0.50, 8.00),
    ("gpt-5.6-cyber", 12.50, 1.25, 75.00),
    ("gpt-5.6-luna", 0.20, 0.02, 1.20),
    ("gpt-5.6-terra", 2.00, 0.20, 12.00),
    ("gpt-5.6-sol", 5.00, 0.50, 30.00),
    ("gpt-5.6", 2.00, 0.20, 12.00),
    ("gpt-5.5-pro", 30.00, 30.00, 180.00),
    ("gpt-5.5", 5.00, 0.50, 30.00),
    ("gpt-5.4-nano", 0.20, 0.02, 1.25),
    ("gpt-5.4-mini", 0.75, 0.075, 4.50),
    ("gpt-5.4", 2.50, 0.25, 15.00),
    ("gpt-5-mini", 0.25, 0.025, 2.00),
    ("gpt-5", 1.25, 0.125, 10.00),
)


def resolve_rates(model: str) -> tuple[float, float, float] | None:
    lowered = model.strip().lower()
    if not lowered:
        return None
    for prefix, input_per_1m, cached_per_1m, output_per_1m in _PRICES:
        if lowered.startswith(prefix):
            return input_per_1m, cached_per_1m, output_per_1m
    return None


def estimate_cost_usd(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int = 0,
) -> float | None:
    """Custo USD. cached_tokens ⊆ prompt_tokens (a OpenAI já inclui o cache no prompt)."""
    rates = resolve_rates(model)
    if rates is None:
        return None
    input_per_1m, cached_per_1m, output_per_1m = rates
    cached = min(max(cached_tokens, 0), max(prompt_tokens, 0))
    uncached = max(prompt_tokens, 0) - cached
    return (
        uncached * input_per_1m
        + cached * cached_per_1m
        + max(completion_tokens, 0) * output_per_1m
    ) / 1_000_000
