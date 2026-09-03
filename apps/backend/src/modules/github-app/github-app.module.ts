import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalysesModule } from '../analyses/analyses.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/user.module';
import { CheckRunService } from './infrastructure/github/check-run.service';
import { GithubAppController } from './github-app.controller';
import { GithubAppService } from './github-app.service';
import { GITHUB_REVIEW_QUEUE } from './infrastructure/queue/github-review-queue.constants';
import { InstallationTokenService } from './infrastructure/github/installation-token.service';
import { GithubAppRepositoryRepository } from './infrastructure/persistence/github-app-repository.repository';
import { GithubInstallationRepository } from './infrastructure/persistence/github-installation.repository';
import { GithubReviewRunRepository } from './infrastructure/persistence/github-review-run.repository';
import { GithubWebhookDeliveryRepository } from './infrastructure/persistence/github-webhook-delivery.repository';
import { ReviewProcessor } from './infrastructure/queue/review.processor';

@Module({
  imports: [
    AnalysesModule,
    ProjectsModule,
    UsersModule,
    BullModule.registerQueue({ name: GITHUB_REVIEW_QUEUE }),
  ],
  controllers: [GithubAppController],
  providers: [
    InstallationTokenService,
    GithubAppService,
    CheckRunService,
    ReviewProcessor,
    GithubInstallationRepository,
    GithubAppRepositoryRepository,
    GithubWebhookDeliveryRepository,
    GithubReviewRunRepository,
  ],
})
export class GithubAppModule {}
