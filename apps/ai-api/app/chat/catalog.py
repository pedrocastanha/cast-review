from urllib.parse import quote

import httpx

from app.chat.models import ChatCatalogAccess

CATALOG_TIMEOUT_SECONDS = 8.0


class CatalogError(Exception):
    pass


class CatalogClient:
    def __init__(self, access: ChatCatalogAccess) -> None:
        self._url = access.url.rstrip("/")
        self._headers = {"authorization": f"Bearer {access.grant}"}

    async def list(
        self,
        query: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict:
        params = {
            "query": query,
            "limit": max(1, min(limit, 20)),
            "cursor": cursor,
        }
        return await self._get(
            self._url,
            {key: value for key, value in params.items() if value is not None},
        )

    async def resolve(self, repo_id: str) -> dict:
        owner, separator, repo = repo_id.partition("/")
        if not separator or not owner or not repo or "/" in repo:
            raise CatalogError("repoId deve usar o formato owner/repo")
        url = f"{self._url}/{quote(owner, safe='')}/{quote(repo, safe='')}"
        return await self._get(url)

    async def _get(self, url: str, params: dict | None = None) -> dict:
        try:
            async with httpx.AsyncClient(timeout=CATALOG_TIMEOUT_SECONDS) as client:
                response = await client.get(url, headers=self._headers, params=params)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise CatalogError("resposta inválida do catálogo de repositórios")
            return payload
        except CatalogError:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise CatalogError("falha ao consultar o catálogo de repositórios") from exc
