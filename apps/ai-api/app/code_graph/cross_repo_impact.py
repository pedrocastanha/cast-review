import hashlib
import json
from typing import Any

from app.code_graph.http_endpoints import extract_http_endpoints
from app.code_graph.models import HttpEndpoint

DEFAULT_EVIDENCE_LIMIT = 30
RISK_ORDER = {
    "breaking_candidate": 0,
    "behavioral_candidate": 1,
    "integration_gap": 2,
    "informational": 3,
}


def _stable_id(prefix: str, value: Any) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return f"{prefix}-{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def _endpoint_payload(endpoint: HttpEndpoint) -> dict[str, Any]:
    return {
        "role": endpoint.role,
        "method": endpoint.method,
        "route": endpoint.route,
        "normalizedRoute": endpoint.normalized_route,
        "path": endpoint.path,
        "line": endpoint.line,
        "framework": endpoint.framework,
        "symbolId": endpoint.symbol_id,
        "symbolName": endpoint.symbol_name,
    }


def _identity(endpoint: HttpEndpoint) -> tuple[str, str, str]:
    return endpoint.role, endpoint.method, endpoint.normalized_route


def _pair_identity(endpoint: HttpEndpoint) -> tuple[str, str, str | None]:
    return endpoint.role, endpoint.path, endpoint.symbol_name


def _extract_file_endpoints(path: str, content: str) -> list[HttpEndpoint]:
    if not content:
        return []
    return extract_http_endpoints([{"path": path, "content": content}])


