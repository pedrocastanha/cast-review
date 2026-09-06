import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { featureCardsApi } from '../../api/feature-cards.api';
import type { CardContent, CardRevision, CardStatus, FeatureCard } from '../../types/feature-cards';
import { CARD_COLUMNS } from '../../types/feature-cards';
import { CitationList } from '../chat/CitationList';

const LIST_FIELDS = [
  ['scope', 'Escopo'], ['outOfScope', 'Fora do escopo'], ['businessRules', 'Regras de negócio'],
  ['acceptanceCriteria', 'Critérios de aceite'], ['edgeCases', 'Casos de borda'], ['openQuestions', 'Perguntas abertas'],
] as const;
const inputClass = 'min-h-11 w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none';
const labelClass = 'grid gap-1 text-xs text-ink-dim';
const asideHeading = 'font-mono text-[10px] tracking-[0.16em] text-ink-faint uppercase';

export function CardEditor({ card, cards, stale, busy, error, onSave, onMove, onArchive }: {
  card: FeatureCard; cards: FeatureCard[]; stale: string[]; busy: boolean;
  /** Falha da última ação neste card, vinda do board. */
  error?: string;
  onSave: (title: string, content: CardContent) => Promise<boolean>;
  onMove: (status: CardStatus) => void;
  onArchive: () => void;
}) {
  const formId = useId();
  const [title, setTitle] = useState(card.title);
  const [fields, setFields] = useState<Record<string, string>>({
    description: card.content.description, rationale: card.content.rationale,
    ...Object.fromEntries(LIST_FIELDS.map(([key]) => [key, card.content[key].join('\n')])),
  });
  const [history, setHistory] = useState<CardRevision[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const shaByRepo = Object.fromEntries(card.snapshot.repositories.filter((r) => r.sha).map((r) => [r.repoId, r.sha!]));
  const names = new Map(cards.map((c) => [c.id, c.title]));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaved(false);
    const content = {
      description: fields.description.trim(), rationale: fields.rationale.trim(),
      ...Object.fromEntries(LIST_FIELDS.map(([key]) => [key, fields[key].split('\n').map((line) => line.trim()).filter(Boolean)])),
    } as CardContent;
    setSaved(await onSave(title, content));
  }

  async function loadHistory() {
    setHistoryLoading(true); setHistoryError('');
    try { setHistory(await featureCardsApi.history(card.projectId, card.id)); }
    catch (err) { setHistoryError(err instanceof Error ? err.message : 'Falha ao carregar histórico'); }
    finally { setHistoryLoading(false); }
  }

  return (
    <>
      <div className="grid gap-7 px-5 py-6 @2xl:grid-cols-[minmax(0,1fr)_17rem] @2xl:items-start @2xl:gap-8 sm:px-7">
        <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-4">
          <label className={labelClass}>
            Título
            <input required maxLength={160} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {([['description', card.parentId ? 'Alteração proposta' : 'Problema'], ['rationale', card.parentId ? 'Por que alterar' : 'Objetivo']] as const).map(([key, label]) => (
            <label className={labelClass} key={key}>
              {label}
              <textarea required maxLength={2000} rows={3} className={inputClass} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
            </label>
          ))}
          <div className="grid gap-4 @2xl:grid-cols-2">
            {LIST_FIELDS.map(([key, label]) => (
              <label className={labelClass} key={key}>
                {label} · um item por linha
                <textarea required={key === 'acceptanceCriteria'} rows={4} className={inputClass} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
              </label>
            ))}
          </div>
        </form>

        <aside className="grid gap-6 border-t border-border pt-6 @2xl:border-t-0 @2xl:pt-0">
          <label className={labelClass}>
            Etapa
            <select
              disabled={busy}
              value={card.status}
              onChange={(e) => onMove(e.target.value as CardStatus)}
              className="min-h-11 w-full rounded-sm border border-border bg-surface px-3 text-sm text-ink"
            >
              {CARD_COLUMNS.map((column) => <option key={column.status} value={column.status}>{column.label}</option>)}
            </select>
          </label>

          {card.parentId && (
            <section>
              <h3 className={asideHeading}>Feature</h3>
              <p className="mt-2 text-sm text-ink-dim">{names.get(card.parentId) ?? card.parentId}</p>
            </section>
          )}

          <section>
            <h3 className={asideHeading}>Dependências</h3>
            {card.dependsOn.length ? (
              <ul className="mt-2 grid gap-1.5 text-sm text-ink-dim">
                {card.dependsOn.map((id) => (
                  <li key={id}>
                    {names.get(id) ?? id}
                    <span className="font-mono text-[11px] text-ink-faint"> · {CARD_COLUMNS.find((column) => column.status === cards.find((c) => c.id === id)?.status)?.label ?? 'Indisponível'}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-ink-faint">Nenhuma declarada.</p>}
          </section>

          <section>
            <h3 className={asideHeading}>Procedência</h3>
            <p className="mt-2 text-sm text-ink-dim">
              {card.snapshot.confidence === 'grounded' ? 'Apoiada em contexto de código' : 'Hipótese técnica a validar'}
            </p>
            {stale.length > 0 && (
              <p role="status" className="mt-2 text-sm leading-[1.45] text-warn">
                Contexto a revisar: {stale.join(', ')}. O card preserva a investigação original.
              </p>
            )}
            <CitationList citations={card.snapshot.evidence} shaByRepo={shaByRepo} />
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[11px] text-ink-dim">Versões consultadas</summary>
              <ul className="mt-2 grid gap-1 font-mono text-[11px] break-all text-ink-faint">
                {card.snapshot.repositories.map((r) => <li key={r.repoId}>{r.repoId} · {r.sha ?? 'sem índice'}{!r.included && ' · omitido'}</li>)}
              </ul>
            </details>
          </section>

          <section>
            <h3 className={asideHeading}>Origem</h3>
            {card.snapshot.threadId && (
              <Link to={`/chat?project=${card.projectId}&thread=${card.snapshot.threadId}&profile=requirements`} className="mt-2 inline-flex min-h-11 items-center text-sm text-accent">
                Abrir conversa →
              </Link>
            )}
            <button type="button" onClick={() => void loadHistory()} disabled={historyLoading} className="block min-h-11 text-sm text-accent disabled:opacity-50">
              {historyLoading ? 'Carregando…' : 'Ver histórico de edições'}
            </button>
            {historyError && <p role="alert" className="text-sm text-fail">{historyError}</p>}
            {history && (
              <div className="grid gap-1">
                {history.map((revision) => (
                  <details key={revision.id} className="border-b border-border py-2">
                    <summary className="cursor-pointer font-mono text-[11px] text-ink-dim">
                      v{revision.version} · {revision.snapshot.status}{!revision.snapshot.active && ' · arquivado'}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-ink-dim">{JSON.stringify(revision.snapshot.content, null, 2)}</pre>
                  </details>
                ))}
              </div>
            )}
          </section>

          {!card.parentId && (
            <section className="border-t border-border pt-4">
              {archiveConfirm ? (
                <div className="grid gap-2 text-sm">
                  <p className="text-ink-dim">Arquivar a feature e todos os cards filhos?</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <button type="button" disabled={busy} onClick={onArchive} className="min-h-11 text-fail">Confirmar</button>
                    <button type="button" onClick={() => setArchiveConfirm(false)} className="min-h-11 text-ink-dim">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setArchiveConfirm(true)} className="min-h-11 text-sm text-ink-faint transition-colors hover:text-ink-dim">
                  Arquivar feature
                </button>
              )}
            </section>
          )}
        </aside>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-x-5 gap-y-2 border-t border-border bg-surface-1 px-5 py-3 sm:px-7">
        {error && <p role="alert" className="mr-auto text-sm text-fail">{error}</p>}
        {saved && !error && <p role="status" className="mr-auto text-sm text-ink-dim">Alterações salvas.</p>}
        <button type="submit" form={formId} disabled={busy} className="min-h-11 rounded-sm bg-accent px-5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50">
          {busy ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>
    </>
  );
}
