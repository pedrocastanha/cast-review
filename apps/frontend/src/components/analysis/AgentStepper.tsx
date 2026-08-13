import type { AgentEvent, AgentEventType } from '../../types';

const STEPS: { type: AgentEventType; label: string }[] = [
  { type: 'change_analysis_done', label: 'Change Analyzer' },
  { type: 'prd_generated', label: 'PRD' },
  { type: 'spec_generated', label: 'Implementation Spec' },
  { type: 'test_reviewer_done', label: 'Test Reviewer' },
  { type: 'architecture_reviewer_done', label: 'Architecture' },
  { type: 'report_ready', label: 'Relatório' },
];

type StepState = 'pending' | 'current' | 'done' | 'error';

function stepState(
  type: AgentEventType,
  done: Set<AgentEventType>,
  failed: boolean,
  running: boolean,
): StepState {
  if (done.has(type)) return 'done';
  if (!running && !failed) return 'pending';

  const firstPending = STEPS.find((step) => !done.has(step.type));
  const reviewersPending =
    done.has('spec_generated') &&
    (!done.has('test_reviewer_done') || !done.has('architecture_reviewer_done'));

  const isCurrent =
    type === firstPending?.type ||
    (reviewersPending &&
      (type === 'test_reviewer_done' || type === 'architecture_reviewer_done') &&
      !done.has(type));

  if (isCurrent && failed) return 'error';
  if (isCurrent) return 'current';
  return 'pending';
}

const tones: Record<StepState, string> = {
  pending: 'border-border text-ink-faint',
  current: 'border-accent text-accent',
  done: 'border-state-open text-state-open',
  error: 'border-state-closed text-state-closed',
};

interface AgentStepperProps {
  events: AgentEvent[];
  running: boolean;
  failed: boolean;
}

export function AgentStepper({ events, running, failed }: AgentStepperProps) {
  const done = new Set(
    events
      .filter((event) => event.type !== 'error' && event.type !== 'thought')
      .map((event) => event.type),
  );

  return (
    <ol className="grid gap-2 sm:grid-cols-2">
      {STEPS.map((step, index) => {
        const state = stepState(step.type, done, failed, running);
        return (
          <li
            key={step.type}
            className={`flex items-center gap-3 rounded-sm border px-3 py-2.5 ${tones[state]}`}
          >
            <span className="font-mono text-xs tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-sm">{step.label}</span>
            <span className="ml-auto font-mono text-[10px] tracking-wider uppercase">
              {state === 'done' && 'ok'}
              {state === 'current' && '…'}
              {state === 'error' && 'erro'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
