def decide_verdict(results: list[dict]) -> dict:
    findings = [
        finding
        for result in results
        for finding in (result.get("findings") or [])
        if isinstance(finding, dict)
    ]
    fails = sum(1 for item in findings if item.get("status") == "fail")
    warnings = sum(1 for item in findings if item.get("status") == "warning")
    scores = [
        result["score"]
        for result in results
        if isinstance(result.get("score"), (int, float))
    ]
    overall = int(min(scores)) if scores else 100

    if fails >= 2:
        verdict = "request_changes"
    elif fails >= 1 or warnings >= 3:
        verdict = "comment"
    else:
        verdict = "approve"

    return {
        "verdict": verdict,
        "overallScore": overall,
        "failCount": fails,
        "warningCount": warnings,
    }
