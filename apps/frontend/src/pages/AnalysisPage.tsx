import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApproveStagePayload, ApprovePublishPayload } from '../api/analyses.api';
import { openaiKeyStore } from '../api/openai-key-store';
import { repositoriesApi } from '../api/repositories.api';
import { projectsApi } from '../api/projects.api';
import { AgentStepper } from '../components/analysis/AgentStepper';
import { Console, ConsoleMeter, ConsoleStream } from '../components/analysis/Console';
import { AnalysisHistoryList } from '../components/analysis/AnalysisHistoryList';
import { AnalysisStatusBadge } from '../components/analysis/AnalysisStatusBadge';
import { ApprovalGate } from '../components/analysis/ApprovalGate';
import { IterationHistory } from '../components/analysis/IterationHistory';
import { ReportView } from '../components/analysis/ReportView';
import { ThoughtLog } from '../components/analysis/ThoughtLog';
import { GithubCommentsStatus } from '../components/analysis/GithubCommentsStatus';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { Button } from '../components/ui/Button';
import { Card, PageHead } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { useAnalysisRun } from '../hooks/useAnalysisRun';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import { hasReviewContent } from '../lib/assemble-report';
import type { EligibleProject, PullRequest, SpecPayload } from '../types';

const DEFAULT_MODEL = 'gpt-4o';

const POLICY_LABEL_CLASS =
  'font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-faint uppercase';
const POLICY_SELECT_CLASS =
  'min-h-11 rounded-sm border border-border bg-surface-1 px-3 py-2.5 font-mono text-sm text-ink transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft';

