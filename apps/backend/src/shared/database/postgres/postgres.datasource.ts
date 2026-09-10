import 'dotenv/config';

import { DataSource } from 'typeorm';
import { Analysis } from '../../../modules/analyses/analysis.entity';
import { AnalysisContextSnapshotEntity } from '../../../modules/analyses/analysis-context-snapshot.entity';
import { ArchitectureBoundary } from '../../../modules/architecture-maps/entities/architecture-boundary.entity';
import { ArchitectureCapability } from '../../../modules/architecture-maps/entities/architecture-capability.entity';
import { ArchitectureComponent } from '../../../modules/architecture-maps/entities/architecture-component.entity';
import { ArchitectureMap } from '../../../modules/architecture-maps/entities/architecture-map.entity';
import { ArchitectureMapVersion } from '../../../modules/architecture-maps/entities/architecture-map-version.entity';
import { BenchmarkCase } from '../../../modules/benchmarks/benchmark-case.entity';
import { BenchmarkRun } from '../../../modules/benchmarks/benchmark-run.entity';
import { ChatMessage } from '../../../modules/chat/chat-message.entity';
import { ChatThread } from '../../../modules/chat/chat-thread.entity';
import { FeatureCard } from '../../../modules/feature-cards/entities/feature-card.entity';
import { FeatureCardRevision } from '../../../modules/feature-cards/entities/feature-card-revision.entity';
import { FindingCase } from '../../../modules/finding-cases/finding-case.entity';
import { FindingCaseEvent } from '../../../modules/finding-cases/finding-case-event.entity';
import { FindingOccurrence } from '../../../modules/finding-cases/finding-occurrence.entity';
import { GithubAppRepository } from '../../../modules/github-app/entities/github-app-repository.entity';
import { GithubInstallation } from '../../../modules/github-app/entities/github-installation.entity';
import { GithubReviewRun } from '../../../modules/github-app/entities/github-review-run.entity';
import { GithubWebhookDelivery } from '../../../modules/github-app/entities/github-webhook-delivery.entity';
import { Project } from '../../../modules/projects/project.entity';
import { ProjectRepositoryMember } from '../../../modules/projects/project-repository-member.entity';
import { User } from '../../../modules/users/user.entity';
import {
  allowsPlaintextDependencies,
  isProduction,
} from '../../security/production-config';

function resolveSsl() {
  if (process.env.DB_SSL === 'true') {
    return {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}),
    };
  }

  if (isProduction() && !allowsPlaintextDependencies()) {
    throw new Error(
      'DB_SSL=true obrigatório em produção. Em self-host com Postgres em rede privada, defina ALLOW_INSECURE_DEPENDENCIES=true de forma explícita',
    );
  }

  return false;
}

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [
    FeatureCard,
    FeatureCardRevision,
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
  ssl: resolveSsl(),
  migrations: [`${__dirname}/migrations/**/*{.ts,.js}`],
  migrationsTableName: 'migrations',
  useUTC: true,
});
