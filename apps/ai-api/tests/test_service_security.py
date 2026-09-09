from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import ServiceAuthentication


def test_service_requires_authentication(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "a" * 32)
    app = FastAPI()
    app.add_middleware(ServiceAuthentication)

    @app.get("/private")
    def private():
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/private").status_code == 401
    assert client.get("/private", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/private", headers={"Authorization": f"Bearer {'a' * 32}"}).status_code == 200


def test_production_without_secret_fails_closed(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    app = FastAPI()
    app.add_middleware(ServiceAuthentication)
    assert TestClient(app).get("/private").status_code == 503
