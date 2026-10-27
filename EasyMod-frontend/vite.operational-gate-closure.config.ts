import { defineConfig } from 'vite';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function localUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute loopback URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)
    || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    || url.username
    || url.password
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search
    || url.hash) {
    throw new Error(`${label} must use HTTP(S), a loopback host, and no credentials or URL path`);
  }
  return url;
}

const apiUrl = localUrl(
  process.env.OPS_E2E_API_URL || 'http://127.0.0.1:54643',
  'OPS_E2E_API_URL',
);
const frontendPort = Number(process.env.OPS_E2E_FRONTEND_PORT || '54680');
const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, '..');

function localTlsFile(input: string | undefined, label: string): Buffer {
  if (!input || !isAbsolute(input)) {
    throw new Error(`${label} must name an absolute path to the external loopback TLS certificate/key`);
  }

  const realPath = realpathSync(input);
  const fromRepository = relative(repositoryRoot, realPath);
  const isRepositoryPath = fromRepository === ''
    || (fromRepository !== '..'
      && !fromRepository.startsWith(`..${sep}`)
      && !isAbsolute(fromRepository));
  if (isRepositoryPath) {
    throw new Error(`${label} must be outside the repository; do not store TLS material in source control`);
  }
  return readFileSync(realPath);
}

const tlsCertificate = localTlsFile(process.env.OPS_E2E_TLS_CERT, 'OPS_E2E_TLS_CERT');
const tlsPrivateKey = localTlsFile(process.env.OPS_E2E_TLS_KEY, 'OPS_E2E_TLS_KEY');

if (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535) {
  throw new Error('OPS_E2E_FRONTEND_PORT must be an integer from 1024 through 65535');
}

export default defineConfig({
  ...baseConfig,
  server: {
    ...baseConfig.server,
    host: '127.0.0.1',
    port: frontendPort,
    strictPort: true,
    https: {
      cert: tlsCertificate,
      key: tlsPrivateKey,
    },
    proxy: {
      ...baseConfig.server?.proxy,
      '/api': {
        target: apiUrl.origin,
        changeOrigin: true,
        secure: false,
        ws: true,
        configure: (proxy) => {
          // The API enables Express trust proxy in production and only issues
          // its Secure session cookie when the original request was HTTPS.
          // This Vite server is itself HTTPS and loopback-only, so preserve
          // that scheme for the local API without changing cookie policy.
          proxy.on('proxyReq', (proxyRequest) => {
            proxyRequest.setHeader('X-Forwarded-Proto', 'https');
          });
        },
      },
      '/health': {
        target: apiUrl.origin,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
