import 'dotenv/config';

import type { JwtSignOptions } from '@nestjs/jwt';

type ExpiresIn = JwtSignOptions['expiresIn'];

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  return value;
}

export const jwtConfig = {
  access: {
    secret: requireEnv('JWT_ACCESS_SECRET'),
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as ExpiresIn,
  },
  refresh: {
    secret: requireEnv('JWT_REFRESH_SECRET'),
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as ExpiresIn,
  },
} as const;
