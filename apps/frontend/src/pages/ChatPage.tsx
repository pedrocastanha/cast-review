import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { projectsApi } from '../api/projects.api';
import { ProposalPreview } from '../components/cards/ProposalPreview';
import type { Project } from '../types';
import { chatApi, type CreateChatThreadPayload } from '../api/chat.api';
import { Composer } from '../components/chat/Composer';
import { MessageTurn } from '../components/chat/MessageTurn';
import { ThreadList } from '../components/chat/ThreadList';
import { ToolTrace } from '../components/chat/ToolTrace';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_AI_MODEL } from '../lib/ai-models';
import type {
  ChatEvent,
  ChatMention,
  ChatThread,
  ChatToolCallRecord,
} from '../types';

const SUGGESTIONS = [
  'Quais repositórios indexados podem responder sobre autenticação?',
  'Onde o sistema trata erros de banco?',
  'Compare como dois repositórios expõem suas APIs.',
];

interface LiveState {
  answer: string;
  calls: ChatToolCallRecord[];
  running: boolean;
}

const IDLE: LiveState = { answer: '', calls: [], running: false };

export function ChatPage() {
  const { user } = useAuth();
  const { owner, repo } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project') ?? '';
  const [projects, setProjects] = useState<Project[]>([]);
  const [assistanceMode, setAssistanceMode] = useState<'general' | 'requirements'>(searchParams.get('profile') === 'requirements' ? 'requirements' : 'general');
  const repoId = owner && repo ? `${owner}/${repo}` : null;
  const scopeMode = projectId ? 'project' : repoId ? 'repository' : 'global';
  const scope = useMemo<CreateChatThreadPayload>(
    () =>
      projectId ? { mode: 'project', projectId } : repoId
        ? { mode: 'repository', repoId }
        : { mode: 'global' },
    [repoId, projectId],
  );
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [live, setLive] = useState<LiveState>(IDLE);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const conversationVersion = useRef(0);
  const sending = useRef(false);

  const refreshThreads = useCallback(async () => {
    const version = conversationVersion.current;
    try {
      const listed = await chatApi.list(projectId ? { projectId } : repoId ? { repoId } : {});
      if (version !== conversationVersion.current) return;
      setThreads(
        projectId ? listed.filter((candidate) => candidate.projectId === projectId) : repoId
          ? listed.filter(
              (candidate) =>
                candidate.scope.mode === 'repository' &&
                candidate.repoId === repoId,
            )
          : listed.filter((candidate) => candidate.scope.mode === 'global'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao listar conversas');
    }
  }, [repoId, projectId]);

  useEffect(() => {
    let active = true;
    projectsApi.list().then((items) => { if (active) setProjects(items); }).catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar projetos'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    conversationVersion.current += 1;
    sending.current = false;
    setThread(null);
    setLive(IDLE);
    void refreshThreads();
  }, [refreshThreads]);

  useEffect(() => () => { abortRef.current?.abort(); conversationVersion.current += 1; }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [thread?.messages.length, live.answer, live.calls.length]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    pinnedRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  };

  const openThread = useCallback(async (id: string) => {
    abortRef.current?.abort();
    sending.current = false;
    const version = ++conversationVersion.current;
    setLive(IDLE);
    setError(null);
    try {
      const opened = await chatApi.get(id);
      if (version !== conversationVersion.current) return null;
      const belongsHere = projectId ? opened.projectId === projectId : repoId
        ? opened.scope.mode === 'repository' && opened.repoId === repoId
        : opened.scope.mode === 'global';
      if (!belongsHere) throw new Error('Conversa fora deste escopo');
      setThread(opened);
      const latestModel = [...opened.messages]
        .reverse()
        .find((message) => message.model)?.model;
      if (latestModel) setModel(latestModel);
      pinnedRef.current = true;
      return opened;
    } catch (err) {
      if (version !== conversationVersion.current) return null;
      setError(err instanceof Error ? err.message : 'Falha ao abrir conversa');
      return null;
    }
  }, [projectId, repoId]);

  const initialThreadId = searchParams.get('thread');
  useEffect(() => { if (initialThreadId) void openThread(initialThreadId); }, [initialThreadId, openThread]);

  const startThread = async () => {
    if (sending.current || creating) return;
    const version = ++conversationVersion.current;
    setCreating(true);
    setError(null);
    try {
      const created = await chatApi.create(scope);
      if (version !== conversationVersion.current) return;
      setThread(created);
      setLive(IDLE);
      setModel(DEFAULT_AI_MODEL);
      await refreshThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar conversa');
    } finally {
      setCreating(false);
    }
  };

  const removeThread = async (id: string) => {
    if (thread?.id === id) {
      abortRef.current?.abort();
      conversationVersion.current += 1;
      sending.current = false;
      setLive(IDLE);
    }
    try {
      await chatApi.remove(id);
      if (thread?.id === id) setThread(null);
      await refreshThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao apagar conversa');
    }
  };

  const applyEvent = (event: ChatEvent) => {
    if (event.type === 'token') {
      const delta = String(event.payload.delta ?? '');
      setLive((current) => ({ ...current, answer: current.answer + delta }));
      return;
    }
    if (event.type === 'tool_result') {
      setLive((current) => ({
        ...current,
        calls: [
          ...current.calls,
          event.payload as unknown as ChatToolCallRecord,
        ],
      }));
      return;
    }
    if (event.type === 'error') {
      setError(String(event.payload.message ?? 'Falha no chat'));
    }
  };

  const send = async (
    content: string,
    mentions: ChatMention[],
    repositoryHint: string | null,
  ) => {
    if (sending.current || creating) return;
    let target = thread;
    const selectedModel = model.trim();
    if (assistanceMode === 'requirements' && !projectId) {
      setError('Selecione um projeto para planejar uma feature.');
      return;
    }
    if (!selectedModel) {
      setError('Informe um modelo de IA.');
      return;
    }

    const version = ++conversationVersion.current;
    sending.current = true;
    setLive({ answer: '', calls: [], running: true });

    if (!target) {
      try {
        target = await chatApi.create(scope);
        if (version !== conversationVersion.current) return;
        setThread(target);
        await refreshThreads();
      } catch (err) {
        if (version !== conversationVersion.current) return;
        sending.current = false;
        setLive(IDLE);
        setError(err instanceof Error ? err.message : 'Falha ao criar conversa');
        return;
      }
    }

    setError(null);
    pinnedRef.current = true;
    const pendingModel = selectedModel;
    setThread((current) =>
      current
        ? {
            ...current,
            messages: [
              ...current.messages,
              {
                id: `pending-${Date.now()}`,
                role: 'user',
                content,
                model: pendingModel,
                mentions,
                toolCalls: [],
                citations: [],
                usage: null,
                truncated: false,
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : current,
    );
    setLive({ answer: '', calls: [], running: true });

    const controller = new AbortController();
    abortRef.current = controller;
    let failure: string | null = null;

    try {
      for await (const event of chatApi.sendMessage(
        target.id,
        {
          content,
          mentions,
          model: selectedModel,
          assistanceMode,
          ...(repositoryHint ? { repositoryHint } : {}),
        },
        controller.signal,
      )) {
        if (version !== conversationVersion.current) return;
        if (event.type === 'error') failure = String(event.payload.message ?? 'Falha no chat');
        applyEvent(event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        failure = err instanceof Error ? err.message : 'Falha ao responder';
      }
    } finally {
      if (version !== conversationVersion.current) return;
      sending.current = false;
      abortRef.current = null;
      setLive(IDLE);
      const reopened = await openThread(target.id);
      if (failure) setError(failure);
      if (reopened) await refreshThreads();
    }
  };

  const stale = thread?.staleRepositories ?? [];
  const shaByRepo = Object.fromEntries(
    (thread?.scope.repositories ?? [])
      .filter((repository) => repository.sha)
      .map((repository) => [repository.repoId, repository.sha as string]),
  );
  const missingKey = user ? !user.openaiConnected : false;
  const empty = !thread || thread.messages.length === 0;

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row ${
        repoId
          ? 'h-[calc(100dvh-15rem)] min-h-[38rem] rounded-lg border border-border bg-surface'
          : ''
      }`}
    >
      <aside className="flex shrink-0 flex-col gap-3 border-b border-border bg-surface/60 p-3 lg:h-full lg:w-[17rem] lg:border-r lg:border-b-0">
        <div className="px-2 pt-1">
          <p className="font-mono text-[9px] tracking-[0.14em] text-ink-faint uppercase">
            {projectId ? 'Chat do projeto' : repoId ? 'Chat do repositório' : 'Chat global'}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-ink-dim">
            {projects.find((p) => p.id === projectId)?.name ?? repoId ?? 'consulta sob demanda'}
          </p>
        </div>

        <button
          type="button"
          onClick={startThread}
          disabled={creating || live.running}
          className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm font-semibold text-ink transition-colors hover:border-ink-faint hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nova conversa
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto lg:pb-2">
          <ThreadList
            threads={threads}
            activeId={thread?.id ?? null}
            onOpen={(id) => void openThread(id)}
            onRemove={(id) => void removeThread(id)}
          />
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-6 py-3">
          <label className="grid gap-1 text-xs text-ink-dim">Perfil
            <select aria-label="Perfil de assistência" disabled={live.running} value={assistanceMode} onChange={(e) => setAssistanceMode(e.target.value as 'general' | 'requirements')} className="min-h-10 rounded border border-border bg-surface-1 px-3 text-sm text-ink">
              <option value="general">Geral</option><option value="requirements">Requisitos</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-dim">Projeto
            <select aria-label="Projeto da conversa" disabled={live.running} value={projectId} onChange={(e) => setSearchParams(e.target.value ? { project: e.target.value, profile: assistanceMode } : {})} className="min-h-10 max-w-64 rounded border border-border bg-surface-1 px-3 text-sm text-ink">
              <option value="">{repoId ? 'Somente este repositório' : 'Sem projeto selecionado'}</option>
              {projects.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
            </select>
          </label>
          {projectId && <Link to={`/projects/${projectId}/board`} className="ml-auto py-3 text-sm font-semibold text-accent">Kanban →</Link>}
        </div>
        {(missingKey || error || stale.length > 0) && (
          <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
            {missingKey && (
              <p className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
                Nenhuma chave da OpenAI configurada.{' '}
                <Link to="/settings" className="underline underline-offset-2">
                  Configurar agora
                </Link>
                .
              </p>
            )}
            {error && (
              <p className="flex items-start justify-between gap-3 rounded-md border border-state-closed/40 bg-state-closed-dim px-3 py-2 text-[13px] text-ink">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Fechar aviso"
                  className="shrink-0 cursor-pointer text-ink-faint hover:text-ink"
                >
                  ×
                </button>
              </p>
            )}
            {stale.length > 0 && (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-ink-dim">
                Índice mais novo disponível para {stale.join(', ')}. Esta conversa
                usa o commit congelado quando foi criada.
              </p>
            )}
          </div>
        )}

        {empty ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
            <div className="w-full max-w-[52rem]">
              <div className="mx-auto mb-5 grid size-10 place-items-center rounded-xl border border-border-strong bg-surface-1 font-mono text-sm text-accent shadow-card">
                {repoId ? '&gt;_' : '/_'}
              </div>
              <h1 className="text-center font-display text-2xl leading-tight font-bold text-ink sm:text-3xl">
                {assistanceMode === 'requirements' ? 'Da ideia ao plano de execução' : repoId
                  ? `Explore ${repo}`
                  : 'Pergunte sobre qualquer repositório indexado'}
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-center text-[14px] leading-6 text-ink-dim">
                {assistanceMode === 'requirements' ? 'Descreva a feature. O Cast investiga as áreas afetadas e prepara uma proposta de cards com critérios e evidências.' : repoId
                  ? 'O commit indexado fica congelado nesta conversa, com evidências verificáveis.'
                  : 'A IA descobre repositórios somente quando precisa. Comece com / para indicar um específico.'}
              </p>

              <div className="mt-7">
                <Composer
                  threadId={thread?.id ?? null}
                  scopeMode={scopeMode}
                  disabled={live.running || missingKey}
                  model={model}
                  onModelChange={setModel}
                  autoFocus
                  onSubmit={send}
                />
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {(assistanceMode === 'requirements' ? ['Quero notificar o usuário quando uma análise terminar.', 'Quero planejar uma feature. Ajude a definir escopo, regras e critérios.'] : SUGGESTIONS).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={missingKey || live.running}
                    onClick={() => void send(suggestion, [], null)}
                    className="cursor-pointer rounded-full border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="min-h-0 flex-1 overflow-y-auto px-6 py-8"
            >
              <div className="mx-auto flex w-full max-w-[58rem] flex-col gap-8">
                {thread.messages.map((message) => (
                  <div key={message.id}>
                  <MessageTurn
                    message={message}
                    shaByRepo={shaByRepo}
                  />
                  {message.proposal && projectId && <ProposalPreview proposal={message.proposal} projectId={projectId} messageId={message.id} shaByRepo={shaByRepo} />}
                  </div>
                ))}

                {live.running && (
                  <article className="rounded-xl border border-border bg-surface-sunk px-5 py-5 text-[15.5px] leading-[1.75] text-ink">
                    {live.answer ? (
                      <span className="whitespace-pre-wrap">{live.answer}</span>
                    ) : (
                      <span className="font-mono text-[12px] text-ink-faint">
                        investigando o índice…
                      </span>
                    )}
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-caret bg-accent"
                    />
                    <ToolTrace calls={live.calls} running />
                  </article>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-surface/95 px-6 py-4">
              <div className="mx-auto w-full max-w-[58rem]">
                <Composer
                  threadId={thread.id}
                  scopeMode={scopeMode}
                  disabled={live.running || missingKey}
                  model={model}
                  onModelChange={setModel}
                  onSubmit={send}
                />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
