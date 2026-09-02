import { createInstallState, verifyInstallState } from './install-state';

const SECRET = 'state-secret';

describe('install state', () => {
  it('round-trips the user id that started the installation', () => {
    const state = createInstallState(SECRET, 'user-1');
    expect(verifyInstallState(SECRET, state)?.userId).toBe('user-1');
  });

  it('rejects a state signed with another secret', () => {
    expect(
      verifyInstallState(SECRET, createInstallState('outro', 'user-1')),
    ).toBeNull();
  });

  it('rejects a state whose payload was swapped', () => {
    const state = createInstallState(SECRET, 'user-1');
    const [, signature] = state.split('.');
    const forged = `${Buffer.from(
      JSON.stringify({ userId: 'user-2', exp: Date.now() + 60_000 }),
    ).toString('base64url')}.${signature}`;
    expect(verifyInstallState(SECRET, forged)).toBeNull();
  });

  it('rejects an expired state', () => {
    const state = createInstallState(
      SECRET,
      'user-1',
      Date.now() - 60 * 60 * 1000,
    );
    expect(verifyInstallState(SECRET, state)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyInstallState(SECRET, undefined)).toBeNull();
    expect(verifyInstallState(SECRET, 'sem-ponto')).toBeNull();
    expect(verifyInstallState('', 'a.b')).toBeNull();
  });
});
