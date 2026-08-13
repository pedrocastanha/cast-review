import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { openaiKeyStore } from '../api/openai-key-store';
import { repositoriesApi } from '../api/repositories.api';
import { AgentStepper } from '../components/analysis/AgentStepper';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { ReportView } from '../components/analysis/ReportView';
import { ThoughtLog } from '../components/analysis/ThoughtLog';
import { UsageStrip } from '../components/analysis/UsageStrip';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';
import { useAnalysisRun } from '../hooks/useAnalysisRun';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import { hasReviewContent } from '../lib/assemble-report';
import type { PullRequest } from '../types';

const DEFAULT_MODEL = 'gpt-4o';

export function AnalysisPage() {
  const { owner = '', repo = '', pullNumber = '' } = useParams();
  const number = Number(pullNumber);
  const { phase, events, errorMessage, start, reset, report, thoughts } = useAnalysisRun();
  const { analyses, loading: analysesLoading, reload: reloadAnalyses } = useRepoAnalyses(
    owner,
    repo,
    Number.isFinite(number) ? number : undefined,
  );

  useEffect(() => {
    if (phase === 'completed' || phase === 'error') reloadAnalyses();
  }, [phase, reloadAnalyses]);

  const [pull, setPull] = useState<PullRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openaiKey, setOpenaiKey] = useState(openaiKeyStore.get);
  const [testModel, setTestModel] = useState(DEFAULT_MODEL);
  const [archModel, setArchModel] = useState(DEFAULT_MODEL);

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

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canStart) return;
    openaiKeyStore.set(openaiKey);
    void start(repo, number, owner, {
      models: { testReviewer: testModel, architectureReviewer: archModel },
      apiKeys: { openai: openaiKey.trim() },
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
          <AgentStepper events={events} running={phase === 'running'} failed={phase === 'error'} />
        </div>
      )}

      {report?.usage && (
        <div className="mb-8">
          <UsageStrip usage={report.usage} />
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

      {!analysesLoading && analyses && phase === 'idle' && (
        <section className="mt-4">
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
