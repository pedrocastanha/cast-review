import { randomUUID } from 'node:crypto';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import { resolveGithubAppConfig } from '../../config/github-app.config';
import type { GithubReviewSkipReason } from '../../domain/github-app.types';
import {
  evaluateInstallation,
  evaluatePullEvent,
  evaluateRepository,
  isEligibleAction,
} from '../../domain/eligibility.rules';
import {
  extractPullRequestFacts,
  redactPayload,
} from '../../domain/webhook-payload';
import { verifyWebhookSignature } from '../../infrastructure/github/security/webhook-signature';
import type { InstallationTokenService } from '../../infrastructure/github/installation-token.service';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';
import type { GithubWebhookDeliveryRepository } from '../../infrastructure/persistence/github-webhook-delivery.repository';
import type { EnqueueReviewRunUseCase } from '../enqueue-review-run/enqueue-review-run.use-case';
import type { SyncRepositoriesUseCase } from '../sync-repositories/sync-repositories.use-case';

export interface WebhookInput {
  deliveryId: string | undefined;
  event: string | undefined;
  signature: string | undefined;
  rawBody: Buffer | undefined;
  payload: Record<string, unknown>;
}

export type WebhookOutcome =
  | { status: 'invalid_signature' }
  | { status: 'ignored'; reason: string }
  | { status: 'duplicate'; reviewRunId: string | null }
  | { status: 'queued'; reviewRunId: string }
  | { status: 'skipped'; reason: GithubReviewSkipReason | string };

export class HandleWebhookUseCase {
  constructor(
    private readonly deliveryRepository: GithubWebhookDeliveryRepository,
    private readonly installationRepository: GithubInstallationRepository,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
    private readonly enqueueReviewRun: EnqueueReviewRunUseCase,
    private readonly syncRepositories: SyncRepositoriesUseCase,
    private readonly tokenService: InstallationTokenService,
    private readonly logger: AppLogger,
  ) {}

  async execute(input: WebhookInput): Promise<WebhookOutcome> {
    const config = resolveGithubAppConfig();

    if (
      !verifyWebhookSignature(config.webhookSecret, input.rawBody, input.signature)
    ) {
      this.logger.warn('Webhook do GitHub recusado por assinatura inválida', {
        deliveryId: input.deliveryId ?? null,
        event: input.event ?? null,
      });
      return { status: 'invalid_signature' };
    }

    const deliveryId = input.deliveryId ?? randomUUID();
    const event = input.event ?? 'unknown';
    const action =
      typeof input.payload.action === 'string' ? input.payload.action : null;

    const existing = await this.deliveryRepository.findOne({
      where: { deliveryId },
    });
    if (existing) {
      this.logger.log('Entrega de webhook duplicada ignorada', {
        deliveryId,
        event,
      });
      return { status: 'duplicate', reviewRunId: existing.reviewRunId };
    }

    const facts = extractPullRequestFacts(input.payload);
    const delivery = await this.deliveryRepository.save(
      this.deliveryRepository.create({
        id: randomUUID(),
        deliveryId,
        event,
        action,
        installationId:
          facts?.installationId ?? this.installationIdOf(input.payload),
        repositoryFullName: facts?.fullName ?? null,
        pullNumber: facts?.pullNumber ?? null,
        headSha: facts?.headSha ?? null,
        status: 'received',
        reason: null,
        reviewRunId: null,
        payload: redactPayload(input.payload),
        receivedAt: new Date(),
        processedAt: null,
      }),
    );

    const outcome = await this.route(event, action, input.payload);

    await this.deliveryRepository.update(delivery.id, {
      status:
        outcome.status === 'queued'
          ? 'queued'
          : outcome.status === 'duplicate'
            ? 'duplicate'
            : 'ignored',
      reason: 'reason' in outcome ? String(outcome.reason) : null,
      reviewRunId: outcome.status === 'queued' ? outcome.reviewRunId : null,
      processedAt: new Date(),
    });

    await this.prunePayloads(config.payloadRetentionDays);
    return outcome;
  }

  private async route(
    event: string,
    action: string | null,
    payload: Record<string, unknown>,
  ): Promise<WebhookOutcome> {
    if (event === 'installation' || event === 'installation_repositories') {
      return this.handleInstallationEvent(action, payload);
    }
    if (event === 'pull_request') {
      return this.handlePullRequestEvent(action, payload);
    }
    return { status: 'ignored', reason: `evento ${event} não tratado` };
  }

