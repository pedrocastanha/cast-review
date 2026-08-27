import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const base =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-sm px-4 py-2.5 whitespace-nowrap ' +
  'text-sm font-semibold transition-[background-color,border-color,color] duration-150 ' +
  'disabled:pointer-events-none disabled:opacity-45';

const variants: Record<Variant, string> = {
  primary: 'border border-accent bg-accent text-accent-ink hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'border border-border-strong bg-surface-1 text-ink hover:bg-surface-2 hover:border-ink-faint',
  ghost: 'border border-transparent bg-transparent px-2.5 text-ink-dim hover:bg-surface-1 hover:text-ink',
  danger: 'border border-fail/35 bg-transparent text-fail hover:bg-fail-soft hover:border-fail',
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
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span className="size-3.5 animate-spin-precise rounded-full border-2 border-current/30 border-t-current" />
      )}
      {children}
    </button>
  );
}
