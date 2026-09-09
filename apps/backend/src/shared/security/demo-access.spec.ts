import { demoLoginEnabled, demoSessionTtlMinutes } from './demo-access';

describe('demo access configuration', () => {
  const environment = { ...process.env };

  afterEach(() => {
    process.env = { ...environment };
  });

  it('is disabled unless explicitly turned on', () => {
    delete process.env.DEMO_LOGIN;
    expect(demoLoginEnabled()).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes', 'on'])(
    'accepts %p as enabled',
    (value) => {
      process.env.DEMO_LOGIN = value;
      expect(demoLoginEnabled()).toBe(true);
    },
  );

  it.each(['false', 'maybe', '0', 'enabled', ''])(
    'treats %p as disabled',
    (value) => {
      process.env.DEMO_LOGIN = value;
      expect(demoLoginEnabled()).toBe(false);
    },
  );

  it('defaults the session to two hours', () => {
    delete process.env.DEMO_SESSION_TTL_MINUTES;
    expect(demoSessionTtlMinutes()).toBe(120);
  });

  it('accepts an explicit ttl', () => {
    process.env.DEMO_SESSION_TTL_MINUTES = '30';
    expect(demoSessionTtlMinutes()).toBe(30);
  });

  it.each(['0', '-1', '1441', '1.5', 'abc'])(
    'rejects the invalid ttl %p',
    (value) => {
      process.env.DEMO_SESSION_TTL_MINUTES = value;
      expect(() => demoSessionTtlMinutes()).toThrow(
        /DEMO_SESSION_TTL_MINUTES/,
      );
    },
  );

  it('caps the ttl at a day so a demo row cannot linger', () => {
    process.env.DEMO_SESSION_TTL_MINUTES = '1440';
    expect(demoSessionTtlMinutes()).toBe(1440);
  });
});
