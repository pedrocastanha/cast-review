export interface ValidatePatDtoShape {
  token: string;
}

export interface AuthUser {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
}

export interface RelatedFile {
  path: string;
  content: string;
}

export interface ChangedFileContext {
  path: string;
  diff: string;
  fullContent: string;
  baseContent?: string;
  relatedFiles: RelatedFile[];
}

export type ImpactScopeStatus = 'exact' | 'degraded' | 'fallback';

export interface FrozenImpactRepository {
  repoId: string;
  indexedSha: string | null;
  indexStatus: string;
  included: boolean;
  omissionReason: string | null;
}

export interface FrozenImpactScope {
  requestedMode: 'repository' | 'project';
  effectiveMode: 'repository' | 'project';
  status: ImpactScopeStatus;
  projectId: string | null;
  projectName: string | null;
  fallbackReason: string | null;
  repositories: FrozenImpactRepository[];
}

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
}

export interface AgentRunRequest {
  analysisId: string;
  diff: string;
  changedFiles: ChangedFileContext[];
  conventions: string;
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
  apiKeys: {
    openai: string;
  };
  policies?: Policies;
  repoId?: string;
  sha?: string;
  baseSha?: string;
  pullNumber?: number;
  impactScope?: FrozenImpactScope;
  frozenContext?: {
    graphSnapshot: unknown;
  };
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

export interface IndexBuildFile {
  path: string;
  content: string;
}

export interface IndexBuildRequest {
  repoId: string;
  sha: string;
  files: IndexBuildFile[];
}

export interface IndexBuildResult {
  indexId: string;
  indexedFiles: number;
  skippedFiles: number;
  durationMs: number;
}

export interface IndexStatusResult {
  indexed: boolean;
  sha: string | null;
}

export interface VizNode {
  id: string;
  label: string;
  kind: string;
  path: string;
  count: number;
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

export interface ProjectGraphRequest {
  projectId: string;
  repositories: Array<{ repoId: string; sha: string | null }>;
}

export interface ProjectGraphNode {
  id: string;
  repoId: string;
  label: string;
  kind: 'repository';
  indexed: boolean;
  sha: string | null;
}

export interface ProjectEndpointEvidence {
  repoId: string;
  path: string;
  line: number;
  sha: string;
  symbolId: string | null;
  symbolName: string | null;
  framework: string;
}

export interface ProjectEndpointMatch {
  method: string;
  route: string;
  confidence: 'confirmed';
  evidenceType: 'method_route';
  consumer: ProjectEndpointEvidence;
  provider: ProjectEndpointEvidence;
}

export interface ProjectGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'consumes';
  count: number;
  confidence: 'confirmed';
  matches: ProjectEndpointMatch[];
}

export interface ProjectGraphResult {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  stats: {
    repositories: number;
    indexedRepositories: number;
    links: number;
    endpoints: number;
  };
}

export interface AgentResumeRequest {
  analysisId: string;
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
  apiKeys: {
    openai: string;
  };
  policies: Policies;
  decision?: ApprovalDecision | null;
}
