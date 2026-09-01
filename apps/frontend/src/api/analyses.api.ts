import type {
  AgentEvent,
  AnalysisContextSnapshot,
  Annotation,
  AnalysisRecord,
  FindingDisposition,
  FindingLifecycleListResponse,
  FindingLifecycleView,
  RunAnalysisPayload,
} from '../types';
import { authorizedFetch, request } from './http';
import { consumeSseStream } from './sse';

export interface ResumeAnalysisPayload {
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
}

export interface ApproveStagePayload {
  stage: 'prd' | 'spec';
  decision: 'approve' | 'reject';
  annotations?: Annotation[];
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
}

export interface ApprovePublishPayload {
  decision: 'approve' | 'reject';
}

export const analysesApi = {
  list: () => request<AnalysisRecord[]>('/analyses'),

  listByRepo: (owner: string, repo: string, pullNumber?: number) => {
    const params = new URLSearchParams({ owner });
    if (pullNumber !== undefined) params.set('pullNumber', String(pullNumber));
    return request<AnalysisRecord[]>(
      `/repositories/${encodeURIComponent(repo)}/analyses?${params.toString()}`,
    );
  },

  getById: (id: string) => request<AnalysisRecord>(`/analyses/${encodeURIComponent(id)}`),

  getContextSnapshot: (id: string) =>
    request<AnalysisContextSnapshot>(
      `/analyses/${encodeURIComponent(id)}/context-snapshot`,
    ),

  getFindingLifecycle: (
    analysisId: string,
    query: { view?: FindingLifecycleView; limit?: number; cursor?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.view) params.set('view', query.view);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request<FindingLifecycleListResponse>(
      `/analyses/${encodeURIComponent(analysisId)}/finding-lifecycle${suffix}`,
    );
  },

  updateFindingDisposition: (
    caseId: string,
    payload: { disposition: FindingDisposition; note?: string | null },
  ) =>
    request<{
      id: string;
      state: 'active' | 'resolved';
      disposition: FindingDisposition;
      dispositionNote: string | null;
      updatedAt: string;
    }>(`/finding-cases/${encodeURIComponent(caseId)}/disposition`, {
      method: 'PUT',
      body: payload,
    }),

  async *run(
    repo: string,
    pullNumber: number,
    owner: string,
    payload: RunAnalysisPayload,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const path =
      `/repositories/${encodeURIComponent(repo)}/pulls/${pullNumber}/analyses` +
      `?owner=${encodeURIComponent(owner)}`;

    const response = await authorizedFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    yield* consumeSseStream<AgentEvent>(response);
  },

  async *resume(
    analysisId: string,
    payload: ResumeAnalysisPayload,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const response = await authorizedFetch(`/analyses/${encodeURIComponent(analysisId)}/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    yield* consumeSseStream<AgentEvent>(response);
  },

  async *approveStage(
    analysisId: string,
    payload: ApproveStagePayload,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const response = await authorizedFetch(`/analyses/${encodeURIComponent(analysisId)}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    yield* consumeSseStream<AgentEvent>(response);
  },

  approvePublish: (analysisId: string, payload: ApprovePublishPayload) =>
    request<AnalysisRecord>(`/analyses/${encodeURIComponent(analysisId)}/approve`, {
      method: 'POST',
      body: { stage: 'publish', ...payload },
    }),
};
