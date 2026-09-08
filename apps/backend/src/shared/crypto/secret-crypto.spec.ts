import {
  decryptBoundSecret,
  decryptSecret,
  encryptBoundSecret,
  encryptSecret,
  isBoundToOwner,
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

describe('owner-bound secret encryption', () => {
  const env = { ...process.env };
  const owner = 'ba4c0d1e-0000-4000-8000-000000000001';
  const other = 'ba4c0d1e-0000-4000-8000-000000000002';

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

  it('round-trips a secret bound to its owner and field', () => {
    const payload = encryptBoundSecret('ghp_secret', {
      ownerId: owner,
      field: 'github_token',
    });

    expect(isBoundToOwner(payload)).toBe(true);
    expect(payload.startsWith('v3:')).toBe(true);
    expect(payload).not.toContain('ghp_secret');
    expect(
      decryptBoundSecret(payload, { ownerId: owner, field: 'github_token' }),
    ).toBe('ghp_secret');
  });

  it('refuses a ciphertext moved to another owner', () => {
    const payload = encryptBoundSecret('ghp_secret', {
      ownerId: owner,
      field: 'github_token',
    });

    expect(() =>
      decryptBoundSecret(payload, { ownerId: other, field: 'github_token' }),
    ).toThrow(SecretDecryptionError);
  });

  it('refuses a ciphertext moved to another column', () => {
    const payload = encryptBoundSecret('ghp_secret', {
      ownerId: owner,
      field: 'github_token',
    });

    expect(() =>
      decryptBoundSecret(payload, { ownerId: owner, field: 'openai_key' }),
    ).toThrow(SecretDecryptionError);
  });

  it('produces a different ciphertext on every write', () => {
    const binding = { ownerId: owner, field: 'openai_key' };
    expect(encryptBoundSecret('sk-same', binding)).not.toBe(
      encryptBoundSecret('sk-same', binding),
    );
  });

  it('still reads legacy v1 and v2 ciphertext through the bound reader', () => {
    const legacy = encryptSecret('sk-legacy');
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY = 'next';
    const versioned = encryptSecret('sk-versioned');
    const binding = { ownerId: owner, field: 'openai_key' };

    expect(decryptBoundSecret(legacy, binding)).toBe('sk-legacy');
    expect(decryptBoundSecret(versioned, binding)).toBe('sk-versioned');
    expect(isBoundToOwner(legacy)).toBe(false);
    expect(isBoundToOwner(versioned)).toBe(false);
  });

  it('binds to the active key and rejects a swapped key id', () => {
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY = 'old';
    const payload = encryptBoundSecret('sk-rotated', {
      ownerId: owner,
      field: 'openai_key',
    });

    expect(payload.startsWith('v3:old:')).toBe(true);
    expect(() =>
      decryptBoundSecret(payload.replace('v3:old:', 'v3:next:'), {
        ownerId: owner,
        field: 'openai_key',
      }),
    ).toThrow(SecretDecryptionError);
  });

  it('rejects tampering with the ciphertext body', () => {
    const binding = { ownerId: owner, field: 'openai_key' };
    const payload = encryptBoundSecret('sk-intact', binding);
    const parts = payload.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');

    expect(() => decryptBoundSecret(parts.join(':'), binding)).toThrow(
      SecretDecryptionError,
    );
  });

  it.each(['v3:', 'v3::::', 'v3:k:only:two'])(
    'rejects the malformed payload %p',
    (payload) => {
      expect(() =>
        decryptBoundSecret(payload, { ownerId: owner, field: 'openai_key' }),
      ).toThrow(SecretDecryptionError);
    },
  );

  it.each(['bad field', 'field:name', ''])(
    'rejects the unsafe field name %p',
    (field) => {
      expect(() => encryptBoundSecret('sk', { ownerId: owner, field })).toThrow(
        /field name/,
      );
    },
  );

  it('rejects an owner id that could forge the binding separator', () => {
    expect(() =>
      encryptBoundSecret('sk', { ownerId: 'a:b', field: 'openai_key' }),
    ).toThrow(/owner id/);
  });
});
