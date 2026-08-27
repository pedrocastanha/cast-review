import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface GetPullByNumberDto {
  repo: string;
  pullNumber: number;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
