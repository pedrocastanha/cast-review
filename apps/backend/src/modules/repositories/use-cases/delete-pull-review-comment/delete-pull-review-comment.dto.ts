import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface DeletePullReviewCommentDto {
  repo: string;
  commentId: number;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
