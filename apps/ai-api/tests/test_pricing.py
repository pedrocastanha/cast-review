from app.infrastructure.llm.pricing import (
    PRICING_AS_OF,
    estimate_cost_usd,
    resolve_rates,
)


def test_pricing_as_of_is_iso_date():
    assert PRICING_AS_OF == "2026-08-13"


def test_longest_prefix_wins_for_gpt_54_mini():
    assert resolve_rates("gpt-5.4-mini") == (0.75, 0.075, 4.50)
    assert resolve_rates("gpt-5.4-mini-2026-03-17") == (0.75, 0.075, 4.50)
    assert resolve_rates("gpt-5.4") == (2.50, 0.25, 15.00)
    assert resolve_rates("gpt-5") == (1.25, 0.125, 10.00)


def test_gpt56_terra_does_not_fall_through_to_alias():
    assert resolve_rates("gpt-5.6-terra") == (2.00, 0.20, 12.00)
    assert resolve_rates("gpt-5.6") == (2.00, 0.20, 12.00)


def test_unknown_model_returns_none():
    assert resolve_rates("claude-4") is None
    assert estimate_cost_usd("claude-4", 1000, 100) is None


def test_empty_model_returns_none():
    assert resolve_rates("   ") is None


def test_estimate_without_cache_on_gpt54_mini():
    # 10k * 0.75 + 1k * 4.50 = 12 / 1e6
    assert estimate_cost_usd("gpt-5.4-mini", 10_000, 1_000) == 0.012


def test_estimate_with_cache_is_cheaper():
    full = estimate_cost_usd("gpt-5.4-mini", 10_000, 1_000, cached_tokens=0)
    cached = estimate_cost_usd("gpt-5.4-mini", 10_000, 1_000, cached_tokens=8_000)
    assert full is not None and cached is not None
    assert cached < full
    # 2k * 0.75 + 8k * 0.075 + 1k * 4.50 = 6.6 / 1e6
    assert cached == 0.0066


def test_cached_tokens_clamped_to_prompt():
    over = estimate_cost_usd("gpt-5.4-mini", 1_000, 0, cached_tokens=9_000)
    exact = estimate_cost_usd("gpt-5.4-mini", 1_000, 0, cached_tokens=1_000)
    assert over == exact
