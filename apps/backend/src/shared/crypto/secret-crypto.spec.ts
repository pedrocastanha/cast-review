import {
  decryptSecret,
  encryptSecret,
  SecretDecryptionError,
} from './secret-crypto';

describe('versioned secret encryption', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = '01'.repeat(32);
    delete process.env.SECRET_ENCRYPTION_ACTIVE_KEY;
    process.env.SECRET_ENCRYPTION_KEYS = JSON.stringify({
      old: '02'.repeat(32),
      next: '03'.repeat(32),
    });
  });
  afterEach(() => {
    process.env = { ...env };
  });
  it('reads legacy ciphertext after moving to a new key', () => {
    const legacy = encryptSecret('private');
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY = 'old';
    const previous = encryptSecret('private');
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY = 'next';
    const current = encryptSecret('private');
    expect(current.startsWith('v2:next:')).toBe(true);
    for (const value of [legacy, previous, current])
      expect(decryptSecret(value)).toBe('private');
    expect(current).not.toEqual(encryptSecret('private'));
  });
  it('rejects tampering and unrecognized keys', () => {
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY = 'old';
    const ciphertext = encryptSecret('private');
    expect(() =>
      decryptSecret(ciphertext.replace('v2:old:', 'v2:next:')),
    ).toThrow(SecretDecryptionError);
    expect(() => decryptSecret(`${ciphertext}:extra`)).toThrow(
      SecretDecryptionError,
    );
    delete process.env.SECRET_ENCRYPTION_KEYS;
    expect(() => decryptSecret(ciphertext)).toThrow(SecretDecryptionError);
  });
});
