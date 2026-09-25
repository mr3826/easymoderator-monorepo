import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

import { getAccessToken, subscribeAccessToken } from './token-store';
import { getRefreshToken, getSessionIdentity } from './secure-store';
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
import { purgePersistedQueries, startQueryPersistence } from '@/lib/queryPersistence';

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

/**
 * Decides what a missing access token means. With the stored session still present (refresh token
 * plus its identity), the server was merely unreachable: keep that user in a read-only offline
 * session so their persisted Home stays visible (ADR M-011). Otherwise the session is gone.
 */
async function readStoredSession(): Promise<AuthUser | null> {
  const [refreshToken, identity] = await Promise.all([getRefreshToken(), getSessionIdentity()]);
  return refreshToken && identity ? identity : null;
}

function endSessionLocally(): void {
  queryClient.clear();
  void purgePersistedQueries();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  // True while the only proof of a session is the stored one (no access token: offline, or the
  // server unreachable). Screens stay read-only and nothing is sent until a refresh succeeds.
  const [offlineSession, setOfflineSession] = useState(false);
  // While the stored session is being checked after a token loss, stay signed in: flashing the
  // signed-out state would clear the cache and tear down the protected navigator for nothing.
  const [sessionCheckPending, setSessionCheckPending] = useState(false);
  // Bumped by every explicit transition so a slower stored-session check cannot resurrect a
  // session that logout/cancel has since ended.
  const sessionCheckEpoch = useRef(0);

  useEffect(
    () =>
      subscribeAccessToken(() => {
        const nextToken = getAccessToken();
        setToken(nextToken);
        if (nextToken) {
          sessionCheckEpoch.current += 1;
          setSessionCheckPending(false);
          setOfflineSession(false);
          return;
        }
        const epoch = ++sessionCheckEpoch.current;
        setSessionCheckPending(true);
        void readStoredSession().then((stored) => {
          if (epoch !== sessionCheckEpoch.current || getAccessToken()) return;
          setSessionCheckPending(false);
          if (stored) {
            setUser(stored);
            setOfflineSession(true);
            return;
          }
          setOfflineSession(false);
          setUser(null);
          endSessionLocally();
        });
      }),
    [],
  );

  // On cold start, a refresh token may already exist in SecureStore from a previous session.
  // Attempt one silent refresh before deciding whether to show the login screen, so the merchant
  // isn't bounced to login on every app relaunch; the refresh response restores `user` too. When
  // the refresh fails only because the server is unreachable, the stored session opens the app in
  // offline mode instead of the login screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingRefreshToken = await getRefreshToken();
      if (existingRefreshToken) {
        const refreshed = await refreshAccessToken();
        if (!cancelled && refreshed) {
          setUser(refreshed.user);
        } else if (!cancelled && !getAccessToken()) {
          const stored = await readStoredSession();
          if (!cancelled && stored) {
            setUser(stored);
            setOfflineSession(true);
          }
        }
      } else {
        // No session on the device: anything persisted belongs to a session that ended without
        // reaching its purge (e.g. the app was killed mid-logout).
        void purgePersistedQueries();
      }
      if (!cancelled) setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const status: AuthStatus = !bootstrapped
    ? 'loading'
    : token || offlineSession || sessionCheckPending
      ? 'signedIn'
      : 'signedOut';

  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status]);

  // Offline session: retry the refresh as soon as the device reports connectivity. Success installs
  // a token (ending offline mode); a server rejection clears the stored session, and the token
  // listener then signs out and purges.
  useEffect(() => {
    if (!offlineSession) return undefined;
    return NetInfo.addEventListener((state) => {
      if (state.isConnected === false || state.isInternetReachable === false) return;
      void refreshAccessToken().then((refreshed) => {
        if (refreshed) setUser(refreshed.user);
      });
    });
  }, [offlineSession]);

  // ADR M-011 persistence for the signed-in user's current shop.
  const persistUserId = status === 'signedIn' ? user?.id : undefined;
  const persistShopId = status === 'signedIn' ? user?.shopId : undefined;
  useEffect(() => {
    if (!persistUserId || !persistShopId) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void startQueryPersistence(queryClient, persistUserId, persistShopId).then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [persistUserId, persistShopId]);

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
    sessionCheckEpoch.current += 1;
    if (!(await cancelTwoFactorRequest())) return;
    setSessionCheckPending(false);
    setOfflineSession(false);
    setUser(null);
    endSessionLocally();
  }, []);

  const doLogout = useCallback(async () => {
    sessionCheckEpoch.current += 1;
    if (!(await logoutRequest())) return;
    setSessionCheckPending(false);
    setOfflineSession(false);
    setUser(null);
    // Clear per-shop server data, in memory and on disk, before a later sign-in can render it.
    // Query keys include shopId as defense in depth, but logout must discard the ended session.
    endSessionLocally();
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
