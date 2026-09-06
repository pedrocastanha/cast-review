import { request } from './http';
import type { CardContent, CardRevision, CardStatus, FeatureCard } from '../types/feature-cards';

const path = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/cards`;

export const featureCardsApi = {
  list: (projectId: string, after?: string) => request<{ items: FeatureCard[]; nextCursor: string | null }>(`${path(projectId)}${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  save: (projectId: string, messageId: string) => request<FeatureCard[]>(`${path(projectId)}/from-message`, { method: 'POST', body: { messageId } }),
  update: (projectId: string, id: string, body: { version: number; title?: string; status?: CardStatus; content?: CardContent }) => request<FeatureCard>(`${path(projectId)}/${id}`, { method: 'PATCH', body }),
  archive: (projectId: string, id: string, version: number) => request<void>(`${path(projectId)}/${id}/archive`, { method: 'POST', body: { version } }),
  history: (projectId: string, id: string) => request<CardRevision[]>(`${path(projectId)}/${id}/history`),
};
