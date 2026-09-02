import type { UserService } from '../../../users/user.service';
import type { GithubAppRepositoryConfig } from '../../domain/github-app.types';

export interface ReadinessResult {
  ready: boolean;
  reason: string | null;
}

export async function evaluateReadiness(
  userService: UserService,
  userId: string,
  config: GithubAppRepositoryConfig,
): Promise<ReadinessResult> {
  if (!config.models?.testReviewer || !config.models?.architectureReviewer) {
    return { ready: false, reason: 'Escolha os modelos usados na revisão.' };
  }
  if (config.budgetMonthlyUsd === null) {
    return { ready: false, reason: 'Defina o teto mensal em USD.' };
  }
  try {
    await userService.getOpenaiKey(userId);
  } catch {
    return {
      ready: false,
      reason: 'Configure a chave da OpenAI em Configurações antes de ativar.',
    };
  }
  return { ready: true, reason: null };
}
