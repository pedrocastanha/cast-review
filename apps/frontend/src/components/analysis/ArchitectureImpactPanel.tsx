import type { ArchitectureImpact } from '../../types';
import {
  confidenceLabel,
  criticalityLabel,
  criticalityTone,
  dependencyKindLabel,
  formatPercent,
} from '../architecture/architecture-ui';
import { Pill } from '../ui/Pill';

export function ArchitectureImpactPanel({ impact }: { impact: ArchitectureImpact }) {
  const capabilityName = (id: string) =>
    impact.changed.find((item) => item.capabilityId === id)?.name ??
    impact.reached.find((item) => item.capabilityId === id)?.name ??
    id;

  return (
    <section className="rounded-md border border-border bg-surface-1 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">Impacto arquitetural</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={impact.status === 'exact' ? 'pass' : 'warn'}>
            {impact.status === 'exact' ? 'cobertura exata' : 'cobertura parcial'}
          </Pill>
          <Pill>
            {impact.usedDraft ? 'rascunho' : `v${impact.version}`}
            {impact.hash ? ` · ${impact.hash.slice(0, 8)}` : ''}
          </Pill>
          <Pill>{formatPercent(impact.coverage)} da PR mapeada</Pill>
        </div>
      </div>

      {impact.degradedReason && (
        <p className="mt-3 text-xs leading-5 text-ink-faint">{impact.degradedReason}</p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Capacidades alteradas</p>
          {impact.changed.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">Nenhuma capacidade confirmada foi tocada por esta PR.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {impact.changed.map((capability) => (
                <li key={capability.capabilityId} className="border-t border-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-ink">{capability.name}</p>
                    <Pill tone={criticalityTone[capability.criticality]}>
                      {criticalityLabel[capability.criticality]}
                    </Pill>
                    <Pill tone={capability.confidence === 'confirmed' ? 'pass' : 'neutral'}>
                      {confidenceLabel[capability.confidence]}
                    </Pill>
                  </div>
                  <p className="mt-1.5 break-all font-mono text-[11px] text-ink-faint">
                    {capability.files.slice(0, 4).join(', ')}
                    {capability.files.length > 4 && ` +${capability.files.length - 4}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Capacidades alcançadas</p>
          {impact.reached.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">Nenhuma capacidade vizinha alcançada pelas evidências.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {impact.reached.map((capability) => (
                <li
                  key={`${capability.capabilityId}-${capability.viaCapabilityId}-${capability.direction}`}
                  className="border-t border-border pt-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-ink">{capability.name}</p>
                    <Pill tone={capability.confidence === 'confirmed' ? 'pass' : 'neutral'}>
                      {confidenceLabel[capability.confidence]}
                    </Pill>
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                    {capability.direction === 'provides' ? 'fornece para' : 'consome de'}{' '}
                    {capabilityName(capability.viaCapabilityId)} ·{' '}
                    {capability.kinds.map((kind) => dependencyKindLabel[kind]).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {impact.violations.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Fronteiras atravessadas</p>
          <ul className="mt-3 space-y-2">
            {impact.violations.map((violation) => (
              <li key={violation.boundaryId} className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-xs text-ink">
                  {capabilityName(violation.fromCapabilityId)} → {capabilityName(violation.toCapabilityId)}
                </p>
                <Pill tone={violation.severity === 'violation' ? 'fail' : 'warn'}>
                  {violation.severity === 'violation' ? 'violação' : 'aviso'}
                </Pill>
                <Pill tone={violation.confidence === 'confirmed' ? 'pass' : 'neutral'}>
                  {confidenceLabel[violation.confidence]}
                </Pill>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(impact.unmappedFiles.length > 0 || impact.staleRepositories.length > 0) && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">Fora do mapa</p>
          {impact.unmappedFiles.length > 0 && (
            <p className="mt-2 break-all font-mono text-[11px] text-ink-faint">
              {impact.unmappedFiles.length} arquivos não mapeados: {impact.unmappedFiles.slice(0, 3).join(', ')}
              {impact.unmappedFiles.length > 3 && ' …'}
            </p>
          )}
          {impact.staleRepositories.length > 0 && (
            <p className="mt-1 font-mono text-[11px] text-warn">
              índice indisponível: {impact.staleRepositories.join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
