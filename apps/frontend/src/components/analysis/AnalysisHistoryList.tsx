import { Link } from 'react-router-dom';
import type { AnalysisRecord } from '../../types';
import { formatUsageChip } from '../../lib/format-usage';
import { EmptyState } from '../ui/EmptyState';
import { AnalysisStatusBadge } from './AnalysisStatusBadge';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function scoresLabel(record: AnalysisRecord) {
  if (record.report?.overallScore !== undefined) {
    const verdict =
      record.report.verdict === 'approve'
        ? 'aprovar'
        : record.report.verdict === 'comment'
          ? 'comentar'
          : record.report.verdict === 'request_changes'
            ? 'mudanças'
            : null;
    return verdict ? `${record.report.overallScore} · ${verdict}` : String(record.report.overallScore);
  }
  const results = record.report?.results ?? [];
  if (results.length === 0) return null;
  return results.map((result) => result.score).join(' · ');
}

function commentsCount(record: AnalysisRecord) {
  if (record.report?.comments?.length) return record.report.comments.length;
  return (
    record.report?.results?.reduce((sum, result) => sum + (result.findings?.length ?? 0), 0) ?? 0
  );
}

function formatWhen(value: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

interface AnalysisHistoryListProps {
  owner: string;
  repo: string;
  analyses: AnalysisRecord[];
  emptyTitle?: string;
  emptyDescription?: string;
}

export function AnalysisHistoryList({
  owner,
  repo,
  analyses,
  emptyTitle = 'Nenhuma análise neste repositório',
  emptyDescription = 'Abra uma pull request e rode a primeira análise pra ela aparecer aqui.',
}: AnalysisHistoryListProps) {
  if (analyses.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {analyses.map((analysis) => {
        const scores = scoresLabel(analysis);
        const comments = commentsCount(analysis);
        const cost = formatUsageChip(analysis.report?.usage);
        const href = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/analyses/${analysis.id}`;

        return (
          <Link
            key={analysis.id}
            to={href}
            className="group flex w-full items-center justify-between gap-4 rounded-md border border-border bg-surface-1 px-4 py-4 text-left transition-[background-color,border-color] duration-200 hover:border-border-strong hover:bg-surface-2 sm:gap-6 sm:px-5"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-ink-faint">#{analysis.pullNumber}</span>
                <AnalysisStatusBadge status={analysis.status} />
                {analysis.impactScope && (
                  <span
                    className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
                      analysis.impactScope.requestedMode === 'repository'
                        ? 'border-border text-ink-faint'
                        : analysis.impactScope.status === 'exact'
                          ? 'border-state-open/50 text-state-open'
                          : 'border-accent/50 text-accent'
                    }`}
                  >
                    {analysis.impactScope.requestedMode === 'repository'
                      ? 'esta PR'
                      : analysis.impactScope.status === 'fallback'
                        ? 'fallback local'
                        : `${analysis.impactScope.projectName ?? 'projeto'} · ${analysis.impactScope.status}`}
                  </span>
                )}
                {scores && (
                  <span className="font-mono text-xs tabular-nums text-ink">{scores}</span>
                )}
                {cost && (
                  <span className="font-mono text-xs tabular-nums text-ink-faint">{cost}</span>
                )}
              </div>
              <p className="mt-1.5 font-mono text-xs text-ink-faint">
                {comments} {comments === 1 ? 'comentário' : 'comentários'}
                {analysis.models && (
                  <>
                    {' '}
                    · {analysis.models.testReviewer} / {analysis.models.architectureReviewer}
                  </>
                )}
              </p>
            </div>
            <div className="hidden shrink-0 font-mono text-xs text-ink-faint sm:block">
              {formatWhen(analysis.createdAt)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
