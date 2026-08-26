import type { EligibleProject, Project, ProjectGraph, ProjectIndexStatus, ProjectPayload } from '../types';
import { request } from './http';

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  eligible: (repository: string) =>
    request<EligibleProject[]>(`/projects/eligible?repository=${encodeURIComponent(repository)}`),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (payload: ProjectPayload) => request<Project>('/projects', { method: 'POST', body: payload }),
  update: (id: string, payload: ProjectPayload) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: payload }),
  index: (id: string) => request<{ projectId: string }>(`/projects/${id}/index`, { method: 'POST' }),
  status: (id: string) => request<ProjectIndexStatus>(`/projects/${id}/index/status`),
  graph: (id: string) => request<ProjectGraph>(`/projects/${id}/graph`),
};
