import { useCallback, useRef, useState } from 'react';
import { analysesApi } from '../api/analyses.api';
import { ApiError } from '../api/http';
import type { AgentEvent, AgentEventType, ReportPayload, RunAnalysisPayload } from '../types';

export type RunPhase = 'idle' | 'running' | 'completed' | 'error';

export function useAnalysisRun() {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setEvents([]);
    setErrorMessage(null);
  }, []);

  const start = useCallback(
    async (repo: string, pullNumber: number, owner: string, payload: RunAnalysisPayload) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('running');
      setEvents([]);
      setErrorMessage(null);

      try {
        for await (const event of analysesApi.run(
          repo,
          pullNumber,
          owner,
          payload,
          controller.signal,
        )) {
          setEvents((current) => [...current, event]);

          if (event.type === 'error') {
            setPhase('error');
            setErrorMessage(String(event.payload.message ?? 'Falha no pipeline de agentes'));
            return;
          }

          if (event.type === 'report_ready') {
            setPhase('completed');
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setPhase('error');
        setErrorMessage(err instanceof ApiError ? err.message : 'Falha ao rodar a análise.');
      }
    },
    [],
  );

  const latest = (type: AgentEventType) =>
    [...events].reverse().find((event) => event.type === type);

  const report = latest('report_ready')?.payload as ReportPayload | undefined;

  const thoughts: Record<string, string> = {};
  for (const event of events) {
    if (event.type !== 'thought') continue;
    const step = String(event.payload.step ?? '');
    const delta = String(event.payload.delta ?? '');
    if (!step || !delta) continue;
    thoughts[step] = `${thoughts[step] ?? ''}${delta}`;
  }

  return { phase, events, errorMessage, start, reset, latest, report, thoughts };
}
