import { useEffect, useState } from 'react';
import { ApiError } from '../api/http';
import { repositoriesApi } from '../api/repositories.api';
import type { Repository } from '../types';

export function useRepositories(enabled: boolean) {
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    repositoriesApi
      .list()
      .then((data) => {
        if (!cancelled) setRepos(data ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar repositórios.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { repos, error, loading };
}
