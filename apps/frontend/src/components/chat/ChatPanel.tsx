import { useCallback, useEffect, useRef, useState } from 'react';
import { chatApi, type CreateChatThreadPayload } from '../../api/chat.api';
import { openaiKeyStore } from '../../api/openai-key-store';
import type {
  ChatEvent,
  ChatMention,
  ChatMessage,
  ChatThread,
  ChatToolCallRecord,
} from '../../types';
import { CitationList } from './CitationList';
import { MentionInput } from './MentionInput';
import { ToolTrace } from './ToolTrace';

const DEFAULT_MODEL = 'gpt-4o';

interface ChatPanelProps {
  scope: CreateChatThreadPayload;
  emptyHint: string;
}

interface LiveState {
  answer: string;
  calls: ChatToolCallRecord[];
  running: boolean;
}

const IDLE: LiveState = { answer: '', calls: [], running: false };

function MessageBubble({
  message,
  shaByRepo,
}: {
  message: ChatMessage;
  shaByRepo: Record<string, string>;
}) {
  const isUser = message.role === 'user';

  return (
    <article
      className={`rounded-sm border px-4 py-3 ${
        isUser
          ? 'border-border bg-surface-2'
          : 'border-border-strong bg-surface-1'
      }`}
    >
      <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink-faint uppercase">
        {isUser ? 'você' : 'cast'}
        {message.truncated && ' · investigação truncada'}
      </p>
      <div className="mt-2 text-sm leading-6 whitespace-pre-wrap text-ink">
        {message.content}
      </div>
      {!isUser && <ToolTrace calls={message.toolCalls} />}
      {!isUser && (
        <CitationList citations={message.citations} shaByRepo={shaByRepo} />
      )}
      {!isUser && message.usage && (
        <p className="mt-2 font-mono text-[10.5px] text-ink-faint">
          {message.usage.promptTokens + message.usage.completionTokens} tokens · US$
          {message.usage.costUsd.toFixed(4)}
        </p>
      )}
    </article>
  );
}

export function ChatPanel({ scope, emptyHint }: ChatPanelProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [live, setLive] = useState<LiveState>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const repoId = scope.mode === 'repository' ? scope.repoId : undefined;
  const projectId = scope.mode === 'project' ? scope.projectId : undefined;

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await chatApi.list({ repoId, projectId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao listar conversas');
    }
  }, [repoId, projectId]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages.length, live.answer]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const openThread = async (id: string) => {
    setError(null);
    setLive(IDLE);
    try {
      setThread(await chatApi.get(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir conversa');
    }
  };

  const startThread = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await chatApi.create(scope);
      setThread(created);
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

  const send = async (content: string, mentions: ChatMention[]) => {
    if (!thread) return;
    const openai = openaiKeyStore.get();
    if (!openai) {
      setError('Configure sua chave OpenAI em Configurações antes de conversar.');
      return;
    }

    setError(null);
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

    try {
      for await (const event of chatApi.sendMessage(
        thread.id,
        { content, mentions, model: DEFAULT_MODEL, apiKeys: { openai } },
        controller.signal,
      )) {
        applyEvent(event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Falha ao responder');
      }
    } finally {
      setLive((current) => ({ ...current, running: false }));
      abortRef.current = null;
      await openThread(thread.id);
      await refreshThreads();
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

  const stale = thread?.staleRepositories ?? [];
  const shaByRepo = Object.fromEntries(
    (thread?.scope.repositories ?? [])
      .filter((repository) => repository.sha)
      .map((repository) => [repository.repoId, repository.sha as string]),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-2">
        <button
          type="button"
          onClick={startThread}
          disabled={creating}
          className="min-h-11 w-full cursor-pointer rounded-sm border border-border-strong bg-surface-1 px-3 text-sm font-semibold text-ink transition-colors hover:border-ink-faint hover:bg-surface-2 disabled:opacity-50"
        >
          Nova conversa
        </button>

        <ul className="space-y-1">
          {threads.map((item) => (
            <li key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => openThread(item.id)}
                className={`min-h-11 flex-1 cursor-pointer truncate rounded-sm px-3 text-left text-sm transition-colors ${
                  thread?.id === item.id
                    ? 'bg-surface-2 text-ink'
                    : 'text-ink-dim hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {item.title}
              </button>
              <button
                type="button"
                aria-label={`Apagar ${item.title}`}
                onClick={() => removeThread(item.id)}
                className="min-h-11 cursor-pointer px-2 text-ink-faint transition-colors hover:text-warn"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0">
        {error && (
          <p className="mb-4 rounded-sm border border-warn/45 bg-warn-soft px-3 py-2 text-sm text-warn">
            {error}
          </p>
        )}

        {stale.length > 0 && (
          <p className="mb-4 rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-ink-dim">
            Índice mais novo disponível para {stale.join(', ')}. Esta conversa
            responde sobre o commit indexado quando ela foi criada.
          </p>
        )}

        {!thread ? (
          <p className="text-sm leading-6 text-ink-dim">{emptyHint}</p>
        ) : (
          <div className="space-y-3">
            {thread.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                shaByRepo={shaByRepo}
              />
            ))}

            {live.running && (
              <article className="rounded-sm border border-border-strong bg-surface-1 px-4 py-3">
                <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink-faint uppercase">
                  cast · respondendo
                </p>
                <div className="mt-2 text-sm leading-6 whitespace-pre-wrap text-ink">
                  {live.answer || '…'}
                </div>
                <ToolTrace calls={live.calls} />
              </article>
            )}

            <div ref={bottomRef} />

            <MentionInput
              threadId={thread.id}
              disabled={live.running}
              onSubmit={send}
            />
          </div>
        )}
      </section>
    </div>
  );
}
