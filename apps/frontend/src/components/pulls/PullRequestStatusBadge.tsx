import type { PullRequest } from '../../types';

export function PullRequestStatusBadge({ pull }: { pull: Pick<PullRequest, 'state' | 'draft'> }) {
  const state = pull.draft ? 'draft' : pull.state === 'closed' ? 'closed' : 'open';

  const labels: Record<typeof state, string> = {
    draft: 'rascunho',
    open: 'aberta',
    closed: 'fechada',
  };

  const styles: Record<typeof state, string> = {
    draft: 'text-state-draft bg-state-draft-dim border border-border',
    open: 'text-state-open bg-state-open-dim',
    closed: 'text-state-closed bg-state-closed-dim',
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase ${styles[state]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[state]}
    </span>
  );
}
