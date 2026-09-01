import type { ReviewComment } from '../analyses.types';
import { fingerprintFindings } from './finding-fingerprint.helper';
import {
  type ExistingFindingCase,
  planFindingLifecycle,
} from './finding-lifecycle.helper';

function finding(partial: Partial<ReviewComment> = {}): ReviewComment {
  return {
    reviewer: 'test_reviewer',
    status: 'fail',
    title: 'Regra sem teste',
    detail: 'Nenhum teste cobre a regra.',
    businessRule: 'Criar usuário exige e-mail',
    path: 'src/users.ts',
    line: 12,
    ...partial,
  };
}

function existingCase(
  fingerprint: string,
  partial: Partial<ExistingFindingCase> = {},
): ExistingFindingCase {
  return {
    id: 'case-1',
    reviewer: 'test_reviewer',
    fingerprint,
    state: 'active',
    disposition: 'unreviewed',
    firstSeenAnalysisId: 'analysis-1',
    lastSeenAnalysisId: 'analysis-1',
    reopenedCount: 0,
    ...partial,
  };
}

describe('planFindingLifecycle', () => {
  it('classifica fingerprint desconhecido como new', () => {
    const [current] = fingerprintFindings([finding()]);

    const plan = planFindingLifecycle({
      current: [current],
      existingCases: [],
      completedReviewers: new Set(['test_reviewer']),
    });

    expect(plan.observed).toHaveLength(1);
    expect(plan.observed[0]).toMatchObject({
      case: null,
      classification: 'new',
      nextState: 'active',
      nextDisposition: 'unreviewed',
      nextReopenedCount: 0,
    });
    expect(plan.notObserved).toEqual([]);
  });

  it('classifica case ativo observado novamente como recurring', () => {
    const [current] = fingerprintFindings([finding()]);
    const previous = existingCase(current.fingerprint, {
      disposition: 'accepted_risk',
      reopenedCount: 2,
    });

    const plan = planFindingLifecycle({
      current: [current],
      existingCases: [previous],
      completedReviewers: new Set(['test_reviewer']),
    });

    expect(plan.observed[0]).toMatchObject({
      case: previous,
      classification: 'recurring',
      nextState: 'active',
      nextDisposition: 'accepted_risk',
      nextReopenedCount: 2,
    });
    expect(plan.notObserved).toEqual([]);
  });

  it('reabre case resolved sem apagar a disposição humana', () => {
    const [current] = fingerprintFindings([finding()]);
    const previous = existingCase(current.fingerprint, {
      state: 'resolved',
      disposition: 'false_positive',
      reopenedCount: 1,
    });

    const plan = planFindingLifecycle({
      current: [current],
      existingCases: [previous],
      completedReviewers: new Set(['test_reviewer']),
    });

    expect(plan.observed[0]).toMatchObject({
      case: previous,
      classification: 'reopened',
      nextState: 'active',
      nextDisposition: 'false_positive',
      nextReopenedCount: 2,
    });
  });

  it('marca case ativo não visto por reviewer concluído como not observed', () => {
    const previous = existingCase('fingerprint-antigo');

    const plan = planFindingLifecycle({
      current: [],
      existingCases: [previous],
      completedReviewers: new Set(['test_reviewer']),
    });

    expect(plan.observed).toEqual([]);
    expect(plan.notObserved).toEqual([previous]);
  });

  it('não resolve case de reviewer ausente nem case já resolved', () => {
    const missingReviewer = existingCase('missing-reviewer', {
      id: 'case-missing',
      reviewer: 'architecture_reviewer',
    });
    const alreadyResolved = existingCase('already-resolved', {
      id: 'case-resolved',
      state: 'resolved',
    });

    const plan = planFindingLifecycle({
      current: [],
      existingCases: [missingReviewer, alreadyResolved],
      completedReviewers: new Set(['test_reviewer']),
    });

    expect(plan.notObserved).toEqual([]);
  });
});
