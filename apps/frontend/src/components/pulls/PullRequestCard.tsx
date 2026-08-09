import type { PullRequest } from '../../types';
import { PullRequestStatusBadge } from './PullRequestStatusBadge';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

interface PullRequestCardProps {
  pull: PullRequest;
  onSelect: (pull: PullRequest) => void;
}

export function PullRequestCard({ pull, onSelect }: PullRequestCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pull)}
      className="group flex w-full items-center justify-between gap-6 border-b border-border py-4 text-left transition-colors first:pt-0 last:border-0 hover:bg-surface-1/60"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-faint">#{pull.number}</span>
          <span className="truncate text-sm text-ink group-hover:text-accent">{pull.title}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-ink-faint">
          <PullRequestStatusBadge pull={pull} />
          <span>{pull.user ?? 'desconhecido'}</span>
          <span>·</span>
          <span>
            {pull.headRef} → {pull.baseRef}
          </span>
        </div>
      </div>

      <div className="shrink-0 font-mono text-xs text-ink-faint">
        {dateFormatter.format(new Date(pull.updatedAt))}
      </div>
    </button>
  );
}
