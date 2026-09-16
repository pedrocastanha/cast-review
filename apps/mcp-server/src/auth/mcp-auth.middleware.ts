import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../config';
import {
  createIntrospectClient,
  IntrospectionFailedError,
  type McpPrincipal,
} from './introspect-client';

export interface RequestWithMcpPrincipal extends Request {
  mcpPrincipal?: McpPrincipal;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token.trim() || null;
}

export function createMcpAuthMiddleware(
  config: Pick<
    Config,
    'backendUrl' | 'aiServiceToken' | 'mcpTokenCacheTtlSeconds'
  >,
): RequestHandler {
  const introspectClient = createIntrospectClient(config);

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const principal = await introspectClient.introspect(token);
      (req as RequestWithMcpPrincipal).mcpPrincipal = principal;
      next();
    } catch (error) {
      if (error instanceof IntrospectionFailedError) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      throw error;
    }
  };
}
