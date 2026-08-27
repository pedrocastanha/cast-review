import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetFileContentUseCase } from './get-file-content.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGithubSession(octokit: any, owner = 'octocat') {
  return {
    getSession: jest.fn().mockResolvedValue({ octokit, owner }),
    resolveOwner: jest.fn(
      (session, ownerOverride) => ownerOverride?.trim() || session.owner,
    ),
    handleGithubError: jest.fn((err) => {
      throw err;
    }),
  } as any;
}

describe('GetFileContentUseCase', () => {
  it('decodes the base64 file content', async () => {
    const octokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            type: 'file',
            content: Buffer.from('hello').toString('base64'),
          },
        }),
      },
    };
    const useCase = new GetFileContentUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      path: 'README.md',
      ref: 'main',
      currentUser,
    });

    expect(result).toBe('hello');
  });

  it('returns null when the path is a directory or has no content', async () => {
    const octokit = {
      repos: { getContent: jest.fn().mockResolvedValue({ data: [] }) },
    };
    const useCase = new GetFileContentUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      path: 'src',
      ref: 'main',
      currentUser,
    });

    expect(result).toBeNull();
  });

  it('returns null on a 404 instead of delegating to the error handler', async () => {
    const octokit = {
      repos: { getContent: jest.fn().mockRejectedValue({ status: 404 }) },
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new GetFileContentUseCase(githubSession);

    const result = await useCase.execute({
      repo: 'hello-world',
      path: 'missing.md',
      ref: 'main',
      currentUser,
    });

    expect(result).toBeNull();
    expect(githubSession.handleGithubError).not.toHaveBeenCalled();
  });

  it('delegates non-404 github errors to the session handler', async () => {
    const err = { status: 500 };
    const octokit = {
      repos: { getContent: jest.fn().mockRejectedValue(err) },
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new GetFileContentUseCase(githubSession);

    await expect(
      useCase.execute({
        repo: 'hello-world',
        path: 'README.md',
        ref: 'main',
        currentUser,
      }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
