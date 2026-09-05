import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { featureCardsApi } from '../api/feature-cards.api';
import { projectsApi } from '../api/projects.api';
import { CardEditor } from '../components/cards/CardEditor';
import { groupCards, staleCardRepositories } from '../lib/feature-cards';
import type { ProjectIndexStatus } from '../types';
import { CARD_COLUMNS, type CardContent, type CardStatus, type FeatureCard } from '../types/feature-cards';

export function ProjectBoardPage() {
  const { id: projectId = '' } = useParams();
  const [cards, setCards] = useState<FeatureCard[]>([]);
  const [name, setName] = useState('Projeto');
  const [status, setStatus] = useState<ProjectIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [selectedId, setSelectedId] = useState('');
  const [featureId, setFeatureId] = useState('');
  const [search, setSearch] = useState('');
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [project, indices] = await Promise.all([projectsApi.get(projectId), projectsApi.status(projectId).catch(() => null)]);
      const page = await featureCardsApi.list(projectId);
      if (version === requestVersion.current) { setCards(page.items); setNextCursor(page.nextCursor); setName(project.name); setStatus(indices); }
    } catch (err) { if (version === requestVersion.current) setError(err instanceof Error ? err.message : 'Falha ao carregar Kanban'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [projectId]);

  useEffect(() => { setCards([]); setSelectedId(''); setFeatureId(''); setError(''); void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  const groups = useMemo(() => groupCards(cards, featureId, search), [cards, featureId, search]);
  const selected = cards.find((card) => card.id === selectedId);
  const names = useMemo(() => new Map(cards.map((card) => [card.id, card.title])), [cards]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const page = await featureCardsApi.list(projectId, nextCursor);
      if (version !== requestVersion.current) return;
      setCards((current) => [...new Map([...current, ...page.items].map((card) => [card.id, card])).values()]);
      setNextCursor(page.nextCursor);
    } catch (err) { if (version === requestVersion.current) setError(err instanceof Error ? err.message : 'Falha ao carregar mais cards'); }
    finally { setLoadingMore(false); }
  }

  async function update(card: FeatureCard, patch: { status?: CardStatus; title?: string; content?: CardContent }) {
    if (mutation.current) return false;
    mutation.current = true; setBusy(true); setError('');
    try {
      const updated = await featureCardsApi.update(projectId, card.id, { version: card.version, ...patch });
      setCards((current) => current.map((item) => item.id === card.id ? updated : item));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
      return false;
    } finally { mutation.current = false; setBusy(false); }
  }

  async function archive(card: FeatureCard) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      await featureCardsApi.archive(projectId, card.id, card.version);
      setCards((current) => current.filter((item) => item.id !== card.id && item.parentId !== card.id));
      setSelectedId(''); if (featureId === card.id) setFeatureId('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao arquivar'); }
    finally { mutation.current = false; setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><Link to={`/projects/${projectId}`} className="text-xs text-ink-dim">← {name}</Link><h1 className="mt-2 font-display text-3xl font-bold">Plano de execução</h1><p className="mt-2 text-sm text-ink-dim">Features, responsabilidades e decisões conectadas ao código.</p></div>
        <Link to={`/chat?project=${projectId}&profile=requirements`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">Planejar feature no Cast →</Link>
      </header>
      <div className="flex flex-wrap items-end gap-4 border-y border-border py-4">
        <label className="grid gap-1 text-xs text-ink-dim">Feature<select value={featureId} onChange={(e) => setFeatureId(e.target.value)} className="min-h-11 max-w-72 rounded border border-border bg-surface-1 px-3 text-sm text-ink"><option value="">Todas as features</option>{cards.filter((card) => !card.parentId).map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-ink-dim">Buscar<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Título ou área" className="min-h-11 rounded border border-border bg-surface-1 px-3 text-sm text-ink" /></label>
        <button type="button" disabled={loading || busy} onClick={() => { setError(''); setSelectedId(''); void refresh(); }} className="ml-auto min-h-11 text-sm text-ink-dim">Atualizar board</button>
      </div>
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      {nextCursor && <div className="flex flex-wrap items-center gap-4 text-sm"><p className="text-ink-dim">{cards.length} cards carregados. Filtros consideram os cards carregados.</p><button type="button" disabled={loadingMore || loading || busy} onClick={() => void loadMore()} className="min-h-11 text-accent">{loadingMore ? 'Carregando…' : 'Carregar mais cards'}</button></div>}
      {loading ? <p role="status" className="py-10 text-sm text-ink-dim">Carregando cards…</p> : cards.length === 0 ? (
        <div className="max-w-xl py-12"><h2 className="font-display text-xl font-semibold">A próxima feature começa com uma conversa.</h2><p className="mt-3 text-sm leading-6 text-ink-dim">Selecione o perfil Requisitos no chat deste projeto, descreva sua ideia e salve a proposta. O Cast organiza as responsabilidades em cards e preserva as evidências da investigação.</p></div>
      ) : (
        <div className={selected ? 'grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]' : ''}>
          <div className="min-w-0 overflow-x-auto pb-4">
            <div className="grid min-w-[68rem] grid-cols-5 gap-3">
              {CARD_COLUMNS.map((column) => (
                <section key={column.status} aria-label={column.label}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(column.status); }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => { e.preventDefault(); setDropTarget(null); const card = cards.find((c) => c.id === e.dataTransfer.getData('text/plain')); if (card && card.status !== column.status) void update(card, { status: column.status }); }}
                  className={`min-h-80 rounded-md border p-3 ${dropTarget === column.status ? 'border-accent bg-accent/5' : 'border-border bg-surface-sunk'}`}>
                  <h2 className="mb-4 flex items-center justify-between text-sm font-semibold">{column.label}<span className="text-xs font-normal text-ink-faint">{groups[column.status].length}</span></h2>
                  <div className="space-y-3">{groups[column.status].map((card) => (
                    <article key={card.id} draggable={!busy} onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)} className={`rounded border bg-surface-1 p-3 ${selectedId === card.id ? 'border-accent' : 'border-border'}`}>
                      <p className="text-[11px] text-ink-faint">{card.area}{!card.parentId && ' · principal'}</p>
                      <button type="button" onClick={() => setSelectedId(card.id)} className="mt-2 min-h-11 w-full text-left text-sm font-semibold leading-5 hover:text-accent">{card.title}</button>
                      {card.parentId && <p className="mt-2 truncate text-xs text-ink-faint" title={names.get(card.parentId)}>{names.get(card.parentId)}</p>}
                      <div className="mt-3 space-y-1 text-[11px] text-ink-dim">
                        <p>{card.content.acceptanceCriteria.length} critérios · {card.dependsOn.length} dependências</p>
                        {card.content.openQuestions.length > 0 && <p className="text-warn">{card.content.openQuestions.length} decisões pendentes</p>}
                        {staleCardRepositories(card, status).length > 0 && <p className="text-warn">Reavaliar contexto</p>}
                      </div>
                      <div className="mt-3"><select aria-label={`Mover ${card.title}`} disabled={busy} value={card.status} onChange={(e) => void update(card, { status: e.target.value as CardStatus })} className="min-h-10 w-full rounded border border-border bg-surface px-2 text-xs text-ink-dim">{CARD_COLUMNS.map((option) => <option key={option.status} value={option.status}>{option.label}</option>)}</select></div>
                    </article>
                  ))}</div>
                  {!groups[column.status].length && <p className="pt-5 text-center text-xs text-ink-faint">Nenhum card nesta etapa</p>}
                </section>
              ))}
            </div>
          </div>
          {selected && <CardEditor key={selected.id} card={selected} cards={cards} stale={staleCardRepositories(selected, status)} busy={busy} onClose={() => setSelectedId('')} onSave={(title, content) => update(selected, { title, content })} onArchive={() => void archive(selected)} />}
        </div>
      )}
    </div>
  );
}
