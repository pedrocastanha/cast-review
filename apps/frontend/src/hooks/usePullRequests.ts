import { useEffect, useState } from 'react';
import { ApiError } from '../api/http';
import { repositoriesApi } from '../api/repositories.api';
import type { PullRequest } from '../types';

export function usePullRequests(repo: string, owner: string) {
  const [pulls, setPulls] = useState<PullRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    repositoriesApi
      .listPulls(repo, owner)
      .then((data) => {
        if (!cancelled) setPulls(data ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar pull requests.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repo, owner]);

  return { pulls, error, loading };
}
