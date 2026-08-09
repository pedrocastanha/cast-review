import { useState } from 'react';
import { GithubTokenModal } from '../components/github/GithubTokenModal';
import { RepositoryCard } from '../components/repos/RepositoryCard';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useRepositories } from '../hooks/useRepositories';

export function ReposPage() {
  const { user } = useAuth();
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const { repos, error, loading } = useRepositories(Boolean(user?.githubConnected));

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            01 · Repositórios
          </p>
          <h1 className="font-display text-xl font-semibold text-ink">Seus repositórios</h1>
        </div>
        <Button variant="secondary" onClick={() => setTokenModalOpen(true)}>
          {user?.githubConnected ? 'Trocar token' : 'Conectar GitHub'}
        </Button>
      </div>

      {!user?.githubConnected && (
        <EmptyState
          title="Nenhum GitHub conectado"
          description="Conecte um personal access token com escopo repo pra listar seus repositórios e pull requests."
          action={<Button onClick={() => setTokenModalOpen(true)}>Conectar GitHub</Button>}
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
        <div className="flex flex-col">
          {repos.map((repo) => (
            <RepositoryCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}

      {tokenModalOpen && <GithubTokenModal onClose={() => setTokenModalOpen(false)} />}
    </div>
  );
}
