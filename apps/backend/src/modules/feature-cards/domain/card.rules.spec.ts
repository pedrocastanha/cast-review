import { assertTransition, validateProposal } from './card.rules';

const draft = () => ({
  title: 'Notificações',
  problem: 'Sem avisos',
  objective: 'Consultar avisos',
  scope: ['Inbox'],
  outOfScope: [],
  businessRules: ['Privado'],
  acceptanceCriteria: ['Conclusão aparece'],
  edgeCases: [],
  openQuestions: [],
  tasks: [
    {
      key: 'api',
      title: 'Persistir',
      area: 'Backend',
      description: 'Salvar evento',
      rationale: 'Consultar depois',
      acceptanceCriteria: ['Sem duplicatas'],
      dependsOn: [] as string[],
      evidence: [],
      confidence: 'hypothesis',
    },
  ],
});

describe('card rules', () => {
  it('accepts a bounded proposal', () => {
    expect(validateProposal(draft()).tasks).toHaveLength(1);
  });
  it('rejects unknown dependencies, cycles and duplicate keys', () => {
    for (const dependsOn of [['missing'], ['api']]) {
      const data = draft();
      data.tasks[0].dependsOn = dependsOn;
      expect(() => validateProposal(data)).toThrow();
    }
    const data = draft();
    data.tasks.push(data.tasks[0]);
    expect(() => validateProposal(data)).toThrow();
  });
  it('rejects incomplete and unbounded fields', () => {
    expect(() => validateProposal({ ...draft(), title: '' })).toThrow();
    expect(() => validateProposal({ ...draft(), tasks: [] })).toThrow();
    expect(() =>
      validateProposal({ ...draft(), openQuestions: ['x'.repeat(2001)] }),
    ).toThrow();
  });
  it('requires decisions before ready or done', () => {
    expect(() => assertTransition('ready', ['Qual canal?'], [], [])).toThrow();
    expect(() => assertTransition('done', ['Qual canal?'], [], [])).toThrow();
    expect(() =>
      assertTransition('draft', ['Qual canal?'], [], []),
    ).not.toThrow();
  });
  it('requires dependencies before starting and children before completing', () => {
    expect(() => assertTransition('in_progress', [], ['ready'], [])).toThrow();
    expect(() => assertTransition('done', [], ['done'], ['review'])).toThrow();
    expect(() =>
      assertTransition('done', [], ['done'], ['done']),
    ).not.toThrow();
  });
});
