const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function demoLoginEnabled(): boolean {
  return TRUTHY.has((process.env.DEMO_LOGIN ?? '').trim().toLowerCase());
}

export function demoSessionTtlMinutes(): number {
  const raw = process.env.DEMO_SESSION_TTL_MINUTES?.trim();
  if (!raw) return 120;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 1440) {
    throw new Error('DEMO_SESSION_TTL_MINUTES inválido: use 1 a 1440');
  }

  return value;
}
