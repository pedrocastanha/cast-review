import { BadRequestException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  credentialsMode,
  currentRequestCredentials,
  GITHUB_TOKEN_HEADER,
  isEphemeralMode,
  OPENAI_KEY_HEADER,
  requestCredentials,
  runWithRequestCredentials,
} from './request-credentials';

function run(headers: Record<string, string | string[]>) {
  const seen: Array<ReturnType<typeof currentRequestCredentials>> = [];
  const errors: unknown[] = [];
  const next: NextFunction = ((err?: unknown) => {
    if (err) errors.push(err);
    seen.push(currentRequestCredentials());
  }) as NextFunction;

  requestCredentials({ headers } as unknown as Request, {} as Response, next);

  return { credentials: seen[0], errors };
}

describe('per-request credentials', () => {
  const environment = { ...process.env };

  afterEach(() => {
    process.env = { ...environment };
  });

  it('is empty when no credential header is sent', () => {
    expect(run({}).credentials).toEqual({});
  });

  it('carries both credentials through the request scope', () => {
    const { credentials } = run({
      [GITHUB_TOKEN_HEADER]: 'ghp_from_session',
      [OPENAI_KEY_HEADER]: 'sk-from-session',
    });

    expect(credentials).toEqual({
      githubToken: 'ghp_from_session',
      openaiKey: 'sk-from-session',
    });
  });

  it('does not leak credentials outside the request scope', () => {
    run({ [OPENAI_KEY_HEADER]: 'sk-from-session' });
    expect(currentRequestCredentials()).toEqual({});
  });

  it('keeps requests isolated from each other', () => {
    const first = run({ [OPENAI_KEY_HEADER]: 'sk-one' });
    const second = run({ [OPENAI_KEY_HEADER]: 'sk-two' });

    expect(first.credentials.openaiKey).toBe('sk-one');
    expect(second.credentials.openaiKey).toBe('sk-two');
  });

  it('ignores a blank header', () => {
    expect(run({ [OPENAI_KEY_HEADER]: '   ' }).credentials).toEqual({});
  });

  it('takes the first value of a repeated header', () => {
    const { credentials } = run({
      [OPENAI_KEY_HEADER]: ['sk-first', 'sk-second'],
    });

    expect(credentials.openaiKey).toBe('sk-first');
  });

  it('rejects an oversized credential', () => {
    const { errors } = run({ [OPENAI_KEY_HEADER]: 'sk-'.padEnd(600, 'x') });
    expect(errors[0]).toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['newline', 'sk-abc\ndef'],
    ['space', 'sk abc'],
    ['tab', 'sk\tabc'],
    ['non-ascii', 'sk-abcé'],
  ])('rejects a credential containing a %s', (_label, value) => {
    const { errors } = run({ [OPENAI_KEY_HEADER]: value });
    expect(errors[0]).toBeInstanceOf(BadRequestException);
  });

  it('exposes credentials to nested async work', async () => {
    const seen = await runWithRequestCredentials(
      { openaiKey: 'sk-nested' },
      async () => {
        await Promise.resolve();
        return currentRequestCredentials().openaiKey;
      },
    );

    expect(seen).toBe('sk-nested');
  });

  describe('mode', () => {
    it('defaults to stored so self-host keeps working', () => {
      delete process.env.CREDENTIALS_MODE;
      expect(credentialsMode()).toBe('stored');
      expect(isEphemeralMode()).toBe(false);
    });

    it('reads the ephemeral mode', () => {
      process.env.CREDENTIALS_MODE = 'Ephemeral';
      expect(isEphemeralMode()).toBe(true);
    });

    it('refuses an unknown mode', () => {
      process.env.CREDENTIALS_MODE = 'whatever';
      expect(() => credentialsMode()).toThrow(/CREDENTIALS_MODE/);
    });
  });
});
