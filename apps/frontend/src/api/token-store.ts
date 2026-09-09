import type { AuthTokens } from '../types';
import { credentialStore } from './credential-store';

const ACCESS_KEY = 'cast_review.accessToken';
const REFRESH_KEY = 'cast_review.refreshToken';
let accessToken: string | null = null;
let generation = 0;
localStorage.removeItem(ACCESS_KEY);
localStorage.removeItem(REFRESH_KEY);

export const tokenStore = {
  generation: () => generation,
  getAccess: () => accessToken,
  set: (tokens: AuthTokens) => {
    generation += 1;
    accessToken = tokens.accessToken;
  },
  clear: () => {
    generation += 1;
    accessToken = null;
    credentialStore.clear();
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export function decodeAccessTokenSub(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}
