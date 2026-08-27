import { useParams } from 'react-router-dom';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { Spinner } from '../components/ui/Spinner';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';

export function RepoRunsPage() {
  const { owner = '', repo = '' } = useParams();
  const { analyses, error, loading } = useRepoAnalyses(owner, repo);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p>;
  }

  return (
    <section>
      <p className="mb-6 text-sm text-ink-dim">
        Execuções anteriores deste repositório, com resultado e custo de cada revisão.
      </p>
      <AnalysisHistoryList
        owner={owner}
        repo={repo}
        analyses={analyses ?? []}
        emptyTitle="Nenhuma execução ainda"
        emptyDescription="Abra uma pull request e rode a primeira revisão para ela aparecer aqui."
      />
    </section>
  );
}
