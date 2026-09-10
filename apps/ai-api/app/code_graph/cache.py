from datetime import UTC, datetime

import redis.asyncio as aioredis
from neo4j import AsyncDriver, AsyncGraphDatabase

from app.code_graph.models import (
    Edge,
    EdgeKind,
    Graph,
    HttpEndpoint,
    ProjectEndpointEvidence,
    ProjectEndpointMatch,
    ProjectGraph,
    ProjectGraphEdge,
    ProjectGraphNode,
    ProjectGraphStats,
    ProjectRepositoryRef,
    Symbol,
)
from app.config.settings import NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER, REDIS_URL

LOCK_KEY_PREFIX = "idxlock"
LOCK_TTL_SECONDS = 300

EDGE_KINDS: tuple[EdgeKind, ...] = ("defines", "references", "imports", "tests")
RELATIONSHIP_TYPE_BY_KIND = {kind: kind.upper() for kind in EDGE_KINDS}

GRAPH_INDEXES = (
    "CREATE INDEX symbol_scope IF NOT EXISTS FOR (n:Symbol) ON (n.ownerId, n.repoId, n.sha)",
    "CREATE INDEX symbol_lookup IF NOT EXISTS FOR (n:Symbol) ON (n.ownerId, n.repoId, n.sha, n.id)",
    "CREATE INDEX endpoint_scope IF NOT EXISTS FOR (n:ApiEndpoint) ON (n.ownerId, n.repoId, n.sha)",
    "CREATE INDEX repoindex_scope IF NOT EXISTS FOR (n:RepoIndex) ON (n.ownerId, n.repoId)",
)


def _lock_key(owner_id: str, repo_id: str) -> str:
    """Lock por (dono, repositório) — NÃO por sha.

    Chavear por sha deixava duas builds do mesmo repositório em shas diferentes
    correrem em paralelo, e a limpeza de shas antigos de uma apagava o grafo que a
    outra acabara de escrever. Serializar por repositório é o que torna
    `build_and_store` seguro sob concorrência."""
    return f"{LOCK_KEY_PREFIX}:{owner_id}:{repo_id}"


def build_redis_client(redis_url: str = REDIS_URL) -> aioredis.Redis:
    return aioredis.from_url(redis_url)


def build_neo4j_driver() -> AsyncDriver:
    return AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


async def ensure_graph_indexes(driver: AsyncDriver) -> None:
    """Índices compostos que sustentam o escopo por dono.

    Sem eles toda policy de escopo vira varredura completa: `ownerId` entra em
    todo MATCH, então precisa estar na frente do índice."""
    async with driver.session() as session:
        for statement in GRAPH_INDEXES:
            await session.run(statement)


