from app.architecture.models import ComponentRef

ROOT_LABEL = "(root)"


def directory_of(path: str) -> str:
    parts = path.rsplit("/", 1)
    return parts[0] if len(parts) > 1 else ROOT_LABEL


def ancestors_of(directory: str) -> list[str]:
    if directory == ROOT_LABEL:
        return [ROOT_LABEL]
    parts = directory.split("/")
    return ["/".join(parts[: i + 1]) for i in range(len(parts))]


def matches_prefix(path: str, prefix: str) -> bool:
    if prefix == "":
        return True
    if prefix == ROOT_LABEL:
        return "/" not in path
    return path == prefix or path.startswith(f"{prefix}/")


class ComponentIndex:
    def __init__(self, components: list[ComponentRef]) -> None:
        self._by_repo: dict[str, list[ComponentRef]] = {}
        for component in components:
            self._by_repo.setdefault(component.repoId, []).append(component)
        for candidates in self._by_repo.values():
            candidates.sort(key=lambda item: len(item.pathPrefix), reverse=True)

    def resolve(self, repo_id: str, path: str) -> str | None:
        for component in self._by_repo.get(repo_id, []):
            if matches_prefix(path, component.pathPrefix):
                return component.componentId
        return None

    def repositories(self) -> list[str]:
        return list(self._by_repo.keys())
