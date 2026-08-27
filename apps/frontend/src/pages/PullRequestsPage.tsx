import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { PullRequestCard } from '../components/pulls/PullRequestCard';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { PageHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { List } from '../components/ui/List';
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
      <Breadcrumb items={[{ label: 'Repositórios', to: '/repos' }, { label: `${owner}/${repo}` }]} />

      <PageHead
        eyebrow="Pull requests"
        title={`${owner}/${repo}`}
        description="Pull requests sincronizadas do GitHub. Abra uma PR para rodar a revisão."
      />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
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
        <List>
          {pulls.map((pull) => (
            <PullRequestCard
              key={pull.id}
              pull={pull}
              owner={owner}
              repo={repo}
              analysisCount={countByPull.get(pull.number) ?? 0}
            />
          ))}
        </List>
      )}

      <section className="mt-12 border-t border-border pt-8">
        <p className="mb-1 font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">Atividade</p>
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Histórico deste repositório</h2>
        <p className="mb-6 text-sm text-ink-dim">Execuções anteriores, resultados e custo de cada revisão.</p>

        {analysesLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {!analysesLoading && analysesError && (
          <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
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
