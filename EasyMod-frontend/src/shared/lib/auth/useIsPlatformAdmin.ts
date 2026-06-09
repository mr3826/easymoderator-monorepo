import { useEffect, useState } from 'react';
import { httpClient } from '@/shared/lib/http/client';

export type PlatformRole = 'SUPPORT_ADMIN' | 'SUPER_ADMIN' | null;

type State = { loading: boolean; role: PlatformRole };

/**
 * Reads the caller's platform_role from /api/auth/me. The backend returns it at
 * data.user.platform_role; we read defensively across envelope shapes.
 */
export function useIsPlatformAdmin(): State {
  const [state, setState] = useState<State>({ loading: true, role: null });

  useEffect(() => {
    let alive = true;
    httpClient
      .get('/api/auth/me')
      .then((r: any) => {
        const body = r?.data ?? {};
        const role =
          body?.data?.user?.platform_role ??
          body?.data?.platform_role ??
          body?.user?.platform_role ??
          body?.platform_role ??
          null;
        if (alive) setState({ loading: false, role: role || null });
      })
      .catch(() => { if (alive) setState({ loading: false, role: null }); });
    return () => { alive = false; };
  }, []);

  return state;
}
