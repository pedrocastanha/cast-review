import type { ReactNode } from 'react';
import type { CardStatus } from '../../types/feature-cards';

interface BoardColumnProps {
  status: CardStatus;
  label: string;
  hint: string;
  count: number;
  /** Recolhe a coluna num trilho estreito a partir de md; no mobile a coluna segue inteira. */
  collapsed: boolean;
  dropActive: boolean;
  /** Fora da etapa ativa do seletor mobile — escondida só abaixo de md. */
  hidden: boolean;
  onToggle?: () => void;
  onDrop: (cardId: string) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  children: ReactNode;
}

export function BoardColumn({ status, label, hint, count, collapsed, dropActive, hidden, onToggle, onDrop, onDragOver, onDragLeave, children }: BoardColumnProps) {
  const dropHandlers = {
    onDragOver: (event: React.DragEvent) => { event.preventDefault(); onDragOver(); },
    onDragLeave,
    onDrop: (event: React.DragEvent) => { event.preventDefault(); onDrop(event.dataTransfer.getData('text/plain')); },
  };

  const column = (
    <section
      aria-label={label}
      data-status={status}
      {...dropHandlers}
      className={`${hidden ? 'hidden' : 'flex'} min-w-0 flex-col ${collapsed ? 'md:hidden' : 'md:flex md:min-w-[12.5rem] md:flex-1'}`}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-2">
        <h2 className="font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-dim uppercase">{label}</h2>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded="true"
            aria-label={`Recolher coluna ${label}`}
            className="font-mono hidden text-[11px] tabular-nums text-ink-faint transition-colors hover:text-ink md:inline"
          >
            {count} <span aria-hidden="true">⇥</span>
          </button>
        ) : null}
        <span className={`font-mono text-[11px] tabular-nums text-ink-faint ${onToggle ? 'md:hidden' : ''}`}>{count}</span>
      </header>

      <div
        {...dropHandlers}
        className={`grid grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-sm px-1.5 py-3 transition-colors duration-150 md:min-h-64 md:flex-1 ${
          dropActive ? 'bg-accent/[0.06] outline-1 outline-dashed outline-accent' : ''
        }`}
      >
        {count > 0 ? children : <p className="max-w-[26ch] px-1.5 py-6 text-[11px] leading-[1.5] text-ink-faint">{hint}</p>}
      </div>
    </section>
  );

  if (!collapsed) return column;

  return (
    <>
      <section
        aria-label={label}
        data-status={status}
        {...dropHandlers}
        className={`hidden md:flex md:w-11 md:shrink-0 md:flex-col md:rounded-sm md:border md:border-dashed ${dropActive ? 'md:border-accent md:bg-accent/[0.06]' : 'md:border-border'}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded="false"
          aria-label={`Expandir coluna ${label} · ${count} cards`}
          className="font-mono flex flex-1 items-start justify-center pt-4 text-[11px] tracking-[0.16em] text-ink-faint uppercase transition-colors hover:text-ink"
        >
          <span aria-hidden="true" className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
            {label} · <span className="tabular-nums">{count}</span>
          </span>
        </button>
      </section>
      {column}
    </>
  );
}
