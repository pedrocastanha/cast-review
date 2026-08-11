export type AnalysisStatus = 'running' | 'completed' | 'error';

/** Registro em memória de uma execução do pipeline de agentes. */
export interface AnalysisRecord {
  id: string;
  requestedBy: string;
  owner: string;
  repo: string;
  pullNumber: number;
  status: AnalysisStatus;
  report: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
