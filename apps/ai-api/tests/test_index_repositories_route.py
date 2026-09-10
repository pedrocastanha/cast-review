import pytest

from app.api.routes.index import index_repositories

OWNER_ID = "owner-test"


class FakeCache:
    async def list_repositories(self, owner_id, query, limit, cursor):
        assert owner_id == OWNER_ID
        assert query == "cast"
        assert limit == 2
        assert cursor == "2"
        return [
            {"repoId": "acme/cast-backend", "sha": "sha-back"},
            {"repoId": "acme/cast-frontend", "sha": "sha-front"},
        ], "4"


@pytest.mark.asyncio
async def test_index_repositories_returns_a_bounded_catalog_page(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.index._get_cache",
        lambda request: FakeCache(),
    )

    result = await index_repositories(
        request=object(),
        ownerId=OWNER_ID,
        query="cast",
        limit=2,
        cursor="2",
    )

    assert result.model_dump() == {
        "repositories": [
            {"repoId": "acme/cast-backend", "sha": "sha-back"},
            {"repoId": "acme/cast-frontend", "sha": "sha-front"},
        ],
        "nextCursor": "4",
    }


@pytest.mark.asyncio
async def test_index_repositories_caps_the_page_size(monkeypatch):
    calls = []

    class Cache:
        async def list_repositories(self, owner_id, query, limit, cursor):
            calls.append((owner_id, query, limit, cursor))
            return [], None

    monkeypatch.setattr(
        "app.api.routes.index._get_cache",
        lambda request: Cache(),
    )

    await index_repositories(
        request=object(),
        ownerId=OWNER_ID,
        query=None,
        limit=999,
        cursor=None,
    )

    assert calls == [(OWNER_ID, None, 200, None)]
