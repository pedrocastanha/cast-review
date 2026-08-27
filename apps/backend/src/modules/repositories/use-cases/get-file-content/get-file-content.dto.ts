import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface GetFileContentDto {
  repo: string;
  path: string;
  ref: string;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
