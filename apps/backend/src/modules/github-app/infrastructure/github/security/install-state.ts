import { createHmac, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 30 * 60 * 1000;

interface StatePayload {
  userId: string;
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function createInstallState(
  secret: string,
  userId: string,
  now: number = Date.now(),
): string {
  const body = encode(JSON.stringify({ userId, exp: now + STATE_TTL_MS }));
  return `${body}.${sign(secret, body)}`;
}

export function verifyInstallState(
  secret: string,
  state: string | undefined,
  now: number = Date.now(),
): StatePayload | null {
  if (!secret || !state) return null;
  const [body, signature] = state.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(secret, body));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as StatePayload;
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number')
      return null;
    if (payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
