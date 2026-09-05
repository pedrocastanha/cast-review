import { useState } from 'react';
import { Link } from 'react-router-dom';
import { featureCardsApi } from '../../api/feature-cards.api';
import type { FeatureProposal } from '../../types/feature-cards';
import { CitationList } from '../chat/CitationList';

export function ProposalPreview({ proposal, projectId, messageId, shaByRepo }: {
  proposal: FeatureProposal; projectId: string; messageId: string; shaByRepo: Record<string, string>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true); setError('');
    try {
      const cards = await featureCardsApi.save(projectId, messageId);
      if (cards.every((card) => !card.active)) throw new Error('Esta proposta já foi arquivada. Gere uma nova versão na conversa.');
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar'); }
    finally { setSaving(false); }
  }
  return (
    <section className="mt-5 border-y border-border py-5" aria-label="Proposta de feature">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">Proposta · {proposal.tasks.length} cards de execução</p>
      <h3 className="mt-2 font-display text-xl font-bold">{proposal.title}</h3>
      <p className="mt-2 text-sm text-ink-dim">{proposal.problem}</p>
      <p className="mt-2 text-sm">{proposal.objective}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ProposalList title="Escopo" items={proposal.scope} />
        <ProposalList title="Fora do escopo" items={proposal.outOfScope} />
        <ProposalList title="Regras de negócio" items={proposal.businessRules} />
        <ProposalList title="Critérios de aceite" items={proposal.acceptanceCriteria} />
        <ProposalList title="Casos de borda" items={proposal.edgeCases} />
        <ProposalList title="Perguntas abertas" items={proposal.openQuestions} />
      </div>
      <div className="mt-5 divide-y divide-border">
        {proposal.tasks.map((task) => (
          <details key={task.key} className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">{task.area} · {task.title}</summary>
            <p className="mt-3 text-sm text-ink-dim">{task.description}</p>
            <p className="mt-2 text-sm"><strong>Por quê:</strong> {task.rationale}</p>
            <div className="mt-3"><ProposalList title="Aceite" items={task.acceptanceCriteria} /></div>
            <p className="mt-3 text-xs text-ink-faint">{task.confidence === 'grounded' ? 'Contexto localizado no código; alteração proposta' : 'Hipótese técnica a validar'}</p>
            {task.dependsOn.length > 0 && <p className="mt-2 text-xs">Depende de: {task.dependsOn.map((key) => proposal.tasks.find((t) => t.key === key)?.title ?? key).join(', ')}</p>}
            <CitationList citations={task.evidence} shaByRepo={shaByRepo} />
          </details>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-warn">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {saved ? <Link className="text-sm font-semibold text-accent underline" to={`/projects/${projectId}/board`}>Cards salvos · abrir Kanban →</Link> : (
          <button type="button" disabled={saving} onClick={() => void save()} className="min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar proposta no Kanban'}</button>
        )}
        <span className="text-xs text-ink-faint">Refine no chat antes de salvar. Os cards começam em Rascunho.</span>
      </div>
    </section>
  );
}

function ProposalList({ title, items }: { title: string; items: string[] }) {
  return <section><h4 className="text-xs font-semibold text-ink-dim">{title}</h4>{items.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-ink-faint">Nenhum item declarado.</p>}</section>;
}
