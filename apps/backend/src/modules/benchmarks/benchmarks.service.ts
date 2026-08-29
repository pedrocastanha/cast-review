import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import type { AgentRunRequest } from 'src/shared/types';
import type { UserService } from '../users/user.service';
import { AnalysisRepository } from '../analyses/analysis.repository';
import { AnalysisContextSnapshotRepository } from '../analyses/analysis-context-snapshot.repository';
import {
  applyReviewEvent,
  emptyReview,
} from '../analyses/helpers/apply-review-event';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { BenchmarkCase } from './benchmark-case.entity';
import { BenchmarkCaseRepository } from './benchmark-case.repository';
import type { BenchmarkModelResult } from './benchmark-run.entity';
import { BenchmarkRun } from './benchmark-run.entity';
import { BenchmarkRunRepository } from './benchmark-run.repository';

interface CreateCaseInput {
  title?: string;
}

interface RunCaseInput {
  models: string[];
}

@Injectable()
export class BenchmarksService {
  constructor(
    private readonly analysisRepository: AnalysisRepository,
    private readonly snapshotRepository: AnalysisContextSnapshotRepository,
    private readonly caseRepository: BenchmarkCaseRepository,
    private readonly runRepository: BenchmarkRunRepository,
    private readonly aiApiClient: AiApiClient,
    @Inject('USER_SERVICE')
    private readonly userService: UserService,
  ) {}

  async createFromAnalysis(
    analysisId: string,
    currentUser: CurrentUserData,
    input: CreateCaseInput,
  ): Promise<BenchmarkCase> {
    const analysis = await this.analysisRepository.findOne({
      where: { id: analysisId, requestedBy: currentUser.id },
    });
    if (!analysis) throw new NotFoundException('Análise não encontrada');

    const snapshotRow = await this.snapshotRepository.findOne({
      where: { analysisId },
    });
    if (!snapshotRow) {
      throw new BadRequestException(
        'A análise não possui contexto reproduzível',
      );
    }

    const title =
      input.title?.trim() ||
      `${analysis.owner}/${analysis.repo} #${analysis.pullNumber}`;
    return this.caseRepository.save(
      this.caseRepository.create({
        id: randomUUID(),
        slug: null,
        title,
        kind: 'private',
        evaluationMode: 'exploratory',
        ownerId: currentUser.id,
        source: {
          analysisId,
          owner: analysis.owner,
          repo: analysis.repo,
          pullNumber: analysis.pullNumber,
        },
        inputSnapshot: structuredClone(snapshotRow.graphSnapshot.input),
        graphSnapshot: structuredClone(snapshotRow.graphSnapshot),
        groundTruth: null,
        version: 1,
      }),
    );
  }

  listCases(currentUser: CurrentUserData): Promise<BenchmarkCase[]> {
    return this.caseRepository.find({
      where: [{ kind: 'curated' }, { ownerId: currentUser.id }],
      order: { createdAt: 'DESC' },
    });
  }

  async getCase(
    id: string,
    currentUser: CurrentUserData,
  ): Promise<BenchmarkCase> {
    const benchmarkCase = await this.caseRepository.findOne({ where: { id } });
    if (!benchmarkCase || !this.canAccess(benchmarkCase, currentUser.id)) {
      throw new NotFoundException('Caso de benchmark não encontrado');
    }
    return benchmarkCase;
  }

  async deleteCase(id: string, currentUser: CurrentUserData): Promise<void> {
    const benchmarkCase = await this.getCase(id, currentUser);
    if (benchmarkCase.kind === 'curated') {
      throw new ForbiddenException('Casos oficiais são somente leitura');
    }
    await this.caseRepository.delete({ id });
  }

  async listRuns(
    caseId: string,
    currentUser: CurrentUserData,
  ): Promise<BenchmarkRun[]> {
    await this.getCase(caseId, currentUser);
    return this.runRepository.find({
      where: { caseId, requestedBy: currentUser.id },
      order: { createdAt: 'DESC' },
    });
  }

  async runCase(
    caseId: string,
    currentUser: CurrentUserData,
    input: RunCaseInput,
  ): Promise<BenchmarkRun> {
    const benchmarkCase = await this.getCase(caseId, currentUser);
    const models = this.normalizeModels(input.models);
    const openaiKey = await this.userService.getOpenaiKey(currentUser.id);

    let run = await this.runRepository.save(
      this.runRepository.create({
        id: randomUUID(),
        caseId,
        requestedBy: currentUser.id,
        status: 'running',
        models,
        promptVersion: 'review-pipeline-v1',
        graphSnapshotHash: benchmarkCase.graphSnapshot.snapshotHash,
        results: null,
        errorMessage: null,
        finishedAt: null,
      }),
    );

    const results: BenchmarkModelResult[] = [];
    for (const model of models) {
      results.push(
        await this.runModel(benchmarkCase, model, openaiKey),
      );
    }

    const failed = results.filter((result) => result.status === 'error');
    run = await this.runRepository.save({
      ...run,
      status: failed.length === results.length ? 'error' : 'completed',
      results,
      errorMessage:
        failed.length === results.length ? 'Todos os modelos falharam' : null,
      finishedAt: new Date(),
    });
    return run;
  }

  private async runModel(
    benchmarkCase: BenchmarkCase,
    model: string,
    openaiKey: string,
  ): Promise<BenchmarkModelResult> {
    const startedAt = Date.now();
    let report = emptyReview();
    try {
      const input = benchmarkCase.inputSnapshot;
      const payload: AgentRunRequest = {
        analysisId: randomUUID(),
        diff: input.diff,
        changedFiles: input.changedFiles,
        conventions: input.conventions,
        models: { testReviewer: model, architectureReviewer: model },
        apiKeys: { openai: openaiKey },
        policies: { prd: 'auto', spec: 'auto' },
        repoId: benchmarkCase.graphSnapshot.repository.repoId,
        sha: benchmarkCase.graphSnapshot.repository.requestedSha ?? undefined,
        frozenContext: { graphSnapshot: benchmarkCase.graphSnapshot },
      };
      for await (const event of this.aiApiClient.runAgent(
        payload,
        new AbortController().signal,
      )) {
        if (event.type === 'error') {
          throw new Error(String(event.payload.message ?? 'Falha no modelo'));
        }
        report = applyReviewEvent(report, event.type, event.payload);
      }
      return {
        model,
        status: 'completed',
        durationMs: Date.now() - startedAt,
        report,
        errorMessage: null,
      };
    } catch (err) {
      return {
        model,
        status: 'error',
        durationMs: Date.now() - startedAt,
        report: null,
        errorMessage: err instanceof Error ? err.message : 'Falha inesperada',
      };
    }
  }

  private normalizeModels(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException('Selecione ao menos um modelo');
    }
    const models = [
      ...new Set(
        value
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    if (models.length === 0 || models.length > 4) {
      throw new BadRequestException('Selecione entre 1 e 4 modelos');
    }
    return models;
  }

  private canAccess(benchmarkCase: BenchmarkCase, userId: string): boolean {
    return benchmarkCase.kind === 'curated' || benchmarkCase.ownerId === userId;
  }
}
