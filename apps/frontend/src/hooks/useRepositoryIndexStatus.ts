import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/http';
import { repositoriesApi } from '../api/repositories.api';
import type { RepositoryIndexStatus } from '../types';

const POLL_INTERVAL_MS = 3000;

export function useRepositoryIndexStatus(repo: string, owner: string) {
  const [status, setStatus] = useState<RepositoryIndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const next = await repositoriesApi.getIndexStatus(repo, owner);
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao consultar status de indexação.');
    }
  }, [repo, owner]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.status !== 'queued' && status?.status !== 'indexing') return;

    const timer = setTimeout(fetchStatus, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [status, fetchStatus]);

  const trigger = useCallback(async () => {
    setTriggering(true);
    setError(null);
    try {
      await repositoriesApi.indexRepository(repo, owner);
      setStatus((prev) => ({
        status: 'queued',
        sha: prev?.sha ?? null,
        stale: prev?.stale ?? false,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao iniciar indexação.');
    } finally {
      setTriggering(false);
    }
  }, [repo, owner]);

  return { status, error, triggering, trigger };
}
