import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/http';
import { repositoriesApi } from '../api/repositories.api';
import { ConcurrencyQueue } from '../lib/concurrency-queue';
import type { RepositoryIndexStatus } from '../types';

const POLL_INTERVAL_MS = 3000;

// Compartilhada entre todos os RepositoryCard montados — sem isso, uma lista
// com muitos repos dispara 1 requisição pra cada de uma vez e estoura conexão
// simultânea com a API do Github (erro de socket, não HTTP, no backend).
const githubStatusQueue = new ConcurrencyQueue(4);

export function useRepositoryIndexStatus(repo: string, owner: string) {
  const [status, setStatus] = useState<RepositoryIndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const next = await githubStatusQueue.run(() =>
        repositoriesApi.getIndexStatus(repo, owner),
      );
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
      await githubStatusQueue.run(() =>
        repositoriesApi.indexRepository(repo, owner),
      );
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
