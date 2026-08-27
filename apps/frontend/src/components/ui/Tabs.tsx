export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className = '',
}: {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border-strong ${className}`}>
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={`-mb-px min-h-11 shrink-0 cursor-pointer border-b-2 px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
              selected ? 'border-accent text-ink' : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={`ml-1.5 font-mono text-[11px] ${selected ? 'text-accent' : 'text-ink-faint'}`}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
