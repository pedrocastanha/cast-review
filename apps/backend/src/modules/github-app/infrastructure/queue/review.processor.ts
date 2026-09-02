import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { FrozenImpactScope } from 'src/shared/types';
import { AnalysesService } from '../../../analyses/analyses.service';
import type { AnalysisReview, PublishPolicy } from '../../../analyses/analyses.types';
import { ProjectsService } from '../../../projects/projects.service';
import { UserService } from '../../../users/user.service';
import { CheckRunService } from '../github/check-run.service';
import { GithubAppService } from '../../github-app.service';
import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import type { GithubInstallation } from '../../entities/github-installation.entity';
import type { GithubReviewRun } from '../../entities/github-review-run.entity';
import { resolveGithubAppConfig } from '../../config/github-app.config';
import type { GithubReviewSkipReason } from '../../domain/github-app.types';
import {
  GITHUB_REVIEW_QUEUE,
  type GithubReviewJobData,
} from './github-review-queue.constants';
import {
  buildCompletedOutput,
  buildFailedOutput,
  buildSkippedOutput,
  buildSupersededOutput,
  conclusionFor,
} from '../../domain/check-run-output';
import {
  evaluateInstallation,
  evaluateRepository,
} from '../../domain/eligibility.rules';
import { InstallationGithubGateway } from '../github/installation-github.gateway';
import { InstallationTokenService } from '../github/installation-token.service';
import { GithubAppRepositoryRepository } from '../persistence/github-app-repository.repository';
import { GithubInstallationRepository } from '../persistence/github-installation.repository';
import { GithubReviewRunRepository } from '../persistence/github-review-run.repository';

const TERMINAL_STATUS = [
  'completed',
  'failed',
  'skipped',
  'superseded',
  'cancelled',
];

