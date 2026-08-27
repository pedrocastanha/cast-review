import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RepositoryCard } from '../components/repos/RepositoryCard';
import { PageHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { List } from '../components/ui/List';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useRepositories } from '../hooks/useRepositories';
import type { Repository } from '../types';

export function ReposPage() {
  const { user } = useAuth();
  const { repos, error, loading } = useRepositories(Boolean(user?.githubConnected));
  const [query, setQuery] = useState('');

  const visibleRepos = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return repos ?? [];

    const haystack = term.includes('/')
      ? (repo: Repository) => repo.fullName
      : (repo: Repository) => `${repo.name} ${repo.description ?? ''}`;

    return (repos ?? []).filter((repo) => haystack(repo).toLowerCase().includes(term));
  }, [repos, query]);

  return (
    <div>
      <PageHead
        eyebrow="Workspace"
        title="Repositórios"
        description="Escolha uma base de código para ver as pull requests e rodar uma revisão."
        actions={
          <Link to="/settings" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface-1 px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink-faint hover:bg-surface-2">
            {user?.githubConnected ? 'Configurar GitHub' : 'Conectar GitHub'}
          </Link>
        }
      />

      {!user?.githubConnected && (
        <EmptyState
          title="Nenhum GitHub conectado"
          description="Conecte um personal access token com escopo repo pra listar seus repositórios e pull requests."
          action={<Link to="/settings" className="inline-flex min-h-11 items-center justify-center rounded-sm border border-accent bg-accent px-4.5 py-2.5 text-sm font-semibold tracking-wide text-accent-ink transition-colors hover:bg-accent-hover">Conectar GitHub</Link>}
        />
      )}

      {user?.githubConnected && loading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {user?.githubConnected && error && (
        <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {user?.githubConnected && !loading && !error && repos && repos.length === 0 && (
        <EmptyState
          title="Nenhum repositório encontrado"
          description="Seu token não tem acesso a nenhum repositório, ou você ainda não tem nenhum."
        />
      )}

      {user?.githubConnected && !loading && !error && repos && repos.length > 0 && (
        <section aria-labelledby="repositories-list">
          <h2 id="repositories-list" className="sr-only">
            Repositórios disponíveis
          </h2>

          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-faint"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filtrar por nome ou descrição"
                aria-label="Filtrar repositórios"
                className="min-h-11 w-full rounded-sm border border-border bg-surface-1 py-2.5 pr-3.5 pl-8.5 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
              />
            </div>
            <span aria-live="polite" className="font-mono text-xs tabular-nums text-ink-faint">
              {query.trim()
                ? `${visibleRepos.length} de ${repos.length} repositórios`
                : `${repos.length} repositórios`}
            </span>
          </div>

          {visibleRepos.length === 0 ? (
            <EmptyState
              title="Nenhum repositório corresponde ao filtro"
              description={`Nada encontrado para “${query.trim()}”. Tente outro termo.`}
            />
          ) : (
            <List>
              {visibleRepos.map((repo) => (
                <RepositoryCard key={repo.id} repo={repo} />
              ))}
            </List>
          )}
        </section>
      )}
    </div>
  );
}
