import type { AuthTokens, LoginPayload, RegisterPayload, User } from '../types';
import { request } from './http';

export const authApi = {
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  register: (payload: RegisterPayload) =>
    request<User>('/auth/register', { method: 'POST', body: payload, auth: false }),

  login: (payload: LoginPayload) =>
    request<AuthTokens>('/auth/login', { method: 'POST', body: payload, auth: false }),

  loginAsGuest: () =>
    request<AuthTokens>('/auth/demo', { method: 'POST', auth: false }),
};
