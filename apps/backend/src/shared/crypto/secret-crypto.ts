import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ValueTransformer } from 'typeorm';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const FORMAT_VERSION = 'v1';

export class SecretDecryptionError extends Error {
  constructor() {
    super('Não foi possível decifrar o segredo armazenado');
    this.name = 'SecretDecryptionError';
  }
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const raw = process.env.SECRET_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY não configurada. Gere com: openssl rand -hex 32',
    );
  }

  const key = Buffer.from(raw, 'hex');

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `SECRET_ENCRYPTION_KEY deve ter ${KEY_LENGTH} bytes em hex (${KEY_LENGTH * 2} caracteres)`,
    );
  }

  cachedKey = key;
  return key;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${FORMAT_VERSION}:`);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);

  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');

  if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext) {
    throw new SecretDecryptionError();
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretDecryptionError();
  }
}

export const encryptedColumn: ValueTransformer = {
  to: (value: string | null | undefined) =>
    value == null ? value : encryptSecret(value),
  from: (value: string | null | undefined) =>
    value == null ? value : decryptSecret(value),
};
