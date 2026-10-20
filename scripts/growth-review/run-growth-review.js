'use strict';

/**
 * Persistent, owned local founder-review stack for Growth OS.
 *
 * Deliberately separate from scripts/run-growth-e2e.js: the E2E runner keeps
 * its throwaway lifecycle untouched. This runner owns ONLY the Compose project
 * recorded in .growth-review/ (gitignored); every destructive verb re-verifies
 * the project prefix before acting. Ports bind to 127.0.0.1 only. No
 * production credentials, hosts, volumes, or provider keys are ever used.
 *
 * Commands:
 *   node scripts/growth-review/run-growth-review.js up|seed|health|smoke|reset|down|status|code <who>
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const composeFile = path.join(
  repoRoot,
  'docs', 'growth-os', 'action-first-v1', 'qa', 'review', 'docker-compose.review.yml',
);
const stateDir = path.join(repoRoot, '.growth-review');
const currentPath = path.join(stateDir, 'current.json');
const PROJECT_PREFIX = 'em-growth-review-';

function die(message, code = 1) {
  console.error(message);
  process.exitCode = code;
  throw new Error(message);
}

function readCurrent() {
  if (!fs.existsSync(currentPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
    if (typeof parsed.project === 'string' && parsed.project.startsWith(PROJECT_PREFIX)) return parsed;
  } catch (_error) {
    // fall through
  }
  return null;
}

function writeCurrent(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(currentPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function credentialPath(project) {
  return path.join(stateDir, `credentials-${project}.md`);
}

function stackEnvPath(project) {
  return path.join(stateDir, `stack-${project}.json`);
}

function saveStackEnv(project, env, password) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stackEnvPath(project), `${JSON.stringify({ env, password }, null, 2)}\n`, { mode: 0o600 });
}

function loadStackEnv(project) {
  const file = stackEnvPath(project);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function reviewPassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < 20; index += 1) {
    value += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${value}#${crypto.randomInt(10, 100)}`;
}

function buildEnv(project, ports, db) {
  return {
    ...process.env,
    REVIEW_PROJECT: project,
    REVIEW_FRONTEND_PORT: String(ports.frontend),
    REVIEW_PG_DB: db.name,
    REVIEW_PG_USER: 'growth_review',
    REVIEW_PG_PASSWORD: db.password,
    REVIEW_APP_SECRET: randomHex(32),
    REVIEW_JWT_ACCESS_SECRET: randomHex(32),
    REVIEW_JWT_REFRESH_SECRET: randomHex(32),
    REVIEW_SESSION_SECRET: randomHex(32),
    REVIEW_CSRF_SECRET: randomHex(32),
    REVIEW_CHANNEL_KEY: randomHex(32),
    REVIEW_PAYMENT_KEY: randomHex(32),
    REVIEW_DELIVERY_KEY: randomHex(32),
  };
}

function composeArgs(project, ...args) {
  return ['compose', '-p', project, '-f', composeFile, ...args];
}

function run(cmd, args, env, { capture = false, inheritOnError = true, input = undefined } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && /\.(cmd|exe)$/.test(cmd),
    input,
  });
  if (result.error) {
    if (inheritOnError) console.error(`${cmd} failed to start: ${result.error.message}`);
    return { status: 1, stdout: result.stdout || '', stderr: result.stderr || '' };
  }
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function dockerCompose(project, args, env, options = {}) {
  return run('docker', composeArgs(project, ...args), env, options);
}

function listenProbe(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function pickFreeLoopbackPort(preferred) {
  for (const port of preferred) {
    try {
      const got = await listenProbe(net.createServer().listen(port, '127.0.0.1'));
      if (got === port) return port;
    } catch (_error) { /* try next */ }
  }
  return listenProbe(net.createServer().listen(0, '127.0.0.1'));
}

function httpGetJson(port, urlPath, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      },
    );
    request.on('error', () => resolve({ status: 0, body: '' }));
    request.on('timeout', () => { request.destroy(); resolve({ status: 0, body: '' }); });
  });
}

