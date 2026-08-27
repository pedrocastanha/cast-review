import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';

export interface EnqueueIndexJobDto {
  repo: string;
  currentUser: CurrentUserData;
  ownerOverride?: string;
}
