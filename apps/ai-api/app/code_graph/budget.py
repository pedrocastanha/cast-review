from pydantic import BaseModel, Field

from app.code_graph.models import ScoredNode, Symbol

CHARS_PER_TOKEN = 4
DEFAULT_TOKEN_BUDGET = 8_000
FULL_BODY_FRACTION = 0.30
TAIL_FRACTION = 0.10

MAX_FULL_BODY_NEIGHBORS = 20
MAX_TAIL_ENTRIES = 50


class BudgetSelection(BaseModel):
    changed_symbols: list[Symbol] = Field(default_factory=list)
    full_body_neighbors: list[Symbol] = Field(default_factory=list)
    signature_only_neighbors: list[Symbol] = Field(default_factory=list)
    budget_used: int = 0
    truncated: bool = False


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def select(
    changed_symbols: list[Symbol],
    ranked: list[ScoredNode],
    symbols_by_id: dict[str, Symbol],
    token_budget: int = DEFAULT_TOKEN_BUDGET,
) -> BudgetSelection:
    """Greedy allocation, not a rigid 60/30/10 partition: changed files always get
    what they need (never truncated mid-symbol — CGC-05), then remaining budget fills
    neighbors in rank order. The 60/30/10 split in the spec is the *target* shape for
    the common case (changed files usually far smaller than 60% of an 8000-token
    budget); a hard partition would either starve small diffs of neighbor context or
    truncate large diffs for no reason.
    """
    changed_ids = {s.id for s in changed_symbols}
    changed_tokens = sum(estimate_tokens(s.body or s.signature) for s in changed_symbols)

    if changed_tokens >= token_budget:
        return BudgetSelection(
            changed_symbols=changed_symbols,
            budget_used=changed_tokens,
            truncated=True,
        )

    remaining = token_budget - changed_tokens
    full_body_budget = min(remaining, int(token_budget * FULL_BODY_FRACTION))
    tail_budget = min(remaining - full_body_budget, int(token_budget * TAIL_FRACTION))

    full_body_neighbors: list[Symbol] = []
    used_full_body = 0
    truncated = False

    candidates = [
        symbols_by_id[node.symbol_id]
        for node in ranked
        if node.symbol_id in symbols_by_id and node.symbol_id not in changed_ids
    ]

    remaining_candidates = list(candidates)
    for symbol in candidates:
        if len(full_body_neighbors) >= MAX_FULL_BODY_NEIGHBORS:
            truncated = True
            break
        cost = estimate_tokens(symbol.body or symbol.signature)
        if used_full_body + cost > full_body_budget:
            # Doesn't fit as full body — CGC-05: never a partial body, only a clean
            # downgrade to signature-only, handled below in the tail pass.
            continue
        full_body_neighbors.append(symbol)
        used_full_body += cost
        remaining_candidates.remove(symbol)

    signature_only_neighbors: list[Symbol] = []
    used_tail = 0
    for symbol in remaining_candidates:
        if len(signature_only_neighbors) >= MAX_TAIL_ENTRIES:
            truncated = True
            break
        cost = estimate_tokens(symbol.signature)
        if used_tail + cost > tail_budget:
            truncated = True
            continue
        signature_only_neighbors.append(symbol)
        used_tail += cost

    if len(remaining_candidates) > len(signature_only_neighbors):
        truncated = True

    return BudgetSelection(
        changed_symbols=changed_symbols,
        full_body_neighbors=full_body_neighbors,
        signature_only_neighbors=signature_only_neighbors,
        budget_used=changed_tokens + used_full_body + used_tail,
        truncated=truncated,
    )
