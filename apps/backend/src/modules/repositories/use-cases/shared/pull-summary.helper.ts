import { GithubPull } from '../../types/github-pull.type';

export function toPullSummary(pull: GithubPull) {
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    state: pull.state,
    user: pull.user?.login ?? null,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    htmlUrl: pull.html_url,
    draft: pull.draft ?? false,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    baseRef: pull.base.ref,
    baseSha: pull.base.sha,
  };
}
