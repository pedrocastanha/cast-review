export const GITHUB_REVIEW_QUEUE = 'github-review';

export interface GithubReviewJobData {
  reviewRunId: string;
  /**
   * Dono humano em nome de quem o worker age (SEC-17). Obrigatório: sem ele o
   * processor não tem contexto de RLS e não enxerga nada. Nunca default para
   * null — instalação sem dono vinculado não deve enfileirar revisão.
   */
  actorUserId: string;
}

export function buildReviewJobId(reviewRunId: string): string {
  return `review:${reviewRunId}`;
}
