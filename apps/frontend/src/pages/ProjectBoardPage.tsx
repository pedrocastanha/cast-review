import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { featureCardsApi } from '../api/feature-cards.api';
import { projectsApi } from '../api/projects.api';
import { BoardColumn } from '../components/cards/BoardColumn';
import { CardModal } from '../components/cards/CardModal';
import { CardEditor } from '../components/cards/CardEditor';
import { FeatureCardTile } from '../components/cards/FeatureCardTile';
import { blockingCards, groupCards, staleCardRepositories } from '../lib/feature-cards';
import type { Project, ProjectIndexStatus } from '../types';
import { CARD_COLUMNS, type CardContent, type CardStatus, type FeatureCard } from '../types/feature-cards';

const LAST_PROJECT_KEY = 'cast.board.project';

function readLastProject() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function ProjectBoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project') ?? '';

  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<FeatureCard[]>([]);
  const [status, setStatus] = useState<ProjectIndexStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState<{ cardId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [selectedId, setSelectedId] = useState('');
  const [featureId, setFeatureId] = useState('');
  const [search, setSearch] = useState('');
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [mobileStatus, setMobileStatus] = useState<CardStatus>('draft');
  const requestVersion = useRef(0);

  useEffect(() => {
    let active = true;
    projectsApi.list()
      .then((items) => { if (active) setProjects(items); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar projetos'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (projectId) {
      try { localStorage.setItem(LAST_PROJECT_KEY, projectId); } catch { /* armazenamento indisponível */ }
      return;
    }
    const last = readLastProject();
    if (last) setSearchParams({ project: last }, { replace: true });
  }, [projectId, setSearchParams]);

  const refresh = useCallback(async () => {
    if (!projectId) { setCards([]); setStatus(null); setNextCursor(null); return; }
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [indices, page] = await Promise.all([
        projectsApi.status(projectId).catch(() => null),
        featureCardsApi.list(projectId),
      ]);
      if (version === requestVersion.current) { setCards(page.items); setNextCursor(page.nextCursor); setStatus(indices); }
    } catch (err) {
      if (version === requestVersion.current) setError(err instanceof Error ? err.message : 'Falha ao carregar o board');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setCards([]); setSelectedId(''); setFeatureId(''); setSearch(''); setError(''); setActionError(null);
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  const groups = useMemo(() => groupCards(cards, featureId, search), [cards, featureId, search]);
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const selected = cards.find((card) => card.id === selectedId);
  const project = projects.find((item) => item.id === projectId);
  const activeCards = cards.filter((card) => card.active);
  const doneCount = activeCards.filter((card) => card.status === 'done').length;
  const staleRepos = (status?.repositories ?? []).filter((repo) => repo.stale || repo.status !== 'indexed').length;

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const page = await featureCardsApi.list(projectId, nextCursor);
      if (version !== requestVersion.current) return;
      setCards((current) => [...new Map([...current, ...page.items].map((card) => [card.id, card])).values()]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (version === requestVersion.current) setError(err instanceof Error ? err.message : 'Falha ao carregar mais cards');
    } finally {
      setLoadingMore(false);
    }
  }

  async function update(card: FeatureCard, patch: { status?: CardStatus; title?: string; content?: CardContent }) {
    if (mutation.current) return false;
    mutation.current = true; setBusy(true); setError('');
    setActionError((current) => current?.cardId === card.id ? null : current);
    try {
      const updated = await featureCardsApi.update(projectId, card.id, { version: card.version, ...patch });
      setCards((current) => current.map((item) => item.id === card.id ? updated : item));
      setActionError(null); // o board mudou: um erro de bloqueio pode ter deixado de valer
      return true;
    } catch (err) {
      setActionError({ cardId: card.id, message: err instanceof Error ? err.message : 'Falha ao salvar.' });
      return false;
    } finally {
      mutation.current = false; setBusy(false);
    }
  }

  async function archive(card: FeatureCard) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      await featureCardsApi.archive(projectId, card.id, card.version);
      setCards((current) => current.filter((item) => item.id !== card.id && item.parentId !== card.id));
      setSelectedId(''); if (featureId === card.id) setFeatureId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao arquivar');
    } finally {
      mutation.current = false; setBusy(false);
    }
  }

  function selectProject(id: string) {
    setSearchParams(id ? { project: id } : {});
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.18em] text-ink-faint uppercase">Board · plano de execução</p>
          <h1 className="mt-2 truncate text-3xl font-bold">{project?.name ?? (projectId ? 'Projeto' : 'Nenhum projeto selecionado')}</h1>
          {projectId && (
            <p className="font-mono mt-2 text-[11px] tabular-nums text-ink-dim">
              {activeCards.length} cards · {doneCount} concluídos · {status?.repositories.length ?? 0} repositórios
              {staleRepos > 0 && <span className="text-warn"> · {staleRepos} com índice a reavaliar</span>}
            </p>
          )}
        </div>
        {projectId && (
          <Link
            to={`/chat?project=${projectId}&profile=requirements`}
            className="inline-flex min-h-11 shrink-0 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Planejar feature no Cast →
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-y border-border py-3">
        <label className="grid gap-1 text-xs text-ink-dim">
          Projeto
          <select
            value={projectId}
            onChange={(event) => selectProject(event.target.value)}
            className="min-h-11 max-w-64 rounded-sm border border-border bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">Selecione um projeto</option>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {projectId && (
          <>
            <label className="grid gap-1 text-xs text-ink-dim">
              Feature
              <select
                value={featureId}
                onChange={(event) => setFeatureId(event.target.value)}
                className="min-h-11 max-w-64 rounded-sm border border-border bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">Todas as features</option>
                {cards.filter((card) => !card.parentId && card.active).map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-ink-dim">
              Buscar
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Título ou área"
                className="min-h-11 rounded-sm border border-border bg-surface-1 px-3 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => { setError(''); setSelectedId(''); void refresh(); }}
              className="font-mono ml-auto min-h-11 text-[11px] tracking-[0.14em] text-ink-dim uppercase transition-colors hover:text-ink disabled:opacity-40"
            >
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
          </>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-warn">{error}</p>}

      {!projectId ? (
        <div className="max-w-[62ch] py-10">
          <h2 className="text-xl font-semibold">O board pertence a um projeto.</h2>
          <p className="mt-3 text-sm leading-6 text-ink-dim">
            Cada projeto tem seu próprio plano de execução, com os cards ancorados nos repositórios indexados daquele escopo.
            Escolha um projeto acima — o Cast lembra o último que você abriu.
          </p>
          <Link to="/projects" className="font-mono mt-5 inline-flex min-h-11 items-center text-[11px] tracking-[0.14em] text-accent uppercase">
            Ver projetos →
          </Link>
        </div>
      ) : loading && !cards.length ? (
        <p role="status" className="font-mono py-10 text-[11px] tracking-[0.14em] text-ink-faint uppercase">Carregando cards…</p>
      ) : !cards.length ? (
        <div className="max-w-[62ch] py-10">
          <h2 className="text-xl font-semibold">A próxima feature começa com uma conversa.</h2>
          <p className="mt-3 text-sm leading-6 text-ink-dim">
            Selecione o perfil Requisitos no chat deste projeto, descreva sua ideia e salve a proposta. O Cast organiza as
            responsabilidades em cards e preserva as evidências da investigação.
          </p>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="min-w-0">
            <nav aria-label="Etapas do board" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 md:hidden">
              {CARD_COLUMNS.map((column) => (
                <button
                  key={column.status}
                  type="button"
                  onClick={() => setMobileStatus(column.status)}
                  aria-current={mobileStatus === column.status}
                  className={`font-mono min-h-11 shrink-0 rounded-sm border px-3 text-[11px] tracking-[0.12em] uppercase transition-colors ${
                    mobileStatus === column.status ? 'border-accent text-ink' : 'border-border text-ink-faint'
                  }`}
                >
                  {column.label} <span className="tabular-nums">{groups[column.status].length}</span>
                </button>
              ))}
            </nav>

            <div className="flex flex-col gap-6 md:flex-row md:gap-5 md:overflow-x-auto md:pb-4">
              {CARD_COLUMNS.map((column) => (
                <BoardColumn
                  key={column.status}
                  status={column.status}
                  label={column.label}
                  hint={column.hint}
                  count={groups[column.status].length}
                  collapsed={column.status === 'done' && doneCollapsed}
                  hidden={mobileStatus !== column.status}
                  dropActive={dropTarget === column.status}
                  onToggle={column.status === 'done' ? () => setDoneCollapsed((value) => !value) : undefined}
                  onDragOver={() => setDropTarget(column.status)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(cardId) => {
                    setDropTarget(null);
                    const dragged = cards.find((item) => item.id === cardId);
                    if (dragged && dragged.status !== column.status) void update(dragged, { status: column.status });
                  }}
                >
                  {groups[column.status].map((card) => (
                    <FeatureCardTile
                      key={card.id}
                      card={card}
                      parentTitle={card.parentId ? byId.get(card.parentId)?.title : undefined}
                      blockedBy={blockingCards(card, byId).map((dependency) => dependency.title)}
                      stale={staleCardRepositories(card, status)}
                      selected={selectedId === card.id}
                      busy={busy}
                      error={actionError?.cardId === card.id ? actionError.message : undefined}
                      onSelect={() => setSelectedId(card.id === selectedId ? '' : card.id)}
                      onMove={(next) => void update(card, { status: next })}
                    />
                  ))}
                </BoardColumn>
              ))}
            </div>

            {nextCursor && (
              <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-border pt-4">
                <p className="font-mono text-[11px] tabular-nums text-ink-faint">
                  {cards.length} cards carregados · filtros consideram o que já foi carregado
                </p>
                <button
                  type="button"
                  disabled={loadingMore || loading || busy}
                  onClick={() => void loadMore()}
                  className="font-mono min-h-11 text-[11px] tracking-[0.14em] text-accent uppercase disabled:opacity-40"
                >
                  {loadingMore ? 'Carregando…' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>

          {selected && (
            <CardModal
              key={selected.id}
              label={selected.title}
              eyebrow={`${selected.area} · versão ${selected.version} · ${CARD_COLUMNS.find((column) => column.status === selected.status)?.label ?? ''}`}
              onClose={() => setSelectedId('')}
            >
              <CardEditor
                card={selected}
                cards={cards}
                stale={staleCardRepositories(selected, status)}
                busy={busy}
                error={actionError?.cardId === selected.id ? actionError.message : undefined}
                onMove={(next) => void update(selected, { status: next })}
                onSave={(title, content) => update(selected, { title, content })}
                onArchive={() => void archive(selected)}
              />
            </CardModal>
          )}
        </div>
      )}
    </div>
  );
}
