import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ChatCatalogGrantService } from './chat-catalog-grant.service';

const currentUser = {
  id: 'user-1',
  username: 'pedrocastanha',
  email: 'pedro@example.com',
};

describe('ChatCatalogGrantService', () => {
  const previousSecret = process.env.CHAT_GRANT_SECRET;

  beforeEach(() => {
    process.env.CHAT_GRANT_SECRET = 'catalog-secret-with-enough-entropy';
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousSecret === undefined) delete process.env.CHAT_GRANT_SECRET;
    else process.env.CHAT_GRANT_SECRET = previousSecret;
  });

  it('roundtrips an opaque short-lived user grant', () => {
    const service = new ChatCatalogGrantService();

    const grant = service.issue(currentUser, 'thread-1');
    const claims = service.verify(grant);

    expect(claims).toEqual({
      userId: currentUser.id,
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

  it('does not accept a grant signed with the encryption key', () => {
    process.env.SECRET_ENCRYPTION_KEY = 'wrong-key';
    const service = new ChatCatalogGrantService();
    const grant = service.issue(currentUser, 'thread-1');

    process.env.CHAT_GRANT_SECRET = 'another-catalog-secret';
    expect(() => service.verify(grant)).toThrow(UnauthorizedException);
  });

  it('rejects malformed JSON claims without leaking a 500', () => {
    const service = new ChatCatalogGrantService();
    const malformed = Buffer.from('null').toString('base64url');
    const secret = process.env.CHAT_GRANT_SECRET;
    if (!secret) throw new Error('test secret missing');
    const signature = createHmac('sha256', secret)
      .update(malformed)
      .digest('base64url');
    const signedMalformed = `${malformed}.${signature}`;

    expect(() => service.verify(signedMalformed)).toThrow(
      UnauthorizedException,
    );
  });
});
