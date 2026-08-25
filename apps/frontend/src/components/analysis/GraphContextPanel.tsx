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
      className="overflow-hidden rounded-md border border-border bg-surface-1/45"
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
              {snapshot.graph.stale && (
                <p className="rounded-sm border border-state-closed/50 bg-state-closed-dim px-4 py-3 text-sm text-ink">
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

              {(snapshot.budget.truncated || snapshot.budget.omittedNodes > 0) && (
                <p className="font-mono text-xs text-ink-faint">
                  {snapshot.budget.omittedNodes} nós e {snapshot.budget.omittedEdges} arestas ficaram fora do snapshot
                  {snapshot.budget.truncated ? ' por limite de contexto.' : '.'}
                </p>
              )}

              <details className="rounded-sm border border-border bg-surface-1/55">
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
