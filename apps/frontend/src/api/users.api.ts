import type { UpdateUserPayload, User } from '../types';
import { request } from './http';

export const usersApi = {
  getById: (id: string) => request<User>(`/users/${id}`),

  update: (id: string, payload: UpdateUserPayload) =>
    request<User>(`/users/${id}`, { method: 'PATCH', body: payload }),

  disconnectGithub: (id: string) =>
    request<User>(`/users/${id}/github-token`, { method: 'DELETE' }),
};
