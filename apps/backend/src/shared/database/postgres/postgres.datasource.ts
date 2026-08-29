import 'dotenv/config';

import { Analysis } from 'src/modules/analyses/analysis.entity';
import { AnalysisContextSnapshotEntity } from 'src/modules/analyses/analysis-context-snapshot.entity';
import { BenchmarkCase } from 'src/modules/benchmarks/benchmark-case.entity';
import { ChatMessage } from 'src/modules/chat/chat-message.entity';
import { ChatThread } from 'src/modules/chat/chat-thread.entity';
import { BenchmarkRun } from 'src/modules/benchmarks/benchmark-run.entity';
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
    BenchmarkCase,
    BenchmarkRun,
    ChatThread,
    ChatMessage,
    Project,
    ProjectRepositoryMember,
  ],
  synchronize: false,
  migrations: [`${__dirname}/migrations/**/*{.ts,.js}`],
  migrationsTableName: 'migrations',
  useUTC: true,
});
