import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface GetPullHeadShaDto {
  repo: string;
  pullNumber: number;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
