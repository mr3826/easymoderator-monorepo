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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
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
}

export const growthApi = {
  async getSession(): Promise<GrowthSession> {
    const payload = await request<{ success: true; data: GrowthSession }>('/api/internal/growth-os/session');
    return payload.data;
  },

  async signin(credentials: SigninPayload): Promise<void> {
    await request('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  },
};
