import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ValueTransformer } from 'typeorm';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const FORMAT_VERSION = 'v1';
const BOUND_VERSION = 'v3';

export class SecretDecryptionError extends Error {
  constructor() {
    super('Não foi possível decifrar o segredo armazenado');
    this.name = 'SecretDecryptionError';
  }
}

export interface SecretBinding {
  ownerId: string;
  field: string;
}

function getKey(keyId?: string): Buffer {
  let raw = process.env.SECRET_ENCRYPTION_KEY?.trim();
  if (keyId) {
    const keys = JSON.parse(
      process.env.SECRET_ENCRYPTION_KEYS ?? '{}',
    ) as Record<string, string>;
    raw = Object.hasOwn(keys, keyId) ? keys[keyId] : undefined;
  }

  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY não configurada. Gere com: openssl rand -hex 32',
    );
  }

  const key = Buffer.from(raw, 'hex');

  if (!/^[a-fA-F0-9]{64}$/.test(raw) || key.length !== KEY_LENGTH) {
    throw new Error(
      `SECRET_ENCRYPTION_KEY deve ter ${KEY_LENGTH} bytes em hex (${KEY_LENGTH * 2} caracteres)`,
    );
  }

  return key;
}

function activeKeyId(): string | undefined {
  const keyId = process.env.SECRET_ENCRYPTION_ACTIVE_KEY;
  if (keyId && !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId))
    throw new Error('Invalid encryption key ID');
  return keyId;
}

function bindingLabel(binding: SecretBinding): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(binding.field))
    throw new Error('Invalid secret field name');
  if (!binding.ownerId || binding.ownerId.includes(':'))
    throw new Error('Invalid secret owner id');
  return `${binding.ownerId}|${binding.field}`;
}

export function isEncrypted(value: string): boolean {
  return (
    value.startsWith(`${FORMAT_VERSION}:`) ||
    value.startsWith('v2:') ||
    value.startsWith(`${BOUND_VERSION}:`)
  );
}

export function isBoundToOwner(value: string): boolean {
  return value.startsWith(`${BOUND_VERSION}:`);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const keyId = activeKeyId();
  const cipher = createCipheriv(ALGORITHM, getKey(keyId), iv);
  if (keyId) cipher.setAAD(Buffer.from(`v2:${keyId}`));
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);

  return [
    ...(keyId ? ['v2', keyId] : [FORMAT_VERSION]),
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function encryptBoundSecret(
  plain: string,
  binding: SecretBinding,
): string {
  const iv = randomBytes(IV_LENGTH);
  const keyId = activeKeyId() ?? '';
  const label = bindingLabel(binding);
  const cipher = createCipheriv(ALGORITHM, getKey(activeKeyId()), iv);
  cipher.setAAD(Buffer.from(`${BOUND_VERSION}:${keyId}:${label}`));
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);

  return [
    BOUND_VERSION,
    keyId,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  const version = parts.shift();
  const keyId = version === 'v2' ? parts.shift() : undefined;
  const [iv, tag, ciphertext] = parts;

  if (
    !['v1', 'v2'].includes(version ?? '') ||
    parts.length !== 3 ||
    !iv ||
    !tag ||
    ciphertext === undefined ||
    (version === 'v2' && !keyId)
  ) {
    throw new SecretDecryptionError();
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(keyId),
      Buffer.from(iv, 'base64'),
    );
    if (keyId) decipher.setAAD(Buffer.from(`v2:${keyId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretDecryptionError();
  }
}

export function decryptBoundSecret(
  payload: string,
  binding: SecretBinding,
): string {
  if (!isBoundToOwner(payload)) return decryptSecret(payload);

  const parts = payload.split(':');
  const version = parts.shift();
  const keyId = parts.shift();
  const [iv, tag, ciphertext] = parts;

  if (
    version !== BOUND_VERSION ||
    keyId === undefined ||
    parts.length !== 3 ||
    !iv ||
    !tag ||
    ciphertext === undefined
  ) {
    throw new SecretDecryptionError();
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(keyId || undefined),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAAD(
      Buffer.from(`${BOUND_VERSION}:${keyId}:${bindingLabel(binding)}`),
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
