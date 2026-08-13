from pathlib import Path

from app.graph.state import GraphState
from app.graph.utils.usage import skipped_step

TEST_DIR_MARKERS = ("/test/", "/tests/", "/__tests__/")
TEST_NAME_MARKERS = (".test.", ".spec.", "_test.", "test_")
MIGRATION_MARKERS = ("/migration", "migrations/", "alembic/")
CONFIG_EXTENSIONS = {".json", ".yml", ".yaml", ".toml", ".ini", ".env"}

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
    return {"change_analysis": analysis}

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
