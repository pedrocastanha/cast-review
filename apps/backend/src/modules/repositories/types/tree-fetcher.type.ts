export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoTreeResult {
  files: RepoFile[];
  truncated: boolean;
}
