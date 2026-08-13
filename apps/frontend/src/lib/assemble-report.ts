import type { AgentEvent, AgentEventType, Finding, ReportPayload, ReviewResult } from '../types';

function latest(events: AgentEvent[], type: AgentEventType) {
  return [...events].reverse().find((event) => event.type === type);
}

function asReview(name: string, payload: Record<string, unknown> | undefined): ReviewResult | null {
  if (!payload) return null;
  const score = typeof payload.score === 'number' ? payload.score : 0;
  const findings = Array.isArray(payload.findings) ? (payload.findings as Finding[]) : [];
  return { name, score, findings };
}

export function assembleReport(events: AgentEvent[]): ReportPayload | undefined {
  const ready = latest(events, 'report_ready')?.payload as ReportPayload | undefined;
  const changeAnalysis = latest(events, 'change_analysis_done')?.payload as ReportPayload['changeAnalysis'];
  const prd = (latest(events, 'prd_generated')?.payload as ReportPayload['prd']) ?? ready?.prd;
  const spec = (latest(events, 'spec_generated')?.payload as ReportPayload['spec']) ?? ready?.spec;
  const test = asReview('test_reviewer', latest(events, 'test_reviewer_done')?.payload);
  const architecture = asReview(
    'architecture_reviewer',
    latest(events, 'architecture_reviewer_done')?.payload,
  );

  const results =
    ready?.results ?? ([test, architecture].filter(Boolean) as ReviewResult[]);

  if (!ready && !prd && !spec && results.length === 0 && !changeAnalysis) {
    return undefined;
  }

  return {
    changeAnalysis: changeAnalysis ?? ready?.changeAnalysis,
    prd: prd ?? null,
    spec: spec ?? null,
    results,
    comments: results.flatMap((result) =>
      result.findings.map((finding) => ({ reviewer: result.name, ...finding })),
    ),
    markdown: ready?.markdown ?? '',
  };
}
