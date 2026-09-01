import type { AnalysisReview } from '../analyses.types';
import {
  buildReviewBody,
  CAST_REVIEW_MARKER,
  collectActionable,
  collectPublishable,
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

describe('collectPublishable', () => {
  it('suprime findings reconhecidos usando a disposição atual, não a decorada', () => {
    const items = collectPublishable(
      review({
        comments: [
          {
            reviewer: 'test_reviewer',
            status: 'fail',
            title: 'risco aceito',
            detail: 'x',
            lifecycle: {
              caseId: 'case-1',
              classification: 'recurring',
              state: 'active',
              disposition: 'unreviewed',
              matchBasis: 'stable_anchor',
              firstSeenAnalysisId: 'analysis-0',
              previousOccurrenceAnalysisId: 'analysis-0',
            },
          },
          {
            reviewer: 'architecture_reviewer',
            status: 'warning',
            title: 'sem metadata',
            detail: 'y',
          },
        ],
      }),
      new Map([['case-1', 'accepted_risk']]),
    );

    expect(items.map((item) => item.title)).toEqual(['sem metadata']);
  });

  it('publica finding quando o case não foi encontrado no mapa atual', () => {
    const input = review({
      comments: [
        {
          reviewer: 'test_reviewer',
          status: 'fail',
          title: 'fallback fail-open',
          detail: 'x',
          lifecycle: {
            caseId: 'case-missing',
            classification: 'new',
            state: 'active',
            disposition: 'false_positive',
            matchBasis: 'title_fallback',
            firstSeenAnalysisId: 'analysis-1',
            previousOccurrenceAnalysisId: null,
          },
        },
      ],
    });

    expect(collectPublishable(input, new Map())).toHaveLength(1);
  });
});

describe('buildReviewBody lifecycle', () => {
  it('informa quantos findings reconhecidos não foram republicados', () => {
    expect(buildReviewBody('an-1', review(), 1, 2)).toContain(
      '2 finding(s) reconhecido(s) não republicado(s).',
    );
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

  it('finding sem path cai no primeiro arquivo da PR; path errado é skip', () => {
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
    expect(comments).toHaveLength(1);
    expect(comments[0].path).toBe('src/a.ts');
    expect(skipped).toBe(1);
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
