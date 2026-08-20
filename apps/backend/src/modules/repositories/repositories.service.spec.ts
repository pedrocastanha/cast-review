// `@octokit/rest` é ESM-only e não totalmente coberto pelo `transformIgnorePatterns`
// do Jest deste projeto (ver `analyses.service.spec.ts`) — mocka a construção do
// client. Este arquivo cobre só `enqueueIndexJob` (T10) — os demais métodos de
// `RepositoriesService` nunca tiveram teste unitário direto por esse mesmo motivo,
// fora de escopo desta feature reabrir isso.
const octokitInstance = {
  repos: { get: jest.fn() },
  git: { getRef: jest.fn() },
};
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(() => octokitInstance),
}));

import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { RepositoriesService } from './repositories.service';

function fakeUserService(login: string | null = 'octocat') {
  return {
    getGithubCredentials: jest
      .fn()
      .mockResolvedValue({ token: 'gh-token', login }),
    setGithubLogin: jest.fn(),
  } as any;
}

function fakeQueue(job: any = null) {
  return {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(job),
  } as any;
}

function fakeAiApiClient(status = { indexed: false, sha: null as string | null }) {
  return { getIndexStatus: jest.fn().mockResolvedValue(status) } as any;
}

function fakeLogger() {
  return { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as any;
}

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

describe('RepositoriesService.enqueueIndexJob', () => {
  beforeEach(() => {
    octokitInstance.repos.get.mockResolvedValue({
      data: { default_branch: 'main' },
    });
    octokitInstance.git.getRef.mockResolvedValue({
      data: { object: { sha: 'sha1' } },
    });
  });

  it('resolves the default branch HEAD sha and enqueues a deterministic jobId', async () => {
    const queue = fakeQueue();
    const service = new RepositoriesService(
      fakeUserService(),
      queue,
      fakeAiApiClient(),
      fakeLogger(),
    );

    const result = await service.enqueueIndexJob('hello-world', currentUser);

    expect(octokitInstance.repos.get).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
    });
    expect(octokitInstance.git.getRef).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      ref: 'heads/main',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'build',
      { owner: 'octocat', repo: 'hello-world', sha: 'sha1', userId: 'user-1' },
      { jobId: 'octocat/hello-world@sha1', removeOnComplete: true, removeOnFail: true },
    );
    expect(result).toEqual({ jobId: 'octocat/hello-world@sha1', status: 'queued' });
  });

  it('uses the owner query override instead of the session owner when provided', async () => {
    const queue = fakeQueue();
    const service = new RepositoriesService(
      fakeUserService(),
      queue,
      fakeAiApiClient(),
      fakeLogger(),
    );

    await service.enqueueIndexJob('hello-world', currentUser, 'some-org');

    expect(octokitInstance.repos.get).toHaveBeenCalledWith({
      owner: 'some-org',
      repo: 'hello-world',
    });
  });
});

describe('RepositoriesService.getRepositoryIndexStatus', () => {
  beforeEach(() => {
    octokitInstance.repos.get.mockResolvedValue({
      data: { default_branch: 'main' },
    });
    octokitInstance.git.getRef.mockResolvedValue({
      data: { object: { sha: 'head-sha' } },
    });
  });

  it('returns not_indexed when there is no active job and ai-api has never indexed the repo', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: false, sha: null });
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      aiApiClient,
      fakeLogger(),
    );

    const result = await service.getRepositoryIndexStatus(
      'hello-world',
      currentUser,
    );

    expect(aiApiClient.getIndexStatus).toHaveBeenCalledWith(
      'octocat/hello-world',
    );
    expect(result).toEqual({ status: 'not_indexed', sha: null, stale: false });
  });

  it('returns indexed + stale=false when the indexed sha matches HEAD', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: true, sha: 'head-sha' });
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      aiApiClient,
      fakeLogger(),
    );

    const result = await service.getRepositoryIndexStatus(
      'hello-world',
      currentUser,
    );

    expect(result).toEqual({ status: 'indexed', sha: 'head-sha', stale: false });
  });

  it('returns indexed + stale=true when the indexed sha is behind HEAD', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: true, sha: 'old-sha' });
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      aiApiClient,
      fakeLogger(),
    );

    const result = await service.getRepositoryIndexStatus(
      'hello-world',
      currentUser,
    );

    expect(result).toEqual({ status: 'indexed', sha: 'old-sha', stale: true });
  });

  it('returns indexing (not ai-api status) when a job is currently active', async () => {
    const job = { getState: jest.fn().mockResolvedValue('active'), progress: 50 };
    const aiApiClient = fakeAiApiClient();
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(job),
      aiApiClient,
      fakeLogger(),
    );

    const result = await service.getRepositoryIndexStatus(
      'hello-world',
      currentUser,
    );

    expect(result).toEqual({
      status: 'indexing',
      sha: null,
      stale: false,
      progress: 50,
    });
    expect(aiApiClient.getIndexStatus).not.toHaveBeenCalled();
  });

  it('returns queued when a job exists but is not yet active', async () => {
    const job = { getState: jest.fn().mockResolvedValue('waiting'), progress: 0 };
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(job),
      fakeAiApiClient(),
      fakeLogger(),
    );

    const result = await service.getRepositoryIndexStatus(
      'hello-world',
      currentUser,
    );

    expect(result.status).toBe('queued');
  });
});