@Processor(GITHUB_REVIEW_QUEUE)
export class ReviewProcessor extends WorkerHost {
  constructor(
    private readonly reviewRunRepository: GithubReviewRunRepository,
    private readonly installationRepository: GithubInstallationRepository,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
    private readonly analysesService: AnalysesService,
    private readonly projectsService: ProjectsService,
    private readonly userService: UserService,
    private readonly tokenService: InstallationTokenService,
    private readonly checkRunService: CheckRunService,
    private readonly githubAppService: GithubAppService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job<GithubReviewJobData>): Promise<void> {
    const run = await this.reviewRunRepository.findOne({
      where: { id: job.data.reviewRunId },
    });
    if (!run) {
      this.logger.warn('Execução de revisão inexistente', {
        reviewRunId: job.data.reviewRunId,
      });
      return;
    }
    if (TERMINAL_STATUS.includes(run.status)) {
      this.logger.log('Execução já finalizada, job ignorado', {
        reviewRunId: run.id,
        status: run.status,
      });
      return;
    }

    await this.reviewRunRepository.update(run.id, {
      status: 'running',
      startedAt: run.startedAt ?? new Date(),
      attempts: run.attempts + 1,
    });

    const installation = await this.installationRepository.findOne({
      where: { id: run.installationId },
    });
    const repository = await this.appRepositoryRepository.findOne({
      where: { id: run.repositoryId },
    });

    const installationCheck = evaluateInstallation(installation);
    if (!installationCheck.eligible || !installation) {
      await this.skip(
        run,
        installationCheck.eligible
          ? 'installation_inactive'
          : (installationCheck.reason as GithubReviewSkipReason),
      );
      return;
    }
    const repositoryCheck = evaluateRepository(repository);
    if (!repositoryCheck.eligible || !repository) {
      await this.skip(
        run,
        repositoryCheck.eligible
          ? 'automation_disabled'
          : (repositoryCheck.reason as GithubReviewSkipReason),
      );
      return;
    }

    const gateway = new InstallationGithubGateway(
      this.tokenService,
      installation.installationId,
      repository.owner,
      this.botLogin(),
      this.logger,
    );

    const checkRun = await this.checkRunService.create({
      installationId: installation.installationId,
      owner: run.owner,
      repo: run.repo,
      headSha: run.headSha,
      status: 'in_progress',
    });
    if (checkRun) {
      await this.reviewRunRepository.update(run.id, { checkRun });
    }

    const reservation = this.githubAppService.budgetReservationFor(repository);
    const reserved = await this.githubAppService.reserveBudget(
      repository,
      run.id,
      reservation,
    );
    if (!reserved) {
      await this.skip(
        run,
        'budget_exceeded',
        checkRun?.id ?? null,
        installation,
      );
      return;
    }

    let openaiKey: string;
    try {
      openaiKey = await this.userService.getOpenaiKey(
        installation.ownerUserId as string,
      );
    } catch {
      await this.skip(
        run,
        'configuration_required',
        checkRun?.id ?? null,
        installation,
      );
      return;
    }

    const startedAt = Date.now();
    const abortController = new AbortController();
    const publishPolicy: PublishPolicy = {
      prd: 'auto',
      spec: 'auto',
      publish: repository.config.publishPolicy === 'comments' ? 'auto' : 'none',
    };

    try {
      const impactScope = await this.resolveScope(repository, installation);
      const { analysis, review } = await this.analysesService.runHeadless({
        requestedBy: installation.ownerUserId as string,
        owner: repository.owner,
        repo: repository.repo,
        pullNumber: run.pullNumber,
        headSha: run.headSha,
        origin: 'github_app',
        models: repository.config.models ?? {
          testReviewer: 'gpt-5.4-mini',
          architectureReviewer: 'gpt-5.4-mini',
        },
        impactScope,
        publishPolicy,
        openaiKey,
        github: gateway,
        signal: abortController.signal,
        beforePublish: () => this.publishGate(run, gateway),
      });

      await this.reviewRunRepository.update(run.id, {
        analysisId: analysis.id,
      });
      await this.githubAppService.settleBudget(run.id, review.usage?.costUsd ?? null);

      const current = await this.reviewRunRepository.findOne({
        where: { id: run.id },
      });
      if (current && current.status === 'superseded') {
        await this.finishSuperseded(run, installation, checkRun?.id ?? null);
        return;
      }

      const headSha = await this.currentHeadSha(gateway, run);
      if (headSha && headSha !== run.headSha) {
        await this.reviewRunRepository.update(run.id, {
          status: 'superseded',
          skipReason: 'superseded',
          finishedAt: new Date(),
        });
        await this.finishSuperseded(
          run,
          installation,
          checkRun?.id ?? null,
          headSha,
        );
        return;
      }

      if (analysis.status === 'error') {
        await this.fail(
          run,
          installation,
          checkRun?.id ?? null,
          analysis.errorMessage ?? 'Falha no pipeline de análise',
          analysis.id,
        );
        return;
      }

      await this.complete(
        run,
        installation,
        checkRun?.id ?? null,
        review,
        analysis.id,
        Date.now() - startedAt,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha inesperada na revisão';
      await this.githubAppService.settleBudget(run.id, 0);
      await this.fail(run, installation, checkRun?.id ?? null, message, null);
      throw err;
    }
  }

  private async publishGate(
    run: GithubReviewRun,
    gateway: InstallationGithubGateway,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const current = await this.reviewRunRepository.findOne({
      where: { id: run.id },
    });
    if (current && current.status === 'superseded') {
      return { allowed: false, reason: 'Execução superada por novo push' };
    }
    const headSha = await this.currentHeadSha(gateway, run);
    if (headSha && headSha !== run.headSha) {
      return { allowed: false, reason: `Head da PR mudou para ${headSha}` };
    }
    return { allowed: true };
  }

  private async currentHeadSha(
    gateway: InstallationGithubGateway,
    run: GithubReviewRun,
  ): Promise<string | null> {
    try {
      return await gateway.getPullHeadSha(
        run.repo,
        run.pullNumber,
        { id: '', username: null, email: '' },
        run.owner,
      );
    } catch (err) {
      this.logger.warn('Não foi possível reconferir o head SHA da PR', {
        exception: err,
        reviewRunId: run.id,
      });
      return null;
    }
  }

  private async resolveScope(
    repository: GithubAppRepository,
    installation: GithubInstallation,
  ): Promise<FrozenImpactScope> {
    const fallback: FrozenImpactScope = {
      requestedMode: 'repository',
      effectiveMode: 'repository',
      status: 'exact',
      projectId: null,
      projectName: null,
      fallbackReason: null,
      repositories: [],
    };
    if (repository.config.impactScope.mode !== 'project') return fallback;

    try {
      return await this.projectsService.resolveAnalysisScope(
        repository.config.impactScope.projectId,
        repository.fullName,
        { id: installation.ownerUserId as string, username: null, email: '' },
      );
    } catch (err) {
      this.logger.warn('Escopo de projeto indisponível, usando repositório', {
        exception: err,
        repositoryId: repository.id,
      });
      return fallback;
    }
  }

  private analysisUrl(analysisId: string, owner: string, repo: string): string {
    const { frontendUrl } = resolveGithubAppConfig();
    return `${frontendUrl}/repos/${owner}/${repo}/analyses/${analysisId}`;
  }

  private botLogin(): string {
    const { slug } = resolveGithubAppConfig();
    return `${slug}[bot]`;
  }

  private async skip(
    run: GithubReviewRun,
    reason: GithubReviewSkipReason,
    checkRunId: number | null = null,
    installation?: GithubInstallation,
  ): Promise<void> {
    await this.reviewRunRepository.update(run.id, {
      status: 'skipped',
      skipReason: reason,
      finishedAt: new Date(),
    });
    this.logger.log('Revisão automática pulada', {
      reviewRunId: run.id,
      reason,
      pullNumber: run.pullNumber,
    });

    if (checkRunId && installation) {
      const snapshot = await this.checkRunService.update({
        installationId: installation.installationId,
        owner: run.owner,
        repo: run.repo,
        checkRunId,
        status: 'completed',
        conclusion: 'neutral',
        output: buildSkippedOutput(reason),
      });
      if (snapshot)
        await this.reviewRunRepository.update(run.id, { checkRun: snapshot });
    }
  }

  private async finishSuperseded(
    run: GithubReviewRun,
    installation: GithubInstallation,
    checkRunId: number | null,
    newHeadSha: string | null = null,
  ): Promise<void> {
    this.logger.log('Resultado descartado: SHA ultrapassado', {
      reviewRunId: run.id,
      analysedSha: run.headSha,
      currentSha: newHeadSha,
    });
    if (!checkRunId) return;
    const snapshot = await this.checkRunService.update({
      installationId: installation.installationId,
      owner: run.owner,
      repo: run.repo,
      checkRunId,
      status: 'completed',
      conclusion: 'neutral',
      output: buildSupersededOutput(newHeadSha),
    });
    if (snapshot)
      await this.reviewRunRepository.update(run.id, { checkRun: snapshot });
  }

  private async fail(
    run: GithubReviewRun,
    installation: GithubInstallation,
    checkRunId: number | null,
    message: string,
    analysisId: string | null,
  ): Promise<void> {
    await this.reviewRunRepository.update(run.id, {
      status: 'failed',
      errorMessage: message,
      finishedAt: new Date(),
      ...(analysisId ? { analysisId } : {}),
    });
    this.logger.error('Revisão automática falhou', {
      reviewRunId: run.id,
      pullNumber: run.pullNumber,
      message,
    });

    if (!checkRunId) return;
    const snapshot = await this.checkRunService.update({
      installationId: installation.installationId,
      owner: run.owner,
      repo: run.repo,
      checkRunId,
      status: 'completed',
      conclusion: 'failure',
      output: buildFailedOutput(
        message,
        analysisId ? this.analysisUrl(analysisId, run.owner, run.repo) : null,
      ),
      ...(analysisId
        ? { detailsUrl: this.analysisUrl(analysisId, run.owner, run.repo) }
        : {}),
    });
    if (snapshot)
      await this.reviewRunRepository.update(run.id, { checkRun: snapshot });
  }

  private async complete(
    run: GithubReviewRun,
    installation: GithubInstallation,
    checkRunId: number | null,
    review: AnalysisReview,
    analysisId: string,
    durationMs: number,
  ): Promise<void> {
    await this.reviewRunRepository.update(run.id, {
      status: 'completed',
      finishedAt: new Date(),
      analysisId,
    });
    this.logger.log('Revisão automática concluída', {
      reviewRunId: run.id,
      analysisId,
      pullNumber: run.pullNumber,
      verdict: review.verdict ?? 'unknown',
      durationMs,
    });

    if (!checkRunId) return;
    const detailsUrl = this.analysisUrl(analysisId, run.owner, run.repo);
    const snapshot = await this.checkRunService.update({
      installationId: installation.installationId,
      owner: run.owner,
      repo: run.repo,
      checkRunId,
      status: 'completed',
      conclusion: conclusionFor(review),
      detailsUrl,
      output: buildCompletedOutput({
        review,
        analysisUrl: detailsUrl,
        durationMs,
        headSha: run.headSha,
        commentsPosted: review.githubComments?.posted ?? null,
      }),
    });
    if (snapshot)
      await this.reviewRunRepository.update(run.id, { checkRun: snapshot });
  }
}
