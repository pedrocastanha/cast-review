import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-sm px-4.5 py-2.5 ' +
  'text-sm font-semibold tracking-wide transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-45 active:not-disabled:translate-y-px';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink border border-accent hover:not-disabled:bg-accent-hover hover:not-disabled:border-accent-hover',
  secondary:
    'bg-transparent text-ink border border-border-strong hover:not-disabled:bg-surface-2 hover:not-disabled:border-ink-faint',
  ghost: 'bg-transparent text-ink-dim border border-transparent px-2 hover:not-disabled:text-ink',
  danger:
    'bg-transparent text-state-closed border border-border-strong hover:not-disabled:border-state-closed hover:not-disabled:bg-state-closed-dim',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span className="size-3.5 animate-spin-precise rounded-full border-2 border-current/30 border-t-current" />
      )}
      {children}
    </button>
  );
}
