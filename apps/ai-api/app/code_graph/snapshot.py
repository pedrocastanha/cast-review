import hashlib
import json
from collections import deque
from datetime import UTC, datetime

from app.code_graph.budget import DEFAULT_TOKEN_BUDGET
from app.code_graph.models import (
    AnalysisContextSnapshot,
    Graph,
    GraphSnapshotEdge,
    GraphSnapshotNode,
    RelatedContext,
    SnapshotBudget,
    SnapshotGraphMetadata,
    SnapshotInput,
    SnapshotRendered,
    SnapshotRepository,
    SnapshotSelection,
    Symbol,
    SymbolRef,
)
from app.graph.utils.files import _related_context_block


def _find_symbol(graph: Graph, ref: SymbolRef) -> Symbol | None:
    return next(
        (
            symbol
            for symbol in graph.nodes.values()
            if symbol.path == ref.path
            and symbol.name == ref.name
            and symbol.signature == ref.signature
        ),
        None,
    )


def _distances(graph: Graph, changed_ids: set[str], reverse: bool) -> dict[str, int]:
    adjacency: dict[str, list[str]] = {}
    for edge in graph.edges:
        if edge.kind != "references":
            continue
        source, target = (edge.to_id, edge.from_id) if reverse else (edge.from_id, edge.to_id)
        adjacency.setdefault(source, []).append(target)

    distances = {symbol_id: 0 for symbol_id in changed_ids}
    queue = deque(changed_ids)
    while queue:
        current = queue.popleft()
        for neighbor in adjacency.get(current, []):
            if neighbor in distances:
                continue
            distances[neighbor] = distances[current] + 1
            queue.append(neighbor)
    return distances


def _snapshot_node(
    symbol: Symbol,
    relation: str,
    distance: int | None,
    stale: bool,
    full_body: bool,
) -> GraphSnapshotNode:
    reason_by_relation = {
        "changed": "símbolo definido em arquivo alterado",
        "caller": "chama direta ou transitivamente um símbolo alterado",
        "callee": "é chamado diretamente por um símbolo alterado",
        "test": "teste relacionado ao símbolo alterado",
        "dead_code": "não possui caller conhecido no índice",
    }
    return GraphSnapshotNode(
        id=symbol.id,
        kind=symbol.kind,
        path=symbol.path,
        name=symbol.name,
        signature=symbol.signature,
        body=symbol.body if full_body else None,
        line=symbol.line,
        endLine=symbol.end_line,
        contentHash=symbol.content_hash or None,
        relation=relation,
        distance=distance,
        score=None if distance is None else round(1 / (1 + distance), 4),
        confidence="stale" if stale else "confirmed",
        reason=reason_by_relation[relation],
    )


def _canonical_hash(payload: dict) -> str:
    stable = {
        key: value
        for key, value in payload.items()
        if key not in {"snapshotHash", "createdAt", "analysisId"}
    }
    canonical = json.dumps(stable, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_context_snapshot(
    *,
    analysis_id: str | None,
    repo_id: str,
    sha: str | None,
    graph: Graph,
    related: RelatedContext,
    diff: str,
    changed_files: list[dict],
    conventions: str,
    token_budget: int = DEFAULT_TOKEN_BUDGET,
) -> AnalysisContextSnapshot:
    changed_paths = {str(item.get("path") or "") for item in changed_files}
    changed_symbols = [symbol for symbol in graph.nodes.values() if symbol.path in changed_paths]
    changed_ids = {symbol.id for symbol in changed_symbols}
    caller_distances = _distances(graph, changed_ids, reverse=True)
    callee_distances = _distances(graph, changed_ids, reverse=False)

    selected_by_id: dict[str, GraphSnapshotNode] = {}
    groups: dict[str, list[GraphSnapshotNode]] = {
        "changed": [],
        "caller": [],
        "callee": [],
        "test": [],
        "dead_code": [],
    }

    def add(symbol: Symbol, relation: str, distance: int | None, full_body: bool) -> None:
        if symbol.id in selected_by_id:
            return
        node = _snapshot_node(symbol, relation, distance, related.stats.stale, full_body)
        selected_by_id[symbol.id] = node
        groups[relation].append(node)

    for symbol in changed_symbols:
        add(symbol, "changed", 0, True)

    refs = (
        (related.callers, "caller", caller_distances),
        (related.callees, "callee", callee_distances),
        (related.tests, "test", {}),
        (related.deadCodeCandidates, "dead_code", {}),
    )
    for relation_refs, relation, distances in refs:
        for ref in relation_refs:
            symbol = _find_symbol(graph, ref)
            if symbol:
                add(symbol, relation, distances.get(symbol.id, 1), ref.body is not None)

    selected_ids = set(selected_by_id)
    selected_edges = [
        GraphSnapshotEdge(
            fromId=edge.from_id,
            toId=edge.to_id,
            kind=edge.kind,
            weight=edge.weight,
            confidence="stale" if related.stats.stale else "confirmed",
        )
        for edge in graph.edges
        if edge.from_id in selected_ids and edge.to_id in selected_ids
    ]
    omitted_edges = sum(
        1
        for edge in graph.edges
        if (edge.from_id in selected_ids or edge.to_id in selected_ids)
        and not (edge.from_id in selected_ids and edge.to_id in selected_ids)
    )
    owner, separator, repo = repo_id.partition("/")
    related_dump = related.model_dump()
    selection = SnapshotSelection(
        nodes=list(selected_by_id.values()),
        changedSymbols=groups["changed"],
        callers=groups["caller"],
        callees=groups["callee"],
        tests=groups["test"],
        deadCodeCandidates=groups["dead_code"],
        repoMap=related.repoMap,
    )
    snapshot = AnalysisContextSnapshot(
        snapshotHash="",
        createdAt=datetime.now(UTC).isoformat(),
        analysisId=analysis_id,
        repository=SnapshotRepository(
            repoId=repo_id,
            owner=owner,
            repo=repo if separator else repo_id,
            requestedSha=sha,
        ),
        graph=SnapshotGraphMetadata(
            indexedSha=sha if related.stats.indexed else None,
            stale=related.stats.stale,
        ),
        input=SnapshotInput(
            diffHash=hashlib.sha256(diff.encode("utf-8")).hexdigest(),
            diff=diff,
            changedFiles=changed_files,
            conventions=conventions,
        ),
        selected=selection,
        edges=selected_edges,
        budget=SnapshotBudget(
            tokenBudget=token_budget,
            budgetUsed=related.stats.budgetUsed,
            truncated=related.stats.truncated,
            omittedNodes=max(0, len(graph.nodes) - len(selected_by_id)),
            omittedEdges=omitted_edges,
        ),
        rendered=SnapshotRendered(
            graphContextBlock=_related_context_block(related_dump, 100_000),
            relatedContext=related_dump,
        ),
    )
    snapshot.snapshotHash = _canonical_hash(snapshot.model_dump())
    return snapshot
