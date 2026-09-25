import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getAccessToken, subscribeAccessToken } from './token-store';
import { getRefreshToken } from './secure-store';
import {
  signIn as signInRequest,
  verifyTwoFactor as verifyTwoFactorRequest,
  cancelTwoFactor as cancelTwoFactorRequest,
  logout as logoutRequest,
  refreshAccessToken,
  type AuthUser,
} from './auth-client';
import type { ErrorKind } from '@/api/errors';
import { queryClient } from '@/lib/queryClient';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export interface SignInOutcome {
  ok: boolean;
  message?: string;
  /** True when the backend accepted the password and returned a temporary MFA challenge. */
  requires2fa?: boolean;
  /** In-memory-only challenge credential required by the native verify endpoint. */
  tempToken?: string;
}

export interface VerifyTwoFactorOutcome {
  ok: boolean;
  message?: string;
  kind?: ErrorKind;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  verifyTwoFactor: (tempToken: string, token: string) => Promise<VerifyTwoFactorOutcome>;
  cancelTwoFactor: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(
    () =>
      subscribeAccessToken(() => {
        const nextToken = getAccessToken();
        setToken(nextToken);
        if (!nextToken) {
          setUser(null);
          queryClient.clear();
        }
      }),
    [],
  );

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

  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status]);

  const doSignIn = useCallback(async (email: string, password: string): Promise<SignInOutcome> => {
    const result = await signInRequest(email, password);
    if (result.ok) {
      if ('requires2fa' in result.data) {
        // Do not enter the signed-in state. The login UI keeps this temporary credential in memory
        // until the dedicated native verification request succeeds or the user cancels.
        return { ok: false, requires2fa: true, tempToken: result.data.tempToken };
      }
      queryClient.clear();
      setUser(result.data);
      return { ok: true };
    }
    return { ok: false, message: result.error.message };
  }, []);

  const doVerifyTwoFactor = useCallback(
    async (tempToken: string, token: string): Promise<VerifyTwoFactorOutcome> => {
      const result = await verifyTwoFactorRequest(tempToken, token);
      if (!result.ok) {
        return { ok: false, message: result.error.message, kind: result.error.kind };
      }
      queryClient.clear();
      setUser(result.data);
      return { ok: true };
    },
    [],
  );

  // Both transitions await network/SecureStore work. If a newer sign-in completes meanwhile, the
  // client reports this transition as superseded and the newer account's user and cache must stay.
  const doCancelTwoFactor = useCallback(async () => {
    if (!(await cancelTwoFactorRequest())) return;
    setUser(null);
    queryClient.clear();
  }, []);

  const doLogout = useCallback(async () => {
    if (!(await logoutRequest())) return;
    setUser(null);
    // Clear per-shop server data before a later sign-in can render it. Query keys include shopId as
    // defense in depth, but logout must also discard data from the shop no longer in session.
    queryClient.clear();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signIn: doSignIn,
      verifyTwoFactor: doVerifyTwoFactor,
      cancelTwoFactor: doCancelTwoFactor,
      logout: doLogout,
    }),
    [status, user, doSignIn, doVerifyTwoFactor, doCancelTwoFactor, doLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
