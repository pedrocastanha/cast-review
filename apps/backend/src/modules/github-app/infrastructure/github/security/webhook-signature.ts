import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeWebhookSignature(
  secret: string,
  rawBody: Buffer,
): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
): boolean {
  if (!secret || !rawBody || !signatureHeader) return false;
  const expected = Buffer.from(computeWebhookSignature(secret, rawBody));
  const received = Buffer.from(signatureHeader.trim());
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
