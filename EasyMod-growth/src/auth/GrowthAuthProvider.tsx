import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, growthApi, type GrowthSession, type SigninPayload } from '@/api/client';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'two-factor' | 'access-denied' | 'session-expired' | 'unavailable' | 'error';

interface GrowthAuthState {
  status: AuthStatus;
  session: GrowthSession | null;
  error: string | null;
  twoFactorRequired: boolean;
  refreshSession: () => Promise<void>;
  signin: (payload: SigninPayload) => Promise<void>;
  verifyTwoFactor: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  reportApiError: (error: unknown) => boolean;
}

const GrowthAuthContext = createContext<GrowthAuthState | undefined>(undefined);

export function GrowthAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<GrowthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tempToken, setTempToken] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const hadSession = Boolean(session);
    setStatus('loading');
    setError(null);

    try {
      let nextSession: GrowthSession;
      try {
        nextSession = await growthApi.getSession();
      } catch (err) {
        // A valid refresh cookie can recover an expired access cookie. Retry
        // exactly once so a stale session never becomes a frontend-only
        // authorization decision.
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        await growthApi.refresh();
        nextSession = await growthApi.getSession();
      }
      setSession(nextSession);
      setStatus('authenticated');
    } catch (err) {
      setSession(null);
      setTempToken(null);
      if (err instanceof ApiError && err.status === 401) {
        setStatus(hadSession ? 'session-expired' : 'unauthenticated');
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setStatus('access-denied');
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        setStatus('unavailable');
        setError(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to load Growth OS.');
      setStatus('error');
    }
  }, [session]);

  const reportApiError = useCallback((requestError: unknown) => {
    if (!(requestError instanceof ApiError)) return false;
    if (requestError.status === 401) {
      void refreshSession();
      return true;
    }
    if (requestError.status === 403) {
      setStatus('access-denied');
      return true;
    }
    if (requestError.status === 503) {
      setError(requestError.message);
      setStatus('unavailable');
      return true;
    }
    return false;
  }, [refreshSession]);

  useEffect(() => {
    void refreshSession();
  }, []);

  const signin = useCallback(async (payload: SigninPayload) => {
    setStatus('loading');
    setError(null);
    try {
      const signinResult = await growthApi.signin(payload);
      if (signinResult.requires2fa && signinResult.tempToken) {
        setTempToken(signinResult.tempToken);
        setStatus('two-factor');
        return;
      }
      const nextSession = await growthApi.getSession();
      setSession(nextSession);
      setStatus('authenticated');
    } catch (err) {
      setSession(null);
      if (err instanceof ApiError && err.status === 403) {
        setStatus('access-denied');
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        setStatus('unavailable');
        setError(err.message);
        return;
      }
      setStatus('unauthenticated');
      setError(err instanceof Error ? err.message : 'Sign in failed.');
      throw err;
    }
  }, []);

  const verifyTwoFactor = useCallback(async (token: string) => {
    if (!tempToken) {
      setStatus('unauthenticated');
      setError('Your verification session expired. Sign in again.');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      await growthApi.verifyTwoFactor(tempToken, token);
      const nextSession = await growthApi.getSession();
      setTempToken(null);
      setSession(nextSession);
      setStatus('authenticated');
    } catch (err) {
      setStatus('two-factor');
      setError(err instanceof Error ? err.message : 'Verification failed.');
      throw err;
    }
  }, [tempToken]);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await growthApi.logout();
      setSession(null);
      setTempToken(null);
      setStatus('unauthenticated');
    } catch (err) {
      // Keep the authenticated state when server-side revocation fails. The
      // user sees the error and can retry instead of believing the cookie was
      // revoked when it was not.
      setError(err instanceof Error ? err.message : 'Unable to complete sign out. Please retry.');
      setStatus('authenticated');
    }
  }, []);

  const value = useMemo(() => ({
    status,
    session,
    error,
    twoFactorRequired: status === 'two-factor',
    refreshSession,
    signin,
    verifyTwoFactor,
    logout,
    reportApiError,
  }), [status, session, error, refreshSession, signin, verifyTwoFactor, logout, reportApiError]);

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
