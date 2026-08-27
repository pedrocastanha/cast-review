import {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { analysesApi } from '../../api/analyses.api';
import { ApiError } from '../../api/http';
import type {
  AnalysisContextSnapshot,
  GraphRelation,
  GraphSnapshotNode,
} from '../../types';
import { Spinner } from '../ui/Spinner';

const FILTERS: Array<{ value: 'all' | GraphRelation; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'caller', label: 'Callers' },
  { value: 'callee', label: 'Callees' },
  { value: 'test', label: 'Testes' },
  { value: 'dead_code', label: 'Código morto' },
];

const RELATION_LABEL: Record<GraphRelation, string> = {
  changed: 'alterado',
  caller: 'caller',
  callee: 'callee',
  test: 'teste',
  dead_code: 'candidato morto',
};

const RELATION_COLOR: Record<GraphRelation, string> = {
  changed: 'oklch(62% 0.21 350)',
  caller: 'oklch(72% 0.13 250)',
  callee: 'oklch(73% 0.14 150)',
  test: 'oklch(78% 0.15 80)',
  dead_code: 'oklch(66% 0.16 25)',
};

function positionNodes(items: GraphSnapshotNode[]): Node[] {
  const columns: Record<GraphRelation, { x: number; y: number }> = {
    caller: { x: 0, y: 20 },
    changed: { x: 310, y: 20 },
    callee: { x: 620, y: 20 },
    test: { x: 310, y: 260 },
    dead_code: { x: 620, y: 260 },
  };
  const counts = new Map<GraphRelation, number>();

  return items.map((item) => {
    const index = counts.get(item.relation) ?? 0;
    counts.set(item.relation, index + 1);
    const origin = columns[item.relation];
    return {
      id: item.id,
      position: { x: origin.x, y: origin.y + index * 92 },
      sourcePosition: item.relation === 'caller' ? Position.Right : Position.Left,
      targetPosition: item.relation === 'callee' ? Position.Left : Position.Right,
      data: {
        label: (
          <div className="min-w-0 text-left">
            <p className="truncate font-mono text-[10px] tracking-wide uppercase opacity-70">
              {RELATION_LABEL[item.relation]}
              {item.distance !== null ? ` · d${item.distance}` : ''}
            </p>
            <p className="mt-1 truncate text-xs font-semibold">{item.name}</p>
            <p className="mt-0.5 truncate font-mono text-[9px] opacity-60">{item.path}</p>
          </div>
        ),
      },
      style: {
        width: 220,
        borderRadius: 4,
        border: `1px solid ${RELATION_COLOR[item.relation]}`,
        background: 'oklch(17% 0.008 350)',
        color: 'oklch(94% 0.005 350)',
        padding: '10px 12px',
        boxShadow: 'none',
      },
      draggable: false,
    };
  });
}

function SnapshotGraph({ snapshot, filter }: { snapshot: AnalysisContextSnapshot; filter: 'all' | GraphRelation }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const visibleNodes = useMemo(() => {
    if (filter === 'all') return snapshot.selected.nodes;
    return snapshot.selected.nodes.filter(
      (node) => node.relation === 'changed' || node.relation === filter,
    );
  }, [filter, snapshot.selected.nodes]);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const nodes = useMemo(() => positionNodes(visibleNodes), [visibleNodes]);
  const edges: Edge[] = snapshot.edges
    .filter((edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId))
    .map((edge, index) => ({
      id: `${edge.fromId}-${edge.toId}-${index}`,
      source: edge.fromId,
      target: edge.toId,
      label: edge.kind,
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: false,
      style: {
        stroke: edge.confidence === 'stale' ? 'oklch(63% 0.12 75)' : 'oklch(52% 0.02 350)',
      },
      labelStyle: { fill: 'oklch(63% 0.01 350)', fontSize: 9 },
    }));

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setReady(element.clientWidth > 0 && element.clientHeight > 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '29rem' }}
      className="overflow-hidden rounded-md border border-border bg-surface-1"
    >
      {ready && (
        <ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} fitView minZoom={0.25}>
          <Background color="oklch(40% 0.015 350 / 0.35)" gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  );
}

