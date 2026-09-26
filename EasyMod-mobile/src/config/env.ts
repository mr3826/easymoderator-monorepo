import Constants from 'expo-constants';

export type AppVariant = 'development' | 'preview' | 'production';

interface AppExtra {
  appVariant: AppVariant;
  apiBaseUrl: string;
  buildNumber: string;
  gitSha: string;
}

const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000';

/**
 * Runtime mirror of the values `app.config.ts` computed and validated at build/start time
 * (HTTPS-only for `preview`/`production`, see that file). Read here via `expo-constants` rather
 * than `process.env` directly, since only `EXPO_PUBLIC_*`-prefixed env vars are inlined into the
 * JS bundle and `app.config.ts`'s `extra` block is the documented way to pass config through.
 */
function readExtra(): AppExtra {
  const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppExtra>;
  const appVariant: AppVariant = extra.appVariant ?? 'development';
  const apiBaseUrl = extra.apiBaseUrl ?? DEFAULT_DEV_API_BASE_URL;
  const buildNumber = extra.buildNumber ?? 'local';
  const gitSha = extra.gitSha ?? 'unknown';
  return { appVariant, apiBaseUrl, buildNumber, gitSha };
}

export const env: AppExtra = readExtra();

export function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}
