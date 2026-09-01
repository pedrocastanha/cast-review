import type {
  AnalysisReview,
  AnalysisUsage,
  ChangeAnalysis,
  FindingLifecycleMeta,
  FindingLifecycleSummary,
  GithubCommentsResult,
  ReviewComment,
  ReviewFinding,
  ReviewResult,
  StepUsage,
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
      next.usage = upsertStepUsage(next.usage, payload.usage);
      break;
    case 'prd_generated':
      next.prd = omitUsage(payload);
      next.usage = upsertStepUsage(next.usage, payload.usage);
      break;
    case 'spec_generated':
      next.spec = omitUsage(payload);
      next.usage = upsertStepUsage(next.usage, payload.usage);
      break;
    case 'test_reviewer_done':
      next.results = upsertResult(next.results, 'test_reviewer', payload);
      next.usage = upsertStepUsage(next.usage, payload.usage);
      break;
    case 'architecture_reviewer_done':
      next.results = upsertResult(
        next.results,
        'architecture_reviewer',
        payload,
      );
      next.usage = upsertStepUsage(next.usage, payload.usage);
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
      if (
        payload.verdict === 'approve' ||
        payload.verdict === 'comment' ||
        payload.verdict === 'request_changes'
      ) {
        next.verdict = payload.verdict;
      }
      if (typeof payload.overallScore === 'number') {
        next.overallScore = payload.overallScore;
      }
      if (typeof payload.failCount === 'number') {
        next.failCount = payload.failCount;
      }
      if (typeof payload.warningCount === 'number') {
        next.warningCount = payload.warningCount;
      }
      if (typeof payload.headline === 'string') {
        next.headline = payload.headline;
      }
      if (
        payload.conventionsSource === 'repo' ||
        payload.conventionsSource === 'default'
      ) {
        next.conventionsSource = payload.conventionsSource;
      }
      // report_ready traz o agregado do Python; é a fonte de verdade do total.
      if (isAnalysisUsage(payload.usage)) {
        next.usage = payload.usage;
      }
      break;
    case 'github_comments_done':
      next.githubComments = normalizeGithubComments(payload);
      break;
    case 'finding_lifecycle_done':
      next.findingLifecycle = normalizeFindingLifecycleSummary(payload);
      break;
    default:
      return current;
  }

  if (
    type === 'test_reviewer_done' ||
    type === 'architecture_reviewer_done' ||
    type === 'report_ready'
  ) {
    next.comments = flattenComments(next.results);
  }
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
    verdict:
      raw.verdict === 'approve' ||
      raw.verdict === 'comment' ||
      raw.verdict === 'request_changes'
        ? raw.verdict
        : undefined,
    overallScore:
      typeof raw.overallScore === 'number' ? raw.overallScore : undefined,
    failCount: typeof raw.failCount === 'number' ? raw.failCount : undefined,
    warningCount:
      typeof raw.warningCount === 'number' ? raw.warningCount : undefined,
    headline: typeof raw.headline === 'string' ? raw.headline : undefined,
    conventionsSource:
      raw.conventionsSource === 'repo' || raw.conventionsSource === 'default'
        ? raw.conventionsSource
        : undefined,
    usage: isAnalysisUsage(raw.usage) ? raw.usage : undefined,
    githubComments: normalizeGithubComments(raw.githubComments),
    findingLifecycle: normalizeFindingLifecycleSummary(raw.findingLifecycle),
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
    path: optionalString(value.path),
    line: asCount(value.line) || undefined,
    endLine: asCount(value.endLine ?? value.end_line) || undefined,
    evidenceId: optionalString(value.evidenceId ?? value.evidence_id),
  };
}

function normalizeComment(value: unknown): ReviewComment | null {
  const finding = normalizeFinding(value);
  if (!finding || !isRecord(value) || !isNonEmptyString(value.reviewer))
    return null;
  return {
    reviewer: value.reviewer,
    ...finding,
    lifecycle: normalizeFindingLifecycleMeta(value.lifecycle),
  };
}

function normalizeFindingLifecycleMeta(
  value: unknown,
): FindingLifecycleMeta | undefined {
  if (!isRecord(value)) return undefined;
  const classification = value.classification;
  const disposition = value.disposition;
  const matchBasis = value.matchBasis;
  if (
    !isNonEmptyString(value.caseId) ||
    (classification !== 'new' &&
      classification !== 'recurring' &&
      classification !== 'reopened') ||
    value.state !== 'active' ||
    (disposition !== 'unreviewed' &&
      disposition !== 'accepted_risk' &&
      disposition !== 'false_positive') ||
    (matchBasis !== 'stable_anchor' && matchBasis !== 'title_fallback') ||
    !isNonEmptyString(value.firstSeenAnalysisId)
  ) {
    return undefined;
  }
  return {
    caseId: value.caseId,
    classification,
    state: 'active',
    disposition,
    matchBasis,
    firstSeenAnalysisId: value.firstSeenAnalysisId,
    previousOccurrenceAnalysisId: isNonEmptyString(
      value.previousOccurrenceAnalysisId,
    )
      ? value.previousOccurrenceAnalysisId
      : null,
  };
}

