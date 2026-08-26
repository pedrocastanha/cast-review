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

export interface ProjectRepositoryMember {
  id: string;
  projectId: string;
  githubId: string;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  repositories: ProjectRepositoryMember[];
}

export interface ProjectPayload {
  name: string;
  description?: string;
  repositories: string[];
}

export interface ProjectRepositoryIndexStatus extends Omit<RepositoryIndexStatus, 'status'> {
  repository: string;
  status: RepositoryIndexStatusValue | 'error';
  errorMessage?: string;
}

export interface ProjectIndexStatus {
  projectId: string;
  repositories: ProjectRepositoryIndexStatus[];
}

export interface EligibleProject {
  id: string;
  name: string;
  memberCount: number;
  readyCount: number;
  staleCount: number;
  repositories: ProjectRepositoryIndexStatus[];
}

export interface ProjectGraphEvidence {
  repoId: string;
  path: string;
  line: number;
  sha: string;
  symbolId: string | null;
  symbolName: string | null;
  framework: string;
}

export interface ProjectGraphMatch {
  method: string;
  route: string;
  confidence: 'confirmed';
  evidenceType: 'method_route';
  consumer: ProjectGraphEvidence;
  provider: ProjectGraphEvidence;
}

export interface ProjectGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'consumes';
  count: number;
  confidence: 'confirmed';
  matches: ProjectGraphMatch[];
}

export interface ProjectGraph {
  nodes: Array<{
    id: string;
    repoId: string;
    label: string;
    kind: 'repository';
    indexed: boolean;
    sha: string | null;
  }>;
  edges: ProjectGraphEdge[];
  stats: {
    repositories: number;
    indexedRepositories: number;
    links: number;
    endpoints: number;
  };
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
  impactScope?:
    | { mode: 'repository' }
    | { mode: 'project'; projectId: string };
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
  evidenceId?: string;
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

export type GraphRelation = 'changed' | 'caller' | 'callee' | 'test' | 'dead_code';
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

export interface CrossRepoEvidenceEndpoint {
  repoId: string;
  sha: string;
  path: string;
  line: number;
  symbolId?: string | null;
  symbolName?: string | null;
  framework: string;
}

export interface CrossRepoEvidence {
  id: string;
  contractChangeId: string;
  method: string;
  route: string;
  confidence: GraphConfidence;
  evidenceType: string;
  consumer: CrossRepoEvidenceEndpoint;
  provider: CrossRepoEvidenceEndpoint | null;
}

export interface CrossRepoImpact {
  id: string;
  evidenceId: string;
  contractChangeId: string;
  risk: 'breaking_candidate' | 'behavioral_candidate' | 'integration_gap' | 'informational';
  confidence: GraphConfidence;
  direction: string;
  method: string;
  route: string;
}

export interface AnalysisImpactScopeSummary {
  requestedMode: 'repository' | 'project';
  effectiveMode: 'repository' | 'project';
  status: 'exact' | 'degraded' | 'fallback';
  projectId: string | null;
  projectName: string | null;
  fallbackReason: string | null;
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
    changedFiles: Array<Record<string, unknown>>;
    conventions: string;
  };
  selected: {
    nodes: GraphSnapshotNode[];
    changedSymbols: GraphSnapshotNode[];
    callers: GraphSnapshotNode[];
    callees: GraphSnapshotNode[];
    tests: GraphSnapshotNode[];
    deadCodeCandidates: GraphSnapshotNode[];
    repoMap: string;
  };
  edges: GraphSnapshotEdge[];
  budget: {
    tokenBudget: number;
    budgetUsed: number;
    truncated: boolean;
    omittedNodes: number;
    omittedEdges: number;
    omittedImpacts?: number;
    omittedEvidence?: number;
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
  impacts?: CrossRepoImpact[];
  evidence?: CrossRepoEvidence[];
  versions?: Record<string, string>;
}

export interface BenchmarkCase {
  id: string;
  slug: string | null;
  title: string;
  kind: 'curated' | 'private';
  evaluationMode: 'exploratory' | 'scored';
  ownerId: string | null;
  source: {
    analysisId?: string;
    provider?: 'github';
    owner?: string;
    repo?: string;
    pullNumber?: number;
    url?: string;
    originalTitle?: string;
    body?: string;
    headSha?: string;
    baseSha?: string;
    mergedAt?: string;
    category?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    description?: string;
    graphScope?: 'changed-files';
    contentPolicy?: string;
    license?: {
      spdx: string;
      name: string;
      url: string;
    };
  };
  inputSnapshot: AnalysisContextSnapshot['input'];
  graphSnapshot: AnalysisContextSnapshot;
  groundTruth: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkModelResult {
  model: string;
  status: 'completed' | 'error';
  durationMs: number;
  report: ReportPayload | null;
  errorMessage: string | null;
}

export interface BenchmarkRun {
  id: string;
  caseId: string;
  requestedBy: string;
  status: 'running' | 'completed' | 'error';
  models: string[];
  promptVersion: string;
  graphSnapshotHash: string;
  results: BenchmarkModelResult[] | null;
  errorMessage: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  impactScope: AnalysisImpactScopeSummary | null;
  createdAt: string;
  finishedAt: string | null;
  approvalStage: 'prd' | 'spec' | 'publish' | null;
  publishPolicy: PublishPolicy | null;
  prdIterations: Iteration[];
  specIterations: Iteration[];
  resumedCount: number;
}
