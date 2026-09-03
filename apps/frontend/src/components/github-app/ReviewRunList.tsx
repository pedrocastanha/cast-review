import { Link } from 'react-router-dom';
import type { GithubReviewRunStatus, GithubReviewRunSummary } from '../../types';
import { Pill } from '../ui/Pill';
import { Spinner } from '../ui/Spinner';

const STATUS_TONE: Record<GithubReviewRunStatus, 'pass' | 'warn' | 'fail' | 'neutral' | 'accent'> = {
  queued: 'neutral',
  running: 'accent',
  completed: 'pass',
  failed: 'fail',
  skipped: 'warn',
  superseded: 'neutral',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<GithubReviewRunStatus, string> = {
  queued: 'na fila',
  running: 'rodando',
  completed: 'concluída',
  failed: 'falhou',
  skipped: 'pulada',
  superseded: 'superada',
  cancelled: 'cancelada',
};

export function ReviewRunList({
  runs,
  owner,
  repo,
  onRetry,
}: {
  runs: GithubReviewRunSummary[] | null;
  owner: string;
  repo: string;
  onRetry: (runId: string) => Promise<void>;
}) {
  if (runs === null) {
    return (
      <div className="mt-6 flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="mt-6 text-sm text-ink-dim">
        Nenhuma execução ainda. Abra uma pull request ou enfileire uma acima.
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-sm border border-border">
      {runs.map((run) => (
        <div
          key={run.id}
          className="flex flex-wrap items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
        >
          <Pill tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</Pill>
          <span className="font-mono text-sm text-ink">#{run.pullNumber}</span>
          <span className="font-mono text-[11.5px] text-ink-faint">
            {run.headSha.slice(0, 7)} · {run.trigger}
            {run.eventAction ? `/${run.eventAction}` : ''}
          </span>
          {run.skipReason && (
            <span className="font-mono text-[11.5px] text-warn">{run.skipReason}</span>
          )}
          {run.errorMessage && (
            <span className="truncate font-mono text-[11.5px] text-fail">{run.errorMessage}</span>
          )}
          {run.consumedUsd !== null && (
            <span className="font-mono text-[11.5px] text-ink-faint">
              US$ {run.consumedUsd.toFixed(4)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3">
            {run.analysisId && (
              <Link
                to={`/repos/${owner}/${repo}/analyses/${run.analysisId}`}
                className="font-mono text-[11.5px] text-ink hover:text-accent"
              >
                relatório
              </Link>
            )}
            {run.checkRun?.htmlUrl && (
              <a
                href={run.checkRun.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11.5px] text-ink hover:text-accent"
              >
                check ↗
              </a>
            )}
            {(run.status === 'failed' || run.status === 'skipped') && (
              <button
                type="button"
                onClick={() => void onRetry(run.id)}
                className="cursor-pointer font-mono text-[11.5px] text-ink-dim hover:text-accent"
              >
                reprocessar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