def extract_contract_changes(changed_files: list[dict]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for file in changed_files:
        path = str(file.get("path") or "")
        if not path:
            continue
        before = _extract_file_endpoints(path, str(file.get("baseContent") or ""))
        after = _extract_file_endpoints(path, str(file.get("fullContent") or ""))
        before_remaining = list(before)
        after_remaining = list(after)

        for old in list(before_remaining):
            matches = [candidate for candidate in after_remaining if _identity(candidate) == _identity(old)]
            if len(matches) != 1:
                continue
            new = matches[0]
            before_remaining.remove(old)
            after_remaining.remove(new)
            changes.append(_contract_change("touched", old, new))

        for old in list(before_remaining):
            key = _pair_identity(old)
            if key[2] is None:
                continue
            old_candidates = [candidate for candidate in before_remaining if _pair_identity(candidate) == key]
            new_candidates = [candidate for candidate in after_remaining if _pair_identity(candidate) == key]
            if len(old_candidates) != 1 or len(new_candidates) != 1:
                continue
            new = new_candidates[0]
            before_remaining.remove(old)
            after_remaining.remove(new)
            changes.append(_contract_change("modified", old, new))

        changes.extend(_contract_change("removed", endpoint, None) for endpoint in before_remaining)
        changes.extend(_contract_change("added", None, endpoint) for endpoint in after_remaining)

    return sorted(
        changes,
        key=lambda item: (
            item["path"],
            item["changeType"],
            (item.get("after") or item.get("before") or {}).get("method", ""),
            (item.get("after") or item.get("before") or {}).get("normalizedRoute", ""),
        ),
    )


def _contract_change(
    change_type: str,
    before: HttpEndpoint | None,
    after: HttpEndpoint | None,
) -> dict[str, Any]:
    endpoint = after or before
    assert endpoint is not None
    payload = {
        "changeType": change_type,
        "path": endpoint.path,
        "before": _endpoint_payload(before) if before else None,
        "after": _endpoint_payload(after) if after else None,
    }
    return {"id": _stable_id("contract", payload), **payload}


def _external_evidence(repo_id: str, sha: str, endpoint: HttpEndpoint) -> dict[str, Any]:
    return {
        "repoId": repo_id,
        "sha": sha,
        "path": endpoint.path,
        "line": endpoint.line,
        "symbolId": endpoint.symbol_id,
        "symbolName": endpoint.symbol_name,
        "framework": endpoint.framework,
    }


def _source_evidence(
    repo_id: str,
    sha: str,
    endpoint: dict[str, Any],
) -> dict[str, Any]:
    return {
        "repoId": repo_id,
        "sha": sha,
        "path": endpoint["path"],
        "line": endpoint["line"],
        "symbolId": endpoint.get("symbolId"),
        "symbolName": endpoint.get("symbolName"),
        "framework": endpoint["framework"],
    }


async def resolve_cross_repo_impacts(
    *,
    cache,
    source_repo_id: str,
    source_sha: str,
    changed_files: list[dict],
    impact_scope: dict[str, Any],
    source_base_sha: str | None = None,
    evidence_limit: int = DEFAULT_EVIDENCE_LIMIT,
) -> dict[str, Any]:
    if impact_scope.get("requestedMode") != "project":
        return {"contractChanges": [], "impacts": [], "evidence": [], "budget": None}

    contract_changes = extract_contract_changes(changed_files)
    repositories = [
        repository
        for repository in impact_scope.get("repositories") or []
        if repository.get("included")
        and repository.get("indexedSha")
        and str(repository.get("repoId", "")).lower() != source_repo_id.lower()
    ]
    endpoints_by_repo: list[tuple[dict, list[HttpEndpoint]]] = []
    for repository in repositories:
        endpoints_by_repo.append(
            (
                repository,
                await cache.list_endpoints(repository["repoId"], repository["indexedSha"]),
            )
        )

    evidence: list[dict[str, Any]] = []
    impacts: list[dict[str, Any]] = []
    for change in contract_changes:
        before = change.get("before")
        after = change.get("after")
        probe = before if change["changeType"] == "removed" else after or before
        if not probe:
            continue

        if probe["role"] == "provider" and change["changeType"] in {
            "removed",
            "modified",
            "touched",
        }:
            matches = _matching_external(endpoints_by_repo, "consumer", probe)
            for repository, endpoint in matches:
                provider_sha = source_base_sha if change["changeType"] == "removed" else source_sha
                item = {
                    "contractChangeId": change["id"],
                    "method": probe["method"],
                    "route": probe["normalizedRoute"],
                    "confidence": "confirmed",
                    "evidenceType": "method_route",
                    "consumer": _external_evidence(
                        repository["repoId"], repository["indexedSha"], endpoint
                    ),
                    "provider": _source_evidence(
                        source_repo_id, provider_sha or source_sha, probe
                    ),
                }
                _append_impact(
                    evidence,
                    impacts,
                    item,
                    "breaking_candidate"
                    if change["changeType"] in {"removed", "modified"}
                    else "behavioral_candidate",
                )

        if probe["role"] == "consumer" and change["changeType"] in {"added", "modified"}:
            matches = _matching_external(endpoints_by_repo, "provider", probe)
            if not matches:
                item = {
                    "contractChangeId": change["id"],
                    "method": probe["method"],
                    "route": probe["normalizedRoute"],
                    "confidence": "unresolved",
                    "evidenceType": "missing_provider",
                    "consumer": _source_evidence(source_repo_id, source_sha, probe),
                    "provider": None,
                }
                _append_impact(evidence, impacts, item, "integration_gap")
            for repository, endpoint in matches:
                item = {
                    "contractChangeId": change["id"],
                    "method": probe["method"],
                    "route": probe["normalizedRoute"],
                    "confidence": "confirmed",
                    "evidenceType": "method_route",
                    "consumer": _source_evidence(source_repo_id, source_sha, probe),
                    "provider": _external_evidence(
                        repository["repoId"], repository["indexedSha"], endpoint
                    ),
                }
                _append_impact(evidence, impacts, item, "informational")

    ordered = sorted(
        zip(impacts, evidence, strict=True),
        key=lambda pair: (
            RISK_ORDER[pair[0]["risk"]],
            pair[0]["route"],
            pair[0]["method"],
            pair[0]["direction"],
            pair[1]["id"],
        ),
    )
    selected = ordered[: max(0, evidence_limit)]
    selected_impacts = [pair[0] for pair in selected]
    selected_evidence = [pair[1] for pair in selected]
    encoded = json.dumps(selected_evidence, ensure_ascii=False, separators=(",", ":"))
    return {
        "contractChanges": contract_changes,
        "impacts": selected_impacts,
        "evidence": selected_evidence,
        "budget": {
            "tokenBudget": evidence_limit * 300,
            "budgetUsed": (len(encoded) + 3) // 4,
            "truncated": len(ordered) > len(selected),
            "omittedImpacts": len(ordered) - len(selected),
            "omittedEvidence": len(ordered) - len(selected),
        },
    }


def _matching_external(endpoints_by_repo, role: str, probe: dict[str, Any]):
    return [
        (repository, endpoint)
        for repository, endpoints in endpoints_by_repo
        for endpoint in endpoints
        if endpoint.role == role
        and endpoint.method == probe["method"]
        and endpoint.normalized_route == probe["normalizedRoute"]
    ]


def _append_impact(evidence: list[dict], impacts: list[dict], item: dict, risk: str) -> None:
    evidence_id = _stable_id("evidence", item)
    evidence.append({"id": evidence_id, **item})
    consumer = item["consumer"]
    provider = item.get("provider")
    direction = (
        f"{consumer['repoId']} -> {provider['repoId']}"
        if provider
        else f"{consumer['repoId']} -> unresolved"
    )
    impact_payload = {
        "evidenceId": evidence_id,
        "contractChangeId": item["contractChangeId"],
        "risk": risk,
        "confidence": item["confidence"],
        "direction": direction,
        "method": item["method"],
        "route": item["route"],
    }
    impacts.append({"id": _stable_id("impact", impact_payload), **impact_payload})
