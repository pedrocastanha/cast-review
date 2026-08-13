import { Link } from 'react-router-dom';
import type { PullRequest } from '../../types';
import { PullRequestStatusBadge } from './PullRequestStatusBadge';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

interface PullRequestCardProps {
  pull: PullRequest;
  owner: string;
  repo: string;
  analysisCount?: number;
}

export function PullRequestCard({ pull, owner, repo, analysisCount = 0 }: PullRequestCardProps) {
  return (
    <Link
      to={`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull.number}`}
      className="group flex w-full items-center justify-between gap-4 rounded-md border border-border bg-surface-1/55 px-4 py-4 text-left transition-[background-color,border-color] duration-200 hover:border-border-strong hover:bg-surface-2 sm:gap-6 sm:px-5"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-faint">#{pull.number}</span>
          <span className="truncate text-sm text-ink transition-colors group-hover:text-accent">{pull.title}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-ink-faint">
          <PullRequestStatusBadge pull={pull} />
          <span>{pull.user ?? 'desconhecido'}</span>
          <span>·</span>
          <span>
            {pull.headRef} → {pull.baseRef}
          </span>
          {analysisCount > 0 && (
            <>
              <span>·</span>
              <span>
                {analysisCount} {analysisCount === 1 ? 'análise' : 'análises'}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="hidden shrink-0 font-mono text-xs text-ink-faint sm:block">
        {dateFormatter.format(new Date(pull.updatedAt))}
      </div>
    </Link>
  );
}
