import { useEffect, useRef, useState } from 'react';
import { chatApi } from '../../api/chat.api';
import {
  activeMentionQuery,
  addMention,
  insertMention,
  usedMentions,
} from '../../lib/chat-mentions';
import type { ChatFile, ChatMention } from '../../types';

interface MentionInputProps {
  threadId: string;
  disabled: boolean;
  onSubmit: (content: string, mentions: ChatMention[]) => void;
}

export function MentionInput({ threadId, disabled, onSubmit }: MentionInputProps) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [suggestions, setSuggestions] = useState<ChatFile[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (query === null) {
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
        setHighlighted((index) => (index - 1 + suggestions.length) % suggestions.length);
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
          className="absolute bottom-full left-0 z-10 mb-2 max-h-64 w-full overflow-y-auto rounded-sm border border-border-strong bg-surface-1 py-1 shadow-lg"
        >
          {suggestions.map((file, index) => (
            <li key={`${file.repoId}:${file.path}`}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(file);
                }}
                className={`flex w-full cursor-pointer items-baseline gap-2 px-3 py-1.5 text-left font-mono text-xs ${
                  index === highlighted ? 'bg-surface-2 text-ink' : 'text-ink-dim'
                }`}
              >
                <span className="truncate">{file.path}</span>
                <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
                  {file.repoId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {mentions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {mentions.map((mention) => (
            <span
              key={`${mention.repoId}:${mention.path}`}
              className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] text-accent"
            >
              {mention.path}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-sm border border-border-strong bg-surface-1 p-2">
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          disabled={disabled}
          placeholder="Pergunte sobre o código. Use @ para mencionar um arquivo."
          onChange={(event) => {
            setValue(event.target.value);
            setQuery(
              activeMentionQuery(event.target.value, event.target.selectionStart ?? 0),
            );
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="min-h-11 shrink-0 cursor-pointer rounded-sm bg-accent px-4 text-sm font-semibold text-surface-1 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
