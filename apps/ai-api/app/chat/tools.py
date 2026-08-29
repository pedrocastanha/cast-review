import json
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from app.chat.catalog import CatalogError
from app.chat.models import Citation, ToolResult
from app.code_graph.file_view import distinct_paths, render_file
from app.code_graph.models import Graph, Symbol

MAX_RESULT_CHARS = 6000
MAX_BODY_CHARS = 4000
MAX_DEPTH = 2
PROJECT_ONLY_TOOLS = {"cross_repo_links"}


class ToolError(Exception):
    pass


@dataclass(frozen=True)
class RepoWorkspace:
    repo_id: str
    sha: str
    graph: Graph


def _truncate_body(body: str) -> tuple[str, bool]:
    if len(body) <= MAX_BODY_CHARS:
        return body, False
    return body[:MAX_BODY_CHARS] + "\n… (corpo truncado)", True


def _symbol_item(repo_id: str, symbol: Symbol, *, with_body: bool = False) -> dict[str, Any]:
    item: dict[str, Any] = {
        "repoId": repo_id,
        "symbolId": symbol.id,
        "name": symbol.name,
        "kind": symbol.kind,
        "path": symbol.path,
        "line": symbol.line,
        "endLine": symbol.end_line,
        "signature": symbol.signature,
    }
    if with_body:
        body, truncated = _truncate_body(symbol.body)
        item["body"] = body
        if truncated:
            item["bodyTruncated"] = True
    return item


def _symbol_citation(repo_id: str, symbol: Symbol) -> Citation:
    return Citation(
        repoId=repo_id,
        path=symbol.path,
        line=symbol.line,
        symbolId=symbol.id,
        symbolName=symbol.name,
    )


def _fit(result: ToolResult) -> ToolResult:
    encoded = json.dumps([item for item in result.items], ensure_ascii=False)
    if len(encoded) <= MAX_RESULT_CHARS:
        return result

    kept: list[dict[str, Any]] = []
    size = 2
    for item in result.items:
        chunk = len(json.dumps(item, ensure_ascii=False)) + 1
        if size + chunk > MAX_RESULT_CHARS:
            break
        kept.append(item)
        size += chunk

    omitted = len(result.items) - len(kept)
    note = f"{omitted} item(ns) omitido(s) por limite de tamanho"
    return ToolResult(
        items=kept,
        citations=result.citations[: len(kept)] if result.citations else [],
        truncated=True,
        note=f"{result.note} | {note}" if result.note else note,
    )


def _score(symbol: Symbol, needle: str) -> float:
    name = symbol.name.lower()
    if name == needle:
        return 3.0
    if name.startswith(needle):
        return 2.0
    if needle in name:
        return 1.0
    if needle in symbol.signature.lower():
        return 0.5
    return 0.0


