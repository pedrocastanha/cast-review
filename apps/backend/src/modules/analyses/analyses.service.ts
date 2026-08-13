import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import type { AnalysisRecord } from './analyses.types';
import { buildAgentRunRequest } from './helpers/context-builder.helper';
import { parsePullNumber, parseRunAnalysisBody } from './helpers/parse-run-input';

type RunInput = {
  repo: string;
  pullNumber: string;
  currentUser: CurrentUserData;
  body: unknown;
  owner?: string;
  req: Request;
  res: Response;
};

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

  async run({ repo, pullNumber: pullNumberRaw, currentUser, body, owner, req, res }: RunInput) {
    if (!repo?.trim()) {
      throw new BadRequestException('repo é obrigatório');
    }

    const pullNumber = parsePullNumber(pullNumberRaw);
    const dto = parseRunAnalysisBody(body);

    const analysisId = randomUUID();
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

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

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Analysis-Id': analysisId,
    });

    const writeEvent = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const payload = await buildAgentRunRequest(
        this.repositoriesService,
        repo,
        pullNumber,
        currentUser,
        dto,
        owner,
      );

      for await (const event of this.aiApiClient.runAgent(payload, abortController.signal)) {
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

        writeEvent(event);
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
      writeEvent({ type: 'error', payload: { message: 'Falha ao rodar a análise' } });
    } finally {
      res.end();
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
