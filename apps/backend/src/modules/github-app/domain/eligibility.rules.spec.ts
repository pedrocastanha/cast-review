import type { GithubAppRepository } from '../entities/github-app-repository.entity';
import type { GithubInstallation } from '../entities/github-installation.entity';
import { defaultRepositoryConfig } from './github-app.types';
import {
  evaluateInstallation,
  evaluatePullEvent,
  evaluateRepository,
  isEligibleAction,
  matchesBranch,
} from './eligibility.rules';

function installation(
  overrides: Partial<GithubInstallation> = {},
): GithubInstallation {
  return {
    id: 'inst-row',
    installationId: '42',
    accountLogin: 'octo-org',
    accountType: 'Organization',
    accountId: '1',
    ownerUserId: 'user-1',
    status: 'active',
    repositorySelection: 'selected',
    permissions: {},
    events: [],
    pausedAt: null,
    suspendedAt: null,
    linkedAt: new Date(),
    lastEventAt: null,
    ...overrides,
  } as GithubInstallation;
}

function repository(
  overrides: Partial<GithubAppRepository> = {},
): GithubAppRepository {
  return {
    id: 'repo-row',
    installationId: 'inst-row',
    githubRepoId: '100',
    owner: 'octo-org',
    repo: 'api',
    fullName: 'octo-org/api',
    isPrivate: true,
    defaultBranch: 'main',
    enabled: true,
    config: {
      ...defaultRepositoryConfig(),
      models: {
        testReviewer: 'gpt-5.4-mini',
        architectureReviewer: 'gpt-5.4-mini',
      },
      budgetMonthlyUsd: 10,
    },
    configStatus: 'ready',
    configReason: null,
    pausedAt: null,
    removedAt: null,
    ...overrides,
  } as GithubAppRepository;
}

describe('isEligibleAction', () => {
  it.each(['opened', 'reopened', 'synchronize'])('accepts %s', (action) => {
    expect(isEligibleAction(action)).toBe(true);
  });

  it.each(['closed', 'labeled', 'edited', 'ready_for_review'])(
    'rejects %s (fora do P1)',
    (action) => {
      expect(isEligibleAction(action)).toBe(false);
    },
  );
});

describe('evaluateInstallation', () => {
  it('rejects an installation that was never linked to a Cast user', () => {
    expect(evaluateInstallation(installation({ ownerUserId: null }))).toEqual({
      eligible: false,
      reason: 'installation_inactive',
    });
  });

  it('rejects a suspended installation', () => {
    expect(evaluateInstallation(installation({ status: 'suspended' }))).toEqual(
      {
        eligible: false,
        reason: 'installation_inactive',
      },
    );
  });

  it('rejects a paused installation', () => {
    expect(
      evaluateInstallation(installation({ pausedAt: new Date() })),
    ).toEqual({
      eligible: false,
      reason: 'installation_paused',
    });
  });

  it('accepts an active linked installation', () => {
    expect(evaluateInstallation(installation())).toEqual({ eligible: true });
  });
});

describe('evaluateRepository', () => {
  it('starts disabled: automation is opt-in per repository', () => {
    expect(evaluateRepository(repository({ enabled: false }))).toEqual({
      eligible: false,
      reason: 'automation_disabled',
    });
  });

  it('rejects a paused repository', () => {
    expect(evaluateRepository(repository({ pausedAt: new Date() }))).toEqual({
      eligible: false,
      reason: 'repository_paused',
    });
  });

  it('rejects a repository whose configuration is incomplete', () => {
    expect(
      evaluateRepository(
        repository({ configStatus: 'configuration_required' }),
      ),
    ).toEqual({ eligible: false, reason: 'configuration_required' });
  });

  it('rejects a repository removed from the installation', () => {
    expect(evaluateRepository(repository({ removedAt: new Date() }))).toEqual({
      eligible: false,
      reason: 'installation_inactive',
    });
  });
});

describe('evaluatePullEvent', () => {
  const facts = {
    action: 'synchronize',
    draft: false,
    baseRef: 'main',
    state: 'open',
  };

  it('accepts a synchronize on an open non-draft pull request', () => {
    expect(evaluatePullEvent(repository(), facts)).toEqual({ eligible: true });
  });

  it('ignores drafts by default', () => {
    expect(evaluatePullEvent(repository(), { ...facts, draft: true })).toEqual({
      eligible: false,
      reason: 'draft',
    });
  });

  it('runs on drafts when the repository opted in', () => {
    const repo = repository();
    repo.config = { ...repo.config, includeDrafts: true };
    expect(evaluatePullEvent(repo, { ...facts, draft: true })).toEqual({
      eligible: true,
    });
  });

  it('honours a disabled event', () => {
    const repo = repository();
    repo.config = {
      ...repo.config,
      events: { opened: true, reopened: true, synchronize: false },
    };
    expect(evaluatePullEvent(repo, facts)).toEqual({
      eligible: false,
      reason: 'event_not_enabled',
    });
  });

  it('filters by target branch when a list is configured', () => {
    const repo = repository();
    repo.config = { ...repo.config, baseBranches: ['main', 'release/*'] };
    expect(
      evaluatePullEvent(repo, { ...facts, baseRef: 'release/2026-09' }),
    ).toEqual({
      eligible: true,
    });
    expect(evaluatePullEvent(repo, { ...facts, baseRef: 'feature/x' })).toEqual(
      {
        eligible: false,
        reason: 'base_branch',
      },
    );
  });

  it('ignores a pull request that is no longer open', () => {
    expect(
      evaluatePullEvent(repository(), { ...facts, state: 'closed' }),
    ).toEqual({
      eligible: false,
      reason: 'pull_not_open',
    });
  });
});

describe('matchesBranch', () => {
  it('matches exact names and glob patterns without regex injection', () => {
    expect(matchesBranch('main', 'main')).toBe(true);
    expect(matchesBranch('release/*', 'release/1.2')).toBe(true);
    expect(matchesBranch('release/*', 'hotfix/1.2')).toBe(false);
    expect(matchesBranch('v1.0', 'v1x0')).toBe(false);
  });
});
