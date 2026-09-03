import { useEffect, useState } from 'react';
import { githubAppApi } from '../../api/github-app.api';
import { ApiError } from '../../api/http';
import { DEFAULT_AI_MODEL } from '../../lib/ai-models';
import type {
  GithubAppRepositorySummary,
  GithubReviewRunSummary,
  UpdateRepositoryConfigPayload,
} from '../../types';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Pill } from '../ui/Pill';
import { ReviewRunList } from './ReviewRunList';

interface Props {
  repository: GithubAppRepositorySummary;
  installationPaused: boolean;
  onChanged: () => Promise<void> | void;
}

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function RepositoryAutomationCard({ repository, installationPaused, onChanged }: Props) {
  const { config } = repository;
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<GithubReviewRunSummary[] | null>(null);
  const [pullNumber, setPullNumber] = useState('');

  const [events, setEvents] = useState(config.events);
  const [includeDrafts, setIncludeDrafts] = useState(config.includeDrafts);
  const [baseBranches, setBaseBranches] = useState(config.baseBranches.join(', '));
  const [testReviewer, setTestReviewer] = useState(config.models?.testReviewer ?? DEFAULT_AI_MODEL);
  const [architectureReviewer, setArchitectureReviewer] = useState(
    config.models?.architectureReviewer ?? DEFAULT_AI_MODEL,
  );
  const [publishPolicy, setPublishPolicy] = useState(config.publishPolicy);
  const [budgetMonthlyUsd, setBudgetMonthlyUsd] = useState(
    config.budgetMonthlyUsd === null ? '' : String(config.budgetMonthlyUsd),
  );
  const [budgetPerRunUsd, setBudgetPerRunUsd] = useState(
    config.budgetPerRunUsd === null ? '' : String(config.budgetPerRunUsd),
  );
  const [staleIndexBehavior, setStaleIndexBehavior] = useState(config.staleIndexBehavior);

  useEffect(() => {
    if (!expanded || runs !== null) return;
    githubAppApi
      .listRuns(repository.id)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [expanded, repository.id, runs]);

  const currentPayload = (): UpdateRepositoryConfigPayload => ({
    events,
    includeDrafts,
    baseBranches: baseBranches
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    models: { testReviewer, architectureReviewer },
    publishPolicy,
    budgetMonthlyUsd: toNumberOrNull(budgetMonthlyUsd),
    budgetPerRunUsd: toNumberOrNull(budgetPerRunUsd),
    staleIndexBehavior,
  });

  const submit = async (payload: UpdateRepositoryConfigPayload, refreshRuns = false) => {
    setSaving(true);
    setError(null);
    try {
      await githubAppApi.updateRepository(repository.id, payload);
      if (refreshRuns) setRuns(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const triggerRun = async () => {
    const parsed = Number(pullNumber);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError('Informe o número da pull request.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await githubAppApi.triggerRun(repository.id, parsed);
      setPullNumber('');
      setRuns(await githubAppApi.listRuns(repository.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enfileirar a revisão.');
    } finally {
      setSaving(false);
    }
  };

  const active = repository.enabled && !repository.paused && !installationPaused;

  return (
    <div className="rounded-md border border-border bg-surface-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium text-ink">{repository.fullName}</span>
            {active ? (
              <Pill tone="pass" dot>
                automação ligada
              </Pill>
            ) : repository.paused ? (
              <Pill tone="warn">pausado</Pill>
            ) : installationPaused && repository.enabled ? (
              <Pill tone="warn">instalação pausada</Pill>
            ) : (
              <Pill tone="neutral">desligada</Pill>
            )}
            {repository.configStatus === 'configuration_required' && (
              <Pill tone="warn">configuração pendente</Pill>
            )}
          </div>
          {repository.configReason && (
            <p className="mt-1 text-xs text-warn">{repository.configReason}</p>
          )}
          {repository.budget && (
            <p className="mt-1 font-mono text-[11.5px] text-ink-faint">
              {repository.budget.month} · gasto US$ {repository.budget.consumedUsd.toFixed(4)}
              {repository.budget.limitUsd !== null
                ? ` de US$ ${repository.budget.limitUsd.toFixed(2)}`
                : ' · sem teto'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Fechar' : 'Configurar'}
          </Button>
          {repository.enabled && (
            <Button
              variant="secondary"
              loading={saving}
              onClick={() => submit({ paused: !repository.paused })}
            >
              {repository.paused ? 'Retomar' : 'Pausar'}
            </Button>
          )}
          <Button
            loading={saving}
            variant={repository.enabled ? 'danger' : 'primary'}
            onClick={() =>
              submit(
                repository.enabled
                  ? { enabled: false }
                  : { ...currentPayload(), enabled: true },
              )
            }
          >
            {repository.enabled ? 'Desligar' : 'Ligar automação'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-5">
          {error && <p className="mb-4 text-sm text-fail">{error}</p>}

          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(18rem,100%),1fr))]">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-mono text-[10.5px] tracking-[0.12em] text-ink-faint uppercase">
                Eventos
              </legend>
              {(
                [
                  ['opened', 'PR aberta'],
                  ['reopened', 'PR reaberta'],
                  ['synchronize', 'Novo commit na PR'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={events[key]}
                    onChange={(event) =>
                      setEvents({ ...events, [key]: event.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
              <label className="mt-1 flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={includeDrafts}
                  onChange={(event) => setIncludeDrafts(event.target.checked)}
                />
                Revisar rascunhos
              </label>
            </fieldset>

            <div className="flex flex-col gap-4">
              <Field
                label="Branches de destino"
                value={baseBranches}
                onChange={(event) => setBaseBranches(event.target.value)}
                placeholder="main, release/*"
                hint="Vazio revisa qualquer branch de destino. Aceita curinga."
              />
              <Field
                label="Modelo do test reviewer"
                value={testReviewer}
                onChange={(event) => setTestReviewer(event.target.value)}
              />
              <Field
                label="Modelo do architecture reviewer"
                value={architectureReviewer}
                onChange={(event) => setArchitectureReviewer(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-faint uppercase">
                  Publicação
                </span>
                <select
                  value={publishPolicy}
                  onChange={(event) =>
                    setPublishPolicy(event.target.value as typeof publishPolicy)
                  }
                  className="min-h-11 rounded-sm border border-border bg-surface-1 px-3 font-mono text-sm text-ink"
                >
                  <option value="check_only">Só Check Run</option>
                  <option value="comments">Check Run + comentários na PR</option>
                </select>
              </div>
              <Field
                label="Teto mensal (USD)"
                value={budgetMonthlyUsd}
                onChange={(event) => setBudgetMonthlyUsd(event.target.value)}
                placeholder="20"
                hint="Obrigatório para ligar a automação."
              />
              <Field
                label="Limite por análise (USD)"
                value={budgetPerRunUsd}
                onChange={(event) => setBudgetPerRunUsd(event.target.value)}
                placeholder="0.50"
                hint="Valor reservado antes de chamar o modelo."
              />
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-faint uppercase">
                  Índice desatualizado
                </span>
                <select
                  value={staleIndexBehavior}
                  onChange={(event) =>
                    setStaleIndexBehavior(event.target.value as typeof staleIndexBehavior)
                  }
                  className="min-h-11 rounded-sm border border-border bg-surface-1 px-3 font-mono text-sm text-ink"
                >
                  <option value="proceed">Analisar mesmo assim</option>
                  <option value="skip">Pular a análise</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3">
            <Button loading={saving} onClick={() => submit(currentPayload(), true)}>
              Salvar configuração
            </Button>
            <div className="flex items-end gap-2">
              <Field
                label="Rodar PR agora"
                value={pullNumber}
                onChange={(event) => setPullNumber(event.target.value)}
                placeholder="42"
                className="w-28"
              />
              <Button variant="secondary" loading={saving} onClick={triggerRun}>
                Enfileirar
              </Button>
            </div>
          </div>

          <ReviewRunList
            runs={runs}
            owner={repository.owner}
            repo={repository.repo}
            onRetry={async (runId) => {
              await githubAppApi.retryRun(runId);
              setRuns(await githubAppApi.listRuns(repository.id));
            }}
          />
        </div>
      )}
    </div>
  );
}
