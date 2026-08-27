import { toPullSummary } from './pull-summary.helper';

const basePull = {
  id: 1,
  number: 7,
  title: 'Add feature',
  state: 'open',
  user: { login: 'octocat' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  html_url: 'https://github.com/octocat/hello-world/pull/7',
  draft: true,
  head: { ref: 'feature', sha: 'sha-head' },
  base: { ref: 'main', sha: 'sha-base' },
};

describe('toPullSummary', () => {
  it('maps every field to the summary shape', () => {
    expect(toPullSummary(basePull as any)).toEqual({
      id: 1,
      number: 7,
      title: 'Add feature',
      state: 'open',
      user: 'octocat',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      htmlUrl: 'https://github.com/octocat/hello-world/pull/7',
      draft: true,
      headRef: 'feature',
      headSha: 'sha-head',
      baseRef: 'main',
      baseSha: 'sha-base',
    });
  });

  it('defaults user to null when the pull has no author', () => {
    const result = toPullSummary({ ...basePull, user: null } as any);

    expect(result.user).toBeNull();
  });

  it('defaults draft to false when the field is absent', () => {
    const { draft, ...withoutDraft } = basePull;
    const result = toPullSummary(withoutDraft as any);

    expect(result.draft).toBe(false);
  });
});
