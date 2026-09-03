import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { TriggerReviewDto } from '../../dtos/trigger-review.dto';
import { resolveGithubAppConfig } from '../../config/github-app.config';
import {
  evaluateInstallation,
  evaluateRepository,
} from '../../domain/eligibility.rules';
import { InstallationGithubGateway } from '../../infrastructure/github/installation-github.gateway';
import type { InstallationTokenService } from '../../infrastructure/github/installation-token.service';
import type { EnqueueReviewRunUseCase } from '../enqueue-review-run/enqueue-review-run.use-case';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';

export class TriggerReviewRunUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly enqueueReviewRun: EnqueueReviewRunUseCase,
    private readonly tokenService: InstallationTokenService,
    private readonly logger: AppLogger,
  ) {}

  async execute(
    repositoryId: string,
    currentUser: CurrentUserData,
    dto: TriggerReviewDto,
  ) {
    const { repository, installation } = await this.ownership.repository(
      repositoryId,
      currentUser,
    );

    const installationCheck = evaluateInstallation(installation);
    if (!installationCheck.eligible) {
      throw new BadRequestException(
        `Instalação indisponível: ${installationCheck.reason}`,
      );
    }
    const repositoryCheck = evaluateRepository(repository);
    if (!repositoryCheck.eligible) {
      throw new BadRequestException(
        `Repositório indisponível: ${repositoryCheck.reason}`,
      );
    }

    const gateway = new InstallationGithubGateway(
      this.tokenService,
      installation.installationId,
      repository.owner,
      `${resolveGithubAppConfig().slug}[bot]`,
      this.logger,
    );
    const pull = await gateway.getPullByNumber(
      repository.repo,
      dto.pullNumber,
      currentUser,
      repository.owner,
    );

    if (pull.state !== 'open') {
      throw new ConflictException('Pull request não está aberta');
    }

    return this.enqueueReviewRun.execute({
      installation,
      repository,
      facts: {
        pullNumber: pull.number,
        headSha: pull.headSha,
        baseRef: pull.baseRef,
        owner: repository.owner,
        repo: repository.repo,
      },
      trigger: 'manual',
      eventAction: null,
      deliveryId: null,
    });
  }
}
