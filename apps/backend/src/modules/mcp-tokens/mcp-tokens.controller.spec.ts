import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CreateMcpTokenDto } from './dtos/create-mcp-token.dto';
import { McpTokensController } from './mcp-tokens.controller';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeMcpTokensService() {
  return {
    issue: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    introspect: jest.fn(),
  } as any;
}

describe('McpTokensController', () => {
  it('issue delegates to service.issue with the current user id, projectIds and no expiresAt', async () => {
    const service = fakeMcpTokensService();
    const issued = {
      id: 'token-1',
      token: 'mcp_raw',
      expiresAt: new Date('2026-09-23T00:00:00.000Z'),
    };
    service.issue.mockResolvedValue(issued);
    const controller = new McpTokensController(service);
    const dto: CreateMcpTokenDto = { projectIds: ['project-1'] };

    const result = await controller.issue(dto, currentUser);

    expect(service.issue).toHaveBeenCalledWith(
      currentUser.id,
      dto.projectIds,
      undefined,
    );
    expect(result).toEqual(issued);
  });

  it('issue converts a provided expiresAt string into a Date before delegating', async () => {
    const service = fakeMcpTokensService();
    service.issue.mockResolvedValue({
      id: 'token-2',
      token: 'mcp_raw2',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    const controller = new McpTokensController(service);
    const dto: CreateMcpTokenDto = {
      projectIds: ['project-1', 'project-2'],
      expiresAt: '2026-10-01T00:00:00.000Z',
    };

    await controller.issue(dto, currentUser);

    expect(service.issue).toHaveBeenCalledWith(
      currentUser.id,
      dto.projectIds,
      new Date('2026-10-01T00:00:00.000Z'),
    );
  });

  it('list delegates to service.list with the current user id and omits tokenHash from every item', async () => {
    const service = fakeMcpTokensService();
    service.list.mockResolvedValue([
      {
        id: 'token-1',
        userId: 'user-1',
        tokenHash: 'secret-hash-1',
        projectIds: ['project-1'],
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        expiresAt: new Date('2026-09-23T00:00:00.000Z'),
        revokedAt: null,
      },
      {
        id: 'token-2',
        userId: 'user-1',
        tokenHash: 'secret-hash-2',
        projectIds: ['project-2'],
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
        expiresAt: new Date('2026-09-17T00:00:00.000Z'),
        revokedAt: new Date('2026-09-15T00:00:00.000Z'),
      },
    ]);
    const controller = new McpTokensController(service);

    const result = await controller.list(currentUser);

    expect(service.list).toHaveBeenCalledWith(currentUser.id);
    expect(result).toEqual([
      {
        id: 'token-1',
        projectIds: ['project-1'],
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        expiresAt: new Date('2026-09-23T00:00:00.000Z'),
        revokedAt: null,
      },
      {
        id: 'token-2',
        projectIds: ['project-2'],
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
        expiresAt: new Date('2026-09-17T00:00:00.000Z'),
        revokedAt: new Date('2026-09-15T00:00:00.000Z'),
      },
    ]);
    for (const item of result) {
      expect(item).not.toHaveProperty('tokenHash');
    }
  });

  it('revoke delegates to service.revoke with the token id', async () => {
    const service = fakeMcpTokensService();
    service.revoke.mockResolvedValue(undefined);
    const controller = new McpTokensController(service);

    await controller.revoke('token-1');

    expect(service.revoke).toHaveBeenCalledWith('token-1');
  });

  it('revoke propagates NotFoundException thrown by the service', async () => {
    const service = fakeMcpTokensService();
    service.revoke.mockRejectedValue(
      new NotFoundException('Token MCP não encontrado'),
    );
    const controller = new McpTokensController(service);

    await expect(controller.revoke('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
