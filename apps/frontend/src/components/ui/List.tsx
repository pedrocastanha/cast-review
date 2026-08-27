import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function List({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-md border border-border bg-surface-1 shadow-card ${className}`}>
      {children}
    </div>
  );
}

const rowClass =
  'flex w-full items-center gap-4 border-b border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-2 sm:px-[1.125rem]';

export function Row({ to, children }: { to?: string; children: ReactNode }) {
  if (to) {
    return (
      <Link to={to} className={rowClass}>
        {children}
      </Link>
    );
  }
  return <div className={rowClass}>{children}</div>;
}

export function RowMain({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 font-mono text-sm font-medium text-ink">{title}</div>
      {subtitle && <div className="mt-1 truncate text-sm text-ink-dim">{subtitle}</div>}
    </div>
  );
}

export function RowMeta({ children }: { children: ReactNode }) {
  return <div className="shrink-0 text-right font-mono text-[11.5px] leading-4 text-ink-faint">{children}</div>;
}

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-1.5 shrink-0 rounded-full ${on ? 'bg-pass' : 'bg-border-strong'}`}
    />
  );
}
