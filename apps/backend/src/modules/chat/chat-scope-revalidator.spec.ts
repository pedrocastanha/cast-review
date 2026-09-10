import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import {
  ChatScopeRevalidator,
  SCOPE_REVALIDATION_TTL_MS,
} from './chat-scope-revalidator';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function build(
  assertRepositoryAccess = jest.fn().mockResolvedValue(undefined),
) {
  const repositoriesService = { assertRepositoryAccess } as any;
  return {
    revalidator: new ChatScopeRevalidator(repositoriesService),
    assertRepositoryAccess,
  };
}

describe('ChatScopeRevalidator', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps the repositories the user can still read', async () => {
    const { revalidator } = build();

    const allowed = await revalidator.accessible(
      ['acme/back', 'acme/front'],
      currentUser,
    );

    expect([...allowed].sort()).toEqual(['acme/back', 'acme/front']);
  });

  it('drops a repository the user lost access to', async () => {
    const { revalidator } = build(
      jest.fn(async (owner: string, repo: string) => {
        if (repo === 'revoked') throw new NotFoundException('sem acesso');
      }),
    );

    const allowed = await revalidator.accessible(
      ['acme/back', 'acme/revoked'],
      currentUser,
    );

    expect([...allowed]).toEqual(['acme/back']);
  });

  it('denies on any authorization failure instead of failing open', async () => {
    const { revalidator } = build(
      jest.fn().mockRejectedValue(new Error('GitHub fora do ar')),
    );

    // Falhar aberto devolveria exatamente o acesso que a revalidação corta.
    expect(await revalidator.isAccessible('acme/back', currentUser)).toBe(
      false,
    );
  });

  it('rejects a malformed repoId without calling GitHub', async () => {
    const { revalidator, assertRepositoryAccess } = build();

    expect(await revalidator.isAccessible('sem-barra', currentUser)).toBe(
      false,
    );
    expect(assertRepositoryAccess).not.toHaveBeenCalled();
  });

  it('checks GitHub once per repository inside the TTL window', async () => {
    const { revalidator, assertRepositoryAccess } = build();

    await revalidator.isAccessible('acme/back', currentUser);
    await revalidator.isAccessible('acme/back', currentUser);
    await revalidator.accessible(['acme/back'], currentUser);

    // Sem o cache, uma thread de projeto faria N chamadas por mensagem.
    expect(assertRepositoryAccess).toHaveBeenCalledTimes(1);
  });

  it('re-checks GitHub once the TTL expires', async () => {
    jest.useFakeTimers();
    const { revalidator, assertRepositoryAccess } = build();

    await revalidator.isAccessible('acme/back', currentUser);
    jest.setSystemTime(Date.now() + SCOPE_REVALIDATION_TTL_MS + 1);
    await revalidator.isAccessible('acme/back', currentUser);

    expect(assertRepositoryAccess).toHaveBeenCalledTimes(2);
  });

  it('does not share the cache between users', async () => {
    const { revalidator, assertRepositoryAccess } = build();

    await revalidator.isAccessible('acme/back', currentUser);
    await revalidator.isAccessible('acme/back', {
      ...currentUser,
      id: 'user-2',
    });

    expect(assertRepositoryAccess).toHaveBeenCalledTimes(2);
  });

  it('deduplicates repeated repoIds in a single call', async () => {
    const { revalidator, assertRepositoryAccess } = build();

    await revalidator.accessible(
      ['acme/back', 'acme/back', 'acme/front'],
      currentUser,
    );

    expect(assertRepositoryAccess).toHaveBeenCalledTimes(2);
  });
});
