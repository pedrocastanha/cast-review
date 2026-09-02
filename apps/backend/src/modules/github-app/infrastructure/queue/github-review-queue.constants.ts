export const GITHUB_REVIEW_QUEUE = 'github-review';

export interface GithubReviewJobData {
  reviewRunId: string;
}

export function buildReviewJobId(reviewRunId: string): string {
  return `review:${reviewRunId}`;
}
