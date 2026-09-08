import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sseLimits } from './production-config';

const BASE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

const streamsByUser = new Map<string, number>();
let totalStreams = 0;

export interface SseStream {
  signal: AbortSignal;
  release: () => void;
}

export interface OpenSseStreamOptions {
  req: Request;
  res: Response;
  userId: string;
  headers?: Record<string, string>;
}

function acquireSlot(userId: string) {
  const limits = sseLimits();
  const current = streamsByUser.get(userId) ?? 0;

  if (totalStreams >= limits.maxTotal) {
    throw new HttpException(
      'Limite de streams simultâneos atingido',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  if (current >= limits.maxPerUser) {
    throw new HttpException(
      'Limite de streams simultâneos por usuário atingido',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  streamsByUser.set(userId, current + 1);
  totalStreams += 1;
}

function releaseSlot(userId: string) {
  const current = streamsByUser.get(userId) ?? 0;
  if (current <= 1) streamsByUser.delete(userId);
  else streamsByUser.set(userId, current - 1);
  totalStreams = Math.max(0, totalStreams - 1);
}

export function openSseStream({
  req,
  res,
  userId,
  headers,
}: OpenSseStreamOptions): SseStream {
  acquireSlot(userId);

  const limits = sseLimits();
  const controller = new AbortController();
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    releaseSlot(userId);
    if (!controller.signal.aborted) controller.abort();
  };

  const timer = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          payload: { message: 'Stream encerrado por tempo máximo' },
        })}\n\n`,
      );
      res.end();
    }
    release();
  }, limits.maxDurationMs);
  timer.unref?.();

  try {
    req.on?.('close', release);
    res.on?.('close', release);
    res.on?.('finish', release);

    res.writeHead(200, { ...headers, ...BASE_HEADERS });
    res.flushHeaders?.();
  } catch (err) {
    release();
    throw err;
  }

  return { signal: controller.signal, release };
}

export function resetSseLimitsForTesting() {
  streamsByUser.clear();
  totalStreams = 0;
}
