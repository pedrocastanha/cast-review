import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { PullRequestCard } from '../components/pulls/PullRequestCard';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { usePullRequests } from '../hooks/usePullRequests';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';

export function PullRequestsPage() {
  const { owner = '', repo = '' } = useParams();
  const { pulls, error, loading } = usePullRequests(repo, owner);
  const { analyses, error: analysesError, loading: analysesLoading } = useRepoAnalyses(owner, repo);

  const countByPull = useMemo(() => {
    const counts = new Map<number, number>();
    for (const analysis of analyses ?? []) {
      counts.set(analysis.pullNumber, (counts.get(analysis.pullNumber) ?? 0) + 1);
    }
    return counts;
  }, [analyses]);

  return (
    <div>
      <div className="mb-8 border-b border-border pb-6">
        <Link to="/repos" className="text-sm text-ink-faint transition-colors hover:text-ink">
          ← Repositórios
        </Link>
        <p className="mt-5 mb-1 font-mono text-xs tracking-[0.14em] text-accent uppercase">
          Workspace · 02
        </p>
        <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">
          {owner}/{repo}
        </h1>
        <p className="mt-2 text-sm text-ink-faint">Pull requests sincronizadas do GitHub para este repositório.</p>
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
        <div className="flex flex-col gap-2">
          {pulls.map((pull) => (
            <PullRequestCard
              key={pull.id}
              pull={pull}
              owner={owner}
              repo={repo}
              analysisCount={countByPull.get(pull.number) ?? 0}
            />
          ))}
        </div>
      )}

      <section className="mt-12 border-t border-border pt-8">
        <p className="mb-1 font-mono text-xs tracking-[0.14em] text-accent uppercase">Atividade</p>
        <h2 className="mb-2 font-display text-lg font-semibold text-ink">Histórico deste repositório</h2>
        <p className="mb-6 text-sm text-ink-faint">Execuções anteriores, resultados e custo de cada revisão.</p>

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
    </div>
  );
}
