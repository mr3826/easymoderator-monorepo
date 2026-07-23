import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, growthApi, type GrowthSession, type SigninPayload } from '@/api/client';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'access-denied' | 'session-expired' | 'error';

interface GrowthAuthState {
  status: AuthStatus;
  session: GrowthSession | null;
  error: string | null;
  refreshSession: () => Promise<void>;
  signin: (payload: SigninPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const GrowthAuthContext = createContext<GrowthAuthState | undefined>(undefined);

export function GrowthAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<GrowthSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const hadSession = Boolean(session);
    setStatus('loading');
    setError(null);

    try {
      const nextSession = await growthApi.getSession();
      setSession(nextSession);
      setStatus('authenticated');
    } catch (err) {
      setSession(null);
      if (err instanceof ApiError && err.status === 401) {
        setStatus(hadSession ? 'session-expired' : 'unauthenticated');
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setStatus('access-denied');
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to load Growth OS.');
      setStatus('error');
    }
  }, [session]);

  useEffect(() => {
    void refreshSession();
  }, []);

  const signin = useCallback(async (payload: SigninPayload) => {
    setStatus('loading');
    setError(null);
    try {
      await growthApi.signin(payload);
      const nextSession = await growthApi.getSession();
      setSession(nextSession);
      setStatus('authenticated');
    } catch (err) {
      setSession(null);
      if (err instanceof ApiError && err.status === 403) {
        setStatus('access-denied');
        return;
      }
      setStatus('unauthenticated');
      setError(err instanceof Error ? err.message : 'Sign in failed.');
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await growthApi.logout();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(() => ({
    status,
    session,
    error,
    refreshSession,
    signin,
    logout,
  }), [status, session, error, refreshSession, signin, logout]);

  return (
    <GrowthAuthContext.Provider value={value}>
      {children}
    </GrowthAuthContext.Provider>
  );
}

export function useGrowthAuth() {
  const context = useContext(GrowthAuthContext);
  if (!context) {
    throw new Error('useGrowthAuth must be used within GrowthAuthProvider');
  }
  return context;
}
