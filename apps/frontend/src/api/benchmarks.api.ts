import type { BenchmarkCase, BenchmarkRun } from '../types';
import { request } from './http';

export const benchmarksApi = {
  listCases: () => request<BenchmarkCase[]>('/benchmarks/cases'),

  createFromAnalysis: (analysisId: string, title?: string) =>
    request<BenchmarkCase>(
      `/benchmarks/cases/from-analysis/${encodeURIComponent(analysisId)}`,
      { method: 'POST', body: { title } },
    ),

  listRuns: (caseId: string) =>
    request<BenchmarkRun[]>(
      `/benchmarks/cases/${encodeURIComponent(caseId)}/runs`,
    ),

  runCase: (caseId: string, models: string[]) =>
    request<BenchmarkRun>(
      `/benchmarks/cases/${encodeURIComponent(caseId)}/runs`,
      {
        method: 'POST',
        body: { models },
      },
    ),
};
