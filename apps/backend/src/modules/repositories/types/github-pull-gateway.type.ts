import type { CurrentUserData } from '../../auth/utils/current-user-decorator';
import type { CreatePullReviewInput } from '../use-cases/create-pull-review/create-pull-review.dto';
import type { GithubPullFile } from './github-pull.type';

export interface GithubPullSummary {
  id: number;
  number: number;
  title: string;
  state: string;
  user: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  draft: boolean;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
}

export interface GithubPullReviewCommentSummary {
  id: number;
  body: string;
  user: string | null;
}

export interface GithubPullGateway {
  getPullByNumber(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullSummary>;
  getPullDiff(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string>;
  listPullFiles(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullFile[]>;
  getFileContent(
    repo: string,
    path: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string | null>;
  getConventions(
    repo: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string>;
  getPullHeadSha(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string>;
  createPullReview(
    repo: string,
    pullNumber: number,
    input: CreatePullReviewInput,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<{ id: number; htmlUrl: string | null }>;
  listPullReviewComments(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullReviewCommentSummary[]>;
  deletePullReviewComment(
    repo: string,
    commentId: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<void>;
  loginFor(currentUser: CurrentUserData): Promise<string>;
}
