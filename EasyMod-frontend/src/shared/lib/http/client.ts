/**
 * Centralized HTTP Client with Interceptors
 * Single source of truth for all API communication
 * 
 * Features:
 * - Auth token injection (Bearer fallback)
 * - CSRF token protection for mutations
 * - Shop ID injection (for multi-tenant)
 * - Automatic token refresh with request queueing
 * - Automatic retry with exponential backoff
 * - Error normalization
 * 
 * Usage:
 * import { httpClient } from '@shared/lib/http/client';
 * const response = await httpClient.get('/api/endpoint');
 * 
 * Multi-tenant setup:
 * import { useShopId } from '@/shared/context/ShopContext';
 * import { useHttpShopId } from '@/shared/lib/http/useHttpShopId';
 * 
 * function App() {
 *   useHttpShopId(); // Syncs ShopContext with HTTP client
 *   return <Routes>...</Routes>;
 * }
 */

import axios, { AxiosInstance, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { normalizeApiError } from './errors';

// Extend axios config to track retry count, CSRF init, and shopId injection
export interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
  __retry?: boolean;
  __csrfInit?: boolean;
  __skipShopId?: boolean;
}

class HttpClient {
  private client: AxiosInstance;
  private csrfToken: string | null = null;
  private accessToken: string | null = null;
  private isRefreshing = false;
  private refreshQueue: Array<{
    resolve: (value: AxiosResponse) => void;
    reject: (reason: any) => void;
    config: ExtendedAxiosRequestConfig;
  }> = [];

  constructor() {
    this.client = axios.create({
      baseURL: (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_BASE_URL || '',
      timeout: 10000,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor - Add CSRF token for mutations, shop ID, auth header
    this.client.interceptors.request.use(
      async (config: ExtendedAxiosRequestConfig) => {
        const method = (config.method || 'get').toUpperCase();
        const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);

        // Initialize CSRF token for mutations if not already present
        if (isMutation && !this.csrfToken && !config.__csrfInit) {
          config.__csrfInit = true;
          await this.initCsrfToken();
        }

        // Inject CSRF token for mutations
        if (this.csrfToken && isMutation) {
          config.headers['X-CSRF-Token'] = this.csrfToken;
        }

        // Inject auth token (Bearer fallback)
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }

        // Inject shop ID for multi-tenant (if not explicitly skipped)
        const currentShopId = this.getShopId();
        if (currentShopId && !config.__skipShopId) {
          config.headers['X-Shop-ID'] = currentShopId;
        }

        // Track retry count for network errors
        config.__retryCount = config.__retryCount || 0;

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - Handle errors, token refresh, and retries
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as ExtendedAxiosRequestConfig;
        const status = error.response?.status;

        // Handle 401 with automatic token refresh (queue requests during refresh)
        if (status === 401 && !config.__retry) {
          config.__retry = true;

          try {
            const refreshedResponse = await this.handleRefreshQueue(config);
            return refreshedResponse;
          } catch (refreshError) {
            this.clearTokens();
            this.clearRefreshQueue();
            this.emitUnauthorized();
            return Promise.reject(refreshError);
          }
        }

        // Already retried but still 401 - clear tokens
        if (status === 401 && config.__retry) {
          this.clearTokens();
          this.clearRefreshQueue();
          this.emitUnauthorized();
        }

        // Handle CSRF token failure - clear it so it can be re-initialized
        if (status === 403) {
          const responseData = error.response?.data as { error?: { message?: string } } | undefined;
          if (responseData?.error?.message === 'invalid csrf token') {
            this.csrfToken = null;
            // Emit custom event for CSRF error handling
            if (typeof window !== 'undefined' && window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('csrf:invalid'));
            }
          }
        }

        // Retry transient failures (429 rate limit, 5xx server errors).
        // Never retry the refresh endpoint itself — a 429 there means the token is
        // locked out and retrying only burns more rate-limit budget before the redirect.
        const isRefreshEndpoint = config.url?.includes('/auth/refresh');
        if (!isRefreshEndpoint && (status === 429 || (status && status >= 500 && status < 600))) {
          const retryCount = config.__retryCount || 0;
          if (retryCount < 2) {
            config.__retryCount = retryCount + 1;
            const delay = status === 429
              ? 5000 * (retryCount + 1)       // 5s, 10s for rate limiting
              : 1000 * Math.pow(2, retryCount); // 1s, 2s for server errors
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.client(config);
          }
        }

        // Retry network errors with exponential backoff
        if (
          error.code === 'ECONNABORTED' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT'
        ) {
          const retryCount = config.__retryCount || 0;
          if (retryCount < 3) {
            config.__retryCount = retryCount + 1;
            const delay = 1000 * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.client(config);
          }
        }

        throw normalizeApiError(error);
      }
    );
  }

  private emitUnauthorized(): void {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.csrfToken = null;
  }

  private clearRefreshQueue(): void {
    this.refreshQueue.forEach(({ reject }) => {
      reject(new Error('Token refresh failed'));
    });
    this.refreshQueue = [];
    this.isRefreshing = false;
  }

  private async handleRefreshQueue(originalRequest: ExtendedAxiosRequestConfig): Promise<AxiosResponse> {
    return new Promise((resolve, reject) => {
      this.refreshQueue.push({ resolve, reject, config: originalRequest });

      if (!this.isRefreshing) {
        this.isRefreshing = true;
        this.performTokenRefresh();
      }
    });
  }

  private async performTokenRefresh(): Promise<void> {
    try {
      await this.refreshAuthToken();

      const queuedRequests = [...this.refreshQueue];
      this.refreshQueue = [];

      await Promise.all(
        queuedRequests.map(async ({ resolve, reject, config }) => {
          try {
            const response = await this.client(config);
            resolve(response);
          } catch (error) {
            reject(error);
          }
        })
      );
    } catch (error) {
      this.clearRefreshQueue();
    } finally {
      this.isRefreshing = false;
    }
  }

  // Public methods

  async get<T>(url: string, config?: any): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async patch<T>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.patch<T>(url, data, config);
  }

  async delete<T>(url: string, config?: any): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  async initCsrfToken(): Promise<void> {
    if (this.csrfToken) return;

    try {
      const response = await this.client.get('/api/csrf');
      this.csrfToken = response.data?.csrfToken || null;
      console.log('🔐 CSRF Token initialized:', this.csrfToken ? 'Success' : 'Failed');
    } catch (error) {
      console.error('❌ CSRF Token initialization failed:', error);
      // Clear token so it can be retried on next call
      this.csrfToken = null;
    }
  }

  async refreshAuthToken(): Promise<void> {
    await this.client.post('/api/auth/refresh', {});
    this.accessToken = null; // Tokens are in httpOnly cookies
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
  }

  // Shop ID management (stored in memory, not localStorage)
  private currentShopId: string | null = null;

  setShopId(shopId: string | null): void {
    this.currentShopId = shopId;
  }

  getShopId(): string | null {
    return this.currentShopId;
  }

  getAxiosInstance(): AxiosInstance {
    return this.client;
  }

  skipShopIdConfig(config?: any): ExtendedAxiosRequestConfig {
    return {
      ...config,
      __skipShopId: true,
    } as ExtendedAxiosRequestConfig;
  }
}

export const httpClient = new HttpClient();
