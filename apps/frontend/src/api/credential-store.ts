export const GITHUB_TOKEN_HEADER = 'X-Cast-Github-Token';
export const OPENAI_KEY_HEADER = 'X-Cast-Openai-Key';

export interface SessionCredentials {
  githubToken: string | null;
  openaiKey: string | null;
}

let credentials: SessionCredentials = { githubToken: null, openaiKey: null };

const listeners = new Set<(value: SessionCredentials) => void>();

function emit() {
  for (const listener of listeners) listener({ ...credentials });
}

export const credentialStore = {
  get: (): SessionCredentials => ({ ...credentials }),

  setGithubToken: (value: string | null) => {
    credentials = { ...credentials, githubToken: value?.trim() || null };
    emit();
  },

  setOpenaiKey: (value: string | null) => {
    credentials = { ...credentials, openaiKey: value?.trim() || null };
    emit();
  },

  clear: () => {
    credentials = { githubToken: null, openaiKey: null };
    emit();
  },

  subscribe: (listener: (value: SessionCredentials) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function credentialHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (credentials.githubToken) headers[GITHUB_TOKEN_HEADER] = credentials.githubToken;
  if (credentials.openaiKey) headers[OPENAI_KEY_HEADER] = credentials.openaiKey;
  return headers;
}

export function lastFour(value: string | null): string | null {
  return value ? value.slice(-4) : null;
}