class ToolExecutor:
    def __init__(
        self,
        workspaces: list[RepoWorkspace],
        *,
        mode: str = "repository",
    ) -> None:
        if not workspaces:
            raise ToolError("nenhum repositório indexado no escopo")
        self.workspaces = workspaces
        self.mode = mode
        self._by_repo = {workspace.repo_id: workspace for workspace in workspaces}

    def available_tools(self) -> list[str]:
        names = [
            "list_files",
            "search_symbols",
            "read_symbol",
            "read_file",
            "neighbors",
            "list_endpoints",
        ]
        if self.mode == "project":
            names.append("cross_repo_links")
        return names

    def definitions(self) -> list[dict[str, Any]]:
        return [TOOL_SCHEMAS[name] for name in self.available_tools()]

    def _resolve(self, repo_id: str | None) -> list[RepoWorkspace]:
        if not repo_id:
            return list(self.workspaces)
        workspace = self._by_repo.get(repo_id)
        if workspace is None:
            known = ", ".join(sorted(self._by_repo))
            raise ToolError(f"repositório '{repo_id}' não está no escopo. Disponíveis: {known}")
        return [workspace]

    def execute(self, name: str, args: dict[str, Any]) -> ToolResult:
        if name not in self.available_tools():
            raise ToolError(f"ferramenta '{name}' indisponível neste escopo")
        handler = getattr(self, f"_tool_{name}")
        return _fit(handler(args))

    async def execute_async(self, name: str, args: dict[str, Any]) -> ToolResult:
        return self.execute(name, args)

    def _tool_list_files(self, args: dict[str, Any]) -> ToolResult:
        limit = min(int(args.get("limit") or 100), 300)
        prefix = args.get("pathPrefix") or None
        items: list[dict[str, Any]] = []
        for workspace in self._resolve(args.get("repoId")):
            for path in distinct_paths(workspace.graph, prefix, limit):
                items.append({"repoId": workspace.repo_id, "path": path})
        return ToolResult(items=items[:limit])

    def _tool_search_symbols(self, args: dict[str, Any]) -> ToolResult:
        query = str(args.get("query") or "").strip()
        if not query:
            raise ToolError("search_symbols exige 'query'")
        needle = query.lower()
        kind = args.get("kind") or None
        limit = min(int(args.get("limit") or 20), 50)

        scored: list[tuple[float, str, RepoWorkspace, Symbol]] = []
        for workspace in self._resolve(args.get("repoId")):
            for symbol in workspace.graph.nodes.values():
                if symbol.kind == "file":
                    continue
                if kind and symbol.kind != kind:
                    continue
                score = _score(symbol, needle)
                if score > 0:
                    scored.append((score, symbol.path, workspace, symbol))

        scored.sort(key=lambda entry: (-entry[0], entry[1], entry[3].line))
        selected = scored[:limit]
        return ToolResult(
            items=[_symbol_item(workspace.repo_id, symbol) for _, _, workspace, symbol in selected],
            citations=[_symbol_citation(workspace.repo_id, symbol) for _, _, workspace, symbol in selected],
            note=None if selected else f"nenhum símbolo encontrado para '{query}'",
        )

    def _tool_read_symbol(self, args: dict[str, Any]) -> ToolResult:
        symbol_id = str(args.get("symbolId") or "").strip()
        if not symbol_id:
            raise ToolError("read_symbol exige 'symbolId'")
        for workspace in self._resolve(args.get("repoId")):
            symbol = workspace.graph.nodes.get(symbol_id)
            if symbol is not None:
                return ToolResult(
                    items=[_symbol_item(workspace.repo_id, symbol, with_body=True)],
                    citations=[_symbol_citation(workspace.repo_id, symbol)],
                )
        return ToolResult(note=f"símbolo '{symbol_id}' não existe no índice")

    def _tool_read_file(self, args: dict[str, Any]) -> ToolResult:
        path = str(args.get("path") or "").strip()
        if not path:
            raise ToolError("read_file exige 'path'")
        for workspace in self._resolve(args.get("repoId")):
            content = render_file(workspace.graph, path)
            if content is None:
                continue
            body, truncated = _truncate_body(content)
            return ToolResult(
                items=[{"repoId": workspace.repo_id, "path": path, "content": body}],
                citations=[Citation(repoId=workspace.repo_id, path=path, line=1)],
                truncated=truncated,
            )
        return ToolResult(
            note=(
                f"'{path}' não tem símbolo indexado. "
                "Use list_files para conferir o caminho, ou peça ao usuário para mencionar o arquivo."
            )
        )

    def _tool_neighbors(self, args: dict[str, Any]) -> ToolResult:
        symbol_id = str(args.get("symbolId") or "").strip()
        if not symbol_id:
            raise ToolError("neighbors exige 'symbolId'")
        direction = args.get("direction") or "both"
        if direction not in {"callers", "callees", "both"}:
            raise ToolError("direction deve ser callers, callees ou both")
        depth = max(1, min(int(args.get("depth") or 1), MAX_DEPTH))

        for workspace in self._resolve(args.get("repoId")):
            if symbol_id not in workspace.graph.nodes:
                continue
            found = self._walk(workspace, symbol_id, direction, depth)
            items = [
                {**_symbol_item(workspace.repo_id, symbol), "relation": relation, "hops": hops}
                for symbol, relation, hops in found
            ]
            return ToolResult(
                items=items,
                citations=[_symbol_citation(workspace.repo_id, symbol) for symbol, _, _ in found],
                note=None if found else "nenhum vizinho encontrado",
            )
        return ToolResult(note=f"símbolo '{symbol_id}' não existe no índice")

    @staticmethod
    def _walk(
        workspace: RepoWorkspace,
        symbol_id: str,
        direction: str,
        depth: int,
    ) -> list[tuple[Symbol, str, int]]:
        graph = workspace.graph
        seen = {symbol_id}
        found: list[tuple[Symbol, str, int]] = []
        frontier = {symbol_id}
        for hop in range(1, depth + 1):
            next_frontier: set[str] = set()
            for edge in graph.edges:
                if direction in {"callees", "both"} and edge.from_id in frontier:
                    target, relation = edge.to_id, "callee"
                elif direction in {"callers", "both"} and edge.to_id in frontier:
                    target, relation = edge.from_id, "caller"
                else:
                    continue
                if target in seen:
                    continue
                symbol = graph.nodes.get(target)
                if symbol is None or symbol.kind == "file":
                    continue
                seen.add(target)
                next_frontier.add(target)
                found.append((symbol, relation, hop))
            frontier = next_frontier
            if not frontier:
                break
        return found

    def _tool_list_endpoints(self, args: dict[str, Any]) -> ToolResult:
        role = args.get("role") or None
        contains = str(args.get("routeContains") or "").lower()
        items: list[dict[str, Any]] = []
        citations: list[Citation] = []
        for workspace in self._resolve(args.get("repoId")):
            for endpoint in workspace.graph.endpoints:
                if role and endpoint.role != role:
                    continue
                if contains and contains not in endpoint.normalized_route.lower():
                    continue
                items.append(
                    {
                        "repoId": workspace.repo_id,
                        "role": endpoint.role,
                        "method": endpoint.method,
                        "route": endpoint.normalized_route,
                        "framework": endpoint.framework,
                        "path": endpoint.path,
                        "line": endpoint.line,
                        "symbolName": endpoint.symbol_name,
                    }
                )
                citations.append(
                    Citation(
                        repoId=workspace.repo_id,
                        path=endpoint.path,
                        line=endpoint.line,
                        symbolId=endpoint.symbol_id,
                        symbolName=endpoint.symbol_name,
                    )
                )
        return ToolResult(
            items=items,
            citations=citations,
            note=None if items else "nenhum endpoint corresponde ao filtro",
        )

    def _tool_cross_repo_links(self, _: dict[str, Any]) -> ToolResult:
        consumers = [
            (workspace, endpoint)
            for workspace in self.workspaces
            for endpoint in workspace.graph.endpoints
            if endpoint.role == "consumer"
        ]
        providers = [
            (workspace, endpoint)
            for workspace in self.workspaces
            for endpoint in workspace.graph.endpoints
            if endpoint.role == "provider"
        ]

        items: list[dict[str, Any]] = []
        citations: list[Citation] = []
        for consumer_workspace, consumer in consumers:
            for provider_workspace, provider in providers:
                if consumer_workspace.repo_id == provider_workspace.repo_id:
                    continue
                if consumer.method != provider.method:
                    continue
                if consumer.normalized_route != provider.normalized_route:
                    continue
                items.append(
                    {
                        "method": consumer.method,
                        "route": consumer.normalized_route,
                        "consumer": {
                            "repoId": consumer_workspace.repo_id,
                            "path": consumer.path,
                            "line": consumer.line,
                        },
                        "provider": {
                            "repoId": provider_workspace.repo_id,
                            "path": provider.path,
                            "line": provider.line,
                        },
                    }
                )
                citations.append(
                    Citation(
                        repoId=consumer_workspace.repo_id,
                        path=consumer.path,
                        line=consumer.line,
                        symbolId=consumer.symbol_id,
                        symbolName=consumer.symbol_name,
                    )
                )
        return ToolResult(
            items=items,
            citations=citations,
            note=None if items else "nenhuma ligação HTTP confirmada entre os repositórios do escopo",
        )


