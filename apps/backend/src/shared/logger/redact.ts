const sensitive =
  /password|secret|token|authorization|cookie|apikey|api_key|github_token|openai|prompt|diff|body|content|headers|query|email|identifier/i;

export function redact(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 8) return '[REDACTED]';
  if (typeof value === 'string')
    return value.replace(
      /(?:Bearer\s+\S+|(?:sk-|gh[pousr]_|github_pat_)[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)/gi,
      '[REDACTED]',
    );
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
