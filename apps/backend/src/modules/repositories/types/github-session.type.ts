import { Octokit } from '@octokit/rest';

export interface GithubSession {
  octokit: Octokit;
  owner: string;
}
