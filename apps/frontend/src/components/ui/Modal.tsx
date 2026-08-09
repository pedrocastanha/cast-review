import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const onOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid animate-overlay-in place-items-center bg-surface/80 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={onOverlayClick}
      role="presentation"
    >
      <div
        className={`w-full ${wide ? 'max-w-160' : 'max-w-120'} max-h-[85vh] animate-modal-in overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-6 sm:max-h-[640px]`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-6 flex items-start justify-between gap-6">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-lg leading-none text-ink-faint hover:text-ink"
          >
            ×
          </button>
        </div>

        {children}

        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
