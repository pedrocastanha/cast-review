import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md border border-border bg-surface-1 shadow-card ${className}`} {...rest} />;
}

export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <p className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">{eyebrow}</p>}
        <h1 className="mt-1.5 mb-2 font-display text-2xl leading-[1.1] font-bold text-ink">{title}</h1>
        {description && <p className="max-w-[60ch] text-sm leading-6 text-ink-dim">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
