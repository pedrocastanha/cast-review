import type { PullRequest } from '../../types';

export function PullRequestStatusBadge({ pull }: { pull: Pick<PullRequest, 'state' | 'draft'> }) {
  const state = pull.draft ? 'draft' : pull.state === 'closed' ? 'closed' : 'open';

  const labels: Record<typeof state, string> = {
    draft: 'Draft',
    open: 'Open',
    closed: 'Closed',
  };

  const styles: Record<typeof state, string> = {
    draft: 'text-state-draft bg-state-draft-dim',
    open: 'text-state-open bg-state-open-dim',
    closed: 'text-state-closed bg-state-closed-dim',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-xs font-medium tracking-wide uppercase ${styles[state]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {labels[state]}
    </span>
  );
}
