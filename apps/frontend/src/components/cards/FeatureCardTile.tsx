import { adjacentStatus, cardSeal } from '../../lib/feature-cards';
import { CARD_COLUMNS, type CardStatus, type FeatureCard } from '../../types/feature-cards';

const LABELS = new Map(CARD_COLUMNS.map((column) => [column.status, column.label] as const));

interface Flag {
  glyph: string;
  text: string;
  title?: string;
}

/** pedrocastanha/cast-backend → cast-backend: o dono repete em todos e não distingue nada. */
const repoName = (repoId: string) => repoId.slice(repoId.lastIndexOf('/') + 1);

export function FeatureCardTile({ card, parentTitle, blockedBy, stale, selected, busy, error, onSelect, onMove }: {
  card: FeatureCard;
  parentTitle?: string;
  blockedBy: string[];
  stale: string[];
  selected: boolean;
  busy: boolean;
  /** Falha da última ação neste card — mostrada aqui, não no topo da página. */
  error?: string;
  onSelect: () => void;
  onMove: (status: CardStatus) => void;
}) {
  const seal = cardSeal(card);
  const criteria = card.content.acceptanceCriteria.length;
  const previous = adjacentStatus(card.status, -1);
  const next = adjacentStatus(card.status, 1);

  const flags: Flag[] = [];
  if (blockedBy.length) flags.push({ glyph: '⊘', text: `Bloqueado por ${blockedBy.join(' · ')}` });
  if (!criteria) flags.push({ glyph: '—', text: 'Sem critério de aceite' });
  if (card.content.openQuestions.length) flags.push({ glyph: '?', text: `${card.content.openQuestions.length} ${card.content.openQuestions.length === 1 ? 'decisão pendente' : 'decisões pendentes'}` });
  if (stale.length) {
    flags.push({
      glyph: '△',
      text: stale.length > 2 ? `${stale.length} repositórios a reavaliar` : `Contexto a reavaliar · ${stale.map(repoName).join(', ')}`,
      title: stale.join(', '),
    });
  }

  return (
    <article
      draggable={!busy}
      onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
      className={`group relative grid min-w-0 gap-2 rounded-sm border bg-surface-1 p-3 transition-[border-color,transform,box-shadow] duration-200 ease-precise ${
        selected
          ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]'
          : 'border-border hover:-translate-y-px hover:border-border-strong'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <p className="font-mono flex items-baseline justify-between gap-2 text-[10px] tracking-[0.16em] text-ink-faint uppercase">
        <span className="truncate">{card.parentId ? card.area : 'Feature'}</span>
        <span
          className={`shrink-0 ${seal.grounded ? 'text-ink-dim' : ''}`}
          title={seal.grounded ? 'Proposta apoiada em contexto de código' : 'Hipótese técnica a validar'}
        >
          {seal.grounded && seal.sha ? `◆ ${seal.sha}` : seal.grounded ? '◆ contexto' : '◇ hipótese'}
        </span>
      </p>

      <h3 className="text-[0.9375rem] leading-[1.35] font-semibold tracking-[-0.01em]">
        <button
          type="button"
          onClick={onSelect}
          className="text-left transition-colors after:absolute after:inset-0 after:content-[''] hover:text-accent"
        >
          <span className="line-clamp-3">{card.title}</span>
        </button>
      </h3>

      {parentTitle && (
        <p className="font-mono truncate text-[11px] text-ink-faint" title={parentTitle}>
          ↳ {parentTitle}
        </p>
      )}

      {criteria > 0 && (
        <p className="font-mono text-[11px] tabular-nums text-ink-dim">
          {criteria} {criteria === 1 ? 'critério' : 'critérios'}
        </p>
      )}

      {flags.length > 0 && (
        <ul className="grid gap-1 text-[11px] leading-[1.45] text-warn">
          {flags.map((flag) => (
            <li key={flag.text} title={flag.title} className="flex gap-1.5">
              <span aria-hidden="true" className="font-mono shrink-0">{flag.glyph}</span>
              <span className="min-w-0">{flag.text}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="flex gap-1.5 text-[11px] leading-[1.45] text-fail">
          <span aria-hidden="true" className="font-mono shrink-0">⨯</span>
          <span className="min-w-0">{error}</span>
        </p>
      )}

      <div className="relative z-10 grid grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-precise md:pointer-fine:grid-rows-[0fr] md:group-hover:grid-rows-[1fr] md:group-focus-within:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <MoveButton
              glyph="←"
              target={previous}
              card={card}
              busy={busy}
              onMove={onMove}
            />
            <span className="font-mono truncate text-[10px] tracking-[0.14em] text-ink-faint uppercase">
              {LABELS.get(card.status)}
            </span>
            <MoveButton
              glyph="→"
              target={next}
              card={card}
              busy={busy}
              onMove={onMove}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function MoveButton({ glyph, target, card, busy, onMove }: {
  glyph: string;
  target: CardStatus | null;
  card: FeatureCard;
  busy: boolean;
  onMove: (status: CardStatus) => void;
}) {
  return (
    <button
      type="button"
      disabled={!target || busy}
      onClick={() => target && onMove(target)}
      aria-label={target ? `Mover ${card.title} para ${LABELS.get(target)}` : `${card.title} já está na ponta do fluxo`}
      className="font-mono grid size-11 shrink-0 place-items-center rounded-sm border border-border text-ink-dim transition-colors hover:border-border-strong hover:text-ink disabled:opacity-25 disabled:hover:border-border md:pointer-fine:size-7"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
