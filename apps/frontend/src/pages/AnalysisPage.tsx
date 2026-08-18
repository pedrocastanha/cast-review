import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApproveStagePayload, ApprovePublishPayload } from '../api/analyses.api';
import { openaiKeyStore } from '../api/openai-key-store';
import { repositoriesApi } from '../api/repositories.api';
import { AgentStepper } from '../components/analysis/AgentStepper';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { AnalysisStatusBadge } from '../components/analysis/AnalysisStatusBadge';
import { ApprovalGate } from '../components/analysis/ApprovalGate';
import { IterationHistory } from '../components/analysis/IterationHistory';
import { ReportView } from '../components/analysis/ReportView';
import { ThoughtLog } from '../components/analysis/ThoughtLog';
import { GithubCommentsStatus } from '../components/analysis/GithubCommentsStatus';
import { UsageStrip } from '../components/analysis/UsageStrip';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';
import { useAnalysisRun } from '../hooks/useAnalysisRun';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import { hasReviewContent } from '../lib/assemble-report';
import type { PullRequest, SpecPayload } from '../types';

const DEFAULT_MODEL = 'gpt-4o';

const POLICY_LABEL_CLASS = 'text-xs font-semibold tracking-wide text-ink-faint uppercase';
const POLICY_SELECT_CLASS =
  'min-h-11 rounded-sm border border-border bg-surface-1 px-3 py-2.5 text-base text-ink transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25';

/** SPEC não tem markdown pronto (só campos estruturados) — monta um texto legível para o ApprovalGate/ExcerptCommentEditor. */
function formatSpecMarkdown(spec: SpecPayload | null | undefined): string {
  if (!spec) return '';
  const contracts = spec.newContracts.map((item) => `- ${item}`).join('\n') || '_nenhum_';
  const rules = spec.businessRules.map((item) => `- ${item}`).join('\n') || '_nenhuma_';
  return [
    '## Resumo',
    spec.summary,
    '## Novos contratos',
    contracts,
    '## Regras de negócio',
    rules,
  ].join('\n\n');
}

