from neo4j import AsyncDriver

from app.code_graph.budget import DEFAULT_TOKEN_BUDGET
from app.code_graph.budget import select as budget_select
from app.code_graph.cache import IndexCache
from app.code_graph.deadcode import filter_pr_relevant, find_dead_candidates
from app.code_graph.hunks import changed_symbol_ids, removed_identifiers
from app.code_graph.models import Graph, IndexStats, RelatedContext, ScoredNode, Symbol, SymbolRef
from app.code_graph.ranker import rank as rank_callers

MAX_CALLEES = 20
MAX_TEST_REFS = 20


def _to_ref(symbol: Symbol, full_body: bool) -> SymbolRef:
    return SymbolRef(
        path=symbol.path,
        name=symbol.name,
        signature=symbol.signature,
        body=symbol.body if full_body else None,
    )


def _direct_targets(graph: Graph, from_ids: set[str], kind: str) -> list[str]:
    """Distinct `to_id`s of edges of `kind` starting inside `from_ids` and landing
    outside it — e.g. what changed symbols directly call (callees)."""
    seen: list[str] = []
    for edge in graph.edges:
        if edge.kind == kind and edge.from_id in from_ids and edge.to_id not in from_ids:
            if edge.to_id not in seen:
                seen.append(edge.to_id)
    return seen


def _direct_sources(graph: Graph, to_ids: set[str], kind: str) -> list[str]:
    """Distinct `from_id`s of edges of `kind` landing inside `to_ids` — e.g. tests
    that directly exercise a changed symbol."""
    seen: list[str] = []
    for edge in graph.edges:
        if edge.kind == kind and edge.to_id in to_ids and edge.from_id not in to_ids:
            if edge.from_id not in seen:
                seen.append(edge.from_id)
    return seen


async def assemble_related_context(
    cache: IndexCache,
    driver: AsyncDriver,
    repo_id: str,
    sha: str,
    changed_paths: list[str],
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    changed_files: list[dict] | None = None,
) -> RelatedContext:
    """Single facade shared by the standalone `/index/context` route (P5) and
    `change_analyzer` (P2, in-process) — same selection logic either way, per CGC-16's
    'not a divergent implementation' requirement."""
    graph = await cache.lookup(repo_id, sha)
    if graph is None:
        return RelatedContext(stats=IndexStats(indexed=False))

    if changed_files:
        changed_ids = changed_symbol_ids(graph, changed_files)
        source_symbol_ids = sorted(changed_ids)
    else:
        changed_ids = {s.id for s in graph.nodes.values() if s.path in changed_paths}
        source_symbol_ids = None
    changed_symbols = [graph.nodes[sid] for sid in changed_ids]

    callee_ids = set(_direct_targets(graph, changed_ids, "references")[:MAX_CALLEES])
    test_ids = set(_direct_sources(graph, changed_ids, "tests")[:MAX_TEST_REFS])

    ranked_callers = await rank_callers(
        driver, repo_id, sha, changed_paths, source_symbol_ids=source_symbol_ids
    )

    combined_ranked = list(ranked_callers) + [
        ScoredNode(symbol_id=callee_id, score=0.0) for callee_id in callee_ids
    ]

    selection = budget_select(changed_symbols, combined_ranked, graph.nodes, token_budget)

    removed_names: set[str] = set()
    for item in changed_files or []:
        removed_names |= removed_identifiers(str(item.get("diff") or ""))
    dead = filter_pr_relevant(find_dead_candidates(graph), set(changed_paths), removed_names)

    callers: list[SymbolRef] = []
    callees: list[SymbolRef] = []
    tests: list[SymbolRef] = []
    entries = [(s, True) for s in selection.full_body_neighbors] + [
        (s, False) for s in selection.signature_only_neighbors
    ]
    for symbol, full_body in entries:
        ref = _to_ref(symbol, full_body)
        if symbol.id in test_ids:
            tests.append(ref)
        elif symbol.id in callee_ids:
            callees.append(ref)
        else:
            callers.append(ref)

    repo_map = "\n".join(s.signature for s in selection.signature_only_neighbors)

    return RelatedContext(
        callers=callers,
        callees=callees,
        tests=tests,
        deadCodeCandidates=[_to_ref(s, False) for s in dead.dead],
        onlyTestedCandidates=[_to_ref(s, False) for s in dead.only_tested],
        repoMap=repo_map,
        stats=IndexStats(
            indexed=True,
            indexedFiles=len({s.path for s in graph.nodes.values()}),
            budgetUsed=selection.budget_used,
            truncated=selection.truncated,
        ),
    )
