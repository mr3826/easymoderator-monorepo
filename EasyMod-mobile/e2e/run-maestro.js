'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const scriptDirectory = path.dirname(path.resolve(process.argv[1]));
const mobileRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(mobileRoot, '..');
const backendRoot = path.join(repositoryRoot, 'EasyMod-backend');
const suitePath = path.join(scriptDirectory, 'flows');
const flowPath = path.join(suitePath, 'smoke.yaml');
const artifactRoot = path.join(scriptDirectory, 'artifacts');
const reportPath = path.join(artifactRoot, 'maestro.xml');
const logcatPath = path.join(artifactRoot, 'adb-logcat.log');

const APP_ID = 'tech.easymod.merchant.dev';
const DEFAULT_EMAIL = 'mobile-dev@easymod.test';
const DEFAULT_PASSWORD = 'MobileDev123!';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4000';
const BACKEND_POLL_INTERVAL_MS = 250;
const BACKEND_TIMEOUT_MS = 120000;
const METRO_PORT = 8081;
const METRO_POLL_INTERVAL_MS = 250;
const METRO_TIMEOUT_MS = 300000;
const METRO_BUNDLE_TIMEOUT_MS = 900000;
const SHUTDOWN_TIMEOUT_MS = 5000;

const SYNTHETIC_BACKEND_ENV = {
  APP_SECRET: 'mobile-e2e-app-secret-at-least-32-chars',
  AI_ACTION_GATE_SECRET: 'mobile-e2e-action-gate-secret-at-least-32-chars',
  CHANNEL_ENCRYPTION_KEY: 'a'.repeat(64),
  CSRF_SECRET: 'mobile-e2e-csrf-secret-at-least-32-chars',
  DELIVERY_ENCRYPTION_KEY: 'c'.repeat(64),
  JWT_ACCESS_SECRET: 'mobile-e2e-jwt-access-secret-at-least-32-chars',
  JWT_REFRESH_SECRET: 'mobile-e2e-jwt-refresh-secret-at-least-32-chars',
  META_APP_ID: 'mobile-e2e-app-id',
  META_APP_SECRET: 'mobile-e2e-meta-app-secret-at-least-32-chars',
  META_WEBHOOK_VERIFY_TOKEN: 'mobile-e2e-verify-token',
  PAYMENT_CALLBACK_HMAC_SECRET: 'mobile-e2e-payment-secret-at-least-32-chars',
  PAYMENT_ENCRYPTION_KEY: 'b'.repeat(64),
  REDIS_CACHE_DB: '11',
  REDIS_LEGACY_DB: '14',
  REDIS_PASSWORD: '',
  REDIS_PORT: '6379',
  REDIS_QUEUE_DB: '13',
  REDIS_RATELIMIT_DB: '12',
  REDIS_SESSION_DB: '10',
  REDIS_SSE_DB: '15',
  REDIS_HOST: '127.0.0.1',
  SESSION_SECRET: 'mobile-e2e-session-secret-at-least-32-chars',
};

let activeChild = null;
let backendChild = null;
let metroChild = null;
let interruptRequested = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interruptRequested = true;
    if (activeChild) activeChild.kill(signal);
    if (backendChild) backendChild.kill(signal);
    if (metroChild) metroChild.kill(signal);
  });
}

