import { Link } from 'react-router-dom';
import type { Repository } from '../../types';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export function RepositoryCard({ repo }: { repo: Repository }) {
  return (
    <Link
      to={`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls`}
      className="group flex items-center justify-between gap-4 rounded-md border border-border bg-surface-1/55 px-4 py-4 transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-surface-2 sm:gap-6 sm:px-5"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm text-ink transition-colors group-hover:text-accent">
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

      <div className="hidden shrink-0 text-right font-mono text-xs text-ink-faint sm:block">
        <div className="text-ink-dim">{repo.defaultBranch}</div>
        <div className="mt-1">{dateFormatter.format(new Date(repo.updatedAt))}</div>
      </div>
    </Link>
  );
}
