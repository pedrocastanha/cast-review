// `@octokit/rest` é ESM-only e não totalmente coberto pelo `transformIgnorePatterns`
// do Jest deste projeto (ver `analyses.service.spec.ts`) — mocka a construção do
// client em vez de deixar o processor instanciar um `Octokit` de verdade.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('./tree-fetcher.helper');

import type { AppLogger } from 'src/shared/logger/logger.service';
import { fetchRepoTree } from './tree-fetcher.helper';
import { IndexProcessor } from './index.processor';

const fetchRepoTreeMock = fetchRepoTree as jest.MockedFunction<
  typeof fetchRepoTree
>;

function fakeJob(data: {
  owner: string;
  repo: string;
  sha: string;
  userId: string;
}) {
  return {
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function fakeUserService(token = 'gh-token') {
  return {
    getGithubCredentials: jest
      .fn()
      .mockResolvedValue({ token, login: 'octocat' }),
  } as any;
}

function fakeAiApiClient(result = {
  indexId: 'owner/repo@sha1',
  indexedFiles: 2,
  skippedFiles: 0,
  durationMs: 100,
}) {
  return { buildIndex: jest.fn().mockResolvedValue(result) } as any;
}

function fakeLogger(): AppLogger {
  return { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as any;
}

describe('IndexProcessor', () => {
  beforeEach(() => {
    fetchRepoTreeMock.mockResolvedValue({
      files: [
        { path: 'src/a.ts', content: 'function a() {}' },
        { path: 'src/b.py', content: 'def b(): pass' },
      ],
      truncated: false,
    });
  });

  it('fetches the tree, calls ai-api, and reports the result', async () => {
    const userService = fakeUserService();
    const aiApiClient = fakeAiApiClient();
    const processor = new IndexProcessor(
      userService,
      aiApiClient,
      fakeLogger(),
    );
    const job = fakeJob({
      owner: 'octocat',
      repo: 'hello-world',
      sha: 'sha1',
      userId: 'user-1',
    });

    const result = await processor.process(job);

    expect(userService.getGithubCredentials).toHaveBeenCalledWith('user-1');
    expect(fetchRepoTreeMock).toHaveBeenCalledWith(
      expect.anything(),
      'octocat',
      'hello-world',
      'sha1',
    );
    expect(aiApiClient.buildIndex).toHaveBeenCalledWith({
      repoId: 'octocat/hello-world',
      sha: 'sha1',
      files: [
        { path: 'src/a.ts', content: 'function a() {}' },
        { path: 'src/b.py', content: 'def b(): pass' },
      ],
    });
    expect(result.indexedFiles).toBe(2);
  });

  it('reports progress at start, after tree fetch, and at the end', async () => {
    const processor = new IndexProcessor(
      fakeUserService(),
      fakeAiApiClient(),
      fakeLogger(),
    );
    const job = fakeJob({
      owner: 'octocat',
      repo: 'hello-world',
      sha: 'sha1',
      userId: 'user-1',
    });

    await processor.process(job);

    expect(job.updateProgress).toHaveBeenCalledTimes(3);
    const calls = job.updateProgress.mock.calls.map((c: number[]) => c[0]);
    expect(calls).toEqual([...calls].sort((a, b) => a - b)); // sempre crescente
    expect(calls[calls.length - 1]).toBe(100);
  });

  it('logs a warning when the GitHub tree response is truncated', async () => {
    fetchRepoTreeMock.mockResolvedValue({ files: [], truncated: true });
    const logger = fakeLogger();
    const processor = new IndexProcessor(
      fakeUserService(),
      fakeAiApiClient(),
      logger,
    );
    const job = fakeJob({
      owner: 'octocat',
      repo: 'hello-world',
      sha: 'sha1',
      userId: 'user-1',
    });

    await processor.process(job);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('truncada'),
      expect.objectContaining({ owner: 'octocat', repo: 'hello-world' }),
    );
  });

  it('logs the failure and rethrows when the ai-api build fails', async () => {
    const err = new Error('ai-api indisponível');
    const aiApiClient = { buildIndex: jest.fn().mockRejectedValue(err) };
    const logger = fakeLogger();
    const processor = new IndexProcessor(
      fakeUserService(),
      aiApiClient as any,
      logger,
    );
    const job = fakeJob({
      owner: 'octocat',
      repo: 'hello-world',
      sha: 'sha1',
      userId: 'user-1',
    });

    await expect(processor.process(job)).rejects.toBe(err);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('falhou'),
      expect.objectContaining({
        exception: err,
        owner: 'octocat',
        repo: 'hello-world',
        sha: 'sha1',
      }),
    );
  });
});
