import pytest

from app.chat.tools import MAX_BODY_CHARS, RepoWorkspace, ToolError, ToolExecutor
from app.code_graph.file_view import render_file
from app.code_graph.models import Edge, Graph, HttpEndpoint, Symbol


def _symbol(symbol_id: str, name: str, path: str, line: int, end_line: int, body: str = "", kind: str = "function") -> Symbol:
    return Symbol(
        id=symbol_id,
        kind=kind,
        path=path,
        name=name,
        line=line,
        end_line=end_line,
        signature=f"function {name}()",
        body=body or f"function {name}() {{}}",
    )


def _back_graph() -> Graph:
    nodes = {
        "b1": _symbol("b1", "login", "src/auth/auth.service.ts", 10, 20, "function login() { validateToken(); }"),
        "b2": _symbol("b2", "validateToken", "src/auth/token.ts", 5, 12),
        "b3": _symbol("b3", "logout", "src/auth/auth.service.ts", 30, 36),
        "bf": Symbol(
            id="src/auth/auth.service.ts",
            kind="file",
            path="src/auth/auth.service.ts",
            name="auth.service.ts",
            line=1,
            end_line=1,
            signature="src/auth/auth.service.ts",
        ),
    }
    edges = [
        Edge(from_id="b1", to_id="b2", kind="references"),
        Edge(from_id="b3", to_id="b2", kind="references"),
    ]
    endpoints = [
        HttpEndpoint(
            id="e1",
            role="provider",
            method="POST",
            route="auth/login",
            normalized_route="/auth/login",
            path="src/auth/auth.controller.ts",
            line=14,
            framework="nestjs",
            symbol_id="b1",
            symbol_name="login",
        )
    ]
    return Graph(nodes=nodes, edges=edges, endpoints=endpoints)


def _front_graph() -> Graph:
    nodes = {
        "f1": _symbol("f1", "signIn", "src/pages/LoginPage.tsx", 8, 18),
    }
    endpoints = [
        HttpEndpoint(
            id="e2",
            role="consumer",
            method="POST",
            route="/auth/login",
            normalized_route="/auth/login",
            path="src/pages/LoginPage.tsx",
            line=12,
            framework="axios",
            symbol_id="f1",
            symbol_name="signIn",
        )
    ]
    return Graph(nodes=nodes, endpoints=endpoints)


@pytest.fixture
def repo_executor() -> ToolExecutor:
    return ToolExecutor([RepoWorkspace("acme/back", "sha-back", _back_graph())])


@pytest.fixture
def project_executor() -> ToolExecutor:
    return ToolExecutor(
        [
            RepoWorkspace("acme/back", "sha-back", _back_graph()),
            RepoWorkspace("acme/front", "sha-front", _front_graph()),
        ],
        mode="project",
    )


def test_empty_workspace_is_rejected():
    with pytest.raises(ToolError):
        ToolExecutor([])


def test_cross_repo_links_hidden_in_repository_scope(repo_executor):
    assert "cross_repo_links" not in repo_executor.available_tools()
    with pytest.raises(ToolError, match="indisponível"):
        repo_executor.execute("cross_repo_links", {})


def test_cross_repo_links_exposed_in_project_scope(project_executor):
    assert "cross_repo_links" in project_executor.available_tools()
    assert len(project_executor.definitions()) == 7


def test_list_files_returns_distinct_paths(repo_executor):
    result = repo_executor.execute("list_files", {})
    paths = [item["path"] for item in result.items]
    assert paths == ["src/auth/auth.service.ts", "src/auth/token.ts"]
    assert all(item["repoId"] == "acme/back" for item in result.items)


def test_list_files_filters_by_prefix(repo_executor):
    result = repo_executor.execute("list_files", {"pathPrefix": "token"})
    assert [item["path"] for item in result.items] == ["src/auth/token.ts"]


def test_search_symbols_ranks_exact_match_first(repo_executor):
    result = repo_executor.execute("search_symbols", {"query": "login"})
    assert result.items[0]["name"] == "login"
    assert result.citations[0].symbolId == "b1"
    assert result.citations[0].repoId == "acme/back"


def test_search_symbols_skips_file_nodes(repo_executor):
    result = repo_executor.execute("search_symbols", {"query": "auth"})
    assert all(item["kind"] != "file" for item in result.items)


def test_search_symbols_without_query_raises(repo_executor):
    with pytest.raises(ToolError, match="query"):
        repo_executor.execute("search_symbols", {})


def test_search_symbols_reports_empty_result(repo_executor):
    result = repo_executor.execute("search_symbols", {"query": "inexistente"})
    assert result.items == []
    assert "nenhum símbolo" in result.note


def test_read_symbol_returns_body_and_citation(repo_executor):
    result = repo_executor.execute("read_symbol", {"symbolId": "b1"})
    assert "validateToken" in result.items[0]["body"]
    assert result.citations[0].line == 10


