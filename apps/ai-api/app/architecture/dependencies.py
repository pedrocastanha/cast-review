from app.architecture.matching import ComponentIndex
from app.architecture.models import (
    ArchitectureRepositoryRef,
    ArchitectureStats,
    ComponentDependency,
    ComponentRef,
    DependenciesResponse,
    DependencyEvidence,
)
from app.code_graph.models import Graph, HttpEndpoint

DEPENDENCY_EDGE_KINDS = ("references", "imports", "tests")
MAX_EVIDENCE_PER_DEPENDENCY = 8


def _symbol_edge_evidence(
    repo_id: str,
    sha: str | None,
    graph: Graph,
    from_id: str,
    to_id: str,
    kind: str,
) -> DependencyEvidence:
    source = graph.nodes[from_id]
    target = graph.nodes[to_id]
    return DependencyEvidence(
        kind=kind,
        fromRepoId=repo_id,
        fromPath=source.path,
        fromLine=source.line,
        fromSymbolId=source.id,
        fromSymbolName=source.name,
        toRepoId=repo_id,
        toPath=target.path,
        toLine=target.line,
        toSymbolId=target.id,
        toSymbolName=target.name,
        fromSha=sha,
        toSha=sha,
    )


def _http_evidence(
    consumer_repo: str,
    consumer_sha: str | None,
    consumer: HttpEndpoint,
    provider_repo: str,
    provider_sha: str | None,
    provider: HttpEndpoint,
) -> DependencyEvidence:
    return DependencyEvidence(
        kind="http",
        fromRepoId=consumer_repo,
        fromPath=consumer.path,
        fromLine=consumer.line,
        fromSymbolId=consumer.symbol_id,
        fromSymbolName=consumer.symbol_name,
        toRepoId=provider_repo,
        toPath=provider.path,
        toLine=provider.line,
        toSymbolId=provider.symbol_id,
        toSymbolName=provider.symbol_name,
        fromSha=consumer_sha,
        toSha=provider_sha,
        method=consumer.method,
        route=consumer.route,
    )


class _DependencyAccumulator:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str, str], ComponentDependency] = {}

    def add(self, source: str, target: str, kind: str, evidence: DependencyEvidence) -> None:
        key = (source, target, kind)
        dependency = self._items.get(key)
        if dependency is None:
            dependency = ComponentDependency(
                fromComponentId=source,
                toComponentId=target,
                kind=kind,
                count=0,
            )
            self._items[key] = dependency
        dependency.count += 1
        if len(dependency.evidence) < MAX_EVIDENCE_PER_DEPENDENCY:
            dependency.evidence.append(evidence)

    def result(self) -> list[ComponentDependency]:
        return sorted(
            self._items.values(),
            key=lambda dependency: (
                -dependency.count,
                dependency.fromComponentId,
                dependency.toComponentId,
                dependency.kind,
            ),
        )


def build_dependencies(
    repositories: list[ArchitectureRepositoryRef],
    components: list[ComponentRef],
    graphs: dict[str, Graph | None],
) -> DependenciesResponse:
    index = ComponentIndex(components)
    accumulator = _DependencyAccumulator()
    sha_by_repo = {repository.repoId: repository.sha for repository in repositories}

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

        for edge in graph.edges:
            if edge.kind not in DEPENDENCY_EDGE_KINDS:
                continue
            source_symbol = graph.nodes.get(edge.from_id)
            target_symbol = graph.nodes.get(edge.to_id)
            if source_symbol is None or target_symbol is None:
                continue
            source = index.resolve(repository.repoId, source_symbol.path)
            target = index.resolve(repository.repoId, target_symbol.path)
            if source is None or target is None or source == target:
                continue
            accumulator.add(
                source,
                target,
                edge.kind,
                _symbol_edge_evidence(
                    repository.repoId,
                    repository.sha,
                    graph,
                    edge.from_id,
                    edge.to_id,
                    edge.kind,
                ),
            )

    providers: dict[tuple[str, str], list[tuple[str, HttpEndpoint]]] = {}
    for repo_id, graph in graphs.items():
        if graph is None:
            continue
        for endpoint in graph.endpoints:
            if endpoint.role != "provider":
                continue
            providers.setdefault((endpoint.method, endpoint.normalized_route), []).append(
                (repo_id, endpoint)
            )

    for repo_id, graph in graphs.items():
        if graph is None:
            continue
        for endpoint in graph.endpoints:
            if endpoint.role != "consumer":
                continue
            consumer_component = index.resolve(repo_id, endpoint.path)
            if consumer_component is None:
                continue
            for provider_repo, provider in providers.get(
                (endpoint.method, endpoint.normalized_route), []
            ):
                provider_component = index.resolve(provider_repo, provider.path)
                if provider_component is None or provider_component == consumer_component:
                    continue
                accumulator.add(
                    consumer_component,
                    provider_component,
                    "http",
                    _http_evidence(
                        repo_id,
                        sha_by_repo.get(repo_id),
                        endpoint,
                        provider_repo,
                        sha_by_repo.get(provider_repo),
                        provider,
                    ),
                )

    return DependenciesResponse(
        dependencies=accumulator.result(),
        stats=ArchitectureStats(
            repositories=len(repositories),
            indexedRepositories=indexed,
            symbols=symbols,
            candidates=len(components),
            omittedRepositories=omitted,
        ),
    )