class IndexCache:
    """Grafo (o artefato durável e consultável — CGC-02) vive no Neo4j, escopado por
    `ownerId`/`repoId`/`sha` em propriedade de nó.

    Neo4j Community não tem RLS nem RBAC de granularidade fina (ambos Enterprise):
    o isolamento entre usuários é construído aqui, na propriedade `ownerId`, e
    reforçado na borda pelo backend Nest, que autoriza `owner/repo` contra o GitHub
    antes de qualquer chamada. `ownerId` é obrigatório em toda query — nunca dê
    default, porque um default silencioso vira vazamento entre tenants.

    O lock de build concorrente fica no Redis: é estado efêmero de coordenação com
    TTL, não dado que alguém deva consultar. Ver ADR Decisão A12."""

    def __init__(self, driver: AsyncDriver, redis_client: aioredis.Redis):
        self._driver = driver
        self._redis = redis_client

    async def build_and_store(self, repo_id: str, sha: str, graph: Graph, owner_id: str) -> None:
        """Ordem importa: limpa o alvo exato, escreve, aponta o RepoIndex, e só então
        descarta os shas antigos. O grafo anterior segue legível durante toda a
        escrita, e a virada é o MERGE do RepoIndex. A ordem antiga (apagar tudo do
        repo primeiro) deixava o repositório sem grafo por toda a duração do build."""
        symbols = [
            {
                "id": symbol.id,
                "kind": symbol.kind,
                "path": symbol.path,
                "name": symbol.name,
                "line": symbol.line,
                "endLine": symbol.end_line,
                "signature": symbol.signature,
                "body": symbol.body,
                "decorators": symbol.decorators,
                "contentHash": symbol.content_hash,
                "parentId": symbol.parent_id,
            }
            for symbol in graph.nodes.values()
        ]

        edges_by_kind: dict[EdgeKind, list[dict]] = {}
        for edge in graph.edges:
            edges_by_kind.setdefault(edge.kind, []).append(
                {"fromId": edge.from_id, "toId": edge.to_id, "weight": edge.weight}
            )

        endpoints = [
            {
                "id": endpoint.id,
                "role": endpoint.role,
                "method": endpoint.method,
                "route": endpoint.route,
                "normalizedRoute": endpoint.normalized_route,
                "path": endpoint.path,
                "line": endpoint.line,
                "framework": endpoint.framework,
                "evidenceType": endpoint.evidence_type,
                "symbolId": endpoint.symbol_id,
                "symbolName": endpoint.symbol_name,
            }
            for endpoint in graph.endpoints
        ]

        scope = {"ownerId": owner_id, "repoId": repo_id, "sha": sha}

        async with self._driver.session() as session:
            # Reconstrução idempotente do mesmo sha.
            await session.run(
                "MATCH (n:Symbol {ownerId: $ownerId, repoId: $repoId, sha: $sha}) DETACH DELETE n",
                **scope,
            )
            await session.run(
                "MATCH (n:ApiEndpoint {ownerId: $ownerId, repoId: $repoId, sha: $sha}) DETACH DELETE n",
                **scope,
            )

            if symbols:
                await session.run(
                    """
                    UNWIND $symbols AS s
                    CREATE (n:Symbol {
                        id: s.id, ownerId: $ownerId, repoId: $repoId, sha: $sha,
                        kind: s.kind, path: s.path, name: s.name, line: s.line,
                        endLine: s.endLine, signature: s.signature, body: s.body,
                        decorators: s.decorators, contentHash: s.contentHash,
                        parentId: s.parentId
                    })
                    """,
                    symbols=symbols,
                    **scope,
                )

            for kind, rows in edges_by_kind.items():
                # `rel_type` vem do dicionário fixo RELATIONSHIP_TYPE_BY_KIND, nunca
                # de entrada externa: tipo de relacionamento não é parametrizável em
                # Cypher, então essa é a única interpolação permitida no arquivo.
                rel_type = RELATIONSHIP_TYPE_BY_KIND[kind]
                await session.run(
                    f"""
                    UNWIND $edges AS e
                    MATCH (a:Symbol {{id: e.fromId, ownerId: $ownerId, repoId: $repoId, sha: $sha}}),
                          (b:Symbol {{id: e.toId, ownerId: $ownerId, repoId: $repoId, sha: $sha}})
                    CREATE (a)-[:{rel_type} {{weight: e.weight}}]->(b)
                    """,
                    edges=rows,
                    **scope,
                )

            if endpoints:
                await session.run(
                    """
                    UNWIND $endpoints AS e
                    CREATE (n:ApiEndpoint {
                        id: e.id, ownerId: $ownerId, repoId: $repoId, sha: $sha,
                        role: e.role, method: e.method, route: e.route,
                        normalizedRoute: e.normalizedRoute, path: e.path, line: e.line,
                        framework: e.framework, evidenceType: e.evidenceType,
                        symbolId: e.symbolId, symbolName: e.symbolName
                    })
                    """,
                    endpoints=endpoints,
                    **scope,
                )

            await session.run(
                """
                MERGE (r:RepoIndex {ownerId: $ownerId, repoId: $repoId})
                SET r.sha = $sha, r.indexedAt = $indexedAt
                """,
                indexedAt=datetime.now(UTC).isoformat(),
                **scope,
            )

            # Um repositório tem um grafo corrente, não um por commit já indexado.
            await session.run(
                """
                MATCH (n:Symbol {ownerId: $ownerId, repoId: $repoId})
                WHERE n.sha <> $sha
                DETACH DELETE n
                """,
                **scope,
            )
            await session.run(
                """
                MATCH (n:ApiEndpoint {ownerId: $ownerId, repoId: $repoId})
                WHERE n.sha <> $sha
                DETACH DELETE n
                """,
                **scope,
            )

    async def get_latest_sha(self, repo_id: str, owner_id: str) -> str | None:
        async with self._driver.session() as session:
            result = await session.run(
                "MATCH (r:RepoIndex {ownerId: $ownerId, repoId: $repoId}) RETURN r.sha AS sha",
                ownerId=owner_id,
                repoId=repo_id,
            )
            record = await result.single()
            return record["sha"] if record else None

    async def list_repositories(
        self,
        owner_id: str,
        query: str | None,
        limit: int,
        cursor: str | None,
    ) -> tuple[list[dict[str, str]], str | None]:
        try:
            offset = max(0, int(cursor or "0"))
        except ValueError:
            offset = 0

        normalized_query = query.strip().lower() if query and query.strip() else None
        async with self._driver.session() as session:
            result = await session.run(
                """
                MATCH (r:RepoIndex {ownerId: $ownerId})
                WHERE $searchQuery IS NULL OR toLower(r.repoId) CONTAINS $searchQuery
                RETURN r.repoId AS repoId, r.sha AS sha
                ORDER BY r.repoId
                SKIP $offset
                LIMIT $fetchLimit
                """,
                ownerId=owner_id,
                searchQuery=normalized_query,
                offset=offset,
                fetchLimit=limit + 1,
            )
            records = [record async for record in result]

        page = [
            {"repoId": record["repoId"], "sha": record["sha"]}
            for record in records[:limit]
        ]
        next_cursor = str(offset + limit) if len(records) > limit else None
        return page, next_cursor

    async def lookup(self, repo_id: str, sha: str, owner_id: str) -> Graph | None:
        scope = {"ownerId": owner_id, "repoId": repo_id, "sha": sha}
        async with self._driver.session() as session:
            node_result = await session.run(
                "MATCH (n:Symbol {ownerId: $ownerId, repoId: $repoId, sha: $sha}) RETURN n",
                **scope,
            )
            nodes: dict[str, Symbol] = {}
            async for record in node_result:
                props = dict(record["n"])
                nodes[props["id"]] = Symbol(
                    id=props["id"],
                    kind=props["kind"],
                    path=props["path"],
                    name=props["name"],
                    line=props["line"],
                    end_line=props["endLine"],
                    signature=props["signature"],
                    body=props.get("body", ""),
                    decorators=list(props.get("decorators", [])),
                    content_hash=props.get("contentHash", ""),
                    parent_id=props.get("parentId"),
                )
            if not nodes:
                return None

            edge_result = await session.run(
                """
                MATCH (a:Symbol {ownerId: $ownerId, repoId: $repoId, sha: $sha})
                      -[r]->
                      (b:Symbol {ownerId: $ownerId, repoId: $repoId, sha: $sha})
                RETURN a.id AS fromId, b.id AS toId, type(r) AS relType, r.weight AS weight
                """,
                **scope,
            )
            edges = [
                Edge(from_id=rec["fromId"], to_id=rec["toId"], kind=rec["relType"].lower(), weight=rec["weight"])
                async for rec in edge_result
            ]

            endpoints = await self._list_endpoints_in_session(session, repo_id, sha, owner_id)
            return Graph(nodes=nodes, edges=edges, endpoints=endpoints)

    async def _list_endpoints_in_session(
        self, session, repo_id: str, sha: str, owner_id: str
    ) -> list[HttpEndpoint]:
        result = await session.run(
            """
            MATCH (e:ApiEndpoint {ownerId: $ownerId, repoId: $repoId, sha: $sha})
            RETURN e
            ORDER BY e.path, e.line, e.role, e.method
            """,
            ownerId=owner_id,
            repoId=repo_id,
            sha=sha,
        )
        endpoints: list[HttpEndpoint] = []
        async for record in result:
            props = dict(record["e"])
            endpoints.append(
                HttpEndpoint(
                    id=props["id"],
                    role=props["role"],
                    method=props["method"],
                    route=props["route"],
                    normalized_route=props["normalizedRoute"],
                    path=props["path"],
                    line=props["line"],
                    framework=props["framework"],
                    evidence_type=props.get("evidenceType", "method_route"),
                    symbol_id=props.get("symbolId"),
                    symbol_name=props.get("symbolName"),
                )
            )
        return endpoints

    async def list_endpoints(self, repo_id: str, sha: str, owner_id: str) -> list[HttpEndpoint]:
        async with self._driver.session() as session:
            return await self._list_endpoints_in_session(session, repo_id, sha, owner_id)

    async def materialize_project_graph(
        self,
        project_id: str,
        repositories: list[ProjectRepositoryRef],
        owner_id: str,
    ) -> ProjectGraph:
        refs = [repo.model_dump() for repo in repositories if repo.sha]
        async with self._driver.session() as session:
            await session.run(
                "MATCH ()-[r:CONSUMES {projectId: $projectId, ownerId: $ownerId}]->() DELETE r",
                projectId=project_id,
                ownerId=owner_id,
            )

            if refs:
                await session.run(
                    """
                    UNWIND $repositories AS consumerRef
                    MATCH (consumer:ApiEndpoint {
                        ownerId: $ownerId,
                        repoId: consumerRef.repoId,
                        sha: consumerRef.sha,
                        role: 'consumer'
                    })
                    UNWIND $repositories AS providerRef
                    MATCH (provider:ApiEndpoint {
                        ownerId: $ownerId,
                        repoId: providerRef.repoId,
                        sha: providerRef.sha,
                        role: 'provider'
                    })
                    WHERE consumer.repoId <> provider.repoId
                      AND consumer.method = provider.method
                      AND consumer.normalizedRoute = provider.normalizedRoute
                    MERGE (consumer)-[r:CONSUMES {projectId: $projectId, ownerId: $ownerId}]->(provider)
                    SET r.confidence = 'confirmed', r.evidenceType = 'method_route'
                    """,
                    repositories=refs,
                    projectId=project_id,
                    ownerId=owner_id,
                )

            result = await session.run(
                """
                MATCH (consumer:ApiEndpoint)-[r:CONSUMES {projectId: $projectId, ownerId: $ownerId}]->(provider:ApiEndpoint)
                RETURN consumer, provider
                ORDER BY consumer.repoId, provider.repoId, consumer.method, consumer.normalizedRoute
                """,
                projectId=project_id,
                ownerId=owner_id,
            )
            records = [record async for record in result]

        nodes = [
            ProjectGraphNode(
                id=f"repo::{repo.repoId}",
                repoId=repo.repoId,
                label=repo.repoId.split("/")[-1],
                indexed=repo.sha is not None,
                sha=repo.sha,
            )
            for repo in repositories
        ]

        grouped: dict[tuple[str, str], list[ProjectEndpointMatch]] = {}
        endpoint_ids: set[tuple[str, str, str]] = set()
        for record in records:
            consumer = dict(record["consumer"])
            provider = dict(record["provider"])
            key = (consumer["repoId"], provider["repoId"])
            endpoint_ids.add((consumer["repoId"], consumer["sha"], consumer["id"]))
            endpoint_ids.add((provider["repoId"], provider["sha"], provider["id"]))
            grouped.setdefault(key, []).append(
                ProjectEndpointMatch(
                    method=consumer["method"],
                    route=consumer["normalizedRoute"],
                    consumer=self._project_evidence(consumer),
                    provider=self._project_evidence(provider),
                )
            )

        edges = [
            ProjectGraphEdge(
                id=f"consumes::{source}::{target}",
                source=f"repo::{source}",
                target=f"repo::{target}",
                count=len(matches),
                matches=matches,
            )
            for (source, target), matches in grouped.items()
        ]
        return ProjectGraph(
            nodes=nodes,
            edges=edges,
            stats=ProjectGraphStats(
                repositories=len(repositories),
                indexedRepositories=sum(repo.sha is not None for repo in repositories),
                links=len(edges),
                endpoints=len(endpoint_ids),
            ),
        )

    @staticmethod
    def _project_evidence(endpoint: dict) -> ProjectEndpointEvidence:
        return ProjectEndpointEvidence(
            repoId=endpoint["repoId"],
            path=endpoint["path"],
            line=endpoint["line"],
            sha=endpoint["sha"],
            symbolId=endpoint.get("symbolId"),
            symbolName=endpoint.get("symbolName"),
            framework=endpoint["framework"],
        )

    async def acquire_lock(self, repo_id: str, owner_id: str) -> bool:
        acquired = await self._redis.set(
            _lock_key(owner_id, repo_id), "1", nx=True, ex=LOCK_TTL_SECONDS
        )
        return bool(acquired)

    async def release_lock(self, repo_id: str, owner_id: str) -> None:
        await self._redis.delete(_lock_key(owner_id, repo_id))
