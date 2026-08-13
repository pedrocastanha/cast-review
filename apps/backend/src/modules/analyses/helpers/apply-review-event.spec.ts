import {
  applyReviewEvent,
  emptyReview,
  hydrateReview,
} from './apply-review-event';

describe('applyReviewEvent', () => {
  it('acumula change analysis, prd, spec, reviewers e comments', () => {
    let review = emptyReview();

    review = applyReviewEvent(review, 'change_analysis_done', {
      files: [{ path: 'src/a.ts', kind: 'source', extension: '.ts' }],
      hasTests: false,
      hasMigration: false,
    });
    review = applyReviewEvent(review, 'prd_generated', {
      title: 'Login',
      markdown: '# PRD',
    });
    review = applyReviewEvent(review, 'spec_generated', {
      summary: 'auth',
      newContracts: ['POST /login'],
      businessRules: ['senha mínima'],
    });
    review = applyReviewEvent(review, 'test_reviewer_done', {
      score: 85,
      findings: [
        {
          status: 'fail',
          title: 'Regra sem teste',
          detail: 'senha mínima',
          businessRule: 'senha mínima',
        },
      ],
    });

    expect(review.changeAnalysis?.hasTests).toBe(false);
    expect(review.prd).toMatchObject({ title: 'Login' });
    expect(review.spec).toMatchObject({ summary: 'auth' });
    expect(review.results).toEqual([
      expect.objectContaining({ name: 'test_reviewer', score: 85 }),
    ]);
    expect(review.comments).toEqual([
      expect.objectContaining({
        reviewer: 'test_reviewer',
        status: 'fail',
        title: 'Regra sem teste',
      }),
    ]);
  });

  it('substitui o reviewer se o evento chegar de novo', () => {
    let review = applyReviewEvent(emptyReview(), 'architecture_reviewer_done', {
      score: 70,
      findings: [
        { status: 'warning', title: 'pasta', detail: 'fora do padrão' },
      ],
    });
    review = applyReviewEvent(review, 'architecture_reviewer_done', {
      score: 100,
      findings: [],
    });

    expect(review.results).toHaveLength(1);
    expect(review.results[0]).toMatchObject({
      name: 'architecture_reviewer',
      score: 100,
    });
    expect(review.comments).toEqual([]);
  });

  it('report_ready preenche markdown e preserva change analysis', () => {
    let review = applyReviewEvent(emptyReview(), 'change_analysis_done', {
      files: [],
      hasTests: true,
      hasMigration: false,
    });
    review = applyReviewEvent(review, 'report_ready', {
      prd: { title: 'X' },
      spec: { summary: 'Y', newContracts: [], businessRules: [] },
      results: [
        { name: 'test_reviewer', score: 100, findings: [] },
        { name: 'architecture_reviewer', score: 90, findings: [] },
      ],
      markdown: '# Relatório',
    });

    expect(review.markdown).toBe('# Relatório');
    expect(review.changeAnalysis?.hasTests).toBe(true);
    expect(review.results.map((item) => item.name)).toEqual([
      'test_reviewer',
      'architecture_reviewer',
    ]);
  });

  it('ignora tipo desconhecido sem mutar o snapshot', () => {
    const current = emptyReview();
    expect(applyReviewEvent(current, 'thought', { delta: 'x' })).toBe(current);
  });
});

describe('hydrateReview', () => {
  it('reconstrói comments a partir de results antigos', () => {
    const review = hydrateReview({
      spec: { summary: 'ok' },
      results: [
        {
          name: 'architecture_reviewer',
          score: 80,
          findings: [{ status: 'warning', title: 'conv', detail: 'pasta' }],
        },
      ],
    });

    expect(review?.comments).toEqual([
      expect.objectContaining({
        reviewer: 'architecture_reviewer',
        title: 'conv',
      }),
    ]);
  });

  it('devolve null quando não há report', () => {
    expect(hydrateReview(null)).toBeNull();
  });
});
