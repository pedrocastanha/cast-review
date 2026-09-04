import type {
  ArchitectureDependencyKind,
  CapabilityCriticality,
  ComponentConfidence,
} from '../../types';

export const criticalityLabel: Record<CapabilityCriticality, string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
  critical: 'crítica',
};

export const criticalityTone: Record<CapabilityCriticality, 'neutral' | 'accent' | 'warn' | 'fail'> = {
  low: 'neutral',
  medium: 'accent',
  high: 'warn',
  critical: 'fail',
};

export const criticalityColor: Record<CapabilityCriticality, string> = {
  low: '#50484c',
  medium: '#b85a79',
  high: '#c98a3e',
  critical: '#c9524f',
};

export const confidenceLabel: Record<ComponentConfidence, string> = {
  confirmed: 'confirmado',
  inferred: 'inferido',
};

export const dependencyKindLabel: Record<ArchitectureDependencyKind, string> = {
  references: 'chamadas',
  imports: 'imports',
  tests: 'testes',
  http: 'http',
};

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
