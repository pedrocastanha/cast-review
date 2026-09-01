export type FindingCaseState = 'active' | 'resolved';

export type FindingDisposition =
  | 'unreviewed'
  | 'accepted_risk'
  | 'false_positive';

export type FindingClassification = 'new' | 'recurring' | 'reopened';

export type FindingMatchBasis = 'stable_anchor' | 'title_fallback';

export type FindingCaseEventType =
  | 'first_seen'
  | 'seen_again'
  | 'reopened'
  | 'not_observed'
  | 'disposition_changed';