function parseArgs(argv) {
  const options = {
    install: false,
    preflight: false,
    startBackend: false,
    apkPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--install') {
      options.install = true;
    } else if (argument === '--preflight') {
      options.preflight = true;
    } else if (argument === '--start-backend') {
      options.startBackend = true;
    } else if (argument === '--apk') {
      options.install = true;
      options.apkPath = argv[index + 1];
      index += 1;
      if (!options.apkPath) throw new Error('--apk requires a path');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function resolveApkPath(rawPath) {
  const candidates = rawPath
    ? [path.resolve(process.cwd(), rawPath)]
    : [
        path.join(
          mobileRoot,
          'android',
          'app',
          'build',
          'outputs',
          'apk',
          'debug',
          'app-debug.apk',
        ),
        path.join(
          mobileRoot,
          'android',
          'app',
          'build',
          'outputs',
          'apk',
          'release',
          'app-release.apk',
        ),
      ];
  const candidate = candidates.find((filePath) => fs.existsSync(filePath));
  if (!candidate) {
    throw new Error(
      `Development APK was not found at ${candidates.join(' or ')}. Build the development variant first.`,
    );
  }
  return candidate;
}

function assertFlowContract() {
  if (!fs.existsSync(flowPath))
    throw new Error(`Maestro flow is missing at ${flowPath}`);
  const flow = fs.readFileSync(flowPath, 'utf8');
  const requiredFragments = [
    `appId: ${APP_ID}`,
    'E2E_EMAIL:',
    'E2E_PASSWORD:',
    '${E2E_EMAIL}',
    '${E2E_PASSWORD}',
    'login-email-input',
    'login-password-input',
    'login-submit',
    'hideKeyboard',
    'home-attention-list',
    'today-summary',
    'attention-card-courier_failed:dispatch:.*',
    'attention-card-courier_setup_required:shop:.*',
    'attention-card-inbox_needs_reply:conversation:.*',
    'attention-card-draft_order:order:.*',
    'attention-card-rto_verify:order:.*',
    'attention-card-low_stock:product:.*',
    'deeplink-found',
    'takeScreenshot',
  ];
  const missing = requiredFragments.filter(
    (fragment) => !flow.includes(fragment),
  );
  if (missing.length > 0)
    throw new Error(`Maestro flow contract is missing: ${missing.join(', ')}`);
  const requiredFlows = [
    'wave25-refresh.yaml',
    'wave25-offline-reconnect.yaml',
    'wave25-navigation.yaml',
    'wave25-stale-entity.yaml',
    'wave25-session-recovery.yaml',
    'wave25-state-preflight.yaml',
  ];
  const flowFiles = fs.readdirSync(suitePath);
  const missingFlows = requiredFlows.filter(
    (name) => !flowFiles.includes(name),
  );
  if (missingFlows.length > 0) {
    throw new Error(
      `Wave 2.5 flow contract is missing: ${missingFlows.join(', ')}`,
    );
  }
  const requiredSupportFiles = [
    path.join(scriptDirectory, 'support', 'restore-online.yaml'),
    path.join(scriptDirectory, 'scripts', 'revoke-all-sessions.js'),
    path.join(
      scriptDirectory,
      'scripts',
      'assert-wave25-state-capabilities.js',
    ),
  ];
  const missingSupportFiles = requiredSupportFiles.filter(
    (filePath) => !fs.existsSync(filePath),
  );
  if (missingSupportFiles.length > 0) {
    throw new Error(
      `Wave 2.5 support contract is missing: ${missingSupportFiles.join(', ')}`,
    );
  }
  for (const name of flowFiles.filter((entry) => entry.endsWith('.yaml'))) {
    const flowSource = fs.readFileSync(path.join(suitePath, name), 'utf8');
    if (/^\s*-\s*wait\s*:/m.test(flowSource)) {
      throw new Error(
        `Maestro flow ${name} contains an arbitrary wait; use a condition-based wait instead.`,
      );
    }
  }
}

function commandOptions(cwd, stdio) {
  return {
    cwd,
    env: process.env,
    stdio,
    windowsHide: true,
    shell: false,
  };
}

function runCommand(command, args, options = {}) {
  const {
    cwd = repositoryRoot,
    env = process.env,
    stdio = 'inherit',
  } = options;
  const useShell =
    process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...commandOptions(cwd, stdio),
      shell: useShell,
      env,
    });
    activeChild = child;

    child.once('error', (error) => {
      if (activeChild === child) activeChild = null;
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (activeChild === child) activeChild = null;
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

function maestroCommand() {
  return process.env.MAESTRO_BIN || 'maestro';
}

async function assertDeviceTools() {
  const adb = process.env.ADB_BIN || 'adb';
  const maestro = maestroCommand();
  try {
    if ((await runCommand(adb, ['version'], { stdio: 'ignore' })) !== 0) {
      throw new Error('adb is unavailable');
    }
  } catch (error) {
    throw new Error(
      `Android SDK adb is required for mobile E2E (${error.message}).`,
    );
  }
  try {
    if (
      (await runCommand(maestro, ['--version'], { stdio: 'inherit' })) !== 0
    ) {
      throw new Error('Maestro exited unsuccessfully');
    }
  } catch (error) {
    throw new Error(
      `Maestro CLI is required for mobile E2E (${error.message}).`,
    );
  }
  if ((await runCommand(adb, ['get-state'], { stdio: 'ignore' })) !== 0) {
    throw new Error(
      'No Android device/emulator is connected and ready (adb get-state failed).',
    );
  }
  return { adb, maestro };
}

function localApiConfig() {
  const raw = process.env.E2E_API_BASE_URL || DEFAULT_API_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('E2E_API_BASE_URL must be a valid local http:// URL.');
  }
  if (
    parsed.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'E2E_API_BASE_URL must target localhost or 127.0.0.1 over http://.',
    );
  }
  const port = parsed.port ? Number(parsed.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('E2E_API_BASE_URL must include a valid TCP port.');
  }
  return { baseUrl: raw.replace(/\/$/, ''), port };
}

function assertDisposableDatabase(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('E2E_DATABASE_URL must be a valid postgres:// URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('E2E_DATABASE_URL must use postgres:// or postgresql://.');
  }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('E2E_DATABASE_URL must target localhost or 127.0.0.1.');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(e2e|test)/i.test(databaseName)) {
    throw new Error(
      'E2E_DATABASE_URL database name must contain "e2e" or "test".',
    );
  }
}