const IMPACT_LABEL = {
  breaking_candidate: 'possível quebra',
  behavioral_candidate: 'risco comportamental',
  integration_gap: 'integração sem provedor',
  informational: 'informativo',
} as const;

function CrossRepoSnapshot({ snapshot }: { snapshot: AnalysisContextSnapshot }) {
  if (snapshot.schemaVersion !== '2' || !snapshot.scope) return null;
  const evidenceById = new Map((snapshot.evidence ?? []).map((item) => [item.id, item]));
  const warning = snapshot.scope.status !== 'exact';

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">
            Impacto entre repositórios
          </p>
          <h3 className="mt-1 font-display text-base font-bold text-ink">
            {snapshot.scope.projectName ?? 'Projeto indisponível'}
          </h3>
        </div>
        <span
          className={`rounded-sm border px-2 py-1 font-mono text-[10px] tracking-wide uppercase ${
            warning
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-state-open/50 bg-state-open/10 text-state-open'
          }`}
        >
          {snapshot.scope.status === 'exact'
            ? 'cobertura exata'
            : snapshot.scope.status === 'degraded'
              ? 'cobertura parcial'
              : 'fallback local'}
        </span>
      </div>

      {snapshot.scope.fallbackReason && (
        <p className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink">
          {snapshot.scope.fallbackReason}
        </p>
      )}

      {snapshot.source && (
        <dl className="grid gap-3 font-mono text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink-faint">Origem</dt>
            <dd className="mt-1 text-ink">{snapshot.source.repoId}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Base SHA</dt>
            <dd className="mt-1 text-ink">{snapshot.source.baseSha?.slice(0, 12) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Head SHA</dt>
            <dd className="mt-1 text-ink">{snapshot.source.headSha?.slice(0, 12) ?? '—'}</dd>
          </div>
        </dl>
      )}

      {(snapshot.repositories?.length ?? 0) > 0 && (
        <div>
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Versões congeladas
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {snapshot.repositories?.map((repository) => (
              <li
                key={repository.repoId}
                className="rounded-sm border border-border px-3 py-2 font-mono text-[10px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink">{repository.repoId}</span>
                  <span className={repository.included ? 'text-state-open' : 'text-accent'}>
                    {repository.included ? repository.indexStatus : 'omitido'}
                  </span>
                </div>
                <p className="mt-1 truncate text-ink-faint">
                  {repository.indexedSha?.slice(0, 12) ?? repository.omissionReason ?? 'sem SHA'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(snapshot.impacts?.length ?? 0) > 0 ? (
        <div>
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Evidências selecionadas
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.impacts?.map((impact) => {
              const evidence = evidenceById.get(impact.evidenceId);
              return (
                <li key={impact.id} className="rounded-sm border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-mono text-[10px] tracking-wide uppercase ${
                        impact.risk === 'breaking_candidate' ? 'text-state-closed' : 'text-accent'
                      }`}
                    >
                      {IMPACT_LABEL[impact.risk]}
                    </span>
                    <span className="font-mono text-xs text-ink">
                      {impact.method} {impact.route}
                    </span>
                    <span className="font-mono text-[10px] text-ink-faint">
                      {impact.confidence}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-ink-dim">{impact.direction}</p>
                  {evidence && (
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-sm bg-surface-2 px-3 py-2">
                        <p className="font-mono text-[9px] tracking-wide text-ink-faint uppercase">
                          consumidor
                        </p>
                        <p className="mt-1 truncate font-mono text-ink">
                          {evidence.consumer.repoId}/{evidence.consumer.path}:{evidence.consumer.line}
                        </p>
                      </div>
                      <div className="rounded-sm bg-surface-2 px-3 py-2">
                        <p className="font-mono text-[9px] tracking-wide text-ink-faint uppercase">
                          provedor
                        </p>
                        <p className="mt-1 truncate font-mono text-ink">
                          {evidence.provider
                            ? `${evidence.provider.repoId}/${evidence.provider.path}:${evidence.provider.line}`
                            : 'não encontrado no escopo congelado'}
                        </p>
                      </div>
                    </div>
                  )}
                  <p className="mt-2 truncate font-mono text-[9px] text-ink-faint">
                    {impact.evidenceId}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="rounded-sm border border-border px-3 py-4 text-sm text-ink-faint">
          Nenhum impacto cross-repo confirmado no contexto selecionado.
        </p>
      )}

      {snapshot.budget.truncated && (
        <p className="font-mono text-xs text-ink-faint">
          Contexto truncado: {snapshot.budget.omittedImpacts ?? 0} impactos e{' '}
          {snapshot.budget.omittedEvidence ?? 0} evidências omitidos.
        </p>
      )}
    </div>
  );
}

export function GraphContextPanel({ analysisId }: { analysisId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AnalysisContextSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | GraphRelation>('all');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || snapshot || loading) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await analysesApi.getContextSnapshot(analysisId));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Contexto histórico indisponível para esta análise.'
          : 'Não foi possível carregar o contexto usado pelo agente.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border-y border-border py-5">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-5 text-left"
      >
        <span>
          <span className="block font-mono text-xs tracking-[0.14em] text-accent uppercase">
            Contexto usado pelo agente
          </span>
          <span className="mt-1 block text-sm text-ink-faint">
            Snapshot imutável do subgrafo que entrou neste review
          </span>
        </span>
        <span className="font-mono text-xl text-ink-faint" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-5">
          {loading && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
          {error && <p className="rounded-sm border border-border bg-surface-1 px-4 py-3 text-sm text-ink-dim">{error}</p>}
          {snapshot && (
            <>
              <CrossRepoSnapshot snapshot={snapshot} />

              {snapshot.graph.stale && (
                <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
                  Contexto stale — o índice disponível é de outro SHA. Relações são evidência auxiliar, não certeza.
                </p>
              )}

              <dl className="grid gap-3 font-mono text-xs sm:grid-cols-2 xl:grid-cols-4">
                <div><dt className="text-ink-faint">SHA solicitado</dt><dd className="mt-1 truncate text-ink">{snapshot.repository.requestedSha?.slice(0, 12) ?? '—'}</dd></div>
                <div><dt className="text-ink-faint">SHA indexado</dt><dd className="mt-1 truncate text-ink">{snapshot.graph.indexedSha?.slice(0, 12) ?? 'não indexado'}</dd></div>
                <div><dt className="text-ink-faint">Contexto</dt><dd className="mt-1 text-ink">{snapshot.selected.nodes.length} nós · {snapshot.edges.length} arestas</dd></div>
                <div><dt className="text-ink-faint">Orçamento</dt><dd className="mt-1 text-ink">{snapshot.budget.budgetUsed}/{snapshot.budget.tokenBudget} tokens</dd></div>
              </dl>

              <div className="flex flex-wrap gap-2" aria-label="Filtrar relações">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    className={`min-h-9 rounded-sm border px-3 font-mono text-[10px] tracking-wide uppercase transition-colors ${
                      filter === item.value
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-border text-ink-faint hover:border-border-strong hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {snapshot.selected.nodes.length > 0 ? (
                <SnapshotGraph snapshot={snapshot} filter={filter} />
              ) : (
                <p className="rounded-sm border border-border bg-surface-1 px-4 py-8 text-center text-sm text-ink-faint">
                  O agente não recebeu relações do Code Graph nesta análise.
                </p>
              )}

              {(snapshot.budget.truncated || (snapshot.budget.omittedNodes ?? 0) > 0) && (
                <p className="font-mono text-xs text-ink-faint">
                  {snapshot.budget.omittedNodes ?? 0} nós e {snapshot.budget.omittedEdges ?? 0} arestas ficaram fora do snapshot
                  {snapshot.budget.truncated ? ' por limite de contexto.' : '.'}
                </p>
              )}

              <details className="rounded-sm border border-border bg-surface-1">
                <summary className="cursor-pointer px-4 py-3 font-mono text-xs text-ink-dim">
                  Ver bloco textual enviado aos reviewers
                </summary>
                <pre className="max-h-96 overflow-auto border-t border-border p-4 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-faint">
                  {snapshot.rendered.graphContextBlock || 'Nenhum bloco do Graph foi enviado.'}
                </pre>
              </details>

              <p className="truncate font-mono text-[10px] text-ink-faint">
                snapshot {snapshot.snapshotHash}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
