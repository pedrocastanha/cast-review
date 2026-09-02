import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { UserService } from '../users/user.service';
import type { LinkInstallationDto } from './dtos/link-installation.dto';
import type { TriggerReviewDto } from './dtos/trigger-review.dto';
import type { UpdateRepositoryConfigDto } from './dtos/update-repository-config.dto';
import type { GithubAppRepository } from './entities/github-app-repository.entity';
import {
  GITHUB_REVIEW_QUEUE,
  type GithubReviewJobData,
} from './infrastructure/queue/github-review-queue.constants';
import { InstallationTokenService } from './infrastructure/github/installation-token.service';
import { GithubAppRepositoryRepository } from './infrastructure/persistence/github-app-repository.repository';
import { GithubInstallationRepository } from './infrastructure/persistence/github-installation.repository';
import { GithubReviewRunRepository } from './infrastructure/persistence/github-review-run.repository';
import { GithubWebhookDeliveryRepository } from './infrastructure/persistence/github-webhook-delivery.repository';
import { EnqueueReviewRunUseCase } from './use-cases/enqueue-review-run/enqueue-review-run.use-case';
import { GetInstallationUseCase } from './use-cases/get-installation/get-installation.use-case';
import {
  HandleWebhookUseCase,
  type WebhookInput,
} from './use-cases/handle-webhook/handle-webhook.use-case';
import { LinkInstallationUseCase } from './use-cases/link-installation/link-installation.use-case';
import { ListInstallationsUseCase } from './use-cases/list-installations/list-installations.use-case';
import { ListReviewRunsUseCase } from './use-cases/list-review-runs/list-review-runs.use-case';
import { PauseInstallationUseCase } from './use-cases/pause-installation/pause-installation.use-case';
import { RefreshInstallationUseCase } from './use-cases/refresh-installation/refresh-installation.use-case';
import { ReserveBudgetUseCase } from './use-cases/reserve-budget/reserve-budget.use-case';
import { RetryReviewRunUseCase } from './use-cases/retry-review-run/retry-review-run.use-case';
import { InstallationOwnershipProvider } from './use-cases/shared/installation-ownership.provider';
import { SyncRepositoriesUseCase } from './use-cases/sync-repositories/sync-repositories.use-case';
import { TriggerReviewRunUseCase } from './use-cases/trigger-review-run/trigger-review-run.use-case';
import { UnlinkInstallationUseCase } from './use-cases/unlink-installation/unlink-installation.use-case';
import { UpdateRepositoryConfigUseCase } from './use-cases/update-repository-config/update-repository-config.use-case';

@Injectable()
export class GithubAppService extends BaseService {
  private readonly ownership: InstallationOwnershipProvider;
  private readonly syncRepositoriesUseCase: SyncRepositoriesUseCase;
  private readonly reserveBudgetUseCase: ReserveBudgetUseCase;
  private readonly enqueueReviewRunUseCase: EnqueueReviewRunUseCase;
  private readonly linkInstallationUseCase: LinkInstallationUseCase;
  private readonly listInstallationsUseCase: ListInstallationsUseCase;
  private readonly getInstallationUseCase: GetInstallationUseCase;
  private readonly refreshInstallationUseCase: RefreshInstallationUseCase;
  private readonly pauseInstallationUseCase: PauseInstallationUseCase;
  private readonly unlinkInstallationUseCase: UnlinkInstallationUseCase;
  private readonly updateRepositoryConfigUseCase: UpdateRepositoryConfigUseCase;
  private readonly listReviewRunsUseCase: ListReviewRunsUseCase;
  private readonly triggerReviewRunUseCase: TriggerReviewRunUseCase;
  private readonly retryReviewRunUseCase: RetryReviewRunUseCase;
  private readonly handleWebhookUseCase: HandleWebhookUseCase;

