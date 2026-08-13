from app.infrastructure.llm.client import LlmResult
from app.infrastructure.llm.tokens import TokenUsage


def llm(
    data: dict,
    *,
    prompt: int = 12,
    completion: int = 4,
    cached: int = 0,
) -> LlmResult:
    """Resposta fake de complete_json com usage conhecido (testes sem rede)."""
    return LlmResult(
        data=data,
        usage=TokenUsage(
            prompt_tokens=prompt,
            cached_tokens=cached,
            completion_tokens=completion,
            total_tokens=prompt + completion,
            source="openai",
        ),
    )
