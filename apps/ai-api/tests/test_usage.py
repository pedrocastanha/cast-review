from app.graph.utils.usage import (
    aggregate_usage,
    skipped_step,
    step_usage,
)
from app.infrastructure.llm.tokens import TokenUsage


def test_skipped_step_is_zero_and_does_not_break_complete():
    step = skipped_step("change_analyzer")
    assert step["skipped"] is True
    assert step["costUsd"] == 0
    assert step["model"] is None


def test_unknown_model_keeps_tokens_and_null_cost():
    usage = step_usage(
        "prd",
        "claude-4",
        TokenUsage(prompt_tokens=10, completion_tokens=2, total_tokens=12, source="openai"),
    )
    assert usage["promptTokens"] == 10
    assert usage["costUsd"] is None
    assert usage["skipped"] is False


def test_aggregate_sums_and_marks_incomplete_when_price_missing():
    steps = [
        skipped_step("change_analyzer"),
        step_usage(
            "prd",
            "gpt-5.4-mini",
            TokenUsage(prompt_tokens=1000, completion_tokens=0, total_tokens=1000, source="openai"),
        ),
        step_usage(
            "implementation_spec",
            "unknown-model",
            TokenUsage(prompt_tokens=500, completion_tokens=0, total_tokens=500, source="openai"),
        ),
    ]
    total = aggregate_usage(steps)
    assert total["promptTokens"] == 1500
    assert total["costComplete"] is False
    assert total["steps"][0]["step"] == "change_analyzer"


def test_missing_usage_source_marks_incomplete():
    billed = step_usage(
        "prd",
        "gpt-4o",
        TokenUsage(source="missing"),
    )
    total = aggregate_usage([billed])
    assert total["costComplete"] is False
