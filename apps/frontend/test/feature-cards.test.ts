import assert from 'node:assert/strict';
import test from 'node:test';
import { groupCards, staleCardRepositories } from '../src/lib/feature-cards.ts';
import type { FeatureCard } from '../src/types/feature-cards.ts';

const card = (extra = {}) => ({ id: 'parent', parentId: null, title: 'Inbox', area: 'Feature', status: 'draft', active: true, snapshot: { repositories: [{ repoId: 'acme/api', sha: 'abc', included: true }] }, ...extra }) as FeatureCard;

test('board groups families and excludes archived cards', () => {
  const groups = groupCards([card(), card({ id: 'child', parentId: 'parent', status: 'ready' }), card({ id: 'other' }), card({ id: 'archived', active: false })], 'parent');
  assert.deepEqual(groups.draft.map((c) => c.id), ['parent']);
  assert.deepEqual(groups.ready.map((c) => c.id), ['child']);
});

test('search finds area without changing card state', () => {
  assert.equal(groupCards([card()], '', 'feature').draft.length, 1);
  assert.equal(groupCards([card()], '', 'missing').draft.length, 0);
});

test('missing, stale and changed indices are explicit', () => {
  assert.deepEqual(staleCardRepositories(card(), null), ['acme/api']);
  const status = { projectId: 'p', repositories: [{ repository: 'acme/api', status: 'indexed' as const, sha: 'abc', stale: false }] };
  assert.deepEqual(staleCardRepositories(card(), status), []);
  assert.deepEqual(staleCardRepositories(card(), { ...status, repositories: [{ ...status.repositories[0], sha: 'new' }] }), ['acme/api']);
});
