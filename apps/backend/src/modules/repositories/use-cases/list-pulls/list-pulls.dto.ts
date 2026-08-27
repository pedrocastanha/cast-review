import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface ListPullsDto {
  repo: string;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
