import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { chatApi, type CreateChatThreadPayload } from '../api/chat.api';
import { Composer } from '../components/chat/Composer';
import { MessageTurn } from '../components/chat/MessageTurn';
import { ScopePicker } from '../components/chat/ScopePicker';
import { ThreadList } from '../components/chat/ThreadList';
import { ToolTrace } from '../components/chat/ToolTrace';
import { useAuth } from '../context/AuthContext';
import type {
  ChatEvent,
  ChatMention,
  ChatThread,
  ChatToolCallRecord,
} from '../types';

const DEFAULT_MODEL = 'gpt-4o';

const SUGGESTIONS = [
  'Como funciona o fluxo de autenticação?',
  'Quais endpoints o backend expõe?',
  'Onde esse projeto trata erro de banco?',
];

interface LiveState {
  answer: string;
  calls: ChatToolCallRecord[];
  running: boolean;
}

const IDLE: LiveState = { answer: '', calls: [], running: false };

function initialScope(params: URLSearchParams): CreateChatThreadPayload | null {
  const repoId = params.get('repoId');
  if (repoId) return { mode: 'repository', repoId };
  const projectId = params.get('projectId');
  if (projectId) return { mode: 'project', projectId };
  return null;
}

export function ChatPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [scope, setScope] = useState<CreateChatThreadPayload | null>(() =>
    initialScope(params),
  );
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [live, setLive] = useState<LiveState>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await chatApi.list({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao listar conversas');
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const openThread = async (id: string) => {
    setLive(IDLE);
    try {
      const opened = await chatApi.get(id);
      setThread(opened);
      setScope(
        opened.scope.mode === 'project' && opened.projectId
          ? { mode: 'project', projectId: opened.projectId }
          : opened.repoId
            ? { mode: 'repository', repoId: opened.repoId }
            : scope,
      );
      pinnedRef.current = true;
      return opened;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir conversa');
      return null;
    }
  };

  const startThread = async () => {
    if (!scope) {
      setError('Escolha um repositório ou projeto primeiro.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      setThread(await chatApi.create(scope));
      setLive(IDLE);
      await refreshThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar conversa');
    } finally {
      setCreating(false);
    }
  };

  const removeThread = async (id: string) => {
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
    if (event.type === 'tool_call') {
      setLive((current) => ({ ...current, answer: '' }));
      return;
    }
    if (event.type === 'tool_result') {
      setLive((current) => ({
        ...current,
        calls: [...current.calls, event.payload as unknown as ChatToolCallRecord],
      }));
      return;
    }
    if (event.type === 'error') {
      setError(String(event.payload.message ?? 'Falha no chat'));
    }
  };

  const send = async (content: string, mentions: ChatMention[]) => {
    let target = thread;

    if (!target) {
      if (!scope) {
        setError('Escolha um repositório ou projeto primeiro.');
        return;
      }
      try {
        target = await chatApi.create(scope);
        setThread(target);
        await refreshThreads();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao criar conversa');
        return;
      }
    }

    setError(null);
    pinnedRef.current = true;
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
        { content, mentions, model: DEFAULT_MODEL },
        controller.signal,
      )) {
        applyEvent(event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        failure = err instanceof Error ? err.message : 'Falha ao responder';
      }
    } finally {
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
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-3 border-b border-border p-3 lg:h-full lg:w-[17rem] lg:border-r lg:border-b-0">
        <ScopePicker scope={scope} onChange={setScope} />

        <button
          type="button"
          onClick={startThread}
          disabled={creating || !scope}
          className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm font-semibold text-ink transition-colors hover:border-ink-faint hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                responde sobre o commit indexado quando foi criada.
              </p>
            )}
          </div>
        )}

        {empty ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
            <div className="w-full max-w-[46rem]">
              <h1 className="text-center font-display text-2xl leading-tight font-bold text-ink sm:text-3xl">
                O que você quer entender do código?
              </h1>
              <p className="mt-2 text-center text-[14px] leading-6 text-ink-dim">
                {scope
                  ? 'As respostas saem do índice, com arquivo e linha clicáveis.'
                  : 'Escolha um repositório ou projeto à esquerda para começar.'}
              </p>

              <div className="mt-7">
                <Composer
                  threadId={thread?.id ?? null}
                  disabled={live.running || !scope || missingKey}
                  autoFocus
                  onSubmit={send}
                />
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={!scope || missingKey || live.running}
                    onClick={() => void send(suggestion, [])}
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
              className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
            >
              <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-7">
                {thread.messages.map((message) => (
                  <MessageTurn
                    key={message.id}
                    message={message}
                    shaByRepo={shaByRepo}
                  />
                ))}

                {live.running && (
                  <article className="text-[15px] leading-7 text-ink">
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

            <div className="shrink-0 border-t border-border px-4 py-3">
              <div className="mx-auto w-full max-w-[46rem]">
                <Composer
                  threadId={thread.id}
                  disabled={live.running || missingKey}
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
