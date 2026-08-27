export interface GithubPull {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  draft?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}

export interface GithubPullFile {
  filename: string;
  status: string;
  patch?: string;
}
