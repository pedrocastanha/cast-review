import { Link } from 'react-router-dom';
import { RepositoryCard } from '../components/repos/RepositoryCard';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useRepositories } from '../hooks/useRepositories';

export function ReposPage() {
  const { user } = useAuth();
  const { repos, error, loading } = useRepositories(Boolean(user?.githubConnected));

  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 font-mono text-xs tracking-[0.14em] text-accent uppercase">
            Workspace · 01
          </p>
          <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">Seus repositórios</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-faint">
            Escolha uma base de código para consultar pull requests e iniciar revisões assistidas.
          </p>
        </div>
        <Link to="/settings" className="inline-flex min-h-11 items-center justify-center rounded-sm border border-border-strong px-4.5 py-2.5 text-sm font-semibold tracking-wide text-ink transition-colors hover:border-ink-faint hover:bg-surface-2">
          {user?.githubConnected ? 'Configurar GitHub' : 'Conectar GitHub'}
        </Link>
      </div>

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
        <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm text-ink">
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
          <div className="mb-3 flex items-center justify-between">
            <h2 id="repositories-list" className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
              Repositórios disponíveis
            </h2>
            <span className="font-mono text-xs tabular-nums text-ink-faint">{repos.length} total</span>
          </div>
          <div className="flex flex-col gap-2">
          {repos.map((repo) => (
            <RepositoryCard key={repo.id} repo={repo} />
          ))}
          </div>
        </section>
      )}
    </div>
  );
}
