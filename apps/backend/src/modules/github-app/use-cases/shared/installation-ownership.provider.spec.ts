import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { InstallationOwnershipProvider } from './installation-ownership.provider';

const OWNER: CurrentUserData = {
  id: 'user-1',
  username: 'pedro',
  email: 'p@example.com',
};
const STRANGER: CurrentUserData = {
  id: 'user-2',
  username: 'outro',
  email: 'o@example.com',
};

function build() {
  const installationRow = {
    id: 'inst-row',
    installationId: '42',
    ownerUserId: 'user-1',
  };
  const installationRepository = {
    findOne: jest.fn(async ({ where }: any) =>
      where?.ownerUserId && where.ownerUserId !== installationRow.ownerUserId
        ? null
        : installationRow,
    ),
  };
  const appRepositoryRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'repo-row', installationId: 'inst-row' }),
  };
  return {
    provider: new InstallationOwnershipProvider(
      installationRepository as any,
      appRepositoryRepository as any,
    ),
    appRepositoryRepository,
  };
}

describe('InstallationOwnershipProvider', () => {
  it('returns the installation to its owner', async () => {
    const { provider } = build();
    await expect(provider.installation('inst-row', OWNER)).resolves.toMatchObject({
      id: 'inst-row',
    });
  });

  it('hides an installation that belongs to someone else behind a 404', async () => {
    const { provider } = build();

    await expect(provider.installation('inst-row', STRANGER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('resolves a repository together with its owning installation', async () => {
    const { provider } = build();
    await expect(provider.repository('repo-row', OWNER)).resolves.toMatchObject({
      repository: { id: 'repo-row' },
      installation: { id: 'inst-row' },
    });
  });

  it('refuses a repository whose installation belongs to someone else', async () => {
    const { provider } = build();
    await expect(provider.repository('repo-row', STRANGER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s a repository that does not exist', async () => {
    const { provider, appRepositoryRepository } = build();
    appRepositoryRepository.findOne.mockResolvedValue(null);
    await expect(provider.repository('sumiu', OWNER)).rejects.toThrow(
      NotFoundException,
    );
  });
});
