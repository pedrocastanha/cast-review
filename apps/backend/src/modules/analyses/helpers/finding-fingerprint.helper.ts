import { createHash } from 'node:crypto';
import type { FindingMatchBasis } from '../../finding-cases/finding-cases.types';
import type { ReviewComment } from '../analyses.types';

export type { FindingMatchBasis } from '../../finding-cases/finding-cases.types';

export interface FingerprintedFinding {
  fingerprintVersion: '1';
  fingerprint: string;
  fingerprintMaterial: string;
  matchBasis: FindingMatchBasis;
  finding: ReviewComment;
  sourceIndexes: number[];
  sourceCount: number;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeRepoPath(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '');
}

function firstStableAnchor(finding: ReviewComment): string | null {
  for (const value of [
    finding.evidenceId,
    finding.conventionRef,
    finding.businessRule,
  ]) {
    if (typeof value === 'string' && value.trim()) {
      return normalizeText(value);
    }
  }
  return null;
}

export function fingerprintFindings(
  findings: ReviewComment[],
): FingerprintedFinding[] {
  const byFingerprint = new Map<string, FingerprintedFinding>();

  findings.forEach((finding, sourceIndex) => {
    const reviewer = normalizeText(finding.reviewer);
    const path = normalizeRepoPath(finding.path);
    const stableAnchor = firstStableAnchor(finding);
    const matchBasis: FindingMatchBasis = stableAnchor
      ? 'stable_anchor'
      : 'title_fallback';
    const identity = stableAnchor
      ? `stable:${stableAnchor}`
      : `title:${normalizeText(finding.title)}`;
    const fingerprintMaterial = `v1|${reviewer}|${path}|${identity}`;
    const fingerprint = createHash('sha256')
      .update(fingerprintMaterial)
      .digest('hex');
    const existing = byFingerprint.get(fingerprint);

    if (existing) {
      existing.sourceIndexes.push(sourceIndex);
      existing.sourceCount += 1;
      return;
    }

    byFingerprint.set(fingerprint, {
      fingerprintVersion: '1',
      fingerprint,
      fingerprintMaterial,
      matchBasis,
      finding,
      sourceIndexes: [sourceIndex],
      sourceCount: 1,
    });
  });

  return [...byFingerprint.values()];
}
