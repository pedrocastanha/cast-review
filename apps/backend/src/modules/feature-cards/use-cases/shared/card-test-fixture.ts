import type { FeatureProposal } from '../../domain/card.types';

export function proposalFixture(): FeatureProposal {
  return {
    title: 'Notificações', problem: 'Usuário perde conclusão', objective: 'Consultar avisos',
    scope: ['Inbox'], outOfScope: ['Email'], businessRules: ['Privacidade'],
    acceptanceCriteria: ['Conclusão cria aviso'], edgeCases: ['Reexecução'], openQuestions: [],
    tasks: [
      { key: 'api', title: 'Persistir avisos', area: 'Backend', description: 'Salvar evento', rationale: 'Consultar depois', acceptanceCriteria: ['Evento idempotente'], dependsOn: [], confidence: 'hypothesis', evidence: [] },
      { key: 'ui', title: 'Exibir avisos', area: 'Frontend', description: 'Mostrar inbox', rationale: 'Visibilidade', acceptanceCriteria: ['Lista avisos'], dependsOn: ['api'], confidence: 'hypothesis', evidence: [] },
    ],
  };
}
