from typing import Any, TypedDict

class GraphState(TypedDict, total=False):
    run_id: str
    diff: str
    changed_files: list[dict]
    conventions: str
    repo_id: str | None
    sha: str | None
    models: dict[str, str]
    change_analysis: dict[str, Any]
    prd: dict[str, Any]
    spec: dict[str, Any]
    test_review: dict[str, Any]
    architecture_review: dict[str, Any]
    report: dict[str, Any]
    revision_notes: list[dict] | None
    prd_iteration: int
    spec_iteration: int
    _prd_decision: str
    _spec_decision: str
