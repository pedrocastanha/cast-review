import { UnauthorizedException } from '@nestjs/common';
import { ChatCatalogGrantService } from './chat-catalog-grant.service';

const currentUser = {
  id: 'user-1',
  username: 'pedrocastanha',
  email: 'pedro@example.com',
};

describe('ChatCatalogGrantService', () => {
  const previousSecret = process.env.SECRET_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = 'catalog-secret-with-enough-entropy';
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousSecret === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = previousSecret;
  });

  it('roundtrips an opaque short-lived user grant', () => {
    const service = new ChatCatalogGrantService();

    const grant = service.issue(currentUser, 'thread-1');
    const claims = service.verify(grant);

    expect(claims).toEqual({
      user: currentUser,
      threadId: 'thread-1',
      expiresAt: 1_300_000,
    });
    expect(grant).not.toContain('pedro@example.com');
  });

  it('rejects tampered and expired grants', () => {
    const service = new ChatCatalogGrantService();
    const grant = service.issue(currentUser, 'thread-1');

    expect(() => service.verify(`${grant}x`)).toThrow(UnauthorizedException);

    jest.spyOn(Date, 'now').mockReturnValue(1_300_001);
    expect(() => service.verify(grant)).toThrow(UnauthorizedException);
  });
});
