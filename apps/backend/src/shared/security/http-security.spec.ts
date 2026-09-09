import type { Request, Response } from 'express';
import { allowedOrigins, httpSecurity } from './http-security';

describe('browser security boundary', () => {
  const environment = { ...process.env };
  afterEach(() => {
    process.env = { ...environment };
  });
  it('fails closed when production origins are absent', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_ORIGINS;
    expect(() => allowedOrigins()).toThrow();
  });
  it.each([undefined, 'https://attacker.test'])(
    'rejects refresh from %s',
    (origin) => {
      process.env.FRONTEND_ORIGINS = 'https://cast.test';
      const next = jest.fn();
      const res = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      httpSecurity(
        {
          path: '/auth/refresh',
          method: 'POST',
          headers: { origin, 'x-cast-csrf': '1' },
        } as unknown as Request,
        res as unknown as Response,
        next,
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    },
  );
});
