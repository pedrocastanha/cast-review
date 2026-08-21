import type { Octokit } from '@octokit/rest';
import { fetchRepoTree } from './tree-fetcher.helper';

function fakeOctokit(
  treeEntries: {
    path: string;
    sha: string;
    type: string;
  }[],
  truncated = false,
): Octokit {
  const blobBySha = new Map(
    treeEntries.map((entry) => [
      entry.sha,
      Buffer.from(`content of ${entry.path}`).toString('base64'),
    ]),
  );

  return {
    git: {
      getTree: jest.fn().mockResolvedValue({
        data: { tree: treeEntries, truncated },
      }),
      getBlob: jest.fn().mockImplementation(({ file_sha }: { file_sha: string }) =>
        Promise.resolve({
          data: { content: blobBySha.get(file_sha), encoding: 'base64' },
        }),
      ),
    },
  } as unknown as Octokit;
}

describe('fetchRepoTree', () => {
  it('returns only files with supported extensions', async () => {
    const octokit = fakeOctokit([
      { path: 'src/a.ts', sha: 'sha-a', type: 'blob' },
      { path: 'README.md', sha: 'sha-readme', type: 'blob' },
      { path: 'src/b.py', sha: 'sha-b', type: 'blob' },
      { path: 'node_modules', sha: 'sha-dir', type: 'tree' },
    ]);

    const result = await fetchRepoTree(octokit, 'owner', 'repo', 'sha1');

    expect(result.files.map((f) => f.path).sort()).toEqual([
      'src/a.ts',
      'src/b.py',
    ]);
  });

  it('includes alias config files by basename even without a code extension', async () => {
    const octokit = fakeOctokit([
      { path: 'tsconfig.json', sha: 'sha-ts', type: 'blob' },
      { path: 'packages/api/pyproject.toml', sha: 'sha-py', type: 'blob' },
      { path: 'README.md', sha: 'sha-readme', type: 'blob' },
    ]);

    const result = await fetchRepoTree(octokit, 'owner', 'repo', 'sha1');

    expect(result.files.map((f) => f.path).sort()).toEqual([
      'packages/api/pyproject.toml',
      'tsconfig.json',
    ]);
  });

  it('decodes blob content from base64', async () => {
    const octokit = fakeOctokit([
      { path: 'src/a.ts', sha: 'sha-a', type: 'blob' },
    ]);

    const result = await fetchRepoTree(octokit, 'owner', 'repo', 'sha1');

    expect(result.files[0].content).toBe('content of src/a.ts');
  });

  it('surfaces truncated flag from the GitHub response', async () => {
    const octokit = fakeOctokit(
      [{ path: 'src/a.ts', sha: 'sha-a', type: 'blob' }],
      true,
    );

    const result = await fetchRepoTree(octokit, 'owner', 'repo', 'sha1');

    expect(result.truncated).toBe(true);
  });

  it('fetches many blobs without unbounded concurrency (smoke test)', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      path: `src/file${i}.ts`,
      sha: `sha-${i}`,
      type: 'blob',
    }));
    const octokit = fakeOctokit(entries);

    const result = await fetchRepoTree(octokit, 'owner', 'repo', 'sha1');

    expect(result.files).toHaveLength(25);
  });
});
