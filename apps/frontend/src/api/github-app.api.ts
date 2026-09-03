import type {
  GithubAppRepositorySummary,
  GithubInstallationSummary,
  GithubReviewRunSummary,
  UpdateRepositoryConfigPayload,
} from '../types';
import { request } from './http';

export const githubAppApi = {
  installUrl: () => request<{ url: string; state: string }>('/github-app/install-url'),

  link: (installationId: string, state: string) =>
    request<GithubInstallationSummary>('/github-app/installations', {
      method: 'POST',
      body: { installationId, state },
    }),

  list: () => request<GithubInstallationSummary[]>('/github-app/installations'),

  detail: (id: string) =>
    request<GithubInstallationSummary>(`/github-app/installations/${encodeURIComponent(id)}`),

  refresh: (id: string) =>
    request<GithubInstallationSummary>(
      `/github-app/installations/${encodeURIComponent(id)}/refresh`,
      { method: 'POST' },
    ),

  pause: (id: string) =>
    request<GithubInstallationSummary>(
      `/github-app/installations/${encodeURIComponent(id)}/pause`,
      { method: 'POST' },
    ),

  resume: (id: string) =>
    request<GithubInstallationSummary>(
      `/github-app/installations/${encodeURIComponent(id)}/resume`,
      { method: 'POST' },
    ),

  unlink: (id: string) =>
    request<{ status: 'unlinked' }>(`/github-app/installations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  updateRepository: (repositoryId: string, payload: UpdateRepositoryConfigPayload) =>
    request<GithubAppRepositorySummary>(
      `/github-app/repositories/${encodeURIComponent(repositoryId)}`,
      { method: 'PATCH', body: payload },
    ),

  listRuns: (repositoryId: string) =>
    request<GithubReviewRunSummary[]>(
      `/github-app/repositories/${encodeURIComponent(repositoryId)}/runs`,
    ),

  triggerRun: (repositoryId: string, pullNumber: number) =>
    request<{ status: string; reviewRunId?: string }>(
      `/github-app/repositories/${encodeURIComponent(repositoryId)}/runs`,
      { method: 'POST', body: { pullNumber } },
    ),

  retryRun: (runId: string) =>
    request<{ status: string; reviewRunId?: string }>(
      `/github-app/runs/${encodeURIComponent(runId)}/retry`,
      { method: 'POST' },
    ),
};
