import type { ChatCitation, ChatScopeRepository } from './index';

export const CARD_COLUMNS = [
  { status: 'draft', label: 'Rascunho', hint: 'Propostas salvas do chat entram aqui.' },
  { status: 'ready', label: 'Pronto', hint: 'Sem bloqueio e com critério de aceite.' },
  { status: 'in_progress', label: 'Em andamento', hint: 'Puxe um card pronto ao começar.' },
  { status: 'review', label: 'Em revisão', hint: 'Aguardando revisão ou PR aberto.' },
  { status: 'done', label: 'Concluído', hint: 'Entregue e verificado.' },
] as const;
export type CardStatus = (typeof CARD_COLUMNS)[number]['status'];

export interface TaskProposal {
  key: string;
  title: string;
  area: string;
  description: string;
  rationale: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
  evidence: ChatCitation[];
  confidence: 'grounded' | 'hypothesis';
}

export interface FeatureProposal {
  title: string;
  problem: string;
  objective: string;
  scope: string[];
  outOfScope: string[];
  businessRules: string[];
  acceptanceCriteria: string[];
  edgeCases: string[];
  openQuestions: string[];
  tasks: TaskProposal[];
}

export interface CardContent {
  description: string;
  rationale: string;
  scope: string[];
  outOfScope: string[];
  businessRules: string[];
  acceptanceCriteria: string[];
  edgeCases: string[];
  openQuestions: string[];
}

export interface FeatureCard {
  id: string;
  projectId: string;
  parentId: string | null;
  sourceMessageId: string;
  taskKey: string;
  title: string;
  area: string;
  status: CardStatus;
  version: number;
  active: boolean;
  content: CardContent;
  snapshot: { threadId?: string; repositories: ChatScopeRepository[]; evidence: ChatCitation[]; confidence: 'grounded' | 'hypothesis' };
  dependsOn: string[];
}

export interface CardRevision {
  id: string;
  version: number;
  createdAt: string;
  snapshot: FeatureCard;
}
