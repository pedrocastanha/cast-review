import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import { repositoriesApi } from '../api/repositories.api';
import type { VizGraph } from '../types';

export function useRepoGraph(repo: string, owner: string) {
  const [tree, setTree] = useState<VizGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [leafData, setLeafData] = useState<Record<string, VizGraph>>({});
  const [leafLoading, setLeafLoading] = useState<Set<string>>(new Set());
  const fetchedLeaves = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpandedIds(new Set());
    setLeafData({});
    fetchedLeaves.current = new Set();

    repositoriesApi
      .getGraph(repo, owner)
      .then((data) => {
        if (!cancelled) setTree(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Falha ao carregar o grafo.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repo, owner]);

  const toggleLeaf = useCallback(
    (nodeId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });

      if (fetchedLeaves.current.has(nodeId)) return;
      fetchedLeaves.current.add(nodeId);
      setLeafLoading((prev) => new Set(prev).add(nodeId));

      repositoriesApi
        .getGraph(repo, owner, nodeId)
        .then((data) => {
          setLeafData((prev) => ({ ...prev, [nodeId]: data }));
        })
        .catch(() => {
          fetchedLeaves.current.delete(nodeId); // permite tentar de novo num próximo clique
        })
        .finally(() => {
          setLeafLoading((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        });
    },
    [repo, owner],
  );

  return { tree, error, loading, expandedIds, leafData, leafLoading, toggleLeaf };
}
