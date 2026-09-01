import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterLifecycleItems,
  mergeLifecycleIntoComments,
} from '../src/lib/finding-lifecycle.ts';

const items = [
  {
    caseId: 'case-new',
    classification: 'new' as const,
    state: 'active' as const,
    disposition: 'unreviewed' as const,
    dispositionNote: null,
    matchBasis: 'stable_anchor' as const,
    firstSeenAnalysisId: 'analysis-1',
    previousOccurrenceAnalysisId: null,
    currentOccurrence: {
      severity: 'fail' as const,
      reviewer: 'test_reviewer',
      title: 'Regra sem teste',
      detail: 'x',
      path: 'src/a.ts',
      line: 10,
      endLine: null,
      businessRule: null,
      conventionRef: null,
      evidenceId: null,
    },
    transitionedAt: '2026-09-01T12:00:00.000Z',
  },
  {
    caseId: 'case-ack',
    classification: 'recurring' as const,
    state: 'active' as const,
    disposition: 'accepted_risk' as const,
    dispositionNote: 'compatibilidade',
    matchBasis: 'title_fallback' as const,
    firstSeenAnalysisId: 'analysis-0',
    previousOccurrenceAnalysisId: 'analysis-0',
    currentOccurrence: {
      severity: 'warning' as const,
      reviewer: 'architecture_reviewer',
      title: 'Acoplamento',
      detail: 'y',
      path: null,
      line: null,
      endLine: null,
      businessRule: null,
      conventionRef: null,
      evidenceId: null,
    },
    transitionedAt: '2026-09-01T12:00:00.000Z',
  },
  {
    caseId: 'case-gone',
    classification: 'not_observed' as const,
    state: 'resolved' as const,
    disposition: 'unreviewed' as const,
    dispositionNote: null,
    matchBasis: 'stable_anchor' as const,
    firstSeenAnalysisId: 'analysis-0',
    previousOccurrenceAnalysisId: 'analysis-0',
    currentOccurrence: null,
    lastOccurrence: null,
    transitionedAt: '2026-09-01T12:00:00.000Z',
  },
];

test('mergeLifecycleIntoComments associa a ocorrência atual sem depender da ordem', () => {
  const comments = mergeLifecycleIntoComments(
    [
      {
        reviewer: 'test_reviewer',
        status: 'fail' as const,
        title: 'Regra sem teste',
        detail: 'x',
        path: 'src/a.ts',
        line: 10,
      },
    ],
    [...items].reverse(),
  );

  assert.equal(comments[0].lifecycle?.caseId, 'case-new');
  assert.equal(comments[0].lifecycle?.classification, 'new');
});

test('filterLifecycleItems separa atenção, reconhecidos e não observados', () => {
  assert.deepEqual(
    filterLifecycleItems(items, 'attention').map((item) => item.caseId),
    ['case-new'],
  );
  assert.deepEqual(
    filterLifecycleItems(items, 'acknowledged').map((item) => item.caseId),
    ['case-ack'],
  );
  assert.deepEqual(
    filterLifecycleItems(items, 'not_observed').map((item) => item.caseId),
    ['case-gone'],
  );
  assert.equal(filterLifecycleItems(items, 'all').length, 3);
});
