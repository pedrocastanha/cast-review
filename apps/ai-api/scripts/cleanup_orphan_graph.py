"""Remove do Neo4j os nós de grafo anteriores ao escopo por dono.

Antes da introdução de `ownerId`, `Symbol`, `ApiEndpoint` e `RepoIndex` eram
escopados só por `repoId`/`sha`. Esses nós continuam no banco mas nenhuma query
os alcança — toda leitura passou a exigir `ownerId`. Na prática são lixo
inacessível ocupando espaço e páginas de cache.

Não há perda de dado de negócio: o grafo é derivado do código-fonte e é
reconstruído por uma reindexação normal do repositório.

Uso:
    python scripts/cleanup_orphan_graph.py                      # só relata
    python scripts/cleanup_orphan_graph.py --apply              # apaga tudo
    python scripts/cleanup_orphan_graph.py --repo owner/nome --apply

`--repo` permite limpar e reindexar um repositório de cada vez, em vez de
esvaziar o acervo inteiro de uma vez.

Exige as mesmas variáveis de ambiente do serviço (NEO4J_URI, NEO4J_USER,
NEO4J_PASSWORD).
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Rodado como script solto, a raiz do projeto não está no sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from neo4j import AsyncDriver  # noqa: E402

from app.code_graph.cache import build_neo4j_driver  # noqa: E402

ORPHAN_LABELS = ("Symbol", "ApiEndpoint", "RepoIndex")

# Lote pequeno de propósito: um DETACH DELETE sem limite num acervo grande
# segura a transação inteira em memória.
BATCH_SIZE = 10_000


def _scope_clause(repo_id: str | None) -> str:
    """`ownerId IS NULL` é o que define órfão; nunca remova essa condição.

    Sem ela o script apagaria grafo vivo de todo mundo."""
    base = "n.ownerId IS NULL"
    return f"{base} AND n.repoId = $repoId" if repo_id else base


async def count_orphans(driver: AsyncDriver, repo_id: str | None) -> dict[str, int]:
    counts: dict[str, int] = {}
    params = {"repoId": repo_id} if repo_id else {}
    async with driver.session() as session:
        for label in ORPHAN_LABELS:
            result = await session.run(
                f"MATCH (n:{label}) WHERE {_scope_clause(repo_id)} RETURN count(n) AS total",
                **params,
            )
            record = await result.single()
            counts[label] = record["total"] if record else 0
    return counts


async def delete_orphans(driver: AsyncDriver, label: str, repo_id: str | None) -> int:
    deleted = 0
    params = {"repoId": repo_id} if repo_id else {}
    async with driver.session() as session:
        while True:
            result = await session.run(
                f"""
                MATCH (n:{label})
                WHERE {_scope_clause(repo_id)}
                WITH n LIMIT $batch
                DETACH DELETE n
                RETURN count(*) AS removed
                """,
                batch=BATCH_SIZE,
                **params,
            )
            record = await result.single()
            removed = record["removed"] if record else 0
            deleted += removed
            if removed < BATCH_SIZE:
                return deleted


async def main(apply: bool, repo_id: str | None) -> int:
    driver = build_neo4j_driver()
    try:
        if repo_id:
            print(f"Escopo: {repo_id}")
        before = await count_orphans(driver, repo_id)
        total = sum(before.values())

        for label, count in before.items():
            print(f"{label}: {count} nó(s) sem ownerId")

        if total == 0:
            print("Nada a fazer.")
            return 0

        if not apply:
            print(f"\n{total} nó(s) órfão(s). Rode com --apply para remover.")
            print("Os repositórios afetados precisam ser reindexados depois.")
            return 0

        for label in ORPHAN_LABELS:
            if before[label]:
                removed = await delete_orphans(driver, label, repo_id)
                print(f"{label}: {removed} removido(s)")

        after = await count_orphans(driver, repo_id)
        if sum(after.values()):
            print(f"ATENÇÃO: ainda restam {sum(after.values())} nó(s)", file=sys.stderr)
            return 1

        print("\nLimpeza concluída. Reindexe os repositórios afetados.")
        return 0
    finally:
        await driver.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="apaga de fato (sem isto, só relata)"
    )
    parser.add_argument(
        "--repo", default=None, help="limita a um repoId (formato owner/nome)"
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.apply, args.repo)))
