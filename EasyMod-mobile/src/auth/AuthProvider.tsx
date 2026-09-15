import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getAccessToken, subscribeAccessToken } from './token-store';
import { getRefreshToken } from './secure-store';
import { signIn as signInRequest, logout as logoutRequest, refreshAccessToken, type AuthUser } from './auth-client';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export interface SignInOutcome {
  ok: boolean;
  message?: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => subscribeAccessToken(() => setToken(getAccessToken())), []);

  // On cold start, a refresh token may already exist in SecureStore from a previous session.
  // Attempt one silent refresh before deciding whether to show the login screen, so the merchant
  // isn't bounced to login on every app relaunch. The backend's refresh response now returns the
  // same user/shopId shape signin does (Phase 2 contract fix), so this restores `user` too —
  // previously this discarded the refresh result entirely, leaving `user: null` forever after
  // every relaunch even though `status` became `'signedIn'`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingRefreshToken = await getRefreshToken();
      if (existingRefreshToken) {
        const refreshed = await refreshAccessToken();
        if (!cancelled && refreshed) setUser(refreshed.user);
      }
      if (!cancelled) setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const status: AuthStatus = !bootstrapped ? 'loading' : token ? 'signedIn' : 'signedOut';

  const doSignIn = useCallback(async (email: string, password: string): Promise<SignInOutcome> => {
    const result = await signInRequest(email, password);
    if (result.ok) {
      setUser(result.data);
      return { ok: true };
    }
    return { ok: false, message: result.error.message };
  }, []);

  const doLogout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn: doSignIn, logout: doLogout }),
    [status, user, doSignIn, doLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
