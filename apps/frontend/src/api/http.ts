import type { ApiErrorBody, AuthTokens } from '../types';
import { credentialHeaders } from './credential-store';
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

export function refreshTokens(): Promise<AuthTokens | null> {
  refreshPromise ??= performRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function performRefresh(): Promise<AuthTokens | null> {
  const generation = tokenStore.generation();
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Cast-CSRF': '1' },
    });
    if (!res.ok) return null;

    const tokens = (await res.json()) as AuthTokens;
    if (generation !== tokenStore.generation()) return null;
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Cast-CSRF': '1',
      ...(auth ? credentialHeaders() : {}),
    };
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  };

  const doFetch = (accessToken: string | null) =>
    fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: buildHeaders(accessToken),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(tokenStore.getAccess());

  if (res.status === 401 && auth) {
    const refreshed = await refreshTokens();

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

/** Fetch autenticado sem parsear o body — usado no SSE da análise. */
export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const buildHeaders = (accessToken: string | null): Headers => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(credentialHeaders())) {
      if (!headers.has(name)) headers.set(name, value);
    }
    if (accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return headers;
  };

  const doFetch = (accessToken: string | null) =>
    fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(accessToken) });

  let res = await doFetch(tokenStore.getAccess());

  if (res.status === 401) {
    const refreshed = await refreshTokens();

    if (!refreshed) {
      tokenStore.clear();
      window.dispatchEvent(new Event('auth:logout'));
      throw await toApiError(res);
    }

    res = await doFetch(refreshed.accessToken);
  }

  if (!res.ok) throw await toApiError(res);
  return res;
}
