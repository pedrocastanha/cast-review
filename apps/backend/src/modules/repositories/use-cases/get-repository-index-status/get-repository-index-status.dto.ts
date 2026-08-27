import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface GetRepositoryIndexStatusDto {
  repo: string;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
