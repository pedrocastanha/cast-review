import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Octokit } from '@octokit/rest';
import type { Job } from 'bullmq';
import { AiApiClient } from '../../../shared/clients/ai/ai-api.client';
import { dbActorStorage } from '../../../shared/database/postgres/db-actor';
import { AppLogger } from '../../../shared/logger/logger.service';
import { UserService } from '../../users/user.service';
import {
  CODE_INDEX_QUEUE,
  IndexJobData,
  IndexJobResult,
} from './index-queue.constants';
import { fetchRepoTree } from './tree-fetcher.helper';

const PROGRESS_STARTED = 5;
const PROGRESS_TREE_FETCHED = 50;
const PROGRESS_DONE = 100;

@Processor(CODE_INDEX_QUEUE)
export class IndexProcessor extends WorkerHost {
  constructor(
    private readonly userService: UserService,
    private readonly aiApiClient: AiApiClient,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job<IndexJobData>): Promise<IndexJobResult> {
    // Worker age em nome de quem pediu a indexação (SEC-17).
    return dbActorStorage.run(
      { userId: job.data.userId, actorType: 'job' },
      () => this.handle(job),
    );
  }

  private async handle(job: Job<IndexJobData>): Promise<IndexJobResult> {
    const { owner, repo, sha, userId } = job.data;
    const start = Date.now();

    this.logger.log('Indexação de repositório iniciada', { owner, repo, sha });

    try {
      await job.updateProgress(PROGRESS_STARTED);

      const { token } = await this.userService.getGithubCredentials(userId);
      const octokit = new Octokit({ auth: token });

      const { files, truncated } = await fetchRepoTree(
        octokit,
        owner,
        repo,
        sha,
      );
      if (truncated) {
        this.logger.warn('Árvore do repositório truncada pela API do Github', {
          owner,
          repo,
          sha,
        });
      }

      await job.updateProgress(PROGRESS_TREE_FETCHED);

      const result = await this.aiApiClient.buildIndex({
        // O grafo no Neo4j é escopado por dono: o job carrega `userId` desde
        // `enqueue-index-job`, e é ele que define de quem é o índice.
        ownerId: job.data.userId,
        repoId: `${owner}/${repo}`,
        sha,
        files,
      });

      await job.updateProgress(PROGRESS_DONE);

      this.logger.log('Indexação de repositório concluída', {
        owner,
        repo,
        sha,
        fileCount: files.length,
        durationMs: Date.now() - start,
      });

      return result;
    } catch (err) {
      this.logger.error('Indexação de repositório falhou', {
        exception: err,
        owner,
        repo,
        sha,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }
}
