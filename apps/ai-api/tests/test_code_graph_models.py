import pytest
from pydantic import ValidationError

from app.code_graph.models import Edge, Graph, IndexStats, RelatedContext, Symbol


def test_symbol_rejects_invalid_kind():
    with pytest.raises(ValidationError):
        Symbol(id="a", kind="module", path="a.py", name="a", line=1, end_line=1, signature="")


def test_symbol_accepts_valid_kinds():
    for kind in ("file", "function", "class", "method"):
        Symbol(id="a", kind=kind, path="a.py", name="a", line=1, end_line=1, signature="")


def test_edge_rejects_invalid_kind():
    with pytest.raises(ValidationError):
        Edge(from_id="a", to_id="b", kind="calls")


def test_edge_accepts_valid_kinds():
    for kind in ("defines", "references", "imports", "tests"):
        Edge(from_id="a", to_id="b", kind=kind)


def test_graph_defaults_empty():
    graph = Graph()
    assert graph.nodes == {}
    assert graph.edges == []


def test_related_context_requires_stats():
    with pytest.raises(ValidationError):
        RelatedContext()


def test_related_context_defaults_empty_lists():
    ctx = RelatedContext(stats=IndexStats(indexed=True))
    assert ctx.callers == []
    assert ctx.deadCodeCandidates == []
    assert ctx.stats.indexed is True
    assert ctx.stats.stale is False
