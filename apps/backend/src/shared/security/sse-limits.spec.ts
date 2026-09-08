import { EventEmitter } from 'node:events';
import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { openSseStream, resetSseLimitsForTesting } from './sse-limits';

class FakeResponse extends EventEmitter {
  writableEnded = false;
  writeHead = jest.fn();
  flushHeaders = jest.fn();
  write = jest.fn((chunk: string) => {
    this.chunks.push(chunk);
    return true;
  });
  end = jest.fn(() => {
    this.writableEnded = true;
  });
  chunks: string[] = [];
}

function fakePair() {
  const req = new EventEmitter() as unknown as Request;
  const res = new FakeResponse();
  return { req, res: res as unknown as Response, raw: res };
}

function open(userId: string, headers?: Record<string, string>) {
  const { req, res, raw } = fakePair();
  const stream = openSseStream({ req, res, userId, headers });
  return { req: req as unknown as EventEmitter, res, raw, stream };
}

describe('SSE stream limits', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    resetSseLimitsForTesting();
    process.env = {
      ...environment,
      NODE_ENV: 'test',
      SSE_MAX_STREAMS_PER_USER: '2',
      SSE_MAX_STREAMS_TOTAL: '3',
      SSE_MAX_DURATION_MS: '1000',
    } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = { ...environment };
    jest.useRealTimers();
  });

  it('writes hardened event-stream headers merged with the caller headers', () => {
    const { raw } = open('user-a', { 'X-Analysis-Id': 'analysis-1' });

    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      'X-Analysis-Id': 'analysis-1',
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(raw.flushHeaders).toHaveBeenCalled();
  });

  it('refuses a caller attempt to weaken the stream headers', () => {
    const { raw } = open('user-a', { 'Cache-Control': 'public, max-age=600' });

    const [, headers] = raw.writeHead.mock.calls[0] as [
      number,
      Record<string, string>,
    ];
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Content-Type']).toBe('text/event-stream');
  });

  it('caps concurrent streams per user with 429', () => {
    open('user-a');
    open('user-a');

    expect(() => open('user-a')).toThrow(
      expect.objectContaining({ status: HttpStatus.TOO_MANY_REQUESTS }),
    );
  });

  it('isolates the per-user budget between users', () => {
    open('user-a');
    open('user-a');

    expect(() => open('user-b')).not.toThrow();
  });

  it('caps total concurrent streams with 503', () => {
    open('user-a');
    open('user-a');
    open('user-b');

    expect(() => open('user-c')).toThrow(
      expect.objectContaining({ status: HttpStatus.SERVICE_UNAVAILABLE }),
    );
  });

  it('frees the slot when the client disconnects', () => {
    const first = open('user-a');
    open('user-a');
    expect(() => open('user-a')).toThrow();

    first.raw.emit('close');

    expect(() => open('user-a')).not.toThrow();
  });

  it('frees the slot when the response finishes', () => {
    const first = open('user-a');
    open('user-a');

    first.raw.emit('finish');

    expect(() => open('user-a')).not.toThrow();
  });

  it('frees the slot when the request aborts', () => {
    const first = open('user-a');
    open('user-a');

    first.req.emit('close');

    expect(() => open('user-a')).not.toThrow();
  });

  it('aborts the downstream signal on disconnect', () => {
    const { stream, raw } = open('user-a');
    expect(stream.signal.aborted).toBe(false);

    raw.emit('close');

    expect(stream.signal.aborted).toBe(true);
  });

  it('does not double count a repeated close', () => {
    const first = open('user-a');
    first.raw.emit('close');
    first.raw.emit('close');
    first.raw.emit('finish');

    open('user-a');
    open('user-a');
    expect(() => open('user-a')).toThrow();
  });

  it('ends the stream once the maximum duration elapses', () => {
    jest.useFakeTimers();
    const { stream, raw } = open('user-a');

    jest.advanceTimersByTime(1000);

    expect(raw.end).toHaveBeenCalled();
    expect(raw.chunks.join('')).toContain('Stream encerrado por tempo máximo');
    expect(stream.signal.aborted).toBe(true);
  });

  it('frees the slot after the duration cap fires', () => {
    jest.useFakeTimers();
    open('user-a');
    open('user-a');

    jest.advanceTimersByTime(1000);

    expect(() => open('user-a')).not.toThrow();
  });

  it('does not write to a response that already ended when the cap fires', () => {
    jest.useFakeTimers();
    const { raw } = open('user-a');
    raw.writableEnded = true;

    jest.advanceTimersByTime(1000);

    expect(raw.end).not.toHaveBeenCalled();
  });

  it('releases the slot when writing the headers fails', () => {
    const { req, res, raw } = fakePair();
    raw.writeHead.mockImplementation(() => {
      throw new Error('socket gone');
    });

    expect(() => openSseStream({ req, res, userId: 'user-a' })).toThrow(
      'socket gone',
    );

    expect(() => open('user-a')).not.toThrow();
    expect(() => open('user-a')).not.toThrow();
    expect(() => open('user-a')).toThrow();
  });

  it('releases the slot manually without waiting for socket events', () => {
    const first = open('user-a');
    open('user-a');

    first.stream.release();

    expect(() => open('user-a')).not.toThrow();
  });
});
