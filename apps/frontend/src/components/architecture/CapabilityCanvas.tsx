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
import { useMemo, useState } from 'react';
import type {
  ArchitectureView,
  CapabilityDependency,
  CapabilityView,
} from '../../types';
import { Pill } from '../ui/Pill';
import {
  confidenceLabel,
  criticalityColor,
  criticalityLabel,
  criticalityTone,
  dependencyKindLabel,
} from './architecture-ui';

interface Selection {
  kind: 'capability' | 'dependency';
  id: string;
}

function dependencyId(dependency: CapabilityDependency): string {
  return `${dependency.fromCapabilityId}->${dependency.toCapabilityId}`;
}

function layout(capabilities: CapabilityView[], dependencies: CapabilityDependency[]) {
  const outgoing = new Set(dependencies.map((dependency) => dependency.fromCapabilityId));
  const incoming = new Set(dependencies.map((dependency) => dependency.toCapabilityId));
  const rows = [
    capabilities.filter((item) => outgoing.has(item.id) && !incoming.has(item.id)),
    capabilities.filter(
      (item) =>
        (outgoing.has(item.id) && incoming.has(item.id)) ||
        (!outgoing.has(item.id) && !incoming.has(item.id)),
    ),
    capabilities.filter((item) => incoming.has(item.id) && !outgoing.has(item.id)),
  ].filter((row) => row.length > 0);

  const positions = new Map<string, { x: number; y: number }>();
  rows.forEach((row, rowIndex) =>
    row.forEach((item, columnIndex) =>
      positions.set(item.id, { x: columnIndex * 250, y: rowIndex * 200 }),
    ),
  );
  return positions;
}

