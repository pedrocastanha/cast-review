// `@octokit/rest` é ESM-only e não totalmente coberto pelo `transformIgnorePatterns`
// do Jest deste projeto (ver `analyses.service.spec.ts`) — mocka a construção do
// client. Os demais métodos de `RepositoriesService` têm cobertura própria nos
// specs de cada use-case em `use-cases/*/*.use-case.spec.ts`.
const octokitInstance = {
  repos: { get: jest.fn(), getContent: jest.fn() },
  git: { getRef: jest.fn() },
  pulls: {
    list: jest.fn(),
    get: jest.fn(),
    listFiles: jest.fn(),
    createReview: jest.fn(),
    listReviewComments: jest.fn(),
    deleteReviewComment: jest.fn(),
  },
  paginate: jest.fn(),
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

describe('RepositoriesService.getRepositoryGraph', () => {
  beforeEach(() => {
    octokitInstance.repos.get.mockResolvedValue({ data: { default_branch: 'main' } });
  });

  it('uses the provided sha directly, without calling getIndexStatus', async () => {
    const aiApiClient = fakeAiApiClient();
    aiApiClient.getGraph = jest.fn().mockResolvedValue({ nodes: [], edges: [], stats: { indexed: true } });
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      aiApiClient,
      fakeLogger(),
    );

    await service.getRepositoryGraph('hello-world', currentUser, undefined, 'sha1', 'focus-id', 2);

    expect(aiApiClient.getIndexStatus).not.toHaveBeenCalled();
    expect(aiApiClient.getGraph).toHaveBeenCalledWith('octocat/hello-world', 'sha1', 'focus-id', 2);
  });

  it('falls back to the latest indexed sha when none is provided', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: true, sha: 'latest-sha' });
    aiApiClient.getGraph = jest.fn().mockResolvedValue({ nodes: [], edges: [], stats: { indexed: true } });
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      aiApiClient,
      fakeLogger(),
    );

    await service.getRepositoryGraph('hello-world', currentUser);

    expect(aiApiClient.getIndexStatus).toHaveBeenCalledWith('octocat/hello-world');
    expect(aiApiClient.getGraph).toHaveBeenCalledWith('octocat/hello-world', 'latest-sha', undefined, undefined);
  });

  it('returns an empty not-indexed graph without calling getGraph when repo was never indexed', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: false, sha: null });
    aiApiClient.getGraph = jest.fn();
    const service = new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      aiApiClient,
      fakeLogger(),
    );

    const result = await service.getRepositoryGraph('hello-world', currentUser);

    expect(aiApiClient.getGraph).not.toHaveBeenCalled();
    expect(result).toEqual({ nodes: [], edges: [], stats: { indexed: false } });
  });
});

describe('RepositoriesService pull/file delegation', () => {
  function makeService() {
    return new RepositoriesService(
      fakeUserService(),
      fakeQueue(null),
      fakeAiApiClient(),
      fakeLogger(),
    );
  }

  const rawPull = {
    id: 1,
    number: 7,
    title: 'Add feature',
    state: 'open',
    user: { login: 'octocat' },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    html_url: 'https://github.com/octocat/hello-world/pull/7',
    draft: false,
    head: { ref: 'feature', sha: 'sha-head' },
    base: { ref: 'main', sha: 'sha-base' },
  };

  it('listRepos delegates to the authenticated-user repos listing', async () => {
    octokitInstance.paginate.mockResolvedValue([
      {
        id: 1,
        name: 'hello-world',
        full_name: 'octocat/hello-world',
        owner: { login: 'octocat' },
        private: false,
        description: null,
        html_url: 'https://github.com/octocat/hello-world',
        updated_at: '2024-01-01T00:00:00Z',
        default_branch: 'main',
      },
    ]);

    const result = await makeService().listRepos(currentUser);

    expect(result).toEqual([
      expect.objectContaining({ id: 1, fullName: 'octocat/hello-world' }),
    ]);
  });

  it('listPulls delegates to the pulls listing for the session owner', async () => {
    octokitInstance.paginate.mockResolvedValue([rawPull]);

    const result = await makeService().listPulls('hello-world', currentUser);

    expect(result).toEqual([expect.objectContaining({ id: 1, number: 7 })]);
  });

  it('getPullByNumber delegates to a single pull lookup', async () => {
    octokitInstance.pulls.get.mockResolvedValue({ data: rawPull });

    const result = await makeService().getPullByNumber(
      'hello-world',
      7,
      currentUser,
    );

    expect(result).toMatchObject({ id: 1, number: 7 });
  });

  it('getPullDiff delegates to a diff-formatted pull lookup', async () => {
    octokitInstance.pulls.get.mockResolvedValue({ data: 'diff --git a b' });

    const result = await makeService().getPullDiff(
      'hello-world',
      7,
      currentUser,
    );

    expect(result).toBe('diff --git a b');
  });

  it('listPullFiles delegates to the paginated pull files listing', async () => {
    octokitInstance.paginate.mockResolvedValue([
      { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' },
    ]);

    const result = await makeService().listPullFiles(
      'hello-world',
      7,
      currentUser,
    );

    expect(result).toEqual([
      { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' },
    ]);
  });

  it('getFileContent delegates to the repo content lookup and decodes it', async () => {
    octokitInstance.repos.getContent.mockResolvedValue({
      data: { type: 'file', content: Buffer.from('hello').toString('base64') },
    });

    const result = await makeService().getFileContent(
      'hello-world',
      'README.md',
      'main',
      currentUser,
    );

    expect(result).toBe('hello');
  });

  it('getConventions falls back to an empty string when conventions.md is missing', async () => {
    octokitInstance.repos.getContent.mockRejectedValue({ status: 404 });

    const result = await makeService().getConventions(
      'hello-world',
      'main',
      currentUser,
    );

    expect(result).toBe('');
  });

  it('getPullHeadSha delegates to the pull lookup head sha', async () => {
    octokitInstance.pulls.get.mockResolvedValue({ data: rawPull });

    const result = await makeService().getPullHeadSha(
      'hello-world',
      7,
      currentUser,
    );

    expect(result).toBe('sha-head');
  });

  it('createPullReview delegates to the review creation call', async () => {
    octokitInstance.pulls.createReview.mockResolvedValue({
      data: { id: 1, html_url: 'https://x' },
    });

    const result = await makeService().createPullReview(
      'hello-world',
      7,
      { commitId: 'sha-head', body: 'LGTM', comments: [] },
      currentUser,
    );

    expect(result).toEqual({ id: 1, htmlUrl: 'https://x' });
  });

  it('listPullReviewComments delegates to the paginated review comments listing', async () => {
    octokitInstance.paginate.mockResolvedValue([
      { id: 1, body: 'nit', user: { login: 'octocat' } },
    ]);

    const result = await makeService().listPullReviewComments(
      'hello-world',
      7,
      currentUser,
    );

    expect(result).toEqual([{ id: 1, body: 'nit', user: 'octocat' }]);
  });

  it('deletePullReviewComment delegates to the review comment deletion call', async () => {
    octokitInstance.pulls.deleteReviewComment.mockResolvedValue(undefined);

    await makeService().deletePullReviewComment(
      'hello-world',
      42,
      currentUser,
    );

    expect(octokitInstance.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      comment_id: 42,
    });
  });

  it('loginFor resolves the session owner', async () => {
    const result = await makeService().loginFor(currentUser);

    expect(result).toBe('octocat');
  });
});
