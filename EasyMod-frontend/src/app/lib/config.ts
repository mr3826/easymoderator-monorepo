// Environment configuration with validation
const validEnvironments = ['development', 'staging', 'production'] as const;
type Environment = (typeof validEnvironments)[number];

interface Config {
  apiBaseUrl: string;
  environment: Environment;
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

const config: Config = { apiBaseUrl, environment };

export default config;
