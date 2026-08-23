import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanPullRequestBody,
  normalizeBenchmarkChangedFiles,
} from '../src/lib/benchmark-pr-context.ts';

test('cleanPullRequestBody removes hidden GitHub template comments', () => {
  assert.equal(
    cleanPullRequestBody('## Problema\r\n\r\n<!-- template interno -->\r\nCorreção.\r\n\r\n\r\nFim.'),
    '## Problema\n\nCorreção.\n\nFim.',
  );
});

test('cleanPullRequestBody removes decorative HTML without losing its text', () => {
  assert.equal(
    cleanPullRequestBody(
      'Resumo.\n\n<sup>Gerado para o commit abc.</sup>\n\n<a href="https://example.com"><picture><img alt="badge"></picture></a>',
    ),
    'Resumo.\n\nGerado para o commit abc.',
  );
});

test('normalizeBenchmarkChangedFiles keeps only displayable frozen files', () => {
  assert.deepEqual(
    normalizeBenchmarkChangedFiles([
      { path: 'src/index.ts', diff: '@@ -1 +1 @@' },
      { path: '', diff: 'ignorado' },
      { path: 'README.md' },
    ]),
    [
      { path: 'src/index.ts', diff: '@@ -1 +1 @@' },
      { path: 'README.md', diff: '' },
    ],
  );
});