function assertDisposableRedis(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('E2E_REDIS_URL must be a valid redis:// URL.');
  }
  if (
    parsed.protocol !== 'redis:' ||
    !['localhost', '127.0.0.1'].includes(parsed.hostname)
  ) {
    throw new Error(
      'E2E_REDIS_URL must target localhost or 127.0.0.1 over redis://.',
    );
  }
}

function backendEnvironment(email, password, apiPort) {
  const databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
  const redisUrl = process.env.E2E_REDIS_URL || process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'Starting the E2E backend requires E2E_DATABASE_URL and E2E_REDIS_URL.',
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The mobile E2E backend refuses NODE_ENV=production.');
  }
  assertDisposableDatabase(databaseUrl);
  assertDisposableRedis(redisUrl);

  const env = {
    ...process.env,
    ...SYNTHETIC_BACKEND_ENV,
    API_URL: `http://127.0.0.1:${apiPort}`,
    BASE_URL: `http://127.0.0.1:${apiPort}`,
    CORS_ORIGINS: `http://127.0.0.1:${apiPort},http://localhost:${apiPort}`,
    DATABASE_URL: databaseUrl,
    DB_SSL: 'false',
    FRONTEND_URL: `http://127.0.0.1:${apiPort}`,
    GROWTH_OS_ENABLED: 'false',
    MOBILE_API_ENABLED: 'true',
    MOBILE_DEV_SEED_PASSWORD: password,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    PUBLIC_ASSET_URL: `http://127.0.0.1:${apiPort}`,
    REDIS_URL: redisUrl,
    RUN_MIGRATIONS_ON_STARTUP: 'false',
    START_EMBEDDED_WORKERS: 'false',
  };

  // Ensure provider credentials and telemetry from a caller's shell never enter this test server.
  for (const key of [
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'QDRANT_URL',
    'RESEND_API_KEY',
    'SENTRY_DSN',
    'SLACK_ALERT_WEBHOOK_URL',
  ]) {
    delete env[key];
  }

  if (email !== DEFAULT_EMAIL)
    throw new Error(`E2E_EMAIL must be ${DEFAULT_EMAIL}.`);
  return env;
}

