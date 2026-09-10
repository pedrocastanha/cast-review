import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import ServiceAuthentication

PRODUCTION_ENV = {
    "APP_ENV": "production",
    "AI_SERVICE_TOKEN": "s" * 32,
    "REDIS_URL": "rediss://redis.internal:6379",
    "NEO4J_URI": "neo4j+s://graph.internal:7687",
    "NEO4J_USER": "cast",
    "NEO4J_PASSWORD": "a-real-password",
}


def load_settings(monkeypatch, **overrides):
    for key in (
        "APP_ENV",
        "AI_SERVICE_TOKEN",
        "REDIS_URL",
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "ALLOW_INSECURE_DEPENDENCIES",
        "MAX_REQUEST_BYTES",
    ):
        monkeypatch.delenv(key, raising=False)

    for key, value in {**PRODUCTION_ENV, **overrides}.items():
        if value is not None:
            monkeypatch.setenv(key, value)

    import app.config.settings as settings

    return importlib.reload(settings)


@pytest.fixture(autouse=True)
def restore_settings():
    yield
    import app.config.settings as settings

    importlib.reload(settings)


def test_hardened_production_environment_boots(monkeypatch):
    settings = load_settings(monkeypatch)
    settings.validate_production_config()


def test_missing_neo4j_password_refuses_to_import_in_production(monkeypatch):
    with pytest.raises(RuntimeError, match="NEO4J_PASSWORD"):
        load_settings(monkeypatch, NEO4J_PASSWORD=None)


def test_missing_redis_url_refuses_to_import_in_production(monkeypatch):
    with pytest.raises(RuntimeError, match="REDIS_URL"):
        load_settings(monkeypatch, REDIS_URL=None)


def test_development_keeps_local_defaults(monkeypatch):
    settings = load_settings(
        monkeypatch,
        APP_ENV="development",
        REDIS_URL=None,
        NEO4J_URI=None,
        NEO4J_PASSWORD=None,
        AI_SERVICE_TOKEN=None,
    )

    assert settings.REDIS_URL == "redis://localhost:6379"
    assert settings.NEO4J_URI == "bolt://localhost:7687"
    settings.validate_production_config()


def test_shipped_default_password_is_refused_in_production(monkeypatch):
    settings = load_settings(monkeypatch, NEO4J_PASSWORD="portfolio123")
    with pytest.raises(RuntimeError, match="NEO4J_PASSWORD"):
        settings.validate_production_config()


def test_short_service_token_is_refused(monkeypatch):
    settings = load_settings(monkeypatch, AI_SERVICE_TOKEN="short")
    with pytest.raises(RuntimeError, match="AI_SERVICE_TOKEN"):
        settings.validate_production_config()


def test_plaintext_redis_is_refused(monkeypatch):
    settings = load_settings(monkeypatch, REDIS_URL="redis://redis.internal:6379")
    with pytest.raises(RuntimeError, match="REDIS_URL"):
        settings.validate_production_config()


def test_plaintext_neo4j_is_refused(monkeypatch):
    settings = load_settings(monkeypatch, NEO4J_URI="bolt://graph.internal:7687")
    with pytest.raises(RuntimeError, match="NEO4J_URI"):
        settings.validate_production_config()


@pytest.mark.parametrize(
    "uri",
    ["neo4j+s://g:7687", "neo4j+ssc://g:7687", "bolt+s://g:7687", "bolt+ssc://g:7687"],
)
def test_tls_neo4j_schemes_are_accepted(monkeypatch, uri):
    settings = load_settings(monkeypatch, NEO4J_URI=uri)
    settings.validate_production_config()


def test_self_hosted_opt_out_allows_private_plaintext(monkeypatch):
    settings = load_settings(
        monkeypatch,
        REDIS_URL="redis://redis.internal:6379",
        NEO4J_URI="bolt://graph.internal:7687",
        ALLOW_INSECURE_DEPENDENCIES="true",
    )
    settings.validate_production_config()


