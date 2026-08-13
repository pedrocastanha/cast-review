import type { AgentEvent, AnalysisRecord, RunAnalysisPayload } from '../types';
import { authorizedFetch, request } from './http';

function parseSseChunk(rawEvent: string): AgentEvent | null {
  const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(5).trim()) as AgentEvent;
  } catch {
    return null;
  }
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

    if (!response.body) {
      throw new Error('Resposta sem corpo (SSE).');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const rawEvents = buffer.split('\n\n');
        buffer = rawEvents.pop() ?? '';

        for (const rawEvent of rawEvents) {
          const event = parseSseChunk(rawEvent);
          if (event) yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
