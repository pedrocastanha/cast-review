import type { Queue } from 'bullmq';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { GithubSessionProvider } from '../shared/github-session.provider';
import {
  buildIndexJobId,
  IndexJobData,
} from '../../indexing/index-queue.constants';
import { RepositoryIndexStatus } from '../../types/repository-index-status.type';
import { GetRepositoryIndexStatusDto } from './get-repository-index-status.dto';

export class GetRepositoryIndexStatusUseCase {
  constructor(
    private readonly githubSession: GithubSessionProvider,
    private readonly indexQueue: Queue<IndexJobData>,
    private readonly aiApiClient: AiApiClient,
  ) {}

  async execute({
    repo,
    currentUser,
    ownerOverride,
  }: GetRepositoryIndexStatusDto): Promise<RepositoryIndexStatus> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const headSha = await this.githubSession.resolveDefaultBranchSha(
        session.octokit,
        owner,
        repo,
      );
      const jobId = buildIndexJobId(owner, repo, headSha);
      const job = await this.indexQueue.getJob(jobId);

      if (job) {
        const state = await job.getState();
        return {
          status: state === 'active' ? 'indexing' : 'queued',
          sha: null,
          stale: false,
          progress: typeof job.progress === 'number' ? job.progress : 0,
        };
      }

      const repoId = `${owner}/${repo}`;
      const { indexed, sha } = await this.aiApiClient.getIndexStatus(repoId);

      return {
        status: indexed ? 'indexed' : 'not_indexed',
        sha,
        stale: indexed && sha !== headSha,
      };
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
