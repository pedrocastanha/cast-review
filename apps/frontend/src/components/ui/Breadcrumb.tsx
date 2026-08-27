import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="mb-4 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-faint">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true" className="opacity-50">/</span>}
          {item.to ? (
            <Link to={item.to} className="min-h-11 leading-[2.75rem] transition-colors hover:text-accent">
              {item.label}
            </Link>
          ) : (
            <span className="leading-[2.75rem] text-ink-dim">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
