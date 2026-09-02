import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { PauseInstallationUseCase } from './pause-installation.use-case';

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
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return {
    useCase: new PauseInstallationUseCase(
      ownership as any,
      installationRepository as any,
      logger as any,
    ),
    installationRepository,
  };
}

describe('PauseInstallationUseCase — GA-15', () => {
  it('pauses the whole installation', async () => {
    const { useCase, installationRepository } = build();
    await useCase.execute('inst-row', USER, true);
    expect(installationRepository.update).toHaveBeenCalledWith('inst-row', {
      pausedAt: expect.any(Date),
    });
  });

  it('resumes the installation', async () => {
    const { useCase, installationRepository } = build();
    await useCase.execute('inst-row', USER, false);
    expect(installationRepository.update).toHaveBeenCalledWith('inst-row', {
      pausedAt: null,
    });
  });
});
