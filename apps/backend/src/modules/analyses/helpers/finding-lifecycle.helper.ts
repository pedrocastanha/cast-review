import type {
  FindingCaseState,
  FindingClassification,
  FindingDisposition,
} from '../../finding-cases/finding-cases.types';
import type { FingerprintedFinding } from './finding-fingerprint.helper';

export type {
  FindingCaseState,
  FindingClassification,
  FindingDisposition,
} from '../../finding-cases/finding-cases.types';

export interface ExistingFindingCase {
  id: string;
  reviewer: string;
  fingerprint: string;
  state: FindingCaseState;
  disposition: FindingDisposition;
  firstSeenAnalysisId: string | null;
  lastSeenAnalysisId: string | null;
  reopenedCount: number;
}

export interface ObservedFindingPlan {
  finding: FingerprintedFinding;
  case: ExistingFindingCase | null;
  classification: FindingClassification;
  nextState: 'active';
  nextDisposition: FindingDisposition;
  nextReopenedCount: number;
}

export interface FindingLifecyclePlan {
  observed: ObservedFindingPlan[];
  notObserved: ExistingFindingCase[];
}

export function planFindingLifecycle(input: {
  current: FingerprintedFinding[];
  existingCases: ExistingFindingCase[];
  completedReviewers: ReadonlySet<string>;
}): FindingLifecyclePlan {
  const caseByFingerprint = new Map(
    input.existingCases.map((item) => [item.fingerprint, item]),
  );
  const seenFingerprints = new Set(
    input.current.map((item) => item.fingerprint),
  );

  return {
    observed: input.current.map((finding) => {
      const existing = caseByFingerprint.get(finding.fingerprint);
      if (existing?.state === 'active') {
        return {
          finding,
          case: existing,
          classification: 'recurring' as const,
          nextState: 'active' as const,
          nextDisposition: existing.disposition,
          nextReopenedCount: existing.reopenedCount,
        };
      }
      if (existing?.state === 'resolved') {
        return {
          finding,
          case: existing,
          classification: 'reopened' as const,
          nextState: 'active' as const,
          nextDisposition: existing.disposition,
          nextReopenedCount: existing.reopenedCount + 1,
        };
      }
      return {
        finding,
        case: null,
        classification: 'new' as const,
        nextState: 'active' as const,
        nextDisposition: 'unreviewed' as const,
        nextReopenedCount: 0,
      };
    }),
    notObserved: input.existingCases.filter(
      (item) =>
        item.state === 'active' &&
        input.completedReviewers.has(item.reviewer) &&
        !seenFingerprints.has(item.fingerprint),
    ),
  };
}
