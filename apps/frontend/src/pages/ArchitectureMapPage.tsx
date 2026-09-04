import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { architectureApi } from '../api/architecture.api';
import { ApiError } from '../api/http';
import { BoundaryEditor } from '../components/architecture/BoundaryEditor';
import { CapabilityCanvas } from '../components/architecture/CapabilityCanvas';
import { ComponentCuration } from '../components/architecture/ComponentCuration';
import { formatPercent } from '../components/architecture/architecture-ui';
import { Button } from '../components/ui/Button';
import { PageHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pill } from '../components/ui/Pill';
import { Spinner } from '../components/ui/Spinner';
import { Tabs } from '../components/ui/Tabs';
import type {
  ArchitectureMapSummary,
  ArchitectureScopeType,
  ArchitectureView,
} from '../types';
import './project-graph.css';

type TabId = 'map' | 'curation' | 'boundaries';

function useArchitectureScope(): { scopeType: ArchitectureScopeType; scopeRef: string } {
  const { owner = '', repo = '', id = '' } = useParams();
  return id
    ? { scopeType: 'project', scopeRef: id }
    : { scopeType: 'repository', scopeRef: `${owner}/${repo}`.toLowerCase() };
}

export function ArchitectureMapPage() {
  const { scopeType, scopeRef } = useArchitectureScope();
  const [map, setMap] = useState<ArchitectureMapSummary | null>(null);
  const [view, setView] = useState<ArchitectureView | null>(null);
  const [tab, setTab] = useState<TabId>('map');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadView = useCallback(async (mapId: string) => {
    setView(await architectureApi.view(mapId));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    architectureApi
      .forScope(scopeType, scopeRef)
      .then(async (found) => {
        if (cancelled) return;
        setMap(found);
        if (found) await loadView(found.id);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar o mapa arquitetural.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scopeType, scopeRef, loadView]);

  const run = useCallback(
    async (action: () => Promise<string | void>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const message = await action();
        if (map) await loadView(map.id);
        if (typeof message === 'string') setNotice(message);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a operação.');
      } finally {
        setBusy(false);
      }
    },
    [map, loadView],
  );

  const createMap = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await architectureApi.create(scopeType, scopeRef);
      setMap(created);
      await loadView(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar o mapa arquitetural.');
    } finally {
      setBusy(false);
    }
  };

  const indexSummary = useMemo(() => {
    const repositories = view?.scope.repositories ?? [];
    return {
      total: repositories.length,
      indexed: repositories.filter((repository) => repository.indexed).length,
      stale: repositories.filter((repository) => repository.stale).length,
    };
  }, [view]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!map || !view) {
    return (
      <div>
        <PageHead
          eyebrow="Mapa arquitetural"
          title="Nenhum mapa neste escopo"
          description="O mapa traduz o grafo técnico em capacidades, componentes e fronteiras, sempre ligado à evidência de código."
        />
        {error && (
          <p className="mb-4 rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p>
        )}
        <EmptyState
          title="Criar mapa arquitetural"
          description="O Cast sugere componentes candidatos a partir do índice já existente. Você confirma, renomeia ou deixa como não mapeado."
          action={
            <Button onClick={() => void createMap()} loading={busy}>
              Criar mapa
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHead
        eyebrow={`Mapa arquitetural · ${view.map.scopeRef}`}
        title={view.map.name}
        description="Capacidades e fronteiras derivadas do índice, com procedência e evidência navegável."
        actions={
          <>
            <Button variant="secondary" onClick={() => void run(() => architectureApi.suggest(map.id).then(() => undefined))} loading={busy}>
              Sugerir componentes
            </Button>
            <Button
              onClick={() =>
                void run(async () => {
                  const published = await architectureApi.publish(map.id);
                  const refreshed = await architectureApi.forScope(scopeType, scopeRef);
                  setMap(refreshed);
                  return `Versão ${published.version} publicada.`;
                })
              }
              loading={busy}
            >
              Publicar versão
            </Button>
          </>
        }
      />

      {error && (
        <p className="mb-4 rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p>
      )}
      {notice && (
        <p className="mb-4 rounded-sm border border-pass/40 bg-pass-soft px-4 py-3 text-sm text-pass">{notice}</p>
      )}

      <section
        className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Estado do mapa"
      >
        {[
          ['cobertura estrutural', formatPercent(view.coverage.structural)],
          ['componentes associados', `${view.coverage.assignedComponents}/${view.coverage.totalComponents}`],
          ['capacidades', String(view.capabilities.length)],
          ['índices prontos', `${indexSummary.indexed}/${indexSummary.total}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface-1 p-4">
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">{label}</p>
            <p className="mt-2 font-display text-xl text-ink">{value}</p>
          </div>
        ))}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {view.map.publishedVersion !== null ? (
          <Pill tone="pass">
            publicado v{view.map.publishedVersion} · {view.map.publishedHash?.slice(0, 8)}
          </Pill>
        ) : (
          <Pill>rascunho não publicado</Pill>
        )}
        {view.coverage.unmappedComponents > 0 && (
          <Pill tone="warn">{view.coverage.unmappedComponents} não mapeados</Pill>
        )}
        {indexSummary.stale > 0 && <Pill tone="warn">{indexSummary.stale} índices desatualizados</Pill>}
        {!view.dependenciesAvailable && <Pill tone="warn">dependências indisponíveis</Pill>}
        {view.violations.length > 0 && <Pill tone="fail">{view.violations.length} fronteiras atravessadas</Pill>}
      </div>

      <Tabs
        className="mt-6"
        active={tab}
        onChange={setTab}
        items={[
          { id: 'map', label: 'Visão executiva', count: view.capabilities.length },
          { id: 'curation', label: 'Curadoria', count: view.components.length },
          { id: 'boundaries', label: 'Fronteiras', count: view.boundaries.length },
        ]}
      />

      {tab === 'map' && <CapabilityCanvas view={view} />}

      {tab === 'curation' && (
        <ComponentCuration
          view={view}
          busy={busy}
          onSuggest={() => run(() => architectureApi.suggest(map.id).then(() => undefined))}
          onCreateCapability={(input) =>
            run(() => architectureApi.createCapability(map.id, input).then(() => undefined))
          }
          onDeleteCapability={(capabilityId) =>
            run(() => architectureApi.deleteCapability(map.id, capabilityId).then(() => undefined))
          }
          onAssign={(componentId, status, capabilityId) =>
            run(() =>
              architectureApi
                .assignComponent(map.id, componentId, status, capabilityId)
                .then(() => undefined),
            )
          }
        />
      )}

      {tab === 'boundaries' && (
        <BoundaryEditor
          view={view}
          busy={busy}
          onDeclare={(input) => run(() => architectureApi.declareBoundary(map.id, input).then(() => undefined))}
          onDelete={(boundaryId) =>
            run(() => architectureApi.deleteBoundary(map.id, boundaryId).then(() => undefined))
          }
        />
      )}
    </div>
  );
}
