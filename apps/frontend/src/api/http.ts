import type { ApiErrorBody, AuthTokens } from '../types';
import { tokenStore } from './token-store';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const BASE_URL = '/api';

let refreshPromise: Promise<AuthTokens | null> | null = null;

async function refreshTokens(): Promise<AuthTokens | null> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    if (!res.ok) return null;

    const tokens = (await res.json()) as AuthTokens;
    tokenStore.set(tokens);
    return tokens;
  } catch {
    return null;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = `Erro ${res.status}`;
  try {
    const body = (await res.json()) as ApiErrorBody;
    message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? message);
  } catch {
    // corpo vazio ou não-JSON — mantém mensagem genérica
  }
  return new ApiError(res.status, message);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** false pra endpoints públicos (register/login) — não manda Authorization */
  auth?: boolean;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const buildHeaders = (accessToken: string | null): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  };

  const doFetch = (accessToken: string | null) =>
    fetch(`${BASE_URL}${path}`, {
      method,
      headers: buildHeaders(accessToken),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(tokenStore.getAccess());

  if (res.status === 401 && auth) {
    refreshPromise ??= refreshTokens().finally(() => {
      refreshPromise = null;
    });
    const refreshed = await refreshPromise;

    if (!refreshed) {
      tokenStore.clear();
      window.dispatchEvent(new Event('auth:logout'));
      throw await toApiError(res);
    }

    res = await doFetch(refreshed.accessToken);
  }

  if (!res.ok) throw await toApiError(res);

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
