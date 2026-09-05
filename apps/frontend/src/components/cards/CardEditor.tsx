import { useState } from 'react';
import { Link } from 'react-router-dom';
import { featureCardsApi } from '../../api/feature-cards.api';
import type { CardContent, CardRevision, FeatureCard } from '../../types/feature-cards';
import { CARD_COLUMNS } from '../../types/feature-cards';
import { CitationList } from '../chat/CitationList';

const LIST_FIELDS = [
  ['scope', 'Escopo'], ['outOfScope', 'Fora do escopo'], ['businessRules', 'Regras de negócio'],
  ['acceptanceCriteria', 'Critérios de aceite'], ['edgeCases', 'Casos de borda'], ['openQuestions', 'Perguntas abertas'],
] as const;
const inputClass = 'min-h-11 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none';

export function CardEditor({ card, cards, stale, busy, onSave, onClose, onArchive }: {
  card: FeatureCard; cards: FeatureCard[]; stale: string[]; busy: boolean;
  onSave: (title: string, content: CardContent) => Promise<boolean>;
  onClose: () => void; onArchive: () => void;
}) {
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
  const shaByRepo = Object.fromEntries(card.snapshot.repositories.filter((r) => r.sha).map((r) => [r.repoId, r.sha! ]));
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
    <section aria-label="Detalhes do card" className="border-t border-border bg-surface-1 p-5 lg:border-t-0 lg:border-l">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">{card.area} · versão {card.version} · {CARD_COLUMNS.find((c) => c.status === card.status)?.label}</p>
        <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm text-ink-dim">Fechar</button>
      </div>
      {card.parentId && <p className="mb-3 text-xs text-ink-dim">Feature: {names.get(card.parentId) ?? card.parentId}</p>}
      {stale.length > 0 && <p role="status" className="mb-4 text-sm text-warn">Contexto precisa de revisão: {stale.join(', ')}. Os cards preservam a investigação original.</p>}
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <label className="grid gap-1 text-xs text-ink-dim">Título<input required maxLength={160} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {([['description', card.parentId ? 'Alteração proposta' : 'Problema'], ['rationale', card.parentId ? 'Por que alterar' : 'Objetivo']] as const).map(([key, label]) => (
          <label className="grid gap-1 text-xs text-ink-dim" key={key}>{label}<textarea required maxLength={2000} rows={3} className={inputClass} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></label>
        ))}
        {LIST_FIELDS.map(([key, label]) => (
          <label className="grid gap-1 text-xs text-ink-dim" key={key}>{label} · um item por linha<textarea required={key === 'acceptanceCriteria'} rows={3} className={inputClass} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></label>
        ))}
        <button type="submit" disabled={busy} className="min-h-11 rounded bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar alterações'}</button>
        {saved && <p role="status" className="text-sm text-ink-dim">Alterações salvas.</p>}
      </form>
      <div className="mt-6 border-t border-border pt-4 text-sm">
        <h3 className="font-semibold">Dependências</h3>
        {card.dependsOn.length ? <ul className="mt-2 space-y-2 text-ink-dim">{card.dependsOn.map((id) => <li key={id}>{names.get(id) ?? id} · {CARD_COLUMNS.find((column) => column.status === cards.find((c) => c.id === id)?.status)?.label ?? 'Indisponível'}</li>)}</ul> : <p className="mt-2 text-ink-faint">Nenhuma dependência declarada.</p>}
        <p className="mt-4 text-xs text-ink-faint">{card.snapshot.confidence === 'grounded' ? 'Proposta apoiada em contexto de código' : 'Hipótese técnica a validar'}</p>
        <CitationList citations={card.snapshot.evidence} shaByRepo={shaByRepo} />
        <details className="mt-4"><summary className="cursor-pointer text-xs text-ink-dim">Versões consultadas</summary><ul className="mt-2 space-y-1 break-all text-xs text-ink-faint">{card.snapshot.repositories.map((r) => <li key={r.repoId}>{r.repoId} · {r.sha ?? 'sem índice'}{!r.included && ' · omitido'}</li>)}</ul></details>
      </div>
      <div className="mt-5 border-t border-border pt-4">
        {card.snapshot.threadId && <Link to={`/chat?project=${card.projectId}&thread=${card.snapshot.threadId}&profile=requirements`} className="block py-2 text-sm text-accent">Abrir conversa de origem →</Link>}
        <button type="button" onClick={() => void loadHistory()} disabled={historyLoading} className="min-h-11 text-sm text-accent">{historyLoading ? 'Carregando…' : 'Ver histórico de edições'}</button>
        {historyError && <p role="alert" className="text-sm text-warn">{historyError}</p>}
        {history && <div className="space-y-2">{history.map((revision) => <details key={revision.id} className="border-b border-border py-2"><summary className="cursor-pointer text-xs">Versão {revision.version} · {revision.snapshot.title} · {revision.snapshot.status}{!revision.snapshot.active && ' · arquivado'}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-ink-dim">{JSON.stringify(revision.snapshot.content, null, 2)}</pre></details>)}</div>}
      </div>
      {!card.parentId && <div className="mt-5 border-t border-border pt-4">{archiveConfirm ? <div className="flex flex-wrap items-center gap-3 text-sm"><p>Arquivar esta feature e todos os cards filhos?</p><button type="button" disabled={busy} onClick={onArchive} className="min-h-11 text-warn">Confirmar arquivamento</button><button type="button" onClick={() => setArchiveConfirm(false)}>Cancelar</button></div> : <button type="button" onClick={() => setArchiveConfirm(true)} className="min-h-11 text-sm text-ink-faint">Arquivar feature</button>}</div>}
    </section>
  );
}
