import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeRepositoryQuery,
  insertRepositoryMarker,
  repositoryHintFor,
} from '../src/lib/chat-repositories.ts';

test('activeRepositoryQuery recognizes slash only at the beginning', () => {
  assert.equal(activeRepositoryQuery('/acme/fr', 8), 'acme/fr');
  assert.equal(activeRepositoryQuery('compare /acme/fr', 16), null);
});

test('activeRepositoryQuery opens with an empty query after slash', () => {
  assert.equal(activeRepositoryQuery('/', 1), '');
});

test('activeRepositoryQuery closes after the first whitespace', () => {
  assert.equal(activeRepositoryQuery('/acme/front compare', 19), null);
});

test('insertRepositoryMarker replaces the leading fragment and preserves the question', () => {
  assert.equal(
    insertRepositoryMarker('/ac compare a arquitetura', 3, 'acme/front'),
    '/acme/front compare a arquitetura',
  );
});

test('repositoryHintFor returns only the selected leading repository', () => {
  assert.equal(
    repositoryHintFor('/acme/front explique o login', 'acme/front'),
    'acme/front',
  );
  assert.equal(repositoryHintFor('/acme/other explique', 'acme/front'), null);
  assert.equal(repositoryHintFor('use /acme/front', 'acme/front'), null);
});