class GlobalToolExecutor:
    def __init__(self, cache, catalog, *, max_workspaces: int = 3) -> None:
        self._cache = cache
        self._catalog = catalog
        self._max_workspaces = max(1, max_workspaces)
        self._workspaces: OrderedDict[str, RepoWorkspace] = OrderedDict()

    @property
    def workspaces(self) -> list[RepoWorkspace]:
        return list(self._workspaces.values())

    def available_tools(self) -> list[str]:
        return [
            "list_indexed_repositories",
            "list_files",
            "search_symbols",
            "read_symbol",
            "read_file",
            "neighbors",
            "list_endpoints",
        ]

    def definitions(self) -> list[dict[str, Any]]:
        definitions: list[dict[str, Any]] = []
        for name in self.available_tools():
            definition = deepcopy(TOOL_SCHEMAS[name])
            if name != "list_indexed_repositories":
                required = definition["function"]["parameters"]["required"]
                if "repoId" not in required:
                    required.append("repoId")
            definitions.append(definition)
        return definitions

    async def execute_async(self, name: str, args: dict[str, Any]) -> ToolResult:
        if name not in self.available_tools():
            raise ToolError(f"ferramenta '{name}' indisponível neste escopo")
        if name == "list_indexed_repositories":
            return await self._list_repositories(args)

        repo_id = str(args.get("repoId") or "").strip()
        if not repo_id:
            raise ToolError(f"{name} exige 'repoId' no chat global")
        workspace = await self._workspace(repo_id)
        executor = ToolExecutor([workspace])
        return executor.execute(name, args)

    async def _list_repositories(self, args: dict[str, Any]) -> ToolResult:
        try:
            limit = max(1, min(int(args.get("limit") or 20), 20))
        except (TypeError, ValueError) as exc:
            raise ToolError("limit deve ser um número inteiro") from exc
        try:
            payload = await self._catalog.list(
                query=str(args.get("query") or "").strip() or None,
                limit=limit,
                cursor=str(args.get("cursor") or "").strip() or None,
            )
        except CatalogError as exc:
            raise ToolError(str(exc)) from exc
        repositories = payload.get("repositories")
        if not isinstance(repositories, list):
            raise ToolError("catálogo de repositórios retornou dados inválidos")
        items = [
            {
                "repoId": item.get("repoId"),
                "stale": bool(item.get("stale")),
            }
            for item in repositories[:limit]
            if isinstance(item, dict) and item.get("repoId")
        ]
        next_cursor = payload.get("nextCursor")
        return ToolResult(
            items=items,
            truncated=bool(next_cursor),
            note=f"próximo cursor: {next_cursor}" if next_cursor else None,
        )

    async def _workspace(self, repo_id: str) -> RepoWorkspace:
        cached = self._workspaces.pop(repo_id, None)
        if cached is not None:
            self._workspaces[repo_id] = cached
            return cached

        try:
            entry = await self._catalog.resolve(repo_id)
        except CatalogError as exc:
            raise ToolError(str(exc)) from exc
        canonical_repo_id = str(entry.get("repoId") or "").strip()
        sha = str(entry.get("sha") or "").strip()
        if not canonical_repo_id or not sha:
            raise ToolError(f"repositório '{repo_id}' não está indexado ou acessível")
        graph = await self._cache.lookup(canonical_repo_id, sha)
        if graph is None:
            raise ToolError(f"índice de '{canonical_repo_id}' não está disponível")

        workspace = RepoWorkspace(canonical_repo_id, sha, graph)
        self._workspaces[repo_id] = workspace
        while len(self._workspaces) > self._max_workspaces:
            self._workspaces.popitem(last=False)
        return workspace