async function waitForBackend(baseUrl) {
  const deadline = Date.now() + BACKEND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (backendChild && backendChild.exitCode !== null) {
      throw new Error(
        `E2E backend exited before health check (code ${backendChild.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.service === 'easymod-backend' && body.status === 'ok') return;
      }
    } catch {
      // The next poll is the condition-based wait; startup can still be in progress.
    }
    await new Promise((resolve) =>
      setTimeout(resolve, BACKEND_POLL_INTERVAL_MS),
    );
  }
  throw new Error(
    `E2E backend did not become healthy within ${BACKEND_TIMEOUT_MS / 1000} seconds.`,
  );
}

async function stopBackend() {
  const child = backendChild;
  backendChild = null;
  if (!child || child.exitCode !== null) return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('close', finish);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      finish();
    }, SHUTDOWN_TIMEOUT_MS);
  });
}

async function waitForMetro() {
  const deadline = Date.now() + METRO_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (metroChild && metroChild.exitCode !== null) {
      throw new Error(
        `Metro exited before becoming ready (code ${metroChild.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${METRO_PORT}/status`);
      if (response.ok) return;
    } catch {
      // Metro can take a few seconds to initialise its HTTP server.
    }
    await new Promise((resolve) => setTimeout(resolve, METRO_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Metro did not become healthy within ${METRO_TIMEOUT_MS / 1000} seconds.`,
  );
}

async function startMetro() {
  const expoCli = path.join(mobileRoot, 'node_modules', 'expo', 'bin', 'cli');
  if (!fs.existsSync(expoCli))
    throw new Error(`Expo CLI is missing at ${expoCli}.`);

  metroChild = spawn(
    process.execPath,
    [expoCli, 'start', '--dev-client', '--host=lan', `--port=${METRO_PORT}`],
    {
      ...commandOptions(mobileRoot, 'inherit'),
      env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
    },
  );
  metroChild.once('error', (error) => {
    console.error(`E2E Metro process error: ${error.message}`);
  });
  await waitForMetro();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    METRO_BUNDLE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `http://127.0.0.1:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=android&dev=true&hot=false&lazy=false&minify=false`,
      { signal: controller.signal },
    );
    if (!response.ok)
      throw new Error(`Metro bundle prewarm returned HTTP ${response.status}.`);
    await response.arrayBuffer();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        `Metro Android bundle did not finish within ${METRO_BUNDLE_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function stopMetro() {
  const child = metroChild;
  metroChild = null;
  if (!child || child.exitCode !== null) return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('close', finish);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      finish();
    }, SHUTDOWN_TIMEOUT_MS);
  });
}

async function runSeedCommand(environment, remove = false) {
  const args = ['scripts/seed-mobile-dev.js'];
  if (remove) args.push('--remove');
  return runCommand(process.execPath, args, {
    cwd: backendRoot,
    env: environment,
    stdio: 'inherit',
  });
}

async function startBackend(environment, apiConfig) {
  const migrationCode = await runCommand(
    process.execPath,
    ['src/database/migrate.js', 'up'],
    {
      cwd: backendRoot,
      env: environment,
      stdio: 'inherit',
    },
  );
  if (migrationCode !== 0) throw new Error('E2E database migrations failed.');

  const resetCode = await runSeedCommand(environment, true);
  if (resetCode !== 0) throw new Error('E2E mobile fixture reset failed.');

  const seedCode = await runSeedCommand(environment);
  if (seedCode !== 0) throw new Error('E2E mobile fixture seeding failed.');

  backendChild = spawn(process.execPath, ['server.js'], {
    ...commandOptions(backendRoot, 'inherit'),
    env: environment,
  });
  backendChild.once('error', (error) => {
    console.error(`E2E backend process error: ${error.message}`);
  });
  await waitForBackend(apiConfig.baseUrl);
}

async function runFlow(maestro, email, password) {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const args = [
    'test',
    '--no-ansi',
    '--format=junit',
    `--output=${reportPath}`,
    `--test-output-dir=${artifactRoot}`,
    `--debug-output=${path.join(artifactRoot, 'debug-output')}`,
    '--flatten-debug-output',
  ];
  if (email !== DEFAULT_EMAIL) args.push(`--env=E2E_EMAIL=${email}`);
  if (password !== DEFAULT_PASSWORD)
    args.push(`--env=E2E_PASSWORD=${password}`);
  // The default smoke flow is runnable on every disposable fixture. Optional
  // state-preflight flows remain contract-checked but must not fail core E2E.
  args.push(flowPath);
  return runCommand(maestro, args, { cwd: mobileRoot, stdio: 'inherit' });
}

function redactDeviceLogs(value) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:access|refresh)[_-]?token|password|secret)(\s*[:=]\s*)[^,\s}]+/gi,
      '$1$2[REDACTED]',
    );
}

async function captureDeviceLog(adb) {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const maxBytes = 4 * 1024 * 1024;
  await new Promise((resolve) => {
    let output = '';
    const append = (chunk) => {
      if (output.length < maxBytes)
        output += chunk.toString('utf8').slice(0, maxBytes - output.length);
    };
    const child = spawn(adb, ['logcat', '-d', '-v', 'threadtime'], {
      ...commandOptions(mobileRoot, 'pipe'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      fs.writeFileSync(
        logcatPath,
        `adb logcat unavailable: ${error.message}\n`,
        'utf8',
      );
      resolve();
    });
    child.once('close', (code) => {
      if (code !== 0 && !output)
        output = `adb logcat exited with code ${code}.\n`;
      fs.writeFileSync(logcatPath, redactDeviceLogs(output), 'utf8');
      resolve();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertFlowContract();

  if (options.preflight) {
    console.error(
      'MOBILE_E2E_PREFLIGHT=BLOCKED framework=maestro ' +
        'gap=disposable_emptyHome_and_homeApiError_fixture_toggles_missing',
    );
    return 2;
  }

  const email = process.env.E2E_EMAIL || DEFAULT_EMAIL;
  const password = process.env.E2E_PASSWORD || DEFAULT_PASSWORD;
  const apiConfig = localApiConfig();
  let deviceTools = null;
  let apkPath = null;
  let backendEnvironmentForChild = null;
  let seedAttempted = false;
  let exitCode = 1;

  try {
    deviceTools = await assertDeviceTools();
    apkPath = options.install ? resolveApkPath(options.apkPath) : null;
    backendEnvironmentForChild = options.startBackend
      ? backendEnvironment(email, password, apiConfig.port)
      : null;
    if (options.startBackend) {
      seedAttempted = true;
      await startBackend(backendEnvironmentForChild, apiConfig);
    }

    const reverseCode = await runCommand(
      deviceTools.adb,
      ['reverse', `tcp:${apiConfig.port}`, `tcp:${apiConfig.port}`],
      { stdio: 'inherit' },
    );
    if (reverseCode !== 0)
      throw new Error(
        'adb reverse could not expose the disposable backend to the emulator.',
      );

    const metroReverseCode = await runCommand(
      deviceTools.adb,
      ['reverse', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`],
      { stdio: 'inherit' },
    );
    if (metroReverseCode !== 0)
      throw new Error(
        'adb reverse could not expose the local Metro server to the emulator.',
      );

    if (apkPath) {
      const installCode = await runCommand(
        deviceTools.adb,
        ['install', '-r', apkPath],
        { stdio: 'inherit' },
      );
      if (installCode !== 0)
        throw new Error('Development APK installation failed.');
    }

    if (apkPath && apkPath.includes(`${path.sep}debug${path.sep}`)) {
      await startMetro();
    }

    if (options.install) {
      const clearCode = await runCommand(
        deviceTools.adb,
        ['shell', 'pm', 'clear', APP_ID],
        { stdio: 'inherit' },
      );
      if (clearCode !== 0) throw new Error('Android app state clear failed.');
    }
    const launchCode = await runCommand(
      deviceTools.adb,
      ['shell', 'am', 'start', '-n', `${APP_ID}/.MainActivity`],
      { stdio: 'inherit' },
    );
    if (launchCode !== 0) throw new Error('Android activity launch failed.');
    exitCode = await runFlow(deviceTools.maestro, email, password);
  } finally {
    try {
      await stopMetro();
      await stopBackend();
      if (seedAttempted && backendEnvironmentForChild) {
        const removeCode = await runSeedCommand(
          backendEnvironmentForChild,
          true,
        );
        if (exitCode === 0 && removeCode !== 0) exitCode = removeCode;
      }
    } finally {
      try {
        await captureDeviceLog(
          deviceTools?.adb || process.env.ADB_BIN || 'adb',
        );
      } catch (error) {
        console.error(`E2E log capture failed: ${error.message}`);
      }
    }
  }

  if (exitCode === 0) {
    console.log(`MOBILE_E2E=PASS framework=maestro appId=${APP_ID}`);
  } else {
    console.error(`MOBILE_E2E=FAILED exitCode=${exitCode}`);
  }
  return interruptRequested ? 130 : exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`MOBILE_E2E=BLOCKED_OR_FAILED ${error.message}`);
    process.exitCode = interruptRequested ? 130 : 1;
  });
