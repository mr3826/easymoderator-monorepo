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
    // The interceptor already attempted token refresh before emitting this event,
    // so refreshToken() must NOT be called again here — doing so doubles the 429 hit
    // and causes a reload loop when the user is already on /signin.
    const handleUnauthorized = async () => {
      try {
        await authService.logout();
      } catch (_) {
        // Session already invalid — ignore logout API errors
      }
      if (window.location.pathname !== '/signin') {
        window.location.href = '/signin';
      }
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
