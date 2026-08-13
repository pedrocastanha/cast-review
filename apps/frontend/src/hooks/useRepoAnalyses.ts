import { useEffect, useState } from 'react';
import { analysesApi } from '../api/analyses.api';
import { ApiError } from '../api/http';
import type { AnalysisRecord } from '../types';

export function useRepoAnalyses(owner: string, repo: string, pullNumber?: number) {
  const [analyses, setAnalyses] = useState<AnalysisRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    analysesApi
      .listByRepo(owner, repo, pullNumber)
      .then((data) => {
        if (!cancelled) setAnalyses(data ?? []);
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
  }, [owner, repo, pullNumber]);

  return { analyses, error, loading };
}
