import { useCallback, useRef, useState } from 'react';
import { analysesApi } from '../api/analyses.api';
import type {
  ApproveStagePayload,
  ApprovePublishPayload,
  ResumeAnalysisPayload,
} from '../api/analyses.api';
import { ApiError } from '../api/http';
import { assembleReport } from '../lib/assemble-report';
import type { AgentEvent, AgentEventType, RunAnalysisPayload } from '../types';

export type RunPhase = 'idle' | 'running' | 'completed' | 'error' | 'awaiting_approval';

export type AwaitingStage = 'prd' | 'spec' | 'publish' | null;

export function useAnalysisRun() {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [thoughts, setThoughts] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [awaitingStage, setAwaitingStage] = useState<AwaitingStage>(null);
  const [iteration, setIteration] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setEvents([]);
    setThoughts({});
    setErrorMessage(null);
    setAwaitingStage(null);
    setIteration(null);
  }, []);

  /** Aplica um único AgentEvent ao estado do hook — usado por start/resume/approveStage. */
  const processEvent = useCallback((event: AgentEvent) => {
    if (event.type === 'thought') {
      const step = String(event.payload.step ?? '');
      const delta = String(event.payload.delta ?? '');
      if (step && delta) {
        setThoughts((current) => ({
          ...current,
          [step]: `${current[step] ?? ''}${delta}`,
        }));
      }
      return;
    }

    setEvents((current) => [...current, event]);

    if (event.type === 'error') {
      setPhase('error');
      setErrorMessage(String(event.payload.message ?? 'Falha no pipeline de agentes'));
      return;
    }

    if (event.type === 'report_ready') {
      setPhase('completed');
      return;
    }

    if (event.type === 'awaiting_approval') {
      const stage = event.payload.stage;
      setPhase('awaiting_approval');
      setAwaitingStage(stage === 'prd' || stage === 'spec' || stage === 'publish' ? stage : null);
      const iterationValue = event.payload.iteration;
      setIteration(typeof iterationValue === 'number' ? iterationValue : null);
    }
  }, []);

  /** Consome um AsyncGenerator<AgentEvent> aplicando cada evento via processEvent, com tratamento de erro/abort compartilhado. */
  const runEventLoop = useCallback(
    async (generator: AsyncGenerator<AgentEvent>, controller: AbortController) => {
      try {
        for await (const event of generator) {
          processEvent(event);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setPhase('error');
        setErrorMessage(err instanceof ApiError ? err.message : 'Falha ao rodar a análise.');
      }
    },
    [processEvent],
  );

  const start = useCallback(
    async (repo: string, pullNumber: number, owner: string, payload: RunAnalysisPayload) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('running');
      setEvents([]);
      setThoughts({});
      setErrorMessage(null);
      setAwaitingStage(null);
      setIteration(null);

      await runEventLoop(
        analysesApi.run(repo, pullNumber, owner, payload, controller.signal),
        controller,
      );
    },
    [runEventLoop],
  );

  const resume = useCallback(
    async (analysisId: string, payload: ResumeAnalysisPayload) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('running');
      setErrorMessage(null);
      setAwaitingStage(null);
      setIteration(null);

      await runEventLoop(analysesApi.resume(analysisId, payload, controller.signal), controller);
    },
    [runEventLoop],
  );

  const approveStage = useCallback(
    async (analysisId: string, payload: ApproveStagePayload) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('running');
      setErrorMessage(null);
      setAwaitingStage(null);
      setIteration(null);

      await runEventLoop(
        analysesApi.approveStage(analysisId, payload, controller.signal),
        controller,
      );
    },
    [runEventLoop],
  );

  const approvePublish = useCallback(
    async (analysisId: string, payload: ApprovePublishPayload): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setErrorMessage(null);

      try {
        const record = await analysesApi.approvePublish(analysisId, payload);
        if (controller.signal.aborted) return;

        if (record.status === 'completed') {
          setPhase('completed');
          setAwaitingStage(null);
        } else if (record.status === 'error') {
          setPhase('error');
          setErrorMessage(record.errorMessage ?? 'Falha ao publicar a análise.');
        } else if (record.status === 'awaiting_approval') {
          setPhase('awaiting_approval');
          setAwaitingStage(record.approvalStage);
        } else {
          setPhase('running');
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setPhase('error');
        setErrorMessage(err instanceof ApiError ? err.message : 'Falha ao publicar a análise.');
      }
    },
    [],
  );

  const latest = (type: AgentEventType) =>
    [...events].reverse().find((event) => event.type === type);

  const report = assembleReport(events);

  return {
    phase,
    events,
    errorMessage,
    awaitingStage,
    iteration,
    start,
    resume,
    approveStage,
    approvePublish,
    reset,
    latest,
    report,
    thoughts,
  };
}
