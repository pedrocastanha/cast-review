import { useMemo, useState } from 'react';
import type { ArchitectureView, CapabilityCriticality, ComponentStatus } from '../../types';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Pill } from '../ui/Pill';
import { confidenceLabel, criticalityLabel, criticalityTone } from './architecture-ui';

const CRITICALITIES: CapabilityCriticality[] = ['low', 'medium', 'high', 'critical'];

const statusLabel: Record<ComponentStatus, string> = {
  unmapped: 'não mapeado',
  assigned: 'confirmado',
  rejected: 'rejeitado',
};

interface Props {
  view: ArchitectureView;
  busy: boolean;
  onCreateCapability: (input: {
    name: string;
    description: string | null;
    criticality: CapabilityCriticality;
  }) => Promise<void>;
  onDeleteCapability: (capabilityId: string) => Promise<void>;
  onAssign: (componentId: string, status: ComponentStatus, capabilityId: string | null) => Promise<void>;
  onSuggest: () => Promise<void>;
}

export function ComponentCuration({
  view,
  busy,
  onCreateCapability,
  onDeleteCapability,
  onAssign,
  onSuggest,
}: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [criticality, setCriticality] = useState<CapabilityCriticality>('medium');
  const [showRejected, setShowRejected] = useState(false);

  const grouped = useMemo(() => {
    const byRepo = new Map<string, ArchitectureView['components']>();
    for (const component of view.components) {
      if (component.status === 'rejected' && !showRejected) continue;
      const bucket = byRepo.get(component.repoId) ?? [];
      bucket.push(component);
      byRepo.set(component.repoId, bucket);
    }
    return [...byRepo.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [view.components, showRejected]);

  const submitCapability = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreateCapability({
      name: name.trim(),
      description: description.trim() || null,
      criticality,
    });
    setName('');
    setDescription('');
    setCriticality('medium');
  };

  return (
    <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">Componentes candidatos</h2>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-ink-dim">
              <input
                type="checkbox"
                checked={showRejected}
                onChange={(event) => setShowRejected(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              mostrar rejeitados
            </label>
            <Button variant="secondary" onClick={() => void onSuggest()} loading={busy}>
              Sugerir por regra
            </Button>
          </div>
        </div>

        {grouped.length === 0 && (
          <div className="rounded-md border border-dashed border-border-strong px-6 py-12 text-sm text-ink-dim">
            Nenhum componente candidato ainda. Rode <span className="font-mono">Sugerir por regra</span> sobre um
            repositório indexado.
          </div>
        )}

        {grouped.map(([repoId, components]) => (
          <section key={repoId} className="mb-6">
            <p className="mb-2 font-mono text-[11px] tracking-[0.12em] text-ink-faint uppercase">{repoId}</p>
            <div className="overflow-hidden rounded-md border border-border bg-surface-1">
              {components.map((component) => (
                <div
                  key={component.id}
                  className="flex flex-col gap-3 border-b border-border px-4 py-3.5 last:border-b-0 lg:flex-row lg:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-ink">{component.pathPrefix}</p>
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">
                      {component.metrics.fileCount} arquivos · {component.metrics.symbolCount} símbolos ·{' '}
                      {component.metrics.inboundEdges} entradas · {component.metrics.outboundEdges} saídas
                      {component.metrics.providedEndpoints > 0 &&
                        ` · ${component.metrics.providedEndpoints} endpoints`}
                    </p>
                    <p className="mt-1 truncate font-mono text-[11px] text-ink-faint">
                      evidência: {component.evidence[0]?.path ?? '—'}
                      {component.evidence.length > 1 && ` +${component.evidence.length - 1}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Pill tone={component.status === 'assigned' ? 'pass' : 'neutral'}>
                      {statusLabel[component.status]}
                    </Pill>
                    <Pill tone={component.confidence === 'confirmed' ? 'accent' : 'neutral'}>
                      {confidenceLabel[component.confidence]}
                    </Pill>
                    <select
                      aria-label={`Capacidade de ${component.pathPrefix}`}
                      value={component.capabilityId ?? ''}
                      disabled={busy || view.capabilities.length === 0}
                      onChange={(event) =>
                        void onAssign(
                          component.id,
                          event.target.value ? 'assigned' : 'unmapped',
                          event.target.value || null,
                        )
                      }
                      className="min-h-11 min-w-[10rem] rounded-sm border border-border bg-surface px-3 font-mono text-xs text-ink focus-visible:border-accent focus-visible:outline-none"
                    >
                      <option value="">não mapeado</option>
                      {view.capabilities.map((capability) => (
                        <option key={capability.id} value={capability.id}>
                          {capability.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void onAssign(
                          component.id,
                          component.status === 'rejected' ? 'unmapped' : 'rejected',
                          null,
                        )
                      }
                    >
                      {component.status === 'rejected' ? 'Restaurar' : 'Rejeitar'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <aside className="min-w-0 rounded-md border border-border bg-surface-1 p-5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">Capacidades</p>

        <form onSubmit={submitCapability} className="mt-4 flex flex-col gap-3">
          <Field
            label="Nome"
            value={name}
            maxLength={80}
            placeholder="Autenticação"
            onChange={(event) => setName(event.target.value)}
          />
          <Field
            label="Descrição"
            value={description}
            maxLength={500}
            placeholder="Opcional"
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="capability-criticality"
              className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-faint uppercase"
            >
              Criticidade
            </label>
            <select
              id="capability-criticality"
              value={criticality}
              onChange={(event) => setCriticality(event.target.value as CapabilityCriticality)}
              className="min-h-11 rounded-sm border border-border bg-surface-1 px-3 font-mono text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
            >
              {CRITICALITIES.map((item) => (
                <option key={item} value={item}>
                  {criticalityLabel[item]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Criar capacidade
          </Button>
        </form>

        <ul className="mt-6 space-y-2 border-t border-border pt-4">
          {view.capabilities.map((capability) => (
            <li key={capability.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-ink">{capability.name}</p>
                <p className="font-mono text-[10px] text-ink-faint">
                  {capability.componentCount} componentes
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Pill tone={criticalityTone[capability.criticality]}>
                  {criticalityLabel[capability.criticality]}
                </Pill>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remover ${capability.name}`}
                  onClick={() => void onDeleteCapability(capability.id)}
                >
                  ×
                </Button>
              </div>
            </li>
          ))}
          {view.capabilities.length === 0 && (
            <li className="text-xs text-ink-faint">Nenhuma capacidade criada ainda.</li>
          )}
        </ul>
      </aside>
    </div>
  );
}
