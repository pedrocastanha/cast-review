import { useState } from 'react';
import type { ChatToolCallRecord } from '../../types';

export function ToolTrace({ calls }: { calls: ChatToolCallRecord[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="cursor-pointer font-mono text-[10.5px] tracking-[0.08em] text-ink-faint uppercase transition-colors hover:text-ink-dim"
      >
        {open ? '▾' : '▸'} {calls.length} chamada{calls.length > 1 ? 's' : ''} de ferramenta
      </button>

      {open && (
        <ol className="mt-2 space-y-1.5">
          {calls.map((call, index) => (
            <li
              key={`${call.iteration}-${call.name}-${index}`}
              className="rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-dim"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-ink">{call.name}</span>
                <span className="text-ink-faint">
                  {call.itemCount} item{call.itemCount === 1 ? '' : 's'} · {call.durationMs}ms
                  {call.truncated ? ' · truncado' : ''}
                </span>
              </div>
              <div className="mt-0.5 truncate text-ink-faint">{JSON.stringify(call.args)}</div>
              {call.note && <div className="mt-0.5 text-warn">{call.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
