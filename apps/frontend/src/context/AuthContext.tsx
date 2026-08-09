import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '../api/auth.api';
import { ApiError } from '../api/http';
import { decodeAccessTokenSub, tokenStore } from '../api/token-store';
import { usersApi } from '../api/users.api';
import type { LoginPayload, RegisterPayload, User } from '../types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadUserFromToken(): Promise<User | null> {
  const accessToken = tokenStore.getAccess();
  if (!accessToken) return null;

  const userId = decodeAccessTokenSub(accessToken);
  if (!userId) return null;

  try {
    return await usersApi.getById(userId);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  const bootstrap = useCallback(async () => {
    const loadedUser = await loadUserFromToken();
    if (loadedUser) {
      setUser(loadedUser);
      setStatus('authenticated');
    } else {
      tokenStore.clear();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onForcedLogout = () => {
      setUser(null);
      setStatus('unauthenticated');
    };
    window.addEventListener('auth:logout', onForcedLogout);
    return () => window.removeEventListener('auth:logout', onForcedLogout);
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const tokens = await authApi.login(payload);
    tokenStore.set(tokens);
    const loadedUser = await loadUserFromToken();
    setUser(loadedUser);
    setStatus(loadedUser ? 'authenticated' : 'unauthenticated');
  }, []);

  const register = useCallback((payload: RegisterPayload) => authApi.register(payload), []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const refreshUser = useCallback(async () => {
    const loadedUser = await loadUserFromToken();
    if (loadedUser) setUser(loadedUser);
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout, refreshUser }),
    [status, user, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
