import { useCallback, useRef, useState } from 'react';
import { analysesApi } from '../api/analyses.api';
import { ApiError } from '../api/http';
import { assembleReport } from '../lib/assemble-report';
import type { AgentEvent, AgentEventType, RunAnalysisPayload } from '../types';

export type RunPhase = 'idle' | 'running' | 'completed' | 'error';

export function useAnalysisRun() {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [thoughts, setThoughts] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setEvents([]);
    setThoughts({});
    setErrorMessage(null);
  }, []);

  const start = useCallback(
    async (repo: string, pullNumber: number, owner: string, payload: RunAnalysisPayload) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('running');
      setEvents([]);
      setThoughts({});
      setErrorMessage(null);

      try {
        for await (const event of analysesApi.run(
          repo,
          pullNumber,
          owner,
          payload,
          controller.signal,
        )) {
          if (event.type === 'thought') {
            const step = String(event.payload.step ?? '');
            const delta = String(event.payload.delta ?? '');
            if (step && delta) {
              setThoughts((current) => ({
                ...current,
                [step]: `${current[step] ?? ''}${delta}`,
              }));
            }
            continue;
          }

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

  const report = assembleReport(events);

  return { phase, events, errorMessage, start, reset, latest, report, thoughts };
}
