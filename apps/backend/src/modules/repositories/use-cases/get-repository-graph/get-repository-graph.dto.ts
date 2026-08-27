import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface GetRepositoryGraphDto {
  repo: string;
  currentUser: CurrentUserData;
  ownerOverride?: string;
  sha?: string;
  focus?: string;
  depth?: number;
}
