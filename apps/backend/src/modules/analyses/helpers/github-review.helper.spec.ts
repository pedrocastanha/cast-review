import type { AnalysisReview } from '../analyses.types';
import {
  buildReviewBody,
  CAST_REVIEW_MARKER,
  collectActionable,
  isCastReviewComment,
  planInlineComments,
} from './github-review.helper';

const patch = `@@ -1,2 +1,3 @@
 keep
+added
 other
`;

const files = [{ filename: 'src/a.ts', status: 'modified', patch }];

function review(partial: Partial<AnalysisReview> = {}): AnalysisReview {
  return {
    results: [],
    comments: [],
    verdict: 'request_changes',
    overallScore: 70,
    ...partial,
  };
}

describe('collectActionable', () => {
  it('fica só com fail e warning', () => {
    const items = collectActionable(
      review({
        comments: [
          {
            reviewer: 'test_reviewer',
            status: 'pass',
            title: 'ok',
            detail: '',
          },
          {
            reviewer: 'test_reviewer',
            status: 'fail',
            title: 'sem teste',
            detail: 'x',
          },
          {
            reviewer: 'architecture_reviewer',
            status: 'warning',
            title: 'gordo',
            detail: 'y',
          },
        ],
      }),
    );
    expect(items.map((item) => item.status)).toEqual(['fail', 'warning']);
  });
});

describe('planInlineComments', () => {
  it('ancora fail no hunk e ignora pass', () => {
    const { comments, skipped } = planInlineComments(
      'an-1',
      review({
        comments: [
          {
            reviewer: 'architecture_reviewer',
            status: 'fail',
            title: 'Controller gordo',
            detail: 'validação no controller',
            conventionRef: 'porta fina',
            path: 'src/a.ts',
            line: 2,
          },
          {
            reviewer: 'test_reviewer',
            status: 'pass',
            title: 'ok',
            detail: '',
            path: 'src/a.ts',
            line: 2,
          },
        ],
      }),
      files,
    );

    expect(skipped).toBe(0);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      path: 'src/a.ts',
      line: 2,
      side: 'RIGHT',
    });
    expect(comments[0].body).toContain(CAST_REVIEW_MARKER);
    expect(comments[0].body).toContain('an-1');
    expect(comments[0].body).toContain('Architecture');
    expect(comments[0].body).toContain('porta fina');
  });

  it('pula finding sem path ou fora da PR', () => {
    const { comments, skipped } = planInlineComments(
      'an-1',
      review({
        comments: [
          {
            reviewer: 'test_reviewer',
            status: 'fail',
            title: 'sem path',
            detail: 'x',
          },
          {
            reviewer: 'test_reviewer',
            status: 'fail',
            title: 'outro repo',
            detail: 'x',
            path: 'src/missing.ts',
            line: 1,
          },
        ],
      }),
      files,
    );
    expect(comments).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it('dedupa o mesmo path+line e limita a 20', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      reviewer: 'architecture_reviewer' as const,
      status: 'warning' as const,
      title: `w${index}`,
      detail: 'd',
      path: 'src/a.ts',
      line: 1,
    }));
    // mesmo line=1 → um grupo só
    const sameLine = planInlineComments(
      'an-1',
      review({ comments: many }),
      files,
    );
    expect(sameLine.comments).toHaveLength(1);
    expect(sameLine.comments[0].body).toContain('---');

    const spread = Array.from({ length: 25 }, (_, index) => ({
      reviewer: 'architecture_reviewer' as const,
      status: 'fail' as const,
      title: `f${index}`,
      detail: 'd',
      path: 'src/a.ts',
      line: 1 + index,
    }));
    const capped = planInlineComments(
      'an-1',
      review({ comments: spread }),
      files,
    );
    expect(capped.comments.length).toBeLessThanOrEqual(20);
  });
});

describe('buildReviewBody', () => {
  it('sempre descreve COMMENT e traz o veredito em português', () => {
    const body = buildReviewBody('an-1', review(), 3);
    expect(body.startsWith(CAST_REVIEW_MARKER)).toBe(true);
    expect(body).toContain('Pedir mudanças');
    expect(body).toContain('nota 70');
    expect(body).toContain('3 comentário');
    expect(isCastReviewComment(body)).toBe(true);
    expect(isCastReviewComment('lgtm')).toBe(false);
  });
});
