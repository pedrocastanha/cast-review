from app.domain.agents.entities import Finding
from app.domain.agents.scoring import calculate_score

ALLOWED_STATUS = {"fail", "warning", "pass"}

def normalize_findings(
    raw: object, changed_files: list[dict] | None = None
) -> list[Finding]:
    if not isinstance(raw, list):
        return []

    findings: list[Finding] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        status = item.get("status")
        if status not in ALLOWED_STATUS:
            continue
        path = _normalize_path(item.get("path"))
        line = _positive_int(item.get("line"))
        end_line = _positive_int(item.get("endLine") or item.get("end_line"))
        evidence = _optional_str(item.get("evidence"))
        if changed_files is not None:
            path, line, end_line, evidence = _verify_location(
                path, evidence, changed_files
            )

        findings.append(
            Finding(
                status=status,
                title=str(item.get("title") or "Finding"),
                detail=str(item.get("detail") or ""),
                business_rule=_optional_str(item.get("businessRule") or item.get("business_rule")),
                convention_ref=_optional_str(item.get("conventionRef") or item.get("convention_ref")),
                path=path,
                line=line,
                end_line=end_line,
                evidence=evidence,
            )
        )
    return findings

def review_payload(findings: list[Finding]) -> dict:
    return {
        "score": calculate_score(findings),
        "findings": [finding.to_payload() for finding in findings],
    }

def _optional_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _normalize_path(value: object) -> str | None:
    """Path relativo à raiz do repo. Recusa `..` e caminho absoluto."""
    if not isinstance(value, str):
        return None
    stripped = value.strip().replace("\\", "/")
    while stripped.startswith("./"):
        stripped = stripped[2:]
    stripped = stripped.lstrip("/")
    if not stripped or stripped.startswith("/") or ":" in stripped[:3]:
        return None
    parts = [part for part in stripped.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        return None
    return "/".join(parts) or None


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(value)
    return number if number > 0 else None


def _verify_location(
    path: str | None,
    evidence: str | None,
    changed_files: list[dict],
) -> tuple[str | None, int | None, int | None, str | None]:
    """Derive a finding location from a unique, exact source excerpt.

    The model's line number is deliberately ignored. If the excerpt is missing,
    ambiguous, or absent from the named changed file, the finding remains useful
    in the report but has no publishable source location.
    """
    if not path or not evidence or len(evidence) > 2_000:
        return None, None, None, None

    files = [
        item
        for item in changed_files
        if isinstance(item, dict) and _normalize_path(item.get("path")) == path
    ]
    if len(files) != 1:
        return None, None, None, None

    content = files[0].get("fullContent")
    if not isinstance(content, str) or not content:
        return None, None, None, None

    excerpt_lines = (
        evidence.replace("\r\n", "\n").replace("\r", "\n").strip("\n").split("\n")
    )
    if (
        not excerpt_lines
        or len(excerpt_lines) > 10
        or not any(line.strip() for line in excerpt_lines)
    ):
        return None, None, None, None

    expected = [line.strip() for line in excerpt_lines]
    source_lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    matches = [
        index
        for index in range(len(source_lines) - len(expected) + 1)
        if [line.strip() for line in source_lines[index : index + len(expected)]]
        == expected
    ]
    if len(matches) != 1:
        return None, None, None, None

    start = matches[0]
    actual_excerpt = "\n".join(source_lines[start : start + len(expected)])
    return (
        path,
        start + 1,
        start + len(expected) if len(expected) > 1 else None,
        actual_excerpt,
    )
