import {
  extractPullRequestFacts,
  redactPayload,
} from './webhook-payload';

const payload = {
  action: 'synchronize',
  installation: { id: 42 },
  repository: {
    id: 100,
    name: 'api',
    full_name: 'octo-org/api',
    owner: { login: 'octo-org' },
  },
  pull_request: {
    number: 7,
    state: 'open',
    draft: false,
    head: { sha: 'sha-b', ref: 'feature' },
    base: { sha: 'sha-base', ref: 'main' },
  },
};

describe('extractPullRequestFacts', () => {
  it('reads the identifiers needed to route the event', () => {
    expect(extractPullRequestFacts(payload)).toEqual({
      installationId: '42',
      githubRepoId: '100',
      owner: 'octo-org',
      repo: 'api',
      fullName: 'octo-org/api',
      pullNumber: 7,
      headSha: 'sha-b',
      baseRef: 'main',
      draft: false,
      state: 'open',
    });
  });

  it('returns null for a payload without a pull request', () => {
    expect(extractPullRequestFacts({ action: 'created' })).toBeNull();
  });
});

describe('redactPayload', () => {
  it('keeps only audit identifiers, never code or credentials', () => {
    const stored = redactPayload({
      ...payload,
      installation: { id: 42, access_tokens_url: 'https://api.github.com/x' },
      pull_request: {
        ...payload.pull_request,
        body: 'texto da PR',
        diff_url: 'x',
      },
    });

    expect(stored).toEqual({
      action: 'synchronize',
      repository: 'octo-org/api',
      pullNumber: 7,
      headSha: 'sha-b',
      baseRef: 'main',
      draft: false,
      state: 'open',
    });
    expect(JSON.stringify(stored)).not.toContain('texto da PR');
    expect(JSON.stringify(stored)).not.toContain('access_tokens_url');
  });
});
