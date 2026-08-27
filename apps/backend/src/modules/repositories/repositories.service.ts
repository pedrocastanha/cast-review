import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { UserService } from '../users/user.service';
import { GithubSessionProvider } from './use-cases/shared/github-session.provider';
import {
  CODE_INDEX_QUEUE,
  IndexJobData,
} from './indexing/index-queue.constants';
import { GithubPullFile } from './types/github-pull.type';
import { RepositoryIndexStatus } from './types/repository-index-status.type';
import { CreatePullReviewInput } from './use-cases/create-pull-review/create-pull-review.dto';
import { CreatePullReviewUseCase } from './use-cases/create-pull-review/create-pull-review.use-case';
import { DeletePullReviewCommentUseCase } from './use-cases/delete-pull-review-comment/delete-pull-review-comment.use-case';
import { EnqueueIndexJobUseCase } from './use-cases/enqueue-index-job/enqueue-index-job.use-case';
import { GetConventionsUseCase } from './use-cases/get-conventions/get-conventions.use-case';
import { GetFileContentUseCase } from './use-cases/get-file-content/get-file-content.use-case';
import { GetPullByNumberUseCase } from './use-cases/get-pull-by-number/get-pull-by-number.use-case';
import { GetPullDiffUseCase } from './use-cases/get-pull-diff/get-pull-diff.use-case';
import { GetPullHeadShaUseCase } from './use-cases/get-pull-head-sha/get-pull-head-sha.use-case';
import { GetRepositoryGraphUseCase } from './use-cases/get-repository-graph/get-repository-graph.use-case';
import { GetRepositoryIndexStatusUseCase } from './use-cases/get-repository-index-status/get-repository-index-status.use-case';
import { ListPullFilesUseCase } from './use-cases/list-pull-files/list-pull-files.use-case';
import { ListPullReviewCommentsUseCase } from './use-cases/list-pull-review-comments/list-pull-review-comments.use-case';
import { ListPullsUseCase } from './use-cases/list-pulls/list-pulls.use-case';
import { ListReposUseCase } from './use-cases/list-repos/list-repos.use-case';

@Injectable()
export class RepositoriesService extends BaseService {
  private readonly githubSession: GithubSessionProvider;
  private readonly listReposUseCase: ListReposUseCase;
  private readonly listPullsUseCase: ListPullsUseCase;
  private readonly getPullByNumberUseCase: GetPullByNumberUseCase;
  private readonly getPullDiffUseCase: GetPullDiffUseCase;
  private readonly listPullFilesUseCase: ListPullFilesUseCase;
  private readonly getFileContentUseCase: GetFileContentUseCase;
  private readonly getConventionsUseCase: GetConventionsUseCase;
  private readonly getPullHeadShaUseCase: GetPullHeadShaUseCase;
  private readonly createPullReviewUseCase: CreatePullReviewUseCase;
  private readonly listPullReviewCommentsUseCase: ListPullReviewCommentsUseCase;
  private readonly deletePullReviewCommentUseCase: DeletePullReviewCommentUseCase;
  private readonly enqueueIndexJobUseCase: EnqueueIndexJobUseCase;
  private readonly getRepositoryIndexStatusUseCase: GetRepositoryIndexStatusUseCase;
  private readonly getRepositoryGraphUseCase: GetRepositoryGraphUseCase;

