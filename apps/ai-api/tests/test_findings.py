from app.graph.utils.findings import normalize_findings


def test_keeps_path_and_line():
    findings = normalize_findings(
        [
            {
                "status": "fail",
                "title": "Controller gordo",
                "detail": "validação no controller",
                "path": "apps/backend/src/app.controller.ts",
                "line": 24,
                "endLine": 31,
            }
        ]
    )
    payload = findings[0].to_payload()
    assert payload["path"] == "apps/backend/src/app.controller.ts"
    assert payload["line"] == 24
    assert payload["endLine"] == 31


def test_strips_dot_slash_and_leading_slash():
    findings = normalize_findings(
        [{"status": "warning", "title": "x", "detail": "y", "path": "./src/a.ts", "line": 1}]
    )
    assert findings[0].to_payload()["path"] == "src/a.ts"

    findings = normalize_findings(
        [{"status": "warning", "title": "x", "detail": "y", "path": "/src/a.ts", "line": 1}]
    )
    assert findings[0].to_payload()["path"] == "src/a.ts"


def test_rejects_parent_and_absolute_windows_style():
    findings = normalize_findings(
        [
            {"status": "fail", "title": "x", "detail": "y", "path": "../secret.ts", "line": 1},
            {"status": "fail", "title": "x", "detail": "y", "path": "src/../secret.ts", "line": 1},
        ]
    )
    assert "path" not in findings[0].to_payload()
    assert "path" not in findings[1].to_payload()


def test_invalid_line_is_dropped():
    findings = normalize_findings(
        [
            {"status": "fail", "title": "x", "detail": "y", "path": "src/a.ts", "line": 0},
            {"status": "fail", "title": "x", "detail": "y", "path": "src/a.ts", "line": -2},
            {"status": "fail", "title": "x", "detail": "y", "path": "src/a.ts", "line": "nope"},
        ]
    )
    assert all("line" not in item.to_payload() for item in findings)


def test_pass_without_location_is_ok():
    findings = normalize_findings(
        [{"status": "pass", "title": "ok", "detail": "coberto", "businessRule": "r1"}]
    )
    payload = findings[0].to_payload()
    assert payload["status"] == "pass"
    assert "path" not in payload
    assert "line" not in payload
