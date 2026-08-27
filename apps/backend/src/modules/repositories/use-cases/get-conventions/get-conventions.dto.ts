import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface GetConventionsDto {
  repo: string;
  ref: string;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
