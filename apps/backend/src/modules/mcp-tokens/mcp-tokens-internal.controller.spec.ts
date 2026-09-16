import { UnauthorizedException } from '@nestjs/common';
import { currentDbActor } from '../../shared/database/postgres/db-actor';
import { IntrospectMcpTokenDto } from './dtos/introspect-mcp-token.dto';
import { McpTokensInternalController } from './mcp-tokens-internal.controller';

function fakeMcpTokensService() {
  return {
    issue: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    introspect: jest.fn(),
  } as any;
}

describe('McpTokensInternalController', () => {
  it('delegates to service.introspect with the token and returns its result', async () => {
    const service = fakeMcpTokensService();
    const introspected = {
      userId: 'user-1',
      projectIds: ['project-1'],
      scopes: ['index:read', 'index:write', 'analyses:read', 'analyses:write'],
      actingJwt: 'eyJ...',
      actingJwtExpiresAt: new Date('2026-09-16T12:02:00.000Z'),
    };
    service.introspect.mockResolvedValue(introspected);
    const controller = new McpTokensInternalController(service);
    const dto: IntrospectMcpTokenDto = { token: 'mcp_raw' };

    const result = await controller.introspect(dto);

    expect(service.introspect).toHaveBeenCalledWith('mcp_raw');
    expect(result).toEqual(introspected);
  });

  it('propagates an UnauthorizedException thrown by the service unmodified', async () => {
    const service = fakeMcpTokensService();
    service.introspect.mockRejectedValue(
      new UnauthorizedException('Token MCP inválido ou expirado'),
    );
    const controller = new McpTokensInternalController(service);
    const dto: IntrospectMcpTokenDto = { token: 'mcp_bad' };

    await expect(controller.introspect(dto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('runs the service call inside a service actor scope', async () => {
    const service = fakeMcpTokensService();
    let observedActor: { userId: string | null; actorType: string } | null =
      null;
    service.introspect.mockImplementation(async () => {
      observedActor = currentDbActor();
      return {
        userId: 'user-1',
        projectIds: [],
        scopes: [],
        actingJwt: 'eyJ...',
        actingJwtExpiresAt: new Date(),
      };
    });
    const controller = new McpTokensInternalController(service);

    await controller.introspect({ token: 'mcp_raw' });

    expect(observedActor).toEqual({ userId: null, actorType: 'service' });
  });
});
