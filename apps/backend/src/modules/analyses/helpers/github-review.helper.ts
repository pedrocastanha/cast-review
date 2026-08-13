import type {
  AnalysisReview,
  GithubCommentsResult,
  ReviewFinding,
} from '../analyses.types';
import {
  fallbackAnchor,
  type PullFileForAnchor,
  type ResolvedAnchor,
  resolveAnchor,
} from './patch-anchor.helper';

export const CAST_REVIEW_MARKER = '<!-- cast-review:';
const MAX_INLINE_COMMENTS = 20;

export type ReviewerComment = ReviewFinding & { reviewer: string };

export type GithubInlineComment = {
  path: string;
  line: number;
  startLine?: number;
  side: 'RIGHT';
  body: string;
};

const VERDICT_LABEL: Record<string, string> = {
  approve: 'Aprovar',
  comment: 'Comentar',
  request_changes: 'Pedir mudanças',
};

const REVIEWER_LABEL: Record<string, string> = {
  test_reviewer: 'Test Reviewer',
  architecture_reviewer: 'Architecture',
};

export function markerFor(analysisId: string): string {
  return `${CAST_REVIEW_MARKER}${analysisId} -->`;
}

export function isCastReviewComment(body: string | null | undefined): boolean {
  return Boolean(body?.includes(CAST_REVIEW_MARKER));
}

export function collectActionable(review: AnalysisReview): ReviewerComment[] {
  return review.comments.filter(
    (item) => item.status === 'fail' || item.status === 'warning',
  );
}

export function buildReviewBody(
  analysisId: string,
  review: AnalysisReview,
  posted: number,
): string {
  const verdict = review.verdict ? VERDICT_LABEL[review.verdict] : 'Review';
  const score =
    review.overallScore !== undefined ? ` · nota ${review.overallScore}` : '';
  const fails = review.comments.filter((item) => item.status === 'fail').length;
  const warnings = review.comments.filter(
    (item) => item.status === 'warning',
  ).length;

  return [
    markerFor(analysisId),
    `Cast Review · **${verdict}**${score}`,
    '',
    posted > 0
      ? `${posted} comentário(s) no diff (${fails} fail, ${warnings} warning).`
      : 'Nenhum trecho do diff pôde ser ancorado; o parecer completo está no Cast Review.',
    `Análise: ${analysisId}`,
  ].join('\n');
}

export function buildInlineBody(
  analysisId: string,
  finding: ReviewerComment,
): string {
  const reviewer = REVIEWER_LABEL[finding.reviewer] ?? finding.reviewer;
  const lines = [
    markerFor(analysisId),
    `**${finding.status}** · ${reviewer}`,
    finding.title,
    '',
    finding.detail,
  ];
  if (finding.conventionRef) lines.push('', `\`${finding.conventionRef}\``);
  if (finding.businessRule) lines.push('', `regra: ${finding.businessRule}`);
  return lines.join('\n');
}

export function planInlineComments(
  analysisId: string,
  review: AnalysisReview,
  files: PullFileForAnchor[],
): { comments: GithubInlineComment[]; skipped: number } {
  const actionable = [...collectActionable(review)].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'fail' ? -1 : 1;
    return 0;
  });

  const grouped = new Map<
    string,
    { finding: ReviewerComment; anchor: ResolvedAnchor }
  >();
  let skipped = 0;

  for (const finding of actionable) {
    const anchor =
      resolveAnchor(finding.path, finding.line, files, finding.endLine) ??
      (finding.path ? null : fallbackAnchor(files));
    if (!anchor) {
      skipped += 1;
      continue;
    }
    const key = `${anchor.path}:${anchor.startLine ?? anchor.line}:${anchor.line}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { finding, anchor });
      continue;
    }
    // Mesmo hunk: fail ganha; senão concatena.
    if (existing.finding.status !== 'fail' && finding.status === 'fail') {
      grouped.set(key, {
        finding: mergeFindings(finding, existing.finding),
        anchor,
      });
    } else {
      grouped.set(key, {
        finding: mergeFindings(existing.finding, finding),
        anchor: existing.anchor,
      });
    }
  }

  const comments = [...grouped.values()]
    .slice(0, MAX_INLINE_COMMENTS)
    .map(({ finding, anchor }) => ({
      path: anchor.path,
      line: anchor.line,
      startLine: anchor.startLine,
      side: 'RIGHT' as const,
      body: buildInlineBody(analysisId, finding),
    }));

  skipped += Math.max(0, grouped.size - MAX_INLINE_COMMENTS);
  return { comments, skipped };
}

export function emptyGithubComments(): GithubCommentsResult {
  return {
    status: 'empty',
    posted: 0,
    skipped: 0,
    reviewId: null,
    htmlUrl: null,
    errorMessage: null,
  };
}

function mergeFindings(
  primary: ReviewerComment,
  extra: ReviewerComment,
): ReviewerComment {
  return {
    ...primary,
    title: `${primary.title} --- ${extra.title}`,
    detail: `${primary.detail}\n\n---\n\n${extra.detail}`,
  };
}
