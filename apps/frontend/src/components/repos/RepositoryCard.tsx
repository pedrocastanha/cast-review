import { Link, useNavigate } from 'react-router-dom';
import { useRepositoryIndexStatus } from '../../hooks/useRepositoryIndexStatus';
import type { Repository } from '../../types';
import { Button } from '../ui/Button';
import { RowMain, RowMeta, StatusDot } from '../ui/List';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

function indexLabel(status: ReturnType<typeof useRepositoryIndexStatus>['status']) {
  if (!status) return 'consultando';
  if (status.status === 'indexed') return status.stale ? 'índice desatualizado' : 'indexado';
  if (status.status === 'queued') return 'na fila';
  if (status.status === 'indexing') return status.progress ? `indexando ${status.progress}%` : 'indexando';
  return 'não indexado';
}

export function RepositoryCard({ repo }: { repo: Repository }) {
  const navigate = useNavigate();
  const { status, error, triggering, trigger } = useRepositoryIndexStatus(repo.name, repo.owner);

  const busy = triggering || status?.status === 'queued' || status?.status === 'indexing';
  const indexed = status?.status === 'indexed';

  return (
    <Link
      to={`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls`}
      className="group flex w-full items-center gap-4 border-b border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-2 sm:px-[1.125rem]"
    >
      <StatusDot on={indexed} />

      <RowMain
        title={
          <>
            <span className="truncate transition-colors group-hover:text-accent">{repo.fullName}</span>
            {repo.private && (
              <span className="shrink-0 rounded-sm border border-border-strong px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-ink-faint uppercase">
                privado
              </span>
            )}
          </>
        }
        subtitle={error ? <span className="text-fail">{error}</span> : repo.description || 'Sem descrição'}
      />

      <div className="flex shrink-0 items-center gap-4">
        <RowMeta>
          <span className="hidden sm:inline">
            {repo.defaultBranch} · {dateFormatter.format(new Date(repo.updatedAt))}
            <br />
          </span>
          {indexLabel(status)}
        </RowMeta>

        {indexed && (
          <button
            type="button"
            className="hidden cursor-pointer font-mono text-xs text-ink-faint underline decoration-dotted transition-colors hover:text-accent sm:inline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/graph`);
            }}
          >
            Ver grafo
          </button>
        )}

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
          {indexed && !status.stale ? 'Atualizar' : 'Indexar'}
        </Button>
      </div>
    </Link>
  );
}
