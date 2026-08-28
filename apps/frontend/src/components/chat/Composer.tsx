import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chatApi } from '../../api/chat.api';
import {
  activeMentionQuery,
  addMention,
  insertMention,
  usedMentions,
} from '../../lib/chat-mentions';
import type { ChatFile, ChatMention } from '../../types';

const MAX_HEIGHT = 200;

interface ComposerProps {
  threadId: string | null;
  disabled: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  onSubmit: (content: string, mentions: ChatMention[]) => void;
}

export function Composer({
  threadId,
  disabled,
  autoFocus = false,
  placeholder = 'Pergunte sobre o código…',
  onSubmit,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [suggestions, setSuggestions] = useState<ChatFile[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (query === null || !threadId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const files = await chatApi.listFiles(threadId, query);
        if (!cancelled) {
          setSuggestions(files);
          setHighlighted(0);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, threadId]);

  const pick = (file: ChatFile) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? value.length;
    setValue(insertMention(value, caret, file.path));
    setQuery(null);
    setSuggestions([]);
    setMentions((current) =>
      addMention(current, { repoId: file.repoId, path: file.path }),
    );
    textarea?.focus();
  };

  const submit = () => {
    const content = value.trim();
    if (!content || disabled) return;
    onSubmit(content, usedMentions(value, mentions));
    setValue('');
    setMentions([]);
    setQuery(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pick(suggestions[highlighted]);
        return;
      }
      if (event.key === 'Escape') {
        setQuery(null);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative">
      {suggestions.length > 0 && (
        <ul
          aria-label="Arquivos do índice"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full overflow-y-auto rounded-md border border-border-strong bg-surface-1 py-1 shadow-[0_16px_40px_rgba(0,0,0,.22)]"
        >
          {suggestions.map((file, index) => (
            <li key={`${file.repoId}:${file.path}`}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(file);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full cursor-pointer items-baseline gap-3 px-3 py-1.5 text-left font-mono text-xs transition-colors ${
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

      <div className="rounded-xl border border-border-strong bg-surface-1 shadow-[0_2px_14px_rgba(0,0,0,.06)] transition-colors focus-within:border-accent/60">
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {mentions.map((mention) => (
              <span
                key={`${mention.repoId}:${mention.path}`}
                className="max-w-full truncate rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] text-accent"
              >
                {mention.path.split('/').pop()}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 p-2.5">
          <textarea
            ref={textareaRef}
            rows={1}
            autoFocus={autoFocus}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              setQuery(
                activeMentionQuery(
                  event.target.value,
                  event.target.selectionStart ?? 0,
                ),
              );
            }}
            onKeyDown={handleKeyDown}
            className="max-h-[12.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="Enviar"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      <p className="mt-1.5 px-1 font-mono text-[10.5px] text-ink-faint">
        <kbd>Enter</kbd> envia · <kbd>Shift+Enter</kbd> quebra linha · <kbd>@</kbd> menciona arquivo
      </p>
    </div>
  );
}