async function waitForFrontend(port, deadlineMs = 180_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const response = await httpGetJson(port, '/health');
    if (response.status === 200) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

function verifyOwnership(project) {
  if (!project || !project.startsWith(PROJECT_PREFIX)) {
    die(`Refusing to touch Compose project "${project}": not a ${PROJECT_PREFIX} owned review project.`);
  }
}

function ensureDocker() {
  const probe = run('docker', ['info', '--format', '{{.Name}}'], process.env, { capture: true });
  if (probe.status !== 0) die('Docker is unavailable. Start Docker Desktop (or the local engine) and retry.');
  return probe.stdout.trim();
}

function assertDisposableDatabaseName(name) {
  if (!/(?:^|[^a-z])(?:e2e|test)(?:[^a-z]|$)/i.test(name)) {
    die(`Refusing review stack: database name "${name}" does not mark a disposable test database.`);
  }
}

async function cmdUp() {
  ensureDocker();
  const existing = readCurrent();
  if (existing && fs.existsSync(stackEnvPath(existing.project))) {
    const stored = loadStackEnv(existing.project);
    console.log(`Reusing owned review project ${existing.project}`);
    const up = dockerCompose(existing.project, ['up', '-d', '--wait', '--build'], {
      ...process.env, ...stored.env,
    });
    if (up.status !== 0) die('Review stack failed to become healthy.');
    const ok = await waitForFrontend(Number(stored.env.REVIEW_FRONTEND_PORT));
    if (!ok) die('Review frontend never became reachable.');
    printAccess(existing);
    return existing;
  }

  const id = randomHex(4);
  const project = `${PROJECT_PREFIX}${id}`;
  verifyOwnership(project);
  const frontend = await pickFreeLoopbackPort([4290, 4292, 4294, 4296, 4298]);
  const db = { name: `easymod_growth_review_${id}_test`, password: randomHex(12) };
  assertDisposableDatabaseName(db.name);
  const env = buildEnv(project, { frontend }, db);

  console.log(`Creating owned review project ${project} (frontend http://127.0.0.1:${frontend})`);
  const up = dockerCompose(project, ['up', '-d', '--wait', '--build'], env);
  if (up.status !== 0) die('Review stack failed to become healthy; see Docker output above.');
  const ready = await waitForFrontend(frontend);
  if (!ready) die('Review frontend never became reachable.');

  const reviewOnly = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith('REVIEW_')),
  );
  saveStackEnv(project, reviewOnly, null);
  writeCurrent({
    project,
    frontendPort: frontend,
    databaseName: db.name,
    createdAt: new Date().toISOString(),
  });
  return readCurrent();
}

async function cmdSeed() {
  ensureDocker();
  const current = readCurrent() || await cmdUp();
  const stored = loadStackEnv(current.project);
  if (!stored) die('Missing stored stack environment for the current review project; run growth:review:down first.');
  const password = reviewPassword();
  const seedEnv = { ...process.env, ...stored.env };
  delete seedEnv.GROWTH_REVIEW_PASSWORD;

  console.log('Running migrations inside the owned review backend...');
  const migrate = dockerCompose(current.project, ['exec', '-T', 'backend', 'node', 'src/database/migrate.js', 'up'], seedEnv);
  if (migrate.status !== 0) die('Review migrations failed.');

  console.log('Seeding synthetic local review fixtures (fresh local password)...');
  // The value travels only in the runner process environment (never in argv);
  // `-e NAME` without a value forwards it into the container.
  const seed = dockerCompose(current.project, [
    'exec', '-T',
    '-e', 'GROWTH_REVIEW_MODE=true',
    '-e', 'GROWTH_REVIEW_PASSWORD',
    'backend', 'node', 'src/scripts/seed-growth-review.js',
  ], { ...seedEnv, GROWTH_REVIEW_PASSWORD: password }, { capture: true });
  const jsonLine = seed.stdout.split(/\r?\n/).filter((line) => line.startsWith('{"receipt"')).pop();
  if (seed.status !== 0 || !jsonLine) {
    console.error(seed.stderr || seed.stdout);
    die('Review seed failed.');
  }
  const { receipt } = JSON.parse(jsonLine);

  const credentialFile = credentialPath(current.project);
  const lines = [
    `# EasyModerator Growth OS — LOCAL review credentials (${current.project})`,
    '',
    'These secrets live only on this machine in a gitignored folder. Never paste them',
    'into tickets, screenshots, commits, CI logs, or shared channels. Stop sharing',
    'by running: npm run growth:review:down',
    '',
    `Frontend URL: http://127.0.0.1:${current.frontendPort}`,
    `Database: ${current.databaseName} (disposable, inside the owned review volume)`,
    `Created: ${current.createdAt}`,
    '',
    '## Identities (real MFA — password + 6-digit TOTP at sign-in)',
    '',
  ];
  for (const [key, account] of Object.entries(receipt.accounts)) {
    lines.push(`### ${key}`);
    lines.push(`- Email: ${account.email}`);
    lines.push(`- Password: ${account.password}`);
    if (account.role) lines.push(`- Growth role: ${account.role}`);
    if (account.totpSecret) lines.push(`- TOTP secret (base32): ${account.totpSecret}`);
    lines.push('');
  }
  lines.push('Live codes without an authenticator app:');
  lines.push('  npm run growth:review:code -- admin');
  lines.push('  npm run growth:review:code -- sales');
  lines.push('');
  lines.push('## Seeded scenario pointers');
  lines.push('- Admin Control: /admin — suspended subscription + stuck payment (GROWTH-REVIEW-OPS shop), expired Meta channel (GROWTH-REVIEW-FCOM shop).');
  lines.push('- Sales Today: overdue + due-today follow-ups for the sales identity; qualified-unassigned and stalled cohorts.');
  lines.push('- Duplicate detection demo phone: +8801710000199 (Mirpur Mobile Mart anchor).');
  lines.push('- AI activated demo: Rongdhanu Craft Corner (converted + first AI reply settings, synthetic).');
  lines.push('');
  lines.push('Fixture receipts:');
  for (const [key, prospect] of Object.entries(receipt.prospects)) {
    lines.push(`- prospect ${key}: ${prospect.businessName} [${prospect.status}] id=${prospect.id}`);
  }
  lines.push(`- seed receipt audit row + role grants recorded; fixture version ${receipt.fixtureVersion}`);
  fs.writeFileSync(credentialFile, `${lines.join('\n')}\n`, { mode: 0o600 });

  saveStackEnv(current.project, { ...stored.env }, password);
  writeCurrent({ ...current, receiptFile: path.relative(repoRoot, credentialFile), seededAt: new Date().toISOString() });
  console.log(`Seeded. Credentials written ONLY to ${path.relative(repoRoot, credentialFile)} (local, gitignored).`);
  printAccess(readCurrent());
}

