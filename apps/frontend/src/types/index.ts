export interface User {
  id: string;
  name: string;
  email: string;
  username: string | null;
  active: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  githubTokenLastFour: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginPayload {
  email?: string;
  username?: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  username?: string;
  email: string;
  password: string;
}

export interface UpdateUserPayload {
  name?: string;
  username?: string;
  email?: string;
  githubToken?: string;
}

export interface VizNode {
  id: string;
  label: string;
  kind: string;
  path: string;
  count: number;
  parentId?: string | null;
}

export interface VizEdge {
  source: string;
  target: string;
  kind: string;
}

export interface VizGraph {
  nodes: VizNode[];
  edges: VizEdge[];
  stats: { indexed: boolean; truncated?: boolean };
}

export type RepositoryIndexStatusValue = 'not_indexed' | 'queued' | 'indexing' | 'indexed';

export interface RepositoryIndexStatus {
  status: RepositoryIndexStatusValue;
  sha: string | null;
  stale: boolean;
  progress?: number;
}

export interface IndexJobEnqueued {
  jobId: string;
  status: 'queued';
}

export interface Repository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  updatedAt: string;
  defaultBranch: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  user: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
}

export interface ApiErrorBody {
  message: string | string[];
  error?: string;
  statusCode: number;
}

/** Envelope SSE do Nest (1:1 com o Python). */
export type AgentEventType =
  | 'change_analysis_done'
  | 'prd_generated'
  | 'spec_generated'
  | 'test_reviewer_done'
  | 'architecture_reviewer_done'
  | 'report_ready'
  | 'awaiting_approval'
  | 'github_comments_done'
  | 'thought'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface Policies {
  prd: 'manual' | 'auto';
  spec: 'manual' | 'auto';
  publish: 'manual' | 'auto_safe' | 'auto';
}

export interface Annotation {
  excerpt: string;
  note: string;
}

export interface ApprovalDecision {
  stage: 'prd' | 'spec';
  action: 'approve' | 'reject';
  annotations?: Annotation[] | null;
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

export interface RunAnalysisPayload {
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
  apiKeys: {
    openai: string;
  };
  policies: Policies;
}

export interface Finding {
  status: 'fail' | 'warning' | 'pass';
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
  findings: Finding[];
}

export interface ReviewComment extends Finding {
  reviewer: string;
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

export interface PrdPayload {
  title: string;
  problem: string;
  whatChanged: string;
  goals: string[];
  nonGoals: string[];
  userImpact: string;
  constraints: string[];
  markdown: string;
}

export interface SpecPayload {
  summary: string;
  newContracts: string[];
  businessRules: string[];
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

export interface ReportPayload {
  changeAnalysis?: ChangeAnalysis;
  prd?: PrdPayload | null;
  spec?: SpecPayload | null;
  results?: ReviewResult[];
  comments?: ReviewComment[];
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

export type GithubCommentsStatus = 'posted' | 'empty' | 'error';

export interface GithubCommentsResult {
  status: GithubCommentsStatus;
  posted: number;
  skipped: number;
  reviewId: number | null;
  htmlUrl: string | null;
  errorMessage: string | null;
}

export type AnalysisStatus = 'running' | 'completed' | 'error' | 'awaiting_approval';

export interface AnalysisRecord {
  id: string;
  requestedBy: string;
  owner: string;
  repo: string;
  pullNumber: number;
  status: AnalysisStatus;
  report: ReportPayload | null;
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
