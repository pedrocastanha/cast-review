import { redact } from './redact';

const OPENAI_KEY = 'sk-proj-abcdef0123456789abcdef0123456789';
const CLASSIC_PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const FINE_GRAINED_PAT = 'github_pat_11ABCDEFG0abcdefghijkl_abcdef123456';
const JWT = 'JwtFixtureRedactionA1';

function serialized(value: unknown): string {
  return JSON.stringify(redact(value));
}

describe('log redaction', () => {
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

  describe('credential headers carried per request', () => {
    it('redacts the session credential headers', () => {
      const output = serialized({
        headers: {
          'x-cast-openai-key': OPENAI_KEY,
          'x-cast-github-token': CLASSIC_PAT,
          authorization: `Bearer ${JWT}`,
          cookie: `cast_refresh=${JWT}`,
        },
      });

      expect(output).not.toContain(OPENAI_KEY);
      expect(output).not.toContain(CLASSIC_PAT);
      expect(output).not.toContain(JWT);
    });

    it('redacts the credential headers even outside a headers wrapper', () => {
      const output = serialized({
        'x-cast-openai-key': OPENAI_KEY,
        'x-cast-github-token': CLASSIC_PAT,
      });

      expect(output).not.toContain(OPENAI_KEY);
      expect(output).not.toContain(CLASSIC_PAT);
    });

    it('redacts credentials nested deep inside a payload', () => {
      const output = serialized({
        level: { one: { two: { apiKeys: { openai: OPENAI_KEY } } } },
      });

      expect(output).not.toContain(OPENAI_KEY);
    });
  });

  describe('credentials appearing inside free-form strings', () => {
    it.each([
      ['openai key', OPENAI_KEY],
      ['classic PAT', CLASSIC_PAT],
      ['fine grained PAT', FINE_GRAINED_PAT],
      ['jwt', JWT],
    ])('scrubs a leaked %s from a message', (_label, secret) => {
      const output = serialized({
        detail: `upstream rejected the call using ${secret} at 12:00`,
      });

      expect(output).not.toContain(secret);
      expect(output).toContain('[REDACTED]');
    });

    it('scrubs a bearer header echoed inside an error string', () => {
      const output = serialized({
        detail: `request failed: Authorization: Bearer ${JWT}`,
      });

      expect(output).not.toContain(JWT);
    });
  });

  describe('exceptions', () => {
    it('keeps only the error name, never the message or stack', () => {
      const error = new Error(`OpenAI rejected key ${OPENAI_KEY}`);
      const output = serialized({ exception: error });

      expect(output).not.toContain(OPENAI_KEY);
      expect(output).not.toContain('.ts');
    });

    it('drops a credential attached to a custom error property', () => {
      const error = Object.assign(new Error('upstream'), {
        config: { headers: { Authorization: `Bearer ${OPENAI_KEY}` } },
      });

      expect(serialized({ exception: error })).not.toContain(OPENAI_KEY);
    });
  });

  describe('structural safety', () => {
    it('survives a circular payload', () => {
      const node: Record<string, unknown> = { openaiKey: OPENAI_KEY };
      node.self = node;

      const output = serialized(node);
      expect(output).toContain('[CIRCULAR]');
      expect(output).not.toContain(OPENAI_KEY);
    });

    it('stops recursing on a deeply nested payload', () => {
      let node: Record<string, unknown> = { leaf: OPENAI_KEY };
      for (let depth = 0; depth < 20; depth += 1) node = { nested: node };

      expect(serialized(node)).not.toContain(OPENAI_KEY);
    });

    it('redacts credentials inside arrays', () => {
      expect(serialized({ tokens: [OPENAI_KEY, CLASSIC_PAT] })).not.toContain(
        OPENAI_KEY,
      );
    });

    it('keeps the operational fields that make logs useful', () => {
      const output = redact({
        method: 'POST',
        url: '/analyses/:id/resume',
        status: 200,
        durationMs: 42,
        userId: 'ba4c0d1e-0000-4000-8000-000000000001',
      }) as Record<string, unknown>;

      expect(output.method).toBe('POST');
      expect(output.url).toBe('/analyses/:id/resume');
      expect(output.status).toBe(200);
      expect(output.durationMs).toBe(42);
      expect(output.userId).toBe('ba4c0d1e-0000-4000-8000-000000000001');
    });
  });

  describe('provider keys with prefixes we do not know', () => {
    it.each([
      ['azure style', 'AZ-9f8e7d6c5b4a39281706'],
      ['mixed base62', 'Xk7Qp2Lm9Rt4Vw8Zb3Nc6Hy1'],
      ['vendor prefixed', 'acme-live-K3n8Rp2Qw9Lm4Tz7'],
      ['base64 blob', 'U2VjcmV0VmFsdWUxMjM0NTY3ODkw'],
    ])('scrubs an unknown %s key from a bare string', (_label, key) => {
      const output = serialized({ detail: `chamou com ${key}` });

      expect(output).not.toContain(key);
      expect(output).toContain('[REDACTED]');
    });

    it.each([
      ['aws access key', 'AKIAIOSFODNN7EXAMPLE'],
      ['stripe live key', 'sk_live_51H8xKmLpQr2Ts4Uv6Wy8Za'],
      ['slack bot token', 'xoxb-1234-5678-abcdEFGHijklMNOP'],
      ['google api key', 'AIzaSyD3nK7pQr2Ts4Uv6Wy8ZaBcDeFgHiJkLm'],
      ['gitlab pat', 'glpat-K3n8Rp2Qw9Lm4Tz7Vx1'],
      ['npm token', 'npm_K3n8Rp2Qw9Lm4Tz7Vx1Yb5'],
      ['anthropic key', 'sk-ant-api03-K3n8Rp2Qw9Lm4Tz7'],
    ])('scrubs a %s by its prefix', (_label, key) => {
      const output = serialized({ detail: `upstream: ${key}` });

      expect(output).not.toContain(key);
    });

    it('scrubs a PEM private key block', () => {
      const pem =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
      const output = serialized({ detail: pem });

      expect(output).not.toContain('MIIEpAIBAAKCAQEA');
    });
  });

  describe('operational values that must survive', () => {
    it.each([
      ['route with params', '/repositories/:repo/pulls/:pullNumber/analyses'],
      ['uuid', 'ba4c0d1e-0000-4000-8000-000000000001'],
      ['uppercase uuid', 'BA4C0D1E-0000-4000-8000-000000000001'],
      ['git sha', 'a15b943d71d6dd82e4a0475087971d116164fc9a'],
      ['short sha', 'a15b943'],
      ['iso timestamp', '2026-09-08T21:10:48.964Z'],
      ['model name', 'gpt-4o-mini-2024-07-18'],
      ['repo full name', 'pedro/minha-aplicacao-fullstack-1'],
      ['branch name', 'fix/improve-security-round-2'],
      ['plain sentence', 'analise concluida sem findings bloqueantes'],
      ['file path', 'src/shared/logger/redact.spec.ts'],
    ])('keeps the %s intact', (_label, value) => {
      expect(serialized({ detail: value })).toContain(value);
    });

    it('keeps a whole structured log line readable', () => {
      const line = redact({
        method: 'POST',
        url: '/repositories/:repo/pulls/:pullNumber/analyses',
        status: 200,
        durationMs: 1240,
        userId: 'ba4c0d1e-0000-4000-8000-000000000001',
        analysisId: '7f3d2c10-1111-4222-8333-444455556666',
        headSha: 'a15b943d71d6dd82e4a0475087971d116164fc9a',
      });

      expect(JSON.stringify(line)).not.toContain('[REDACTED]');
    });
  });

  describe('gaps that remain, on purpose', () => {
    it('keeps a pure hex string, because a git sha looks exactly like one', () => {
      const hexKey = '9f8e7d6c5b4a392817069f8e7d6c5b4a';
      expect(serialized({ detail: hexKey })).toContain(hexKey);
    });

    it('keeps an all-lowercase token, because slugs look exactly like one', () => {
      const lowerKey = 'k3n8rp2qw9lm4tz7vx1yb5nc6hy';
      expect(serialized({ detail: lowerKey })).toContain(lowerKey);
    });

    it('still catches both once they sit under a named field', () => {
      const output = serialized({
        apiKey: '9f8e7d6c5b4a392817069f8e7d6c5b4a',
        openaiKey: 'k3n8rp2qw9lm4tz7vx1yb5nc6hy',
      });

      expect(output).not.toContain('9f8e7d6c5b4a');
      expect(output).not.toContain('k3n8rp2qw9lm4tz7');
    });
  });
});
