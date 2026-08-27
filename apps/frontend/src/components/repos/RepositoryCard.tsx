import { Link, useNavigate } from 'react-router-dom';
import { useRepositoryIndexStatus } from '../../hooks/useRepositoryIndexStatus';
import type { Repository } from '../../types';
import { RowMain, RowMeta, StatusDot } from '../ui/List';
import { RowMenu } from '../ui/RowMenu';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

type IndexStatus = ReturnType<typeof useRepositoryIndexStatus>['status'];

function IndexChip({ status, busy }: { status: IndexStatus; busy: boolean }) {
  const base =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase';

  if (busy || status?.status === 'queued' || status?.status === 'indexing') {
    const label =
      status?.status === 'indexing' && status.progress ? `indexando ${status.progress}%` : 'indexando';
    return (
      <span className={`${base} bg-accent-soft text-accent`}>
        <span aria-hidden="true" className="size-1.5 animate-node-pulse rounded-full bg-current" />
        {label}
      </span>
    );
  }

  if (status?.status === 'indexed') {
    return status.stale ? (
      <span className={`${base} bg-warn-soft text-warn`}>desatualizado</span>
    ) : (
      <span className={`${base} bg-pass-soft text-pass`}>indexado</span>
    );
  }

  return null;
}

export function RepositoryCard({ repo }: { repo: Repository }) {
  const navigate = useNavigate();
  const { status, error, triggering, trigger } = useRepositoryIndexStatus(repo.name, repo.owner);

  const busy = triggering || status?.status === 'queued' || status?.status === 'indexing';
  const indexed = status?.status === 'indexed';
  const graphPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/graph`;

  return (
    <Link
      to={`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls`}
      className="group flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2 sm:pr-2.5 sm:pl-[1.125rem]"
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
        subtitle={error ? <span className="text-fail">{error}</span> : repo.description}
      />

      <RowMeta>
        <span className="hidden sm:inline">
          {repo.defaultBranch} · {dateFormatter.format(new Date(repo.updatedAt))}
        </span>
      </RowMeta>

      <IndexChip status={status} busy={busy} />

      <RowMenu
        label={`Ações de ${repo.fullName}`}
        items={[
          {
            label: busy ? 'Indexando…' : indexed && !status.stale ? 'Atualizar índice' : 'Indexar agora',
            onSelect: trigger,
            disabled: busy,
          },
          {
            label: 'Ver grafo',
            onSelect: () => navigate(graphPath),
            disabled: !indexed,
          },
          { label: 'Abrir no GitHub', href: repo.htmlUrl },
        ]}
      />
    </Link>
  );
}
