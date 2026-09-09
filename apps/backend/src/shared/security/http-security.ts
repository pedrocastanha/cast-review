import type { NextFunction, Request, Response } from 'express';

export function allowedOrigins(): string[] {
  const raw =
    process.env.FRONTEND_ORIGINS ??
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !origins.length ||
    origins.some(
      (origin) =>
        new URL(origin).origin !== origin ||
        !['http:', 'https:'].includes(new URL(origin).protocol) ||
        (process.env.NODE_ENV === 'production' &&
          !origin.startsWith('https://')),
    )
  ) {
    throw new Error('FRONTEND_ORIGINS inválido');
  }
  return origins;
}

export function httpSecurity(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production')
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  if (
    /^\/auth\/(login|refresh|logout|register|demo)\/?$/i.test(req.path) &&
    req.method === 'POST'
  ) {
    if (
      !req.headers.origin ||
      !allowedOrigins().includes(req.headers.origin) ||
      req.headers['x-cast-csrf'] !== '1'
    ) {
      res.status(403).json({ message: 'Origem inválida' });
      return;
    }
  }
  next();
}
