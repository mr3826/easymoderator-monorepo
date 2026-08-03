import { describe, it, expect, beforeEach, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const { httpClient } = await import('../client');

/**
 * Failures that no single component owns — a denied permission, a dead
 * connection, a 5xx that outlived its retries — must reach the merchant as a
 * toast even when the calling component forgot a catch block. The exclusions
 * matter as much as the rule: a toast on the way to the sign-in redirect, or a
 * toast reading "invalid csrf token", is noise.
 */
const request = async (
  url: string,
  handler: (config: any) => { status: number; data?: any }
) => {
  const axiosInstance = httpClient.getAxiosInstance();
  const originalAdapter = axiosInstance.defaults.adapter;
  let attempts = 0;

  axiosInstance.defaults.adapter = vi.fn(async (config: any) => {
    attempts++;
    const result = handler(config);
    const response = {
      data: result.data ?? {},
      status: result.status,
      statusText: '',
      headers: {},
      config,
    };
    if (result.status >= 400) {
      const err: any = new Error(`Request failed with status ${result.status}`);
      err.config = config;
      err.response = response;
      throw err;
    }
    return response;
  });

  try {
    await httpClient.get(url).catch(() => undefined);
    return attempts;
  } finally {
    axiosInstance.defaults.adapter = originalAdapter;
  }
};

describe('HTTP client — global error toast', () => {
  beforeEach(() => {
    toastError.mockClear();
    localStorage.clear();
    httpClient.setSessionHint(false);
    httpClient.clearCsrfToken();
  });

  it('toasts a denied permission', async () => {
    await request('/api/protected', () => ({
      status: 403,
      data: { error: { message: 'You do not have access to this shop' } },
    }));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('You do not have access to this shop', {
      id: 'FORBIDDEN',
    });
  });

  it('stays silent on a CSRF 403, which is internal plumbing', async () => {
    await request('/api/protected', () => ({
      status: 403,
      data: { error: { message: 'invalid csrf token' } },
    }));

    expect(toastError).not.toHaveBeenCalled();
  });

  it('stays silent on 401 — the sign-in redirect already speaks for it', async () => {
    await request('/api/protected', () => ({ status: 401 }));

    expect(toastError).not.toHaveBeenCalled();
  });

  it('stays silent on auth endpoints, where the form shows the message inline', async () => {
    await request('/auth/signin', () => ({
      status: 500,
      data: { error: { message: 'boom' } },
    }));

    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts a 5xx once, not once per retry', async () => {
    const attempts = await request('/api/protected', () => ({
      status: 500,
      data: { error: { message: 'Server exploded' } },
    }));

    // Retried twice before giving up — but the merchant sees one toast.
    expect(attempts).toBe(3);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Server exploded', { id: 'SERVER_ERROR' });
  });
});
