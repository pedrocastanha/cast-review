export type ChatScopeMode = 'global' | 'repository' | 'project';

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

export interface ChatMention {
  repoId: string;
  path: string;
}

export interface ChatCitation {
  repoId: string;
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

export type ChatRole = 'user' | 'assistant';
