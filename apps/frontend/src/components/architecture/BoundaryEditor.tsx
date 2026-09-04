import { useState } from 'react';
import type { ArchitectureView, BoundaryKind } from '../../types';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Pill } from '../ui/Pill';
import { confidenceLabel, dependencyKindLabel } from './architecture-ui';

const KINDS: BoundaryKind[] = ['allow', 'deny', 'review'];

const kindLabel: Record<BoundaryKind, string> = {
  allow: 'permitida',
  deny: 'proibida',
  review: 'exige atenção',
};

interface Props {
  view: ArchitectureView;
  busy: boolean;
  onDeclare: (input: {
    fromCapabilityId: string;
    toCapabilityId: string;
    kind: BoundaryKind;
    note: string | null;
  }) => Promise<void>;
  onDelete: (boundaryId: string) => Promise<void>;
}

export function BoundaryEditor({ view, busy, onDeclare, onDelete }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<BoundaryKind>('deny');
  const [note, setNote] = useState('');

  const capabilityName = (id: string) =>
    view.capabilities.find((capability) => capability.id === id)?.name ?? id;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!from || !to || from === to) return;
    await onDeclare({ fromCapabilityId: from, toCapabilityId: to, kind, note: note.trim() || null });
    setNote('');
  };

  return (
    <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <h2 className="mb-4 font-display text-base font-semibold text-ink">Violações detectadas</h2>
        {view.violations.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-strong px-6 py-12 text-sm text-ink-dim">
            Nenhuma relação técnica atravessa uma fronteira declarada.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-surface-1">
            {view.violations.map((violation) => (
              <article key={violation.boundaryId} className="border-b border-border px-4 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm text-ink">
                    {capabilityName(violation.fromCapabilityId)} → {capabilityName(violation.toCapabilityId)}
                  </p>
                  <Pill tone={violation.severity === 'violation' ? 'fail' : 'warn'}>
                    {violation.severity === 'violation' ? 'violação' : 'aviso'}
                  </Pill>
                  <Pill tone={violation.confidence === 'confirmed' ? 'pass' : 'neutral'}>
                    {confidenceLabel[violation.confidence]}
                  </Pill>
                  <Pill>{kindLabel[violation.boundaryKind]}</Pill>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {violation.evidence.slice(0, 4).map((evidence, index) => (
                    <li
                      key={`${evidence.fromPath}-${evidence.fromLine}-${index}`}
                      className="break-all font-mono text-[11px] text-ink-faint"
                    >
                      <span className="text-accent">{dependencyKindLabel[evidence.kind]}</span> {evidence.fromPath}
                      {evidence.fromLine !== null ? `:${evidence.fromLine}` : ''} → {evidence.toPath}
                      {evidence.toLine !== null ? `:${evidence.toLine}` : ''}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}

        <h2 className="mt-8 mb-4 font-display text-base font-semibold text-ink">Fronteiras declaradas</h2>
        {view.boundaries.length === 0 ? (
          <p className="text-sm text-ink-dim">Nenhuma fronteira declarada.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-surface-1">
            {view.boundaries.map((boundary) => (
              <div
                key={boundary.id}
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-ink">
                    {capabilityName(boundary.fromCapabilityId)} → {capabilityName(boundary.toCapabilityId)}
                  </p>
                  {boundary.note && <p className="mt-1 truncate text-xs text-ink-faint">{boundary.note}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill
                    tone={boundary.kind === 'deny' ? 'fail' : boundary.kind === 'review' ? 'warn' : 'pass'}
                  >
                    {kindLabel[boundary.kind]}
                  </Pill>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label="Remover fronteira"
                    onClick={() => void onDelete(boundary.id)}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="min-w-0 rounded-md border border-border bg-surface-1 p-5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">Declarar fronteira</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          {[
            { id: 'boundary-from', label: 'De', value: from, set: setFrom },
            { id: 'boundary-to', label: 'Para', value: to, set: setTo },
          ].map((select) => (
            <div key={select.id} className="flex flex-col gap-1.5">
              <label
                htmlFor={select.id}
                className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-faint uppercase"
              >
                {select.label}
              </label>
              <select
                id={select.id}
                value={select.value}
                onChange={(event) => select.set(event.target.value)}
                className="min-h-11 rounded-sm border border-border bg-surface-1 px-3 font-mono text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
              >
                <option value="">Selecione</option>
                {view.capabilities.map((capability) => (
                  <option key={capability.id} value={capability.id}>
                    {capability.name}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="boundary-kind"
              className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-faint uppercase"
            >
              Regra
            </label>
            <select
              id="boundary-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as BoundaryKind)}
              className="min-h-11 rounded-sm border border-border bg-surface-1 px-3 font-mono text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
            >
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {kindLabel[item]}
                </option>
              ))}
            </select>
          </div>

          <Field
            label="Nota"
            value={note}
            maxLength={280}
            placeholder="Opcional"
            onChange={(event) => setNote(event.target.value)}
          />

          <Button type="submit" loading={busy} disabled={!from || !to || from === to}>
            Declarar
          </Button>
        </form>

        <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-ink-faint">
          Uma regra <span className="font-mono">proibida</span> só vira violação sobre relação técnica confirmada.
          Relação apenas inferida gera aviso, nunca falha.
        </p>
      </aside>
    </div>
  );
}
