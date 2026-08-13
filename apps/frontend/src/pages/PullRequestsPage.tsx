import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PullRequestCard } from '../components/pulls/PullRequestCard';
import { PullRequestDetailModal } from '../components/pulls/PullRequestDetailModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { usePullRequests } from '../hooks/usePullRequests';
import type { PullRequest } from '../types';

export function PullRequestsPage() {
  const { owner = '', repo = '' } = useParams();
  const { pulls, error, loading } = usePullRequests(repo, owner);
  const [selectedPull, setSelectedPull] = useState<PullRequest | null>(null);

  return (
    <div>
      <div className="mb-8">
        <Link to="/repos" className="text-sm text-ink-faint hover:text-ink">
          ← Repositórios
        </Link>
        <p className="mt-3 mb-1 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
          02 · Pull requests
        </p>
        <h1 className="font-display text-xl font-semibold text-ink">
          {owner}/{repo}
        </h1>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm text-ink">
          {error}
        </p>
      )}

      {!loading && !error && pulls && pulls.length === 0 && (
        <EmptyState
          title="Nenhuma pull request"
          description="Esse repositório ainda não tem pull requests abertas ou fechadas."
        />
      )}

      {!loading && !error && pulls && pulls.length > 0 && (
        <div className="flex flex-col">
          {pulls.map((pull) => (
            <PullRequestCard key={pull.id} pull={pull} onSelect={setSelectedPull} />
          ))}
        </div>
      )}

      {selectedPull && (
        <PullRequestDetailModal
          pull={selectedPull}
          owner={owner}
          repo={repo}
          onClose={() => setSelectedPull(null)}
        />
      )}
    </div>
  );
}
