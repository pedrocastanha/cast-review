import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { benchmarksApi } from '../api/benchmarks.api';
import { ApiError } from '../api/http';
import { openaiKeyStore } from '../api/openai-key-store';
import { ReportMarkdown } from '../components/analysis/ReportMarkdown';
import { Spinner } from '../components/ui/Spinner';
import {
  cleanPullRequestBody,
  normalizeBenchmarkChangedFiles,
} from '../lib/benchmark-pr-context';
import type {
  BenchmarkCase,
  BenchmarkModelResult,
  BenchmarkRun,
  ReviewComment,
} from '../types';

function resultFindings(result: BenchmarkModelResult): ReviewComment[] {
  if (result.report?.comments?.length) return result.report.comments;
  return (result.report?.results ?? []).flatMap((reviewer) =>
    (reviewer.findings ?? []).map((finding) => ({
      ...finding,
      reviewer: reviewer.name,
    })),
  );
}

function findingKey(finding: ReviewComment) {
  return `${finding.path ?? ''}:${finding.line ?? ''}:${finding.title.trim().toLowerCase()}`;
}

function usd(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `$${value.toFixed(4)}`;
}

function difficultyLabel(value: BenchmarkCase['source']['difficulty']) {
  if (value === 'easy') return 'entrada';
  if (value === 'medium') return 'intermediário';
  if (value === 'hard') return 'avançado';
  return null;
}

