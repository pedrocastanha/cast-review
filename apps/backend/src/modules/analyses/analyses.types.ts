export type AnalysisStatus = 'running' | 'completed' | 'error' | 'awaiting_approval';

export type FindingStatus = 'fail' | 'warning' | 'pass';

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

export interface ReviewFinding {
  status: FindingStatus;
  title: string;
  detail: string;
  businessRule?: string;
  conventionRef?: string;
  path?: string;
  line?: number;
  endLine?: number;
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
  createdAt: string;
  finishedAt: string | null;
  approvalStage: 'prd' | 'spec' | 'publish' | null;
  publishPolicy: PublishPolicy | null;
  prdIterations: Iteration[];
  specIterations: Iteration[];
  resumedCount: number;
}
