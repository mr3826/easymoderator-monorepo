// Environment configuration with validation
const validEnvironments = ['development', 'staging', 'production'] as const;
type Environment = (typeof validEnvironments)[number];

interface Config {
  apiBaseUrl: string;
  appUrl: string;
  marketingUrl: string;
  environment: Environment;
  bkashEnabled: boolean;
}

/**
 * bKash purchasing gate (launch remediation, §6).
 *
 * bKash is a live-money integration that is OFF for the controlled pilot. When
 * it is off, no purchasing surface or live-money claim may be shown to a
 * merchant — the backend also fails closed with 503, but the UI must not offer
 * a button that cannot work. Opt-in only: the flag must be the exact string
 * "true", so an unset/misconfigured build stays safely disabled.
 */
export function isBkashEnabled(): boolean {
  return import.meta.env.VITE_BKASH_ENABLED === 'true';
}

const productionDefaults = {
  apiBaseUrl: 'https://api.easymod.tech',
  appUrl: 'https://app.easymod.tech',
  marketingUrl: 'https://easymod.tech',
};
const developmentDefaults = {
  apiBaseUrl: '/api',
  appUrl: 'http://localhost:5173',
  marketingUrl: 'http://localhost:5173',
};
const defaults = import.meta.env.PROD ? productionDefaults : developmentDefaults;

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || defaults.apiBaseUrl;
const appUrl = normalizeOrigin(import.meta.env.VITE_APP_URL || defaults.appUrl);
const marketingUrl = normalizeOrigin(import.meta.env.VITE_MARKETING_URL || defaults.marketingUrl);
const modeEnvironment = import.meta.env.MODE === 'test' ? 'development' : import.meta.env.MODE;
const environment = import.meta.env.VITE_ENV || modeEnvironment || 'development';

function isEnvironment(value: string): value is Environment {
  return (validEnvironments as readonly string[]).includes(value);
}

if (!isEnvironment(environment)) {
  throw new Error(`Invalid VITE_ENV: ${environment}. Must be one of: ${validEnvironments.join(', ')}`);
}

const config: Config = { apiBaseUrl, appUrl, marketingUrl, environment, bkashEnabled: isBkashEnabled() };

export function buildAppUrl(path = '/'): string {
  return new URL(path, `${config.appUrl}/`).toString();
}

export function buildMarketingUrl(path = '/'): string {
  return new URL(path, `${config.marketingUrl}/`).toString();
}

export function buildApiUrl(path = '/'): string {
  const base = config.apiBaseUrl === '/api' ? window.location.origin : config.apiBaseUrl;
  return new URL(path, `${base.replace(/\/$/, '')}/`).toString();
}

export function isMarketingSurface(location: Pick<Location, 'hostname'> = window.location): boolean {
  const marketingHost = new URL(config.marketingUrl).hostname;
  const appHost = new URL(config.appUrl).hostname;
  return marketingHost !== appHost && location.hostname === marketingHost;
}

export default config;