export function CapabilityCanvas({ view }: { view: ArchitectureView }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const flow = useMemo(() => {
    const positions = layout(view.capabilities, view.dependencies);
    const violationPairs = new Set(
      view.violations.map((violation) => `${violation.fromCapabilityId}->${violation.toCapabilityId}`),
    );

    const nodes: Node[] = view.capabilities.map((capability) => ({
      id: capability.id,
      position: positions.get(capability.id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        label: `${capability.name}\n${capability.componentCount} componente${capability.componentCount === 1 ? '' : 's'} · ${capability.symbolCount} símbolos`,
      },
      style: {
        width: 190,
        minHeight: 68,
        whiteSpace: 'pre-line',
        background: '#242022',
        color: '#f1ecef',
        border: `1px solid ${criticalityColor[capability.criticality]}`,
        borderRadius: 4,
        fontFamily: 'JetBrains Mono',
        fontSize: 11,
        padding: 12,
      },
    }));

    const edges: Edge[] = view.dependencies.map((dependency) => {
      const id = dependencyId(dependency);
      const violated = violationPairs.has(id);
      const stroke = violated ? '#c9524f' : dependency.confidence === 'confirmed' ? '#d56c91' : '#7c7175';
      return {
        id,
        source: dependency.fromCapabilityId,
        target: dependency.toCapabilityId,
        label: `${dependency.count} · ${confidenceLabel[dependency.confidence]}`,
        type: 'smoothstep',
        animated: violated,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        style: {
          stroke,
          strokeWidth: violated ? 2.5 : 2,
          strokeDasharray: dependency.confidence === 'inferred' ? '6 4' : undefined,
        },
        labelStyle: { fill: '#d9ccd1', fontFamily: 'JetBrains Mono', fontSize: 10 },
        labelBgStyle: { fill: '#171516', fillOpacity: 0.94 },
      };
    });

    return { nodes, edges };
  }, [view]);

  const selectedCapability =
    selection?.kind === 'capability'
      ? view.capabilities.find((capability) => capability.id === selection.id)
      : undefined;
  const selectedDependency =
    selection?.kind === 'dependency'
      ? view.dependencies.find((dependency) => dependencyId(dependency) === selection.id)
      : undefined;
  const capabilityName = (id: string) =>
    view.capabilities.find((capability) => capability.id === id)?.name ?? id;

  return (
    <section className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div
        className="project-graph h-[34rem] w-full min-w-0 overflow-hidden rounded-md border border-border bg-surface-1"
        aria-label="Mapa de capacidades"
      >
        {flow.nodes.length > 0 ? (
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            fitView
            minZoom={0.35}
            maxZoom={1.8}
            onNodeClick={(_, node) => setSelection({ kind: 'capability', id: node.id })}
            onEdgeClick={(_, edge) => setSelection({ kind: 'dependency', id: edge.id })}
          >
            <Background color="#393235" gap={24} size={1} />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="grid h-full place-items-center px-8 text-center text-sm text-ink-faint">
            Crie capacidades e associe componentes na aba Curadoria para desenhar o mapa.
          </div>
        )}
      </div>

      <aside className="min-w-0 rounded-md border border-border bg-surface-1 p-5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">Evidence inspector</p>

        {!selection && (
          <div className="mt-8">
            <h2 className="font-display text-lg text-ink">Selecione uma capacidade ou dependência</h2>
            <p className="mt-2 text-sm leading-6 text-ink-dim">
              Cada aresta é sustentada por evidência técnica do índice: arquivo, símbolo e SHA. Linha tracejada
              indica associação ainda inferida.
            </p>
          </div>
        )}

        {selectedCapability && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg text-ink">{selectedCapability.name}</h2>
              <Pill tone={criticalityTone[selectedCapability.criticality]}>
                {criticalityLabel[selectedCapability.criticality]}
              </Pill>
            </div>
            {selectedCapability.description && (
              <p className="mt-2 text-sm leading-6 text-ink-dim">{selectedCapability.description}</p>
            )}
            <dl className="mt-5 space-y-3 font-mono text-xs">
              <div>
                <dt className="text-ink-faint">Componentes</dt>
                <dd className="mt-1 text-ink">
                  {selectedCapability.componentCount} · {selectedCapability.confirmedComponentCount} confirmados
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Repositórios</dt>
                <dd className="mt-1 break-all text-ink">
                  {selectedCapability.repositories.join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Endpoints</dt>
                <dd className="mt-1 text-ink">
                  {selectedCapability.providedEndpoints} fornecidos · {selectedCapability.consumedEndpoints} consumidos
                </dd>
              </div>
            </dl>
            <div className="mt-5 border-t border-border pt-4">
              <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Componentes associados</p>
              <ul className="mt-3 space-y-2">
                {view.components
                  .filter(
                    (component) =>
                      component.status === 'assigned' && component.capabilityId === selectedCapability.id,
                  )
                  .map((component) => (
                    <li key={component.id} className="break-all font-mono text-xs text-ink">
                      {component.repoId}:{component.pathPrefix}
                      <span className="ml-2 text-ink-faint">{confidenceLabel[component.confidence]}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}

        {selectedDependency && (
          <div className="mt-5">
            <p className="font-mono text-xs font-semibold text-ink">
              {capabilityName(selectedDependency.fromCapabilityId)} → {capabilityName(selectedDependency.toCapabilityId)}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={selectedDependency.confidence === 'confirmed' ? 'pass' : 'neutral'}>
                {confidenceLabel[selectedDependency.confidence]}
              </Pill>
              {selectedDependency.kinds.map((kind) => (
                <Pill key={kind}>{dependencyKindLabel[kind]}</Pill>
              ))}
              <Pill>{selectedDependency.count} evidências</Pill>
            </div>
            <div className="mt-5 max-h-[24rem] space-y-4 overflow-y-auto pr-2 [scrollbar-color:var(--color-border-strong)_transparent]">
              {selectedDependency.evidence.map((evidence, index) => (
                <article
                  key={`${evidence.fromPath}-${evidence.fromLine}-${index}`}
                  className="border-t border-border pt-3 font-mono text-xs"
                >
                  <p className="text-accent">{dependencyKindLabel[evidence.kind]}</p>
                  {evidence.method && evidence.route && (
                    <p className="mt-1 text-ink">
                      {evidence.method} {evidence.route}
                    </p>
                  )}
                  <p className="mt-2 break-all text-ink">
                    {evidence.fromRepoId} · {evidence.fromPath}
                    {evidence.fromLine !== null ? `:${evidence.fromLine}` : ''}
                  </p>
                  <p className="break-all text-ink-faint">
                    → {evidence.toRepoId} · {evidence.toPath}
                    {evidence.toLine !== null ? `:${evidence.toLine}` : ''}
                    {evidence.toSha ? ` · ${evidence.toSha.slice(0, 8)}` : ''}
                  </p>
                </article>
              ))}
              {selectedDependency.evidence.length === 0 && (
                <p className="text-xs text-ink-faint">Nenhuma evidência materializada para esta relação.</p>
              )}
            </div>
          </div>
        )}
      </aside>
    </section>
  );
}
