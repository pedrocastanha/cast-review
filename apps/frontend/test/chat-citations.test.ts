import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citationGithubUrl,
  citationGraphUrl,
  groupCitations,
} from '../src/lib/chat-citations.ts';
import type { ChatCitation } from '../src/types/index.ts';

const citations: ChatCitation[] = [
  {
    repoId: 'acme/front',
    sha: 'front-sha',
    path: 'src/z.ts',
    line: 8,
    symbolId: 'front-symbol',
    symbolName: 'render',
  },
  {
    repoId: 'acme/back',
    sha: 'back-sha',
    path: 'src/b.ts',
    line: 20,
    symbolId: null,
    symbolName: null,
  },
  {
    repoId: 'acme/back',
    sha: 'back-sha',
    path: 'src/a.ts',
    line: 4,
    symbolId: 'back-symbol',
    symbolName: 'login',
  },
];

test('groupCitations orders repositories, paths and lines', () => {
  const groups = groupCitations(citations);

  assert.deepEqual(
    groups.map((group) => group.repoId),
    ['acme/back', 'acme/front'],
  );
  assert.deepEqual(
    groups[0].citations.map((citation) => citation.path),
    ['src/a.ts', 'src/b.ts'],
  );
});

test('citationGithubUrl builds an immutable permalink', () => {
  assert.equal(
    citationGithubUrl(citations[0], {}),
    'https://github.com/acme/front/blob/front-sha/src/z.ts#L8',
  );
});

test('citationGithubUrl falls back to thread sha and refuses missing sha', () => {
  const citation = { ...citations[1], sha: null };
  assert.equal(
    citationGithubUrl(citation, { 'acme/back': 'thread-sha' }),
    'https://github.com/acme/back/blob/thread-sha/src/b.ts#L20',
  );
  assert.equal(citationGithubUrl(citation, {}), null);
});

test('citationGraphUrl links symbols to the repository graph', () => {
  assert.equal(
    citationGraphUrl(citations[0]),
    '/repos/acme/front/graph?focus=front-symbol',
  );
  assert.equal(citationGraphUrl(citations[1]), null);
});
