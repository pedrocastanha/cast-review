import { useState } from 'react';
import type { ChatToolCallRecord } from '../../types';

interface ToolTraceProps {
  calls: ChatToolCallRecord[];
  running?: boolean;
}

export function ToolTrace({ calls, running = false }: ToolTraceProps) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;

  const last = calls[calls.length - 1];

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[10.5px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
      >
        {running && (
          <span
            aria-hidden="true"
            className="size-1.5 animate-node-pulse rounded-full bg-accent"
          />
        )}
        <span>
          {running ? last.name : `${calls.length} ferramenta${calls.length > 1 ? 's' : ''}`}
        </span>
        <span aria-hidden="true" className="text-ink-faint">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <ol className="mt-2 space-y-1">
          {calls.map((call, index) => (
            <li
              key={`${call.iteration}-${call.name}-${index}`}
              className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 font-mono text-[11px]"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink">{call.name}</span>
                <span className="text-ink-faint">
                  {call.itemCount} item{call.itemCount === 1 ? '' : 's'} · {call.durationMs}ms
                  {call.truncated ? ' · truncado' : ''}
                </span>
              </div>
              <div className="mt-0.5 truncate text-ink-faint">
                {JSON.stringify(call.args)}
              </div>
              {call.note && <div className="mt-0.5 text-warn">{call.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
