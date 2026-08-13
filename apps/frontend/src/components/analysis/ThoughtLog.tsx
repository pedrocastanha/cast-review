import { useEffect, useRef } from 'react';

const STEP_LABEL: Record<string, string> = {
  prd: 'PRD',
  implementation_spec: 'Implementation Spec',
  test_reviewer: 'Test Reviewer',
  architecture_reviewer: 'Architecture',
};

export function ThoughtLog({
  thoughts,
  running,
}: {
  thoughts: Record<string, string>;
  running: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const entries = Object.entries(thoughts).filter(([, text]) => text.length > 0);
  const lastStep = entries.at(-1)?.[0];
  const liveText = lastStep ? thoughts[lastStep] : '';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [liveText]);

  if (entries.length === 0) {
    return running ? (
      <p className="font-mono text-xs text-ink-faint">Aguardando o primeiro token…</p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map(([step, text]) => {
        const isLive = running && step === lastStep;
        return (
          <section key={step}>
            <h3 className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">
              {STEP_LABEL[step] ?? step}
              <span className="normal-case tracking-normal text-ink-faint/80">
                {text.length} chars
              </span>
              {isLive && <span className="text-accent">● gerando</span>}
            </h3>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed text-ink">
              {text}
              {isLive && <span className="animate-pulse text-accent">▍</span>}
            </pre>
          </section>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
