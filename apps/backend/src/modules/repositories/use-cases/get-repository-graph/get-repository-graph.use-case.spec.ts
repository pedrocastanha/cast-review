import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubSessionSource } from '../shared/github-session.provider';
import { GetRepositoryGraphUseCase } from './get-repository-graph.use-case';

const currentUser: CurrentUserData = {
  id: 'user-b',
  username: 'mallory',
  email: 'mallory@example.com',
};

function fakeSession(overrides: Partial<GithubSessionSource> = {}) {
  const session = { octokit: {} as never, owner: 'mallory' };
  return {
    getSession: jest.fn().mockResolvedValue(session),
    resolveOwner: jest.fn(
      (_session: unknown, ownerOverride?: string) =>
        ownerOverride?.trim() || 'mallory',
    ),
    assertRepositoryAccess: jest.fn().mockResolvedValue(undefined),
    handleGithubError: jest.fn(() => {
      throw new NotFoundException('Recurso não encontrado no Github');
    }),
    ...overrides,
  } as unknown as GithubSessionSource & {
    assertRepositoryAccess: jest.Mock;
    getSession: jest.Mock;
  };
}

function fakeAiApi() {
  return {
    getIndexStatus: jest
      .fn()
      .mockResolvedValue({ indexed: true, sha: 'sha-1' }),
    getGraph: jest.fn().mockResolvedValue({ nodes: ['secret'], edges: [] }),
  } as any;
}

describe('GetRepositoryGraphUseCase', () => {
  it('refuses a repository the current user cannot see on GitHub', async () => {
    const githubSession = fakeSession({
      assertRepositoryAccess: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Recurso não encontrado')),
    } as any);
    const aiApiClient = fakeAiApi();
    const useCase = new GetRepositoryGraphUseCase(githubSession, aiApiClient);

    await expect(
      useCase.execute({
        repo: 'private-repo',
        currentUser,
        ownerOverride: 'victim-org',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // O ponto do teste: nada do grafo pode ser lido antes da autorização.
    expect(aiApiClient.getIndexStatus).not.toHaveBeenCalled();
    expect(aiApiClient.getGraph).not.toHaveBeenCalled();
  });

  it('authorizes the owner override, not only the session owner', async () => {
    const githubSession = fakeSession();
    const aiApiClient = fakeAiApi();
    const useCase = new GetRepositoryGraphUseCase(githubSession, aiApiClient);

    await useCase.execute({
      repo: 'private-repo',
      currentUser,
      ownerOverride: 'victim-org',
    });

    expect((githubSession as any).assertRepositoryAccess).toHaveBeenCalledWith(
      expect.anything(),
      'victim-org',
      'private-repo',
    );
  });

  it('checks access even when the caller supplies an explicit sha', async () => {
    const githubSession = fakeSession();
    const aiApiClient = fakeAiApi();
    const useCase = new GetRepositoryGraphUseCase(githubSession, aiApiClient);

    await useCase.execute({
      repo: 'private-repo',
      currentUser,
      ownerOverride: 'victim-org',
      sha: 'sha-forced',
    });

    expect((githubSession as any).assertRepositoryAccess).toHaveBeenCalled();
    expect(aiApiClient.getGraph).toHaveBeenCalledWith(
      'victim-org/private-repo',
      'sha-forced',
      currentUser.id,
      undefined,
      undefined,
    );
  });

  it('returns an empty graph when the repository is authorized but not indexed', async () => {
    const githubSession = fakeSession();
    const aiApiClient = fakeAiApi();
    aiApiClient.getIndexStatus.mockResolvedValue({ indexed: false, sha: null });
    const useCase = new GetRepositoryGraphUseCase(githubSession, aiApiClient);

    const result = await useCase.execute({ repo: 'mine', currentUser });

    expect(result).toEqual({ nodes: [], edges: [], stats: { indexed: false } });
    expect(aiApiClient.getGraph).not.toHaveBeenCalled();
  });
});
