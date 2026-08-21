import { Injectable } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type {
  AgentEvent,
  AgentResumeRequest,
  AgentRunRequest,
  IndexBuildRequest,
  IndexBuildResult,
  IndexStatusResult,
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

  async *runAgent(
    payload: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const response = await fetch(`${resolveAiApiUrl()}/agent/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) {
      this.logger.error('ai-api respondeu com falha ao iniciar o agente', {
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
          const event = this.parseEvent(rawEvent);
          if (event) yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *resumeAgent(
    payload: AgentResumeRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const response = await fetch(`${resolveAiApiUrl()}/agent/resume`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) {
      this.logger.error('ai-api respondeu com falha ao retomar o agente', {
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
          const event = this.parseEvent(rawEvent);
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
