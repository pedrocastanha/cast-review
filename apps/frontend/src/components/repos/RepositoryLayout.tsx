import type { ReactNode } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useRepositoryIndexStatus } from '../../hooks/useRepositoryIndexStatus';
import { Breadcrumb } from '../ui/Breadcrumb';

function IndexState({ owner, repo }: { owner: string; repo: string }) {
  const { status, triggering, trigger } = useRepositoryIndexStatus(repo, owner);
  const busy = triggering || status?.status === 'queued' || status?.status === 'indexing';
  const base =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase';

  if (busy) {
    const label =
      status?.status === 'indexing' && status.progress ? `indexando ${status.progress}%` : 'indexando';
    return (
      <span className={`${base} bg-accent-soft text-accent`}>
        <span aria-hidden="true" className="size-1.5 animate-node-pulse rounded-full bg-current" />
        {label}
      </span>
    );
  }

  if (status?.status === 'indexed' && !status.stale) {
    return <span className={`${base} bg-pass-soft text-pass`}>indexado</span>;
  }

  return (
    <button
      type="button"
      onClick={trigger}
      className={`${base} cursor-pointer border transition-colors ${
        status?.status === 'indexed'
          ? 'border-warn/45 bg-warn-soft text-warn hover:border-warn'
          : 'border-border bg-surface-2 text-ink-dim hover:border-ink-faint hover:text-ink'
      }`}
    >
      {status?.status === 'indexed' ? 'reindexar' : 'indexar'}
    </button>
  );
}

export function RepositoryLayout({ children }: { children: ReactNode }) {
  const { owner = '', repo = '' } = useParams();
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const tabs = [
    { to: `${path}/pulls`, label: 'Pull requests' },
    { to: `${path}/graph`, label: 'Grafo' },
    { to: `${path}/runs`, label: 'Execuções' },
    { to: `${path}/chat`, label: 'Chat' },
  ];

  return (
    <div>
      <Breadcrumb items={[{ label: 'Repositórios', to: '/repos' }, { label: `${owner}/${repo}` }]} />

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl leading-[1.1] font-bold text-ink">
            {owner}/{repo}
          </h1>
          <IndexState owner={owner} repo={repo} />
        </div>
        <a
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface-1 px-4 text-sm font-semibold text-ink transition-colors hover:border-ink-faint hover:bg-surface-2"
        >
          Abrir no GitHub
        </a>
      </header>

      <nav
        aria-label="Seções do repositório"
        className="mb-6 flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border-strong"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            className={({ isActive }) =>
              `-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm leading-[2.75rem] font-semibold whitespace-nowrap transition-colors ${
                isActive ? 'border-accent text-ink' : 'border-transparent text-ink-dim hover:text-ink'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}
