import type { AgentEvent, AgentEventType } from '../../types';
import { formatStepUsage, stepUsageFromEvents } from '../../lib/format-usage';

const STEPS: { type: AgentEventType; label: string; gate?: boolean }[] = [
  { type: 'change_analysis_done', label: 'Change Analyzer' },
  { type: 'prd_generated', label: 'PRD', gate: true },
  { type: 'spec_generated', label: 'Especificação', gate: true },
  { type: 'test_reviewer_done', label: 'Test Reviewer' },
  { type: 'architecture_reviewer_done', label: 'Architecture' },
  { type: 'report_ready', label: 'Relatório' },
];

type StepState = 'pending' | 'current' | 'done' | 'error' | 'awaiting';

function stepState(
  type: AgentEventType,
  done: Set<AgentEventType>,
  failed: boolean,
  running: boolean,
  awaitingApproval: boolean,
): StepState {
  if (done.has(type)) return 'done';
  if (!running && !failed && !awaitingApproval) return 'pending';

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
  if (isCurrent && awaitingApproval) return 'awaiting';
  if (isCurrent) return 'current';
  return 'pending';
}

const nodeTones: Record<StepState, string> = {
  pending: 'border-machine-line',
  current: 'border-machine-accent',
  done: 'border-[#D3DBE5] bg-[#D3DBE5]',
  error: 'border-fail',
  awaiting: 'border-[#E3B25C]',
};

const dotTones: Record<StepState, string> = {
  pending: 'bg-transparent',
  current: 'bg-machine-accent animate-node-pulse',
  done: 'bg-machine',
  error: 'bg-fail',
  awaiting: 'bg-[#E3B25C] animate-node-pulse',
};

interface AgentStepperProps {
  events: AgentEvent[];
  running: boolean;
  failed: boolean;
  /** Run is paused on the current stage awaiting human approval (HITL gate). */
  awaitingApproval?: boolean;
}

export function AgentStepper({ events, running, failed, awaitingApproval = false }: AgentStepperProps) {
  const done = new Set(
    events.filter((event) => event.type !== 'error' && event.type !== 'thought').map((event) => event.type),
  );
  const progress = (done.size / STEPS.length) * 100;

  return (
    <div className="relative mt-6">
      <div className="absolute top-2.5 right-[6%] left-[6%] hidden h-0.5 rounded-sm bg-machine-line sm:block">
        <div
          className="h-full rounded-sm bg-[#D3DBE5] transition-[width] duration-500 ease-precise"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="relative grid grid-cols-3 gap-y-6 sm:grid-cols-6">
        {STEPS.map((step, index) => {
          const state = stepState(step.type, done, failed, running, awaitingApproval);
          const usage = stepUsageFromEvents(events, step.type);
          return (
            <li key={step.type} className="flex flex-col items-center gap-2.5 px-1 text-center">
              <span
                className={`relative grid size-5.5 place-items-center border-2 bg-machine transition-all duration-200 ${
                  step.gate ? 'rotate-45 rounded-sm' : 'rounded-full'
                } ${nodeTones[state]}`}
              >
                <i className={`block size-2 rounded-full ${step.gate ? '-rotate-45 rounded-[1px]' : ''} ${dotTones[state]}`} />
                {state === 'current' && (
                  <span
                    aria-hidden="true"
                    className="absolute -inset-[7px] animate-node-halo rounded-[inherit] border border-machine-accent/40"
                  />
                )}
              </span>
              <span>
                <span className="block font-mono text-[10px] tracking-[0.1em] text-machine-fg-3">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span
                  className={`block text-[12.5px] leading-tight font-semibold ${
                    state === 'pending' ? 'text-machine-fg-2' : 'text-machine-fg'
                  }`}
                >
                  {step.label}
                </span>
                <span className="block font-mono text-[10.5px] text-machine-fg-3">
                  {state === 'done' && (usage ? formatStepUsage(usage) : 'sem LLM')}
                  {state === 'current' && 'rodando'}
                  {state === 'awaiting' && 'aguardando'}
                  {state === 'error' && 'erro'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
