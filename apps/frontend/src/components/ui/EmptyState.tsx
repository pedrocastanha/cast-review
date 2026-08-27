import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border-strong px-6 py-14 sm:px-8 sm:py-16">
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      {description && <p className="max-w-md text-sm text-ink-dim">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
