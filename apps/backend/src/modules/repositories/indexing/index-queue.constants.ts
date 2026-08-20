export const CODE_INDEX_QUEUE = 'code-index';

export interface IndexJobData {
  owner: string;
  repo: string;
  sha: string;
  userId: string;
}

export interface IndexJobResult {
  indexId: string;
  indexedFiles: number;
  skippedFiles: number;
  durationMs: number;
}

export function buildIndexJobId(owner: string, repo: string, sha: string): string {
  return `${owner}/${repo}@${sha}`;
}
