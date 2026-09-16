import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { currentPrincipal } from '../auth/principal-context';
import type { createAiApiClient } from '../clients/ai-api.client';

export interface RegisterIndexToolsDeps {
  aiApiClient: ReturnType<typeof createAiApiClient>;
}

function notAuthorizedResult(ownerId: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `not authorized for this ownerId: ${ownerId}`,
      },
    ],
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

function isOwnerAuthorized(ownerId: string): boolean {
  return ownerId === currentPrincipal().userId;
}

export function registerIndexTools(
  server: McpServer,
  deps: RegisterIndexToolsDeps,
): void {
  const { aiApiClient } = deps;

  server.registerTool(
    'index_repository',
    {
      title: 'Index Repository',
      description:
        'Triggers incremental indexing of a repository already known to the Cast code graph.',
      inputSchema: {
        ownerId: z.string(),
        repoId: z.string(),
        sha: z.string(),
        files: z.array(
          z.object({
            path: z.string(),
            content: z.string(),
          }),
        ),
      },
    },
    async (args) => {
      if (!isOwnerAuthorized(args.ownerId)) {
        return notAuthorizedResult(args.ownerId);
      }

      try {
        const result = await aiApiClient.buildIndex(args);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_index_status',
    {
      title: 'Get Index Status',
      description:
        'Returns whether a repository has been indexed and its most recent indexed sha.',
      inputSchema: {
        ownerId: z.string(),
        repoId: z.string(),
      },
    },
    async (args) => {
      if (!isOwnerAuthorized(args.ownerId)) {
        return notAuthorizedResult(args.ownerId);
      }

      try {
        const result = await aiApiClient.getIndexStatus(args);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_related_context',
    {
      title: 'Get Related Context',
      description:
        'Returns the code graph context related to a set of changed files for an indexed repository.',
      inputSchema: {
        ownerId: z.string(),
        repoId: z.string(),
        sha: z.string(),
        changedFiles: z.array(z.string()),
        tokenBudget: z.number().optional(),
      },
    },
    async (args) => {
      if (!isOwnerAuthorized(args.ownerId)) {
        return notAuthorizedResult(args.ownerId);
      }

      try {
        const result = await aiApiClient.getRelatedContext(args);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
