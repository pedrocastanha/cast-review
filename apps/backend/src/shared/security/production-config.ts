import { credentialsMode } from './request-credentials';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function flag(name: string): boolean {
  return TRUTHY.has((process.env[name] ?? '').trim().toLowerCase());
}

export function allowsPlaintextDependencies(): boolean {
  return flag('ALLOW_INSECURE_DEPENDENCIES');
}

export function chatGrantSecret(): string {
  const secret = process.env.CHAT_GRANT_SECRET?.trim();

  if (isProduction() && (!secret || secret.length < 32)) {
    throw new Error('CHAT_GRANT_SECRET inválido');
  }

  if (!secret) {
    throw new Error('CHAT_GRANT_SECRET não configurado');
  }

  return secret;
}

function validateMigrationDatabaseIdentity() {
  const raw = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!raw) return;

  let migrationUser: string;
  try {
    const parsed = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('protocolo inválido');
    }
    migrationUser = decodeURIComponent(parsed.username);
  } catch {
    throw new Error('MIGRATION_DATABASE_URL inválida');
  }

  if (!migrationUser) {
    throw new Error('MIGRATION_DATABASE_URL sem usuário');
  }

  if (migrationUser === process.env.DB_USER?.trim()) {
    throw new Error(
      'MIGRATION_DATABASE_URL não pode usar a mesma role do runtime',
    );
  }
}

export function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();

  if (!raw) {
    if (isProduction()) {
      throw new Error(
        'TRUST_PROXY_HOPS obrigatório em produção: 0 quando a aplicação recebe conexões diretas, ou o número exato de proxies confiáveis à frente dela',
      );
    }
    return 0;
  }

  const hops = Number(raw);

  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error('TRUST_PROXY_HOPS inválido');
  }

  return hops;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} inválido`);
  }

  return value;
}

function byteSize(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  if (!/^\d+(kb|mb)$/i.test(raw)) {
    throw new Error(`${name} inválido: use o formato 512kb ou 5mb`);
  }

  return raw;
}

export function requestLimits() {
  return {
    jsonBody: byteSize('BODY_LIMIT_JSON', '512kb'),
    webhookBody: byteSize('BODY_LIMIT_WEBHOOK', '5mb'),
    urlencodedBody: byteSize('BODY_LIMIT_URLENCODED', '64kb'),
    keepAliveTimeoutMs: positiveInt('KEEP_ALIVE_TIMEOUT_MS', 61_000),
    headersTimeoutMs: positiveInt('HEADERS_TIMEOUT_MS', 65_000),
    requestTimeoutMs: positiveInt('REQUEST_TIMEOUT_MS', 75_000),
    maxConnections: positiveInt('MAX_CONNECTIONS', 512),
  };
}

export type SameSitePolicy = 'strict' | 'lax' | 'none';

export function sessionCookiePolicy(): SameSitePolicy {
  const raw = (process.env.SESSION_COOKIE_SAMESITE ?? 'strict')
    .trim()
    .toLowerCase();

  if (raw !== 'strict' && raw !== 'lax' && raw !== 'none') {
    throw new Error(
      'SESSION_COOKIE_SAMESITE inválido: use strict, lax ou none',
    );
  }

  if (raw === 'none' && !isProduction()) {
    throw new Error(
      'SESSION_COOKIE_SAMESITE=none exige cookies Secure, disponíveis apenas em produção',
    );
  }

  return raw;
}

export function sseLimits() {
  return {
    maxDurationMs: positiveInt('SSE_MAX_DURATION_MS', 900_000),
    maxPerUser: positiveInt('SSE_MAX_STREAMS_PER_USER', 3),
    maxTotal: positiveInt('SSE_MAX_STREAMS_TOTAL', 200),
  };
}

function validateEncryptionKeyRing() {
  const activeKeyId = process.env.SECRET_ENCRYPTION_ACTIVE_KEY?.trim();
  if (!activeKeyId) return;

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(activeKeyId)) {
    throw new Error('SECRET_ENCRYPTION_ACTIVE_KEY inválido');
  }

  let keys: Record<string, unknown>;
  try {
    keys = JSON.parse(process.env.SECRET_ENCRYPTION_KEYS ?? '') as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error('SECRET_ENCRYPTION_KEYS deve ser um JSON de id para chave');
  }

  for (const [id, value] of Object.entries(keys ?? {})) {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
      throw new Error(`SECRET_ENCRYPTION_KEYS["${id}"] inválido`);
    }
  }

  if (!Object.hasOwn(keys ?? {}, activeKeyId)) {
    throw new Error('SECRET_ENCRYPTION_KEYS não contém a chave ativa');
  }
}

function validateGithubAppConfig() {
  const privateKey =
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim() ||
    process.env.GITHUB_APP_PRIVATE_KEY?.trim();

  const provided = [
    process.env.GITHUB_APP_ID?.trim(),
    process.env.GITHUB_APP_SLUG?.trim(),
    process.env.GITHUB_APP_WEBHOOK_SECRET?.trim(),
    privateKey,
  ].filter(Boolean);

  if (provided.length === 0) return;

  if (provided.length < 4) {
    throw new Error(
      'Configuração da GitHub App incompleta: defina GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_WEBHOOK_SECRET e a chave privada, ou nenhum deles',
    );
  }

  if ((process.env.GITHUB_APP_WEBHOOK_SECRET?.trim().length ?? 0) < 32) {
    throw new Error('GITHUB_APP_WEBHOOK_SECRET inválido');
  }
}

function validateTransportSecurity() {
  if (allowsPlaintextDependencies()) return;

  if (process.env.DB_SSL !== 'true') {
    throw new Error(
      'DB_SSL=true obrigatório em produção. Em self-host com Postgres em rede privada, defina ALLOW_INSECURE_DEPENDENCIES=true de forma explícita',
    );
  }

  if (!process.env.REDIS_URL?.trim().startsWith('rediss://')) {
    throw new Error(
      'REDIS_URL deve usar rediss:// em produção. Em self-host com Redis em rede privada, defina ALLOW_INSECURE_DEPENDENCIES=true de forma explícita',
    );
  }

  if (!process.env.AI_API_URL?.trim().startsWith('https://')) {
    throw new Error(
      'AI_API_URL deve usar https em produção. Em self-host com ai-api em rede privada, defina ALLOW_INSECURE_DEPENDENCIES=true de forma explícita',
    );
  }
}

export function validateProductionConfig() {
  requestLimits();
  sseLimits();
  sessionCookiePolicy();
  credentialsMode();
  validateEncryptionKeyRing();
  validateGithubAppConfig();

  if (!isProduction()) return;

  trustProxyHops();

  for (const name of [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'AI_SERVICE_TOKEN',
    'CHAT_GRANT_SECRET',
  ]) {
    if ((process.env[name]?.length ?? 0) < 32)
      throw new Error(`${name} inválido`);
  }

  const secrets = [
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_REFRESH_SECRET,
    process.env.AI_SERVICE_TOKEN,
    process.env.CHAT_GRANT_SECRET,
  ];
  if (new Set(secrets).size !== secrets.length)
    throw new Error('JWT, service and chat grant secrets must be independent');

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
    'REDIS_URL',
  ]) {
    if (!process.env[name]) throw new Error(`${name} obrigatório`);
  }

  validateTransportSecurity();
  validateMigrationDatabaseIdentity();
}
