import type {
  AgentEvent,
  AnalysisContextSnapshot,
  Annotation,
  AnalysisRecord,
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
