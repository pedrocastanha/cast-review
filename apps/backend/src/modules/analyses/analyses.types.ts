export type AnalysisStatus = 'running' | 'completed' | 'error';

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
}
