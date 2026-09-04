import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import { calculateCoverage } from './coverage';

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

describe('calculateCoverage', () => {
  it('calcula cobertura estrutural desconsiderando componentes rejeitados', () => {
    const coverage = calculateCoverage([
      component('c1', 'auth'),
      component('c2', null),
      component('c3', null, { status: 'rejected' }),
    ]);

    expect(coverage.totalComponents).toBe(2);
    expect(coverage.assignedComponents).toBe(1);
    expect(coverage.unmappedComponents).toBe(1);
    expect(coverage.rejectedComponents).toBe(1);
    expect(coverage.structural).toBe(0.5);
  });

  it('retorna cobertura zero quando não existe componente elegível', () => {
    expect(calculateCoverage([]).structural).toBe(0);
  });
});