  private async handleInstallationEvent(
    action: string | null,
    payload: Record<string, unknown>,
  ): Promise<WebhookOutcome> {
    const installationId = this.installationIdOf(payload);
    if (!installationId) {
      return { status: 'ignored', reason: 'sem installation id' };
    }

    const installation = await this.installationRepository.findOne({
      where: { installationId },
    });
    if (!installation) {
      return { status: 'ignored', reason: 'instalação ainda não vinculada' };
    }

    if (action === 'deleted') {
      await this.installationRepository.update(installation.id, {
        status: 'deleted',
        ownerUserId: null,
        lastEventAt: new Date(),
      });
      this.tokenService.forget(installationId);
      return { status: 'ignored', reason: 'instalação removida' };
    }

    if (action === 'suspend') {
      await this.installationRepository.update(installation.id, {
        status: 'suspended',
        suspendedAt: new Date(),
        lastEventAt: new Date(),
      });
      this.tokenService.forget(installationId);
      return { status: 'ignored', reason: 'instalação suspensa' };
    }

    if (action === 'unsuspend') {
      await this.installationRepository.update(installation.id, {
        status: installation.ownerUserId ? 'active' : 'pending',
        suspendedAt: null,
        lastEventAt: new Date(),
      });
    }

    await this.installationRepository.update(installation.id, {
      lastEventAt: new Date(),
    });

    try {
      await this.syncRepositories.execute(installation);
    } catch (err) {
      this.logger.error('Falha ao sincronizar repositórios da instalação', {
        exception: err,
        installationId,
      });
    }

    return { status: 'ignored', reason: `installation ${action ?? 'sync'}` };
  }

  private async handlePullRequestEvent(
    action: string | null,
    payload: Record<string, unknown>,
  ): Promise<WebhookOutcome> {
    const facts = extractPullRequestFacts(payload);
    if (!facts || !facts.installationId) {
      return { status: 'ignored', reason: 'payload sem dados de pull request' };
    }

    if (action === 'closed') {
      await this.enqueueReviewRun.supersedeOpenRuns(
        facts.installationId,
        facts.pullNumber,
        null,
        'pull_closed',
      );
      return { status: 'ignored', reason: 'pull request fechada' };
    }

    if (!action || !isEligibleAction(action)) {
      return {
        status: 'ignored',
        reason: `ação ${action ?? 'desconhecida'} fora do P1`,
      };
    }

    const installation = await this.installationRepository.findOne({
      where: { installationId: facts.installationId },
    });
    const installationCheck = evaluateInstallation(installation);
    if (!installationCheck.eligible || !installation) {
      return {
        status: 'skipped',
        reason: installationCheck.eligible
          ? 'installation_inactive'
          : installationCheck.reason,
      };
    }

    const repository = await this.findRepository(installation.id, facts);
    const repositoryCheck = evaluateRepository(repository);
    if (!repositoryCheck.eligible || !repository) {
      return {
        status: 'skipped',
        reason: repositoryCheck.eligible
          ? 'automation_disabled'
          : repositoryCheck.reason,
      };
    }

    const eventCheck = evaluatePullEvent(repository, {
      action,
      draft: facts.draft,
      baseRef: facts.baseRef,
      state: facts.state,
    });
    if (!eventCheck.eligible) {
      return { status: 'skipped', reason: eventCheck.reason };
    }

    return this.enqueueReviewRun.execute({
      installation,
      repository,
      facts,
      trigger: 'webhook',
      eventAction: action,
      deliveryId: null,
    });
  }

  private async findRepository(
    installationRowId: string,
    facts: { githubRepoId: string | null; owner: string; repo: string },
  ): Promise<GithubAppRepository | null> {
    if (facts.githubRepoId) {
      const byId = await this.appRepositoryRepository.findOne({
        where: {
          installationId: installationRowId,
          githubRepoId: facts.githubRepoId,
        },
      });
      if (byId) return byId;
    }
    return this.appRepositoryRepository.findOne({
      where: {
        installationId: installationRowId,
        owner: facts.owner,
        repo: facts.repo,
      },
    });
  }

  private installationIdOf(payload: Record<string, unknown>): string | null {
    const installation = payload.installation;
    if (
      installation &&
      typeof installation === 'object' &&
      !Array.isArray(installation)
    ) {
      const id = (installation as { id?: unknown }).id;
      if (typeof id === 'number') return String(id);
    }
    return null;
  }

  private async prunePayloads(retentionDays: number): Promise<void> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      await this.deliveryRepository
        .createQueryBuilder()
        .update()
        .set({ payload: null })
        .where('received_at < :cutoff', { cutoff })
        .andWhere('payload IS NOT NULL')
        .execute();
    } catch (err) {
      this.logger.warn('Falha ao expirar payloads de webhook', {
        exception: err,
      });
    }
  }
}
