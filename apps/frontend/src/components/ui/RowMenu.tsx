import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface RowMenuItem {
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
}

export function RowMenu({ items, label = 'Ações' }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const itemClass = (item: RowMenuItem) =>
    `flex w-full min-h-11 cursor-pointer items-center px-3.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
      item.danger ? 'text-fail hover:bg-fail-soft' : 'text-ink hover:bg-surface-2'
    }`;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={`grid size-11 cursor-pointer place-items-center rounded-sm transition-colors ${
          open ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:bg-surface-3 hover:text-ink'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 min-w-48 animate-fade-up overflow-hidden rounded-md border border-border bg-surface-1 py-1 shadow-card"
        >
          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                role="menuitem"
                href={item.href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                }}
                className={itemClass(item)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={itemClass(item)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function MenuSection({ children }: { children: ReactNode }) {
  return <div className="border-t border-border py-1 first:border-t-0 first:pt-0">{children}</div>;
}
