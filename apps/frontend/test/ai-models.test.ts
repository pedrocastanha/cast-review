import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AI_MODEL, SUGGESTED_AI_MODELS } from '../src/lib/ai-models.ts';

test('the shared AI model default is gpt-5.4-mini', () => {
  assert.equal(DEFAULT_AI_MODEL, 'gpt-5.4-mini');
  assert.equal(SUGGESTED_AI_MODELS[0], DEFAULT_AI_MODEL);
});
