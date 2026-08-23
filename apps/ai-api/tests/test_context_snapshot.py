from app.code_graph.models import Edge, Graph, IndexStats, RelatedContext, Symbol, SymbolRef
from app.code_graph.snapshot import build_context_snapshot


def _symbol(symbol_id: str, path: str, name: str, body: str) -> Symbol:
    return Symbol(
        id=symbol_id,
        kind="function",
        path=path,
        name=name,
        line=1,
        end_line=3,
        signature=f"function {name}()",
        body=body,
        content_hash=f"hash-{symbol_id}",
    )


def test_snapshot_hash_is_stable_and_captures_selected_subgraph():
    changed = _symbol("changed", "src/changed.ts", "changed", "return dependency()")
    caller = _symbol("caller", "src/caller.ts", "caller", "return changed()")
    dependency = _symbol("dependency", "src/dependency.ts", "dependency", "return 1")
    graph = Graph(
        nodes={node.id: node for node in (changed, caller, dependency)},
        edges=[
            Edge(from_id="caller", to_id="changed", kind="references"),
            Edge(from_id="changed", to_id="dependency", kind="references"),
        ],
    )
    related = RelatedContext(
        callers=[SymbolRef(path=caller.path, name=caller.name, signature=caller.signature, body=caller.body)],
        callees=[
            SymbolRef(
                path=dependency.path,
                name=dependency.name,
                signature=dependency.signature,
                body=dependency.body,
            )
        ],
        stats=IndexStats(indexed=True, budgetUsed=32, truncated=False),
    )
    changed_files = [
        {
            "path": changed.path,
            "diff": "+ return dependency()",
            "fullContent": changed.body,
            "relatedFiles": [],
        }
    ]

    first = build_context_snapshot(
        analysis_id="analysis-a",
        repo_id="cast/review",
        sha="sha-123",
        graph=graph,
        related=related,
        diff="diff body",
        changed_files=changed_files,
        conventions="Never hide context",
    )
    second = build_context_snapshot(
        analysis_id="analysis-b",
        repo_id="cast/review",
        sha="sha-123",
        graph=graph,
        related=related,
        diff="diff body",
        changed_files=changed_files,
        conventions="Never hide context",
    )

    assert first.snapshotHash == second.snapshotHash
    assert {node.relation for node in first.selected.nodes} == {"changed", "caller", "callee"}
    assert {(edge.fromId, edge.toId) for edge in first.edges} == {
        ("caller", "changed"),
        ("changed", "dependency"),
    }
    assert first.rendered.graphContextBlock.startswith("## Callers")
    assert first.rendered.relatedContext == related.model_dump()
    assert first.repository.requestedSha == "sha-123"
    assert first.graph.indexedSha == "sha-123"


def test_snapshot_contains_only_explicit_input_and_never_api_keys():
    graph = Graph()
    snapshot = build_context_snapshot(
        analysis_id="analysis-a",
        repo_id="cast/review",
        sha="sha-123",
        graph=graph,
        related=RelatedContext(stats=IndexStats(indexed=False)),
        diff="safe diff",
        changed_files=[],
        conventions="safe conventions",
    )

    serialized = snapshot.model_dump_json()
    assert "apiKey" not in serialized
    assert "sk-secret" not in serialized
    assert snapshot.graph.indexedSha is None
    assert snapshot.selected.nodes == []
