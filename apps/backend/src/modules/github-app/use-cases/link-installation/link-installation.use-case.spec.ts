import { BadRequestException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { createInstallState } from '../../infrastructure/github/security/install-state';
import { LinkInstallationUseCase } from './link-installation.use-case';

const USER: CurrentUserData = {
  id: 'user-1',
  username: 'pedro',
  email: 'p@example.com',
};
const STATE_SECRET = 'state-secret';

function build(existing: Record<string, unknown> | null = null) {
  const installationRepository = {
    findOne: jest.fn().mockResolvedValue(existing),
    save: jest.fn(async (value) => value),
  };
  const tokenService = {
    appClient: jest.fn().mockReturnValue({
      apps: {
        getInstallation: jest.fn().mockResolvedValue({
          data: {
            account: { login: 'octo-org', type: 'Organization', id: 1 },
            repository_selection: 'selected',
            permissions: { contents: 'read' },
            events: ['pull_request'],
            suspended_at: null,
          },
        }),
      },
    }),
  };
  const syncRepositories = { execute: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return {
    useCase: new LinkInstallationUseCase(
      installationRepository as any,
      tokenService as any,
      syncRepositories as any,
      logger as any,
    ),
    installationRepository,
    syncRepositories,
  };
}

describe('LinkInstallationUseCase.installUrl', () => {
  const previous = { ...process.env };
  afterEach(() => {
    process.env = { ...previous };
  });

  it('refuses to start an installation when the App is not configured', () => {
    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_SLUG = '';
    expect(() => build().useCase.installUrl(USER)).toThrow(BadRequestException);
  });

  it('returns a signed state bound to the current user', () => {
    process.env.GITHUB_APP_ID = '1';
    process.env.GITHUB_APP_SLUG = 'cast-review';
    process.env.GITHUB_APP_PRIVATE_KEY = 'chave';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'segredo';
    process.env.GITHUB_APP_STATE_SECRET = STATE_SECRET;

    const { url, state } = build().useCase.installUrl(USER);

    expect(url).toContain('https://github.com/apps/cast-review/installations/new');
    expect(url).toContain(encodeURIComponent(state));
  });
});

describe('LinkInstallationUseCase.execute', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    process.env.GITHUB_APP_STATE_SECRET = STATE_SECRET;
  });
  afterEach(() => {
    process.env = { ...previous };
  });

  it('links the installation and syncs its repositories', async () => {
    const { useCase, installationRepository, syncRepositories } = build();

    const id = await useCase.execute(USER, {
      installationId: '42',
      state: createInstallState(STATE_SECRET, 'user-1'),
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(installationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: '42',
        ownerUserId: 'user-1',
        status: 'active',
        accountLogin: 'octo-org',
      }),
    );
    expect(syncRepositories.execute).toHaveBeenCalled();
  });

  it('rejects a state that was issued for another user', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute(USER, {
        installationId: '42',
        state: createInstallState(STATE_SECRET, 'user-2'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a link without a valid state, even with a real installation id', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute(USER, { installationId: '42', state: 'lixo' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to steal an installation already linked to another Cast user', async () => {
    const { useCase } = build({
      id: 'inst-row',
      installationId: '42',
      ownerUserId: 'user-9',
    });
    await expect(
      useCase.execute(USER, {
        installationId: '42',
        state: createInstallState(STATE_SECRET, 'user-1'),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
