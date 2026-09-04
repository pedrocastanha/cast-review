import type {
  ArchitectureMapSummary,
  ArchitectureMapVersionSummary,
  ArchitectureScopeType,
  ArchitectureView,
  BoundaryKind,
  CapabilityBoundary,
  CapabilityCriticality,
  ComponentStatus,
  SuggestComponentsResult,
} from '../types';
import { request } from './http';

export interface CapabilityPayload {
  name: string;
  description?: string | null;
  criticality: CapabilityCriticality;
}

export const architectureApi = {
  forScope: (scopeType: ArchitectureScopeType, scopeRef: string) =>
    request<{ map: ArchitectureMapSummary | null }>(
      `/architecture-maps/for-scope?scopeType=${scopeType}&scopeRef=${encodeURIComponent(scopeRef)}`,
    ).then((result) => result.map),
  create: (scopeType: ArchitectureScopeType, scopeRef: string, name?: string) =>
    request<ArchitectureMapSummary>('/architecture-maps', {
      method: 'POST',
      body: { scopeType, scopeRef, name },
    }),
  view: (mapId: string) => request<ArchitectureView>(`/architecture-maps/${mapId}`),
  suggest: (mapId: string) =>
    request<SuggestComponentsResult>(`/architecture-maps/${mapId}/suggestions`, { method: 'POST' }),
  createCapability: (mapId: string, payload: CapabilityPayload) =>
    request<{ id: string }>(`/architecture-maps/${mapId}/capabilities`, { method: 'POST', body: payload }),
  updateCapability: (mapId: string, capabilityId: string, payload: CapabilityPayload) =>
    request<{ id: string }>(`/architecture-maps/${mapId}/capabilities/${capabilityId}`, {
      method: 'PATCH',
      body: payload,
    }),
  deleteCapability: (mapId: string, capabilityId: string) =>
    request<{ id: string }>(`/architecture-maps/${mapId}/capabilities/${capabilityId}`, { method: 'DELETE' }),
  assignComponent: (mapId: string, componentId: string, status: ComponentStatus, capabilityId?: string | null) =>
    request<{ id: string }>(`/architecture-maps/${mapId}/components/${componentId}`, {
      method: 'PATCH',
      body: { status, capabilityId: capabilityId ?? null },
    }),
  declareBoundary: (
    mapId: string,
    payload: { fromCapabilityId: string; toCapabilityId: string; kind: BoundaryKind; note?: string | null },
  ) => request<CapabilityBoundary>(`/architecture-maps/${mapId}/boundaries`, { method: 'POST', body: payload }),
  deleteBoundary: (mapId: string, boundaryId: string) =>
    request<{ id: string }>(`/architecture-maps/${mapId}/boundaries/${boundaryId}`, { method: 'DELETE' }),
  publish: (mapId: string) =>
    request<{ version: number; hash: string; publishedAt: string }>(`/architecture-maps/${mapId}/versions`, {
      method: 'POST',
    }),
  versions: (mapId: string) =>
    request<ArchitectureMapVersionSummary[]>(`/architecture-maps/${mapId}/versions`),
};
