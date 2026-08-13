import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, id, className = '', ...rest }: FieldProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-semibold tracking-wide text-ink-faint uppercase"
      >
        {label}
      </label>
      <input
        id={inputId}
        className={`min-h-11 rounded-sm border border-border bg-surface-1 px-3 py-2.5 text-base text-ink placeholder:text-ink-faint transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${className}`}
        {...rest}
      />
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </div>
  );
}
