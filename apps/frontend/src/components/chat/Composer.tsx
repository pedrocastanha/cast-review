import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from '../../api/chat.api';
import { repositoriesApi } from '../../api/repositories.api';
import { SUGGESTED_AI_MODELS } from '../../lib/ai-models';
import {
  activeMentionQuery,
  addMention,
  insertMention,
  usedMentions,
} from '../../lib/chat-mentions';
import {
  activeRepositoryQuery,
  insertRepositoryMarker,
  repositoryHintFor,
} from '../../lib/chat-repositories';
import type { ChatFile, ChatMention, Repository } from '../../types';

const MAX_HEIGHT = 200;

interface ComposerProps {
  threadId: string | null;
  scopeMode: 'global' | 'repository' | 'project';
  disabled: boolean;
  model: string;
  onModelChange: (model: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  onSubmit: (
    content: string,
    mentions: ChatMention[],
    repositoryHint: string | null,
  ) => void;
}

export function Composer({
  threadId,
  scopeMode,
  disabled,
  model,
  onModelChange,
  autoFocus = false,
  placeholder = 'Pergunte sobre o código…',
  onSubmit,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [fileSuggestions, setFileSuggestions] = useState<ChatFile[]>([]);
  const [repositoryOptions, setRepositoryOptions] = useState<Repository[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [repositoryQuery, setRepositoryQuery] = useState<string | null>(null);
  const [repositorySession, setRepositorySession] = useState(0);
  const [selectedRepository, setSelectedRepository] = useState<string | null>(
    null,
  );
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (mentionQuery === null || !threadId || scopeMode === 'global') {
      setFileSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const files = await chatApi.listFiles(threadId, mentionQuery);
        if (!cancelled) {
          setFileSuggestions(files);
          setHighlighted(0);
        }
      } catch {
        if (!cancelled) setFileSuggestions([]);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, scopeMode, threadId]);

  useEffect(() => {
    if (scopeMode !== 'global' || repositorySession === 0) return;
    let cancelled = false;
    void repositoriesApi
      .list({ indexed: true })
      .then((repositories) => {
        if (!cancelled) {
          setRepositoryOptions(repositories);
          setHighlighted(0);
        }
      })
      .catch(() => {
        if (!cancelled) setRepositoryOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repositorySession, scopeMode]);

  const repositorySuggestions = useMemo(() => {
    if (repositoryQuery === null) return [];
    const needle = repositoryQuery.toLowerCase();
    return repositoryOptions
      .filter((repository) => repository.fullName.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [repositoryOptions, repositoryQuery]);

  const pickFile = (file: ChatFile) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? value.length;
    const nextValue = insertMention(value, caret, file.path);
    setValue(nextValue);
    setMentionQuery(null);
    setFileSuggestions([]);
    setMentions((current) =>
      addMention(current, { repoId: file.repoId, path: file.path }),
    );
    textarea?.focus();
  };

  const pickRepository = (repository: Repository) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? value.length;
    const nextValue = insertRepositoryMarker(
      value,
      caret,
      repository.fullName,
    );
    setValue(nextValue);
    setSelectedRepository(repository.fullName);
    setRepositoryQuery(null);
    setHighlighted(0);
    requestAnimationFrame(() => {
      const position = `/${repository.fullName} `.length;
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
    });
  };

  const submit = () => {
    const content = value.trim();
    if (!content || disabled || !model.trim()) return;
    onSubmit(
      content,
      usedMentions(value, mentions),
      repositoryHintFor(value, selectedRepository),
    );
    setValue('');
    setMentions([]);
    setMentionQuery(null);
    setRepositoryQuery(null);
    setSelectedRepository(null);
  };

  const activeSuggestions =
    repositorySuggestions.length > 0
      ? repositorySuggestions
      : fileSuggestions;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (activeSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % activeSuggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted(
          (index) =>
            (index - 1 + activeSuggestions.length) % activeSuggestions.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const repository = repositorySuggestions[highlighted];
        if (repository) pickRepository(repository);
        else if (fileSuggestions[highlighted]) {
          pickFile(fileSuggestions[highlighted]);
        }
        return;
      }
      if (event.key === 'Escape') {
        setMentionQuery(null);
        setRepositoryQuery(null);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const hasRepositoryHint = Boolean(
    repositoryHintFor(value, selectedRepository),
  );

  return (
    <div className="relative">
      {repositorySuggestions.length > 0 && (
        <ul
          aria-label="Repositórios indexados"
          className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border border-border-strong bg-surface-1 py-1 shadow-[0_16px_40px_rgba(0,0,0,.22)]"
        >
          {repositorySuggestions.map((repository, index) => (
            <li key={repository.id}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickRepository(repository);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex min-h-10 w-full cursor-pointer items-center gap-3 px-3 text-left transition-colors ${
                  index === highlighted
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink-dim'
                }`}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-surface-2 font-mono text-[10px] text-accent">
                  /
                </span>
                <span className="min-w-0 truncate font-mono text-xs">
                  {repository.fullName}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[9px] tracking-[0.1em] text-pass uppercase">
                  indexado
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {fileSuggestions.length > 0 && repositorySuggestions.length === 0 && (
        <ul
          aria-label="Arquivos do índice"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border border-border-strong bg-surface-1 py-1 shadow-[0_16px_40px_rgba(0,0,0,.22)]"
        >
          {fileSuggestions.map((file, index) => (
            <li key={`${file.repoId}:${file.path}`}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickFile(file);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex min-h-9 w-full cursor-pointer items-baseline gap-3 px-3 text-left font-mono text-xs transition-colors ${
                  index === highlighted
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink-dim'
                }`}
              >
                <span className="truncate">{file.path}</span>
                <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
                  {file.repoId.split('/').pop()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-xl border border-border-strong bg-surface-1 shadow-[0_2px_14px_rgba(0,0,0,.06)] transition-colors focus-within:border-accent/60">
        {(mentions.length > 0 || hasRepositoryHint) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {hasRepositoryHint && (
              <span className="max-w-full truncate rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] text-accent">
                /{selectedRepository}
              </span>
            )}
            {mentions.map((mention) => (
              <span
                key={`${mention.repoId}:${mention.path}`}
                className="max-w-full truncate rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] text-accent"
              >
                @{mention.path.split('/').pop()}
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          autoFocus={autoFocus}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            const nextValue = event.target.value;
            const caret = event.target.selectionStart ?? 0;
            const nextRepositoryQuery =
              scopeMode === 'global'
                ? activeRepositoryQuery(nextValue, caret)
                : null;
            if (nextRepositoryQuery !== null && repositoryQuery === null) {
              setRepositorySession((session) => session + 1);
            }
            setValue(nextValue);
            setRepositoryQuery(nextRepositoryQuery);
            setMentionQuery(
              scopeMode !== 'global'
                ? activeMentionQuery(nextValue, caret)
                : null,
            );
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
          className="max-h-[12.5rem] min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
        />

        <div className="flex min-h-12 items-center gap-2 border-t border-border px-2.5 py-1.5">
          <label className="flex min-w-0 items-center gap-2 rounded-md px-1.5 text-ink-faint focus-within:bg-surface-2">
            <span className="font-mono text-[9px] tracking-[0.1em] uppercase">
              modelo
            </span>
            <input
              aria-label="Modelo de IA"
              list="chat-model-options"
              value={model}
              disabled={disabled}
              onChange={(event) => onModelChange(event.target.value)}
              className="min-h-8 w-[8.75rem] bg-transparent font-mono text-[11px] text-ink outline-none disabled:opacity-50 sm:w-[10rem]"
            />
            <datalist id="chat-model-options">
              {SUGGESTED_AI_MODELS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </label>

          <span className="ml-auto hidden font-mono text-[9px] text-ink-faint sm:block">
            {scopeMode === 'global' ? '/ repositório' : '@ arquivo'}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim() || !model.trim()}
            aria-label="Enviar"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      <p className="mt-1.5 px-1 font-mono text-[10px] text-ink-faint">
        <kbd>Enter</kbd> envia · <kbd>Shift+Enter</kbd> quebra linha
      </p>
    </div>
  );
}
