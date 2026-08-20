import { Link } from 'react-router-dom';
import { useRepositoryIndexStatus } from '../../hooks/useRepositoryIndexStatus';
import type { Repository } from '../../types';
import { Button } from '../ui/Button';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

function IndexBadge({
  status,
}: {
  status: ReturnType<typeof useRepositoryIndexStatus>['status'];
}) {
  if (!status) return null;

  if (status.status === 'indexed') {
    return (
      <span className="shrink-0 rounded-sm border border-border-strong px-1.5 py-0.5 text-[0.65rem] tracking-wide text-ink-faint uppercase">
        {status.stale ? 'Índice desatualizado' : 'Indexado'}
      </span>
    );
  }

  if (status.status === 'queued' || status.status === 'indexing') {
    return (
      <span className="shrink-0 rounded-sm border border-accent/40 px-1.5 py-0.5 text-[0.65rem] tracking-wide text-accent uppercase">
        {status.status === 'queued' ? 'Na fila' : `Indexando${status.progress ? ` ${status.progress}%` : ''}`}
      </span>
    );
  }

  return null;
}

export function RepositoryCard({ repo }: { repo: Repository }) {
  const { status, error, triggering, trigger } = useRepositoryIndexStatus(
    repo.name,
    repo.owner,
  );

  const busy = triggering || status?.status === 'queued' || status?.status === 'indexing';
  const buttonLabel =
    status?.status === 'indexed' && !status.stale
      ? 'Atualizar'
      : 'Indexar';

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
          <IndexBadge status={status} />
        </div>
        {repo.description && (
          <p className="mt-1 truncate text-sm text-ink-faint">{repo.description}</p>
        )}
        {error && <p className="mt-1 text-xs text-state-closed">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="hidden text-right font-mono text-xs text-ink-faint sm:block">
          <div className="text-ink-dim">{repo.defaultBranch}</div>
          <div className="mt-1">{dateFormatter.format(new Date(repo.updatedAt))}</div>
        </div>
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          disabled={busy}
          className="min-h-9 px-3 py-1.5 text-xs"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            trigger();
          }}
        >
          {buttonLabel}
        </Button>
      </div>
    </Link>
  );
}
