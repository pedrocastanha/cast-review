import { Injectable } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type {
  AgentEvent,
  AgentResumeRequest,
  AgentRunRequest,
  ChatEvent,
  ChatRunRequest,
  IndexBuildRequest,
  IndexBuildResult,
  IndexFileResult,
  IndexFilesResult,
  IndexStatusResult,
  ProjectGraphRequest,
  ProjectGraphResult,
  VizGraph,
} from 'src/shared/types';

const DEFAULT_AI_API_URL = 'http://localhost:8000';

function resolveAiApiUrl(): string {
  // dotenv hidrata process.env depois do import deste arquivo
  return process.env.AI_API_URL?.trim() || DEFAULT_AI_API_URL;
}

@Injectable()
export class AiApiClient {
  constructor(private readonly logger: AppLogger) {}

  runAgent(
    payload: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    return this.streamEvents<AgentEvent>(
      '/agent/run',
      payload,
      signal,
      'iniciar o agente',
    );
  }

  resumeAgent(
    payload: AgentResumeRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    return this.streamEvents<AgentEvent>(
      '/agent/resume',
      payload,
      signal,
      'retomar o agente',
    );
  }

  runChat(
    payload: ChatRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    return this.streamEvents<ChatEvent>(
      '/chat/run',
      payload,
      signal,
      'iniciar o chat',
    );
  }

  private async *streamEvents<T>(
    path: string,
    payload: unknown,
    signal: AbortSignal,
    action: string,
  ): AsyncGenerator<T> {
    const response = await fetch(`${resolveAiApiUrl()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) {
      this.logger.error(`ai-api respondeu com falha ao ${action}`, {
        status: response.status,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
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
          const event = this.parseEvent(rawEvent) as T | null;
          if (event) yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async buildIndex(payload: IndexBuildRequest): Promise<IndexBuildResult> {
    const response = await fetch(`${resolveAiApiUrl()}/index/build`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.logger.error('ai-api respondeu com falha ao indexar repositório', {
        status: response.status,
        repoId: payload.repoId,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
    }

    return (await response.json()) as IndexBuildResult;
  }

  async getIndexStatus(repoId: string): Promise<IndexStatusResult> {
    const response = await fetch(
      `${resolveAiApiUrl()}/index/status?repoId=${encodeURIComponent(repoId)}`,
    );

    if (!response.ok) {
      this.logger.error('ai-api respondeu com falha ao consultar status de índice', {
        status: response.status,
        repoId,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
    }

    return (await response.json()) as IndexStatusResult;
  }

  async getGraph(
    repoId: string,
    sha: string,
    focus?: string,
    depth?: number,
  ): Promise<VizGraph> {
    const params = new URLSearchParams({ repoId, sha });
    if (focus) params.set('focus', focus);
    if (depth !== undefined) params.set('depth', String(depth));

    const response = await fetch(`${resolveAiApiUrl()}/index/graph?${params.toString()}`);

    if (!response.ok) {
      this.logger.error('ai-api respondeu com falha ao buscar grafo de visualização', {
        status: response.status,
        repoId,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
    }

    return (await response.json()) as VizGraph;
  }

  async getProjectGraph(
    payload: ProjectGraphRequest,
  ): Promise<ProjectGraphResult> {
    const response = await fetch(`${resolveAiApiUrl()}/index/project/graph`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.logger.error('ai-api respondeu com falha ao buscar grafo do projeto', {
        status: response.status,
        projectId: payload.projectId,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
    }

    return (await response.json()) as ProjectGraphResult;
  }

  async getIndexFile(
    repoId: string,
    sha: string,
    path: string,
  ): Promise<IndexFileResult | null> {
    const params = new URLSearchParams({ repoId, sha, path });
    const response = await fetch(
      `${resolveAiApiUrl()}/index/file?${params.toString()}`,
    );

    if (response.status === 404) return null;

    if (!response.ok) {
      this.logger.error('ai-api respondeu com falha ao buscar arquivo do índice', {
        status: response.status,
        repoId,
        path,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
    }

    return (await response.json()) as IndexFileResult;
  }

  async listIndexFiles(
    repoId: string,
    sha: string,
    query?: string,
    limit?: number,
  ): Promise<IndexFilesResult> {
    const params = new URLSearchParams({ repoId, sha });
    if (query) params.set('query', query);
    if (limit !== undefined) params.set('limit', String(limit));

    const response = await fetch(
      `${resolveAiApiUrl()}/index/files?${params.toString()}`,
    );

    if (response.status === 404) {
      return { repoId, sha, paths: [] };
    }

    if (!response.ok) {
      this.logger.error('ai-api respondeu com falha ao listar arquivos do índice', {
        status: response.status,
        repoId,
      });
      throw new Error(`ai-api indisponível (status ${response.status})`);
    }

    return (await response.json()) as IndexFilesResult;
  }

  private parseEvent(rawEvent: string): AgentEvent | null {
    const dataLine = rawEvent
      .split('\n')
      .find((line) => line.startsWith('data:'));
    if (!dataLine) return null;

    try {
      return JSON.parse(dataLine.slice(5).trim()) as AgentEvent;
    } catch (err) {
      this.logger.error('Evento SSE inválido recebido do ai-api', {
        exception: err,
        rawEvent,
      });
      return null;
    }
  }
}
