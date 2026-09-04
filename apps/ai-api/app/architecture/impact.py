from app.architecture.dependencies import build_dependencies
from app.architecture.matching import ComponentIndex
from app.architecture.models import (
    ArchitectureRepositoryRef,
    ChangedFileRef,
    ComponentEvidence,
    ComponentRef,
    ImpactResponse,
    ImpactStats,
    ReachedComponent,
    TouchedComponent,
)
from app.code_graph.models import Graph

MAX_CHANGED_SYMBOLS_PER_COMPONENT = 10


def build_impact(
    repositories: list[ArchitectureRepositoryRef],
    components: list[ComponentRef],
    changed_files: list[ChangedFileRef],
    graphs: dict[str, Graph | None],
) -> ImpactResponse:
    index = ComponentIndex(components)
    sha_by_repo = {repository.repoId: repository.sha for repository in repositories}
    stale = [repository.repoId for repository in repositories if graphs.get(repository.repoId) is None]

    touched: dict[str, TouchedComponent] = {}
    unmapped: list[ChangedFileRef] = []
    changed_by_repo: dict[str, set[str]] = {}

    for changed in changed_files:
        changed_by_repo.setdefault(changed.repoId, set()).add(changed.path)
        component_id = index.resolve(changed.repoId, changed.path)
        if component_id is None:
            unmapped.append(changed)
            continue
        entry = touched.get(component_id)
        if entry is None:
            entry = TouchedComponent(componentId=component_id)
            touched[component_id] = entry
        if changed.path not in entry.changedFiles:
            entry.changedFiles.append(changed.path)

    for repo_id, paths in changed_by_repo.items():
        graph = graphs.get(repo_id)
        if graph is None:
            continue
        for symbol in graph.nodes.values():
            if symbol.path not in paths:
                continue
            component_id = index.resolve(repo_id, symbol.path)
            entry = touched.get(component_id) if component_id else None
            if entry is None or len(entry.changedSymbols) >= MAX_CHANGED_SYMBOLS_PER_COMPONENT:
                continue
            entry.changedSymbols.append(
                ComponentEvidence(
                    kind="symbol",
                    repoId=repo_id,
                    sha=sha_by_repo.get(repo_id),
                    path=symbol.path,
                    line=symbol.line,
                    symbolId=symbol.id,
                    symbolName=symbol.name,
                )
            )

    dependencies = build_dependencies(repositories, components, graphs).dependencies
    reached: dict[tuple[str, str, str], ReachedComponent] = {}

    def register(component_id: str, via: str, direction: str, kind: str, count: int) -> None:
        key = (component_id, via, direction)
        entry = reached.get(key)
        if entry is None:
            entry = ReachedComponent(
                componentId=component_id,
                viaComponentId=via,
                direction=direction,
                count=0,
            )
            reached[key] = entry
        if kind not in entry.kinds:
            entry.kinds.append(kind)
        entry.count += count

    for dependency in dependencies:
        if dependency.fromComponentId in touched and dependency.toComponentId not in touched:
            register(
                dependency.toComponentId,
                dependency.fromComponentId,
                "provides",
                dependency.kind,
                dependency.count,
            )
        if dependency.toComponentId in touched and dependency.fromComponentId not in touched:
            register(
                dependency.fromComponentId,
                dependency.toComponentId,
                "consumes",
                dependency.kind,
                dependency.count,
            )

    mapped = len(changed_files) - len(unmapped)
    coverage = round(mapped / len(changed_files), 4) if changed_files else 0.0

    return ImpactResponse(
        touched=sorted(touched.values(), key=lambda item: item.componentId),
        reached=sorted(
            reached.values(),
            key=lambda item: (-item.count, item.componentId, item.viaComponentId),
        ),
        unmapped=unmapped,
        stats=ImpactStats(
            changedFiles=len(changed_files),
            mappedFiles=mapped,
            unmappedFiles=len(unmapped),
            coverage=coverage,
            staleRepositories=stale,
        ),
    )
