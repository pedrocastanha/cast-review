import type { Iteration } from '../../types';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

interface IterationHistoryProps {
  iterations: Iteration[];
}

export function IterationHistory({ iterations }: IterationHistoryProps) {
  if (iterations.length === 0) return null;

  return (
    <ol className="flex flex-col gap-2">
      {iterations.map((iteration, index) => (
        <li
          key={index}
          className="rounded-sm border border-border bg-surface-1 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-ink-faint">v{index + 1}</span>
            <span className="font-mono text-xs text-ink-faint">{formatWhen(iteration.createdAt)}</span>
          </div>
          {iteration.annotations && iteration.annotations.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-2 border-l border-border pl-3">
              {iteration.annotations.map((annotation, annotationIndex) => (
                <li key={annotationIndex} className="text-xs">
                  <p className="font-mono text-[11px] text-ink-faint italic">“{annotation.excerpt}”</p>
                  <p className="mt-0.5 text-ink">{annotation.note}</p>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
