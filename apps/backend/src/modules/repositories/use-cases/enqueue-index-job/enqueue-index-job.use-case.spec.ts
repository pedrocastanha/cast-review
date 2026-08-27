import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { EnqueueIndexJobUseCase } from './enqueue-index-job.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGithubSession(owner = 'octocat', sha = 'sha1') {
  return {
    getSession: jest.fn().mockResolvedValue({ octokit: {}, owner }),
    resolveOwner: jest.fn(
      (session, ownerOverride) => ownerOverride?.trim() || session.owner,
    ),
    resolveDefaultBranchSha: jest.fn().mockResolvedValue(sha),
    handleGithubError: jest.fn((err) => {
      throw err;
    }),
  } as any;
}

function fakeQueue() {
  return { add: jest.fn().mockResolvedValue(undefined) } as any;
}

function fakeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

describe('EnqueueIndexJobUseCase', () => {
  it('resolves the default branch head sha and enqueues a deterministic jobId', async () => {
    const queue = fakeQueue();
    const githubSession = fakeGithubSession('octocat', 'sha1');
    const useCase = new EnqueueIndexJobUseCase(
      githubSession,
      queue,
      fakeLogger(),
    );

    const result = await useCase.execute({ repo: 'hello-world', currentUser });

    expect(queue.add).toHaveBeenCalledWith(
      'build',
      { owner: 'octocat', repo: 'hello-world', sha: 'sha1', userId: 'user-1' },
      { jobId: 'octocat/hello-world@sha1', removeOnComplete: true, removeOnFail: true },
    );
    expect(result).toEqual({ jobId: 'octocat/hello-world@sha1', status: 'queued' });
  });

  it('uses the owner override instead of the session owner when provided', async () => {
    const queue = fakeQueue();
    const githubSession = fakeGithubSession('octocat', 'sha1');
    const useCase = new EnqueueIndexJobUseCase(
      githubSession,
      queue,
      fakeLogger(),
    );

    await useCase.execute({
      repo: 'hello-world',
      currentUser,
      ownerOverride: 'some-org',
    });

    expect(githubSession.resolveDefaultBranchSha).toHaveBeenCalledWith(
      {},
      'some-org',
      'hello-world',
    );
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 404 };
    const githubSession = fakeGithubSession('octocat', 'sha1');
    githubSession.resolveDefaultBranchSha.mockRejectedValue(err);
    const useCase = new EnqueueIndexJobUseCase(
      githubSession,
      fakeQueue(),
      fakeLogger(),
    );

    await expect(
      useCase.execute({ repo: 'hello-world', currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
