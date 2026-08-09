import { Link } from 'react-router-dom';
import type { Repository } from '../../types';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export function RepositoryCard({ repo }: { repo: Repository }) {
  return (
    <Link
      to={`/repos/${repo.owner}/${repo.name}/pulls`}
      className="group flex items-center justify-between gap-6 border-b border-border py-4 transition-colors first:pt-0 last:border-0 hover:bg-surface-1/60"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm text-ink group-hover:text-accent">
            {repo.fullName}
          </span>
          {repo.private && (
            <span className="shrink-0 rounded-sm border border-border-strong px-1.5 py-0.5 text-[0.65rem] tracking-wide text-ink-faint uppercase">
              Privado
            </span>
          )}
        </div>
        {repo.description && (
          <p className="mt-1 truncate text-sm text-ink-faint">{repo.description}</p>
        )}
      </div>

      <div className="shrink-0 text-right font-mono text-xs text-ink-faint">
        <div>{repo.defaultBranch}</div>
        <div>{dateFormatter.format(new Date(repo.updatedAt))}</div>
      </div>
    </Link>
  );
}
