import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { ProjectsService } from './projects.service';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'pedrocastanha',
  email: 'pedro@example.com',
};

const githubRepos = [
  {
    id: 101,
    name: 'frontend',
    fullName: 'cast/frontend',
    owner: 'cast',
    private: true,
    description: 'UI',
    htmlUrl: 'https://github.com/cast/frontend',
    updatedAt: '2026-08-23T00:00:00.000Z',
    defaultBranch: 'main',
  },
  {
    id: 102,
    name: 'backend',
    fullName: 'cast/backend',
    owner: 'cast',
    private: true,
    description: 'API',
    htmlUrl: 'https://github.com/cast/backend',
    updatedAt: '2026-08-23T00:00:00.000Z',
    defaultBranch: 'main',
  },
];

function repository() {
  return {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'project-1', active: true, ...value })),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

function buildService() {
  const projectRepository = repository();
  const memberRepository = {
    find: jest.fn(),
    replaceForProject: jest.fn().mockResolvedValue(undefined),
  };
  const repositoriesService = {
    listRepos: jest.fn().mockResolvedValue(githubRepos),
    enqueueIndexJob: jest.fn().mockResolvedValue({ jobId: 'job', status: 'queued' }),
    getRepositoryIndexStatus: jest.fn(),
  };
  const aiApiClient = { getProjectGraph: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback({ id: 'manager' })),
  };
  const service = new ProjectsService(
    projectRepository as any,
    memberRepository as any,
    repositoriesService as any,
    aiApiClient as any,
    dataSource as any,
  );
  return {
    service,
    projectRepository,
    memberRepository,
    repositoriesService,
    aiApiClient,
    dataSource,
  };
}

describe('ProjectsService', () => {
  it('creates a project atomically with repositories authorized by GitHub', async () => {
    const { service, projectRepository, memberRepository, dataSource } = buildService();
    memberRepository.find.mockResolvedValue([
      { id: 'member-1', projectId: 'project-1', ...githubRepos[0], githubId: '101' },
    ]);

    const result = await service.create(
      {
        name: 'Cast Platform',
        description: 'Sistema completo',
        repositories: ['cast/frontend'],
      },
      currentUser,
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(projectRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-1', name: 'Cast Platform' }),
      undefined,
      expect.anything(),
    );
    expect(memberRepository.replaceForProject).toHaveBeenCalledWith(
      'project-1',
      [expect.objectContaining({ fullName: 'cast/frontend', githubId: '101' })],
      expect.anything(),
    );
    expect(result.repositories).toHaveLength(1);
  });

  it('rejects the whole create operation when one repository is not authorized', async () => {
    const { service, projectRepository, memberRepository } = buildService();

    await expect(
      service.create(
        {
          name: 'Cast Platform',
          repositories: ['cast/frontend', 'other/private'],
        },
        currentUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(projectRepository.save).not.toHaveBeenCalled();
    expect(memberRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it('returns not found for a project that is not owned by the current user', async () => {
    const { service, projectRepository } = buildService();
    projectRepository.findOne.mockResolvedValue(null);

    await expect(service.getById('other-project', currentUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(projectRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'other-project', ownerId: 'user-1', active: true },
    });
  });

  it('enqueues one index job per project repository', async () => {
    const { service, projectRepository, memberRepository, repositoriesService } = buildService();
    projectRepository.findOne.mockResolvedValue({ id: 'project-1', ownerId: 'user-1', active: true });
    memberRepository.find.mockResolvedValue([
      { projectId: 'project-1', owner: 'cast', name: 'frontend' },
      { projectId: 'project-1', owner: 'cast', name: 'backend' },
    ]);

    const result = await service.index('project-1', currentUser);

    expect(repositoriesService.enqueueIndexJob).toHaveBeenCalledTimes(2);
    expect(repositoriesService.enqueueIndexJob).toHaveBeenNthCalledWith(
      1,
      'frontend',
      currentUser,
      'cast',
    );
    expect(result.repositories).toHaveLength(2);
  });

  it('builds the project graph using current index SHAs and keeps unindexed members visible', async () => {
    const { service, projectRepository, memberRepository, repositoriesService, aiApiClient } = buildService();
    projectRepository.findOne.mockResolvedValue({ id: 'project-1', ownerId: 'user-1', active: true });
    memberRepository.find.mockResolvedValue([
      { projectId: 'project-1', owner: 'cast', name: 'frontend', fullName: 'cast/frontend' },
      { projectId: 'project-1', owner: 'cast', name: 'backend', fullName: 'cast/backend' },
    ]);
    repositoriesService.getRepositoryIndexStatus
      .mockResolvedValueOnce({ status: 'indexed', sha: 'front-sha', stale: false })
      .mockResolvedValueOnce({ status: 'not_indexed', sha: null, stale: false });
    aiApiClient.getProjectGraph.mockResolvedValue({ nodes: [], edges: [], stats: {} });

    await service.getGraph('project-1', currentUser);

    expect(aiApiClient.getProjectGraph).toHaveBeenCalledWith({
      projectId: 'project-1',
      repositories: [
        { repoId: 'cast/frontend', sha: 'front-sha' },
        { repoId: 'cast/backend', sha: null },
      ],
    });
  });

  it('keeps healthy repository statuses visible when one member lookup fails', async () => {
    const { service, projectRepository, memberRepository, repositoriesService } = buildService();
    projectRepository.findOne.mockResolvedValue({ id: 'project-1', ownerId: 'user-1', active: true });
    memberRepository.find.mockResolvedValue([
      { projectId: 'project-1', owner: 'cast', name: 'frontend', fullName: 'cast/frontend' },
      { projectId: 'project-1', owner: 'cast', name: 'backend', fullName: 'cast/backend' },
    ]);
    repositoriesService.getRepositoryIndexStatus
      .mockResolvedValueOnce({ status: 'indexed', sha: 'front-sha', stale: false })
      .mockRejectedValueOnce(new Error('GitHub unavailable'));

    const result = await service.getIndexStatus('project-1', currentUser);

    expect(result.repositories).toEqual([
      expect.objectContaining({ repository: 'cast/frontend', status: 'indexed', sha: 'front-sha' }),
      expect.objectContaining({
        repository: 'cast/backend',
        status: 'error',
        sha: null,
        errorMessage: 'Não foi possível consultar este repositório.',
      }),
    ]);
  });
});
