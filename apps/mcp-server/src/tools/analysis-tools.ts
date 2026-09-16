import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { currentPrincipal } from '../auth/principal-context';
import type { createBackendClient } from '../clients/backend.client';

export interface RegisterAnalysisToolsDeps {
  backendClient: ReturnType<typeof createBackendClient>;
}

const impactScopeSchema = z.union([
  z.object({ mode: z.literal('repository') }),
  z.object({ mode: z.literal('project'), projectId: z.string() }),
]);

const modelsSchema = z.object({
  testReviewer: z.string(),
  architectureReviewer: z.string(),
});

const ANALYSIS_ID_HEADER = 'x-analysis-id';
const ANALYSIS_ID_STREAM_TIMEOUT_MS = 5000;

function errorResult(message: string): CallToolResult {
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

async function extractAnalysisIdFromStream(
  response: Response,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + ANALYSIS_ID_STREAM_TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        return null;
      }
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/"analysisId"\s*:\s*"([^"]+)"/);
      if (match) {
        return match[1];
      }
    }
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function registerAnalysisTools(
  server: McpServer,
  deps: RegisterAnalysisToolsDeps,
): void {
  const { backendClient } = deps;

  server.registerTool(
    'run_pr_analysis',
    {
      title: 'Run PR Analysis',
      description:
        'Starts an asynchronous code review analysis for a pull request and returns its analysisId.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number(),
        models: modelsSchema,
        impactScope: impactScopeSchema,
      },
    },
    async (args) => {
      const principal = currentPrincipal();
      const body = {
        models: args.models,
        impactScope: args.impactScope,
        policies: { publish: 'auto_safe' as const },
      };

      const response = await backendClient.runPrAnalysis(
        principal.actingJwt,
        args.owner,
        args.repo,
        String(args.pullNumber),
        body,
      );

      if (!response.ok) {
        const text = await response.text();
        return errorResult(text);
      }

      const headerAnalysisId = response.headers.get(ANALYSIS_ID_HEADER);
      if (headerAnalysisId) {
        await response.body?.cancel().catch(() => undefined);
        return jsonResult({ analysisId: headerAnalysisId, status: 'running' });
      }

      const analysisId = await extractAnalysisIdFromStream(response);
      if (!analysisId) {
        return errorResult(
          'could not determine analysisId from the analysis stream',
        );
      }
      return jsonResult({ analysisId, status: 'running' });
    },
  );

  server.registerTool(
    'get_analysis',
    {
      title: 'Get Analysis',
      description:
        'Fetches the current state of a previously started analysis.',
      inputSchema: {
        analysisId: z.string(),
      },
    },
    async (args) => {
      const principal = currentPrincipal();
      try {
        const result = await backendClient.getAnalysis(
          principal.actingJwt,
          args.analysisId,
        );
        return jsonResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('404')) {
          return errorResult('analysis not found');
        }
        return errorResult(message);
      }
    },
  );
}
