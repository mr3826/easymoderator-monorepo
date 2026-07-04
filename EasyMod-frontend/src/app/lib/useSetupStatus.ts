import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api';
import type { SetupStatus } from '@/api/types';

type UseSetupStatusOptions = {
  enabled?: boolean;
};

export function useSetupStatus({ enabled = true }: UseSetupStatusOptions = {}) {
  const [data, setData] = useState<SetupStatus | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setIsLoading(false);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const status = await apiClient.getSetupStatus();
      setData(status);
      return status;
    } catch (loadError) {
      setError(loadError);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}
