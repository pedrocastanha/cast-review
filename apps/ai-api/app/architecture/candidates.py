from app.architecture.matching import ROOT_LABEL, ComponentIndex, directory_of
from app.architecture.models import (
    ArchitectureRepositoryRef,
    ArchitectureStats,
    CandidatesResponse,
    ComponentCandidate,
    ComponentEvidence,
    ComponentRef,
)
from app.code_graph.models import Graph

MAX_COMPONENTS_PER_REPO = 12
MIN_SPLIT_SYMBOLS = 8
MAX_EVIDENCE_PER_COMPONENT = 5
EVIDENCE_KIND_PRIORITY = {"class": 0, "function": 1, "method": 2, "file": 3}


def _own_counts(graph: Graph) -> dict[str, int]:
    counts: dict[str, int] = {}
    for symbol in graph.nodes.values():
        directory = directory_of(symbol.path)
        counts[directory] = counts.get(directory, 0) + 1
    return counts


def _children_map(directories: set[str]) -> dict[str, set[str]]:
    children: dict[str, set[str]] = {directory: set() for directory in directories}
    for directory in directories:
        if "/" in directory:
            parent = directory.rsplit("/", 1)[0]
            if parent in children:
                children[parent].add(directory)
    return children


def _expand_directories(own_counts: dict[str, int]) -> set[str]:
    directories: set[str] = set()
    for leaf in own_counts:
        if leaf == ROOT_LABEL:
            directories.add(ROOT_LABEL)
            continue
        parts = leaf.split("/")
        for index in range(1, len(parts) + 1):
            directories.add("/".join(parts[:index]))
    return directories


def select_prefixes(graph: Graph, max_components: int = MAX_COMPONENTS_PER_REPO) -> list[str]:
    own_counts = _own_counts(graph)
    if not own_counts:
        return []

    directories = _expand_directories(own_counts)
    children = _children_map(directories)

    subtree_cache: dict[str, int] = {}

    def subtree(directory: str) -> int:
        if directory not in subtree_cache:
            subtree_cache[directory] = own_counts.get(directory, 0) + sum(
                subtree(child) for child in children[directory]
            )
        return subtree_cache[directory]

    cut = {directory for directory in directories if "/" not in directory}
    already_split: set[str] = set()

    while len(cut) < max_components:
        splittable = [
            directory
            for directory in cut
            if directory not in already_split
            and children[directory]
            and subtree(directory) >= MIN_SPLIT_SYMBOLS
        ]
        if not splittable:
            break

        target = max(splittable, key=lambda directory: (subtree(directory), directory))
        already_split.add(target)
        cut.discard(target)
        cut.update(children[target])
        if own_counts.get(target, 0) > 0:
            cut.add(target)

    return sorted(cut)


def _evidence_for(graph: Graph, prefix: str, repo_id: str, sha: str | None, index: ComponentIndex) -> list[ComponentEvidence]:
    owned = [
        symbol
        for symbol in graph.nodes.values()
        if index.resolve(repo_id, symbol.path) == prefix
    ]
    owned.sort(
        key=lambda symbol: (
            EVIDENCE_KIND_PRIORITY.get(symbol.kind, 9),
            -(symbol.end_line - symbol.line),
            symbol.path,
            symbol.name,
        )
    )
    return [
        ComponentEvidence(
            kind="symbol",
            repoId=repo_id,
            sha=sha,
            path=symbol.path,
            line=symbol.line,
            symbolId=symbol.id,
            symbolName=symbol.name,
        )
        for symbol in owned[:MAX_EVIDENCE_PER_COMPONENT]
    ]


def _candidates_for_repository(repo_id: str, sha: str | None, graph: Graph) -> list[ComponentCandidate]:
    prefixes = select_prefixes(graph)
    if not prefixes:
        return []

    index = ComponentIndex(
        [ComponentRef(componentId=prefix, repoId=repo_id, pathPrefix=prefix) for prefix in prefixes]
    )

    owner_of_symbol: dict[str, str] = {}
    files_by_prefix: dict[str, set[str]] = {prefix: set() for prefix in prefixes}
    symbols_by_prefix: dict[str, int] = {prefix: 0 for prefix in prefixes}

    for symbol in graph.nodes.values():
        owner = index.resolve(repo_id, symbol.path)
        if owner is None:
            continue
        owner_of_symbol[symbol.id] = owner
        files_by_prefix[owner].add(symbol.path)
        symbols_by_prefix[owner] += 1

    internal: dict[str, int] = {prefix: 0 for prefix in prefixes}
    inbound: dict[str, int] = {prefix: 0 for prefix in prefixes}
    outbound: dict[str, int] = {prefix: 0 for prefix in prefixes}

    for edge in graph.edges:
        source = owner_of_symbol.get(edge.from_id)
        target = owner_of_symbol.get(edge.to_id)
        if source is None or target is None:
            continue
        if source == target:
            internal[source] += 1
            continue
        outbound[source] += 1
        inbound[target] += 1

    provided: dict[str, int] = {prefix: 0 for prefix in prefixes}
    consumed: dict[str, int] = {prefix: 0 for prefix in prefixes}
    for endpoint in graph.endpoints:
        owner = index.resolve(repo_id, endpoint.path)
        if owner is None:
            continue
        if endpoint.role == "provider":
            provided[owner] += 1
        else:
            consumed[owner] += 1

    candidates: list[ComponentCandidate] = []
    for prefix in prefixes:
        if symbols_by_prefix[prefix] == 0:
            continue
        candidates.append(
            ComponentCandidate(
                candidateKey=f"{repo_id}:{prefix}",
                repoId=repo_id,
                pathPrefix=prefix,
                label=repo_id.split("/")[-1] if prefix == ROOT_LABEL else prefix,
                kind="repository" if prefix == ROOT_LABEL else "directory",
                sha=sha,
                indexed=True,
                fileCount=len(files_by_prefix[prefix]),
                symbolCount=symbols_by_prefix[prefix],
                internalEdges=internal[prefix],
                inboundEdges=inbound[prefix],
                outboundEdges=outbound[prefix],
                providedEndpoints=provided[prefix],
                consumedEndpoints=consumed[prefix],
                evidence=_evidence_for(graph, prefix, repo_id, sha, index),
            )
        )

    candidates.sort(key=lambda candidate: (-candidate.symbolCount, candidate.pathPrefix))
    return candidates


def build_candidates(
    repositories: list[ArchitectureRepositoryRef],
    graphs: dict[str, Graph | None],
) -> CandidatesResponse:
    candidates: list[ComponentCandidate] = []
    omitted: list[str] = []
    symbols = 0
    indexed = 0

    for repository in repositories:
        graph = graphs.get(repository.repoId)
        if graph is None:
            omitted.append(repository.repoId)
            continue
        indexed += 1
        symbols += len(graph.nodes)
        candidates.extend(_candidates_for_repository(repository.repoId, repository.sha, graph))

    return CandidatesResponse(
        candidates=candidates,
        stats=ArchitectureStats(
            repositories=len(repositories),
            indexedRepositories=indexed,
            symbols=symbols,
            candidates=len(candidates),
            omittedRepositories=omitted,
        ),
    )