  constructor(
    private readonly userService: UserService,
    @InjectQueue(CODE_INDEX_QUEUE)
    private readonly indexQueue: Queue<IndexJobData>,
    private readonly aiApiClient: AiApiClient,
    logger: AppLogger,
  ) {
    super(logger);

    this.githubSession = new GithubSessionProvider(userService, logger);
    this.listReposUseCase = new ListReposUseCase(this.githubSession);
    this.listPullsUseCase = new ListPullsUseCase(this.githubSession);
    this.getPullByNumberUseCase = new GetPullByNumberUseCase(
      this.githubSession,
    );
    this.getPullDiffUseCase = new GetPullDiffUseCase(this.githubSession);
    this.listPullFilesUseCase = new ListPullFilesUseCase(this.githubSession);
    this.getFileContentUseCase = new GetFileContentUseCase(this.githubSession);
    this.getConventionsUseCase = new GetConventionsUseCase(
      this.getFileContentUseCase,
    );
    this.getPullHeadShaUseCase = new GetPullHeadShaUseCase(this.githubSession);
    this.createPullReviewUseCase = new CreatePullReviewUseCase(
      this.githubSession,
    );
    this.listPullReviewCommentsUseCase = new ListPullReviewCommentsUseCase(
      this.githubSession,
    );
    this.deletePullReviewCommentUseCase = new DeletePullReviewCommentUseCase(
      this.githubSession,
    );
    this.enqueueIndexJobUseCase = new EnqueueIndexJobUseCase(
      this.githubSession,
      indexQueue,
      logger,
    );
    this.getRepositoryIndexStatusUseCase = new GetRepositoryIndexStatusUseCase(
      this.githubSession,
      indexQueue,
      aiApiClient,
    );
    this.getRepositoryGraphUseCase = new GetRepositoryGraphUseCase(
      this.githubSession,
      aiApiClient,
    );
  }

  async listRepos(currentUser: CurrentUserData) {
    return this.listReposUseCase.execute({ currentUser });
  }

  async listPulls(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    return this.listPullsUseCase.execute({ repo, currentUser, ownerOverride });
  }

  async getPullByNumber(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    return this.getPullByNumberUseCase.execute({
      repo,
      pullNumber,
      currentUser,
      ownerOverride,
    });
  }

  async getPullDiff(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    return this.getPullDiffUseCase.execute({
      repo,
      pullNumber,
      currentUser,
      ownerOverride,
    });
  }

  async listPullFiles(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullFile[]> {
    return this.listPullFilesUseCase.execute({
      repo,
      pullNumber,
      currentUser,
      ownerOverride,
    });
  }

  async getFileContent(
    repo: string,
    path: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string | null> {
    return this.getFileContentUseCase.execute({
      repo,
      path,
      ref,
      currentUser,
      ownerOverride,
    });
  }

  async getConventions(
    repo: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    return this.getConventionsUseCase.execute({
      repo,
      ref,
      currentUser,
      ownerOverride,
    });
  }

  async getPullHeadSha(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    return this.getPullHeadShaUseCase.execute({
      repo,
      pullNumber,
      currentUser,
      ownerOverride,
    });
  }

  async createPullReview(
    repo: string,
    pullNumber: number,
    input: CreatePullReviewInput,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<{ id: number; htmlUrl: string | null }> {
    return this.createPullReviewUseCase.execute({
      repo,
      pullNumber,
      input,
      currentUser,
      ownerOverride,
    });
  }

  async listPullReviewComments(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    return this.listPullReviewCommentsUseCase.execute({
      repo,
      pullNumber,
      currentUser,
      ownerOverride,
    });
  }

  async deletePullReviewComment(
    repo: string,
    commentId: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    return this.deletePullReviewCommentUseCase.execute({
      repo,
      commentId,
      currentUser,
      ownerOverride,
    });
  }

  async enqueueIndexJob(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<{ jobId: string; status: 'queued' }> {
    return this.enqueueIndexJobUseCase.execute({
      repo,
      currentUser,
      ownerOverride,
    });
  }

  async getRepositoryIndexStatus(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<RepositoryIndexStatus> {
    return this.getRepositoryIndexStatusUseCase.execute({
      repo,
      currentUser,
      ownerOverride,
    });
  }

  async getRepositoryGraph(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
    sha?: string,
    focus?: string,
    depth?: number,
  ) {
    return this.getRepositoryGraphUseCase.execute({
      repo,
      currentUser,
      ownerOverride,
      sha,
      focus,
      depth,
    });
  }

  async loginFor(currentUser: CurrentUserData): Promise<string> {
    const session = await this.githubSession.getSession(currentUser);
    return session.owner;
  }
}
