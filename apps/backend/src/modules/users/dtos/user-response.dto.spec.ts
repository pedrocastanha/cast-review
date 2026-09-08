import type { User } from '../user.entity';
import { toUserResponse } from './user-response.dto';

const GITHUB_TOKEN = 'ghp_averysecretgithubtoken000000000000';
const OPENAI_KEY = 'sk-averysecretopenaikey000000000000';

function loadedUser(): User {
  return {
    id: 'user-1',
    name: 'Cast',
    email: 'user@cast.test',
    username: 'cast',
    active: true,
    password: '$2b$12$hashedpasswordvalue',
    currentRefreshToken: 'f'.repeat(64),
    githubToken: GITHUB_TOKEN,
    githubTokenLastFour: '0000',
    githubLogin: 'cast-user',
    openaiKey: OPENAI_KEY,
    openaiKeyLastFour: '0000',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    deletedAt: null,
  } as unknown as User;
}

describe('user response allowlist', () => {
  it('exposes only the declared fields', () => {
    expect(Object.keys(toUserResponse(loadedUser())).sort()).toEqual(
      [
        'active',
        'createdAt',
        'email',
        'githubConnected',
        'githubLogin',
        'githubTokenLastFour',
        'id',
        'name',
        'openaiConnected',
        'openaiKeyLastFour',
        'updatedAt',
        'username',
      ].sort(),
    );
  });

  it.each([
    ['github token', GITHUB_TOKEN],
    ['openai key', OPENAI_KEY],
    ['password hash', '$2b$12$hashedpasswordvalue'],
    ['refresh hash', 'f'.repeat(64)],
  ])('never leaks the %s', (_label, secret) => {
    const serialized = JSON.stringify(toUserResponse(loadedUser()));
    expect(serialized).not.toContain(secret);
  });

  it('reveals only the last four characters of each credential', () => {
    const response = toUserResponse(loadedUser());

    expect(response.githubTokenLastFour).toBe('0000');
    expect(response.openaiKeyLastFour).toBe('0000');
    expect(response.githubConnected).toBe(true);
    expect(response.openaiConnected).toBe(true);
  });

  it('reports a disconnected account without inventing values', () => {
    const response = toUserResponse({
      ...loadedUser(),
      githubLogin: null,
      githubTokenLastFour: null,
      openaiKeyLastFour: null,
    } as unknown as User);

    expect(response.githubConnected).toBe(false);
    expect(response.openaiConnected).toBe(false);
    expect(response.githubTokenLastFour).toBeNull();
    expect(response.openaiKeyLastFour).toBeNull();
  });
});