function ProjectImpactReadiness({
  project,
  sourceRepository,
}: {
  project: EligibleProject;
  sourceRepository: string;
}) {
  const normalizedSource = sourceRepository.toLowerCase();
  const externalRepositories = project.repositories.filter(
    (repository) => repository.repository.toLowerCase() !== normalizedSource,
  );
  const readyExternalRepositories = externalRepositories.filter(
    (repository) => repository.status === 'indexed' && !repository.stale,
  ).length;
  const staleExternalRepositories = externalRepositories.filter(
    (repository) => repository.stale,
  ).length;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="text-ink">{project.name}</span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink-faint">
          {readyExternalRepositories}/{externalRepositories.length} repositórios externos prontos
        </span>
        {staleExternalRepositories > 0 && (
          <span className="rounded-sm border border-accent/40 px-2 py-0.5 text-accent">
            {staleExternalRepositories} stale
          </span>
        )}
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {project.repositories.map((repository) => {
          const isSource = repository.repository.toLowerCase() === normalizedSource;
          return (
            <li
              key={repository.repository}
              className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2 font-mono text-[10px]"
            >
              <span className="truncate text-ink-dim">{repository.repository}</span>
              <span
                className={
                  isSource || (repository.status === 'indexed' && !repository.stale)
                    ? 'text-state-open'
                    : 'text-accent'
                }
              >
                {isSource ? 'fonte da PR' : repository.stale ? 'stale' : repository.status}
              </span>
            </li>
          );
        })}
      </ul>
      {readyExternalRepositories < externalRepositories.length && (
        <p className="mt-3 text-xs text-ink-faint">
          A cobertura será parcial. O Cast não indexa automaticamente ao iniciar.{' '}
          <Link to={`/projects/${project.id}`} className="text-accent hover:underline">
            Preparar índices
          </Link>
        </p>
      )}
    </div>
  );
}

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
  const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  const [eligibilityError, setEligibilityError] = useState(false);
  const [projectImpactEnabled, setProjectImpactEnabled] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');

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

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    setEligibilityLoading(true);
    setEligibilityError(false);
    projectsApi
      .eligible(`${owner}/${repo}`)
      .then((projects) => {
        if (!cancelled) setEligibleProjects(projects);
      })
      .catch(() => {
        if (!cancelled) setEligibilityError(true);
      })
      .finally(() => {
        if (!cancelled) setEligibilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  const canStart =
    openaiKey.trim().length > 0 &&
    phase !== 'running' &&
    (!projectImpactEnabled || Boolean(selectedProjectId));
  const pullsPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
  const saved = analyses?.find((item) => hasReviewContent(item.report));
  const visibleReport =
    report ?? (phase === 'idle' && hasReviewContent(saved?.report) ? saved?.report : undefined);
  const visibleThoughts = phase === 'idle' && !report ? (saved?.thoughts ?? {}) : thoughts;
  const liveThought = Object.values(visibleThoughts).filter(Boolean).at(-1) ?? '';

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
      impactScope: projectImpactEnabled
        ? { mode: 'project', projectId: selectedProjectId }
        : { mode: 'repository' },
    });
  };

  const toggleProjectImpact = () => {
    const next = !projectImpactEnabled;
    setProjectImpactEnabled(next);
    if (next && eligibleProjects.length === 1) {
      setSelectedProjectId(eligibleProjects[0].id);
    }
  };

  const newExecution = () => {
    setProjectImpactEnabled(false);
    setSelectedProjectId('');
    reset();
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
      <Breadcrumb
        items={[
          { label: 'Repositórios', to: '/repos' },
          { label: `${owner}/${repo}`, to: pullsPath },
          { label: `#${pullNumber}` },
        ]}
      />

      <PageHead
        eyebrow="Execução da revisão"
        title={pull ? pull.title : `PR #${pullNumber}`}
        description={
          pull ? `#${pull.number} · ${pull.headRef} → ${pull.baseRef} · ${owner}/${repo}` : `${owner}/${repo}`
        }
      />

      {loadError && (
        <p className="mb-6 rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
          {loadError}
        </p>
      )}

      <Card className="mb-6 p-6">
      <h2 className="font-display text-[17px] font-bold text-ink">Configurar execução</h2>
      <p className="mt-1 mb-4.5 text-sm text-ink-dim">
        A chave fica só nesta aba e é usada em memória durante o processamento. Nada é gravado.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
        <section className="rounded-sm border border-border bg-surface-2 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">
                Escopo da análise
              </p>
              <h2 className="mt-1 font-display text-base font-bold text-ink">
                {projectImpactEnabled ? 'Projeto conectado' : 'Apenas esta PR'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                {projectImpactEnabled
                  ? 'Compara contratos e procura consumidores ou provedores nos índices congelados do projeto.'
                  : 'Fluxo local, sem consultar o Project Graph e sem adicionar contexto cross-repo.'}
              </p>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border px-3 py-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={projectImpactEnabled}
                onChange={toggleProjectImpact}
                disabled={eligibilityLoading || eligibleProjects.length === 0}
                className="size-4 accent-[var(--color-accent)]"
              />
              Verificar outros repositórios
            </label>
          </div>

          {eligibilityLoading && (
            <p className="mt-4 font-mono text-xs text-ink-faint">Verificando projetos elegíveis…</p>
          )}
          {!eligibilityLoading && eligibilityError && (
            <p className="mt-4 text-xs text-fail">
              Não foi possível verificar os projetos. A análise local continua disponível.
            </p>
          )}
          {!eligibilityLoading && !eligibilityError && eligibleProjects.length === 0 && (
            <p className="mt-4 text-xs text-ink-faint">
              Este repositório ainda não pertence a um projeto com pelo menos dois membros.{' '}
              <Link to="/projects" className="text-accent hover:underline">
                Configurar projeto
              </Link>
            </p>
          )}

          {projectImpactEnabled && eligibleProjects.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              {eligibleProjects.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="impact-project" className={POLICY_LABEL_CLASS}>
                    Projeto
                  </label>
                  <select
                    id="impact-project"
                    className={POLICY_SELECT_CLASS}
                    value={selectedProjectId}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                  >
                    <option value="">Selecione um projeto</option>
                    {eligibleProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {eligibleProjects
                .filter((project) => project.id === selectedProjectId)
                .map((project) => (
                  <ProjectImpactReadiness
                    key={project.id}
                    project={project}
                    sourceRepository={`${owner}/${repo}`}
                  />
                ))}
            </div>
          )}
        </section>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {phase !== 'idle' && phase !== 'running' && (
            <Button type="button" variant="secondary" onClick={newExecution}>
              Nova execução
            </Button>
          )}
          <Button type="submit" loading={phase === 'running'} disabled={!canStart}>
            {phase === 'running' ? 'Rodando' : 'Rodar revisão'}
          </Button>
        </div>
      </form>
      </Card>

      {phase !== 'idle' && (
        <div className="mb-6">
          <Console meter={<ConsoleMeter usage={report?.usage} model={testModel} />}>
            <AgentStepper
              events={events}
              running={phase === 'running'}
              failed={phase === 'error'}
              awaitingApproval={phase === 'awaiting_approval'}
            />
            <ConsoleStream text={liveThought} live={phase === 'running'} />
          </Console>
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

      {report?.githubComments && (
        <div className="mb-8">
          <GithubCommentsStatus result={report.githubComments} />
        </div>
      )}

      {Object.keys(visibleThoughts).length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Pensamento
          </h2>
          <ThoughtLog thoughts={visibleThoughts} running={phase === 'running'} />
        </div>
      )}

      {errorMessage && (
        <p className="mb-6 rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-1 px-4 py-3"
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
