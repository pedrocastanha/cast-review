import { Injectable } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { AgentEvent, AgentRunRequest } from 'src/shared/types';

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
