import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const GITHUB_TOKEN_HEADER = 'x-cast-github-token';
export const OPENAI_KEY_HEADER = 'x-cast-openai-key';

const MAX_CREDENTIAL_LENGTH = 512;

export interface RequestCredentials {
  githubToken?: string;
  openaiKey?: string;
}

const storage = new AsyncLocalStorage<RequestCredentials>();

export type CredentialsMode = 'stored' | 'ephemeral';

export function credentialsMode(): CredentialsMode {
  const raw = (process.env.CREDENTIALS_MODE ?? 'stored').trim().toLowerCase();
  if (raw !== 'stored' && raw !== 'ephemeral') {
    throw new Error('CREDENTIALS_MODE inválido: use stored ou ephemeral');
  }
  return raw;
}

export function isEphemeralMode(): boolean {
  return credentialsMode() === 'ephemeral';
}

function readHeader(request: Request, name: string): string | undefined {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.length > MAX_CREDENTIAL_LENGTH) {
    throw new BadRequestException('Credencial de sessão inválida');
  }

  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new BadRequestException('Credencial de sessão inválida');
  }

  return trimmed;
}

export function requestCredentials(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  let credentials: RequestCredentials;

  try {
    credentials = {
      githubToken: readHeader(req, GITHUB_TOKEN_HEADER),
      openaiKey: readHeader(req, OPENAI_KEY_HEADER),
    };
  } catch (err) {
    next(err);
    return;
  }

  if (!credentials.githubToken && !credentials.openaiKey) {
    next();
    return;
  }

  storage.run(credentials, () => next());
}

export function currentRequestCredentials(): RequestCredentials {
  return storage.getStore() ?? {};
}

export function runWithRequestCredentials<T>(
  credentials: RequestCredentials,
  callback: () => T,
): T {
  return storage.run(credentials, callback);
}
