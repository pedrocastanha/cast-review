export interface AiApiClientConfig {
  aiApiUrl: string;
  aiServiceToken: string;
}

export interface BuildIndexFile {
  path: string;
  content: string;
}

export interface BuildIndexInput {
  ownerId: string;
  repoId: string;
  sha: string;
  files: BuildIndexFile[];
}

export interface BuildIndexResult {
  indexId: string;
  indexedFiles: number;
  skippedFiles: number;
  reusedFiles: number;
  truncated: boolean;
  durationMs: number;
}

export interface IndexStatusParams {
  ownerId: string;
  repoId: string;
}

export interface IndexStatusResult {
  indexed: boolean;
  sha: string | null;
}

export interface GetRelatedContextInput {
  ownerId: string;
  repoId: string;
  sha: string;
  changedFiles: string[];
  tokenBudget?: number;
}

export interface AiApiClient {
  buildIndex(input: BuildIndexInput): Promise<BuildIndexResult>;
  getIndexStatus(params: IndexStatusParams): Promise<IndexStatusResult>;
  getRelatedContext(input: GetRelatedContextInput): Promise<unknown>;
}

async function rejectWithUpstreamError(response: Response): Promise<never> {
  const body = await response.text();
  throw new Error(
    `ai-api request failed with status ${response.status}: ${body}`,
  );
}

export function createAiApiClient(config: AiApiClientConfig): AiApiClient {
  const { aiApiUrl, aiServiceToken } = config;

  function buildHeaders(): Headers {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${aiServiceToken}`);
    headers.set('Content-Type', 'application/json');
    return headers;
  }

  return {
    async buildIndex(input) {
      const response = await fetch(`${aiApiUrl}/index/build`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(input),
        redirect: 'error',
      });
      if (!response.ok) {
        return rejectWithUpstreamError(response);
      }
      return (await response.json()) as BuildIndexResult;
    },

    async getIndexStatus(params) {
      const query = new URLSearchParams({
        repoId: params.repoId,
        ownerId: params.ownerId,
      });
      const response = await fetch(
        `${aiApiUrl}/index/status?${query.toString()}`,
        {
          method: 'GET',
          headers: buildHeaders(),
          redirect: 'error',
        },
      );
      if (!response.ok) {
        return rejectWithUpstreamError(response);
      }
      return (await response.json()) as IndexStatusResult;
    },

    async getRelatedContext(input) {
      const response = await fetch(`${aiApiUrl}/index/context`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(input),
        redirect: 'error',
      });
      if (!response.ok) {
        return rejectWithUpstreamError(response);
      }
      return response.json();
    },
  };
}
