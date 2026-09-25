import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic app config (ADR M-001 / M-003). A static `app.json` cannot branch on `APP_VARIANT` or
 * fail a build when a `preview`/`production` build is misconfigured with a plaintext API URL, so
 * this program uses `app.config.ts` instead.
 */

type AppVariant = 'development' | 'preview' | 'production';

const VALID_VARIANTS: readonly AppVariant[] = ['development', 'preview', 'production'];

function resolveVariant(): AppVariant {
  const raw = process.env.APP_VARIANT ?? process.env.EAS_BUILD_PROFILE ?? 'development';
  return (VALID_VARIANTS as readonly string[]).includes(raw) ? (raw as AppVariant) : 'development';
}

const DEV_DEFAULT_API_BASE_URL = 'http://localhost:4000';

/**
 * HTTPS-only for `preview`/`production` — fail fast at build/start time rather than shipping a
 * build that silently sends merchant credentials and order data over plaintext HTTP. The
 * `development` variant may use `http://` because the local dev workflow talks to a disposable
 * backend on the host machine via `adb reverse` (see `docs/mobile/DEV_SETUP.md` §3).
 */
function resolveApiBaseUrl(variant: AppVariant): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  const url = configured ?? (variant === 'development' ? DEV_DEFAULT_API_BASE_URL : '');

  if (!url) {
    throw new Error(
      `[app.config.ts] EXPO_PUBLIC_API_BASE_URL must be set for the "${variant}" variant (no default exists ` +
        'for preview/production — an unset URL is refused rather than silently falling back).',
    );
  }

  const isHttps = url.startsWith('https://');
  const isLocalHttpDev = variant === 'development' && url.startsWith('http://');

  if (!isHttps && !isLocalHttpDev) {
    throw new Error(
      `[app.config.ts] The "${variant}" variant requires an HTTPS API base URL, got "${url}". ` +
        'Only the "development" variant may use http:// (the adb-reverse dev-backend workflow in ' +
        'docs/mobile/DEV_SETUP.md §3).',
    );
  }

  return url;
}

function resolveBuildNumber(config: ConfigContext['config']): string {
  const configured =
    process.env.APP_BUILD_NUMBER ??
    process.env.EAS_BUILD_NUMBER ??
    process.env.EAS_BUILD_VERSION ??
    process.env.BUILD_NUMBER;
  if (configured) return configured;

  const versionCode = config.android?.versionCode;
  return versionCode ? String(versionCode) : 'local';
}

function resolveGitSha(): string {
  return (
    process.env.GIT_SHA ??
    process.env.EAS_BUILD_GIT_COMMIT_HASH ??
    process.env.GITHUB_SHA ??
    process.env.CI_COMMIT_SHA ??
    'unknown'
  );
}

const APP_IDS: Record<AppVariant, string> = {
  development: 'tech.easymod.merchant.dev',
  preview: 'tech.easymod.merchant.preview',
  production: 'tech.easymod.merchant',
};

const APP_NAMES: Record<AppVariant, string> = {
  development: 'EasyMod (Dev)',
  preview: 'EasyMod (Preview)',
  production: 'EasyMod',
};

const APP_SCHEMES: Record<AppVariant, string> = {
  development: 'easymodmerchantdev',
  preview: 'easymodmerchantpreview',
  production: 'easymodmerchant',
};

// `@expo/config-types` (as pinned for SDK 57) no longer declares `newArchEnabled` on `ExpoConfig`
// — the New Architecture is unconditionally on in RN 0.86, there is no legacy architecture left
// to opt out of. The key is kept (and set) anyway so the decision stays an explicit, documented
// line in this file rather than an implicit SDK default a future reader has to go verify
// elsewhere; the intersection type below is only so `tsc` accepts a field the runtime config
// loader has always accepted.
type ExpoConfigWithLegacyNewArchFlag = ExpoConfig & { newArchEnabled?: boolean };

export default ({ config }: ConfigContext): ExpoConfigWithLegacyNewArchFlag => {
  const variant = resolveVariant();
  const apiBaseUrl = resolveApiBaseUrl(variant);
  const buildNumber = resolveBuildNumber(config);
  const gitSha = resolveGitSha();

  return {
    ...config,
    name: APP_NAMES[variant],
    slug: 'easymod-merchant',
    scheme: APP_SCHEMES[variant],
    version: config.version ?? '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    icon: './assets/images/icon.png',
    newArchEnabled: true,
    android: {
      ...config.android,
      package: APP_IDS[variant],
      adaptiveIcon: {
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
        backgroundColor: '#F9FAF8',
      },
      // `resolveApiBaseUrl` above is the actual traffic-shape enforcement point — only the
      // "development" variant is ever allowed an http:// API URL. Android 9+ (API 28+, and this
      // app targets 36) additionally blocks cleartext traffic by default at the OS level
      // regardless of that JS-level check, so the `expo-build-properties` plugin below sets
      // `usesCleartextTraffic` for the "development" variant only, letting the `adb reverse`
      // dev-backend workflow (docs/mobile/DEV_SETUP.md §3) actually reach localhost. Left
      // unset (Android's secure default) for "preview"/"production", which are HTTPS-only per
      // `resolveApiBaseUrl` and must never be able to fall back to cleartext.
    },
    ios: {
      ...config.ios,
      bundleIdentifier: APP_IDS[variant],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#F9FAF8',
          image: './assets/images/splash-icon.png',
          imageWidth: 160,
        },
      ],
      'expo-secure-store',
      // ADR M-002 addendum / DEV_SETUP.md §3: only the "development" variant needs cleartext
      // HTTP (the `adb reverse` dev-backend workflow talks to http://localhost). Android 9+
      // blocks cleartext at the OS level by default regardless of the JS-level check in
      // `resolveApiBaseUrl` above, so this is the actual enforcement point for that variant —
      // and it is never enabled for "preview"/"production", which are HTTPS-only.
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: variant === 'development',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      ...config.extra,
      appVariant: variant,
      apiBaseUrl,
      buildNumber,
      gitSha,
    },
  };
};
