import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Express, type Request, type Response } from 'express';
import {
  createMcpAuthMiddleware,
  type RequestWithMcpPrincipal,
} from '../auth/mcp-auth.middleware';
import { runWithPrincipal } from '../auth/principal-context';
import { createAiApiClient } from '../clients/ai-api.client';
import { createBackendClient } from '../clients/backend.client';
import { loadConfig } from '../config';
import { createMcpRateLimiters } from '../rate-limit';
import { registerAnalysisTools } from '../tools/analysis-tools';
import { registerIndexTools } from '../tools/index-tools';

interface PackageJson {
  name: string;
  version: string;
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'),
) as PackageJson;

export interface McpToolDeps {
  aiApiClient: ReturnType<typeof createAiApiClient>;
  backendClient: ReturnType<typeof createBackendClient>;
}

export function registerTools(server: McpServer, deps: McpToolDeps): void {
  registerIndexTools(server, { aiApiClient: deps.aiApiClient });
  registerAnalysisTools(server, { backendClient: deps.backendClient });
}

export function createMcpServer(deps: McpToolDeps): McpServer {
  const server = new McpServer({
    name: 'cast-mcp-server',
    version: packageJson.version,
  });

  registerTools(server, deps);

  return server;
}

function extractSessionId(req: Request): string | undefined {
  const header = req.headers['mcp-session-id'];
  return Array.isArray(header) ? header[0] : header;
}

export function mountMcpTransport(app: Express): void {
  const config = loadConfig();
  const toolDeps: McpToolDeps = {
    aiApiClient: createAiApiClient({
      aiApiUrl: config.aiApiUrl,
      aiServiceToken: config.aiServiceToken ?? '',
    }),
    backendClient: createBackendClient({ backendUrl: config.backendUrl }),
  };

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const router = express.Router();
  router.use(express.json());
  router.use(createMcpRateLimiters(config));
  router.use(createMcpAuthMiddleware(config));

  router.post('/', async (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          transports.set(initializedSessionId, newTransport);
        },
      });

      newTransport.onclose = () => {
        const closedSessionId = newTransport.sessionId;
        if (closedSessionId) transports.delete(closedSessionId);
      };

      transport = newTransport;

      const server = createMcpServer(toolDeps);
      await server.connect(transport);
    }

    const principal = (req as RequestWithMcpPrincipal).mcpPrincipal;
    if (!principal) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    await runWithPrincipal(principal, () =>
      transport.handleRequest(req, res, req.body),
    );
  });

  const sessionRequestHandler = async (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const principal = (req as RequestWithMcpPrincipal).mcpPrincipal;
    if (!principal) {
      res.status(401).send('Unauthorized');
      return;
    }

    await runWithPrincipal(principal, () => transport.handleRequest(req, res));
  };

  router.get('/', sessionRequestHandler);
  router.delete('/', sessionRequestHandler);

  app.use('/mcp', router);
}
