import { Link } from 'react-router-dom';
import type { PullRequest } from '../../types';
import { RowMain, RowMeta } from '../ui/List';
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
      className="group flex w-full items-center gap-4 border-b border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-2 sm:px-[1.125rem]"
    >
      <RowMain
        title={
          <>
            <PullRequestStatusBadge pull={pull} />
            <span className="text-ink-faint">#{pull.number}</span>
            <span className="truncate font-sans font-normal transition-colors group-hover:text-accent">{pull.title}</span>
          </>
        }
        subtitle={
          <>
            {pull.headRef} → {pull.baseRef} · {pull.user ?? 'desconhecido'}
            {analysisCount > 0 && ` · ${analysisCount} ${analysisCount === 1 ? 'revisão' : 'revisões'}`}
          </>
        }
      />
      <RowMeta>{dateFormatter.format(new Date(pull.updatedAt))}</RowMeta>
    </Link>
  );
}
