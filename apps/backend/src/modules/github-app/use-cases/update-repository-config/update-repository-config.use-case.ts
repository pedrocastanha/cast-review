import { BadRequestException } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { UserService } from '../../../users/user.service';
import type { UpdateRepositoryConfigDto } from '../../dtos/update-repository-config.dto';
import type { GithubAppRepositoryConfig } from '../../domain/github-app.types';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';
import type { ReserveBudgetUseCase } from '../reserve-budget/reserve-budget.use-case';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';
import { toRepositorySummary } from '../shared/installation-presenter';
import { evaluateReadiness } from '../shared/repository-readiness';

export class UpdateRepositoryConfigUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
    private readonly userService: UserService,
    private readonly budget: ReserveBudgetUseCase,
    private readonly logger: AppLogger,
  ) {}

  async execute(
    repositoryId: string,
    currentUser: CurrentUserData,
    dto: UpdateRepositoryConfigDto,
  ) {
    const { repository } = await this.ownership.repository(
      repositoryId,
      currentUser,
    );

    const config: GithubAppRepositoryConfig = {
      ...repository.config,
      ...(dto.events ? { events: dto.events } : {}),
      ...(dto.includeDrafts !== undefined
        ? { includeDrafts: dto.includeDrafts }
        : {}),
      ...(dto.baseBranches ? { baseBranches: dto.baseBranches } : {}),
      ...(dto.models !== undefined ? { models: dto.models } : {}),
      ...(dto.impactScope
        ? {
            impactScope:
              dto.impactScope.mode === 'project'
                ? {
                    mode: 'project' as const,
                    projectId: this.requireProjectId(dto),
                  }
                : { mode: 'repository' as const },
          }
        : {}),
      ...(dto.publishPolicy ? { publishPolicy: dto.publishPolicy } : {}),
      ...(dto.budgetMonthlyUsd !== undefined
        ? { budgetMonthlyUsd: dto.budgetMonthlyUsd }
        : {}),
      ...(dto.budgetPerRunUsd !== undefined
        ? { budgetPerRunUsd: dto.budgetPerRunUsd }
        : {}),
      ...(dto.staleIndexBehavior
        ? { staleIndexBehavior: dto.staleIndexBehavior }
        : {}),
    };

    const readiness = await evaluateReadiness(
      this.userService,
      currentUser.id,
      config,
    );
    const enabled = dto.enabled ?? repository.enabled;

    if (enabled && !readiness.ready) {
      throw new BadRequestException(readiness.reason);
    }

    await this.appRepositoryRepository.update(repository.id, {
      config,
      enabled,
      configStatus: readiness.ready ? 'ready' : 'configuration_required',
      configReason: readiness.ready ? null : readiness.reason,
      ...(dto.paused !== undefined
        ? { pausedAt: dto.paused ? new Date() : null }
        : {}),
    });

    this.logger.log('Configuração de repositório atualizada', {
      repositoryId: repository.id,
      fullName: repository.fullName,
      enabled,
      configStatus: readiness.ready ? 'ready' : 'configuration_required',
    });

    const updated =
      (await this.appRepositoryRepository.findOne({
        where: { id: repository.id },
      })) ?? repository;

    return {
      ...toRepositorySummary(updated),
      budget: await this.budget.usage(updated),
    };
  }

  private requireProjectId(dto: UpdateRepositoryConfigDto): string {
    if (!dto.impactScope?.projectId) {
      throw new BadRequestException(
        'impactScope.projectId é obrigatório no modo project',
      );
    }
    return dto.impactScope.projectId;
  }
}
