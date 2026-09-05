import { BadRequestException } from '@nestjs/common';
import type { ChatCitation } from '../../chat/chat.types';
import type { CardStatus, FeatureProposal, TaskProposal } from './card.types';

function invalid(): never {
  throw new BadRequestException('Proposta de cards inválida');
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}

function text(value: unknown, max = 2000): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : invalid();
}

function items(value: unknown, min = 0, max = 30): unknown[] {
  return Array.isArray(value) && value.length >= min && value.length <= max ? value as unknown[] : invalid();
}

function strings(value: unknown, min = 0): string[] {
  return items(value, min).map((item) => text(item));
}

function citation(value: unknown): ChatCitation {
  const c = object(value);
  const line = c.line == null ? null : Number.isInteger(c.line) && Number(c.line) > 0 ? Number(c.line) : invalid();
  return {
    repoId: text(c.repoId, 200), path: text(c.path, 400), line,
    sha: c.sha == null ? null : text(c.sha, 200),
    symbolId: c.symbolId == null ? null : text(c.symbolId, 500),
    symbolName: c.symbolName == null ? null : text(c.symbolName, 500),
  };
}

function task(value: unknown): TaskProposal {
  const t = object(value);
  const key = text(t.key, 40);
  if (key === 'feature' || !/^[a-z][a-z0-9_-]*$/.test(key)) invalid();
  const evidence = items(t.evidence, 0, 12).map(citation);
  if (t.confidence !== 'grounded' && t.confidence !== 'hypothesis') invalid();
  return {
    key, title: text(t.title, 160), area: text(t.area, 80),
    description: text(t.description), rationale: text(t.rationale),
    acceptanceCriteria: strings(t.acceptanceCriteria, 1),
    dependsOn: [...new Set(items(t.dependsOn, 0, 12).map((key) => text(key, 40)))],
    evidence, confidence: evidence.length ? 'grounded' : 'hypothesis',
  };
}

export function validateProposal(value: unknown): FeatureProposal {
  const p = object(value);
  const tasks = items(p.tasks, 1, 12).map(task);
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  if (byKey.size !== tasks.length) invalid();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    const current = byKey.get(key);
    if (!current || visiting.has(key)) invalid();
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of current.dependsOn) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) visit(key);
  return {
    title: text(p.title, 160), problem: text(p.problem), objective: text(p.objective),
    scope: strings(p.scope), outOfScope: strings(p.outOfScope), businessRules: strings(p.businessRules),
    acceptanceCriteria: strings(p.acceptanceCriteria, 1), edgeCases: strings(p.edgeCases),
    openQuestions: strings(p.openQuestions), tasks,
  };
}

export function assertTransition(status: CardStatus, questions: string[], dependencies: CardStatus[], children: CardStatus[]) {
  if (status !== 'draft' && questions.length) {
    throw new BadRequestException('Resolva as perguntas abertas antes de avançar.');
  }
  if (['in_progress', 'review', 'done'].includes(status) && dependencies.some((s) => s !== 'done')) {
    throw new BadRequestException('Conclua as dependências antes de avançar.');
  }
  if (status === 'done' && children.some((s) => s !== 'done')) {
    throw new BadRequestException('Conclua os cards filhos antes de concluir a feature.');
  }
}
