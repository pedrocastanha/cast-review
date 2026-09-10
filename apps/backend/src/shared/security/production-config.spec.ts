import {
  allowsPlaintextDependencies,
  isProduction,
  requestLimits,
  sessionCookiePolicy,
  sseLimits,
  trustProxyHops,
  validateProductionConfig,
} from './production-config';

const VALID_HEX_KEY = 'a'.repeat(64);

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    TRUST_PROXY_HOPS: '1',
    JWT_ACCESS_SECRET: 'access'.padEnd(40, 'a'),
    JWT_REFRESH_SECRET: 'refresh'.padEnd(40, 'b'),
    AI_SERVICE_TOKEN: 'service'.padEnd(40, 'c'),
    CHAT_GRANT_SECRET: 'chat-grant'.padEnd(40, 'd'),
    SECRET_ENCRYPTION_KEY: VALID_HEX_KEY,
    DB_HOST: 'db.internal',
    DB_PORT: '5432',
    DB_USER: 'runtime',
    DB_PASSWORD: 'secret',
    DB_NAME: 'cast',
    DB_SSL: 'true',
    AI_API_URL: 'https://ai.internal',
    FRONTEND_ORIGINS: 'https://cast.test',
    REDIS_URL: 'rediss://redis.internal:6379',
  };

  process.env = { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe('production configuration boundary', () => {
  const environment = { ...process.env };

  afterEach(() => {
    process.env = { ...environment };
  });

  describe('trust proxy', () => {
    it('refuses to boot in production without an explicit hop count', () => {
      productionEnv({ TRUST_PROXY_HOPS: undefined });
      expect(() => trustProxyHops()).toThrow(/TRUST_PROXY_HOPS/);
      expect(() => validateProductionConfig()).toThrow(/TRUST_PROXY_HOPS/);
    });

    it('defaults to trusting nothing outside production', () => {
      process.env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
      expect(trustProxyHops()).toBe(0);
    });

    it('accepts zero hops for a directly exposed deployment', () => {
      productionEnv({ TRUST_PROXY_HOPS: '0' });
      expect(trustProxyHops()).toBe(0);
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it.each(['-1', '1.5', 'true', '11', ''])(
      'rejects the invalid hop count %p',
      (value) => {
        productionEnv({ TRUST_PROXY_HOPS: value });
        expect(() => trustProxyHops()).toThrow();
      },
    );
  });

  describe('dependency transport security', () => {
    it('accepts a fully hardened production environment', () => {
      productionEnv();
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it('rejects Postgres without TLS', () => {
      productionEnv({ DB_SSL: undefined });
      expect(() => validateProductionConfig()).toThrow(/DB_SSL/);
    });

    it.each(['false', 'TRUE', '1', 'yes'])(
      'only treats the exact string "true" as TLS enabled (%p)',
      (value) => {
        productionEnv({ DB_SSL: value });
        expect(() => validateProductionConfig()).toThrow(/DB_SSL/);
      },
    );

    it('rejects Redis over plaintext', () => {
      productionEnv({ REDIS_URL: 'redis://redis.internal:6379' });
      expect(() => validateProductionConfig()).toThrow(/REDIS_URL/);
    });

    it('rejects ai-api over plaintext', () => {
      productionEnv({ AI_API_URL: 'http://ai.internal' });
      expect(() => validateProductionConfig()).toThrow(/AI_API_URL/);
    });

    it('lets a self-hosted deployment opt out explicitly', () => {
      productionEnv({
        DB_SSL: undefined,
        REDIS_URL: 'redis://redis.internal:6379',
        AI_API_URL: 'http://ai.internal',
        ALLOW_INSECURE_DEPENDENCIES: 'true',
      });
      expect(allowsPlaintextDependencies()).toBe(true);
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it('does not treat an arbitrary value as an opt out', () => {
      productionEnv({
        DB_SSL: undefined,
        ALLOW_INSECURE_DEPENDENCIES: 'maybe',
      });
      expect(allowsPlaintextDependencies()).toBe(false);
      expect(() => validateProductionConfig()).toThrow(/DB_SSL/);
    });

    it('still requires the dependency URLs when plaintext is allowed', () => {
      productionEnv({
        REDIS_URL: undefined,
        ALLOW_INSECURE_DEPENDENCIES: 'true',
      });
      expect(() => validateProductionConfig()).toThrow(/REDIS_URL/);
    });
  });

  describe('database identities and internal grants', () => {
    it('requires an independent chat grant secret in production', () => {
      productionEnv({ CHAT_GRANT_SECRET: undefined });
      expect(() => validateProductionConfig()).toThrow(/CHAT_GRANT_SECRET/);
    });

    it('rejects a migration URL that uses the runtime role', () => {
      productionEnv({
        MIGRATION_DATABASE_URL:
          'postgres://runtime:secret@db.internal:5432/cast',
      });
      expect(() => validateProductionConfig()).toThrow(/mesma role/);
    });

    it('accepts a migration URL with a separate role', () => {
      productionEnv({
        MIGRATION_DATABASE_URL:
          'postgres://migrator:secret@db.internal:5432/cast',
      });
      expect(() => validateProductionConfig()).not.toThrow();
    });
  });

  describe('secrets', () => {
    it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'AI_SERVICE_TOKEN'])(
      'rejects a short %s',
      (name) => {
        productionEnv({ [name]: 'too-short' });
        expect(() => validateProductionConfig()).toThrow(name);
      },
    );

    it('rejects reusing the same value across secrets', () => {
      const shared = 'shared'.padEnd(40, 'x');
      productionEnv({
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      });
      expect(() => validateProductionConfig()).toThrow(/independent/);
    });

    it('rejects reusing the access secret as the service token', () => {
      const shared = 'shared'.padEnd(40, 'y');
      productionEnv({
        JWT_ACCESS_SECRET: shared,
        AI_SERVICE_TOKEN: shared,
      });
      expect(() => validateProductionConfig()).toThrow(/independent/);
    });

    it.each(['', 'not-hex', 'a'.repeat(63), 'a'.repeat(65)])(
      'rejects the encryption key %p',
      (value) => {
        productionEnv({ SECRET_ENCRYPTION_KEY: value });
        expect(() => validateProductionConfig()).toThrow(
          /SECRET_ENCRYPTION_KEY/,
        );
      },
    );
  });

  describe('encryption key ring', () => {
    it('accepts an active key present in the ring', () => {
      productionEnv({
        SECRET_ENCRYPTION_ACTIVE_KEY: 'k2',
        SECRET_ENCRYPTION_KEYS: JSON.stringify({
          k1: VALID_HEX_KEY,
          k2: 'b'.repeat(64),
        }),
      });
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it('rejects an active key absent from the ring', () => {
      productionEnv({
        SECRET_ENCRYPTION_ACTIVE_KEY: 'k9',
        SECRET_ENCRYPTION_KEYS: JSON.stringify({ k1: VALID_HEX_KEY }),
      });
      expect(() => validateProductionConfig()).toThrow(/chave ativa/);
    });

    it('rejects a malformed key inside the ring', () => {
      productionEnv({
        SECRET_ENCRYPTION_ACTIVE_KEY: 'k1',
        SECRET_ENCRYPTION_KEYS: JSON.stringify({ k1: 'short' }),
      });
      expect(() => validateProductionConfig()).toThrow(
        /SECRET_ENCRYPTION_KEYS/,
      );
    });

    it('rejects a ring that is not valid JSON', () => {
      productionEnv({
        SECRET_ENCRYPTION_ACTIVE_KEY: 'k1',
        SECRET_ENCRYPTION_KEYS: '{oops',
      });
      expect(() => validateProductionConfig()).toThrow(
        /SECRET_ENCRYPTION_KEYS/,
      );
    });

    it('rejects an active key id with unsafe characters', () => {
      productionEnv({
        SECRET_ENCRYPTION_ACTIVE_KEY: 'k1"; DROP',
        SECRET_ENCRYPTION_KEYS: JSON.stringify({ k1: VALID_HEX_KEY }),
      });
      expect(() => validateProductionConfig()).toThrow(
        /SECRET_ENCRYPTION_ACTIVE_KEY/,
      );
    });

    it('validates the key ring outside production too', () => {
      process.env = {
        NODE_ENV: 'test',
        SECRET_ENCRYPTION_ACTIVE_KEY: 'k1',
        SECRET_ENCRYPTION_KEYS: '{oops',
      } as NodeJS.ProcessEnv;
      expect(() => validateProductionConfig()).toThrow(
        /SECRET_ENCRYPTION_KEYS/,
      );
    });
  });

  describe('github app configuration', () => {
    const complete = {
      GITHUB_APP_ID: '1',
      GITHUB_APP_SLUG: 'cast',
      GITHUB_APP_WEBHOOK_SECRET: 'w'.repeat(32),
      GITHUB_APP_PRIVATE_KEY: 'private-key',
    };

    it('accepts a fully absent configuration', () => {
      productionEnv();
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it('accepts a complete configuration', () => {
      productionEnv(complete);
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it.each(Object.keys(complete))(
      'rejects a configuration missing %s',
      (missing) => {
        productionEnv({ ...complete, [missing]: undefined });
        expect(() => validateProductionConfig()).toThrow(/GitHub App/);
      },
    );

    it('accepts the base64 private key variant', () => {
      productionEnv({
        ...complete,
        GITHUB_APP_PRIVATE_KEY: undefined,
        GITHUB_APP_PRIVATE_KEY_BASE64: 'cHJpdmF0ZQ==',
      });
      expect(() => validateProductionConfig()).not.toThrow();
    });

    it('rejects a weak webhook secret', () => {
      productionEnv({ ...complete, GITHUB_APP_WEBHOOK_SECRET: 'short' });
      expect(() => validateProductionConfig()).toThrow(
        /GITHUB_APP_WEBHOOK_SECRET/,
      );
    });
  });

  describe('request and stream limits', () => {
    it('provides conservative defaults', () => {
      process.env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
      const limits = requestLimits();
      expect(limits.jsonBody).toBe('512kb');
      expect(limits.headersTimeoutMs).toBeGreaterThan(
        limits.keepAliveTimeoutMs,
      );
      expect(limits.requestTimeoutMs).toBeGreaterThan(limits.headersTimeoutMs);
      expect(sseLimits().maxPerUser).toBe(3);
    });

    it.each(['0', '-1', 'abc', '1.5'])(
      'rejects the invalid numeric limit %p',
      (value) => {
        process.env = {
          NODE_ENV: 'test',
          SSE_MAX_STREAMS_PER_USER: value,
        } as NodeJS.ProcessEnv;
        expect(() => sseLimits()).toThrow(/SSE_MAX_STREAMS_PER_USER/);
      },
    );

    it.each(['512', '1gb', 'big', '5 mb'])(
      'rejects the invalid body size %p',
      (value) => {
        process.env = {
          NODE_ENV: 'test',
          BODY_LIMIT_JSON: value,
        } as NodeJS.ProcessEnv;
        expect(() => requestLimits()).toThrow(/BODY_LIMIT_JSON/);
      },
    );

    it('keeps the webhook budget separate from the general body budget', () => {
      process.env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
      const limits = requestLimits();
      expect(limits.webhookBody).not.toBe(limits.jsonBody);
    });
  });

  describe('session cookie policy', () => {
    it('defaults to strict', () => {
      process.env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
      expect(sessionCookiePolicy()).toBe('strict');
    });

    it('accepts lax for a cross-subdomain deployment', () => {
      process.env = {
        NODE_ENV: 'test',
        SESSION_COOKIE_SAMESITE: 'Lax',
      } as NodeJS.ProcessEnv;
      expect(sessionCookiePolicy()).toBe('lax');
    });

    it('refuses SameSite=None where cookies are not Secure', () => {
      process.env = {
        NODE_ENV: 'test',
        SESSION_COOKIE_SAMESITE: 'none',
      } as NodeJS.ProcessEnv;
      expect(() => sessionCookiePolicy()).toThrow(/Secure/);
    });

    it('allows SameSite=None in production', () => {
      productionEnv({ SESSION_COOKIE_SAMESITE: 'none' });
      expect(sessionCookiePolicy()).toBe('none');
      expect(isProduction()).toBe(true);
    });

    it('rejects an unknown policy', () => {
      process.env = {
        NODE_ENV: 'test',
        SESSION_COOKIE_SAMESITE: 'whatever',
      } as NodeJS.ProcessEnv;
      expect(() => sessionCookiePolicy()).toThrow(/SESSION_COOKIE_SAMESITE/);
    });
  });

  describe('required production variables', () => {
    it.each([
      'DB_HOST',
      'DB_PORT',
      'DB_USER',
      'DB_PASSWORD',
      'DB_NAME',
      'AI_API_URL',
      'FRONTEND_ORIGINS',
      'REDIS_URL',
    ])('rejects a production boot without %s', (name) => {
      productionEnv({ [name]: undefined });
      expect(() => validateProductionConfig()).toThrow(name);
    });

    it('does not enforce production variables outside production', () => {
      process.env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
      expect(() => validateProductionConfig()).not.toThrow();
    });
  });
});
