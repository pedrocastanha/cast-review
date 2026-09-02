import type { AnalysisReview } from '../../analyses/analyses.types';
import {
  buildCompletedOutput,
  buildFailedOutput,
  buildSkippedOutput,
  buildSupersededOutput,
  conclusionFor,
} from './check-run-output';

function review(overrides: Partial<AnalysisReview> = {}): AnalysisReview {
  return {
    results: [],
    comments: [],
    verdict: 'request_changes',
    overallScore: 62,
    failCount: 2,
    warningCount: 3,
    markdown: '# Relatório',
    usage: {
      currency: 'USD',
      promptTokens: 1,
      cachedTokens: 0,
      completionTokens: 1,
      totalTokens: 2,
      costUsd: 0.1234,
      costComplete: true,
      pricingAsOf: '2026-09-01',
      steps: [],
    },
    ...overrides,
  };
}

describe('conclusionFor', () => {
  it('never fails the check for a product verdict: request_changes is informative', () => {
    expect(conclusionFor(review())).toBe('neutral');
    expect(conclusionFor(review({ verdict: 'comment' }))).toBe('neutral');
    expect(conclusionFor(review({ verdict: 'approve' }))).toBe('success');
  });
});

describe('buildCompletedOutput', () => {
  it('reports verdict, counts, cost, duration and the report link', () => {
    const output = buildCompletedOutput({
      review: review(),
      analysisUrl: 'https://cast.local/analyses/a1',
      durationMs: 42_000,
      headSha: 'sha-a',
      commentsPosted: 4,
    });

    expect(output.title).toBe('Pedir mudanças · nota 62');
    expect(output.summary).toContain('2 fail · 3 warning');
    expect(output.summary).toContain('US$ 0.1234');
    expect(output.summary).toContain('42.0s');
    expect(output.summary).toContain('Comentários publicados: 4');
    expect(output.summary).toContain('https://cast.local/analyses/a1');
    expect(output.summary).toContain('sha-a');
    expect(output.text).toBe('# Relatório');
  });

  it('breaks down the lifecycle counters when they are available', () => {
    const output = buildCompletedOutput({
      review: review({
        findingLifecycle: {
          status: 'available',
          baselineAnalysisId: 'a0',
          modelChanged: false,
          newCount: 2,
          recurringCount: 1,
          reopenedCount: 0,
          notObservedCount: 3,
          acknowledgedCount: 1,
          suppressedFromGithubCount: 1,
        },
      }),
      analysisUrl: 'https://cast.local/analyses/a1',
      durationMs: 1000,
      headSha: 'sha-a',
      commentsPosted: null,
    });

    expect(output.summary).toContain('2 novos · 1 recorrentes · 0 reabertos');
    expect(output.summary).not.toContain('Comentários publicados');
  });

  it('says lifecycle is unavailable instead of pretending zero', () => {
    const output = buildCompletedOutput({
      review: review({ findingLifecycle: undefined }),
      analysisUrl: 'https://cast.local/analyses/a1',
      durationMs: 1000,
      headSha: 'sha-a',
      commentsPosted: null,
    });
    expect(output.summary).toContain('Lifecycle: indisponível');
  });

  it('explains why comments were withheld when publication was skipped', () => {
    const output = buildCompletedOutput({
      review: review({
        githubComments: {
          status: 'skipped',
          posted: 0,
          skipped: 0,
          reviewId: null,
          htmlUrl: null,
          errorMessage: 'Head da PR mudou para sha-b',
        },
      }),
      analysisUrl: 'https://cast.local/analyses/a1',
      durationMs: 1000,
      headSha: 'sha-a',
      commentsPosted: 0,
    });
    expect(output.summary).toContain('Head da PR mudou para sha-b');
  });

  it('reports unknown cost as n/d rather than zero', () => {
    const output = buildCompletedOutput({
      review: review({ usage: undefined }),
      analysisUrl: 'https://cast.local/analyses/a1',
      durationMs: 1000,
      headSha: 'sha-a',
      commentsPosted: null,
    });
    expect(output.summary).toContain('Custo: n/d');
  });
});

describe('buildSkippedOutput / buildFailedOutput / buildSupersededOutput', () => {
  it('names the reason a run was skipped', () => {
    expect(buildSkippedOutput('budget_exceeded').summary).toContain(
      'Limite de orçamento atingido',
    );
  });

  it('states that an operational failure does not block the merge', () => {
    const output = buildFailedOutput(
      'ai-api fora do ar',
      'https://cast.local/a1',
    );
    expect(output.summary).toContain('não bloqueia o merge');
    expect(output.summary).toContain('ai-api fora do ar');
  });

  it('names the newer commit that superseded the run', () => {
    expect(buildSupersededOutput('sha-b').summary).toContain('sha-b');
    expect(buildSupersededOutput(null).summary).toContain('novo commit');
  });
});
