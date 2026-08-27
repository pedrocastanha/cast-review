import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface CreatePullReviewComment {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

export interface CreatePullReviewInput {
  commitId: string;
  body: string;
  comments: CreatePullReviewComment[];
}

export interface CreatePullReviewDto {
  repo: string;
  pullNumber: number;
  input: CreatePullReviewInput;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
