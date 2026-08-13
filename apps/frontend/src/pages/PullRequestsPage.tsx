import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { PullRequestCard } from '../components/pulls/PullRequestCard';
import { PullRequestDetailModal } from '../components/pulls/PullRequestDetailModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { usePullRequests } from '../hooks/usePullRequests';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import type { PullRequest } from '../types';

export function PullRequestsPage() {
  const { owner = '', repo = '' } = useParams();
  const { pulls, error, loading } = usePullRequests(repo, owner);
  const { analyses, error: analysesError, loading: analysesLoading } = useRepoAnalyses(owner, repo);
  const [selectedPull, setSelectedPull] = useState<PullRequest | null>(null);

  const countByPull = useMemo(() => {
    const counts = new Map<number, number>();
    for (const analysis of analyses ?? []) {
      counts.set(analysis.pullNumber, (counts.get(analysis.pullNumber) ?? 0) + 1);
    }
    return counts;
  }, [analyses]);

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
            <PullRequestCard
              key={pull.id}
              pull={pull}
              onSelect={setSelectedPull}
              analysisCount={countByPull.get(pull.number) ?? 0}
            />
          ))}
        </div>
      )}

      <section className="mt-12">
        <p className="mb-1 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
          Análises já realizadas
        </p>
        <h2 className="mb-6 font-display text-lg font-semibold text-ink">Histórico deste repositório</h2>

        {analysesLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {!analysesLoading && analysesError && (
          <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm text-ink">
            {analysesError}
          </p>
        )}

        {!analysesLoading && !analysesError && analyses && (
          <AnalysisHistoryList owner={owner} repo={repo} analyses={analyses} />
        )}
      </section>

      {selectedPull && (
        <PullRequestDetailModal
          pull={selectedPull}
          owner={owner}
          repo={repo}
          analyses={(analyses ?? []).filter((analysis) => analysis.pullNumber === selectedPull.number)}
          onClose={() => setSelectedPull(null)}
        />
      )}
    </div>
  );
}