function printAccess(current) {
  console.log('');
  console.log('Growth OS local founder review');
  console.log(`  URL:      http://127.0.0.1:${current.frontendPort}/`);
  console.log(`  Project:  ${current.project}`);
  console.log(`  Receipt:  ${current.receiptFile ? path.relative(repoRoot, path.join(stateDir, path.basename(current.receiptFile))) : '(run growth:review:seed first)'}`);
  console.log('  Sign in with the receipt accounts; both operators complete the real MFA step.');
}

async function cmdHealth() {
  const current = readCurrent();
  if (!current) die('No owned review stack is recorded (.growth-review/current.json).');
  const stored = loadStackEnv(current.project);
  const results = [];
  const check = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const ps = dockerCompose(current.project, ['ps', '--format', 'json'], stored ? { ...process.env, ...stored.env } : process.env, { capture: true });
  const running = ps.status === 0 && ['postgres', 'redis', 'backend', 'frontend']
    .every((service) => ps.stdout.includes(`"${current.project}-${service}-`));
  check('compose services running', running, running ? '' : 'docker compose ps did not show the four owned services');

  const frontend = await httpGetJson(current.frontendPort, '/');
  check('growth SPA served', frontend.status === 200 && frontend.body.includes('Growth OS'), `status=${frontend.status}`);

  const backendHealth = await httpGetJson(current.frontendPort, '/healthz');
  check('backend /health via proxy', backendHealth.status === 200, `status=${backendHealth.status}`);

  const apiGuard = await httpGetJson(current.frontendPort, '/api/internal/growth-os/session');
  check('growth API requires authentication', apiGuard.status === 401, `status=${apiGuard.status}`);

  const env = await dockerCompose(current.project, ['exec', '-T', 'backend', 'node', '-e',
    'console.log(JSON.stringify({review:process.env.GROWTH_REVIEW_MODE===\'true\',nodeEnv:process.env.NODE_ENV,db:/(_test|_e2e)/.test(process.env.DATABASE_URL),meta:!process.env.META_APP_SECRET,sentry:!process.env.SENTRY_DSN,payment:!process.env.BKASH_AUTH_CREDENTIAL}))',
  ], { ...process.env, ...(stored ? stored.env : {}) }, { capture: true });
  let envJson = null;
  try { envJson = JSON.parse(env.stdout.trim().split(/\r?\n/).pop()); } catch (_error) { /* fail below */ }
  check('local-only gates + providers disabled', Boolean(envJson
    && envJson.review && envJson.nodeEnv === 'test' && envJson.db && envJson.meta && envJson.sentry && envJson.payment),
  env.stdout.trim().split(/\r?\n/).pop());

  const counts = await dockerCompose(current.project, ['exec', '-T', 'backend', 'node', '-e',
    'const {Op}=require(\'sequelize\');const {sequelize}=require(\'./src/utils/database/database-setup\');const {GrowthOsProspect,GrowthOsUserRole,User}=require(\'./src/modules/entities\');(async()=>{const [p,r,u]=await Promise.all([GrowthOsProspect.count({where:{source_reference:{[Op.like]:\'growth-review:%\'}}}),GrowthOsUserRole.count(),User.count({where:{email:{[Op.like]:\'growth-review-%\'}}})]);console.log(JSON.stringify({prospects:p,roles:r,users:u}));await sequelize.close();})().catch((e)=>{console.error(e.message);process.exit(1);})',
  ], { ...process.env, ...(stored ? stored.env : {}) }, { capture: true });
  let countJson = null;
  try { countJson = JSON.parse(counts.stdout.trim().split(/\r?\n/).pop()); } catch (_error) { /* fail below */ }
  check('fixture receipts present', Boolean(countJson && countJson.prospects >= 10 && countJson.roles === 2 && countJson.users >= 3),
    counts.stdout.trim().split(/\r?\n/).pop());

  const failed = results.filter((entry) => !entry.pass);
  if (failed.length > 0) {
    console.error(`Review stack NOT ready: ${failed.length} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('Review stack ready for founder review.');
  }
}

async function cmdDown({ volumes = true } = {}) {
  const current = readCurrent();
  if (!current) {
    console.log('No owned review stack recorded; nothing to do.');
    return;
  }
  verifyOwnership(current.project);
  const stored = loadStackEnv(current.project);
  const args = ['down', '--remove-orphans'];
  if (volumes) args.push('--volumes');
  const result = dockerCompose(current.project, args, { ...process.env, ...(stored ? stored.env : {}) });
  if (result.status !== 0) die(`Review stack teardown failed for ${current.project}.`);
  fs.rmSync(currentPath, { force: true });
  if (volumes) {
    fs.rmSync(stackEnvPath(current.project), { force: true });
    fs.rmSync(credentialPath(current.project), { force: true });
  }
  console.log(`Stopped and removed only owned review project ${current.project}.`);
}

async function cmdReset() {
  await cmdDown({ volumes: true });
  await cmdUp();
  await cmdSeed();
}

function cmdStatus() {
  const current = readCurrent();
  if (!current) {
    console.log('No owned review stack recorded.');
    return;
  }
  const stored = loadStackEnv(current.project);
  const result = dockerCompose(current.project, ['ps'], { ...process.env, ...(stored ? stored.env : {}) });
  console.log(`Project: ${current.project}  URL: http://127.0.0.1:${current.frontendPort}/`);
  process.exitCode = result.status;
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totpCode(base32Secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(base32Secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

function cmdCode(who) {
  const current = readCurrent();
  if (!current || !current.receiptFile) die('Seed first: no credentials receipt exists for the current review project.');
  const text = fs.readFileSync(path.join(repoRoot, current.receiptFile), 'utf8');
  const section = new RegExp(`### ${who}\\b([\\s\\S]*?)(?=###|## |$)`).exec(text);
  if (!section) die(`Unknown review account "${who}" (expected admin, sales, or merchant).`);
  const secret = /TOTP secret \(base32\): ([A-Z2-7=]+)/i.exec(section[1]);
  if (!secret) die(`No TOTP secret recorded for "${who}".`);
  console.log(`Current 6-digit code for ${who}: ${totpCode(secret[1], Math.floor(Date.now() / 1000 / 30))} (valid ~30s)`);
}

async function main() {
  const command = process.argv[2] || 'up';
  switch (command) {
    case 'up': await cmdUp().then((current) => printAccess(current || readCurrent())); break;
    case 'seed': await cmdSeed(); break;
    case 'health': await cmdHealth(); break;
    case 'smoke': {
      const { runSmoke } = require('./smoke-growth-review.js');
      await runSmoke();
      break;
    }
    case 'reset': await cmdReset(); break;
    case 'down': await cmdDown(); break;
    case 'status': cmdStatus(); break;
    case 'code': cmdCode(process.argv[3]); break;
    default:
      console.error('Usage: run-growth-review.js [up|seed|health|smoke|reset|down|status|code <admin|sales>]');
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = process.exitCode || 1;
});
