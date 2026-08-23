import { createHash } from 'node:crypto';
import {
  CURATED_BENCHMARK_CASES,
  canonicalBenchmarkSnapshot,
} from './curated-benchmark-cases';

const EXPECTED_SLUGS = [
  'axios-http-socket-memory-leak-11091',
  'axios-nullish-interceptors-11118',
  'express-query-revalidation-7377',
  'express-transfer-encoding-4893',
  'fastify-trust-proxy-6613',
  'fastify-port-parsing-6603',
  'typeorm-offset-count-11634',
  'node-redis-xautoclaim-2565',
];

describe('curated benchmark cases', () => {
  it('ships the complete v1 catalog with stable unique identities', () => {
    expect(CURATED_BENCHMARK_CASES).toHaveLength(8);
    expect(CURATED_BENCHMARK_CASES.map((item) => item.slug)).toEqual(
      EXPECTED_SLUGS,
    );
    expect(new Set(CURATED_BENCHMARK_CASES.map((item) => item.id)).size).toBe(
      8,
    );
    expect(new Set(CURATED_BENCHMARK_CASES.map((item) => item.slug)).size).toBe(
      8,
    );
  });

  it('contains an independently runnable frozen input and graph snapshot', () => {
    for (const item of CURATED_BENCHMARK_CASES) {
      expect(item.kind).toBe('curated');
      expect(item.evaluationMode).toBe('exploratory');
      expect(item.ownerId).toBeNull();
      expect(item.inputSnapshot.diff.length).toBeGreaterThan(0);
      expect(item.inputSnapshot.changedFiles.length).toBeGreaterThan(0);
      expect(item.graphSnapshot.input).toEqual(item.inputSnapshot);
      expect(item.graphSnapshot.selected.nodes.length).toBeGreaterThan(0);
      expect(
        item.graphSnapshot.rendered.graphContextBlock.length,
      ).toBeGreaterThan(0);
      expect(item.graphSnapshot.graph.stale).toBe(false);
    }
  });

  it('keeps provenance and permissive licensing auditable', () => {
    for (const item of CURATED_BENCHMARK_CASES) {
      expect(item.source.provider).toBe('github');
      expect(item.source.url).toBe(
        `https://github.com/${item.source.owner}/${item.source.repo}/pull/${item.source.pullNumber}`,
      );
      expect(item.source.headSha).toMatch(/^[a-f0-9]{40}$/);
      expect(item.source.baseSha).toMatch(/^[a-f0-9]{40}$/);
      expect(item.source.mergedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(['easy', 'medium', 'hard']).toContain(item.source.difficulty);
      expect(item.source.category.length).toBeGreaterThan(0);
      expect(item.source.description.length).toBeGreaterThan(0);
      expect(item.source.originalTitle.length).toBeGreaterThan(0);
      expect(item.source.body.length).toBeGreaterThan(0);
      expect(item.source.graphScope).toBe('changed-files');
      expect(item.source.license.spdx).toBe('MIT');
      expect(item.source.license.url).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('stores the SHA-256 of each canonical snapshot', () => {
    for (const item of CURATED_BENCHMARK_CASES) {
      const digest = createHash('sha256')
        .update(canonicalBenchmarkSnapshot(item.graphSnapshot))
        .digest('hex');
      expect(item.graphSnapshot.snapshotHash).toBe(digest);
      expect(item.inputSnapshot.diffHash).toBe(
        createHash('sha256').update(item.inputSnapshot.diff).digest('hex'),
      );
    }
  });
});
