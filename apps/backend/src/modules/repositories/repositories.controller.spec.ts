// `@octokit/rest` é ESM-only e não totalmente coberto pelo `transformIgnorePatterns`
// do Jest deste projeto (ver `repositories.service.spec.ts`) — o controller importa
// `RepositoriesService` transitivamente, que importa `UserService`, que usa Octokit.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { RepositoriesController } from './repositories.controller';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeRepositoriesService() {
  return {
    listRepos: jest.fn().mockResolvedValue(['repo']),
    listPulls: jest.fn().mockResolvedValue(['pull']),
    getPullByNumber: jest.fn().mockResolvedValue({ id: 1 }),
    enqueueIndexJob: jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
    getRepositoryIndexStatus: jest
      .fn()
      .mockResolvedValue({ status: 'not_indexed', sha: null, stale: false }),
    getRepositoryGraph: jest
      .fn()
      .mockResolvedValue({ nodes: [], edges: [], stats: { indexed: false } }),
  } as any;
}

describe('RepositoriesController', () => {
  it('listUserRepositories delegates to the service with the current user', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    const result = await controller.listUserRepositories(currentUser);

    expect(service.listRepos).toHaveBeenCalledWith(currentUser);
    expect(result).toEqual(['repo']);
  });

  it('listPulls forwards the repo, current user and owner query param', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    await controller.listPulls('hello-world', currentUser, 'some-org');

    expect(service.listPulls).toHaveBeenCalledWith(
      'hello-world',
      currentUser,
      'some-org',
    );
  });

  it('getPullByNumber forwards repo, pull number, current user and owner', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    await controller.getPullByNumber('hello-world', 7, currentUser, undefined);

    expect(service.getPullByNumber).toHaveBeenCalledWith(
      'hello-world',
      7,
      currentUser,
      undefined,
    );
  });

  it('indexRepository enqueues an index job for the repo', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    const result = await controller.indexRepository(
      'hello-world',
      currentUser,
      undefined,
    );

    expect(service.enqueueIndexJob).toHaveBeenCalledWith(
      'hello-world',
      currentUser,
      undefined,
    );
    expect(result).toEqual({ jobId: 'job-1', status: 'queued' });
  });

  it('getIndexStatus forwards to getRepositoryIndexStatus', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    await controller.getIndexStatus('hello-world', currentUser, 'some-org');

    expect(service.getRepositoryIndexStatus).toHaveBeenCalledWith(
      'hello-world',
      currentUser,
      'some-org',
    );
  });

  it('getGraph converts the depth query string to a number before forwarding', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    await controller.getGraph(
      'hello-world',
      currentUser,
      'some-org',
      'sha1',
      'focus-id',
      '2',
    );

    expect(service.getRepositoryGraph).toHaveBeenCalledWith(
      'hello-world',
      currentUser,
      'some-org',
      'sha1',
      'focus-id',
      2,
    );
  });

  it('getGraph leaves depth undefined when the query param is absent', async () => {
    const service = fakeRepositoriesService();
    const controller = new RepositoriesController(service);

    await controller.getGraph('hello-world', currentUser);

    expect(service.getRepositoryGraph).toHaveBeenCalledWith(
      'hello-world',
      currentUser,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });
});
