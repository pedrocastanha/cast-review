export type IndexStatus = 'not_indexed' | 'queued' | 'indexing' | 'indexed';

export interface RepositoryIndexStatus {
  status: IndexStatus;
  sha: string | null;
  stale: boolean;
  progress?: number;
}
