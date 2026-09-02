import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { defaultRepositoryConfig } from '../../domain/github-app.types';
import { UpdateRepositoryConfigUseCase } from './update-repository-config.use-case';

const USER: CurrentUserData = {
  id: 'user-1',
  username: 'pedro',
  email: 'p@example.com',
};

const READY = {
  models: { testReviewer: 'gpt-5.4-mini', architectureReviewer: 'gpt-5.4-mini' },
  budgetMonthlyUsd: 10,
};

function repositoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'repo-row',
    installationId: 'inst-row',
    owner: 'octo-org',
    repo: 'api',
    fullName: 'octo-org/api',
    enabled: false,
    configStatus: 'configuration_required',
    configReason: null,
    pausedAt: null,
    removedAt: null,
    config: defaultRepositoryConfig(),
    ...overrides,
  };
}

function build(
  options: { repository?: Record<string, unknown>; openaiKey?: string | null } = {},
) {
  const repository = options.repository ?? repositoryRow();
  const ownership = {
    repository: jest.fn().mockResolvedValue({
      repository,
      installation: { id: 'inst-row', ownerUserId: 'user-1' },
    }),
  };
  const appRepositoryRepository = {
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(repository),
  };
  const userService = {
    getOpenaiKey:
      options.openaiKey === null
        ? jest.fn().mockRejectedValue(new Error('sem chave'))
        : jest.fn().mockResolvedValue(options.openaiKey ?? 'sk-teste'),
  };
  const budget = {
    usage: jest.fn().mockResolvedValue({
      month: '2026-09',
      consumedUsd: 0,
      reservedUsd: 0,
      limitUsd: 10,
      remainingUsd: 10,
    }),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return {
    useCase: new UpdateRepositoryConfigUseCase(
      ownership as any,
      appRepositoryRepository as any,
      userService as any,
      budget as any,
      logger as any,
    ),
    appRepositoryRepository,
  };
}

describe('UpdateRepositoryConfigUseCase — GA-03 e GA-04', () => {
  it('refuses to enable automation without models', async () => {
    await expect(
      build().useCase.execute('repo-row', USER, { enabled: true }),
    ).rejects.toThrow('Escolha os modelos usados na revisão.');
  });

  it('refuses to enable automation without a monthly ceiling', async () => {
    await expect(
      build().useCase.execute('repo-row', USER, {
        enabled: true,
        models: READY.models,
      }),
    ).rejects.toThrow('Defina o teto mensal em USD.');
  });

  it('refuses to enable automation without an OpenAI key', async () => {
    await expect(
      build({ openaiKey: null }).useCase.execute('repo-row', USER, {
        enabled: true,
        ...READY,
      }),
    ).rejects.toThrow('Configure a chave da OpenAI');
  });

  it('enables the repository once key, models and budget are in place', async () => {
    const { useCase, appRepositoryRepository } = build();

    await useCase.execute('repo-row', USER, {
      enabled: true,
      ...READY,
      publishPolicy: 'comments',
    });

    expect(appRepositoryRepository.update).toHaveBeenCalledWith(
      'repo-row',
      expect.objectContaining({
        enabled: true,
        configStatus: 'ready',
        configReason: null,
        config: expect.objectContaining({
          publishPolicy: 'comments',
          budgetMonthlyUsd: 10,
        }),
      }),
    );
  });

  it('saves an incomplete configuration while automation stays off', async () => {
    const { useCase, appRepositoryRepository } = build();

    await useCase.execute('repo-row', USER, { includeDrafts: true });

    expect(appRepositoryRepository.update).toHaveBeenCalledWith(
      'repo-row',
      expect.objectContaining({
        enabled: false,
        configStatus: 'configuration_required',
        config: expect.objectContaining({ includeDrafts: true }),
      }),
    );
  });

  it('requires a project id when the scope is a cross-repo project', async () => {
    await expect(
      build().useCase.execute('repo-row', USER, {
        impactScope: { mode: 'project' },
      }),
    ).rejects.toThrow('impactScope.projectId é obrigatório no modo project');
  });

  it('pauses a repository immediately without losing its configuration', async () => {
    const { useCase, appRepositoryRepository } = build({
      repository: repositoryRow({
        enabled: true,
        configStatus: 'ready',
        config: { ...defaultRepositoryConfig(), ...READY },
      }),
    });

    await useCase.execute('repo-row', USER, { paused: true });

    expect(appRepositoryRepository.update).toHaveBeenCalledWith(
      'repo-row',
      expect.objectContaining({ enabled: true, pausedAt: expect.any(Date) }),
    );
  });
});
