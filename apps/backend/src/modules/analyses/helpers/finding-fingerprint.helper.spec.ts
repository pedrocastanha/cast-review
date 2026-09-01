import type { ReviewComment } from '../analyses.types';
import { fingerprintFindings } from './finding-fingerprint.helper';

function finding(partial: Partial<ReviewComment> = {}): ReviewComment {
  return {
    reviewer: 'test_reviewer',
    status: 'warning',
    title: 'Regra sem teste',
    detail: 'Nenhum teste cobre a regra.',
    path: 'src/use-cases/create.ts',
    line: 42,
    ...partial,
  };
}

describe('fingerprintFindings', () => {
  it('usa evidenceId antes das outras âncoras estáveis', () => {
    const [item] = fingerprintFindings([
      finding({
        evidenceId: ' EVIDENCE-01 ',
        conventionRef: 'CONV-02',
        businessRule: 'BR-03',
      }),
    ]);

    expect(item).toMatchObject({
      fingerprintVersion: '1',
      matchBasis: 'stable_anchor',
      fingerprintMaterial:
        'v1|test_reviewer|src/use-cases/create.ts|stable:evidence-01',
      sourceIndexes: [0],
      sourceCount: 1,
    });
    expect(item.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('usa conventionRef e depois businessRule quando necessário', () => {
    const [convention, rule] = fingerprintFindings([
      finding({ evidenceId: undefined, conventionRef: ' Camada  Fina ' }),
      finding({
        evidenceId: undefined,
        conventionRef: undefined,
        businessRule: ' Deve validar o token ',
      }),
    ]);

    expect(convention.fingerprintMaterial).toContain('stable:camada fina');
    expect(rule.fingerprintMaterial).toContain('stable:deve validar o token');
  });

  it('cai para título normalizado sem âncora estável', () => {
    const [item] = fingerprintFindings([
      finding({
        title: '  REGRA   sem\n teste ',
        path: './src\\use-cases//create.ts',
      }),
    ]);

    expect(item).toMatchObject({
      matchBasis: 'title_fallback',
      fingerprintMaterial:
        'v1|test_reviewer|src/use-cases/create.ts|title:regra sem teste',
    });
  });

  it('ignora severidade, detalhe e linhas na identidade', () => {
    const [left, right] = [
      fingerprintFindings([
        finding({ status: 'warning', detail: 'antes', line: 10 }),
      ])[0],
      fingerprintFindings([
        finding({ status: 'fail', detail: 'depois', line: 99, endLine: 102 }),
      ])[0],
    ];

    expect(left.fingerprint).toBe(right.fingerprint);
  });

  it('agrega duplicatas e conserva os índices de origem', () => {
    const items = fingerprintFindings([
      finding({ status: 'warning', line: 10 }),
      finding({ status: 'fail', line: 99 }),
      finding({ title: 'Outro finding' }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceCount: 2,
      sourceIndexes: [0, 1],
    });
    expect(items[0].finding.status).toBe('warning');
    expect(items[1].sourceIndexes).toEqual([2]);
  });
});
