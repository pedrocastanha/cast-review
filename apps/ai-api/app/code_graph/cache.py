from datetime import UTC, datetime

import redis.asyncio as aioredis
from neo4j import AsyncDriver, AsyncGraphDatabase

from app.code_graph.models import Edge, EdgeKind, Graph, Symbol
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
                "MATCH (n:Symbol {repoId: $repoId}) DETACH DELETE n",
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

            return Graph(nodes=nodes, edges=edges)

    async def acquire_lock(self, repo_id: str, sha: str) -> bool:
        acquired = await self._redis.set(_lock_key(repo_id, sha), "1", nx=True, ex=LOCK_TTL_SECONDS)
        return bool(acquired)

    async def release_lock(self, repo_id: str, sha: str) -> None:
        await self._redis.delete(_lock_key(repo_id, sha))
