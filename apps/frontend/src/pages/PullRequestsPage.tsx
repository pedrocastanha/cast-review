import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PullRequestCard } from '../components/pulls/PullRequestCard';
import { EmptyState } from '../components/ui/EmptyState';
import { List } from '../components/ui/List';
import { Spinner } from '../components/ui/Spinner';
import { usePullRequests } from '../hooks/usePullRequests';
import { useRepoAnalyses } from '../hooks/useRepoAnalyses';
import type { PullRequest } from '../types';

type StateFilter = 'open' | 'closed' | 'all';

const FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'open', label: 'Abertas' },
  { id: 'closed', label: 'Fechadas' },
  { id: 'all', label: 'Todas' },
];

function matches(pull: PullRequest, filter: StateFilter) {
  if (filter === 'all') return true;
  if (filter === 'closed') return pull.state === 'closed';
  return pull.state !== 'closed';
}

export function PullRequestsPage() {
  const { owner = '', repo = '' } = useParams();
  const { pulls, error, loading } = usePullRequests(repo, owner);
  const { analyses } = useRepoAnalyses(owner, repo);
  const [filter, setFilter] = useState<StateFilter>('open');
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (settled || !pulls) return;
    setSettled(true);
    if (!pulls.some((pull) => matches(pull, 'open'))) setFilter('all');
  }, [pulls, settled]);

  const countByPull = useMemo(() => {
    const counts = new Map<number, number>();
    for (const analysis of analyses ?? []) {
      counts.set(analysis.pullNumber, (counts.get(analysis.pullNumber) ?? 0) + 1);
    }
    return counts;
  }, [analyses]);

  const counts = useMemo(
    () => ({
      open: (pulls ?? []).filter((pull) => matches(pull, 'open')).length,
      closed: (pulls ?? []).filter((pull) => matches(pull, 'closed')).length,
      all: pulls?.length ?? 0,
    }),
    [pulls],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p>;
  }

  if (!pulls || pulls.length === 0) {
    return (
      <EmptyState
        title="Nenhuma pull request"
        description="Esse repositório ainda não tem pull requests abertas ou fechadas."
      />
    );
  }

  const visible = pulls.filter((pull) => matches(pull, filter));

  return (
    <section>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-11 cursor-pointer rounded-full border px-3.5 text-sm font-semibold transition-colors ${
              filter === item.id
                ? 'border-ink bg-ink text-surface-1'
                : 'border-border bg-surface-1 text-ink-dim hover:border-ink-faint hover:text-ink'
            }`}
          >
            {item.label}
            <span className="ml-1.5 font-mono text-[11px] opacity-65">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={filter === 'open' ? 'Nenhuma pull request aberta' : 'Nenhuma pull request fechada'}
          description="Troque o filtro para ver as outras pull requests deste repositório."
        />
      ) : (
        <List>
          {visible.map((pull) => (
            <PullRequestCard
              key={pull.id}
              pull={pull}
              owner={owner}
              repo={repo}
              analysisCount={countByPull.get(pull.number) ?? 0}
            />
          ))}
        </List>
      )}
    </section>
  );
}
