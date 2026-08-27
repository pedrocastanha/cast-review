import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface ListReposDto {
  currentUser: CurrentUserData;
}
