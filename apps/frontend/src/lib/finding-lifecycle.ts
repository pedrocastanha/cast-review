import type {
  FindingLifecycleItem,
  FindingLifecycleView,
  ReviewComment,
} from '../types';

export function filterLifecycleItems(
  items: FindingLifecycleItem[],
  view: FindingLifecycleView,
): FindingLifecycleItem[] {
  return items.filter((item) => {
    if (view === 'all') return true;
    if (view === 'not_observed') return item.classification === 'not_observed';
    if (item.classification === 'not_observed') return false;
    const acknowledged = item.disposition !== 'unreviewed';
    return view === 'acknowledged' ? acknowledged : !acknowledged;
  });
}

export function mergeLifecycleIntoComments(
  comments: ReviewComment[],
  items: FindingLifecycleItem[],
): ReviewComment[] {
  const byCaseId = new Map(items.map((item) => [item.caseId, item]));
  const byOccurrence = new Map(
    items.flatMap((item) => {
      const occurrence = item.currentOccurrence;
      return occurrence ? [[occurrenceKey(occurrence), item] as const] : [];
    }),
  );

  return comments.map((comment) => {
    const item = comment.lifecycle?.caseId
      ? byCaseId.get(comment.lifecycle.caseId)
      : byOccurrence.get(occurrenceKey(comment));
    if (
      !item ||
      item.classification === 'not_observed' ||
      !item.firstSeenAnalysisId
    ) {
      return comment;
    }
    return {
      ...comment,
      lifecycle: {
        caseId: item.caseId,
        classification: item.classification,
        state: 'active',
        disposition: item.disposition,
        matchBasis: item.matchBasis,
        firstSeenAnalysisId: item.firstSeenAnalysisId,
        previousOccurrenceAnalysisId: item.previousOccurrenceAnalysisId,
      },
    };
  });
}

function occurrenceKey(value: {
  reviewer: string;
  title: string;
  path?: string | null;
  line?: number | null;
}): string {
  return [
    value.reviewer.trim().toLowerCase(),
    value.title.trim(),
    value.path?.trim() ?? '',
    value.line ?? '',
  ].join('|');
}
