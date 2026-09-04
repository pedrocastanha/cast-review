import type { ArchitectureComponentDependency } from 'src/shared/types';
import type { ArchitectureBoundary } from '../entities/architecture-boundary.entity';
import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import { detectBoundaryViolations } from './boundary.rules';
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
): ArchitectureComponentDependency {
  return {
    fromComponentId: from,
    toComponentId: to,
    kind: 'references',
    count: 3,
    confidence: 'confirmed',
    evidence: [],
  };
}

function boundary(
  id: string,
  from: string,
  to: string,
  kind: ArchitectureBoundary['kind'],
): ArchitectureBoundary {
  return { id, fromCapabilityId: from, toCapabilityId: to, kind } as ArchitectureBoundary;
}

describe('detectBoundaryViolations', () => {
  const components = [component('c1', 'auth'), component('c2', 'billing')];

  it('confirma violação de deny apenas sobre relação técnica confirmada', () => {
    const dependencies = buildCapabilityDependencies(components, [
      dependency('c1', 'c2'),
    ]);
    const [violation] = detectBoundaryViolations(
      [boundary('b1', 'auth', 'billing', 'deny')],
      dependencies,
    );

    expect(violation.severity).toBe('violation');
    expect(violation.confidence).toBe('confirmed');
  });

  it('rebaixa deny para aviso quando a relação é apenas inferida', () => {
    const inferred = [
      component('c1', 'auth', { confidence: 'inferred' }),
      component('c2', 'billing'),
    ];
    const dependencies = buildCapabilityDependencies(inferred, [
      dependency('c1', 'c2'),
    ]);
    const [violation] = detectBoundaryViolations(
      [boundary('b1', 'auth', 'billing', 'deny')],
      dependencies,
    );

    expect(violation.severity).toBe('warning');
  });

  it('nunca reporta violação quando não existe relação técnica', () => {
    expect(
      detectBoundaryViolations([boundary('b1', 'auth', 'billing', 'deny')], []),
    ).toEqual([]);
  });

  it('ignora fronteiras allow', () => {
    const dependencies = buildCapabilityDependencies(components, [
      dependency('c1', 'c2'),
    ]);
    expect(
      detectBoundaryViolations(
        [boundary('b1', 'auth', 'billing', 'allow')],
        dependencies,
      ),
    ).toEqual([]);
  });

  it('trata review como aviso mesmo com relação confirmada', () => {
    const dependencies = buildCapabilityDependencies(components, [
      dependency('c1', 'c2'),
    ]);
    const [violation] = detectBoundaryViolations(
      [boundary('b1', 'auth', 'billing', 'review')],
      dependencies,
    );

    expect(violation.severity).toBe('warning');
  });
});
