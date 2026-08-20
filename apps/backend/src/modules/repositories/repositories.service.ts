import { InjectQueue } from '@nestjs/bullmq';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type { Queue } from 'bullmq';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { UserService } from '../users/user.service';
import {
  buildIndexJobId,
  CODE_INDEX_QUEUE,
  IndexJobData,
} from './indexing/index-queue.constants';

export type IndexStatus = 'not_indexed' | 'queued' | 'indexing' | 'indexed';

export interface RepositoryIndexStatus {
  status: IndexStatus;
  sha: string | null;
  stale: boolean;
  progress?: number;
}

type GithubPull = {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  draft?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
};

type GithubSession = {
  octokit: Octokit;
  owner: string;
};

type GithubPullFile = {
  filename: string;
  status: string;
  patch?: string;
};

const REPO_AFFILIATION = 'owner,collaborator,organization_member';

@Injectable()
export class RepositoriesService extends BaseService {
  constructor(
    private readonly userService: UserService,
    @InjectQueue(CODE_INDEX_QUEUE) private readonly indexQueue: Queue<IndexJobData>,
    private readonly aiApiClient: AiApiClient,
    logger: AppLogger,
  ) {
    super(logger);
  }

  private async session(currentUser: CurrentUserData): Promise<GithubSession> {
    const { token, login } = await this.userService.getGithubCredentials(
      currentUser.id,
    );

    const octokit = new Octokit({ auth: token });
    const owner = login ?? (await this.backfillLogin(octokit, currentUser.id));

    return { octokit, owner };
  }

  async listRepos(currentUser: CurrentUserData) {
    const { octokit } = await this.session(currentUser);

    try {
      const repos = await octokit.paginate(
        octokit.repos.listForAuthenticatedUser,
        {
          per_page: 100,
          sort: 'updated',
          affiliation: REPO_AFFILIATION,
        },
      );

      return repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        private: repo.private,
        description: repo.description,
        htmlUrl: repo.html_url,
        updatedAt: repo.updated_at,
        defaultBranch: repo.default_branch,
      }));
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async listPulls(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const pulls = await session.octokit.paginate(session.octokit.pulls.list, {
        owner,
        repo,
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
        state: 'all',
      });

      return pulls.map((pull) => this.toPullSummary(pull));
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async getPullByNumber(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });

      return this.toPullSummary(data);
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async getPullDiff(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: { format: 'diff' },
      });

      return data as unknown as string;
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async listPullFiles(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullFile[]> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const files = await session.octokit.paginate(
        session.octokit.pulls.listFiles,
        { owner, repo, pull_number: pullNumber, per_page: 100 },
      );

      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        patch: file.patch,
      }));
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async getFileContent(
    repo: string,
    path: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string | null> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (Array.isArray(data) || data.type !== 'file' || !data.content) {
        return null;
      }

      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        return null;
      }
      this.handleGithubError(err);
    }
  }

  async getConventions(
    repo: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const content = await this.getFileContent(
      repo,
      'conventions.md',
      ref,
      currentUser,
      ownerOverride,
    );

    return content ?? '';
  }

  private async backfillLogin(
    octokit: Octokit,
    userId: string,
  ): Promise<string> {
    try {
      const { data } = await octokit.users.getAuthenticated();
      await this.userService.setGithubLogin(userId, data.login);

      return data.login;
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  private handleGithubError(err: unknown): never {
    this.logger.error('Falha na chamada à API do Github', { exception: err });

    const status = (err as { status?: number }).status;

    if (status === 401) {
      throw new UnauthorizedException('Token do Github expirado ou inválido.');
    }

    if (status === 403 || status === 429) {
      throw new ForbiddenException(
        'Acesso negado pelo Github: permissão insuficiente ou limite de requisições atingido.',
      );
    }

    if (status === 404) {
      throw new NotFoundException('Recurso não encontrado no Github');
    }

    throw new InternalServerErrorException(
      'Erro inesperado ao consultar a API do Github',
    );
  }

  private toPullSummary(pull: GithubPull) {
    return {
      id: pull.id,
      number: pull.number,
      title: pull.title,
      state: pull.state,
      user: pull.user?.login ?? null,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      htmlUrl: pull.html_url,
      draft: pull.draft ?? false,
      headRef: pull.head.ref,
      headSha: pull.head.sha,
      baseRef: pull.base.ref,
    };
  }

  async getPullHeadSha(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return data.head.sha;
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async createPullReview(
    repo: string,
    pullNumber: number,
    input: {
      commitId: string;
      body: string;
      comments: {
        path: string;
        line: number;
        startLine?: number;
        body: string;
      }[];
    },
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<{ id: number; htmlUrl: string | null }> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: input.commitId,
        event: 'COMMENT',
        body: input.body,
        ...(input.comments.length > 0
          ? {
              comments: input.comments.map((comment) => ({
                path: comment.path,
                body: comment.body,
                line: comment.line,
                side: 'RIGHT' as const,
                ...(comment.startLine
                  ? {
                      start_line: comment.startLine,
                      start_side: 'RIGHT' as const,
                    }
                  : {}),
              })),
            }
          : {}),
      });

      return { id: data.id, htmlUrl: data.html_url ?? null };
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async listPullReviewComments(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const comments = await session.octokit.paginate(
        session.octokit.pulls.listReviewComments,
        { owner, repo, pull_number: pullNumber, per_page: 100 },
      );
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        user: comment.user?.login ?? null,
      }));
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async deletePullReviewComment(
    repo: string,
    commentId: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      await session.octokit.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async enqueueIndexJob(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<{ jobId: string; status: 'queued' }> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const sha = await this.resolveDefaultBranchSha(session.octokit, owner, repo);
      const jobId = buildIndexJobId(owner, repo, sha);
      await this.indexQueue.add(
        'build',
        { owner, repo, sha, userId: currentUser.id },

        { jobId, removeOnComplete: true, removeOnFail: true },
      );

      return { jobId, status: 'queued' };
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async getRepositoryIndexStatus(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<RepositoryIndexStatus> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const headSha = await this.resolveDefaultBranchSha(
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
      this.handleGithubError(err);
    }
  }

  async getRepositoryGraph(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
    sha?: string,
    focus?: string,
    depth?: number,
  ) {
    const owner = ownerOverride?.trim() || (await this.loginFor(currentUser));
    const repoId = `${owner}/${repo}`;

    const resolvedSha = sha ?? (await this.aiApiClient.getIndexStatus(repoId)).sha;
    if (!resolvedSha) {
      return { nodes: [], edges: [], stats: { indexed: false } };
    }

    return this.aiApiClient.getGraph(repoId, resolvedSha, focus, depth);
  }

  private async resolveDefaultBranchSha(
    octokit: Octokit,
    owner: string,
    repo: string,
  ): Promise<string> {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
    });
    return ref.object.sha;
  }

  async loginFor(currentUser: CurrentUserData): Promise<string> {
    const session = await this.session(currentUser);
    return session.owner;
  }
}
