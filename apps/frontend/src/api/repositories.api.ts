import type {
  IndexJobEnqueued,
  PullRequest,
  Repository,
  RepositoryIndexStatus,
  VizGraph,
} from '../types';
import { request } from './http';

export const repositoriesApi = {
  list: (filters: { indexed?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (filters.indexed) params.set('indexed', 'true');
    const query = params.toString();
    return request<Repository[]>(`/repositories${query ? `?${query}` : ''}`);
  },

  listPulls: (repo: string, owner: string) =>
    request<PullRequest[]>(
      `/repositories/${encodeURIComponent(repo)}/pulls?owner=${encodeURIComponent(owner)}`,
    ),

  getPull: (repo: string, pullNumber: number, owner: string) =>
    request<PullRequest>(
      `/repositories/${encodeURIComponent(repo)}/pulls/${pullNumber}?owner=${encodeURIComponent(owner)}`,
    ),

  indexRepository: (repo: string, owner: string) =>
    request<IndexJobEnqueued>(
      `/repositories/${encodeURIComponent(repo)}/index?owner=${encodeURIComponent(owner)}`,
      { method: 'POST' },
    ),

  getIndexStatus: (repo: string, owner: string) =>
    request<RepositoryIndexStatus>(
      `/repositories/${encodeURIComponent(repo)}/index/status?owner=${encodeURIComponent(owner)}`,
    ),

  getGraph: (repo: string, owner: string, focus?: string, depth?: number) => {
    const params = new URLSearchParams({ owner: owner });
    if (focus) params.set('focus', focus);
    if (depth !== undefined) params.set('depth', String(depth));
    return request<VizGraph>(`/repositories/${encodeURIComponent(repo)}/graph?${params.toString()}`);
  },
};
