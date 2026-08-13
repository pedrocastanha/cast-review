import type {
  AnalysisReview,
  ChangeAnalysis,
  ReviewComment,
  ReviewFinding,
  ReviewResult,
} from '../analyses.types';

const FINDING_STATUS = new Set(['fail', 'warning', 'pass']);

export function emptyReview(): AnalysisReview {
  return { results: [], comments: [] };
}

export function applyReviewEvent(
  current: AnalysisReview,
  type: string,
  payload: Record<string, unknown>,
): AnalysisReview {
  const next: AnalysisReview = {
    ...current,
    results: [...current.results],
    comments: [...current.comments],
  };

  switch (type) {
    case 'change_analysis_done':
      next.changeAnalysis = normalizeChangeAnalysis(payload);
      break;
    case 'prd_generated':
      next.prd = payload;
      break;
    case 'spec_generated':
      next.spec = payload;
      break;
    case 'test_reviewer_done':
      next.results = upsertResult(next.results, 'test_reviewer', payload);
      break;
    case 'architecture_reviewer_done':
      next.results = upsertResult(
        next.results,
        'architecture_reviewer',
        payload,
      );
      break;
    case 'report_ready':
      if (isRecord(payload.prd) || payload.prd === null) {
        next.prd = payload.prd;
      }
      if (isRecord(payload.spec) || payload.spec === null) {
        next.spec = payload.spec;
      }
      if (Array.isArray(payload.results)) {
        next.results = payload.results
          .map((item) => normalizeResult(item, ''))
          .filter((item): item is ReviewResult => item !== null);
      }
      if (typeof payload.markdown === 'string') {
        next.markdown = payload.markdown;
      }
      if (isRecord(payload.changeAnalysis)) {
        next.changeAnalysis = normalizeChangeAnalysis(payload.changeAnalysis);
      }
      break;
    default:
      return current;
  }

  next.comments = flattenComments(next.results);
  return next;
}

export function hydrateReview(
  raw: AnalysisReview | Record<string, unknown> | null | undefined,
): AnalysisReview | null {
  if (!raw) return null;
  raw = raw as Record<string, unknown>;

  const results = Array.isArray(raw.results)
    ? raw.results
        .map((item) => normalizeResult(item, ''))
        .filter((item): item is ReviewResult => item !== null)
    : [];

  const comments = Array.isArray(raw.comments)
    ? raw.comments
        .map((item) => normalizeComment(item))
        .filter((item): item is ReviewComment => item !== null)
    : flattenComments(results);

  return {
    changeAnalysis: isRecord(raw.changeAnalysis)
      ? normalizeChangeAnalysis(raw.changeAnalysis)
      : undefined,
    prd: raw.prd === null ? null : isRecord(raw.prd) ? raw.prd : undefined,
    spec: raw.spec === null ? null : isRecord(raw.spec) ? raw.spec : undefined,
    results,
    comments,
    markdown: typeof raw.markdown === 'string' ? raw.markdown : undefined,
  };
}

export function flattenComments(results: ReviewResult[]): ReviewComment[] {
  return results.flatMap((result) =>
    result.findings.map((finding) => ({
      reviewer: result.name,
      ...finding,
    })),
  );
}

function normalizeChangeAnalysis(
  value: Record<string, unknown>,
): ChangeAnalysis {
  const files = Array.isArray(value.files)
    ? value.files.flatMap((item) => {
        if (!isRecord(item) || !isNonEmptyString(item.path)) return [];
        return [
          {
            path: item.path,
            kind: isNonEmptyString(item.kind) ? item.kind : 'source',
            extension: typeof item.extension === 'string' ? item.extension : '',
          },
        ];
      })
    : [];

  return {
    files,
    hasTests: Boolean(value.hasTests),
    hasMigration: Boolean(value.hasMigration),
  };
}

function upsertResult(
  results: ReviewResult[],
  name: string,
  payload: Record<string, unknown>,
): ReviewResult[] {
  const next = normalizeResult({ ...payload, name }, name);
  if (!next) return results;
  const index = results.findIndex((item) => item.name === name);
  if (index === -1) return [...results, next];
  return results.map((item, current) => (current === index ? next : item));
}

function normalizeResult(
  value: unknown,
  fallbackName: string,
): ReviewResult | null {
  if (!isRecord(value)) return null;
  const name = isNonEmptyString(value.name) ? value.name : fallbackName;
  if (!name) return null;
  const score =
    typeof value.score === 'number' && Number.isFinite(value.score)
      ? value.score
      : 0;
  const findings = Array.isArray(value.findings)
    ? value.findings
        .map((item) => normalizeFinding(item))
        .filter((item): item is ReviewFinding => item !== null)
    : [];
  return { name, score, findings };
}

function normalizeFinding(value: unknown): ReviewFinding | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (typeof status !== 'string' || !FINDING_STATUS.has(status)) return null;
  return {
    status: status as ReviewFinding['status'],
    title: isNonEmptyString(value.title) ? value.title : 'Finding',
    detail: typeof value.detail === 'string' ? value.detail : '',
    businessRule: optionalString(value.businessRule ?? value.business_rule),
    conventionRef: optionalString(value.conventionRef ?? value.convention_ref),
  };
}

function normalizeComment(value: unknown): ReviewComment | null {
  const finding = normalizeFinding(value);
  if (!finding || !isRecord(value) || !isNonEmptyString(value.reviewer))
    return null;
  return { reviewer: value.reviewer, ...finding };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}
