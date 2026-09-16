export interface BackendClientConfig {
  backendUrl: string;
}

export interface BackendClient {
  runPrAnalysis(
    actingJwt: string,
    owner: string,
    repo: string,
    pullNumber: string,
    body: unknown,
  ): Promise<Response>;
  getAnalysis(actingJwt: string, analysisId: string): Promise<unknown>;
}

async function rejectWithUpstreamError(response: Response): Promise<never> {
  const body = await response.text();
  throw new Error(
    `backend request failed with status ${response.status}: ${body}`,
  );
}

export function createBackendClient(
  config: BackendClientConfig,
): BackendClient {
  const { backendUrl } = config;

  function buildHeaders(actingJwt: string): Headers {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${actingJwt}`);
    headers.set('Content-Type', 'application/json');
    return headers;
  }

  return {
    async runPrAnalysis(actingJwt, owner, repo, pullNumber, body) {
      const query = new URLSearchParams({ owner });
      return fetch(
        `${backendUrl}/repositories/${repo}/pulls/${pullNumber}/analyses?${query.toString()}`,
        {
          method: 'POST',
          headers: buildHeaders(actingJwt),
          body: JSON.stringify(body),
          redirect: 'error',
        },
      );
    },

    async getAnalysis(actingJwt, analysisId) {
      const response = await fetch(`${backendUrl}/analyses/${analysisId}`, {
        method: 'GET',
        headers: buildHeaders(actingJwt),
        redirect: 'error',
      });
      if (!response.ok) {
        return rejectWithUpstreamError(response);
      }
      return response.json();
    },
  };
}