def test_read_symbol_unknown_id_is_a_note_not_an_error(repo_executor):
    result = repo_executor.execute("read_symbol", {"symbolId": "nope"})
    assert result.items == []
    assert "não existe" in result.note


def test_read_symbol_truncates_huge_body():
    graph = Graph(nodes={"x": _symbol("x", "huge", "src/x.ts", 1, 999, "a" * (MAX_BODY_CHARS + 500))})
    executor = ToolExecutor([RepoWorkspace("acme/back", "sha", graph)])
    result = executor.execute("read_symbol", {"symbolId": "x"})
    assert result.items[0]["bodyTruncated"] is True


def test_read_file_reassembles_symbols_in_line_order(repo_executor):
    result = repo_executor.execute("read_file", {"path": "src/auth/auth.service.ts"})
    content = result.items[0]["content"]
    assert content.index("function login") < content.index("function logout")
    assert "linhas omitidas" in content


def test_read_file_unknown_path_suggests_list_files(repo_executor):
    result = repo_executor.execute("read_file", {"path": "src/nope.ts"})
    assert result.items == []
    assert "list_files" in result.note


def test_neighbors_finds_callers_and_callees(repo_executor):
    callers = repo_executor.execute("neighbors", {"symbolId": "b2", "direction": "callers"})
    assert sorted(item["name"] for item in callers.items) == ["login", "logout"]

    callees = repo_executor.execute("neighbors", {"symbolId": "b1", "direction": "callees"})
    assert [item["name"] for item in callees.items] == ["validateToken"]


def test_neighbors_depth_two_walks_further(repo_executor):
    result = repo_executor.execute("neighbors", {"symbolId": "b1", "direction": "both", "depth": 2})
    names = {item["name"] for item in result.items}
    assert names == {"validateToken", "logout"}
    assert max(item["hops"] for item in result.items) == 2


def test_neighbors_rejects_bad_direction(repo_executor):
    with pytest.raises(ToolError, match="direction"):
        repo_executor.execute("neighbors", {"symbolId": "b1", "direction": "sideways"})


def test_list_endpoints_filters_by_role(repo_executor):
    result = repo_executor.execute("list_endpoints", {"role": "provider"})
    assert result.items[0]["route"] == "/auth/login"
    assert result.citations[0].path == "src/auth/auth.controller.ts"

    empty = repo_executor.execute("list_endpoints", {"role": "consumer"})
    assert empty.items == []
    assert empty.note is not None


def test_unknown_repo_id_lists_available_scope(project_executor):
    with pytest.raises(ToolError, match="acme/back"):
        project_executor.execute("list_files", {"repoId": "acme/outro"})


def test_project_scope_searches_every_repo(project_executor):
    result = project_executor.execute("search_symbols", {"query": "sign"})
    assert [item["repoId"] for item in result.items] == ["acme/front"]


def test_cross_repo_links_matches_method_and_route(project_executor):
    result = project_executor.execute("cross_repo_links", {})
    assert len(result.items) == 1
    link = result.items[0]
    assert link["method"] == "POST"
    assert link["route"] == "/auth/login"
    assert link["consumer"]["repoId"] == "acme/front"
    assert link["provider"]["repoId"] == "acme/back"


def test_cross_repo_links_ignores_same_repo_pairs():
    graph = _back_graph()
    graph.endpoints.append(
        HttpEndpoint(
            id="e3",
            role="consumer",
            method="POST",
            route="/auth/login",
            normalized_route="/auth/login",
            path="scripts/seed.ts",
            line=3,
            framework="axios",
        )
    )
    executor = ToolExecutor([RepoWorkspace("acme/back", "sha", graph)], mode="project")
    result = executor.execute("cross_repo_links", {})
    assert result.items == []


def test_large_result_is_truncated_with_note():
    nodes = {
        f"s{index}": _symbol(f"s{index}", f"handler{index}", f"src/f{index}.ts", 1, 5, "x" * 400)
        for index in range(200)
    }
    executor = ToolExecutor([RepoWorkspace("acme/back", "sha", Graph(nodes=nodes))])
    result = executor.execute("search_symbols", {"query": "handler", "limit": 50})
    assert result.truncated is True
    assert "omitido" in result.note
    assert len(result.items) < 50


def test_render_file_returns_none_without_symbols():
    assert render_file(Graph(), "src/nope.ts") is None


def test_render_file_skips_nested_symbols():
    nodes = {
        "c": Symbol(
            id="c",
            kind="class",
            path="src/a.ts",
            name="Service",
            line=1,
            end_line=20,
            signature="class Service",
            body="class Service { run() {} }",
        ),
        "m": Symbol(
            id="m",
            kind="method",
            path="src/a.ts",
            name="run",
            line=5,
            end_line=8,
            signature="run()",
            body="run() {}",
        ),
    }
    content = render_file(Graph(nodes=nodes), "src/a.ts")
    assert content == "class Service { run() {} }"
