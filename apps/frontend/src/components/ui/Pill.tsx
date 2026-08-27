import type { ReactNode } from 'react';

type Tone = 'pass' | 'warn' | 'fail' | 'neutral' | 'accent';

const tones: Record<Tone, string> = {
  pass: 'bg-pass-soft text-pass',
  warn: 'bg-warn-soft text-warn',
  fail: 'bg-fail-soft text-fail',
  accent: 'bg-accent-soft text-accent',
  neutral: 'border border-border bg-surface-2 text-ink-faint',
};

export function Pill({ tone = 'neutral', dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {dot && <i aria-hidden="true" className="block size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-dim">
      {children}
    </span>
  );
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase ${className}`}>
      {children}
    </p>
  );
}
