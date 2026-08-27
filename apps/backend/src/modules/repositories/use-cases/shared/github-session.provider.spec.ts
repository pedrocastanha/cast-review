// `@octokit/rest` é ESM-only e não totalmente coberto pelo `transformIgnorePatterns`
// do Jest deste projeto (ver `repositories.service.spec.ts`) — mocka a construção
// do client em vez de deixar o provider instanciar um `Octokit` de verdade.
const octokitInstance = {
  users: { getAuthenticated: jest.fn() },
  repos: { get: jest.fn() },
  git: { getRef: jest.fn() },
};
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(() => octokitInstance),
}));

import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GithubSessionProvider } from './github-session.provider';

function fakeUserService(login: string | null = 'octocat') {
  return {
    getGithubCredentials: jest
      .fn()
      .mockResolvedValue({ token: 'gh-token', login }),
    setGithubLogin: jest.fn(),
  } as any;
}

function fakeLogger() {
  return { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as any;
}

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

describe('GithubSessionProvider.getSession', () => {
  it('uses the stored login without backfilling it', async () => {
    const userService = fakeUserService('octocat');
    const provider = new GithubSessionProvider(userService, fakeLogger());

    const session = await provider.getSession(currentUser);

    expect(session.owner).toBe('octocat');
    expect(octokitInstance.users.getAuthenticated).not.toHaveBeenCalled();
    expect(userService.setGithubLogin).not.toHaveBeenCalled();
  });

  it('backfills the login from Github when none is stored', async () => {
    octokitInstance.users.getAuthenticated.mockResolvedValue({
      data: { login: 'fetched-login' },
    });
    const userService = fakeUserService(null);
    const provider = new GithubSessionProvider(userService, fakeLogger());

    const session = await provider.getSession(currentUser);

    expect(userService.setGithubLogin).toHaveBeenCalledWith(
      'user-1',
      'fetched-login',
    );
    expect(session.owner).toBe('fetched-login');
  });

  it('maps a failed backfill to the mapped Github exception', async () => {
    octokitInstance.users.getAuthenticated.mockRejectedValue({ status: 401 });
    const provider = new GithubSessionProvider(
      fakeUserService(null),
      fakeLogger(),
    );

    await expect(provider.getSession(currentUser)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('GithubSessionProvider.resolveOwner', () => {
  const provider = new GithubSessionProvider(fakeUserService(), fakeLogger());
  const session = { octokit: octokitInstance as any, owner: 'octocat' };

  it('uses the trimmed owner override when provided', () => {
    expect(provider.resolveOwner(session, '  some-org  ')).toBe('some-org');
  });

  it('falls back to the session owner when no override is given', () => {
    expect(provider.resolveOwner(session, undefined)).toBe('octocat');
  });

  it('falls back to the session owner when the override is blank', () => {
    expect(provider.resolveOwner(session, '   ')).toBe('octocat');
  });
});

describe('GithubSessionProvider.resolveDefaultBranchSha', () => {
  it('resolves the HEAD sha of the repository default branch', async () => {
    octokitInstance.repos.get.mockResolvedValue({
      data: { default_branch: 'main' },
    });
    octokitInstance.git.getRef.mockResolvedValue({
      data: { object: { sha: 'sha1' } },
    });
    const provider = new GithubSessionProvider(fakeUserService(), fakeLogger());

    const sha = await provider.resolveDefaultBranchSha(
      octokitInstance as any,
      'octocat',
      'hello-world',
    );

    expect(octokitInstance.repos.get).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
    });
    expect(octokitInstance.git.getRef).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      ref: 'heads/main',
    });
    expect(sha).toBe('sha1');
  });
});

describe('GithubSessionProvider.handleGithubError', () => {
  const cases: [number, unknown][] = [
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [429, ForbiddenException],
    [404, NotFoundException],
    [500, InternalServerErrorException],
  ];

  it.each(cases)(
    'maps status %d to %p and logs the failure',
    (status, expected) => {
      const logger = fakeLogger();
      const provider = new GithubSessionProvider(fakeUserService(), logger);

      expect(() => provider.handleGithubError({ status })).toThrow(
        expected as new (...args: unknown[]) => Error,
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Falha na chamada à API do Github',
        { exception: { status } },
      );
    },
  );
});
