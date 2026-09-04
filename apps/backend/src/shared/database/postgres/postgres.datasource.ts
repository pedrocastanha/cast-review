import 'dotenv/config';

import { Analysis } from 'src/modules/analyses/analysis.entity';
import { AnalysisContextSnapshotEntity } from 'src/modules/analyses/analysis-context-snapshot.entity';
import { ArchitectureBoundary } from 'src/modules/architecture-maps/entities/architecture-boundary.entity';
import { ArchitectureCapability } from 'src/modules/architecture-maps/entities/architecture-capability.entity';
import { ArchitectureComponent } from 'src/modules/architecture-maps/entities/architecture-component.entity';
import { ArchitectureMap } from 'src/modules/architecture-maps/entities/architecture-map.entity';
import { ArchitectureMapVersion } from 'src/modules/architecture-maps/entities/architecture-map-version.entity';
import { BenchmarkCase } from 'src/modules/benchmarks/benchmark-case.entity';
import { BenchmarkRun } from 'src/modules/benchmarks/benchmark-run.entity';
import { ChatMessage } from 'src/modules/chat/chat-message.entity';
import { ChatThread } from 'src/modules/chat/chat-thread.entity';
import { FindingCase } from 'src/modules/finding-cases/finding-case.entity';
import { FindingCaseEvent } from 'src/modules/finding-cases/finding-case-event.entity';
import { FindingOccurrence } from 'src/modules/finding-cases/finding-occurrence.entity';
import { GithubAppRepository } from 'src/modules/github-app/entities/github-app-repository.entity';
import { GithubInstallation } from 'src/modules/github-app/entities/github-installation.entity';
import { GithubReviewRun } from 'src/modules/github-app/entities/github-review-run.entity';
import { GithubWebhookDelivery } from 'src/modules/github-app/entities/github-webhook-delivery.entity';
import { Project } from 'src/modules/projects/project.entity';
import { ProjectRepositoryMember } from 'src/modules/projects/project-repository-member.entity';
import { User } from 'src/modules/users/user.entity';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [
    User,
    Analysis,
    AnalysisContextSnapshotEntity,
    FindingCase,
    FindingOccurrence,
    FindingCaseEvent,
    BenchmarkCase,
    BenchmarkRun,
    ChatThread,
    ChatMessage,
    GithubInstallation,
    GithubAppRepository,
    GithubWebhookDelivery,
    GithubReviewRun,
    Project,
    ProjectRepositoryMember,
    ArchitectureMap,
    ArchitectureMapVersion,
    ArchitectureCapability,
    ArchitectureComponent,
    ArchitectureBoundary,
  ],
  synchronize: false,
  migrations: [`${__dirname}/migrations/**/*{.ts,.js}`],
  migrationsTableName: 'migrations',
  useUTC: true,
});
