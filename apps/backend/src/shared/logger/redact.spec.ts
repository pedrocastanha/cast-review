import { redact } from './redact';

describe('redaction', () => {
  it('removes nested credentials, payloads and exception data', () => {
    const data = redact({
      context: { apiKeys: { openai: 'secret' }, prompt: 'private code' },
      exception: new Error('private code'),
      message: 'Bearer abc123',
    });
    expect(JSON.stringify(data)).not.toContain('secret');
    expect(JSON.stringify(data)).not.toContain('private code');
    expect(JSON.stringify(data)).not.toContain('abc123');
  });
});
