from app.code_graph.budget import (
    MAX_FULL_BODY_NEIGHBORS,
    MAX_TAIL_ENTRIES,
    select,
)
from app.code_graph.models import ScoredNode, Symbol


def _symbol(id_: str, body_chars: int = 40) -> Symbol:
    body = "x" * body_chars
    return Symbol(
        id=id_,
        kind="function",
        path=f"{id_}.ts",
        name=id_,
        line=1,
        end_line=1,
        signature=f"function {id_}()",
        body=body,
    )


def test_changed_files_always_included_neighbors_fill_remaining_budget():
    changed = [_symbol("changed", body_chars=100)]
    neighbors = [_symbol(f"n{i}", body_chars=100) for i in range(5)]
    ranked = [ScoredNode(symbol_id=s.id, score=1.0 - i * 0.1) for i, s in enumerate(neighbors)]
    symbols_by_id = {s.id: s for s in changed + neighbors}

    result = select(changed, ranked, symbols_by_id, token_budget=8_000)

    assert result.changed_symbols == changed
    assert len(result.full_body_neighbors) == 5
    assert result.truncated is False


def test_budget_smaller_than_changed_files_alone_zeroes_neighbors_and_truncates():
    changed = [_symbol("changed", body_chars=40_000)]  # ~10k tokens, way over budget
    neighbors = [_symbol("n0", body_chars=100)]
    ranked = [ScoredNode(symbol_id="n0", score=1.0)]
    symbols_by_id = {s.id: s for s in changed + neighbors}

    result = select(changed, ranked, symbols_by_id, token_budget=1_000)

    assert result.changed_symbols == changed
    assert result.full_body_neighbors == []
    assert result.signature_only_neighbors == []
    assert result.truncated is True


def test_neighbor_that_does_not_fit_full_body_downgrades_to_signature_never_partial():
    changed = [_symbol("changed", body_chars=40)]
    # Body way bigger than what's left in the full-body slice, but signature is tiny.
    big_neighbor = _symbol("big", body_chars=100_000)
    ranked = [ScoredNode(symbol_id="big", score=1.0)]
    symbols_by_id = {s.id: s for s in changed + [big_neighbor]}

    result = select(changed, ranked, symbols_by_id, token_budget=8_000)

    assert result.full_body_neighbors == []
    assert len(result.signature_only_neighbors) == 1
    assert result.signature_only_neighbors[0].id == "big"
    # Never present with a truncated/partial body string
    assert result.signature_only_neighbors[0] is big_neighbor


def test_full_body_neighbor_count_hard_capped_even_with_room_in_budget():
    changed = [_symbol("changed", body_chars=10)]
    neighbors = [_symbol(f"n{i}", body_chars=10) for i in range(MAX_FULL_BODY_NEIGHBORS + 10)]
    ranked = [ScoredNode(symbol_id=s.id, score=1.0 - i * 0.001) for i, s in enumerate(neighbors)]
    symbols_by_id = {s.id: s for s in changed + neighbors}

    result = select(changed, ranked, symbols_by_id, token_budget=1_000_000)

    assert len(result.full_body_neighbors) == MAX_FULL_BODY_NEIGHBORS
    assert result.truncated is True


def test_tail_signature_count_hard_capped_for_pathological_fan_out():
    """Direct answer to: '1-line change in a widely-called method — does it send
    hundreds of callers?' No — even cheap one-line signatures are capped by count,
    not just by token budget."""
    changed = [_symbol("changed", body_chars=10)]
    neighbors = [_symbol(f"n{i}", body_chars=1) for i in range(500)]
    ranked = [ScoredNode(symbol_id=s.id, score=1.0 - i * 0.0001) for i, s in enumerate(neighbors)]
    symbols_by_id = {s.id: s for s in changed + neighbors}

    result = select(changed, ranked, symbols_by_id, token_budget=1_000_000)

    total_included = len(result.full_body_neighbors) + len(result.signature_only_neighbors)
    assert len(result.signature_only_neighbors) <= MAX_TAIL_ENTRIES
    assert total_included < 500
    assert result.truncated is True


def test_ranked_entries_missing_from_symbols_by_id_are_skipped_not_erroring():
    changed = [_symbol("changed")]
    ranked = [ScoredNode(symbol_id="ghost", score=1.0)]
    symbols_by_id = {s.id: s for s in changed}

    result = select(changed, ranked, symbols_by_id, token_budget=8_000)

    assert result.full_body_neighbors == []
    assert result.signature_only_neighbors == []
