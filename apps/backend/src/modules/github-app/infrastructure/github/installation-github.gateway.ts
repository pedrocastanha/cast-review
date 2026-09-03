import { Octokit } from '@octokit/rest';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubPullFile } from '../../../repositories/types/github-pull.type';
import type {
  GithubPullGateway,
  GithubPullReviewCommentSummary,
  GithubPullSummary,
} from '../../../repositories/types/github-pull-gateway.type';
import type { CreatePullReviewInput } from '../../../repositories/use-cases/create-pull-review/create-pull-review.dto';
import { throwGithubError } from '../../../repositories/use-cases/shared/github-session.provider';
import { toPullSummary } from '../../../repositories/use-cases/shared/pull-summary.helper';
import type { InstallationTokenService } from './installation-token.service';

export class InstallationGithubGateway implements GithubPullGateway {
  constructor(
    private readonly tokenService: InstallationTokenService,
    private readonly installationId: string,
    private readonly owner: string,
    private readonly botLogin: string,
    private readonly logger: AppLogger,
  ) {}

  private async octokit(): Promise<Octokit> {
    return this.tokenService.clientFor(this.installationId);
  }

  private ownerFor(ownerOverride?: string): string {
    return ownerOverride?.trim() || this.owner;
  }

  private fail(err: unknown): never {
    this.tokenService.forget(this.installationId);
    return throwGithubError(err, this.logger);
  }

  async getPullByNumber(
    repo: string,
    pullNumber: number,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullSummary> {
    const octokit = await this.octokit();
    try {
      const { data } = await octokit.pulls.get({
        owner: this.ownerFor(ownerOverride),
        repo,
        pull_number: pullNumber,
      });
      return toPullSummary(data as never);
    } catch (err) {
      this.fail(err);
    }
  }

  async getPullDiff(
    repo: string,
    pullNumber: number,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const octokit = await this.octokit();
    try {
      const { data } = await octokit.pulls.get({
        owner: this.ownerFor(ownerOverride),
        repo,
        pull_number: pullNumber,
        mediaType: { format: 'diff' },
      });
      return data as unknown as string;
    } catch (err) {
      this.fail(err);
    }
  }

  async listPullFiles(
    repo: string,
    pullNumber: number,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullFile[]> {
    const octokit = await this.octokit();
    try {
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner: this.ownerFor(ownerOverride),
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });
      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        patch: file.patch,
      }));
    } catch (err) {
      this.fail(err);
    }
  }

  async getFileContent(
    repo: string,
    path: string,
    ref: string,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string | null> {
    const octokit = await this.octokit();
    try {
      const { data } = await octokit.repos.getContent({
        owner: this.ownerFor(ownerOverride),
        repo,
        path,
        ref,
      });
      if (Array.isArray(data) || data.type !== 'file' || !data.content)
        return null;
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      this.fail(err);
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

  async getPullHeadSha(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const pull = await this.getPullByNumber(
      repo,
      pullNumber,
      currentUser,
      ownerOverride,
    );
    return pull.headSha;
  }

  async createPullReview(
    repo: string,
    pullNumber: number,
    input: CreatePullReviewInput,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<{ id: number; htmlUrl: string | null }> {
    const octokit = await this.octokit();
    try {
      const { data } = await octokit.pulls.createReview({
        owner: this.ownerFor(ownerOverride),
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
      this.fail(err);
    }
  }

  async listPullReviewComments(
    repo: string,
    pullNumber: number,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullReviewCommentSummary[]> {
    const octokit = await this.octokit();
    try {
      const comments = await octokit.paginate(
        octokit.pulls.listReviewComments,
        {
          owner: this.ownerFor(ownerOverride),
          repo,
          pull_number: pullNumber,
          per_page: 100,
        },
      );
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        user: comment.user?.login ?? null,
      }));
    } catch (err) {
      this.fail(err);
    }
  }

  async deletePullReviewComment(
    repo: string,
    commentId: number,
    _currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<void> {
    const octokit = await this.octokit();
    try {
      await octokit.pulls.deleteReviewComment({
        owner: this.ownerFor(ownerOverride),
        repo,
        comment_id: commentId,
      });
    } catch (err) {
      this.fail(err);
    }
  }

  async loginFor(): Promise<string> {
    return this.botLogin;
  }
}
