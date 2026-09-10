import base64
import hashlib
import hmac
import json
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.index_scope import INDEX_SCOPE_HEADER, ScopeError, authorize_index_read, verify_scope_grant
from app.main import app

SERVICE_TOKEN = "t" * 48


@pytest.fixture(autouse=True)
def _service_token(monkeypatch):
    """Escopado ao módulo de teste: definir AI_SERVICE_TOKEN no import vazaria
    para os outros testes e ligaria a autenticação de serviço neles."""
    monkeypatch.setenv("AI_SERVICE_TOKEN", SERVICE_TOKEN)

OWNER_ID = "owner-1"


def issue(owner_id=OWNER_ID, repositories=(("acme/back", "sha1"),), ttl_ms=300_000, token=None):
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {
                "ownerId": owner_id,
                "repositories": [{"repoId": r, "sha": s} for r, s in repositories],
                "expiresAt": time.time() * 1000 + ttl_ms,
            }
        ).encode()
    ).rstrip(b"=").decode()
    key = hmac.new(
        (token or SERVICE_TOKEN).encode(), b"index-scope-grant-v1", hashlib.sha256
    ).digest()
    signature = (
        base64.urlsafe_b64encode(hmac.new(key, payload.encode(), hashlib.sha256).digest())
        .rstrip(b"=")
        .decode()
    )
    return f"{payload}.{signature}"


def test_valid_grant_authorizes_the_repo_it_covers():
    authorize_index_read(issue(), OWNER_ID, "acme/back", "sha1")


def test_missing_grant_is_unauthorized():
    with pytest.raises(HTTPException) as excinfo:
        authorize_index_read(None, OWNER_ID, "acme/back", "sha1")
    assert excinfo.value.status_code == 401


def test_grant_signed_with_another_token_is_rejected():
    forged = issue(token="x" * 48)
    with pytest.raises(HTTPException) as excinfo:
        authorize_index_read(forged, OWNER_ID, "acme/back", "sha1")
    assert excinfo.value.status_code == 401


def test_expired_grant_is_rejected():
    with pytest.raises(HTTPException) as excinfo:
        authorize_index_read(issue(ttl_ms=-1), OWNER_ID, "acme/back", "sha1")
    assert excinfo.value.status_code == 401


def test_grant_of_one_owner_does_not_serve_another():
    # O ponto central: o grant é ligado ao dono, então não vira chave-mestra.
    with pytest.raises(HTTPException) as excinfo:
        authorize_index_read(issue(), "owner-2", "acme/back", "sha1")
    assert excinfo.value.status_code == 403


def test_grant_does_not_cover_a_repository_outside_it():
    with pytest.raises(HTTPException) as excinfo:
        authorize_index_read(issue(), OWNER_ID, "victim/private", "sha1")
    assert excinfo.value.status_code == 403


def test_grant_does_not_cover_a_different_sha():
    with pytest.raises(HTTPException) as excinfo:
        authorize_index_read(issue(), OWNER_ID, "acme/back", "outro-sha")
    assert excinfo.value.status_code == 403


def test_tampered_payload_is_rejected():
    grant = issue()
    _, _, signature = grant.partition(".")
    forged_payload = base64.urlsafe_b64encode(
        json.dumps(
            {
                "ownerId": OWNER_ID,
                "repositories": [{"repoId": "victim/private", "sha": "sha1"}],
                "expiresAt": time.time() * 1000 + 300_000,
            }
        ).encode()
    ).rstrip(b"=").decode()

    with pytest.raises(ScopeError):
        verify_scope_grant(f"{forged_payload}.{signature}")


def test_malformed_grant_is_rejected():
    with pytest.raises(ScopeError):
        verify_scope_grant("sem-ponto")


def _client() -> TestClient:
    return TestClient(app, headers={"authorization": f"Bearer {SERVICE_TOKEN}"})


@pytest.mark.integration
def test_index_file_route_refuses_a_request_without_a_grant():
    with _client() as client:
        response = client.get(
            "/index/file",
            params={"ownerId": OWNER_ID, "repoId": "acme/back", "sha": "sha1", "path": "a.ts"},
        )
    assert response.status_code == 401


@pytest.mark.integration
def test_index_files_route_refuses_a_repo_outside_the_grant():
    with _client() as client:
        response = client.get(
            "/index/files",
            params={"ownerId": OWNER_ID, "repoId": "victim/private", "sha": "sha1"},
            headers={INDEX_SCOPE_HEADER: issue()},
        )
    assert response.status_code == 403
