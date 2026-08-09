import type { PullRequest, Repository } from '../types';
import { request } from './http';

export const repositoriesApi = {
  list: () => request<Repository[]>('/repositories'),

  listPulls: (repo: string, owner: string) =>
    request<PullRequest[]>(
      `/repositories/${encodeURIComponent(repo)}/pulls?owner=${encodeURIComponent(owner)}`,
    ),

  getPull: (repo: string, pullNumber: number, owner: string) =>
    request<PullRequest>(
      `/repositories/${encodeURIComponent(repo)}/pulls/${pullNumber}?owner=${encodeURIComponent(owner)}`,
    ),
};
