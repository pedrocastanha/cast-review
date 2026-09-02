import {
  computeWebhookSignature,
  verifyWebhookSignature,
} from './webhook-signature';

const SECRET = 'segredo-de-teste';

describe('verifyWebhookSignature', () => {
  it('accepts a signature produced with the configured secret', () => {
    const body = Buffer.from(JSON.stringify({ action: 'opened' }));
    const signature = computeWebhookSignature(SECRET, body);
    expect(verifyWebhookSignature(SECRET, body, signature)).toBe(true);
  });

  it('rejects a body that was tampered with after signing', () => {
    const signature = computeWebhookSignature(
      SECRET,
      Buffer.from('{"action":"opened"}'),
    );
    expect(
      verifyWebhookSignature(
        SECRET,
        Buffer.from('{"action":"closed"}'),
        signature,
      ),
    ).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const body = Buffer.from('{}');
    expect(
      verifyWebhookSignature(
        SECRET,
        body,
        computeWebhookSignature('outro', body),
      ),
    ).toBe(false);
  });

  it('rejects missing secret, body or header instead of throwing', () => {
    const body = Buffer.from('{}');
    const signature = computeWebhookSignature(SECRET, body);
    expect(verifyWebhookSignature('', body, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, undefined, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, undefined)).toBe(false);
  });

  it('rejects a signature of a different length without throwing', () => {
    expect(
      verifyWebhookSignature(SECRET, Buffer.from('{}'), 'sha256=abc'),
    ).toBe(false);
  });
});
