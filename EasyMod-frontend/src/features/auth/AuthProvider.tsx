import { eventBus, EventTypes as EVENTS } from '../../app/lib/events';
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { User, Shop, SigninRequest, SignupRequest } from "@/api/types";
import { authService, AuthState } from "../../app/lib/auth";

interface AuthContextProps extends AuthState {
  signin: (credentials: SigninRequest) => Promise<void>;
  signup: (userData: SignupRequest) => Promise<void>;
  switchShop: (shopId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>(authService.getState());

  useEffect(() => {
    // Subscribe to authService state changes
    const unsubscribe = authService.subscribe(setState);

    // Initial sync
    authService.ensureInitialized().then(() => {
      setState(authService.getState());
    });

    // Handle 401s emitted by the HTTP client.
    // Rules:
    //  1. If the user just authenticated concurrently (page-load /me race), ignore the
    //     stale event — the interceptor fires this before signin() finishes.
    //  2. If already on /signin, do nothing — no reload, no loop.
    //  3. Otherwise redirect. Do NOT call authService.logout() here: POST /api/auth/logout
    //     requires authentication, so an unauthenticated call returns 401, which re-fires
    //     this event and creates an infinite logout loop. The full-page reload from
    //     window.location.href clears all in-memory state automatically.
    const PUBLIC_PATHS = ['/', '/signin', '/signup', '/pricing', '/privacy-policy', '/terms', '/forgot-password', '/reset-password'];
    const handleUnauthorized = () => {
      if (authService.getState().isAuthenticated) return;
      const path = window.location.pathname;
      if (PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))) return;
      window.location.href = '/signin';
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      unsubscribe();
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const signin = async (credentials: SigninRequest) => {
    await authService.signin(credentials);
  };

  const signup = async (userData: SignupRequest) => {
    await authService.signup(userData);
  };

  const switchShop = async (shopId: string) => {
    await authService.switchShop(shopId);
    eventBus.emit(EVENTS.SHOP_SWITCHED, { shopId });
  };

  const logout = async () => {
    await authService.logout();
  };

  return (
    <AuthContext.Provider value={{ ...state, signin, signup, switchShop, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
