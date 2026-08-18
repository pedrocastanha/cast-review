import { useCallback, useRef, useState } from 'react';
import type { Annotation } from '../../types';
import { Button } from '../ui/Button';

interface ExcerptCommentEditorProps {
  content: string;
  onAnnotationsChange: (annotations: Annotation[]) => void;
}

interface PendingSelection {
  excerpt: string;
  top: number;
  left: number;
}

export function ExcerptCommentEditor({ content, onAnnotationsChange }: ExcerptCommentEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [composing, setComposing] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  const clearPending = useCallback(() => {
    setPending(null);
    setComposing(false);
    setNoteDraft('');
  }, []);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const excerpt = selection.toString();
    if (!excerpt.trim()) {
      return;
    }

    const container = containerRef.current;
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (
      !container ||
      !anchorNode ||
      !focusNode ||
      !container.contains(anchorNode) ||
      !container.contains(focusNode)
    ) {
      return;
    }

    const range = selection.getRangeAt(0);
    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setPending({
      excerpt,
      top: rangeRect.bottom - containerRect.top,
      left: Math.max(0, rangeRect.left - containerRect.left),
    });
    setComposing(false);
    setNoteDraft('');
  }, []);

  const submitAnnotation = useCallback(() => {
    if (!pending || !noteDraft.trim()) {
      return;
    }
    const next = [...annotations, { excerpt: pending.excerpt, note: noteDraft.trim() }];
    setAnnotations(next);
    onAnnotationsChange(next);
    window.getSelection()?.removeAllRanges();
    clearPending();
  }, [pending, noteDraft, annotations, onAnnotationsChange, clearPending]);

  const removeAnnotation = useCallback(
    (index: number) => {
      const next = annotations.filter((_, position) => position !== index);
      setAnnotations(next);
      onAnnotationsChange(next);
    },
    [annotations, onAnnotationsChange],
  );

  return (
    <div className="flex flex-col gap-4">
      <div ref={containerRef} onMouseUp={handleMouseUp} className="relative">
        <pre className="max-h-80 overflow-auto rounded-sm border border-border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink select-text">
          {content}
        </pre>

        {pending && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            style={{ top: pending.top + 4, left: pending.left }}
            className="absolute z-10 rounded-sm border border-border-strong bg-surface-2 px-2 py-1 font-mono text-[10px] tracking-wide text-ink uppercase shadow-md hover:bg-surface-3"
          >
            + comentário
          </button>
        )}

        {pending && composing && (
          <div
            style={{ top: pending.top + 4, left: pending.left }}
            className="absolute z-10 flex w-72 max-w-[calc(100%-1rem)] flex-col gap-2 rounded-sm border border-border-strong bg-surface-2 p-3 shadow-lg"
          >
            <p className="line-clamp-3 font-mono text-[11px] text-ink-faint">“{pending.excerpt}”</p>
            <textarea
              autoFocus
              rows={3}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="O que deve mudar aqui?"
              className="min-h-16 rounded-sm border border-border bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={clearPending}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!noteDraft.trim()}
                onClick={submitAnnotation}
              >
                Adicionar
              </Button>
            </div>
          </div>
        )}
      </div>

      {annotations.length > 0 && (
        <ul className="flex flex-col gap-2">
          {annotations.map((annotation, index) => (
            <li
              key={`${index}-${annotation.excerpt}`}
              className="flex items-start justify-between gap-3 rounded-sm border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-ink-faint">“{annotation.excerpt}”</p>
                <p className="mt-1 text-sm text-ink">{annotation.note}</p>
              </div>
              <Button type="button" variant="danger" onClick={() => removeAnnotation(index)}>
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
