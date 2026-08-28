import type { ChatThread } from '../../types';

interface ThreadListProps {
  threads: ChatThread[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}

function scopeOf(thread: ChatThread): string {
  if (thread.scope.mode === 'project') {
    return thread.scope.projectName ?? 'projeto';
  }
  return thread.repoId?.split('/').pop() ?? '';
}

export function ThreadList({
  threads,
  activeId,
  onOpen,
  onRemove,
}: ThreadListProps) {
  if (threads.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[13px] leading-5 text-ink-faint">
        Nenhuma conversa ainda.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {threads.map((thread) => {
        const active = thread.id === activeId;
        return (
          <li key={thread.id} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(thread.id)}
              className={`w-full cursor-pointer rounded-md px-2.5 py-2 pr-8 text-left transition-colors ${
                active
                  ? 'bg-surface-2 text-ink'
                  : 'text-ink-dim hover:bg-surface-2/60 hover:text-ink'
              }`}
            >
              <span className="block truncate text-[13.5px] leading-5">
                {thread.title}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-faint">
                {scopeOf(thread)}
              </span>
            </button>

            <button
              type="button"
              aria-label={`Apagar ${thread.title}`}
              onClick={() => onRemove(thread.id)}
              className={`absolute top-1.5 right-1 grid size-7 cursor-pointer place-items-center rounded text-ink-faint opacity-0 transition-all group-hover:opacity-100 hover:bg-surface-1 hover:text-warn focus-visible:opacity-100 ${
                active ? 'opacity-60' : ''
              }`}
            >
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
