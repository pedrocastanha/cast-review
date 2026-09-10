import {
  INDEX_SCOPE_TTL_MS,
  issueIndexScopeGrant,
  verifyIndexScopeGrant,
} from './index-scope-grant';

describe('index scope grant', () => {
  const original = process.env.AI_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.AI_SERVICE_TOKEN = 'a'.repeat(48);
  });

  afterEach(() => {
    process.env.AI_SERVICE_TOKEN = original;
    jest.useRealTimers();
  });

  it('round-trips the authorized repositories', () => {
    const grant = issueIndexScopeGrant('owner-1', [
      { repoId: 'acme/back', sha: 'sha1' },
    ]);

    const claims = verifyIndexScopeGrant(grant);

    expect(claims.ownerId).toBe('owner-1');
    expect(claims.repositories).toEqual([{ repoId: 'acme/back', sha: 'sha1' }]);
  });

  it('rejects a tampered payload', () => {
    const grant = issueIndexScopeGrant('owner-1', [
      { repoId: 'acme/back', sha: 'sha1' },
    ]);
    const [, signature] = grant.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ownerId: 'owner-1',
        repositories: [{ repoId: 'victim/private', sha: 'sha1' }],
        expiresAt: Date.now() + INDEX_SCOPE_TTL_MS,
      }),
    ).toString('base64url');

    expect(() => verifyIndexScopeGrant(`${forged}.${signature}`)).toThrow(
      'Grant de escopo inválido',
    );
  });

  it('rejects a grant signed with a different service token', () => {
    const grant = issueIndexScopeGrant('owner-1', []);
    process.env.AI_SERVICE_TOKEN = 'b'.repeat(48);

    expect(() => verifyIndexScopeGrant(grant)).toThrow(
      'Grant de escopo inválido',
    );
  });

  it('rejects an expired grant', () => {
    jest.useFakeTimers();
    const grant = issueIndexScopeGrant('owner-1', []);

    jest.setSystemTime(Date.now() + INDEX_SCOPE_TTL_MS + 1);

    expect(() => verifyIndexScopeGrant(grant)).toThrow(
      'Grant de escopo expirado',
    );
  });

  it('rejects a malformed grant', () => {
    expect(() => verifyIndexScopeGrant('sem-ponto')).toThrow(
      'Grant de escopo inválido',
    );
  });

  it('refuses to sign without a service token', () => {
    process.env.AI_SERVICE_TOKEN = '';

    expect(() => issueIndexScopeGrant('owner-1', [])).toThrow(
      'AI_SERVICE_TOKEN não configurada',
    );
  });
});
