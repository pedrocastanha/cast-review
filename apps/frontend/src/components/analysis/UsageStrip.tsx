import type { AnalysisUsage } from '../../types';
import { formatTokens, formatUsageHeadline } from '../../lib/format-usage';

export function UsageStrip({ usage }: { usage: AnalysisUsage }) {
  const billed = usage.steps.filter((step) => !step.skipped).length;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border border-border px-4 py-3">
      <p className="font-mono text-sm tabular-nums text-ink">{formatUsageHeadline(usage)}</p>
      <p className="font-mono text-[10px] tracking-wider text-ink-faint uppercase tabular-nums">
        {formatTokens(usage.totalTokens)} tokens
        {billed > 0 && ` · ${billed} etapa${billed === 1 ? '' : 's'} LLM`}
        {usage.cachedTokens > 0 && ` · ${formatTokens(usage.cachedTokens)} cache`}
      </p>
    </div>
  );
}
