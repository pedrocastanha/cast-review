import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentStatus, blockingCards, cardSeal, groupCards, staleCardRepositories } from '../src/lib/feature-cards.ts';
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

test('blocking dependencies name the cards that are not done', () => {
  const ready = card({ id: 'dep-done', status: 'done' });
  const open = card({ id: 'dep-open', title: 'Migração de schema', status: 'in_progress' });
  const archived = card({ id: 'dep-archived', active: false });
  const byId = new Map([ready, open, archived].map((item) => [item.id, item]));
  const target = card({ id: 'target', dependsOn: ['dep-done', 'dep-open', 'dep-archived', 'missing'] });
  assert.deepEqual(blockingCards(target, byId).map((item) => item.title), ['Migração de schema']);
});

test('adjacent status walks the flow and stops at both ends', () => {
  assert.equal(adjacentStatus('draft', -1), null);
  assert.equal(adjacentStatus('draft', 1), 'ready');
  assert.equal(adjacentStatus('done', 1), null);
  assert.equal(adjacentStatus('done', -1), 'review');
});

test('seal exposes the short sha of the context actually used', () => {
  assert.deepEqual(cardSeal(card({ snapshot: { confidence: 'grounded', repositories: [{ repoId: 'acme/api', sha: '0123456789', included: true }] } })), { grounded: true, sha: '0123456' });
  assert.deepEqual(cardSeal(card({ snapshot: { confidence: 'hypothesis', repositories: [{ repoId: 'acme/api', sha: 'abc', included: false }] } })), { grounded: false, sha: null });
});
