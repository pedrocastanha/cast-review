import type { ChatCitation, ChatScopeRepository } from '../../chat/chat.types';

export const CARD_STATUSES = [
  'draft',
  'ready',
  'in_progress',
  'review',
  'done',
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

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

export interface CardSnapshot {
  threadId?: string;
  repositories: ChatScopeRepository[];
  evidence: ChatCitation[];
  confidence: 'grounded' | 'hypothesis';
}