def _function(name: str, description: str, properties: dict, required: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


_REPO_ID = {
    "type": "string",
    "description": "Repositório no formato owner/repo. Omita para buscar em todos os do escopo.",
}

TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "list_indexed_repositories": _function(
        "list_indexed_repositories",
        "Lista sob demanda apenas repositórios indexados e acessíveis ao usuário. Use quando o repositório não estiver explícito ou para descobrir o repoId exato.",
        {
            "query": {
                "type": "string",
                "description": "Trecho de owner/repo para filtrar. Omita para listar a primeira página.",
            },
            "limit": {"type": "integer", "description": "Máximo de 20 resultados."},
            "cursor": {
                "type": "string",
                "description": "Cursor informado pelo resultado anterior.",
            },
        },
        [],
    ),
    "list_files": _function(
        "list_files",
        "Lista caminhos de arquivos presentes no índice. Use para descobrir a estrutura antes de afirmar que algo não existe.",
        {
            "repoId": _REPO_ID,
            "pathPrefix": {"type": "string", "description": "Filtra por substring do caminho."},
            "limit": {"type": "integer", "description": "Máximo de caminhos (padrão 100)."},
        },
        [],
    ),
    "search_symbols": _function(
        "search_symbols",
        "Busca funções, classes e métodos por nome ou assinatura. Ponto de partida para qualquer pergunta aberta.",
        {
            "query": {"type": "string", "description": "Termo buscado no nome ou na assinatura."},
            "repoId": _REPO_ID,
            "kind": {
                "type": "string",
                "enum": ["function", "class", "method"],
                "description": "Filtra por tipo de símbolo.",
            },
            "limit": {"type": "integer", "description": "Máximo de símbolos (padrão 20)."},
        },
        ["query"],
    ),
    "read_symbol": _function(
        "read_symbol",
        "Lê o corpo completo de um símbolo pelo symbolId devolvido por search_symbols ou neighbors.",
        {"symbolId": {"type": "string"}, "repoId": _REPO_ID},
        ["symbolId"],
    ),
    "read_file": _function(
        "read_file",
        "Lê um arquivo remontado a partir dos símbolos indexados. Trechos sem símbolo aparecem como lacuna.",
        {"path": {"type": "string", "description": "Caminho exato do arquivo."}, "repoId": _REPO_ID},
        ["path"],
    ),
    "neighbors": _function(
        "neighbors",
        "Lista quem chama um símbolo (callers) e o que ele chama (callees). Use para impacto de mudança.",
        {
            "symbolId": {"type": "string"},
            "repoId": _REPO_ID,
            "direction": {"type": "string", "enum": ["callers", "callees", "both"]},
            "depth": {"type": "integer", "description": "1 ou 2 saltos (padrão 1)."},
        },
        ["symbolId"],
    ),
    "list_endpoints": _function(
        "list_endpoints",
        "Lista endpoints HTTP do índice: provider (rota servida) e consumer (chamada feita).",
        {
            "repoId": _REPO_ID,
            "role": {"type": "string", "enum": ["provider", "consumer"]},
            "routeContains": {"type": "string", "description": "Filtra por substring da rota."},
        },
        [],
    ),
    "cross_repo_links": _function(
        "cross_repo_links",
        "Lista ligações HTTP confirmadas entre repositórios do projeto: consumer de um repo casando com provider de outro.",
        {},
        [],
    ),
}
