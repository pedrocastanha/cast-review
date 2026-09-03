import type { GithubAppRepository } from '../entities/github-app-repository.entity';
import type { GithubInstallation } from '../entities/github-installation.entity';
import type { GithubReviewSkipReason } from './github-app.types';

export const ELIGIBLE_ACTIONS = ['opened', 'reopened', 'synchronize'] as const;
export type EligibleAction = (typeof ELIGIBLE_ACTIONS)[number];

export interface PullEventFacts {
  action: string;
  draft: boolean;
  baseRef: string;
  state: string;
}

export type EligibilityResult =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | GithubReviewSkipReason
        | 'event_not_enabled'
        | 'draft'
        | 'base_branch'
        | 'pull_not_open'
        | 'unsupported_action';
    };

export function isEligibleAction(action: string): action is EligibleAction {
  return (ELIGIBLE_ACTIONS as readonly string[]).includes(action);
}

export function evaluateInstallation(
  installation: GithubInstallation | null,
): EligibilityResult {
  if (
    !installation ||
    installation.status !== 'active' ||
    !installation.ownerUserId
  ) {
    return { eligible: false, reason: 'installation_inactive' };
  }
  if (installation.pausedAt) {
    return { eligible: false, reason: 'installation_paused' };
  }
  return { eligible: true };
}

export function evaluateRepository(
  repository: GithubAppRepository | null,
): EligibilityResult {
  if (!repository || repository.removedAt) {
    return { eligible: false, reason: 'installation_inactive' };
  }
  if (!repository.enabled) {
    return { eligible: false, reason: 'automation_disabled' };
  }
  if (repository.pausedAt) {
    return { eligible: false, reason: 'repository_paused' };
  }
  if (repository.configStatus !== 'ready') {
    return { eligible: false, reason: 'configuration_required' };
  }
  return { eligible: true };
}

export function evaluatePullEvent(
  repository: GithubAppRepository,
  facts: PullEventFacts,
): EligibilityResult {
  if (!isEligibleAction(facts.action)) {
    return { eligible: false, reason: 'unsupported_action' };
  }
  if (!repository.config.events[facts.action]) {
    return { eligible: false, reason: 'event_not_enabled' };
  }
  if (facts.state !== 'open') {
    return { eligible: false, reason: 'pull_not_open' };
  }
  if (facts.draft && !repository.config.includeDrafts) {
    return { eligible: false, reason: 'draft' };
  }
  const branches = repository.config.baseBranches
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    branches.length > 0 &&
    !branches.some((pattern) => matchesBranch(pattern, facts.baseRef))
  ) {
    return { eligible: false, reason: 'base_branch' };
  }
  return { eligible: true };
}

export function matchesBranch(pattern: string, ref: string): boolean {
  if (pattern === ref) return true;
  if (!pattern.includes('*')) return false;
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(ref);
}
