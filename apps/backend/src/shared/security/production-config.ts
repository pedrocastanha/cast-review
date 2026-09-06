export function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  for (const name of [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'AI_SERVICE_TOKEN',
  ]) {
    if ((process.env[name]?.length ?? 0) < 32)
      throw new Error(`${name} inválido`);
  }
  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET)
    throw new Error('JWT secrets must be independent');
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.SECRET_ENCRYPTION_KEY ?? ''))
    throw new Error('SECRET_ENCRYPTION_KEY inválido');
  for (const name of [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'AI_API_URL',
    'FRONTEND_ORIGINS',
  ]) {
    if (!process.env[name]) throw new Error(`${name} obrigatório`);
  }
}
