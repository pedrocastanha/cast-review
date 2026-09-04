import type { ArchitectureComponentDependency } from 'src/shared/types';
import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import { buildCapabilityDependencies } from './capability-graph';

function component(
  id: string,
  capabilityId: string | null,
  overrides: Partial<ArchitectureComponent> = {},
): ArchitectureComponent {
  return {
    id,
    capabilityId,
    status: capabilityId ? 'assigned' : 'unmapped',
    confidence: capabilityId ? 'confirmed' : 'inferred',
    ...overrides,
  } as ArchitectureComponent;
}

function dependency(
  from: string,
  to: string,
  overrides: Partial<ArchitectureComponentDependency> = {},
): ArchitectureComponentDependency {
  return {
    fromComponentId: from,
    toComponentId: to,
    kind: 'references',
    count: 3,
    confidence: 'confirmed',
    evidence: [],
    ...overrides,
  };
}

describe('buildCapabilityDependencies', () => {
  it('agrega dependências de componentes na capacidade correspondente', () => {
    const components = [component('c1', 'auth'), component('c2', 'billing')];
    const result = buildCapabilityDependencies(components, [
      dependency('c1', 'c2'),
      dependency('c1', 'c2', { kind: 'imports', count: 2 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].fromCapabilityId).toBe('auth');
    expect(result[0].toCapabilityId).toBe('billing');
    expect(result[0].count).toBe(5);
    expect(result[0].kinds).toEqual(['references', 'imports']);
  });

  it('ignora componentes não associados a nenhuma capacidade', () => {
    const components = [component('c1', 'auth'), component('c2', null)];
    expect(
      buildCapabilityDependencies(components, [dependency('c1', 'c2')]),
    ).toEqual([]);
  });

  it('ignora dependências internas a uma mesma capacidade', () => {
    const components = [component('c1', 'auth'), component('c2', 'auth')];
    expect(
      buildCapabilityDependencies(components, [dependency('c1', 'c2')]),
    ).toEqual([]);
  });

  it('marca a relação como inferida quando alguma ponta não foi confirmada', () => {
    const components = [
      component('c1', 'auth', { confidence: 'inferred' }),
      component('c2', 'billing'),
    ];
    const [result] = buildCapabilityDependencies(components, [
      dependency('c1', 'c2'),
    ]);

    expect(result.confidence).toBe('inferred');
  });
});
