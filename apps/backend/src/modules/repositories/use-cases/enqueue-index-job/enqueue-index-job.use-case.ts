import type { Queue } from 'bullmq';
import { AppLogger } from 'src/shared/logger/logger.service';
import { GithubSessionProvider } from '../shared/github-session.provider';
import {
  buildIndexJobId,
  IndexJobData,
} from '../../indexing/index-queue.constants';
import { EnqueueIndexJobDto } from './enqueue-index-job.dto';

export class EnqueueIndexJobUseCase {
  constructor(
    private readonly githubSession: GithubSessionProvider,
    private readonly indexQueue: Queue<IndexJobData>,
    private readonly logger: AppLogger,
  ) {}

  async execute({
    repo,
    currentUser,
    ownerOverride,
  }: EnqueueIndexJobDto): Promise<{ jobId: string; status: 'queued' }> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const sha = await this.githubSession.resolveDefaultBranchSha(
        session.octokit,
        owner,
        repo,
      );
      const jobId = buildIndexJobId(owner, repo, sha);
      await this.indexQueue.add(
        'build',
        { owner, repo, sha, userId: currentUser.id },

        { jobId, removeOnComplete: true, removeOnFail: true },
      );

      this.logger.log('Indexação enfileirada', { owner, repo, sha, jobId });

      return { jobId, status: 'queued' };
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
