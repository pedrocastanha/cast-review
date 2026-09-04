import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import { canonicalMapHash } from './map-hash';

function component(
  candidateKey: string,
  capabilityId: string,
): ArchitectureComponent {
  return {
    candidateKey,
    capabilityId,
    status: 'assigned',
    confidence: 'confirmed',
    source: 'manual',
  } as ArchitectureComponent;
}

const base = {
  capabilities: [{ id: 'cap-1', name: 'Autenticação', criticality: 'high' }],
  components: [component('acme/api:src/auth', 'cap-1')],
  boundaries: [],
  repositories: [
    {
      repoId: 'acme/api',
      sha: 'sha1',
      status: 'indexed',
      stale: false,
      indexed: true,
    },
  ],
};

describe('canonicalMapHash', () => {
  it('não muda quando apenas a ordem dos itens muda', () => {
    const reversed = {
      ...base,
      capabilities: [
        { id: 'cap-2', name: 'Cobrança', criticality: 'low' },
        ...base.capabilities,
      ],
    };
    const shuffled = {
      ...base,
      capabilities: [...reversed.capabilities].reverse(),
    };

    expect(canonicalMapHash(reversed)).toBe(canonicalMapHash(shuffled));
  });

  it('muda quando a associação de um componente muda', () => {
    const moved = {
      ...base,
      components: [component('acme/api:src/auth', 'cap-2')],
    };

    expect(canonicalMapHash(moved)).not.toBe(canonicalMapHash(base));
  });

  it('ignora componentes que não estão associados', () => {
    const withUnmapped = {
      ...base,
      components: [
        ...base.components,
        { candidateKey: 'acme/api:src/tmp', status: 'unmapped' } as ArchitectureComponent,
      ],
    };

    expect(canonicalMapHash(withUnmapped)).toBe(canonicalMapHash(base));
  });
});
