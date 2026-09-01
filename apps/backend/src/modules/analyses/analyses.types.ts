export type AnalysisStatus =
  | 'running'
  | 'completed'
  | 'error'
  | 'awaiting_approval';

export type FindingStatus = 'fail' | 'warning' | 'pass';

export interface AnalysisImpactScopeSummary {
  requestedMode: 'repository' | 'project';
  effectiveMode: 'repository' | 'project';
  status: 'exact' | 'degraded' | 'fallback';
  projectId: string | null;
  projectName: string | null;
  fallbackReason: string | null;
}

export interface ChangeAnalysisFile {
  path: string;
  kind: string;
  extension: string;
}

export interface ChangeAnalysis {
  files: ChangeAnalysisFile[];
  hasTests: boolean;
  hasMigration: boolean;
}

export type GraphRelation =
  | 'changed'
  | 'caller'
  | 'callee'
  | 'test'
  | 'dead_code';
export type GraphConfidence = 'confirmed' | 'inferred' | 'unresolved' | 'stale';

export interface GraphSnapshotNode {
  id: string;
  kind: string;
  path: string;
  name: string;
  signature: string;
  body: string | null;
  line: number;
  endLine: number;
  contentHash: string | null;
  relation: GraphRelation;
  distance: number | null;
  score: number | null;
  confidence: GraphConfidence;
  reason: string;
}

export interface GraphSnapshotEdge {
  fromId: string;
  toId: string;
  kind: 'defines' | 'references' | 'imports' | 'tests';
  weight: number;
  confidence: 'confirmed' | 'inferred' | 'stale';
}

export interface AnalysisContextSnapshot {
  schemaVersion: '1' | '2';
  snapshotHash: string;
  createdAt: string;
  analysisId: string | null;
  repository: {
    repoId: string;
    owner: string;
    repo: string;
    pullNumber: number | null;
    baseSha: string | null;
    requestedSha: string | null;
  };
  graph: {
    indexedSha: string | null;
    stale: boolean;
    indexerVersion: string;
    graphSchemaVersion: string;
    queryVersion: string;
  };
  input: {
    diffHash: string;
    diff: string;
    changedFiles: Array<{
      path: string;
      diff: string;
      fullContent: string;
      baseContent?: string;
      relatedFiles: Array<{ path: string; content: string }>;
    }>;
    conventions: string;
  };
  selected: {
    nodes: GraphSnapshotNode[];
    changedSymbols: GraphSnapshotNode[];
    callers: GraphSnapshotNode[];
    callees: GraphSnapshotNode[];
    tests: GraphSnapshotNode[];
    deadCodeCandidates: GraphSnapshotNode[];
    onlyTestedCandidates?: GraphSnapshotNode[];
    repoMap: string;
  };
  edges: GraphSnapshotEdge[];
  budget: {
    tokenBudget: number;
    budgetUsed: number;
    truncated: boolean;
    omittedNodes: number;
    omittedEdges: number;
  };
  rendered: {
    graphContextBlock: string;
    relatedContext: Record<string, unknown>;
  };
  scope?: AnalysisImpactScopeSummary;
  source?: {
    repoId: string;
    pullNumber: number | null;
    baseSha: string | null;
    headSha: string | null;
  };
  repositories?: Array<{
    repoId: string;
    indexedSha: string | null;
    indexStatus: string;
    included: boolean;
    omissionReason: string | null;
  }>;
  contractChanges?: Array<Record<string, unknown>>;
  impacts?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  versions?: Record<string, string>;
}

export interface ReviewFinding {
  status: FindingStatus;
  title: string;
  detail: string;
  businessRule?: string;
  conventionRef?: string;
  path?: string;
  line?: number;
  endLine?: number;
  evidenceId?: string;
}

export interface ReviewResult {
  name: string;
  score: number;
  findings: ReviewFinding[];
}

export interface ReviewComment extends ReviewFinding {
  reviewer: string;
}

export type ReviewVerdict = 'approve' | 'comment' | 'request_changes';

export type UsageSource = 'openai' | 'missing';

export type UsageStepName =
  | 'change_analyzer'
  | 'prd'
  | 'implementation_spec'
  | 'test_reviewer'
  | 'architecture_reviewer'
  | 'report_builder';

export interface StepUsage {
  step: UsageStepName;
  label: string;
  model: string | null;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
  skipped: boolean;
  source: UsageSource;
}

export type GithubCommentsStatus = 'posted' | 'empty' | 'error';

export interface GithubCommentsResult {
  status: GithubCommentsStatus;
  posted: number;
  skipped: number;
  reviewId: number | null;
  htmlUrl: string | null;
  errorMessage: string | null;
}

export interface AnalysisUsage {
  currency: 'USD';
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
  costComplete: boolean;
  pricingAsOf: string;
  steps: StepUsage[];
}

export interface AnalysisReview {
  changeAnalysis?: ChangeAnalysis;
  prd?: Record<string, unknown> | null;
  spec?: Record<string, unknown> | null;
  results: ReviewResult[];
  comments: ReviewComment[];
  markdown?: string;
  verdict?: ReviewVerdict;
  overallScore?: number;
  failCount?: number;
  warningCount?: number;
  headline?: string;
  conventionsSource?: 'repo' | 'default';
  usage?: AnalysisUsage;
  githubComments?: GithubCommentsResult;
}

export interface Annotation {
  excerpt: string;
  note: string;
}

export interface PublishPolicy {
  prd: 'manual' | 'auto';
  spec: 'manual' | 'auto';
  publish: 'manual' | 'auto_safe' | 'auto';
}

export interface Iteration {
  content: Record<string, unknown>;
  annotations: Annotation[] | null;
  createdAt: string;
}

export interface AnalysisRecord {
  id: string;
  requestedBy: string;
  owner: string;
  repo: string;
  pullNumber: number;
  status: AnalysisStatus;
  report: AnalysisReview | null;
  thoughts: Record<string, string> | null;
  errorMessage: string | null;
  models: { testReviewer: string; architectureReviewer: string } | null;
  impactScope: AnalysisImpactScopeSummary | null;
  createdAt: string;
  finishedAt: string | null;
  approvalStage: 'prd' | 'spec' | 'publish' | null;
  publishPolicy: PublishPolicy | null;
  prdIterations: Iteration[];
  specIterations: Iteration[];
  resumedCount: number;
}
