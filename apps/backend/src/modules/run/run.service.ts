/**
 * RunService — orquestra uma execução de review.
 *
 * PAPEL NO SISTEMA
 * ----------------
 * Único módulo Nest que conhece o serviço Python (ai-api).
 * Auth/Github/ContextBuilder não sabem que o Python existe.
 *
 * Fluxo de uma run
 * ----------------
 * 1. ContextBuilder monta diff + conventions + changedFiles (GitHub).
 * 2. POST /agent/run no Python com models + apiKeys.
 * 3. Lê o stream SSE linha a linha.
 * 4. Para cada evento JSON, chama o callback (o Gateway emite no WS).
 * 5. Se report_ready, guarda em Map em memória (SPEC).
 *
 * API keys
 * --------
 * Passam só no body desta request. Não logamos o body.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ContextBuilderService } from '../context-builder/context-builder.service';
import type {
  AgentEvent,
  StartRunMessage,
  StoredReport,
} from '../../shared/types';

@Injectable()
export class RunService {
  private readonly logger = new Logger(RunService.name);

  /**
   * URL base do ai-api.
   * Override por env AI_API_URL (ex.: http://localhost:8000).
   */
  private readonly aiApiUrl =
    process.env.AI_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

  /** Cache em memória de relatórios — vive só enquanto o processo Nest está de pé. */
  private readonly reports = new Map<string, StoredReport>();

  constructor(private readonly contextBuilder: ContextBuilderService) {}

  /**
   * Executa a run completa e invoca ``onEvent`` a cada evento do Python.
   *
   * @returns runId gerado localmente (útil pro front correlacionar).
   */
  async startRun(
    message: StartRunMessage,
    onEvent: (event: AgentEvent & { runId: string }) => void | Promise<void>,
  ): Promise<string> {
    const runId = randomUUID();

    this.logger.log(
      `Starting run ${runId} for ${message.owner}/${message.repo}#${message.pullNumber}`,
    );

    // 1) Contexto rico via GitHub (determinístico).
    const ctx = await this.contextBuilder.buildForPullRequest({
      token: message.githubToken,
      owner: message.owner,
      repo: message.repo,
      pullNumber: message.pullNumber,
    });

    // 2) Payload alinhado a schemas.AgentRunRequest (Python).
    const body = {
      diff: ctx.diff,
      changedFiles: ctx.changedFiles,
      conventions: ctx.conventions,
      models: message.models,
      apiKeys: message.apiKeys,
    };

    // 3) Abre POST com stream e lê SSE.
    const response = await fetch(`${this.aiApiUrl}/agent/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      const errorEvent: AgentEvent & { runId: string } = {
        runId,
        type: 'error',
        payload: {
          step: 'run_service',
          message: `ai-api HTTP ${response.status}: ${text.slice(0, 500)}`,
        },
      };
      await onEvent(errorEvent);
      return runId;
    }

    // Node 18+ / undici: body é ReadableStream.
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Eventos SSE separados por linha em branco (\n\n).
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLine = rawEvent
          .split('\n')
          .map((l) => l.trimEnd())
          .find((l) => l.startsWith('data:'));

        if (!dataLine) continue;

        const jsonStr = dataLine.replace(/^data:\s?/, '').trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr) as AgentEvent;
          const event = { ...parsed, runId };
          await onEvent(event);

          // SPEC: Nest guarda report_ready em memória.
          if (parsed.type === 'report_ready') {
            this.reports.set(runId, {
              runId,
              owner: message.owner,
              repo: message.repo,
              pullNumber: message.pullNumber,
              report: parsed.payload,
              createdAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          this.logger.warn(`Failed to parse SSE chunk: ${String(err)}`);
        }
      }
    }

    this.logger.log(`Run ${runId} stream finished`);
    return runId;
  }

  /** Lê um relatório guardado (se ainda estiver em memória). */
  getReport(runId: string): StoredReport | undefined {
    return this.reports.get(runId);
  }

  /** Lista runIds em memória — útil pra debug local. */
  listReportIds(): string[] {
    return [...this.reports.keys()];
  }
}
