export type GithubInstallationStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'deleted';

export type GithubReviewRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'superseded'
  | 'cancelled';

export type GithubReviewSkipReason =
  | 'automation_disabled'
  | 'repository_paused'
  | 'installation_paused'
  | 'installation_inactive'
  | 'configuration_required'
  | 'budget_exceeded'
  | 'index_stale'
  | 'pull_closed'
  | 'superseded';

export type GithubReviewRunTrigger = 'webhook' | 'manual' | 'retry';

export type GithubWebhookDeliveryStatus =
  | 'received'
  | 'ignored'
  | 'queued'
  | 'duplicate'
  | 'failed';

export type GithubAppPublishPolicy = 'check_only' | 'comments';

export type StaleIndexBehavior = 'proceed' | 'skip';

export interface GithubAppRepositoryConfig {
  events: { opened: boolean; reopened: boolean; synchronize: boolean };
  includeDrafts: boolean;
  baseBranches: string[];
  models: { testReviewer: string; architectureReviewer: string } | null;
  impactScope: { mode: 'repository' } | { mode: 'project'; projectId: string };
  publishPolicy: GithubAppPublishPolicy;
  budgetMonthlyUsd: number | null;
  budgetPerRunUsd: number | null;
  staleIndexBehavior: StaleIndexBehavior;
}

export type RepositoryConfigStatus = 'ready' | 'configuration_required';

export interface CheckRunSnapshot {
  id: number | null;
  status: 'queued' | 'in_progress' | 'completed' | null;
  conclusion: 'success' | 'neutral' | 'failure' | null;
  htmlUrl: string | null;
}

export interface BudgetUsage {
  month: string;
  consumedUsd: number;
  reservedUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
}

export function defaultRepositoryConfig(): GithubAppRepositoryConfig {
  return {
    events: { opened: true, reopened: true, synchronize: true },
    includeDrafts: false,
    baseBranches: [],
    models: null,
    impactScope: { mode: 'repository' },
    publishPolicy: 'check_only',
    budgetMonthlyUsd: null,
    budgetPerRunUsd: null,
    staleIndexBehavior: 'proceed',
  };
}
