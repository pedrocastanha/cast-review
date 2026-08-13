import { useCallback, useEffect, useState } from 'react';
import { analysesApi } from '../api/analyses.api';
import { ApiError } from '../api/http';
import type { AnalysisRecord } from '../types';

export function useRepoAnalyses(owner: string, repo: string, pullNumber?: number) {
  const [analyses, setAnalyses] = useState<AnalysisRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!owner || !repo) {
      setAnalyses([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    analysesApi
      .listByRepo(owner, repo, pullNumber)
      .then((data) => {
        if (!cancelled) setAnalyses(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar análises.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo, pullNumber, reloadToken]);

  return { analyses, error, loading, reload };
}
