import type { ReactNode } from 'react';
import type { AnalysisUsage } from '../../types';
import { formatTokens, formatUsageHeadline } from '../../lib/format-usage';

export function Console({ meter, children }: { meter?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-machine px-5 pt-4.5 pb-5 text-machine-fg sm:px-5.5">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_88%_-10%,rgba(206,31,93,.16),transparent_55%)]"
      />
      <div className="relative z-1">{meter}{children}</div>
    </div>
  );
}

export function ConsoleMeter({ usage, model }: { usage?: AnalysisUsage | null; model?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-5 font-mono text-xs text-machine-fg-2">
      {model && (
        <span>
          modelo <b className="font-semibold text-machine-fg">{model}</b>
        </span>
      )}
      {usage && (
        <>
          <span>
            tokens <b className="font-semibold text-machine-fg">{formatTokens(usage.totalTokens)}</b>
          </span>
          <span>
            custo <b className="font-semibold text-machine-fg">{formatUsageHeadline(usage)}</b>
          </span>
        </>
      )}
    </div>
  );
}

export function ConsoleStream({ text, live }: { text: string; live: boolean }) {
  if (!text) return null;

  return (
    <div className="mt-5 flex items-start gap-3 border-t border-machine-line pt-3.5">
      <span className="shrink-0 pt-0.5 font-mono text-[10px] tracking-[0.14em] text-machine-fg-3 uppercase">
        Pensando
      </span>
      <p className="min-w-0 font-mono text-[12.5px] leading-relaxed break-words text-machine-fg-2">
        {text.slice(-400)}
        {live && (
          <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-[7px] animate-caret align-[-2px] bg-machine-accent" />
        )}
      </p>
    </div>
  );
}
