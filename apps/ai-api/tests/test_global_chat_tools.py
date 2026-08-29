import pytest

from app.chat.tools import GlobalToolExecutor, ToolError
from app.code_graph.models import Graph, Symbol


def _graph(name: str) -> Graph:
    return Graph(
        nodes={
            name: Symbol(
                id=name,
                kind="function",
                path=f"src/{name}.ts",
                name=name,
                line=1,
                end_line=3,
                signature=f"function {name}()",
                body=f"function {name}() {{}}",
            )
        }
    )


class FakeCatalog:
    def __init__(self) -> None:
        self.list_calls: list[dict] = []
        self.resolve_calls: list[str] = []

    async def list(self, query=None, limit=20, cursor=None):
        self.list_calls.append({"query": query, "limit": limit, "cursor": cursor})
        return {
            "repositories": [
                {"repoId": "acme/back", "sha": "sha-back", "stale": False},
                {"repoId": "acme/front", "sha": "sha-front", "stale": True},
            ],
            "nextCursor": None,
        }

    async def resolve(self, repo_id: str):
        self.resolve_calls.append(repo_id)
        return {"repoId": repo_id, "sha": f"sha-{repo_id.split('/')[-1]}", "stale": False}


class FakeCache:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def lookup(self, repo_id: str, sha: str):
        self.calls.append((repo_id, sha))
        return _graph(repo_id.split("/")[-1])


@pytest.mark.asyncio
async def test_catalog_listing_does_not_load_repository_graphs():
    cache = FakeCache()
    catalog = FakeCatalog()
    executor = GlobalToolExecutor(cache, catalog)

    result = await executor.execute_async(
        "list_indexed_repositories", {"query": "acme", "limit": 10}
    )

    assert [item["repoId"] for item in result.items] == ["acme/back", "acme/front"]
    assert cache.calls == []
    assert catalog.list_calls == [{"query": "acme", "limit": 10, "cursor": None}]


@pytest.mark.asyncio
async def test_repository_tools_require_an_explicit_repo_id():
    executor = GlobalToolExecutor(FakeCache(), FakeCatalog())

    with pytest.raises(ToolError, match="repoId"):
        await executor.execute_async("search_symbols", {"query": "login"})


@pytest.mark.asyncio
async def test_two_repositories_are_resolved_and_loaded_lazily():
    cache = FakeCache()
    catalog = FakeCatalog()
    executor = GlobalToolExecutor(cache, catalog)

    back = await executor.execute_async(
        "search_symbols", {"repoId": "acme/back", "query": "back"}
    )
    front = await executor.execute_async(
        "search_symbols", {"repoId": "acme/front", "query": "front"}
    )
    await executor.execute_async(
        "search_symbols", {"repoId": "acme/back", "query": "back"}
    )

    assert back.items[0]["repoId"] == "acme/back"
    assert front.items[0]["repoId"] == "acme/front"
    assert back.citations[0].sha == "sha-back"
    assert front.citations[0].sha == "sha-front"
    assert catalog.resolve_calls == ["acme/back", "acme/front"]
    assert cache.calls == [("acme/back", "sha-back"), ("acme/front", "sha-front")]


@pytest.mark.asyncio
async def test_workspace_cache_is_bounded_by_least_recently_used_order():
    cache = FakeCache()
    executor = GlobalToolExecutor(cache, FakeCatalog(), max_workspaces=2)

    for repo_id in ["acme/one", "acme/two", "acme/three"]:
        await executor.execute_async(
            "list_files", {"repoId": repo_id, "pathPrefix": "src"}
        )

    assert [workspace.repo_id for workspace in executor.workspaces] == [
        "acme/two",
        "acme/three",
    ]


def test_global_definitions_require_repo_id_for_graph_tools():
    executor = GlobalToolExecutor(FakeCache(), FakeCatalog())
    definitions = {
        item["function"]["name"]: item["function"] for item in executor.definitions()
    }

    assert "list_indexed_repositories" in definitions
    assert "repoId" in definitions["search_symbols"]["parameters"]["required"]
    assert "repoId" in definitions["list_files"]["parameters"]["required"]
