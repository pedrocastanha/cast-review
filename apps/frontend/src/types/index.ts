export interface User {
  id: string;
  name: string;
  email: string;
  username: string | null;
  active: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  githubTokenLastFour: string | null;
  openaiConnected: boolean;
  openaiKeyLastFour: string | null;
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
  openaiKey?: string;
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
  | 'finding_lifecycle_done'
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

export type FindingDisposition = 'unreviewed' | 'accepted_risk' | 'false_positive';
export type FindingClassification = 'new' | 'recurring' | 'reopened' | 'not_observed';

export interface FindingLifecycleMeta {
  caseId: string;
  classification: Exclude<FindingClassification, 'not_observed'>;
  state: 'active';
  disposition: FindingDisposition;
  matchBasis: 'stable_anchor' | 'title_fallback';
  firstSeenAnalysisId: string;
  previousOccurrenceAnalysisId: string | null;
}

export interface FindingLifecycleSummary {
  status: 'available' | 'unavailable';
  baselineAnalysisId: string | null;
  modelChanged: boolean;
  newCount: number;
  recurringCount: number;
  reopenedCount: number;
  notObservedCount: number;
  acknowledgedCount: number;
  suppressedFromGithubCount: number;
  errorCode?: 'reconciliation_failed';
}

export interface FindingLifecycleOccurrence {
  severity: 'fail' | 'warning';
  reviewer: string;
  title: string;
  detail: string;
  path: string | null;
  line: number | null;
  endLine: number | null;
  businessRule: string | null;
  conventionRef: string | null;
  evidenceId: string | null;
}

export interface FindingLifecycleItem {
  caseId: string;
  classification: FindingClassification;
  state: 'active' | 'resolved';
  disposition: FindingDisposition;
  dispositionNote: string | null;
  matchBasis: 'stable_anchor' | 'title_fallback';
  firstSeenAnalysisId: string | null;
  previousOccurrenceAnalysisId: string | null;
  currentOccurrence: FindingLifecycleOccurrence | null;
  lastOccurrence?: FindingLifecycleOccurrence | null;
  transitionedAt: string;
}

export type FindingLifecycleView = 'attention' | 'acknowledged' | 'not_observed' | 'all';

export interface FindingLifecycleListResponse {
  data: FindingLifecycleItem[];
  summary: FindingLifecycleSummary;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ReviewComment extends Finding {
  reviewer: string;
  lifecycle?: FindingLifecycleMeta;
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
  findingLifecycle?: FindingLifecycleSummary;
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
  architectureImpact: ArchitectureImpact | null;
  createdAt: string;
  finishedAt: string | null;
  approvalStage: 'prd' | 'spec' | 'publish' | null;
  publishPolicy: PublishPolicy | null;
  prdIterations: Iteration[];
  specIterations: Iteration[];
  resumedCount: number;
}

export type ChatScopeMode = 'global' | 'repository';

export interface ChatScopeRepository {
  repoId: string;
  sha: string | null;
  included: boolean;
  omissionReason: string | null;
}

export interface ChatScope {
  mode: ChatScopeMode;
  projectId?: string;
  projectName?: string;
  repositories: ChatScopeRepository[];
}

export interface ChatCitation {
  repoId: string;
  sha?: string | null;
  path: string;
  line: number | null;
  symbolId: string | null;
  symbolName: string | null;
}

export interface ChatToolCallRecord {
  iteration: number;
  name: string;
  args: Record<string, unknown>;
  itemCount: number;
  truncated: boolean;
  durationMs: number;
  note: string | null;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
}

export interface ChatMention {
  repoId: string;
  path: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  mentions: ChatMention[];
  toolCalls: ChatToolCallRecord[];
  citations: ChatCitation[];
  usage: ChatUsage | null;
  truncated: boolean;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  title: string;
  scope: ChatScope;
  repoId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  staleRepositories?: string[];
}

export interface ChatFile {
  repoId: string;
  path: string;
}

export type ChatEventType =
  | 'tool_call'
  | 'tool_result'
  | 'token'
  | 'message_done'
  | 'error';

export interface ChatEvent {
  type: ChatEventType;
  payload: Record<string, unknown>;
}

export interface SendChatMessagePayload {
  content: string;
  mentions: ChatMention[];
  model: string;
  repositoryHint?: string;
}

export type GithubInstallationStatus = 'pending' | 'active' | 'suspended' | 'deleted';

export type GithubAppPublishPolicy = 'check_only' | 'comments';

export type RepositoryConfigStatus = 'ready' | 'configuration_required';

export interface GithubAppRepositoryConfig {
  events: { opened: boolean; reopened: boolean; synchronize: boolean };
  includeDrafts: boolean;
  baseBranches: string[];
  models: { testReviewer: string; architectureReviewer: string } | null;
  impactScope: { mode: 'repository' } | { mode: 'project'; projectId: string };
  publishPolicy: GithubAppPublishPolicy;
  budgetMonthlyUsd: number | null;
  budgetPerRunUsd: number | null;
  staleIndexBehavior: 'proceed' | 'skip';
}

export interface GithubAppBudgetUsage {
  month: string;
  consumedUsd: number;
  reservedUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
}

export interface GithubAppRepositorySummary {
  id: string;
  installationId: string;
  owner: string;
  repo: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string | null;
  enabled: boolean;
  paused: boolean;
  configStatus: RepositoryConfigStatus;
  configReason: string | null;
  config: GithubAppRepositoryConfig;
  budget?: GithubAppBudgetUsage;
}

export interface GithubInstallationSummary {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  status: GithubInstallationStatus;
  paused: boolean;
  repositorySelection: string | null;
  permissions: Record<string, string>;
  linkedAt: string | null;
  lastEventAt: string | null;
  repositories: GithubAppRepositorySummary[];
}

export type GithubReviewRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'superseded'
  | 'cancelled';

export interface GithubReviewRunSummary {
  id: string;
  pullNumber: number;
  headSha: string;
  status: GithubReviewRunStatus;
  skipReason: string | null;
  errorMessage: string | null;
  analysisId: string | null;
  trigger: 'webhook' | 'manual' | 'retry';
  eventAction: string | null;
  checkRun: {
    id: number | null;
    status: string | null;
    conclusion: string | null;
    htmlUrl: string | null;
  } | null;
  consumedUsd: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface UpdateRepositoryConfigPayload {
  enabled?: boolean;
  events?: { opened: boolean; reopened: boolean; synchronize: boolean };
  includeDrafts?: boolean;
  baseBranches?: string[];
  models?: { testReviewer: string; architectureReviewer: string };
  impactScope?: { mode: 'repository' | 'project'; projectId?: string };
  publishPolicy?: GithubAppPublishPolicy;
  budgetMonthlyUsd?: number | null;
  budgetPerRunUsd?: number | null;
  staleIndexBehavior?: 'proceed' | 'skip';
  paused?: boolean;
}

export type ArchitectureScopeType = 'repository' | 'project';

export type CapabilityCriticality = 'low' | 'medium' | 'high' | 'critical';

export type ComponentSource = 'manual' | 'rule' | 'llm';

export type ComponentConfidence = 'confirmed' | 'inferred';

export type ComponentStatus = 'unmapped' | 'assigned' | 'rejected';

export type BoundaryKind = 'allow' | 'deny' | 'review';

export type ArchitectureDependencyKind = 'references' | 'imports' | 'tests' | 'http';

export interface ArchitectureMapSummary {
  id: string;
  name: string;
  scopeType: ArchitectureScopeType;
  scopeRef: string;
  publishedVersion: number | null;
  publishedHash: string | null;
  publishedAt: string | null;
}

export interface ComponentEvidence {
  kind: 'symbol' | 'edge' | 'endpoint';
  repoId: string;
  sha: string | null;
  path: string;
  line: number | null;
  symbolId: string | null;
  symbolName: string | null;
}

export interface ArchitectureDependencyEvidence {
  kind: ArchitectureDependencyKind;
  fromRepoId: string;
  fromPath: string;
  fromLine: number | null;
  fromSymbolName: string | null;
  toRepoId: string;
  toPath: string;
  toLine: number | null;
  toSymbolName: string | null;
  fromSha: string | null;
  toSha: string | null;
  method: string | null;
  route: string | null;
}

export interface ArchitectureComponent {
  id: string;
  mapId: string;
  capabilityId: string | null;
  candidateKey: string;
  repoId: string;
  pathPrefix: string;
  label: string;
  kind: string;
  source: ComponentSource;
  confidence: ComponentConfidence;
  status: ComponentStatus;
  indexedSha: string | null;
  metrics: {
    fileCount: number;
    symbolCount: number;
    internalEdges: number;
    inboundEdges: number;
    outboundEdges: number;
    providedEndpoints: number;
    consumedEndpoints: number;
  };
  evidence: ComponentEvidence[];
}

export interface CapabilityView {
  id: string;
  name: string;
  description: string | null;
  criticality: CapabilityCriticality;
  componentCount: number;
  confirmedComponentCount: number;
  repositories: string[];
  symbolCount: number;
  providedEndpoints: number;
  consumedEndpoints: number;
}

export interface CapabilityDependency {
  fromCapabilityId: string;
  toCapabilityId: string;
  kinds: ArchitectureDependencyKind[];
  count: number;
  confidence: ComponentConfidence;
  components: Array<{ fromComponentId: string; toComponentId: string }>;
  evidence: ArchitectureDependencyEvidence[];
}

export interface CapabilityBoundary {
  id: string;
  mapId: string;
  fromCapabilityId: string;
  toCapabilityId: string;
  kind: BoundaryKind;
  note: string | null;
}

export interface BoundaryViolation {
  boundaryId: string;
  fromCapabilityId: string;
  toCapabilityId: string;
  boundaryKind: 'deny' | 'review';
  severity: 'violation' | 'warning';
  confidence: ComponentConfidence;
  count: number;
  evidence: ArchitectureDependencyEvidence[];
}

export interface ArchitectureCoverage {
  structural: number;
  totalComponents: number;
  assignedComponents: number;
  unmappedComponents: number;
  rejectedComponents: number;
  confirmedComponents: number;
}

export interface ArchitectureScopeRepository {
  repoId: string;
  sha: string | null;
  status: string;
  stale: boolean;
  indexed: boolean;
}

export interface ArchitectureView {
  map: ArchitectureMapSummary;
  capabilities: CapabilityView[];
  components: ArchitectureComponent[];
  dependencies: CapabilityDependency[];
  boundaries: CapabilityBoundary[];
  violations: BoundaryViolation[];
  coverage: ArchitectureCoverage;
  scope: {
    scopeType: ArchitectureScopeType;
    scopeRef: string;
    repositories: ArchitectureScopeRepository[];
  };
  dependenciesAvailable: boolean;
}

export interface SuggestComponentsResult {
  created: number;
  refreshed: number;
  skipped: number;
  omittedRepositories: string[];
}

export interface ArchitectureMapVersionSummary {
  version: number;
  hash: string;
  publishedAt: string;
}

export interface ArchitectureImpactCapability {
  capabilityId: string;
  name: string;
  criticality: CapabilityCriticality;
  confidence: ComponentConfidence;
  components: string[];
  files: string[];
  symbols: ComponentEvidence[];
}

export interface ArchitectureImpactReachedCapability {
  capabilityId: string;
  name: string;
  criticality: CapabilityCriticality;
  viaCapabilityId: string;
  direction: 'provides' | 'consumes';
  kinds: ArchitectureDependencyKind[];
  confidence: ComponentConfidence;
  count: number;
}

export interface ArchitectureImpact {
  mapId: string;
  mapName: string;
  version: number | null;
  hash: string | null;
  usedDraft: boolean;
  status: 'exact' | 'degraded' | 'unavailable';
  changed: ArchitectureImpactCapability[];
  reached: ArchitectureImpactReachedCapability[];
  boundariesCrossed: Array<{
    boundaryId: string;
    fromCapabilityId: string;
    toCapabilityId: string;
    kind: BoundaryKind;
  }>;
  violations: BoundaryViolation[];
  unmappedFiles: string[];
  staleRepositories: string[];
  coverage: number;
  degradedReason: string | null;
}
