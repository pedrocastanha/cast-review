import type {
  ChatEvent,
  ChatFile,
  ChatThread,
  SendChatMessagePayload,
} from '../types';
import { authorizedFetch, request } from './http';
import { consumeSseStream } from './sse';

export type CreateChatThreadPayload =
  | { mode: 'global' }
  | { mode: 'repository'; repoId: string };

export const chatApi = {
  create: (scope: CreateChatThreadPayload) =>
    request<ChatThread>('/chat/threads', { method: 'POST', body: { scope } }),

  list: (filters: { repoId?: string; projectId?: string }) => {
    const params = new URLSearchParams();
    if (filters.repoId) params.set('repoId', filters.repoId);
    if (filters.projectId) params.set('projectId', filters.projectId);
    const query = params.toString();
    return request<ChatThread[]>(`/chat/threads${query ? `?${query}` : ''}`);
  },

  get: (id: string) => request<ChatThread>(`/chat/threads/${encodeURIComponent(id)}`),

  rename: (id: string, title: string) =>
    request<ChatThread>(`/chat/threads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { title },
    }),

  remove: (id: string) =>
    request<void>(`/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listFiles: (id: string, query: string, limit = 30) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query) params.set('query', query);
    return request<ChatFile[]>(
      `/chat/threads/${encodeURIComponent(id)}/files?${params.toString()}`,
    );
  },

  async *sendMessage(
    id: string,
    payload: SendChatMessagePayload,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const response = await authorizedFetch(
      `/chat/threads/${encodeURIComponent(id)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
        signal,
      },
    );

    yield* consumeSseStream<ChatEvent>(response);
  },
};
