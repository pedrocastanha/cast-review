import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** Diálogo centralizado: o card ocupa o foco da tela enquanto é editado. */
export function CardModal({ label, eyebrow, onClose, children }: {
  label: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const targets = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!targets.length) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      restoreTo.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4 sm:p-6">
      <div aria-hidden="true" onMouseDown={onClose} className="absolute inset-0 animate-overlay-in bg-surface/80 backdrop-blur-[2px]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Card · ${label}`}
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[62rem] flex-col rounded-md border border-border-strong bg-surface-1 shadow-card outline-none animate-modal-in sm:max-h-[min(50rem,calc(100dvh-3rem))]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.16em] text-ink-faint uppercase">{eyebrow}</p>
            <h2 className="mt-1.5 text-xl leading-[1.25] font-semibold tracking-[-0.015em]">{label}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar card"
            className="font-mono grid size-9 shrink-0 place-items-center rounded-sm border border-border text-ink-dim transition-colors hover:border-border-strong hover:text-ink"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