function normalizeFindingLifecycleSummary(
  value: unknown,
): FindingLifecycleSummary | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status !== 'available' && value.status !== 'unavailable') {
    return undefined;
  }
  return {
    status: value.status,
    baselineAnalysisId: isNonEmptyString(value.baselineAnalysisId)
      ? value.baselineAnalysisId
      : null,
    modelChanged: Boolean(value.modelChanged),
    newCount: asCount(value.newCount),
    recurringCount: asCount(value.recurringCount),
    reopenedCount: asCount(value.reopenedCount),
    notObservedCount: asCount(value.notObservedCount),
    acknowledgedCount: asCount(value.acknowledgedCount),
    suppressedFromGithubCount: asCount(value.suppressedFromGithubCount),
    errorCode:
      value.errorCode === 'reconciliation_failed'
        ? 'reconciliation_failed'
        : undefined,
  };
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

const STEP_NAMES = new Set([
  'change_analyzer',
  'prd',
  'implementation_spec',
  'test_reviewer',
  'architecture_reviewer',
  'report_builder',
]);

const STEP_ORDER = [
  'change_analyzer',
  'prd',
  'implementation_spec',
  'test_reviewer',
  'architecture_reviewer',
  'report_builder',
];

function omitUsage(payload: Record<string, unknown>): Record<string, unknown> {
  const { usage: _usage, ...rest } = payload;
  return rest;
}

function upsertStepUsage(
  current: AnalysisUsage | undefined,
  raw: unknown,
): AnalysisUsage | undefined {
  const step = normalizeStepUsage(raw);
  if (!step) return current;
  const steps = [
    ...(current?.steps ?? []).filter((item) => item.step !== step.step),
    step,
  ];
  return sumUsage(steps, current?.pricingAsOf ?? '');
}

function sumUsage(steps: StepUsage[], pricingAsOf: string): AnalysisUsage {
  const ordered = [...steps].sort(
    (left, right) =>
      STEP_ORDER.indexOf(left.step) - STEP_ORDER.indexOf(right.step),
  );
  const known = ordered
    .map((item) => item.costUsd)
    .filter((value): value is number => typeof value === 'number');
  const incomplete = ordered.some(
    (item) =>
      !item.skipped && (item.costUsd === null || item.source === 'missing'),
  );
  return {
    currency: 'USD',
    promptTokens: ordered.reduce((sum, item) => sum + item.promptTokens, 0),
    cachedTokens: ordered.reduce((sum, item) => sum + item.cachedTokens, 0),
    completionTokens: ordered.reduce(
      (sum, item) => sum + item.completionTokens,
      0,
    ),
    totalTokens: ordered.reduce((sum, item) => sum + item.totalTokens, 0),
    costUsd: known.length
      ? known.reduce((sum, value) => sum + value, 0)
      : incomplete
        ? null
        : 0,
    costComplete: !incomplete,
    pricingAsOf,
    steps: ordered,
  };
}

function normalizeStepUsage(value: unknown): StepUsage | null {
  if (!isRecord(value) || !STEP_NAMES.has(String(value.step))) return null;
  return {
    step: value.step as StepUsage['step'],
    label: isNonEmptyString(value.label) ? value.label : String(value.step),
    model: isNonEmptyString(value.model) ? value.model : null,
    promptTokens: asCount(value.promptTokens),
    cachedTokens: asCount(value.cachedTokens),
    completionTokens: asCount(value.completionTokens),
    totalTokens: asCount(value.totalTokens),
    costUsd:
      typeof value.costUsd === 'number' && Number.isFinite(value.costUsd)
        ? value.costUsd
        : null,
    skipped: Boolean(value.skipped),
    source: value.source === 'missing' ? 'missing' : 'openai',
  };
}

function isAnalysisUsage(value: unknown): value is AnalysisUsage {
  if (!isRecord(value) || !Array.isArray(value.steps)) return false;
  return value.steps.every((item) => normalizeStepUsage(item) !== null);
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function normalizeGithubComments(
  value: unknown,
): GithubCommentsResult | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.status !== 'posted' &&
    value.status !== 'empty' &&
    value.status !== 'error'
  ) {
    return undefined;
  }
  return {
    status: value.status,
    posted: asCount(value.posted),
    skipped: asCount(value.skipped),
    reviewId: typeof value.reviewId === 'number' ? value.reviewId : null,
    htmlUrl: isNonEmptyString(value.htmlUrl) ? value.htmlUrl : null,
    errorMessage: isNonEmptyString(value.errorMessage)
      ? value.errorMessage
      : null,
  };
}
