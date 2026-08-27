import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Octokit } from '@octokit/rest';
import type { Job } from 'bullmq';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { UserService } from '../../users/user.service';
import { fetchRepoTree } from './tree-fetcher.helper';
import { CODE_INDEX_QUEUE, IndexJobData, IndexJobResult } from './index-queue.constants';

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
    const { owner, repo, sha, userId } = job.data;
    const start = Date.now();

    this.logger.log('Indexação de repositório iniciada', { owner, repo, sha });

    try {
      await job.updateProgress(PROGRESS_STARTED);

      const { token } = await this.userService.getGithubCredentials(userId);
      const octokit = new Octokit({ auth: token });

      const { files, truncated } = await fetchRepoTree(octokit, owner, repo, sha);
      if (truncated) {
        this.logger.warn('Árvore do repositório truncada pela API do Github', {
          owner,
          repo,
          sha,
        });
      }

      await job.updateProgress(PROGRESS_TREE_FETCHED);

      const result = await this.aiApiClient.buildIndex({
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
