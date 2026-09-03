import type { AnalysisReview } from '../../analyses/analyses.types';
import type { GithubReviewSkipReason } from './github-app.types';

export const CHECK_RUN_NAME = 'Cast Review';

export interface CheckRunOutput {
  title: string;
  summary: string;
  text?: string;
}

const VERDICT_LABEL: Record<string, string> = {
  approve: 'Aprovar',
  comment: 'Comentar',
  request_changes: 'Pedir mudanças',
};

export const SKIP_REASON_LABEL: Record<GithubReviewSkipReason, string> = {
  automation_disabled: 'Automação desligada para este repositório',
  repository_paused: 'Repositório pausado no Cast',
  installation_paused: 'Instalação pausada no Cast',
  installation_inactive: 'Instalação inativa ou sem vínculo',
  configuration_required:
    'Configuração incompleta (chave, modelos ou orçamento)',
  budget_exceeded: 'Limite de orçamento atingido',
  index_stale: 'Índice do repositório desatualizado',
  pull_closed: 'Pull request fechada',
  superseded: 'Superada por novo push',
};

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/d';
  return `US$ ${value.toFixed(4)}`;
}

export function conclusionFor(review: AnalysisReview): 'success' | 'neutral' {
  return review.verdict === 'approve' ? 'success' : 'neutral';
}

export function buildCompletedOutput(input: {
  review: AnalysisReview;
  analysisUrl: string;
  durationMs: number;
  headSha: string;
  commentsPosted: number | null;
}): CheckRunOutput {
  const { review } = input;
  const verdict = review.verdict
    ? VERDICT_LABEL[review.verdict]
    : 'Sem veredito';
  const score =
    review.overallScore !== undefined ? ` · nota ${review.overallScore}` : '';
  const lifecycle = review.findingLifecycle;
  const lines = [
    `**Veredito informativo:** ${verdict}${score}`,
    '',
    `- Findings: ${review.failCount ?? 0} fail · ${review.warningCount ?? 0} warning`,
  ];
  if (lifecycle?.status === 'available') {
    lines.push(
      `- Lifecycle: ${lifecycle.newCount} novos · ${lifecycle.recurringCount} recorrentes · ${lifecycle.reopenedCount} reabertos · ${lifecycle.acknowledgedCount} reconhecidos · ${lifecycle.notObservedCount} não observados`,
    );
  } else {
    lines.push('- Lifecycle: indisponível nesta execução');
  }
  lines.push(
    `- Custo: ${money(review.usage?.costUsd)} · duração ${(input.durationMs / 1000).toFixed(1)}s`,
  );
  if (input.commentsPosted !== null) {
    lines.push(`- Comentários publicados: ${input.commentsPosted}`);
  }
  if (review.githubComments?.status === 'skipped') {
    lines.push(
      `- Comentários não publicados: ${review.githubComments.errorMessage ?? 'motivo não informado'}`,
    );
  }
  lines.push(
    '',
    `[Abrir relatório completo no Cast](${input.analysisUrl})`,
    '',
    `SHA analisado: \`${input.headSha}\``,
  );

  return {
    title: `${verdict}${score}`,
    summary: lines.join('\n'),
    text: review.markdown?.slice(0, 60_000),
  };
}

export function buildSkippedOutput(
  reason: GithubReviewSkipReason,
  detail?: string | null,
): CheckRunOutput {
  return {
    title: 'Análise não executada',
    summary: `${SKIP_REASON_LABEL[reason]}${detail ? `\n\n${detail}` : ''}`,
  };
}

export function buildFailedOutput(
  message: string,
  analysisUrl: string | null,
): CheckRunOutput {
  return {
    title: 'Falha operacional do Cast Review',
    summary: [
      'A análise não pôde ser concluída. Isso não bloqueia o merge.',
      '',
      `Motivo: ${message}`,
      analysisUrl ? `\n[Ver execução no Cast](${analysisUrl})` : '',
    ].join('\n'),
  };
}

export function buildSupersededOutput(
  newHeadSha: string | null,
): CheckRunOutput {
  return {
    title: 'Superada por novo push',
    summary: newHeadSha
      ? `Um novo commit (\`${newHeadSha}\`) chegou durante a análise. O resultado desta execução não foi publicado como atual.`
      : 'Um novo commit chegou durante a análise. O resultado desta execução não foi publicado como atual.',
  };
}
