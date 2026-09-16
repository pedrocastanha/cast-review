import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ServiceTokenGuard } from './service-token.guard';

function fakeContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ServiceTokenGuard', () => {
  const original = process.env.AI_SERVICE_TOKEN;
  const guard = new ServiceTokenGuard();

  beforeEach(() => {
    process.env.AI_SERVICE_TOKEN = 'a'.repeat(48);
  });

  afterEach(() => {
    process.env.AI_SERVICE_TOKEN = original;
  });

  it('denies when the Authorization header is missing', () => {
    expect(() => guard.canActivate(fakeContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('denies a same-length token with different bytes', () => {
    const wrongToken = 'b'.repeat(48);

    expect(() =>
      guard.canActivate(fakeContext(`Bearer ${wrongToken}`)),
    ).toThrow(UnauthorizedException);
  });

  it('denies a wrong-length token without crashing on timingSafeEqual', () => {
    expect(() => guard.canActivate(fakeContext('Bearer too-short'))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows a token that matches AI_SERVICE_TOKEN', () => {
    const token = process.env.AI_SERVICE_TOKEN as string;

    expect(guard.canActivate(fakeContext(`Bearer ${token}`))).toBe(true);
  });

  it('denies when AI_SERVICE_TOKEN is unset', () => {
    process.env.AI_SERVICE_TOKEN = '';

    expect(() => guard.canActivate(fakeContext('Bearer anything'))).toThrow(
      UnauthorizedException,
    );
  });
});
