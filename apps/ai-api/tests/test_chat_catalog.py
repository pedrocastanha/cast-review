import httpx
import pytest

from app.chat.catalog import CatalogClient, CatalogError
from app.chat.models import ChatCatalogAccess


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code
        self.request = httpx.Request("GET", "http://backend/catalog")

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "request failed", request=self.request, response=self
            )


@pytest.mark.asyncio
async def test_catalog_client_sends_grant_and_bounded_query(monkeypatch):
    captured: dict = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured["timeout"] = kwargs["timeout"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None, params=None):
            captured.update({"url": url, "headers": headers, "params": params})
            return FakeResponse(
                {
                    "repositories": [
                        {"repoId": "acme/back", "sha": "sha", "stale": False}
                    ],
                    "nextCursor": None,
                }
            )

    monkeypatch.setattr("app.chat.catalog.httpx.AsyncClient", FakeClient)
    client = CatalogClient(ChatCatalogAccess(url="http://backend/catalog/", grant="secret"))

    result = await client.list(query="back", limit=200, cursor="10")

    assert result["repositories"][0]["repoId"] == "acme/back"
    assert captured["url"] == "http://backend/catalog"
    assert captured["headers"] == {"authorization": "Bearer secret"}
    assert captured["params"] == {"query": "back", "limit": 20, "cursor": "10"}


@pytest.mark.asyncio
async def test_catalog_client_encodes_repository_path(monkeypatch):
    captured: dict = {}

    class FakeClient:
        def __init__(self, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None, params=None):
            captured["url"] = url
            return FakeResponse({"repoId": "acme/front end", "sha": "sha", "stale": False})

    monkeypatch.setattr("app.chat.catalog.httpx.AsyncClient", FakeClient)
    client = CatalogClient(ChatCatalogAccess(url="http://backend/catalog", grant="secret"))

    await client.resolve("acme/front end")

    assert captured["url"] == "http://backend/catalog/acme/front%20end"


@pytest.mark.asyncio
async def test_catalog_client_sanitizes_http_failures(monkeypatch):
    class FakeClient:
        def __init__(self, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None, params=None):
            return FakeResponse({"detail": "secret"}, 401)

    monkeypatch.setattr("app.chat.catalog.httpx.AsyncClient", FakeClient)
    client = CatalogClient(ChatCatalogAccess(url="http://backend/catalog", grant="secret"))

    with pytest.raises(CatalogError, match="catálogo de repositórios") as error:
        await client.list()

    assert "secret" not in str(error.value)
