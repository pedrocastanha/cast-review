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
  relatedFiles: RelatedFile[];
}

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

export interface AgentRunRequest {
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
}
