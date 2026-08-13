import type { AnalysisUsage, AgentEvent, AgentEventType, StepUsage } from '../types';

const STEP_ORDER: StepUsage['step'][] = [
  'change_analyzer',
  'prd',
  'implementation_spec',
  'test_reviewer',
  'architecture_reviewer',
  'report_builder',
];

const EVENT_STEP: Partial<Record<AgentEventType, StepUsage['step']>> = {
  change_analysis_done: 'change_analyzer',
  prd_generated: 'prd',
  spec_generated: 'implementation_spec',
  test_reviewer_done: 'test_reviewer',
  architecture_reviewer_done: 'architecture_reviewer',
  report_ready: 'report_builder',
};

export function formatUsd(costUsd: number | null | undefined, skipped = false): string {
  if (skipped && (costUsd === 0 || costUsd == null)) return 'sem LLM';
  if (costUsd == null) return 'n/d';
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

export function formatTokens(count: number | null | undefined): string {
  const value = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return String(value);
}

export function formatStepUsage(step: StepUsage): string {
  if (step.skipped) return 'sem LLM';
  return `${formatTokens(step.totalTokens)} · ${formatUsd(step.costUsd)}`;
}

export function formatUsageHeadline(usage: AnalysisUsage): string {
  if (!usage.costComplete || usage.costUsd == null) {
    return `${formatTokens(usage.totalTokens)} tok · preço n/d`;
  }
  return `US$ ${formatUsd(usage.costUsd).slice(1)} · ${formatTokens(usage.totalTokens)} tok`;
}

export function formatUsageChip(usage: AnalysisUsage | undefined): string | null {
  if (!usage) return null;
  if (!usage.costComplete || usage.costUsd == null) {
    return usage.totalTokens > 0 ? `${formatTokens(usage.totalTokens)} tok` : null;
  }
  return `US$ ${formatUsd(usage.costUsd).slice(1)}`;
}

export function isStepUsage(value: unknown): value is StepUsage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'step' in value &&
      typeof (value as StepUsage).step === 'string',
  );
}

export function isAnalysisUsage(value: unknown): value is AnalysisUsage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as AnalysisUsage).steps),
  );
}

export function usageFromEvents(events: AgentEvent[]): AnalysisUsage | undefined {
  const ready = [...events].reverse().find((event) => event.type === 'report_ready');
  if (isAnalysisUsage(ready?.payload.usage)) {
    return ready.payload.usage;
  }

  const byStep = new Map<StepUsage['step'], StepUsage>();
  for (const event of events) {
    const usage = event.payload.usage;
    if (isAnalysisUsage(usage)) {
      for (const step of usage.steps) byStep.set(step.step, step);
      continue;
    }
    if (!isStepUsage(usage)) continue;
    byStep.set(usage.step, usage);
  }

  if (byStep.size === 0) return undefined;
  return sumSteps([...byStep.values()]);
}

export function stepUsageFromEvents(
  events: AgentEvent[],
  type: AgentEventType,
): StepUsage | undefined {
  const usage = usageFromEvents(events);
  const step = EVENT_STEP[type];
  if (!usage || !step) return undefined;
  return usage.steps.find((item) => item.step === step);
}

function sumSteps(steps: StepUsage[]): AnalysisUsage {
  const ordered = [...steps].sort(
    (left, right) => STEP_ORDER.indexOf(left.step) - STEP_ORDER.indexOf(right.step),
  );
  const known = ordered
    .map((item) => item.costUsd)
    .filter((value): value is number => typeof value === 'number');
  const incomplete = ordered.some(
    (item) => !item.skipped && (item.costUsd === null || item.source === 'missing'),
  );
  return {
    currency: 'USD',
    promptTokens: ordered.reduce((sum, item) => sum + item.promptTokens, 0),
    cachedTokens: ordered.reduce((sum, item) => sum + item.cachedTokens, 0),
    completionTokens: ordered.reduce((sum, item) => sum + item.completionTokens, 0),
    totalTokens: ordered.reduce((sum, item) => sum + item.totalTokens, 0),
    costUsd: known.length ? known.reduce((sum, value) => sum + value, 0) : incomplete ? null : 0,
    costComplete: !incomplete,
    pricingAsOf: '',
    steps: ordered,
  };
}
