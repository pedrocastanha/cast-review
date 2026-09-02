import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import type { GithubInstallation } from '../../entities/github-installation.entity';
import type { GithubReviewRun } from '../../entities/github-review-run.entity';

export function toInstallationSummary(installation: GithubInstallation) {
  return {
    id: installation.id,
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    status: installation.status,
    paused: Boolean(installation.pausedAt),
    repositorySelection: installation.repositorySelection,
    permissions: installation.permissions,
    linkedAt: installation.linkedAt?.toISOString() ?? null,
    lastEventAt: installation.lastEventAt?.toISOString() ?? null,
  };
}

export function toRepositorySummary(repository: GithubAppRepository) {
  return {
    id: repository.id,
    installationId: repository.installationId,
    owner: repository.owner,
    repo: repository.repo,
    fullName: repository.fullName,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    enabled: repository.enabled,
    paused: Boolean(repository.pausedAt),
    configStatus: repository.configStatus,
    configReason: repository.configReason,
    config: repository.config,
  };
}

export function toReviewRunSummary(run: GithubReviewRun) {
  return {
    id: run.id,
    pullNumber: run.pullNumber,
    headSha: run.headSha,
    status: run.status,
    skipReason: run.skipReason,
    errorMessage: run.errorMessage,
    analysisId: run.analysisId,
    trigger: run.trigger,
    eventAction: run.eventAction,
    checkRun: run.checkRun,
    consumedUsd: run.consumedUsd,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