function PullRequestContext({ benchmarkCase }: { benchmarkCase: BenchmarkCase }) {
  const source = benchmarkCase.source;
  const body = cleanPullRequestBody(source.body);
  const changedFiles = normalizeBenchmarkChangedFiles(
    benchmarkCase.inputSnapshot.changedFiles,
  );
  const diff = changedFiles
    .map((file) => file.diff)
    .filter(Boolean)
    .join('\n\n');

  return (
    <section className="border-b border-border bg-surface-1/45 px-4 py-6 sm:px-6" aria-labelledby="benchmark-pr-context-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">Antes de comparar</p>
          <h2 id="benchmark-pr-context-title" className="mt-2 font-display text-lg font-semibold text-ink">
            O que esta PR propõe
          </h2>
        </div>
        <p className="max-w-sm text-xs leading-5 text-ink-faint">
          Conteúdo congelado com o caso. A leitura não depende do estado atual da PR no GitHub.
        </p>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Título original</p>
          <h3 className="mt-2 max-w-3xl text-base font-semibold leading-6 text-ink">
            {source.originalTitle ?? benchmarkCase.title}
          </h3>

          {body ? (
            <details open className="group mt-5 border-y border-border py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-ink transition-colors hover:text-accent">
                Descrição original da PR
                <span className="font-mono text-[10px] text-ink-faint group-open:hidden">abrir ↓</span>
                <span className="hidden font-mono text-[10px] text-ink-faint group-open:inline">recolher ↑</span>
              </summary>
              <div className="mt-4 max-h-96 overflow-y-auto pr-3 [scrollbar-color:var(--color-border-strong)_transparent]">
                <ReportMarkdown markdown={body} />
              </div>
            </details>
          ) : (
            <div className="mt-5 border-y border-border py-4">
              <p className="text-sm leading-6 text-ink-dim">
                {source.description ?? 'A descrição original não fazia parte deste snapshot. O diff congelado abaixo continua disponível.'}
              </p>
            </div>
          )}
        </div>

        <aside className="min-w-0 border-t border-border pt-5 xl:border-t-0 xl:pt-0" aria-label="Arquivos alterados na PR">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Arquivos alterados</p>
            <span className="font-mono text-xs text-ink">{changedFiles.length}</span>
          </div>
          <ol className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto pr-2">
            {changedFiles.map((file, index) => (
              <li key={`${file.path}-${index}`} className="break-all font-mono text-[11px] leading-5 text-ink-dim">
                <span className="mr-2 text-ink-faint">{String(index + 1).padStart(2, '0')}</span>
                {file.path}
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <details className="group mt-5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 border border-border px-3 font-mono text-xs text-ink-dim transition-colors hover:border-border-strong hover:text-ink">
          <span>Ver diff congelado</span>
          <span className="text-[10px] text-ink-faint group-open:hidden">{changedFiles.length} arquivos ↓</span>
          <span className="hidden text-[10px] text-ink-faint group-open:inline">recolher ↑</span>
        </summary>
        <pre className="max-h-[32rem] overflow-auto border-x border-b border-border bg-surface p-4 font-mono text-[11px] leading-5 text-ink-dim">
          {diff || 'Diff indisponível neste snapshot.'}
        </pre>
      </details>
    </section>
  );
}

function Comparison({ run }: { run: BenchmarkRun }) {
  const results = run.results ?? [];
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const finding of new Set(resultFindings(result).map(findingKey))) {
      counts.set(finding, (counts.get(finding) ?? 0) + 1);
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.14em] text-accent uppercase">Comparação exploratória</p>
          <h2 className="mt-2 font-display text-lg font-semibold text-ink">Mesma evidência, leituras diferentes</h2>
        </div>
        <p className="max-w-md text-xs leading-5 text-ink-faint">
          Sem ground truth não existe vencedor automático. Exclusivo significa divergente, não necessariamente correto.
        </p>
      </div>

      <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-2 2xl:grid-cols-3">
        {results.map((result) => {
          const findings = resultFindings(result);
          const exclusive = findings.filter((finding) => counts.get(findingKey(finding)) === 1);
          return (
            <article key={result.model} className="min-w-0 bg-surface-1 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold text-ink">{result.model}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">
                    {(result.durationMs / 1000).toFixed(1)}s · {usd(result.report?.usage?.costUsd)}
                  </p>
                </div>
                <span className={`font-mono text-[10px] uppercase ${result.status === 'completed' ? 'text-state-open' : 'text-state-closed'}`}>
                  {result.status === 'completed' ? 'concluído' : 'erro'}
                </span>
              </div>

              {result.errorMessage ? (
                <p className="mt-5 text-sm text-state-closed">{result.errorMessage}</p>
              ) : (
                <>
                  <dl className="mt-5 grid grid-cols-3 gap-3 border-y border-border py-3 font-mono text-xs">
                    <div><dt className="text-ink-faint">score</dt><dd className="mt-1 text-lg text-ink">{result.report?.overallScore ?? '—'}</dd></div>
                    <div><dt className="text-ink-faint">findings</dt><dd className="mt-1 text-lg text-ink">{findings.length}</dd></div>
                    <div><dt className="text-ink-faint">exclusivos</dt><dd className="mt-1 text-lg text-accent">{exclusive.length}</dd></div>
                  </dl>
                  <ul className="mt-4 flex max-h-72 flex-col gap-3 overflow-auto pr-1">
                    {findings.filter((finding) => finding.status !== 'pass').map((finding, index) => (
                      <li key={`${findingKey(finding)}-${index}`}>
                        <p className="text-xs font-medium text-ink">{finding.title}</p>
                        <p className="mt-1 truncate font-mono text-[10px] text-ink-faint">
                          {finding.path ?? 'sem localização'}{finding.line ? `:${finding.line}` : ''}
                          {counts.get(findingKey(finding)) === 1 ? ' · exclusivo' : ' · compartilhado'}
                        </p>
                      </li>
                    ))}
                    {findings.length === 0 && <li className="text-xs text-ink-faint">Nenhum finding retornado.</li>}
                  </ul>
                </>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-3 truncate font-mono text-[10px] text-ink-faint">contexto {run.graphSnapshotHash}</p>
    </section>
  );
}

function CaseWorkspace({ benchmarkCase }: { benchmarkCase: BenchmarkCase }) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [models, setModels] = useState(['gpt-4o', '']);
  const [openaiKey, setOpenaiKey] = useState(openaiKeyStore.get);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRuns([]);
    setError(null);
    benchmarksApi.listRuns(benchmarkCase.id)
      .then((data) => { if (active) setRuns(data); })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : 'Falha ao carregar runs.'); });
    return () => { active = false; };
  }, [benchmarkCase.id]);

  const run = async () => {
    const selected = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
    if (selected.length === 0 || !openaiKey.trim()) {
      setError('Informe ao menos um modelo e a chave OpenAI.');
      return;
    }
    openaiKeyStore.set(openaiKey);
    setRunning(true);
    setError(null);
    try {
      const result = await benchmarksApi.runCase(benchmarkCase.id, selected, openaiKey);
      setRuns((current) => [result, ...current]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao executar o benchmark.');
    } finally {
      setRunning(false);
    }
  };

  const latest = runs[0];
  const sourceLabel = benchmarkCase.source.owner && benchmarkCase.source.repo
    ? `${benchmarkCase.source.owner}/${benchmarkCase.source.repo} #${benchmarkCase.source.pullNumber ?? ''}`
    : 'Caso oficial Cast Review';
  const difficulty = difficultyLabel(benchmarkCase.source.difficulty);
  const source = benchmarkCase.source;

  return (
    <div className="min-w-0">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-wide uppercase">
          <span className={benchmarkCase.kind === 'curated' ? 'text-state-open' : 'text-accent'}>
            {benchmarkCase.kind === 'curated' ? 'oficial' : 'privado'}
          </span>
          <span className="text-ink-faint">v{benchmarkCase.version} · {benchmarkCase.evaluationMode}</span>
          {source.category && <span className="text-ink-dim">· {source.category}</span>}
          {difficulty && <span className="text-ink-dim">· {difficulty}</span>}
        </div>
        <h1 className="mt-3 font-display text-xl font-semibold text-ink sm:text-2xl">{benchmarkCase.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-faint">
          <span>{sourceLabel}</span>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent transition-colors hover:text-accent-hover"
            >
              abrir PR ↗
            </a>
          )}
        </div>
        {source.description && (
          <p className="mt-4 max-w-3xl text-sm leading-6 text-ink-dim">{source.description}</p>
        )}
      </header>

      {benchmarkCase.kind === 'curated' && (
        <dl className="grid gap-px border-b border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-surface px-4 py-3">
            <dt className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Commit congelado</dt>
            <dd className="mt-1 truncate font-mono text-xs text-ink">{source.headSha?.slice(0, 12) ?? '—'}</dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Licença</dt>
            <dd className="mt-1 font-mono text-xs text-ink">
              {source.license ? (
                <a href={source.license.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {source.license.spdx} ↗
                </a>
              ) : '—'}
            </dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Escopo do grafo</dt>
            <dd className="mt-1 font-mono text-xs text-ink">mudanças + testes</dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Merge</dt>
            <dd className="mt-1 font-mono text-xs text-ink">
              {source.mergedAt ? new Date(source.mergedAt).toLocaleDateString('pt-BR') : '—'}
            </dd>
          </div>
        </dl>
      )}

      <PullRequestContext benchmarkCase={benchmarkCase} />

      <section className="grid gap-7 py-7 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <p className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">Modelos</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {models.map((model, index) => (
              <label key={index} className="flex flex-col gap-1.5 text-xs text-ink-faint">
                Modelo {index + 1}
                <input
                  value={model}
                  onChange={(event) => setModels((current) => current.map((item, currentIndex) => currentIndex === index ? event.target.value : item))}
                  placeholder={index === 0 ? 'gpt-4o' : 'outro modelo'}
                  className="min-h-11 rounded-sm border border-border bg-surface px-3 font-mono text-sm text-ink outline-none transition-colors focus:border-accent"
                />
              </label>
            ))}
          </div>
          {models.length < 4 && (
            <button type="button" onClick={() => setModels((current) => [...current, ''])} className="mt-3 font-mono text-xs text-ink-faint hover:text-ink">
              + adicionar modelo
            </button>
          )}
        </div>
        <div>
          <label className="flex flex-col gap-1.5 text-xs text-ink-faint">
            Chave OpenAI da sessão
            <input
              type="password"
              value={openaiKey}
              onChange={(event) => setOpenaiKey(event.target.value)}
              placeholder="sk-…"
              className="min-h-11 rounded-sm border border-border bg-surface px-3 font-mono text-sm text-ink outline-none transition-colors focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-sm border border-accent bg-accent px-4 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
          >
            {running ? 'Comparando modelos…' : 'Executar comparação'}
          </button>
        </div>
      </section>

      <dl className="grid gap-3 border-y border-border py-4 font-mono text-xs sm:grid-cols-3">
        <div><dt className="text-ink-faint">Input congelado</dt><dd className="mt-1 text-ink">{benchmarkCase.inputSnapshot.changedFiles.length} arquivos</dd></div>
        <div><dt className="text-ink-faint">Subgrafo</dt><dd className="mt-1 text-ink">{benchmarkCase.graphSnapshot.selected.nodes.length} nós · {benchmarkCase.graphSnapshot.edges.length} arestas</dd></div>
        <div><dt className="text-ink-faint">Histórico</dt><dd className="mt-1 text-ink">{runs.length} {runs.length === 1 ? 'run' : 'runs'}</dd></div>
      </dl>

      {error && <p className="mt-5 rounded-sm border border-state-closed/50 bg-state-closed-dim px-4 py-3 text-sm text-ink">{error}</p>}
      {latest?.results && <Comparison run={latest} />}
      {!latest && !error && (
        <div className="py-14 text-center">
          <p className="font-display text-lg font-semibold text-ink">Esse caso está pronto para repetir.</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-faint">Escolha os modelos. Diff, arquivos, convenções e Graph snapshot permanecem idênticos.</p>
        </div>
      )}
    </div>
  );
}

export function BenchmarksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestedId = searchParams.get('case');
  const selected = useMemo(
    () => cases.find((item) => item.id === requestedId) ?? cases[0] ?? null,
    [cases, requestedId],
  );
  const officialCases = useMemo(() => cases.filter((item) => item.kind === 'curated'), [cases]);
  const privateCases = useMemo(() => cases.filter((item) => item.kind === 'private'), [cases]);

  useEffect(() => {
    benchmarksApi.listCases()
      .then(setCases)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o Lab.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div>
      <header className="mb-8 border-b border-border pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 font-mono text-xs tracking-[0.14em] text-accent uppercase">Laboratório · 03</p>
            <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">Benchmark Lab</h1>
          </div>
          {!loading && (
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              {officialCases.length} PRs oficiais · {privateCases.length} privadas
            </p>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-faint">Compare modelos contra exatamente a mesma PR e a mesma visão estrutural. Sem mover o alvo entre uma execução e outra.</p>
      </header>

      {error && <p className="rounded-sm border border-state-closed/50 bg-state-closed-dim px-4 py-3 text-sm text-ink">{error}</p>}

      {!error && cases.length === 0 && (
        <div className="py-16 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhum caso congelado ainda.</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-faint">Abra uma análise salva e use “Salvar como benchmark”. O caso continuará disponível mesmo se a PR mudar.</p>
        </div>
      )}

      {selected && (
        <div className="grid min-w-0 gap-8 xl:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="min-w-0 max-w-full overflow-hidden">
            {[
              { label: 'Oficiais', items: officialCases },
              { label: 'Suas PRs', items: privateCases },
            ].map((group) => group.items.length > 0 && (
              <section key={group.label} className="mb-6 min-w-0 max-w-full last:mb-0">
                <p className="mb-3 font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">{group.label}</p>
                <nav className="flex max-w-full gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible" aria-label={`Casos ${group.label.toLowerCase()}`}>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSearchParams({ case: item.id })}
                      className={`min-w-56 rounded-sm border p-3 text-left transition-colors xl:min-w-0 ${item.id === selected.id ? 'border-accent bg-accent-quiet/30' : 'border-border bg-surface-1/40 hover:border-border-strong'}`}
                    >
                      <p className="line-clamp-2 text-sm font-medium leading-5 text-ink">{item.title}</p>
                      <p className="mt-1 font-mono text-[10px] text-ink-faint">
                        {item.source.category ?? (item.kind === 'curated' ? 'oficial' : 'privado')} · v{item.version}
                      </p>
                    </button>
                  ))}
                </nav>
              </section>
            ))}
          </aside>
          <CaseWorkspace key={selected.id} benchmarkCase={selected} />
        </div>
      )}
    </div>
  );
}
