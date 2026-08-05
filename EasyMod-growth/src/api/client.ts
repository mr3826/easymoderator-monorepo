export type GrowthRole =
  | 'FOUNDER'
  | 'GROWTH_MANAGER'
  | 'BUSINESS_EXECUTIVE'
  | 'MARKETER'
  | 'CUSTOMER_SUCCESS'
  | 'READ_ONLY_ANALYST';

export interface GrowthSession {
  internalUserId: string;
  displayName: string;
  role: GrowthRole;
  permissions: string[];
}

export interface SigninPayload {
  email: string;
  password: string;
}

export interface SigninResult {
  requires2fa?: boolean;
  tempToken?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
const REQUEST_TIMEOUT_MS = 10000;
let csrfToken: string | null = null;

async function initCsrfToken(): Promise<void> {
  if (csrfToken) return;
  const response = await fetch(`${apiBaseUrl}/api/csrf`, {
    credentials: 'include',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.csrfToken !== 'string') {
    throw new ApiError('Unable to initialize secure session.', response.status || 503);
  }
  csrfToken = payload.csrfToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const isAuthMutation = path.startsWith('/api/auth/');
  if (isMutation && !isAuthMutation) await initCsrfToken();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken && isMutation && !isAuthMutation ? { 'X-CSRF-Token': csrfToken } : {}),
        ...options.headers,
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        payload?.message || payload?.error?.message || 'Request failed',
        response.status,
        payload?.code || payload?.error?.code,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request timed out. Please try again.', 408, 'REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const growthApi = {
  async getSession(): Promise<GrowthSession> {
    const payload = await request<{ success: true; data: GrowthSession }>('/api/internal/growth-os/session');
    return payload.data;
  },

  async signin(credentials: SigninPayload): Promise<SigninResult> {
    const payload = await request<{ data: SigninResult }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (!payload?.data?.requires2fa) {
      csrfToken = null;
      await initCsrfToken().catch(() => undefined);
    }
    return payload.data;
  },

  async verifyTwoFactor(tempToken: string, token: string): Promise<void> {
    await request('/api/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ tempToken, token }),
    });
    csrfToken = null;
    await initCsrfToken().catch(() => undefined);
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  },
};
