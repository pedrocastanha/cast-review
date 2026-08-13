from typing import Any, TypedDict

class GraphState(TypedDict, total=False):
    run_id: str
    diff: str
    changed_files: list[dict]
    conventions: str
    models: dict[str, str]
    api_keys: dict[str, str]
    change_analysis: dict[str, Any]
    prd: dict[str, Any]
    spec: dict[str, Any]
    test_review: dict[str, Any]
    architecture_review: dict[str, Any]
    report: dict[str, Any]
