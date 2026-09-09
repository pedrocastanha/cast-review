import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeUrl } from '../src/lib/safe-url.ts';

test('rejects executable, ambiguous and credential-bearing links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//evil.test', '/\\evil.test', 'java\nscript:alert(1)', 'https://user:secret@example.com']) {
    assert.equal(safeUrl(value), undefined);
  }
  assert.equal(safeUrl('/projects'), '/projects');
  assert.equal(safeUrl('https://example.com/code'), 'https://example.com/code');
});