  constructor(
    installationRepository: GithubInstallationRepository,
    appRepositoryRepository: GithubAppRepositoryRepository,
    reviewRunRepository: GithubReviewRunRepository,
    deliveryRepository: GithubWebhookDeliveryRepository,
    tokenService: InstallationTokenService,
    userService: UserService,
    @InjectQueue(GITHUB_REVIEW_QUEUE)
    reviewQueue: Queue<GithubReviewJobData>,
    logger: AppLogger,
  ) {
    super(logger);

    this.ownership = new InstallationOwnershipProvider(
      installationRepository,
      appRepositoryRepository,
    );
    this.syncRepositoriesUseCase = new SyncRepositoriesUseCase(
      appRepositoryRepository,
      tokenService,
    );
    this.reserveBudgetUseCase = new ReserveBudgetUseCase(
      reviewRunRepository,
      logger,
    );
    this.enqueueReviewRunUseCase = new EnqueueReviewRunUseCase(
      reviewRunRepository,
      reviewQueue,
      logger,
    );
    this.linkInstallationUseCase = new LinkInstallationUseCase(
      installationRepository,
      tokenService,
      this.syncRepositoriesUseCase,
      logger,
    );
    this.listInstallationsUseCase = new ListInstallationsUseCase(
      installationRepository,
      appRepositoryRepository,
    );
    this.getInstallationUseCase = new GetInstallationUseCase(
      this.ownership,
      appRepositoryRepository,
      this.reserveBudgetUseCase,
    );
    this.refreshInstallationUseCase = new RefreshInstallationUseCase(
      this.ownership,
      installationRepository,
      tokenService,
      this.syncRepositoriesUseCase,
      logger,
    );
    this.pauseInstallationUseCase = new PauseInstallationUseCase(
      this.ownership,
      installationRepository,
      logger,
    );
    this.unlinkInstallationUseCase = new UnlinkInstallationUseCase(
      this.ownership,
      installationRepository,
      appRepositoryRepository,
      tokenService,
      logger,
    );
    this.updateRepositoryConfigUseCase = new UpdateRepositoryConfigUseCase(
      this.ownership,
      appRepositoryRepository,
      userService,
      this.reserveBudgetUseCase,
      logger,
    );
    this.listReviewRunsUseCase = new ListReviewRunsUseCase(
      this.ownership,
      reviewRunRepository,
    );
    this.triggerReviewRunUseCase = new TriggerReviewRunUseCase(
      this.ownership,
      this.enqueueReviewRunUseCase,
      tokenService,
      logger,
    );
    this.retryReviewRunUseCase = new RetryReviewRunUseCase(
      this.ownership,
      reviewRunRepository,
      this.enqueueReviewRunUseCase,
    );
    this.handleWebhookUseCase = new HandleWebhookUseCase(
      deliveryRepository,
      installationRepository,
      appRepositoryRepository,
      this.enqueueReviewRunUseCase,
      this.syncRepositoriesUseCase,
      tokenService,
      logger,
    );
  }

  installUrl(currentUser: CurrentUserData) {
    return this.linkInstallationUseCase.installUrl(currentUser);
  }

  async link(currentUser: CurrentUserData, dto: LinkInstallationDto) {
    const id = await this.linkInstallationUseCase.execute(currentUser, dto);
    return this.getInstallationUseCase.execute(id, currentUser);
  }

  list(currentUser: CurrentUserData) {
    return this.listInstallationsUseCase.execute(currentUser);
  }

  detail(installationId: string, currentUser: CurrentUserData) {
    return this.getInstallationUseCase.execute(installationId, currentUser);
  }

  async refresh(installationId: string, currentUser: CurrentUserData) {
    const id = await this.refreshInstallationUseCase.execute(
      installationId,
      currentUser,
    );
    return this.getInstallationUseCase.execute(id, currentUser);
  }

  async setInstallationPaused(
    installationId: string,
    currentUser: CurrentUserData,
    paused: boolean,
  ) {
    const id = await this.pauseInstallationUseCase.execute(
      installationId,
      currentUser,
      paused,
    );
    return this.getInstallationUseCase.execute(id, currentUser);
  }

  unlink(installationId: string, currentUser: CurrentUserData) {
    return this.unlinkInstallationUseCase.execute(installationId, currentUser);
  }

  updateRepository(
    repositoryId: string,
    currentUser: CurrentUserData,
    dto: UpdateRepositoryConfigDto,
  ) {
    return this.updateRepositoryConfigUseCase.execute(
      repositoryId,
      currentUser,
      dto,
    );
  }

  listRuns(repositoryId: string, currentUser: CurrentUserData) {
    return this.listReviewRunsUseCase.execute(repositoryId, currentUser);
  }

  triggerManualRun(
    repositoryId: string,
    currentUser: CurrentUserData,
    dto: TriggerReviewDto,
  ) {
    return this.triggerReviewRunUseCase.execute(repositoryId, currentUser, dto);
  }

  retryRun(runId: string, currentUser: CurrentUserData) {
    return this.retryReviewRunUseCase.execute(runId, currentUser);
  }

  handleWebhook(input: WebhookInput) {
    return this.handleWebhookUseCase.execute(input);
  }

  budgetReservationFor(repository: GithubAppRepository) {
    return this.reserveBudgetUseCase.reservationFor(repository);
  }

  reserveBudget(
    repository: GithubAppRepository,
    reviewRunId: string,
    amountUsd: number,
  ) {
    return this.reserveBudgetUseCase.execute(
      repository,
      reviewRunId,
      amountUsd,
    );
  }

  settleBudget(reviewRunId: string, consumedUsd: number | null) {
    return this.reserveBudgetUseCase.settle(reviewRunId, consumedUsd);
  }
}
