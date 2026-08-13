export type AnalysisStatus = 'running' | 'completed' | 'error';

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
