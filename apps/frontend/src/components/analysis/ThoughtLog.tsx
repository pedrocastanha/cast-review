import { useEffect, useRef, useState } from 'react';

const STEP_LABEL: Record<string, string> = {
  prd: 'PRD',
  implementation_spec: 'Especificação',
  test_reviewer: 'Test Reviewer',
  architecture_reviewer: 'Architecture',
};

const FIELD_LABEL: Record<string, string> = {
  title: 'Título',
  problem: 'Problema',
  whatChanged: 'O que mudou',
  goals: 'Objetivos',
  nonGoals: 'Fora do escopo',
  userImpact: 'Impacto para quem usa',
  constraints: 'Restrições',
  summary: 'Resumo',
  newContracts: 'Contratos novos ou alterados',
  businessRules: 'Regras de negócio',
  findings: 'Achados',
  detail: 'O que o código faz',
  businessRule: 'O que foi especificado',
  path: 'Arquivo',
  line: 'Linha',
  endLine: 'Linha final',
  conventionRef: 'Convenção',
  evidenceId: 'Evidência',
  status: 'Status',
  score: 'Nota',
  reviewer: 'Revisor',
};

const SEVERITY_STYLE: Record<string, string> = {
  fail: 'bg-fail-soft text-fail',
  warning: 'bg-warn-soft text-warn',
  pass: 'bg-pass-soft text-pass',
};

const SEVERITY_LABEL: Record<string, string> = { fail: 'falha', warning: 'aviso', pass: 'ok' };

function humanize(key: string) {
  return FIELD_LABEL[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function isFinding(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'status' in value &&
    'title' in value
  );
}

function Scalar({ value }: { value: unknown }) {
  const text = String(value);
  const looksLikePath = /^[\w@./-]+\.[a-z]{2,4}(:\d+)?$/i.test(text);

  if (looksLikePath) {
    return <span className="font-mono text-[12.5px] break-all text-ink-dim">{text}</span>;
  }

  return (
    <span className="text-sm leading-relaxed text-ink">
      {text.split(/(`[^`]+`)/).map((part, index) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code key={index} className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[12.5px] text-ink-dim">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </span>
  );
}

function collapseLocation(finding: Record<string, unknown>) {
  const entries = Object.entries(finding).filter(([key]) => key !== 'status' && key !== 'title');
  if (typeof finding.path !== 'string') return entries;

  const range = [finding.line, finding.endLine].filter((value) => typeof value === 'number');
  const location = range.length > 0 ? `${finding.path}:${range.join('-')}` : finding.path;

  return entries
    .filter(([key]) => key !== 'line' && key !== 'endLine')
    .map(([key, value]): [string, unknown] => (key === 'path' ? ['path', location] : [key, value]));
}

function FindingBlock({ finding }: { finding: Record<string, unknown> }) {
  const status = String(finding.status);
  const rest = collapseLocation(finding);

  return (
    <article className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase ${
            SEVERITY_STYLE[status] ?? 'bg-surface-2 text-ink-faint'
          }`}
        >
          {SEVERITY_LABEL[status] ?? status}
        </span>
        <span className="text-sm font-semibold text-ink">{String(finding.title)}</span>
      </div>
      {rest.length > 0 && (
        <dl className="mt-2 flex flex-col gap-2 pl-1">
          {rest.map(([key, value]) => (
            <div key={key}>
              <dt className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">{humanize(key)}</dt>
              <dd className="mt-0.5">
                <Node value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

function Node({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm text-ink-faint">—</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-sm text-ink-faint">nenhum</span>;
    if (value.every(isFinding)) {
      return (
        <div className="flex flex-col">
          {value.map((item, index) => (
            <FindingBlock key={index} finding={item} />
          ))}
        </div>
      );
    }
    return (
      <ul className="flex flex-col gap-1.5">
        {value.map((item, index) => (
          <li key={index} className="relative pl-5">
            <span aria-hidden="true" className="absolute top-2.5 left-1 size-1.5 rounded-full bg-border-strong" />
            <Node value={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === 'object') {
    if (isFinding(value)) return <FindingBlock finding={value as Record<string, unknown>} />;
    return (
      <dl className="flex flex-col gap-3">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div key={key}>
            <dt className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">{humanize(key)}</dt>
            <dd className="mt-1">
              <Node value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <Scalar value={value} />;
}

function parsed(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

function summarize(value: unknown, text: string) {
  if (value && typeof value === 'object' && 'findings' in value) {
    const findings = (value as { findings?: unknown }).findings;
    if (Array.isArray(findings)) {
      return `${findings.length} ${findings.length === 1 ? 'achado' : 'achados'}`;
    }
  }
  for (const key of ['title', 'summary'] as const) {
    if (value && typeof value === 'object' && key in value) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
  }
  return `${text.length} chars`;
}

function withoutSummaryField(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== 'string') return value;
  const { title: _title, ...rest } = record;
  return rest;
}

function StepBlock({ step, text, live }: { step: string; text: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const value = parsed(text);

  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface-1 shadow-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 px-4.5 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-ink-faint transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">
          {STEP_LABEL[step] ?? step}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-dim">{summarize(value, text)}</span>
        {live && (
          <span className="shrink-0 font-mono text-[10px] tracking-[0.1em] text-accent uppercase">gerando</span>
        )}
      </button>

      {open && (
        <div className="animate-fade-up border-t border-border px-4.5 py-4">
          {value ? (
            <Node value={withoutSummaryField(value)} />
          ) : (
            <pre className="max-h-80 overflow-auto rounded-sm border border-border bg-surface-2 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-dim">
              {text}
              {live && <span className="animate-pulse text-accent">▍</span>}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

export function ThoughtLog({ thoughts, running }: { thoughts: Record<string, string>; running: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const entries = Object.entries(thoughts).filter(([, text]) => text.length > 0);
  const lastStep = entries.at(-1)?.[0];
  const liveText = lastStep ? thoughts[lastStep] : '';

  useEffect(() => {
    if (running) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [liveText, running]);

  if (entries.length === 0) {
    return running ? <p className="font-mono text-xs text-ink-faint">Aguardando o primeiro token…</p> : null;
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map(([step, text]) => (
        <StepBlock key={step} step={step} text={text} live={running && step === lastStep} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
