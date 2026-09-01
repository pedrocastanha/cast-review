import uuid

from neo4j import AsyncDriver

from app.code_graph.models import ScoredNode

GRAPH_PROJECTION_PREFIX = "rank"
DAMPING_FACTOR = 0.85


async def rank(
    driver: AsyncDriver,
    repo_id: str,
    sha: str,
    changed_paths: list[str],
    source_symbol_ids: list[str] | None = None,
) -> list[ScoredNode]:
    """Personalized PageRank over the `REFERENCES` subgraph only — `IMPORTS` never
    participates in ranking. That's not an oversight: mixing relationship types in one
    Cypher `gds.graph.project` aggregation (`relationshipType: coalesce(type(r), ...)`)
    double-counts nodes (verified empirically — 3 real nodes came back as 6, with
    duplicate scored rows). Since callers only ever connect via `REFERENCES` in this
    graph (`IMPORTS` connects files, not symbols, to their targets), restricting to
    `REFERENCES` alone already satisfies "callers outrank import-only relationships"
    from the spec — by construction, not by a weighted mix. See ADR Decisão C1.

    The projection is built REVERSED relative to storage (real edge caller->callee
    becomes projected callee->caller) — personalizing on the changed symbols and
    running a normal forward PageRank walk from there lands high scores on their real
    callers, not their callees. Verified empirically against a 3-hop chain
    (X calls Y calls Z, Z changed) before writing this: without the reversal, Y and X
    (Z's actual callers) both score 0. See ADR Decisão C2.
    """
    graph_name = f"{GRAPH_PROJECTION_PREFIX}_{uuid.uuid4().hex}"

    async with driver.session() as session:
        try:
            await session.run(
                """
                MATCH (s:Symbol {repoId: $repoId, sha: $sha})
                OPTIONAL MATCH (s)-[r:REFERENCES]->(t:Symbol {repoId: $repoId, sha: $sha})
                WITH gds.graph.project(
                    $graphName,
                    coalesce(t, s),
                    s,
                    {
                        sourceNodeLabels: ['Symbol'],
                        targetNodeLabels: ['Symbol'],
                        relationshipType: 'REFERENCES'
                    }
                ) AS g
                RETURN g
                """,
                repoId=repo_id,
                sha=sha,
                graphName=graph_name,
            )

            if source_symbol_ids:
                source_result = await session.run(
                    """
                    MATCH (s:Symbol {repoId: $repoId, sha: $sha})
                    WHERE s.id IN $symbolIds
                    RETURN collect(id(s)) AS sourceIds
                    """,
                    repoId=repo_id,
                    sha=sha,
                    symbolIds=source_symbol_ids,
                )
            else:
                source_result = await session.run(
                    """
                    MATCH (s:Symbol {repoId: $repoId, sha: $sha})
                    WHERE s.path IN $changedPaths
                    RETURN collect(id(s)) AS sourceIds
                    """,
                    repoId=repo_id,
                    sha=sha,
                    changedPaths=changed_paths,
                )
            source_record = await source_result.single()
            source_ids = source_record["sourceIds"] if source_record else []
            if not source_ids:
                return []

            pr_result = await session.run(
                """
                CALL gds.pageRank.stream($graphName, {sourceNodes: $sourceIds, dampingFactor: $dampingFactor})
                YIELD nodeId, score
                RETURN gds.util.asNode(nodeId).id AS id, score
                ORDER BY score DESC
                """,
                graphName=graph_name,
                sourceIds=source_ids,
                dampingFactor=DAMPING_FACTOR,
            )
            return [ScoredNode(symbol_id=rec["id"], score=rec["score"]) async for rec in pr_result]
        finally:
            await session.run(
                """
                CALL gds.graph.exists($graphName) YIELD exists
                WHERE exists
                CALL gds.graph.drop($graphName) YIELD graphName
                RETURN graphName
                """,
                graphName=graph_name,
            )
