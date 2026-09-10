import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Grant de escopo para as rotas de conteúdo do ai-api (`/index/file`,
 * `/index/files`).
 *
 * O `AI_SERVICE_TOKEN` autentica o SERVIÇO, não autoriza o CONTEÚDO: quem o
 * possui pode pedir qualquer `repoId`/`sha`. Este grant fecha essa lacuna —
 * o backend assina exatamente o conjunto de repositórios que já autorizou
 * contra o GitHub, e o ai-api só serve o que estiver dentro dele.
 *
 * A chave de assinatura é DERIVADA do `AI_SERVICE_TOKEN` com separação de
 * domínio, em vez de ser um segredo novo: os dois serviços já compartilham esse
 * token e já o validam em produção, e derivar evita usá-lo cru como chave HMAC.
 * `SECRET_ENCRYPTION_KEY` não serve aqui — o ai-api não deve tê-la.
 */
const GRANT_INFO = 'index-scope-grant-v1';

export const INDEX_SCOPE_HEADER = 'x-index-scope';
export const INDEX_SCOPE_TTL_MS = 300_000;

export interface IndexScopeRepository {
  repoId: string;
  sha: string;
}

export interface IndexScopeClaims {
  ownerId: string;
  repositories: IndexScopeRepository[];
  expiresAt: number;
}

function signingKey(): Buffer {
  const token = process.env.AI_SERVICE_TOKEN?.trim();
  if (!token) {
    throw new Error('AI_SERVICE_TOKEN não configurada');
  }
  return createHmac('sha256', token).update(GRANT_INFO).digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function issueIndexScopeGrant(
  ownerId: string,
  repositories: IndexScopeRepository[],
): string {
  const payload = Buffer.from(
    JSON.stringify({
      ownerId,
      repositories: repositories.map(({ repoId, sha }) => ({ repoId, sha })),
      expiresAt: Date.now() + INDEX_SCOPE_TTL_MS,
    } satisfies IndexScopeClaims),
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

export function verifyIndexScopeGrant(grant: string): IndexScopeClaims {
  const [payload, signature] = grant.split('.');
  if (!payload || !signature) {
    throw new Error('Grant de escopo inválido');
  }

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error('Grant de escopo inválido');
  }

  const claims = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as IndexScopeClaims;

  if (!claims.ownerId || claims.expiresAt < Date.now()) {
    throw new Error('Grant de escopo expirado');
  }

  return claims;
}
