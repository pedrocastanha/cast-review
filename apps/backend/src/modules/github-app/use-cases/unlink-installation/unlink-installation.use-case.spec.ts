import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { UnlinkInstallationUseCase } from './unlink-installation.use-case';

const USER: CurrentUserData = {
  id: 'user-1',
  username: 'pedro',
  email: 'p@example.com',
};

function build() {
  const ownership = {
    installation: jest
      .fn()
      .mockResolvedValue({ id: 'inst-row', installationId: '42' }),
  };
  const installationRepository = { update: jest.fn().mockResolvedValue(undefined) };
  const execute = jest.fn();
  const appRepositoryRepository = {
    createQueryBuilder: jest.fn(() => ({
      update: () => ({ set: () => ({ where: () => ({ execute }) }) }),
    })),
  };
  const tokenService = { forget: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return {
    useCase: new UnlinkInstallationUseCase(
      ownership as any,
      installationRepository as any,
      appRepositoryRepository as any,
      tokenService as any,
      logger as any,
    ),
    installationRepository,
    tokenService,
    disableAll: execute,
  };
}

describe('UnlinkInstallationUseCase', () => {
  it('revokes the local link, disables every repository and drops the cached token', async () => {
    const { useCase, installationRepository, tokenService, disableAll } = build();

    await expect(useCase.execute('inst-row', USER)).resolves.toEqual({
      status: 'unlinked',
    });

    expect(disableAll).toHaveBeenCalled();
    expect(installationRepository.update).toHaveBeenCalledWith(
      'inst-row',
      expect.objectContaining({ ownerUserId: null, status: 'pending' }),
    );

    expect(tokenService.forget).toHaveBeenCalledWith('42');
  });
});
