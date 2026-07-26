// Environment configuration with validation
const validEnvironments = ['development', 'staging', 'production'] as const;
type Environment = (typeof validEnvironments)[number];

interface Config {
  apiBaseUrl: string;
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

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '/api';
const modeEnvironment = import.meta.env.MODE === 'test' ? 'development' : import.meta.env.MODE;
const environment = import.meta.env.VITE_ENV || modeEnvironment || 'development';

function isEnvironment(value: string): value is Environment {
  return (validEnvironments as readonly string[]).includes(value);
}

if (!isEnvironment(environment)) {
  throw new Error(`Invalid VITE_ENV: ${environment}. Must be one of: ${validEnvironments.join(', ')}`);
}

const config: Config = { apiBaseUrl, environment, bkashEnabled: isBkashEnabled() };

export default config;