export function AnalysisPage() {
  const { owner = '', repo = '', pullNumber = '' } = useParams();
  const number = Number(pullNumber);
  const {
    phase,
    events,
    errorMessage,
    awaitingStage,
    iteration,
    start,
    resume,
    approveStage,
    approvePublish,
    reset,
    report,
    thoughts,
  } = useAnalysisRun();
  const { analyses, loading: analysesLoading, reload: reloadAnalyses } = useRepoAnalyses(
    owner,
    repo,
    Number.isFinite(number) ? number : undefined,
  );

  useEffect(() => {
    if (phase === 'completed' || phase === 'error' || phase === 'awaiting_approval') {
      reloadAnalyses();
    }
  }, [phase, reloadAnalyses]);

  const [pull, setPull] = useState<PullRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openaiKey, setOpenaiKey] = useState(openaiKeyStore.get);
  const [testModel, setTestModel] = useState(DEFAULT_MODEL);
  const [archModel, setArchModel] = useState(DEFAULT_MODEL);
  const [prdPolicy, setPrdPolicy] = useState<'manual' | 'auto'>('manual');
  const [specPolicy, setSpecPolicy] = useState<'manual' | 'auto'>('manual');
  const [publishPolicy, setPublishPolicy] = useState<'manual' | 'auto_safe' | 'auto'>('manual');

  useEffect(() => {
    if (!repo || !owner || !Number.isFinite(number)) return;
    let cancelled = false;
    repositoriesApi
      .getPull(repo, number, owner)
      .then((data) => {
        if (!cancelled) setPull(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar essa pull request.');
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, number]);

  const canStart = openaiKey.trim().length > 0 && phase !== 'running';
  const pullsPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
  const saved = analyses?.find((item) => hasReviewContent(item.report));
  const visibleReport =
    report ?? (phase === 'idle' && hasReviewContent(saved?.report) ? saved?.report : undefined);
  const visibleThoughts = phase === 'idle' && !report ? (saved?.thoughts ?? {}) : thoughts;

  const activeAnalysis = analyses?.find((item) => item.status === 'awaiting_approval');
  const iterationsSource = activeAnalysis ?? saved;
  const resumable = analyses?.filter((item) => item.status === 'running' || item.status === 'error') ?? [];
  const approvalContent =
    awaitingStage === 'prd'
      ? (visibleReport?.prd?.markdown ?? '')
      : awaitingStage === 'spec'
        ? formatSpecMarkdown(visibleReport?.spec)
        : (visibleReport?.markdown ?? '');

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canStart) return;
    openaiKeyStore.set(openaiKey);
    void start(repo, number, owner, {
      models: { testReviewer: testModel, architectureReviewer: archModel },
      apiKeys: { openai: openaiKey.trim() },
      policies: { prd: prdPolicy, spec: specPolicy, publish: publishPolicy },
    });
  };

  const onResume = (analysisId: string) => {
    if (!canStart) return;
    openaiKeyStore.set(openaiKey);
    void resume(analysisId, {
      apiKeys: { openai: openaiKey.trim() },
      models: { testReviewer: testModel, architectureReviewer: archModel },
    });
  };

  return (
    <div>
      <div className="mb-8">
        <Link to={pullsPath} className="text-sm text-ink-faint hover:text-ink">
          ← Pull requests
        </Link>
        <p className="mt-3 mb-1 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
          03 · Análise
        </p>
        <h1 className="font-display text-xl font-semibold text-ink">
          {pull ? `#${pull.number} ${pull.title}` : `PR #${pullNumber}`}
        </h1>
        <p className="mt-1 font-mono text-xs text-ink-faint">
          {owner}/{repo}
          {pull && (
            <>
              {' '}
              · {pull.headRef} → {pull.baseRef}
            </>
          )}
        </p>
      </div>

      {loadError && (
        <p className="mb-6 rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm">
          {loadError}
        </p>
      )}

      <form onSubmit={onSubmit} className="mb-8 flex flex-col gap-4">
        <Field
          label="OpenAI API key"
          type="password"
          autoComplete="off"
          value={openaiKey}
          onChange={(event) => setOpenaiKey(event.target.value)}
          hint="Fica só nesta aba (sessionStorage). O Nest encaminha ao Python em memória de request."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Modelo · Test Reviewer"
            value={testModel}
            onChange={(event) => setTestModel(event.target.value)}
          />
          <Field
            label="Modelo · Architecture"
            value={archModel}
            onChange={(event) => setArchModel(event.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="prd-policy" className={POLICY_LABEL_CLASS}>
              Política · PRD
            </label>
            <select
              id="prd-policy"
              className={POLICY_SELECT_CLASS}
              value={prdPolicy}
              onChange={(event) => setPrdPolicy(event.target.value as 'manual' | 'auto')}
            >
              <option value="manual">Manual</option>
              <option value="auto">Automática</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="spec-policy" className={POLICY_LABEL_CLASS}>
              Política · Especificação
            </label>
            <select
              id="spec-policy"
              className={POLICY_SELECT_CLASS}
              value={specPolicy}
              onChange={(event) => setSpecPolicy(event.target.value as 'manual' | 'auto')}
            >
              <option value="manual">Manual</option>
              <option value="auto">Automática</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="publish-policy" className={POLICY_LABEL_CLASS}>
              Política · Publicação
            </label>
            <select
              id="publish-policy"
              className={POLICY_SELECT_CLASS}
              value={publishPolicy}
              onChange={(event) =>
                setPublishPolicy(event.target.value as 'manual' | 'auto_safe' | 'auto')
              }
            >
              <option value="manual">Manual</option>
              <option value="auto_safe">Automática (segura)</option>
              <option value="auto">Automática</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <Button type="submit" loading={phase === 'running'} disabled={!canStart}>
            {phase === 'running' ? 'Rodando' : 'Rodar análise'}
          </Button>
          {phase !== 'idle' && phase !== 'running' && (
            <Button type="button" variant="secondary" onClick={reset}>
              Nova execução
            </Button>
          )}
        </div>
      </form>

      {phase !== 'idle' && (
        <div className="mb-8">
          <AgentStepper
            events={events}
            running={phase === 'running'}
            failed={phase === 'error'}
            awaitingApproval={phase === 'awaiting_approval'}
          />
        </div>
      )}

      {phase === 'awaiting_approval' && awaitingStage && activeAnalysis && (
        <div className="mb-8">
          <ApprovalGate
            analysisId={activeAnalysis.id}
            stage={awaitingStage}
            content={approvalContent}
            iteration={iteration}
            apiKeys={{ openai: openaiKey }}
            models={{ testReviewer: testModel, architectureReviewer: archModel }}
            onApprove={(payload) =>
              awaitingStage === 'publish'
                ? approvePublish(activeAnalysis.id, payload as ApprovePublishPayload)
                : approveStage(activeAnalysis.id, payload as ApproveStagePayload)
            }
            onReject={(payload) =>
              awaitingStage === 'publish'
                ? approvePublish(activeAnalysis.id, payload as ApprovePublishPayload)
                : approveStage(activeAnalysis.id, payload as ApproveStagePayload)
            }
          />
        </div>
      )}

      {report?.usage && (
        <div className="mb-8">
          <UsageStrip usage={report.usage} />
        </div>
      )}

      {report?.githubComments && (
        <div className="mb-8">
          <GithubCommentsStatus result={report.githubComments} />
        </div>
      )}

      {phase === 'running' && (
        <div className="mb-6 flex items-center gap-3 text-sm text-ink-faint">
          <Spinner />
          A IA está escrevendo…
        </div>
      )}

      {(phase === 'running' || Object.keys(visibleThoughts).length > 0) && (
        <div className="mb-8">
          <h2 className="mb-3 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            Pensamento
          </h2>
          <ThoughtLog thoughts={visibleThoughts} running={phase === 'running'} />
        </div>
      )}

      {errorMessage && (
        <p className="mb-6 rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm">
          {errorMessage}
        </p>
      )}

      {visibleReport && <ReportView report={visibleReport} />}

      {iterationsSource &&
        (iterationsSource.prdIterations.length > 0 || iterationsSource.specIterations.length > 0) && (
          <div className="mb-8 flex flex-col gap-6">
            {iterationsSource.prdIterations.length > 0 && (
              <div>
                <h2 className="mb-3 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
                  Histórico · PRD
                </h2>
                <IterationHistory iterations={iterationsSource.prdIterations} />
              </div>
            )}
            {iterationsSource.specIterations.length > 0 && (
              <div>
                <h2 className="mb-3 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
                  Histórico · Especificação
                </h2>
                <IterationHistory iterations={iterationsSource.specIterations} />
              </div>
            )}
          </div>
        )}

      {!analysesLoading && analyses && phase === 'idle' && (
        <section className="mt-4">
          {resumable.length > 0 && (
            <div className="mb-6 flex flex-col gap-2">
              <h2 className="mb-1 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
                Análises pendentes
              </h2>
              {resumable.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-1/55 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <AnalysisStatusBadge status={item.status} />
                    <span className="font-mono text-xs text-ink-faint">#{item.pullNumber}</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canStart}
                    onClick={() => onResume(item.id)}
                  >
                    Retomar
                  </Button>
                </div>
              ))}
            </div>
          )}
          <h2 className="mb-4 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            Análises anteriores desta PR
          </h2>
          <AnalysisHistoryList
            owner={owner}
            repo={repo}
            analyses={analyses}
            emptyTitle="Nenhuma análise anterior"
            emptyDescription="Rode a primeira análise para o review ficar salvo nesta PR."
          />
        </section>
      )}
    </div>
  );
}
