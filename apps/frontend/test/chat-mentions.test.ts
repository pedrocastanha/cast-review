import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeMentionQuery,
  addMention,
  insertMention,
  MAX_MENTIONS,
  usedMentions,
} from '../src/lib/chat-mentions.ts';

test('activeMentionQuery captures the fragment after the last @', () => {
  assert.equal(activeMentionQuery('quem chama @src/au', 18), 'src/au');
});

test('activeMentionQuery returns empty string right after typing @', () => {
  assert.equal(activeMentionQuery('olha o @', 8), '');
});

test('activeMentionQuery gives up once the fragment has whitespace', () => {
  assert.equal(activeMentionQuery('@src/a.ts e agora', 17), null);
});

test('activeMentionQuery returns null without any @', () => {
  assert.equal(activeMentionQuery('sem mencao', 10), null);
});

test('activeMentionQuery only looks behind the caret', () => {
  assert.equal(activeMentionQuery('antes @src/a.ts', 5), null);
});

test('insertMention replaces the fragment and keeps the tail', () => {
  assert.equal(
    insertMention('quem chama @src/au e o resto', 18, 'src/auth.ts'),
    'quem chama @src/auth.ts  e o resto',
  );
});

test('insertMention is a no-op without an @ before the caret', () => {
  assert.equal(insertMention('sem nada', 4, 'src/a.ts'), 'sem nada');
});

test('addMention ignores duplicates of the same repo and path', () => {
  const first = addMention([], { repoId: 'a/b', path: 'src/a.ts' });
  const second = addMention(first, { repoId: 'a/b', path: 'src/a.ts' });
  assert.equal(second.length, 1);
});

test('addMention keeps the same path from a different repo', () => {
  const mentions = addMention(
    [{ repoId: 'a/b', path: 'src/a.ts' }],
    { repoId: 'a/c', path: 'src/a.ts' },
  );
  assert.equal(mentions.length, 2);
});

test('addMention stops at the mention ceiling', () => {
  let mentions = [] as { repoId: string; path: string }[];
  for (let index = 0; index < MAX_MENTIONS + 5; index += 1) {
    mentions = addMention(mentions, { repoId: 'a/b', path: `src/f${index}.ts` });
  }
  assert.equal(mentions.length, MAX_MENTIONS);
});

test('usedMentions drops mentions erased from the text', () => {
  const mentions = [
    { repoId: 'a/b', path: 'src/a.ts' },
    { repoId: 'a/b', path: 'src/b.ts' },
  ];
  assert.deepEqual(usedMentions('só sobrou @src/b.ts', mentions), [
    { repoId: 'a/b', path: 'src/b.ts' },
  ]);
});
