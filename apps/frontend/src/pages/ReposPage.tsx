import { Link } from 'react-router-dom';
import { RepositoryCard } from '../components/repos/RepositoryCard';
import { PageHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { List } from '../components/ui/List';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useRepositories } from '../hooks/useRepositories';

export function ReposPage() {
  const { user } = useAuth();
  const { repos, error, loading } = useRepositories(Boolean(user?.githubConnected));

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
          <div className="mb-3.5 flex items-center justify-between">
            <h2 id="repositories-list" className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
              Repositórios disponíveis
            </h2>
            <span className="font-mono text-xs tabular-nums text-ink-faint">{repos.length} repositórios</span>
          </div>
          <List>
            {repos.map((repo) => (
              <RepositoryCard key={repo.id} repo={repo} />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}
