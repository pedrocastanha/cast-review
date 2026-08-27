import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { repositoriesApi } from '../api/repositories.api';
import { hasReviewContent } from '../lib/assemble-report';
import { formatUsageChip } from '../lib/format-usage';
import { AnalysisStatusBadge } from '../components/analysis/AnalysisStatusBadge';
import { ReportView } from '../components/analysis/ReportView';
import { PullRequestStatusBadge } from '../components/pulls/PullRequestStatusBadge';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Tabs, type TabItem } from '../components/ui/Tabs';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import type { PullRequest } from '../types';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

type Tab = 'overview' | 'prd' | 'spec' | 'test' | 'architecture' | 'comments';
const TAB_ITEMS: TabItem<Tab>[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'prd', label: 'PRD' },
  { id: 'spec', label: 'Especificação' },
  { id: 'test', label: 'Testes' },
  { id: 'architecture', label: 'Arquitetura' },
  { id: 'comments', label: 'Achados' },
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
      <Breadcrumb items={[{ label: 'Repositórios', to: '/repos' }, { label: `${owner}/${repo}`, to: pullsPath }, { label: `#${pullNumber}` }]} />

      {pull ? (
        <header className="mb-7 flex flex-col justify-between gap-6 xl:flex-row xl:items-start">
          <div>
            <p className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">Revisão de pull request</p>
            <h1 className="mt-2.5 mb-2.5 max-w-[22ch] font-display text-2xl leading-[1.12] font-bold text-ink">{pull.title}</h1>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[12.5px] text-ink-dim">
              <PullRequestStatusBadge pull={pull} />
              <span>#{pull.number}</span>
              <span>·</span>
              <b className="font-medium text-ink">{pull.headRef}</b> → <b className="font-medium text-ink">{pull.baseRef}</b>
              <span>·</span>
              <span>{pull.user ?? 'desconhecido'}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 pt-2">
            <a href={pull.htmlUrl} target="_blank" rel="noreferrer"><Button variant="secondary">Abrir no GitHub</Button></a>
            <Link to={runPath}><Button>Nova execução</Button></Link>
          </div>
        </header>
      ) : (
        <div className="mb-7">{pullError ? <p className="text-sm text-fail">{pullError}</p> : <Spinner />}</div>
      )}

      <div className="grid gap-8 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="xl:border-r xl:border-border xl:pr-6">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">Execuções</h2><span className="font-mono text-xs text-ink-faint">{analyses?.length ?? 0}</span></div>
          {analysesLoading && <Spinner />}
          {analysesError && <p className="text-sm text-fail">{analysesError}</p>}
          {!analysesLoading && !analysesError && analyses?.length === 0 && <p className="text-sm leading-6 text-ink-dim">Ainda não há análises desta PR.</p>}
          <div className="flex gap-2 overflow-x-auto pb-2 xl:max-h-[calc(100vh-19rem)] xl:flex-col xl:overflow-y-auto">
            {analyses?.map((analysis) => {
              const when = new Date(analysis.createdAt);
              return <button key={analysis.id} type="button" onClick={() => { setSelectedAnalysisId(analysis.id); setTab('overview'); }} className={`min-w-48 cursor-pointer rounded-sm border p-3 text-left transition-colors xl:min-w-0 ${analysis.id === selectedAnalysisId ? 'border-accent bg-accent-soft' : 'border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2'}`}>
                <AnalysisStatusBadge status={analysis.status} />
                <p className="mt-2 font-mono text-xs text-ink">{Number.isNaN(when.getTime()) ? 'Data indisponível' : dateTimeFormatter.format(when)}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-faint">{formatUsageChip(analysis.report?.usage) ?? (hasReviewContent(analysis.report) ? 'sem custo' : 'sem relatório')}</p>
              </button>;
            })}
          </div>
        </aside>

        <section className="min-w-0">
          {selectedAnalysis && selectedReport && hasReviewContent(selectedReport) ? <>
            <Tabs items={TAB_ITEMS} active={tab} onChange={setTab} className="mb-6" />
            <ReportView report={selectedReport} focus={tab === 'overview' ? 'all' : tab} />
          </> : selectedAnalysis ? <div className="rounded-md border border-dashed border-border-strong p-6"><AnalysisStatusBadge status={selectedAnalysis.status} /><h2 className="mt-4 font-display text-lg font-bold text-ink">Esta execução não gerou uma review</h2><p className="mt-2 text-sm leading-6 text-ink-dim">{selectedAnalysis.errorMessage ?? 'A análise ainda não possui conteúdo para exibir.'}</p></div> : <div className="rounded-md border border-dashed border-border-strong p-6"><h2 className="font-display text-lg font-bold text-ink">Escolha uma execução</h2><p className="mt-2 text-sm leading-6 text-ink-dim">O PRD, a especificação e os pareceres aparecerão aqui.</p></div>}
        </section>
      </div>
    </div>
  );
}
