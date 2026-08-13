import { useState } from 'react';
import { Link } from 'react-router-dom';
import { hasReviewContent } from '../../lib/assemble-report';
import { formatUsageChip } from '../../lib/format-usage';
import type { AnalysisRecord, PullRequest } from '../../types';
import { AnalysisStatusBadge } from '../analysis/AnalysisStatusBadge';
import { ReportView } from '../analysis/ReportView';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { PullRequestStatusBadge } from './PullRequestStatusBadge';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

interface PullRequestDetailModalProps {
  pull: PullRequest;
  owner: string;
  repo: string;
  analyses: AnalysisRecord[];
  onClose: () => void;
}

export function PullRequestDetailModal({
  pull,
  owner,
  repo,
  analyses,
  onClose,
}: PullRequestDetailModalProps) {
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(
    () => analyses.find((analysis) => hasReviewContent(analysis.report))?.id ?? analyses[0]?.id ?? null,
  );
  const [tab, setTab] = useState<'overview' | 'prd' | 'spec' | 'test' | 'architecture' | 'comments'>('overview');
  const selectedAnalysis = analyses.find((analysis) => analysis.id === selectedAnalysisId) ?? null;
  const selectedReport = selectedAnalysis?.report ?? null;
  const tabs = [
    ['overview', 'Visão geral'],
    ['prd', 'PRD'],
    ['spec', 'Spec'],
    ['test', 'Testes'],
    ['architecture', 'Arquitetura'],
    ['comments', 'Comentários'],
  ] as const;

  return (
    <Modal title={`#${pull.number}`} onClose={onClose} wide>
      <div className="flex flex-col gap-6">
        <div className="border-b border-border pb-5">
          <PullRequestStatusBadge pull={pull} />
          <h3 className="mt-3 font-display text-lg font-semibold text-ink">{pull.title}</h3>
          <a href={pull.htmlUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm text-ink-faint transition-colors hover:text-accent">
            Abrir pull request no GitHub ↗
          </a>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-xs">
          <div>
            <dt className="text-ink-faint">Autor</dt>
            <dd className="mt-0.5 text-ink">{pull.user ?? 'desconhecido'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Branches</dt>
            <dd className="mt-0.5 text-ink">
              {pull.headRef} → {pull.baseRef}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Criada em</dt>
            <dd className="mt-0.5 text-ink">{dateTimeFormatter.format(new Date(pull.createdAt))}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Atualizada em</dt>
            <dd className="mt-0.5 text-ink">{dateTimeFormatter.format(new Date(pull.updatedAt))}</dd>
          </div>
        </dl>

        <div className="grid min-h-100 gap-6 xl:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="xl:border-r xl:border-border xl:pr-5">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">Execuções</h4>
              <span className="font-mono text-xs text-ink-faint">{analyses.length}</span>
            </div>
            {analyses.length === 0 ? (
              <p className="text-sm leading-6 text-ink-faint">Ainda não há análises para esta PR.</p>
            ) : (
              <div className="flex max-h-64 gap-2 overflow-x-auto pb-1 xl:max-h-none xl:flex-col xl:overflow-y-auto">
                {analyses.map((analysis) => {
                  const cost = formatUsageChip(analysis.report?.usage);
                  const when = new Date(analysis.createdAt);
                  return (
                    <button
                      key={analysis.id}
                      type="button"
                      onClick={() => {
                        setSelectedAnalysisId(analysis.id);
                        setTab('overview');
                      }}
                      className={`min-w-44 rounded-sm border p-3 text-left transition-colors xl:min-w-0 ${selectedAnalysisId === analysis.id ? 'border-accent bg-accent-quiet/20' : 'border-border bg-surface-1/50 hover:border-border-strong hover:bg-surface-2'}`}
                    >
                      <AnalysisStatusBadge status={analysis.status} />
                      <p className="mt-2 font-mono text-xs text-ink">{Number.isNaN(when.getTime()) ? 'Data indisponível' : dateTimeFormatter.format(when)}</p>
                      <p className="mt-1 font-mono text-[10px] text-ink-faint">{cost ?? (hasReviewContent(analysis.report) ? 'sem custo' : 'sem relatório')}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="min-w-0">
            {selectedAnalysis && selectedReport && hasReviewContent(selectedReport) ? (
              <>
                <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border pb-3" role="tablist" aria-label="Conteúdo da análise">
                {tabs.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`min-h-9 shrink-0 rounded-sm px-3 text-sm transition-colors ${tab === id ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:bg-surface-1 hover:text-ink'}`}
                  >
                    {label}
                  </button>
                ))}
                </div>
                <ReportView report={selectedReport} focus={tab === 'overview' ? 'all' : tab} />
              </>
            ) : selectedAnalysis ? (
              <div className="rounded-lg border border-dashed border-border-strong bg-surface-1/50 p-6">
                <AnalysisStatusBadge status={selectedAnalysis.status} />
                <h4 className="mt-4 font-display text-lg font-semibold text-ink">Esta execução não gerou uma review</h4>
                <p className="mt-2 text-sm leading-6 text-ink-faint">{selectedAnalysis.errorMessage ?? 'A análise ainda não possui conteúdo para exibir.'}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border-strong bg-surface-1/50 p-6">
                <h4 className="font-display text-lg font-semibold text-ink">Nenhuma análise ainda</h4>
                <p className="mt-2 text-sm leading-6 text-ink-faint">Rode uma análise para visualizar o PRD, a especificação e os pareceres aqui.</p>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row">
          <Link
            to={`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull.number}/run`}
          >
            <Button>Rodar análise</Button>
          </Link>
          <a href={pull.htmlUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary">
              Abrir no GitHub ↗
            </Button>
          </a>
        </div>
      </div>
    </Modal>
  );
}
