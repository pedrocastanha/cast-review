const sensitive =
  /password|secret|token|authorization|cookie|apikey|api_key|github_token|openai|prompt|diff|body|content|headers|query|email|identifier|credential|passphrase|private_key|privatekey|signature|session/i;

const knownSecret =
  /(?:Bearer\s+\S+|(?:sk-|sk_live_|sk_test_|rk_live_|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AIza|ASIA|AKIA|npm_|dop_v1_|shpat_)[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|-----BEGIN[\s\S]*?-----END[^-]*-----)/gi;

const candidate = /[A-Za-z0-9_\-+=]{20,}/g;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hexOnly = /^[0-9a-f]+$/i;
const digitsOnly = /^\d+$/;
const isoDate = /^\d{4}-\d{2}-\d{2}T?[\dZ]*$/;

function looksLikeSecret(token: string): boolean {
  if (
    uuid.test(token) ||
    hexOnly.test(token) ||
    digitsOnly.test(token) ||
    isoDate.test(token)
  ) {
    return false;
  }

  return /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);
}

export function scrubSecrets(value: string): string {
  return value
    .replace(knownSecret, '[REDACTED]')
    .replace(candidate, (token) =>
      looksLikeSecret(token) ? '[REDACTED]' : token,
    );
}

export function redact(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 8) return '[REDACTED]';
  if (typeof value === 'string') return scrubSecrets(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name };
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redact(item, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitive.test(key) ? '[REDACTED]' : redact(item, seen, depth + 1),
    ]),
  );
}
