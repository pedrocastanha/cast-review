export function serviceFetch(url: string, init: RequestInit = {}) {
  const key = process.env.AI_SERVICE_TOKEN;
  if (process.env.NODE_ENV === 'production' && (!key || key.length < 32))
    throw new Error('AI_SERVICE_TOKEN inválido');
  const headers = new Headers(init.headers);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  return fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(120_000),
    redirect: 'error',
  });
}
