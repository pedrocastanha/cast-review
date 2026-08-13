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
  const entries = Object.entries(thoughts).filter(([, text]) => text.trim().length > 0);
  if (entries.length === 0) {
    return running ? (
      <p className="font-mono text-xs text-ink-faint">Aguardando o primeiro token…</p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map(([step, text]) => (
        <section key={step}>
          <h3 className="mb-2 font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">
            {STEP_LABEL[step] ?? step}
          </h3>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-ink-dim">
            {text}
          </pre>
        </section>
      ))}
    </div>
  );
}
