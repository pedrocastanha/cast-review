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


def _lock_key(repo_id: str, sha: str) -> str:
    return f"{LOCK_KEY_PREFIX}:{repo_id}:{sha}"


def build_redis_client(redis_url: str = REDIS_URL) -> aioredis.Redis:
    return aioredis.from_url(redis_url)


def build_neo4j_driver() -> AsyncDriver:
    return AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


class IndexCache:
    """Graph data (the durable, queryable artifact — CGC-02) lives in Neo4j, scoped per
    repo@sha via `repoId`/`sha` node properties (no multi-tenancy at the database level —
    one graph database, every repo's nodes tagged and filtered by property). The
    concurrent-build lock stays in Redis: it's ephemeral coordination state with a TTL,
    not data anyone should ever query — Redis is the right tool for that, Neo4j is the
    right tool for the graph itself. See ADR Decisão A12."""

    def __init__(self, driver: AsyncDriver, redis_client: aioredis.Redis):
        self._driver = driver
        self._redis = redis_client

    async def build_and_store(self, repo_id: str, sha: str, graph: Graph) -> None:
        async with self._driver.session() as session:
            await session.run(
                """
                MATCH (n)
                WHERE n.repoId = $repoId AND (n:Symbol OR n:ApiEndpoint)
                DETACH DELETE n
                """,
                repoId=repo_id,
            )
            for symbol in graph.nodes.values():
                await session.run(
                    """
                    CREATE (n:Symbol {
                        id: $id, repoId: $repoId, sha: $sha, kind: $kind, path: $path,
                        name: $name, line: $line, endLine: $endLine, signature: $signature,
                        body: $body, decorators: $decorators, contentHash: $contentHash,
                        parentId: $parentId
                    })
                    """,
                    id=symbol.id,
                    repoId=repo_id,
                    sha=sha,
                    kind=symbol.kind,
                    path=symbol.path,
                    name=symbol.name,
                    line=symbol.line,
                    endLine=symbol.end_line,
                    signature=symbol.signature,
                    body=symbol.body,
                    decorators=symbol.decorators,
                    contentHash=symbol.content_hash,
                    parentId=symbol.parent_id,
                )
            for edge in graph.edges:
                rel_type = RELATIONSHIP_TYPE_BY_KIND[edge.kind]
                await session.run(
                    f"""
                    MATCH (a:Symbol {{id: $fromId, repoId: $repoId, sha: $sha}}),
                          (b:Symbol {{id: $toId, repoId: $repoId, sha: $sha}})
                    CREATE (a)-[:{rel_type} {{weight: $weight}}]->(b)
                    """,
                    fromId=edge.from_id,
                    toId=edge.to_id,
                    repoId=repo_id,
                    sha=sha,
                    weight=edge.weight,
                )

            for endpoint in graph.endpoints:
                await session.run(
                    """
                    CREATE (e:ApiEndpoint {
                        id: $id, repoId: $repoId, sha: $sha, role: $role,
                        method: $method, route: $route, normalizedRoute: $normalizedRoute,
                        path: $path, line: $line, framework: $framework,
                        evidenceType: $evidenceType, symbolId: $symbolId,
                        symbolName: $symbolName
                    })
                    """,
                    id=endpoint.id,
                    repoId=repo_id,
                    sha=sha,
                    role=endpoint.role,
                    method=endpoint.method,
                    route=endpoint.route,
                    normalizedRoute=endpoint.normalized_route,
                    path=endpoint.path,
                    line=endpoint.line,
                    framework=endpoint.framework,
                    evidenceType=endpoint.evidence_type,
                    symbolId=endpoint.symbol_id,
                    symbolName=endpoint.symbol_name,
                )

            await session.run(
                """
                MERGE (r:RepoIndex {repoId: $repoId})
                SET r.sha = $sha, r.indexedAt = $indexedAt
                """,
                repoId=repo_id,
                sha=sha,
                indexedAt=datetime.now(UTC).isoformat(),
            )

    async def get_latest_sha(self, repo_id: str) -> str | None:
        async with self._driver.session() as session:
            result = await session.run(
                "MATCH (r:RepoIndex {repoId: $repoId}) RETURN r.sha AS sha",
                repoId=repo_id,
            )
            record = await result.single()
            return record["sha"] if record else None

    async def list_repositories(
        self,
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
                MATCH (r:RepoIndex)
                WHERE $query IS NULL OR toLower(r.repoId) CONTAINS $query
                RETURN r.repoId AS repoId, r.sha AS sha
                ORDER BY r.repoId
                SKIP $offset
                LIMIT $fetchLimit
                """,
                query=normalized_query,
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

    async def lookup(self, repo_id: str, sha: str) -> Graph | None:
        async with self._driver.session() as session:
            node_result = await session.run(
                "MATCH (n:Symbol {repoId: $repoId, sha: $sha}) RETURN n",
                repoId=repo_id,
                sha=sha,
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
                MATCH (a:Symbol {repoId: $repoId, sha: $sha})-[r]->(b:Symbol {repoId: $repoId, sha: $sha})
                RETURN a.id AS fromId, b.id AS toId, type(r) AS relType, r.weight AS weight
                """,
                repoId=repo_id,
                sha=sha,
            )
            edges = [
                Edge(from_id=rec["fromId"], to_id=rec["toId"], kind=rec["relType"].lower(), weight=rec["weight"])
                async for rec in edge_result
            ]

            endpoints = await self._list_endpoints_in_session(session, repo_id, sha)
            return Graph(nodes=nodes, edges=edges, endpoints=endpoints)

    async def _list_endpoints_in_session(self, session, repo_id: str, sha: str) -> list[HttpEndpoint]:
        result = await session.run(
            """
            MATCH (e:ApiEndpoint {repoId: $repoId, sha: $sha})
            RETURN e
            ORDER BY e.path, e.line, e.role, e.method
            """,
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

    async def list_endpoints(self, repo_id: str, sha: str) -> list[HttpEndpoint]:
        async with self._driver.session() as session:
            return await self._list_endpoints_in_session(session, repo_id, sha)

    async def materialize_project_graph(
        self,
        project_id: str,
        repositories: list[ProjectRepositoryRef],
    ) -> ProjectGraph:
        refs = [repo.model_dump() for repo in repositories if repo.sha]
        async with self._driver.session() as session:
            await session.run(
                "MATCH ()-[r:CONSUMES {projectId: $projectId}]->() DELETE r",
                projectId=project_id,
            )

            if refs:
                await session.run(
                    """
                    UNWIND $repositories AS consumerRef
                    MATCH (consumer:ApiEndpoint {
                        repoId: consumerRef.repoId,
                        sha: consumerRef.sha,
                        role: 'consumer'
                    })
                    UNWIND $repositories AS providerRef
                    MATCH (provider:ApiEndpoint {
                        repoId: providerRef.repoId,
                        sha: providerRef.sha,
                        role: 'provider'
                    })
                    WHERE consumer.repoId <> provider.repoId
                      AND consumer.method = provider.method
                      AND consumer.normalizedRoute = provider.normalizedRoute
                    MERGE (consumer)-[r:CONSUMES {projectId: $projectId}]->(provider)
                    SET r.confidence = 'confirmed', r.evidenceType = 'method_route'
                    """,
                    repositories=refs,
                    projectId=project_id,
                )

            result = await session.run(
                """
                MATCH (consumer:ApiEndpoint)-[r:CONSUMES {projectId: $projectId}]->(provider:ApiEndpoint)
                RETURN consumer, provider
                ORDER BY consumer.repoId, provider.repoId, consumer.method, consumer.normalizedRoute
                """,
                projectId=project_id,
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

    async def acquire_lock(self, repo_id: str, sha: str) -> bool:
        acquired = await self._redis.set(_lock_key(repo_id, sha), "1", nx=True, ex=LOCK_TTL_SECONDS)
        return bool(acquired)

    async def release_lock(self, repo_id: str, sha: str) -> None:
        await self._redis.delete(_lock_key(repo_id, sha))