def test_arbitrary_value_is_not_an_opt_out(monkeypatch):
    settings = load_settings(
        monkeypatch,
        REDIS_URL="redis://redis.internal:6379",
        ALLOW_INSECURE_DEPENDENCIES="maybe",
    )
    with pytest.raises(RuntimeError, match="REDIS_URL"):
        settings.validate_production_config()


def test_opt_out_still_refuses_the_shipped_default_password(monkeypatch):
    settings = load_settings(
        monkeypatch,
        NEO4J_PASSWORD="portfolio123",
        ALLOW_INSECURE_DEPENDENCIES="true",
    )
    with pytest.raises(RuntimeError, match="NEO4J_PASSWORD"):
        settings.validate_production_config()


def build_client(monkeypatch, **env):
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)

    api = FastAPI()
    api.add_middleware(ServiceAuthentication)

    @api.get("/health")
    def health():
        return {"status": "ok"}

    @api.post("/index/build")
    def build():
        return {"ok": True}

    return TestClient(api)


class TestServiceAuthentication:
    def test_rejects_a_request_without_the_service_token(self, monkeypatch):
        client = build_client(monkeypatch, AI_SERVICE_TOKEN="t" * 32, APP_ENV="production")
        assert client.post("/index/build", json={}).status_code == 401

    def test_rejects_a_wrong_service_token(self, monkeypatch):
        client = build_client(monkeypatch, AI_SERVICE_TOKEN="t" * 32, APP_ENV="production")
        response = client.post(
            "/index/build", json={}, headers={"Authorization": "Bearer wrong"}
        )
        assert response.status_code == 401

    def test_accepts_the_correct_service_token(self, monkeypatch):
        token = "t" * 32
        client = build_client(monkeypatch, AI_SERVICE_TOKEN=token, APP_ENV="production")
        response = client.post(
            "/index/build", json={}, headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"

    def test_health_stays_open(self, monkeypatch):
        client = build_client(monkeypatch, AI_SERVICE_TOKEN="t" * 32, APP_ENV="production")
        assert client.get("/health").status_code == 200

    def test_production_without_a_token_serves_nothing(self, monkeypatch):
        client = build_client(monkeypatch, AI_SERVICE_TOKEN=None, APP_ENV="production")
        assert client.get("/health").status_code == 503
        assert client.post("/index/build", json={}).status_code == 503

    def test_oversized_body_is_refused(self, monkeypatch):
        token = "t" * 32
        client = build_client(
            monkeypatch,
            AI_SERVICE_TOKEN=token,
            APP_ENV="production",
            MAX_REQUEST_BYTES="64",
        )
        response = client.post(
            "/index/build",
            json={"files": ["x" * 500]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 413

    def test_body_within_the_budget_passes(self, monkeypatch):
        token = "t" * 32
        client = build_client(
            monkeypatch,
            AI_SERVICE_TOKEN=token,
            APP_ENV="production",
            MAX_REQUEST_BYTES="4096",
        )
        response = client.post(
            "/index/build", json={"ok": 1}, headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200

    def test_size_check_runs_after_authentication(self, monkeypatch):
        client = build_client(
            monkeypatch,
            AI_SERVICE_TOKEN="t" * 32,
            APP_ENV="production",
            MAX_REQUEST_BYTES="8",
        )
        response = client.post("/index/build", json={"files": ["x" * 500]})
        assert response.status_code == 401


def test_production_refuses_the_default_neo4j_admin_account(monkeypatch):
    # Community não tem RBAC, então isto é separação de credencial, não de
    # privilégio: a conta da aplicação deixa de ser a que administra o servidor.
    settings = load_settings(monkeypatch, NEO4J_USER="neo4j")
    with pytest.raises(RuntimeError, match="NEO4J_USER"):
        settings.validate_production_config()


def test_a_dedicated_neo4j_user_is_accepted(monkeypatch):
    settings = load_settings(monkeypatch, NEO4J_USER="cast_runtime")
    settings.validate_production_config()
