import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { repositoriesApi } from '../api/repositories.api';
import { hasReviewContent } from '../lib/assemble-report';
import { formatUsageChip } from '../lib/format-usage';
import { AnalysisStatusBadge } from '../components/analysis/AnalysisStatusBadge';
import { ReportView } from '../components/analysis/ReportView';
import { PullRequestStatusBadge } from '../components/pulls/PullRequestStatusBadge';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import type { PullRequest } from '../types';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

type Tab = 'overview' | 'prd' | 'spec' | 'test' | 'architecture' | 'comments';
const tabs: [Tab, string][] = [
  ['overview', 'Visão geral'], ['prd', 'PRD'], ['spec', 'Spec'], ['test', 'Testes'], ['architecture', 'Arquitetura'], ['comments', 'Comentários'],
];

export function PullRequestReviewPage() {
  const { owner = '', repo = '', pullNumber = '' } = useParams();
  const number = Number(pullNumber);
  const [pull, setPull] = useState<PullRequest | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const { analyses, loading: analysesLoading, error: analysesError } = useRepoAnalyses(owner, repo, number);

  useEffect(() => {
    if (!owner || !repo || !Number.isFinite(number)) return;
    let cancelled = false;
    repositoriesApi.getPull(repo, number, owner)
      .then((data) => { if (!cancelled) setPull(data); })
      .catch(() => { if (!cancelled) setPullError('Não foi possível carregar esta pull request.'); });
    return () => { cancelled = true; };
  }, [owner, repo, number]);

  useEffect(() => {
    if (selectedAnalysisId || !analyses?.length) return;
    setSelectedAnalysisId(analyses.find((item) => hasReviewContent(item.report))?.id ?? analyses[0].id);
  }, [analyses, selectedAnalysisId]);

  const selectedAnalysis = analyses?.find((item) => item.id === selectedAnalysisId) ?? null;
  const selectedReport = selectedAnalysis?.report ?? null;
  const pullsPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
  const runPath = `${pullsPath}/${pullNumber}/run`;

  return (
    <div>
      <header className="mb-8 border-b border-border pb-6">
        <Link to={pullsPath} className="text-sm text-ink-faint transition-colors hover:text-ink">← Pull requests</Link>
        {pull ? (
          <div className="mt-5 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div>
              <p className="mb-2 font-mono text-xs tracking-[0.14em] text-accent uppercase">Revisão da pull request</p>
              <div className="flex flex-wrap items-center gap-3"><PullRequestStatusBadge pull={pull} /><span className="font-mono text-xs text-ink-faint">#{pull.number}</span></div>
              <h1 className="mt-3 font-display text-xl font-semibold text-ink sm:text-2xl">{pull.title}</h1>
              <p className="mt-2 font-mono text-xs text-ink-faint">{pull.user ?? 'desconhecido'} · {pull.headRef} → {pull.baseRef}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={pull.htmlUrl} target="_blank" rel="noreferrer"><Button variant="secondary">Abrir no GitHub ↗</Button></a>
              <Link to={runPath}><Button>Rodar análise</Button></Link>
            </div>
          </div>
        ) : <div className="mt-6">{pullError ? <p className="text-sm text-state-closed">{pullError}</p> : <Spinner />}</div>}
      </header>

      <div className="grid gap-8 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="xl:border-r xl:border-border xl:pr-6">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">Execuções</h2><span className="font-mono text-xs text-ink-faint">{analyses?.length ?? 0}</span></div>
          {analysesLoading && <Spinner />}
          {analysesError && <p className="text-sm text-state-closed">{analysesError}</p>}
          {!analysesLoading && !analysesError && analyses?.length === 0 && <p className="text-sm leading-6 text-ink-faint">Ainda não há análises desta PR.</p>}
          <div className="flex gap-2 overflow-x-auto pb-2 xl:max-h-[calc(100vh-19rem)] xl:flex-col xl:overflow-y-auto">
            {analyses?.map((analysis) => {
              const when = new Date(analysis.createdAt);
              return <button key={analysis.id} type="button" onClick={() => { setSelectedAnalysisId(analysis.id); setTab('overview'); }} className={`min-w-48 rounded-sm border p-3 text-left transition-colors xl:min-w-0 ${analysis.id === selectedAnalysisId ? 'border-accent bg-accent-quiet/20' : 'border-border bg-surface-1/55 hover:border-border-strong hover:bg-surface-2'}`}>
                <AnalysisStatusBadge status={analysis.status} />
                <p className="mt-2 font-mono text-xs text-ink">{Number.isNaN(when.getTime()) ? 'Data indisponível' : dateTimeFormatter.format(when)}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-faint">{formatUsageChip(analysis.report?.usage) ?? (hasReviewContent(analysis.report) ? 'sem custo' : 'sem relatório')}</p>
              </button>;
            })}
          </div>
        </aside>

        <section className="min-w-0">
          {selectedAnalysis && selectedReport && hasReviewContent(selectedReport) ? <>
            <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-3" role="tablist" aria-label="Conteúdo da análise">
              {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-9 shrink-0 rounded-sm px-3 text-sm transition-colors ${tab === id ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:bg-surface-1 hover:text-ink'}`}>{label}</button>)}
            </div>
            <ReportView report={selectedReport} focus={tab === 'overview' ? 'all' : tab} />
          </> : selectedAnalysis ? <div className="rounded-lg border border-dashed border-border-strong bg-surface-1/50 p-6"><AnalysisStatusBadge status={selectedAnalysis.status} /><h2 className="mt-4 font-display text-lg font-semibold text-ink">Esta execução não gerou uma review</h2><p className="mt-2 text-sm leading-6 text-ink-faint">{selectedAnalysis.errorMessage ?? 'A análise ainda não possui conteúdo para exibir.'}</p></div> : <div className="rounded-lg border border-dashed border-border-strong bg-surface-1/50 p-6"><h2 className="font-display text-lg font-semibold text-ink">Escolha uma execução</h2><p className="mt-2 text-sm leading-6 text-ink-faint">O PRD, a especificação e os pareceres aparecerão aqui.</p></div>}
        </section>
      </div>
    </div>
  );
}
