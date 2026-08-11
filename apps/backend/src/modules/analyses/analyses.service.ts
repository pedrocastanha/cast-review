import { Injectable, NotFoundException } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { AgentEvent } from 'src/shared/types';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import type { AnalysisRecord } from './analyses.types';
import type { RunAnalysisDto } from './dtos/run-analysis.dto';
import { buildAgentRunRequest } from './helpers/context-builder.helper';

/**
 * Orquestra uma execução: builda contexto, chama o ai-api, mantém o estado
 * do run em memória (sem persistência — decisão do PRD/ADR do ai-api).
 */
@Injectable()
export class AnalysesService extends BaseService {
  private readonly records = new Map<string, AnalysisRecord>();

  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly aiApiClient: AiApiClient,
    logger: AppLogger,
  ) {
    super(logger);
  }

  async *run(
    analysisId: string,
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    dto: RunAnalysisDto,
    signal: AbortSignal,
    owner?: string,
  ): AsyncGenerator<AgentEvent> {
    const record: AnalysisRecord = {
      id: analysisId,
      requestedBy: currentUser.id,
      owner: owner ?? '',
      repo,
      pullNumber,
      status: 'running',
      report: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };

    this.records.set(record.id, record);

    try {
      const payload = await buildAgentRunRequest(
        this.repositoriesService,
        repo,
        pullNumber,
        currentUser,
        dto,
        owner,
      );

      for await (const event of this.aiApiClient.runAgent(payload, signal)) {
        if (event.type === 'report_ready') {
          record.status = 'completed';
          record.report = event.payload;
          record.finishedAt = new Date().toISOString();
        }

        if (event.type === 'error') {
          record.status = 'error';
          record.errorMessage = String(
            event.payload.message ?? 'Falha no pipeline de agentes',
          );
          record.finishedAt = new Date().toISOString();
        }

        yield event;
      }
    } catch (err) {
      record.status = 'error';
      record.errorMessage =
        err instanceof Error ? err.message : 'Falha inesperada na análise';
      record.finishedAt = new Date().toISOString();
      this.logger.error('Falha ao rodar análise', {
        exception: err,
        analysisId: record.id,
      });
      throw err;
    }
  }

  listForUser(currentUser: CurrentUserData): AnalysisRecord[] {
    return Array.from(this.records.values())
      .filter((record) => record.requestedBy === currentUser.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getByIdForUser(id: string, currentUser: CurrentUserData): AnalysisRecord {
    const record = this.records.get(id);

    if (!record || record.requestedBy !== currentUser.id) {
      throw new NotFoundException('Análise não encontrada');
    }

    return record;
  }
}
