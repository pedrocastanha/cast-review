export interface User {
  id: string;
  name: string;
  email: string;
  username: string | null;
  active: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
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
  | 'thought'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface RunAnalysisPayload {
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
  apiKeys: {
    openai: string;
  };
}

export interface Finding {
  status: 'fail' | 'warning' | 'pass';
  title: string;
  detail: string;
  businessRule?: string;
  conventionRef?: string;
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
}

export type AnalysisStatus = 'running' | 'completed' | 'error';

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
}
