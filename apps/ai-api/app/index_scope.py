import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import HTTPException

GRANT_INFO = b"index-scope-grant-v1"
INDEX_SCOPE_HEADER = "x-index-scope"


class ScopeError(Exception):
    pass


def _signing_key() -> bytes:
    """Chave derivada do AI_SERVICE_TOKEN com separação de domínio.

    O token autentica o SERVIÇO; ele não autoriza CONTEÚDO. Derivar em vez de
    usá-lo cru como chave HMAC evita que uma mesma chave sirva a dois
    propósitos. `SECRET_ENCRYPTION_KEY` do backend não entra aqui de propósito:
    o ai-api não deve tê-la.
    """
    token = os.environ.get("AI_SERVICE_TOKEN", "").strip()
    if not token:
        raise ScopeError("AI_SERVICE_TOKEN ausente")
    return hmac.new(token.encode(), GRANT_INFO, hashlib.sha256).digest()


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_scope_grant(grant: str | None) -> dict:
    if not grant:
        raise ScopeError("grant de escopo ausente")

    payload, _, signature = grant.partition(".")
    if not payload or not signature:
        raise ScopeError("grant de escopo inválido")

    expected = base64.urlsafe_b64encode(
        hmac.new(_signing_key(), payload.encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()

    if not hmac.compare_digest(expected, signature):
        raise ScopeError("grant de escopo inválido")

    try:
        claims = json.loads(_b64url_decode(payload))
    except (ValueError, TypeError) as exc:
        raise ScopeError("grant de escopo inválido") from exc

    if not isinstance(claims, dict) or not claims.get("ownerId"):
        raise ScopeError("grant de escopo inválido")

    if float(claims.get("expiresAt", 0)) < time.time() * 1000:
        raise ScopeError("grant de escopo expirado")

    return claims


def authorize_index_read(grant: str | None, owner_id: str, repo_id: str, sha: str) -> None:
    """Autoriza a leitura de conteúdo de um repo@sha indexado.

    O backend assina exatamente o conjunto que já verificou contra o GitHub.
    Aqui só conferimos que o pedido está dentro dele — incluindo o `ownerId`,
    para que um grant de um usuário não sirva para ler o grafo de outro.
    """
    try:
        claims = verify_scope_grant(grant)
    except ScopeError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    if claims["ownerId"] != owner_id:
        raise HTTPException(status_code=403, detail="grant de escopo não cobre este dono")

    allowed = {
        (str(entry.get("repoId")), str(entry.get("sha")))
        for entry in claims.get("repositories", [])
        if isinstance(entry, dict)
    }
    if (repo_id, sha) not in allowed:
        raise HTTPException(
            status_code=403, detail="grant de escopo não cobre este repositório"
        )
