import { Background, Controls, MarkerType, type Edge, type Node, Position, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/http';
import { projectsApi } from '../api/projects.api';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import type { Project, ProjectGraph, ProjectGraphEdge, ProjectIndexStatus } from '../types';
import './project-graph.css';

function statusLabel(status: ProjectIndexStatus['repositories'][number]) {
  if (status.status === 'indexed' && status.stale) return 'desatualizado';
  return { indexed: 'indexado', indexing: 'indexando', queued: 'na fila', not_indexed: 'não indexado', error: 'falha' }[status.status];
}

export function ProjectGraphPage() {
  const { id = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectIndexStatus | null>(null);
  const [graph, setGraph] = useState<ProjectGraph | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<ProjectGraphEdge | null>(null);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextProject, nextStatus, nextGraph] = await Promise.all([projectsApi.get(id), projectsApi.status(id), projectsApi.graph(id)]);
      setProject(nextProject); setStatus(nextStatus); setGraph(nextGraph);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Falha ao carregar o mapa.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const active = status?.repositories.some((repo) => repo.status === 'queued' || repo.status === 'indexing');
    if (!active) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [status, load]);

  const indexAll = async () => {
    setIndexing(true); setError(null);
    try { await projectsApi.index(id); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Falha ao iniciar indexação.'); }
    finally { setIndexing(false); }
  };

  const flow = useMemo(() => {
    const graphNodes = graph?.nodes ?? [];
    const outgoing = new Set((graph?.edges ?? []).map((edge) => edge.source));
    const incoming = new Set((graph?.edges ?? []).map((edge) => edge.target));
    const rows = [
      graphNodes.filter((node) => outgoing.has(node.id) && !incoming.has(node.id)),
      graphNodes.filter((node) => (outgoing.has(node.id) && incoming.has(node.id)) || (!outgoing.has(node.id) && !incoming.has(node.id))),
      graphNodes.filter((node) => incoming.has(node.id) && !outgoing.has(node.id)),
    ].filter((row) => row.length > 0);
    const positions = new Map<string, { x: number; y: number }>();
    rows.forEach((row, rowIndex) => row.forEach((node, columnIndex) => positions.set(node.id, { x: columnIndex * 230, y: rowIndex * 190 })));
    const nodes: Node[] = graphNodes.map((node) => ({ id: node.id, position: positions.get(node.id) ?? { x: 0, y: 0 }, sourcePosition: Position.Bottom, targetPosition: Position.Top, data: { label: `${node.label}\n${node.indexed ? 'indexed' : 'waiting'}` }, style: { width: 170, minHeight: 64, whiteSpace: 'pre-line', background: node.indexed ? '#242022' : '#181617', color: '#f1ecef', border: `1px solid ${node.indexed ? '#b85a79' : '#50484c'}`, borderRadius: 4, fontFamily: 'JetBrains Mono', fontSize: 11, padding: 12, boxShadow: node.indexed ? '0 10px 35px rgba(184,90,121,.12)' : 'none' } }));
    const edges: Edge[] = (graph?.edges ?? []).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: `${edge.count} endpoint${edge.count === 1 ? '' : 's'}`, type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: '#d56c91' }, style: { stroke: '#d56c91', strokeWidth: 2 }, labelStyle: { fill: '#d9ccd1', fontFamily: 'JetBrains Mono', fontSize: 10 }, labelBgStyle: { fill: '#171516', fillOpacity: .94 } }));
    return { nodes, edges };
  }, [graph]);

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  if (!project) return <p className="text-sm text-state-closed">{error || 'Projeto não encontrado.'}</p>;

  return (
    <div>
      <header className="flex flex-col justify-between gap-5 border-b border-border pb-6 xl:flex-row xl:items-end">
        <div>
          <Link to="/projects" className="inline-flex min-h-11 items-center font-mono text-xs text-ink-faint hover:text-ink">← todos os projetos</Link>
          <p className="mt-6 font-mono text-xs tracking-[0.14em] text-accent uppercase">Cross-repo map · confirmed evidence</p>
          <h1 className="mt-2 font-display text-xl font-semibold text-ink sm:text-2xl">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-faint">{project.description || 'Relações técnicas entre os repositórios deste projeto.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${id}/chat`} className="inline-flex min-h-11 items-center justify-center border border-border-strong px-4 text-sm font-semibold text-ink hover:bg-surface-2">Chat</Link>
          <Link to={`/projects/${id}/edit`} className="inline-flex min-h-11 items-center justify-center border border-border-strong px-4 text-sm font-semibold text-ink hover:bg-surface-2">Editar</Link>
          <Button onClick={indexAll} loading={indexing}>{(graph?.stats.indexedRepositories ?? 0) === project.repositories.length ? 'Reindexar projeto' : 'Indexar projeto'}</Button>
        </div>
      </header>
      {error && <p className="mt-5 border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm text-ink">{error}</p>}

      <section className="mt-6 grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4" aria-label="Métricas do grafo">
        {[['repositórios', graph?.stats.repositories ?? project.repositories.length], ['indexados', graph?.stats.indexedRepositories ?? 0], ['ligações', graph?.stats.links ?? 0], ['endpoints relacionados', graph?.stats.endpoints ?? 0]].map(([label, value]) => <div key={label} className="bg-surface-1 p-4"><p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">{label}</p><p className="mt-2 font-display text-xl text-ink">{value}</p></div>)}
      </section>

      <section className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="project-graph h-[34rem] w-full min-w-0 overflow-hidden border border-border bg-surface-1" aria-label="Grafo cross-repo">
          {flow.nodes.length > 0 ? <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView minZoom={0.35} maxZoom={1.8} onEdgeClick={(_, edge) => setSelectedEdge(graph?.edges.find((item) => item.id === edge.id) ?? null)}><Background color="#393235" gap={24} size={1} /><Controls /></ReactFlow> : <div className="grid h-full place-items-center px-8 text-center text-sm text-ink-faint">Adicione repositórios ao projeto para começar.</div>}
        </div>
        <aside className="min-w-0 border border-border bg-surface-1 p-5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">Evidence inspector</p>
          {(graph?.edges.length ?? 0) > 0 && <div className="mt-4">
            <label htmlFor="project-relationship" className="text-[10px] font-semibold tracking-wide text-ink-faint uppercase">Relação inspecionada</label>
            <select id="project-relationship" value={selectedEdge?.id ?? ''} onChange={(event) => setSelectedEdge(graph?.edges.find((edge) => edge.id === event.target.value) ?? null)} className="mt-2 min-h-11 w-full border border-border bg-surface px-3 font-mono text-xs text-ink focus-visible:border-accent focus-visible:outline-none">
              <option value="">Selecione uma relação</option>
              {graph?.edges.map((edge) => {
                const source = graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source;
                const target = graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target;
                return <option key={edge.id} value={edge.id}>{source} → {target} · {edge.count}</option>;
              })}
            </select>
          </div>}
          {!selectedEdge && (graph?.edges.length ?? 0) > 0 && <div className="mt-8"><h2 className="font-display text-lg text-ink">Selecione uma ligação</h2><p className="mt-2 text-sm leading-6 text-ink-faint">Cada seta é uma afirmação verificável: um consumidor chamou o mesmo método e rota expostos por outro repositório.</p></div>}
          {!selectedEdge && (graph?.edges.length ?? 0) === 0 && <div className="mt-8"><h2 className="font-display text-lg text-ink">Nenhuma conexão confirmada</h2><p className="mt-2 text-sm leading-6 text-ink-faint">{(graph?.stats.indexedRepositories ?? 0) < project.repositories.length ? 'Indexe todos os repositórios para comparar seus contratos HTTP.' : 'Os índices estão prontos, mas nenhum método + rota compatível foi encontrado entre repositórios.'}</p></div>}
          {selectedEdge && <div className="mt-6">
            <p className="font-mono text-xs text-state-open">CONFIRMADO · {selectedEdge.count} match{selectedEdge.count === 1 ? '' : 'es'}</p>
            <div className="mt-5 max-h-[27rem] space-y-5 overflow-y-auto pr-2 [scrollbar-color:var(--color-border-strong)_transparent]">{selectedEdge.matches.map((match, index) => <article key={`${match.consumer.path}-${match.consumer.line}-${index}`} className="border-t border-border pt-4">
              <p className="font-mono text-xs font-semibold text-ink"><span className="text-accent">{match.method}</span> {match.route}</p>
              <dl className="mt-4 space-y-3 text-xs">
                <div><dt className="text-ink-faint">Consumidor</dt><dd className="mt-1 break-all font-mono leading-5 text-ink">{match.consumer.repoId}<br />{match.consumer.path}:{match.consumer.line}<br /><span className="text-ink-faint">{match.consumer.symbolName || 'símbolo não resolvido'} · {match.consumer.framework} · {match.consumer.sha.slice(0, 8)}</span></dd></div>
                <div><dt className="text-ink-faint">Provedor</dt><dd className="mt-1 break-all font-mono leading-5 text-ink">{match.provider.repoId}<br />{match.provider.path}:{match.provider.line}<br /><span className="text-ink-faint">{match.provider.symbolName || 'símbolo não resolvido'} · {match.provider.framework} · {match.provider.sha.slice(0, 8)}</span></dd></div>
              </dl>
            </article>)}</div>
          </div>}
        </aside>
      </section>

      <section className="mt-6 border-t border-border pt-6" aria-live="polite">
        <div className="flex items-center justify-between"><h2 className="font-display text-base font-semibold text-ink">Estado dos índices</h2><span className="font-mono text-[10px] text-ink-faint">branch padrão atual</span></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{project.repositories.map((repository) => {
          const item = status?.repositories.find((candidate) => candidate.repository === repository.fullName);
          return <div key={repository.id} className="flex items-center justify-between border border-border bg-surface-1 px-4 py-3"><span className="truncate font-mono text-xs text-ink">{repository.fullName}</span><span className={`ml-3 shrink-0 font-mono text-[9px] uppercase ${item?.status === 'indexed' && !item.stale ? 'text-state-open' : item?.status === 'error' ? 'text-state-closed' : 'text-ink-faint'}`}>{item ? statusLabel(item) : 'consultando'}</span></div>;
        })}</div>
      </section>
    </div>
  );
}
