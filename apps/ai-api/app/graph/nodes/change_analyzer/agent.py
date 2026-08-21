from pathlib import Path

from app.graph.state import GraphState
from app.graph.utils.usage import skipped_step

TEST_DIR_MARKERS = ("/test/", "/tests/", "/__tests__/")
TEST_NAME_MARKERS = (".test.", ".spec.", "_test.", "test_")
MIGRATION_MARKERS = ("/migration", "migrations/", "alembic/")
CONFIG_EXTENSIONS = {".json", ".yml", ".yaml", ".toml", ".ini", ".env"}

_driver = None
_cache = None


def _get_index_cache():
    """Lazy module-level singleton, not `app.state` — LangGraph nodes run inside
    `graph.astream`, with no access to the FastAPI request object `routes/index.py`
    uses for its own driver/client singletons (Decisão A13). Same reasoning (pooled
    connections, not one per call), different mechanism because this call site has no
    `Request` to hang it off of."""
    global _driver, _cache
    if _cache is None:
        from app.code_graph.cache import IndexCache, build_neo4j_driver, build_redis_client

        _driver = build_neo4j_driver()
        _cache = IndexCache(_driver, build_redis_client())
    return _driver, _cache


def analyze_changes(changed_files: list[dict], diff: str = "") -> dict:
    files = [_classify(item.get("path", "")) for item in changed_files if item.get("path")]
    return {
        "files": files,
        "hasTests": any(item["kind"] == "test" for item in files),
        "hasMigration": any(item["kind"] == "migration" for item in files)
        or _diff_looks_like_migration(diff),
    }

async def node(state: GraphState) -> dict:
    analysis = analyze_changes(state["changed_files"], state.get("diff", ""))
    analysis["usage"] = skipped_step("change_analyzer")
    analysis["relatedContext"] = await _related_context(state)
    return {"change_analysis": analysis}


async def _related_context(state: GraphState) -> dict | None:
    """Never lets a graph/Neo4j/Redis problem take down the run (CGC-04/CGC-12
    spirit) — `change_analyzer` degrading to `relatedContext=None` is the same
    contract as "repo never indexed", not a special error path."""
    repo_id = state.get("repo_id")
    sha = state.get("sha")
    if not repo_id or not sha:
        return None

    try:
        from app.code_graph.context import assemble_related_context

        driver, cache = _get_index_cache()
        changed_paths = [item["path"] for item in state["changed_files"] if item.get("path")]
        related = await assemble_related_context(cache, driver, repo_id, sha, changed_paths)
        return related.model_dump()
    except Exception:
        return None

def _classify(path: str) -> dict:
    normalized = path.replace("\\", "/")
    lower = normalized.lower()
    extension = Path(normalized).suffix.lower()

    if _is_test(lower):
        kind = "test"
    elif any(marker in lower for marker in MIGRATION_MARKERS):
        kind = "migration"
    elif extension in CONFIG_EXTENSIONS:
        kind = "config"
    else:
        kind = "source"

    return {"path": path, "kind": kind, "extension": extension}

def _is_test(lower_path: str) -> bool:
    name = lower_path.rsplit("/", 1)[-1]
    return any(marker in lower_path for marker in TEST_DIR_MARKERS) or any(
        marker in name for marker in TEST_NAME_MARKERS
    )

def _diff_looks_like_migration(diff: str) -> bool:
    lower = diff.lower()
    return any(marker in lower for marker in MIGRATION_MARKERS)
